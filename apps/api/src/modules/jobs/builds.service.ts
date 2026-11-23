import {
  type BuildJob,
  type BuildJobEvent,
  Prisma,
  appendEventLocked,
  lockBuild,
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
  })
  .default({}); // body is optional
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

export interface BuildDto {
  id: string;
  projectId: string;
  requirementId: string;
  status: BuildJob['status'];
  attempt: number;
  maxAttempts: number;
  currentStep: string | null;
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
    error: build.errorCode ? { code: build.errorCode, message: build.errorMessage } : null,
    createdAt: build.createdAt,
    updatedAt: build.updatedAt,
    startedAt: build.startedAt,
    completedAt: build.completedAt,
  };
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
    metadata: event.metadata,
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
          },
        });
        await lockBuild(tx, created.id);
        await appendEventLocked(tx, {
          buildJobId: created.id,
          attempt: created.attempt,
          type: 'STATUS_CHANGED',
          toStatus: 'PENDING',
          message: 'Build requested',
          metadata: { requirementId: requirement.id },
        });
        const payload: BuildJobPayload = {
          schemaVersion: 1,
          buildJobId: created.id,
          projectId,
          attempt: created.attempt,
          correlationId,
          enqueuedAt: new Date().toISOString(),
        };
        await tx.outboxMessage.create({
          data: {
            aggregateType: 'build_job',
            aggregateId: created.id,
            eventType: BUILD_REQUESTED_EVENT,
            payload,
          },
        });
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
