import { CANCELLABLE_STATUSES, RETRYABLE_STATUSES, buildOptionsSchema } from '@aab/agent-core';
import {
  type BuildJob,
  type BuildJobEvent,
  Prisma,
  appendEventLocked,
  lockBuild,
  transitionLocked,
} from '@aab/database';
import { type BuildJobPayload } from '@aab/job-contracts';
import type { ApiEnv } from '@aab/shared-config';
import { ConflictError, NotFoundError, ValidationError } from '@aab/shared-types';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Paginated, type PaginationQuery, skipTake } from '../../common/http/paginated';
import { API_ENV } from '../../config/api-env.token';
import { PrismaService } from '../../infrastructure/prisma.service';
import { ProjectAccessService } from '../projects/project-access.service';
import { BUILD_REQUESTED_EVENT } from './outbox-dispatcher.service';

export const createBuildSchema = z
  .object({
    /** Defaults to the project's latest requirement revision. */
    requirementId: z.uuid().optional(),
    options: buildOptionsSchema,
  })
  .default({ options: { simulateFailure: 'none' } }); // body is optional
export type CreateBuildInput = z.infer<typeof createBuildSchema>;

export const idempotencyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,128}$/, 'Idempotency-Key must be 8-128 chars of [A-Za-z0-9_-]')
  .optional();

