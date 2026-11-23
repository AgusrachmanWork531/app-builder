import { randomUUID } from 'node:crypto';
import { loadWorkspaceDotenv } from '@aab/shared-config';
import { WorkflowTransitionError } from '@aab/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type PrismaClient, appendEvent, createPrismaClient, transitionBuild } from '../src';

let prisma: PrismaClient;
const createdUsers: string[] = [];

async function createBuild(): Promise<string> {
  const user = await prisma.user.create({
    data: { email: `wf-${randomUUID()}@test.local`, passwordHash: 'x' },
  });
  createdUsers.push(user.id);
  const project = await prisma.project.create({ data: { ownerId: user.id, name: 'wf test' } });
  const requirement = await prisma.projectRequirement.create({
    data: {
      projectId: project.id,
      revision: 1,
      rawPrompt: 'p',
      normalizedPrompt: 'p',
      specification: {},
      analyzer: 'test',
      createdById: user.id,
    },
  });
  const build = await prisma.buildJob.create({
    data: {
      projectId: project.id,
      requirementId: requirement.id,
      requestedById: user.id,
      maxAttempts: 3,
    },
  });
  return build.id;
}

async function events(buildJobId: string) {
  return prisma.buildJobEvent.findMany({ where: { buildJobId }, orderBy: { sequence: 'asc' } });
}

beforeAll(() => {
  loadWorkspaceDotenv();
  prisma = createPrismaClient({ databaseUrl: process.env.DATABASE_URL ?? '' });
});

afterAll(async () => {
  // Deleting users cascades to their projects, requirements, builds and events.
  await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
  await prisma.$disconnect();
});

describe('workflow store (integration)', () => {
  it('persists the happy path with monotonic event sequences', async () => {
    const id = await createBuild();
    for (const to of ['QUEUED', 'PLANNING', 'GENERATING', 'TESTING', 'COMPLETED'] as const) {
      const result = await transitionBuild(prisma, { buildJobId: id, to, message: `→ ${to}` });
      expect(result.applied).toBe(true);
    }
    const build = await prisma.buildJob.findUniqueOrThrow({ where: { id } });
    expect(build.status).toBe('COMPLETED');
    expect(build.version).toBe(5);
    expect(build.startedAt).not.toBeNull();
    expect(build.completedAt).not.toBeNull();
    expect((await events(id)).map((e) => e.sequence)).toEqual([1, 2, 3, 4, 5]);
  });

  it('rejects invalid transitions without writing anything', async () => {
    const id = await createBuild();
    await expect(
      transitionBuild(prisma, { buildJobId: id, to: 'COMPLETED', message: 'skip ahead' }),
    ).rejects.toBeInstanceOf(WorkflowTransitionError);
    expect((await prisma.buildJob.findUniqueOrThrow({ where: { id } })).status).toBe('PENDING');
    expect(await events(id)).toHaveLength(0);
  });

  it('no-ops on unexpected status and stale attempts', async () => {
    const id = await createBuild();
    const unexpected = await transitionBuild(prisma, {
      buildJobId: id,
      to: 'PLANNING',
      expectedFrom: ['QUEUED'],
      message: 'x',
    });
    expect(unexpected).toMatchObject({ applied: false, reason: 'unexpected_status' });
    const stale = await transitionBuild(prisma, {
      buildJobId: id,
      to: 'QUEUED',
      attempt: 2,
      message: 'x',
    });
    expect(stale).toMatchObject({ applied: false, reason: 'stale_attempt' });
  });

  it('serializes concurrent writers on the same build', async () => {
    const id = await createBuild();
    await transitionBuild(prisma, { buildJobId: id, to: 'QUEUED', message: 'queued' });
    const results = await Promise.allSettled([
      transitionBuild(prisma, { buildJobId: id, to: 'CANCELLED', message: 'cancel' }),
      transitionBuild(prisma, { buildJobId: id, to: 'PLANNING', message: 'start' }),
      ...Array.from({ length: 5 }, (_, i) =>
        appendEvent(prisma, { buildJobId: id, attempt: 1, type: 'LOG', message: `log ${i}` }),
      ),
    ]);
    // Exactly one of cancel/start wins; the loser fails the state machine check
    // (CANCELLED → PLANNING is invalid) or applies validly (PLANNING → CANCELLED).
    const seqs = (await events(id)).map((e) => e.sequence);
    expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, i) => i + 1));
    expect(results.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(6);
  });

  it('starts a new attempt on retry and clears error state', async () => {
    const id = await createBuild();
    await transitionBuild(prisma, {
      buildJobId: id,
      to: 'FAILED',
      message: 'boom',
      error: { code: 'BUILD_FAILURE', message: 'boom' },
    });
    const retry = await transitionBuild(prisma, {
      buildJobId: id,
      to: 'PENDING',
      message: 'retry',
    });
    expect(retry).toMatchObject({ applied: true, attempt: 2 });
    const build = await prisma.buildJob.findUniqueOrThrow({ where: { id } });
    expect(build).toMatchObject({
      attempt: 2,
      status: 'PENDING',
      errorCode: null,
      errorDetails: null,
    });
  });

  it('deletes a project together with its requirements, builds and events', async () => {
    const id = await createBuild();
    await transitionBuild(prisma, { buildJobId: id, to: 'QUEUED', message: 'queued' });
    const { projectId } = await prisma.buildJob.findUniqueOrThrow({ where: { id } });
    await prisma.project.delete({ where: { id: projectId } });
    expect(await prisma.buildJob.count({ where: { id } })).toBe(0);
    expect(await prisma.projectRequirement.count({ where: { projectId } })).toBe(0);
    expect(await prisma.buildJobEvent.count({ where: { buildJobId: id } })).toBe(0);
  });

  it('skips duplicate events by dedupe key', async () => {
    const id = await createBuild();
    const input = { buildJobId: id, attempt: 1, type: 'LOG', message: 'once', dedupeKey: 'k1' };
    await appendEvent(prisma, input);
    await appendEvent(prisma, input);
    expect(await events(id)).toHaveLength(1);
  });
});
