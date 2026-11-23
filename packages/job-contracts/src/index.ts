import { z } from 'zod';

/** BullMQ queue carrying build execution requests to AI workers. */
export const BUILD_QUEUE_NAME = 'build-jobs';
export const BUILD_JOB_NAME = 'build.execute';

/**
 * Payload v1. The payload only carries identifiers: workers load the
 * authoritative state from PostgreSQL, so a stale or duplicated queue message
 * can never override persisted status.
 */
export const buildJobPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  buildJobId: z.uuid(),
  projectId: z.uuid(),
  attempt: z.number().int().min(1),
  correlationId: z.string().min(1).max(128),
  enqueuedAt: z.iso.datetime(),
});

export type BuildJobPayload = z.infer<typeof buildJobPayloadSchema>;

export function parseBuildJobPayload(input: unknown): BuildJobPayload {
  return buildJobPayloadSchema.parse(input);
}

/**
 * Deterministic BullMQ job id: one queue job per build attempt. BullMQ ignores
 * an add() whose jobId already exists, which deduplicates outbox re-publishes.
 * (BullMQ forbids ':' in custom ids.)
 */
export function buildQueueJobId(buildJobId: string, attempt: number): string {
  return `${buildJobId}_a${attempt}`;
}