export const eventsQuerySchema = z.object({
  afterSequence: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type EventsQuery = z.infer<typeof eventsQuerySchema>;

/** Running states where cancellation must be coordinated with the worker. */
const ACTIVE_FOR_CANCEL = new Set(['PLANNING', 'GENERATING', 'TESTING', 'REPAIRING']);

/** Outbox row for one build attempt, written in the caller's transaction. */
async function writeOutbox(
  tx: Prisma.TransactionClient,
  buildJobId: string,
  projectId: string,
  attempt: number,
  correlationId: string,
): Promise<void> {
  const payload: BuildJobPayload = {
    schemaVersion: 1,
    buildJobId,
    projectId,
    attempt,
    correlationId,
    enqueuedAt: new Date().toISOString(),
  };
  await tx.outboxMessage.create({
    data: {
      aggregateType: 'build_job',
      aggregateId: buildJobId,
      eventType: BUILD_REQUESTED_EVENT,
      payload,
    },
  });
}

export interface BuildDto {
  id: string;
  projectId: string;
  requirementId: string;
  status: BuildJob['status'];
  attempt: number;
  maxAttempts: number;
  currentStep: string | null;
  repairAttempts: number;
  cancelRequested: boolean;
  options: unknown;
  error: { code: string; message: string | null } | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface BuildDetailDto extends BuildDto {
  plan: {
    summary: string;
    producer: string;
    tasks: { key: string; title: string; status: string }[];
  } | null;
  artifacts: {
    path: string;
    sizeBytes: number;
    sha256: string;
    contentType: string;
    isMock: boolean;
  }[];
}

export interface BuildEventDto {
  sequence: number;
  type: string;
  fromStatus: string | null;
  toStatus: string | null;
  attempt: number;
  step: string | null;
  message: string;
  metadata: unknown;
  createdAt: Date;
}

export function toBuildDto(build: BuildJob): BuildDto {
  return {
    id: build.id,
    projectId: build.projectId,
    requirementId: build.requirementId,
    status: build.status,
    attempt: build.attempt,
    maxAttempts: build.maxAttempts,
    currentStep: build.currentStep,
    repairAttempts: build.repairAttempts,
    cancelRequested: build.cancelRequestedAt !== null,
    options: build.options,
    error: build.errorCode ? { code: build.errorCode, message: build.errorMessage } : null,
    createdAt: build.createdAt,
    updatedAt: build.updatedAt,
    startedAt: build.startedAt,
    completedAt: build.completedAt,
  };
}

/**
 * Event metadata keys that may be shown to users (REST + SSE). Anything else a
 * future writer adds (stack traces, host paths, provider payloads) is dropped.
 */
const PUBLIC_METADATA_KEYS = new Set([
  'requirementId',
  'simulateFailure',
  'tasks',
  'isMock',
  'paths',
  'passed',
  'checks',
  'round',
  'issues',
  'errorCode',
  'artifacts',
  'repairRounds',
  'queueAttempt',
]);

export function publicMetadata(metadata: unknown): Record<string, unknown> {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) return {};
  return Object.fromEntries(
    Object.entries(metadata).filter(([key]) => PUBLIC_METADATA_KEYS.has(key)),
  );
}

export function toEventDto(event: BuildJobEvent): BuildEventDto {
  return {
    sequence: event.sequence,
    type: event.type,
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    attempt: event.attempt,
    step: event.step,
    message: event.message,
    metadata: publicMetadata(event.metadata),
    createdAt: event.createdAt,
  };
}

@Injectable()
export class BuildsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  /**
   * Create a build (PENDING) plus its first event and an outbox message in one
   * transaction. Repeating a request with the same Idempotency-Key returns the
   * original build instead of creating a new one.
   */
  async create(
    userId: string,
    projectId: string,
    input: CreateBuildInput,
    idempotencyKey: string | undefined,
    correlationId: string,
  ): Promise<{ build: BuildDto; created: boolean }> {
    await this.access.getWritableProject(userId, projectId);
    // Failure simulation exists to exercise the mock repair loop; never let it
    // drive real (costly) agent/sandbox work in production.
    if (this.env.NODE_ENV === 'production' && input.options.simulateFailure !== 'none') {
      throw new ValidationError('options.simulateFailure is only available outside production');
    }

    if (idempotencyKey) {
      const existing = await this.findByIdempotencyKey(userId, idempotencyKey, projectId);
      if (existing) return { build: toBuildDto(existing), created: false };
    }

    const requirement = await this.prisma.client.projectRequirement.findFirst({
      where: { projectId, ...(input.requirementId ? { id: input.requirementId } : {}) },
      orderBy: { revision: 'desc' },
      select: { id: true },
    });
    if (!requirement) {
      throw new ValidationError(
        input.requirementId
          ? 'Requirement not found in this project'
          : 'Submit a requirement before starting a build',
      );
    }

    try {
      const build = await this.prisma.client.$transaction(async (tx) => {
        const created = await tx.buildJob.create({
          data: {
            projectId,
            requirementId: requirement.id,
            requestedById: userId,
            maxAttempts: this.env.MAX_BUILD_ATTEMPTS,
            idempotencyKey: idempotencyKey ?? null,
            options: input.options,
          },
        });
        await lockBuild(tx, created.id);
        await appendEventLocked(tx, {
          buildJobId: created.id,
          attempt: created.attempt,
          type: 'STATUS_CHANGED',
          toStatus: 'PENDING',
          message: 'Build requested',
          metadata: { requirementId: requirement.id, ...input.options },
        });
        await writeOutbox(tx, created.id, projectId, created.attempt, correlationId);
        return created;
      });
      return { build: toBuildDto(build), created: true };
    } catch (error) {
      // Concurrent request with the same Idempotency-Key won the race.
      if (
        idempotencyKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.findByIdempotencyKey(userId, idempotencyKey, projectId);
        if (existing) return { build: toBuildDto(existing), created: false };
      }
      throw error;
    }
  }

  async listForProject(
    userId: string,
    projectId: string,
    query: PaginationQuery,
  ): Promise<Paginated<BuildDto>> {
    await this.access.getOwnedProject(userId, projectId);
    const where = { projectId };
    const [items, total] = await Promise.all([
      this.prisma.client.buildJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...skipTake(query),
      }),
      this.prisma.client.buildJob.count({ where }),
    ]);
    return Paginated.of(items.map(toBuildDto), total, query);
  }

  async get(userId: string, buildJobId: string): Promise<BuildDetailDto> {
    await this.access.assertBuildAccess(userId, buildJobId);
    const build = await this.prisma.client.buildJob.findUnique({ where: { id: buildJobId } });
    if (!build) throw new NotFoundError('Build not found');
    const [plan, artifacts] = await Promise.all([
      this.prisma.client.executionPlan.findUnique({
        where: { buildJobId_attempt: { buildJobId, attempt: build.attempt } },
        include: { tasks: { orderBy: { position: 'asc' } } },
      }),
      this.prisma.client.projectArtifact.findMany({
        where: { buildJobId, attempt: build.attempt },
        orderBy: { path: 'asc' },
      }),
    ]);
    return {
      ...toBuildDto(build),
      plan: plan
        ? {
            summary: plan.summary,
            producer: plan.producer,
            tasks: plan.tasks.map((t) => ({ key: t.key, title: t.title, status: t.status })),
          }
        : null,
      artifacts: artifacts.map((a) => ({
        path: a.path,
        sizeBytes: a.sizeBytes,
        sha256: a.sha256,
        contentType: a.contentType,
        isMock: a.isMock,
      })),
    };
  }

  async events(userId: string, buildJobId: string, query: EventsQuery): Promise<BuildEventDto[]> {
    await this.access.assertBuildAccess(userId, buildJobId);
    const events = await this.prisma.client.buildJobEvent.findMany({
      where: { buildJobId, sequence: { gt: query.afterSequence } },
      orderBy: { sequence: 'asc' },
      take: query.limit,
    });
    return events.map(toEventDto);
  }

  /**
   * Cancel a build. Not-yet-running builds are cancelled immediately; running
   * builds get cancel_requested_at and the worker stops at its next control
   * poll, persisting CANCELLED (cooperative, so the sandbox is shut down safely).
   */
  async cancel(
    userId: string,
    buildJobId: string,
  ): Promise<{ build: BuildDto; cancellation: 'completed' | 'requested' }> {
    await this.access.assertBuildAccess(userId, buildJobId);
    const cancellation = await this.prisma.client.$transaction(async (tx) => {
      const locked = await lockBuild(tx, buildJobId);
      if (!CANCELLABLE_STATUSES.has(locked.status)) {
        throw new ConflictError(`Build is already ${locked.status}`);
      }
      await tx.buildJob.update({
        where: { id: buildJobId },
        data: { cancelRequestedAt: new Date() },
      });
      if (ACTIVE_FOR_CANCEL.has(locked.status)) {
        await appendEventLocked(tx, {
          buildJobId,
          attempt: locked.attempt,
          type: 'CANCEL_REQUESTED',
          message: 'Cancellation requested; waiting for the worker to stop',
          dedupeKey: `a${locked.attempt}:cancel-requested`,
        });
        return 'requested' as const;
      }
      await transitionLocked(tx, {
        buildJobId,
        to: 'CANCELLED',
        attempt: locked.attempt,
        message: 'Build cancelled before execution',
        dedupeKey: `a${locked.attempt}:CANCELLED`,
      });
      return 'completed' as const;
    });
    const build = await this.prisma.client.buildJob.findUniqueOrThrow({
      where: { id: buildJobId },
    });
    return { build: toBuildDto(build), cancellation };
  }

  /** Start a new attempt of a FAILED or CANCELLED build (bounded by maxAttempts). */
  async retry(userId: string, buildJobId: string, correlationId: string): Promise<BuildDto> {
    const { projectId } = await this.access.assertBuildAccess(userId, buildJobId);
    await this.access.getWritableProject(userId, projectId);
    await this.prisma.client.$transaction(async (tx) => {
      const locked = await lockBuild(tx, buildJobId);
      if (!RETRYABLE_STATUSES.has(locked.status)) {
        throw new ConflictError(
          `Only FAILED or CANCELLED builds can be retried (is ${locked.status})`,
        );
      }
      const { maxAttempts } = await tx.buildJob.findUniqueOrThrow({
        where: { id: buildJobId },
        select: { maxAttempts: true },
      });
      if (locked.attempt >= maxAttempts) {
        throw new ConflictError(`Maximum attempts (${maxAttempts}) reached for this build`);
      }
      const result = await transitionLocked(tx, {
        buildJobId,
        to: 'PENDING',
        message: `Retry requested (attempt ${locked.attempt + 1})`,
      });
      if (!result.applied) throw new ConflictError('Build changed concurrently; try again');
      await writeOutbox(tx, buildJobId, projectId, result.attempt, correlationId);
    });
    const build = await this.prisma.client.buildJob.findUniqueOrThrow({
      where: { id: buildJobId },
    });
    return toBuildDto(build);
  }

  private async findByIdempotencyKey(
    userId: string,
    key: string,
    projectId: string,
  ): Promise<BuildJob | null> {
    const existing = await this.prisma.client.buildJob.findUnique({
      where: { requestedById_idempotencyKey: { requestedById: userId, idempotencyKey: key } },
    });
    if (existing && existing.projectId !== projectId) {
      throw new ConflictError('Idempotency-Key was already used for a different project');
    }
    return existing;
  }
}
