import { type Prisma, transitionLocked } from '@aab/database';
import {
  BUILD_JOB_NAME,
  type BuildJobPayload,
  buildJobPayloadSchema,
  buildQueueJobId,
} from '@aab/job-contracts';
import type { ApiEnv } from '@aab/shared-config';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { API_ENV } from '../../config/api-env.token';
import { PrismaService } from '../../infrastructure/prisma.service';
import { BuildQueue, QUEUE_BACKOFF, QUEUE_JOB_ATTEMPTS } from './build-queue';

export const BUILD_REQUESTED_EVENT = 'build.requested';
const BATCH_SIZE = 20;
const MAX_PUBLISH_ATTEMPTS = 10;
const MAX_BACKOFF_MS = 60_000;
const PUBLISH_TIMEOUT_MS = 5000;

/** Capped exponential backoff with jitter (50–100% of the exponential delay). */
export function backoffMs(attempts: number): number {
  return Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempts) * (0.5 + Math.random() / 2);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`queue publish timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

interface OutboxRow {
  id: string;
  payload: unknown;
  attempts: number;
}

/**
 * Transactional outbox relay. Build creation writes an outbox row in the same
 * transaction as the build; this dispatcher publishes it to BullMQ and then
 * marks the build QUEUED. If Redis is down the row stays PENDING and is
 * retried with capped exponential backoff, so a committed build is never lost.
 *
 * Multiple API instances are safe: rows are claimed with FOR UPDATE SKIP LOCKED,
 * and BullMQ deduplicates by deterministic jobId if a publish is repeated.
 */
@Injectable()
export class OutboxDispatcher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxDispatcher.name);
  private timer?: NodeJS.Timeout;
  private inFlight?: Promise<number>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly buildQueue: BuildQueue,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.tick(), this.env.OUTBOX_POLL_INTERVAL_MS);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    await this.inFlight?.catch(() => undefined);
  }

  /** Run one dispatch pass (skipped if one is already running). */
  async tick(): Promise<number> {
    if (this.inFlight) return 0;
    this.inFlight = this.dispatchBatch().catch((error: unknown) => {
      this.logger.error({ err: error }, 'outbox dispatch pass failed');
      return 0;
    });
    try {
      return await this.inFlight;
    } finally {
      this.inFlight = undefined;
    }
  }

  private async dispatchBatch(): Promise<number> {
    let published = 0;
    for (let i = 0; i < BATCH_SIZE; i++) {
      const result = await this.dispatchNext();
      if (result === 'empty') break;
      if (result === 'published') published++;
    }
    return published;
  }

  /**
   * Claim and publish one row in its own transaction, so a failing row can
   * never roll back other rows or block the head of the queue.
   */
  private async dispatchNext(): Promise<'empty' | 'published' | 'deferred'> {
    let claimed: OutboxRow | undefined;
    try {
      return await this.prisma.client.$transaction(
        async (tx) => {
          const rows = await tx.$queryRaw<OutboxRow[]>`
            SELECT id, payload, attempts FROM outbox_messages
            WHERE status = 'PENDING' AND available_at <= now() AND event_type = ${BUILD_REQUESTED_EVENT}
            ORDER BY created_at
            LIMIT 1
            FOR UPDATE SKIP LOCKED`;
          claimed = rows[0];
          if (!claimed) return 'empty';
          return (await this.publishOne(tx, claimed)) ? 'published' : 'deferred';
        },
        { timeout: 15_000 },
      );
    } catch (error) {
      if (!claimed) throw error;
      await this.deferAfterError(claimed, error);
      return 'deferred';
    }
  }

  /** Unexpected failure (transaction rolled back): push the row back with backoff. */
  private async deferAfterError(row: OutboxRow, error: unknown): Promise<void> {
    const attempts = row.attempts + 1;
    await this.prisma.client.outboxMessage.update({
      where: { id: row.id },
      data: {
        attempts,
        lastError: error instanceof Error ? error.message.slice(0, 500) : 'dispatch failed',
        status: attempts >= MAX_PUBLISH_ATTEMPTS ? 'FAILED' : 'PENDING',
        availableAt: new Date(Date.now() + backoffMs(attempts)),
      },
    });
    this.logger.error({ outboxId: row.id, attempts, err: error }, 'outbox row dispatch failed');
  }

  private async publishOne(tx: Prisma.TransactionClient, row: OutboxRow): Promise<boolean> {
    const parsed = buildJobPayloadSchema.safeParse(row.payload);
    if (!parsed.success) {
      await tx.outboxMessage.update({
        where: { id: row.id },
        data: { status: 'FAILED', lastError: 'invalid payload' },
      });
      this.logger.error({ outboxId: row.id }, 'outbox row has an invalid payload');
      return false;
    }
    const payload: BuildJobPayload = parsed.data;

    // The build may have been deleted (project/user deletion) after the row was written.
    const exists = await tx.buildJob.count({ where: { id: payload.buildJobId } });
    if (!exists) {
      await tx.outboxMessage.update({
        where: { id: row.id },
        data: { status: 'FAILED', lastError: 'build no longer exists' },
      });
      return false;
    }

    try {
      await withTimeout(
        this.buildQueue.queue.add(BUILD_JOB_NAME, payload, {
          jobId: buildQueueJobId(payload.buildJobId, payload.attempt),
          attempts: QUEUE_JOB_ATTEMPTS,
          backoff: QUEUE_BACKOFF,
          removeOnComplete: { age: 24 * 3600, count: 1000 },
          removeOnFail: { age: 7 * 24 * 3600 },
        }),
        PUBLISH_TIMEOUT_MS,
      );
    } catch (error) {
      await this.recordPublishFailure(tx, row, payload, error);
      return false;
    }

    await tx.outboxMessage.update({
      where: { id: row.id },
      data: { status: 'PUBLISHED', publishedAt: new Date(), attempts: row.attempts + 1 },
    });
    // No-op if the worker already advanced it or the user cancelled meanwhile.
    await transitionLocked(tx, {
      buildJobId: payload.buildJobId,
      to: 'QUEUED',
      expectedFrom: ['PENDING'],
      attempt: payload.attempt,
      message: 'Queued for execution',
      step: 'QUEUED',
      dedupeKey: `a${payload.attempt}:QUEUED`,
    });
    return true;
  }

  private async recordPublishFailure(
    tx: Prisma.TransactionClient,
    row: OutboxRow,
    payload: BuildJobPayload,
    error: unknown,
  ): Promise<void> {
    const attempts = row.attempts + 1;
    const message = error instanceof Error ? error.message.slice(0, 500) : 'publish failed';
    const exhausted = attempts >= MAX_PUBLISH_ATTEMPTS;
    await tx.outboxMessage.update({
      where: { id: row.id },
      data: {
        attempts,
        lastError: message,
        status: exhausted ? 'FAILED' : 'PENDING',
        availableAt: new Date(Date.now() + backoffMs(attempts)),
      },
    });
    this.logger.warn({ outboxId: row.id, attempts, exhausted }, 'queue publish failed');
    if (exhausted) {
      await transitionLocked(tx, {
        buildJobId: payload.buildJobId,
        to: 'FAILED',
        expectedFrom: ['PENDING'],
        attempt: payload.attempt,
        message: 'Build could not be queued',
        error: { code: 'QUEUE_PROCESSING_ERROR', message: 'Queue unavailable after retries' },
      });
    }
  }
}
