import { buildQueueJobId } from '@aab/job-contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BuildQueue } from '../src/modules/jobs/build-queue';
import { BuildReconciler } from '../src/modules/jobs/build-reconciler.service';
import { type TestApp, createTestApp } from './support/test-app';

let t: TestApp;
let aliceToken: string;
let bobToken: string;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function waitFor<T>(fn: () => Promise<T>, done: (v: T) => boolean, ms = 10_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (done(value) || Date.now() > deadline) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function newBuild(body: object = {}): Promise<{ id: string; projectId: string }> {
  const project = await t.http().post('/api/v1/projects').set(auth(aliceToken)).send({ name: 'C' });
  const projectId = project.body.data.id as string;
  await t
    .http()
    .post(`/api/v1/projects/${projectId}/requirements`)
    .set(auth(aliceToken))
    .send({ prompt: 'A todo app with tasks and due dates' })
    .expect(201);
  const res = await t
    .http()
    .post(`/api/v1/projects/${projectId}/builds`)
    .set(auth(aliceToken))
    .send(body)
    .expect(202);
  return { id: res.body.data.id as string, projectId };
}

function parseSse(text: string): { event: string; id?: string; data: unknown }[] {
  return text
    .split('\n\n')
    .map((block) => block.split('\n'))
    .filter((lines) => lines.some((l) => l.startsWith('event: ')))
    .map((lines) => ({
      event: lines.find((l) => l.startsWith('event: '))!.slice(7),
      id: lines.find((l) => l.startsWith('id: '))?.slice(4),
      data: JSON.parse(lines.find((l) => l.startsWith('data: '))!.slice(6)),
    }));
}

beforeAll(async () => {
  // Reconciler/dispatcher are driven manually or via short intervals in these tests.
  t = await createTestApp({ RECONCILE_INTERVAL_MS: '3600000', STALE_BUILD_SECONDS: '60' });
  const alice = await t.createUser();
  const bob = await t.createUser();
  aliceToken = await t.login(alice.email, alice.password);
  bobToken = await t.login(bob.email, bob.password);
});

afterAll(async () => {
  await t.app.get(BuildQueue).queue.obliterate({ force: true });
  await t.close();
});

describe('build options', () => {
  it('stores mock simulation options and rejects unknown values', async () => {
    const build = await newBuild({ options: { simulateFailure: 'validation-once' } });
    const res = await t.http().get(`/api/v1/builds/${build.id}`).set(auth(aliceToken));
    expect(res.body.data.options).toEqual({ simulateFailure: 'validation-once' });

    const project = await t.prisma.project.findUniqueOrThrow({ where: { id: build.projectId } });
    await t
      .http()
      .post(`/api/v1/projects/${project.id}/builds`)
      .set(auth(aliceToken))
      .send({ options: { simulateFailure: 'rm -rf' } })
      .expect(400);
  });
});

describe('cancel', () => {
  it('cancels a not-yet-running build immediately and rejects a second cancel', async () => {
    const build = await newBuild();
    const res = await t
      .http()
      .post(`/api/v1/builds/${build.id}/cancel`)
      .set(auth(aliceToken))
      .expect(202);
    expect(res.body.data).toMatchObject({
      cancellation: 'completed',
      build: { status: 'CANCELLED' },
    });
    await t.http().post(`/api/v1/builds/${build.id}/cancel`).set(auth(aliceToken)).expect(409);
  });

  it('only requests cancellation for a running build (worker completes it)', async () => {
    const build = await newBuild();
    await waitFor(
      () => t.prisma.buildJob.findUniqueOrThrow({ where: { id: build.id } }),
      (b) => b.status === 'QUEUED',
    );
    await t.prisma.buildJob.update({ where: { id: build.id }, data: { status: 'PLANNING' } });
    const res = await t
      .http()
      .post(`/api/v1/builds/${build.id}/cancel`)
      .set(auth(aliceToken))
      .expect(202);
    expect(res.body.data).toMatchObject({
      cancellation: 'requested',
      build: { status: 'PLANNING', cancelRequested: true },
    });
    const events = await t.http().get(`/api/v1/builds/${build.id}/events`).set(auth(aliceToken));
    expect(events.body.data.map((e: { type: string }) => e.type)).toContain('CANCEL_REQUESTED');
  });
});

describe('retry', () => {
  it('starts a new attempt for a cancelled build and queues it', async () => {
    const build = await newBuild();
    await t.http().post(`/api/v1/builds/${build.id}/cancel`).set(auth(aliceToken)).expect(202);
    const res = await t
      .http()
      .post(`/api/v1/builds/${build.id}/retry`)
      .set(auth(aliceToken))
      .expect(202);
    expect(res.body.data).toMatchObject({ status: 'PENDING', attempt: 2, cancelRequested: false });

    await waitFor(
      () => t.prisma.buildJob.findUniqueOrThrow({ where: { id: build.id } }),
      (b) => b.status === 'QUEUED',
    );
    const job = await t.app.get(BuildQueue).queue.getJob(buildQueueJobId(build.id, 2));
    expect(job?.data).toMatchObject({ attempt: 2 });
  });

  it('rejects retrying a build that has not failed', async () => {
    const build = await newBuild();
    await t.http().post(`/api/v1/builds/${build.id}/retry`).set(auth(aliceToken)).expect(409);
  });

  it('enforces the maximum number of attempts', async () => {
    const build = await newBuild();
    await t.prisma.buildJob.update({
      where: { id: build.id },
      data: { status: 'FAILED', attempt: 3, maxAttempts: 3 },
    });
    const res = await t
      .http()
      .post(`/api/v1/builds/${build.id}/retry`)
      .set(auth(aliceToken))
      .expect(409);
    expect(res.body.error.message).toMatch(/Maximum attempts/);
  });
});

describe('authorization on control endpoints and streams', () => {
  it("hides other users' builds behind 404", async () => {
    const build = await newBuild();
    await t.http().post(`/api/v1/builds/${build.id}/cancel`).set(auth(bobToken)).expect(404);
    await t.http().post(`/api/v1/builds/${build.id}/retry`).set(auth(bobToken)).expect(404);
    await t.http().get(`/api/v1/builds/${build.id}/stream`).set(auth(bobToken)).expect(404);
    await t.http().get(`/api/v1/builds/${build.id}/stream`).expect(401);
  });
});

describe('SSE stream', () => {
  it('streams events, a status snapshot and end for a terminal build; resumes with Last-Event-ID', async () => {
    const build = await newBuild();
    await t.http().post(`/api/v1/builds/${build.id}/cancel`).set(auth(aliceToken)).expect(202);

    const res = await t
      .http()
      .get(`/api/v1/builds/${build.id}/stream`)
      .set(auth(aliceToken))
      .buffer(true)
      .parse((r, cb) => {
        let body = '';
        r.on('data', (chunk: Buffer) => (body += chunk.toString()));
        r.on('end', () => cb(null, body));
      })
      .expect(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    const messages = parseSse(res.body as string);
    const buildEvents = messages.filter((m) => m.event === 'build-event');
    expect(buildEvents.map((m) => (m.data as { toStatus: string }).toStatus)).toEqual([
      'PENDING',
      'CANCELLED',
    ]);
    expect(buildEvents.map((m) => m.id)).toEqual(['1', '2']);
    expect(messages.some((m) => m.event === 'status')).toBe(true);
    expect(messages.at(-1)).toMatchObject({ event: 'end', data: { status: 'CANCELLED' } });

    const resumed = await t
      .http()
      .get(`/api/v1/builds/${build.id}/stream`)
      .set(auth(aliceToken))
      .set('Last-Event-ID', '1')
      .buffer(true)
      .parse((r, cb) => {
        let body = '';
        r.on('data', (chunk: Buffer) => (body += chunk.toString()));
        r.on('end', () => cb(null, body));
      });
    const resumedEvents = parseSse(resumed.body as string).filter((m) => m.event === 'build-event');
    expect(resumedEvents.map((m) => m.id)).toEqual(['2']);

    // Out-of-range / garbage cursors fall back to the beginning instead of erroring.
    for (const bad of ['1e30', 'abc', '-5']) {
      const res2 = await t
        .http()
        .get(`/api/v1/builds/${build.id}/stream`)
        .set(auth(aliceToken))
        .set('Last-Event-ID', bad)
        .buffer(true)
        .parse((r, cb) => {
          let body = '';
          r.on('data', (chunk: Buffer) => (body += chunk.toString()));
          r.on('end', () => cb(null, body));
        })
        .expect(200);
      const ids = parseSse(res2.body as string)
        .filter((m) => m.event === 'build-event')
        .map((m) => m.id);
      expect(ids).toEqual(['1', '2']);
    }
  });
});

describe('stale build reconciliation (worker failure recovery)', () => {
  it('fails a running build whose worker vanished, or cancels it if cancellation was requested', async () => {
    const lost = await newBuild();
    const lostCancel = await newBuild();
    const old = new Date(Date.now() - 10 * 60_000);
    for (const b of [lost, lostCancel]) {
      await waitFor(
        () => t.prisma.buildJob.findUniqueOrThrow({ where: { id: b.id } }),
        (row) => row.status === 'QUEUED',
      );
      // Simulate: worker started, then died and its queue job is gone.
      await t.app.get(BuildQueue).queue.remove(buildQueueJobId(b.id, 1));
      await t.prisma.buildJob.update({
        where: { id: b.id },
        data: { status: 'GENERATING', lastHeartbeatAt: old },
      });
    }
    await t.prisma.buildJob.update({
      where: { id: lostCancel.id },
      data: { cancelRequestedAt: new Date() },
    });

    const recovered = await t.app.get(BuildReconciler).reconcile();
    expect(recovered).toBeGreaterThanOrEqual(2);
    expect(await t.prisma.buildJob.findUniqueOrThrow({ where: { id: lost.id } })).toMatchObject({
      status: 'FAILED',
      errorCode: 'QUEUE_PROCESSING_ERROR',
    });
    expect(
      (await t.prisma.buildJob.findUniqueOrThrow({ where: { id: lostCancel.id } })).status,
    ).toBe('CANCELLED');
  });

  it('fails a QUEUED build whose queue job is no longer live (never stuck forever)', async () => {
    const build = await newBuild();
    await waitFor(
      () => t.prisma.buildJob.findUniqueOrThrow({ where: { id: build.id } }),
      (row) => row.status === 'QUEUED',
    );
    await t.app.get(BuildQueue).queue.remove(buildQueueJobId(build.id, 1));
    await t.prisma
      .$executeRaw`UPDATE build_jobs SET updated_at = now() - interval '10 minutes' WHERE id = ${build.id}::uuid`;
    await t.app.get(BuildReconciler).reconcile();
    expect(await t.prisma.buildJob.findUniqueOrThrow({ where: { id: build.id } })).toMatchObject({
      status: 'FAILED',
      errorCode: 'QUEUE_PROCESSING_ERROR',
    });
  });

  it('leaves a stale build alone while its queue job is still live', async () => {
    const build = await newBuild();
    await waitFor(
      () => t.prisma.buildJob.findUniqueOrThrow({ where: { id: build.id } }),
      (row) => row.status === 'QUEUED',
    );
    await t.prisma.buildJob.update({
      where: { id: build.id },
      data: { status: 'PLANNING', lastHeartbeatAt: new Date(Date.now() - 10 * 60_000) },
    });
    await t.app.get(BuildReconciler).reconcile();
    expect((await t.prisma.buildJob.findUniqueOrThrow({ where: { id: build.id } })).status).toBe(
      'PLANNING',
    );
  });
});
