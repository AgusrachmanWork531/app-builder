import { randomUUID } from 'node:crypto';
import { buildQueueJobId } from '@aab/job-contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BuildQueue } from '../src/modules/jobs/build-queue';
import { OutboxDispatcher } from '../src/modules/jobs/outbox-dispatcher.service';
import { type TestApp, createTestApp } from './support/test-app';

let t: TestApp;
let alice: { id: string; email: string; password: string };
let bob: { id: string; email: string; password: string };
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

async function createProjectWithRequirement(token: string): Promise<string> {
  const project = await t.http().post('/api/v1/projects').set(auth(token)).send({ name: 'Todo' });
  await t
    .http()
    .post(`/api/v1/projects/${project.body.data.id}/requirements`)
    .set(auth(token))
    .send({ prompt: 'Build a simple todo app with tasks and due dates' })
    .expect(201);
  return project.body.data.id as string;
}

beforeAll(async () => {
  t = await createTestApp();
  alice = await t.createUser();
  bob = await t.createUser();
  aliceToken = await t.login(alice.email, alice.password);
  bobToken = await t.login(bob.email, bob.password);
});

afterAll(async () => {
  await t.app.get(BuildQueue).queue.obliterate({ force: true });
  await t.close();
});

describe('auth', () => {
  it('rejects bad credentials with the standard error envelope', async () => {
    const res = await t
      .http()
      .post('/api/v1/auth/login')
      .send({ email: alice.email, password: 'wrong-password' })
      .expect(401);
    expect(res.body).toMatchObject({
      success: false,
      error: { code: 'AUTHENTICATION_ERROR' },
      meta: { requestId: expect.any(String) },
    });
  });

  it('sets an httpOnly session cookie on login and keeps the token out of the body', async () => {
    const res = await t
      .http()
      .post('/api/v1/auth/login')
      .send({ email: alice.email, password: alice.password })
      .expect(200);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/aab_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(res.body.data.accessToken).toBeUndefined();
    expect(res.body.data.user.email).toBe(alice.email);
  });

  it('returns a bearer token only when explicitly requested', async () => {
    const res = await t
      .http()
      .post('/api/v1/auth/login?responseMode=token')
      .send({ email: alice.email, password: alice.password })
      .expect(200);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
  });

  it('sends security headers', async () => {
    const res = await t.http().get('/health/live');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('requires authentication on protected routes', async () => {
    await t.http().get('/api/v1/projects').expect(401);
    await t.http().get('/api/v1/projects').set(auth('not-a-jwt')).expect(401);
    const me = await t.http().get('/api/v1/auth/me').set(auth(aliceToken)).expect(200);
    expect(me.body.data.email).toBe(alice.email);
  });

  it('requires the CSRF header for cookie-authenticated mutations', async () => {
    const login = await t
      .http()
      .post('/api/v1/auth/login')
      .send({ email: alice.email, password: alice.password });
    const cookie = login.headers['set-cookie'] as unknown as string[];
    await t.http().post('/api/v1/projects').set('Cookie', cookie).send({ name: 'x' }).expect(403);
    await t
      .http()
      .post('/api/v1/projects')
      .set('Cookie', cookie)
      .set('X-Requested-With', 'aab-web')
      .send({ name: 'x' })
      .expect(201);
    await t.http().get('/api/v1/projects').set('Cookie', cookie).expect(200);
  });
});

describe('projects and requirements', () => {
  it('creates and lists projects with pagination meta', async () => {
    const created = await t
      .http()
      .post('/api/v1/projects')
      .set(auth(aliceToken))
      .send({ name: '  Shop  ', description: 'demo' })
      .expect(201);
    expect(created.body).toMatchObject({ success: true, data: { name: 'Shop', status: 'ACTIVE' } });

    const list = await t.http().get('/api/v1/projects?page=1&pageSize=1').set(auth(aliceToken));
    expect(list.body.data).toHaveLength(1);
    expect(list.body.meta.pagination).toMatchObject({ page: 1, pageSize: 1 });
    expect(list.body.meta.pagination.total).toBeGreaterThanOrEqual(1);
  });

  it('rejects invalid payloads', async () => {
    const res = await t
      .http()
      .post('/api/v1/projects')
      .set(auth(aliceToken))
      .send({ name: '' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    await t.http().get('/api/v1/projects/not-a-uuid').set(auth(aliceToken)).expect(400);
    await t.http().get('/api/v1/projects?pageSize=1000').set(auth(aliceToken)).expect(400);
  });

  it('analyzes prompts with the mock analyzer and stores revisions', async () => {
    const project = await t
      .http()
      .post('/api/v1/projects')
      .set(auth(aliceToken))
      .send({ name: 'R' });
    const id = project.body.data.id as string;
    await t
      .http()
      .post(`/api/v1/projects/${id}/requirements`)
      .set(auth(aliceToken))
      .send({ prompt: 'too short' })
      .expect(400);

    const first = await t
      .http()
      .post(`/api/v1/projects/${id}/requirements`)
      .set(auth(aliceToken))
      .send({ prompt: 'I need a   todo list\tapp for my team' })
      .expect(201);
    expect(first.body.data).toMatchObject({
      revision: 1,
      normalizedPrompt: 'I need a todo list app for my team',
      analyzer: 'mock',
      specification: { analysis: { isMock: true, matchedTemplate: 'task-manager' } },
    });

    const second = await t
      .http()
      .post(`/api/v1/projects/${id}/requirements`)
      .set(auth(aliceToken))
      .send({ prompt: 'A recipe sharing community for home cooks' })
      .expect(201);
    expect(second.body.data.revision).toBe(2);
    expect(second.body.data.specification.analysis.matchedTemplate).toBeNull();
    expect(second.body.data.specification.analysis.warnings[0]).toMatch(/does not understand/);

    const list = await t.http().get(`/api/v1/projects/${id}/requirements`).set(auth(aliceToken));
    expect(list.body.data.map((r: { revision: number }) => r.revision)).toEqual([2, 1]);
  });
});

describe("authorization: users cannot access other users' projects", () => {
  it('returns 404 for every project-scoped route', async () => {
    const projectId = await createProjectWithRequirement(aliceToken);
    const build = await t
      .http()
      .post(`/api/v1/projects/${projectId}/builds`)
      .set(auth(aliceToken))
      .expect(202);
    const buildId = build.body.data.id as string;

    await t.http().get(`/api/v1/projects/${projectId}`).set(auth(bobToken)).expect(404);
    await t
      .http()
      .get(`/api/v1/projects/${projectId}/requirements`)
      .set(auth(bobToken))
      .expect(404);
    await t
      .http()
      .post(`/api/v1/projects/${projectId}/requirements`)
      .set(auth(bobToken))
      .send({ prompt: 'hijack this project please' })
      .expect(404);
    await t.http().post(`/api/v1/projects/${projectId}/builds`).set(auth(bobToken)).expect(404);
    await t.http().get(`/api/v1/projects/${projectId}/builds`).set(auth(bobToken)).expect(404);
    await t.http().get(`/api/v1/builds/${buildId}`).set(auth(bobToken)).expect(404);
    await t.http().get(`/api/v1/builds/${buildId}/events`).set(auth(bobToken)).expect(404);

    const bobProjects = await t.http().get('/api/v1/projects').set(auth(bobToken));
    expect(bobProjects.body.data.map((p: { id: string }) => p.id)).not.toContain(projectId);
  });
});

describe('builds', () => {
  it('refuses to build without a requirement', async () => {
    const project = await t
      .http()
      .post('/api/v1/projects')
      .set(auth(aliceToken))
      .send({ name: 'B' });
    const res = await t
      .http()
      .post(`/api/v1/projects/${project.body.data.id}/builds`)
      .set(auth(aliceToken))
      .expect(400);
    expect(res.body.error.message).toMatch(/requirement/i);
  });

  it('returns 202 with persisted PENDING status, then the outbox queues it', async () => {
    const projectId = await createProjectWithRequirement(aliceToken);
    const res = await t
      .http()
      .post(`/api/v1/projects/${projectId}/builds`)
      .set(auth(aliceToken))
      .expect(202);
    const build = res.body.data;
    expect(build).toMatchObject({ status: 'PENDING', attempt: 1, projectId });
    expect(res.headers.location).toBe(`/api/v1/builds/${build.id}`);

    const queued = await waitFor(
      () => t.http().get(`/api/v1/builds/${build.id}`).set(auth(aliceToken)),
      (r) => r.body.data.status === 'QUEUED',
    );
    expect(queued.body.data.status).toBe('QUEUED');

    const job = await t.app.get(BuildQueue).queue.getJob(buildQueueJobId(build.id, 1));
    expect(job?.data).toMatchObject({ schemaVersion: 1, buildJobId: build.id, attempt: 1 });

    const events = await t.http().get(`/api/v1/builds/${build.id}/events`).set(auth(aliceToken));
    expect(events.body.data.map((e: { toStatus: string }) => e.toStatus)).toEqual([
      'PENDING',
      'QUEUED',
    ]);
    expect(events.body.data.map((e: { sequence: number }) => e.sequence)).toEqual([1, 2]);
  });

  it('honours Idempotency-Key', async () => {
    const projectId = await createProjectWithRequirement(aliceToken);
    const key = `idem-${Date.now()}`;
    const send = () =>
      t
        .http()
        .post(`/api/v1/projects/${projectId}/builds`)
        .set(auth(aliceToken))
        .set('Idempotency-Key', key)
        .expect(202);
    const [a, b] = await Promise.all([send(), send()]);
    expect(a.body.data.id).toBe(b.body.data.id);
    expect(await t.prisma.buildJob.count({ where: { projectId } })).toBe(1);

    const replay = await send();
    expect(replay.headers['idempotent-replayed']).toBe('true');

    await t
      .http()
      .post(`/api/v1/projects/${projectId}/builds`)
      .set(auth(aliceToken))
      .set('Idempotency-Key', 'bad key!')
      .expect(400);
  });

  it('does not let an orphaned outbox row (deleted build) block other builds', async () => {
    const orphanBuildId = randomUUID();
    const orphan = await t.prisma.outboxMessage.create({
      data: {
        aggregateType: 'build_job',
        aggregateId: orphanBuildId,
        eventType: 'build.requested',
        payload: {
          schemaVersion: 1,
          buildJobId: orphanBuildId,
          projectId: randomUUID(),
          attempt: 1,
          correlationId: 'orphan',
          enqueuedAt: new Date().toISOString(),
        },
      },
    });
    const projectId = await createProjectWithRequirement(aliceToken);
    const res = await t
      .http()
      .post(`/api/v1/projects/${projectId}/builds`)
      .set(auth(aliceToken))
      .expect(202);
    const queued = await waitFor(
      () => t.prisma.buildJob.findUniqueOrThrow({ where: { id: res.body.data.id } }),
      (b) => b.status === 'QUEUED',
    );
    expect(queued.status).toBe('QUEUED');
    expect(
      await t.prisma.outboxMessage.findUniqueOrThrow({ where: { id: orphan.id } }),
    ).toMatchObject({ status: 'FAILED', lastError: 'build no longer exists' });
  });

  it('keeps the build PENDING and retries when queue publication fails', async () => {
    const dispatcher = t.app.get(OutboxDispatcher);
    const queue = t.app.get(BuildQueue).queue;
    const spy = vi.spyOn(queue, 'add').mockRejectedValue(new Error('redis down'));
    try {
      const projectId = await createProjectWithRequirement(aliceToken);
      const res = await t
        .http()
        .post(`/api/v1/projects/${projectId}/builds`)
        .set(auth(aliceToken))
        .expect(202);
      const buildId = res.body.data.id as string;

      const outbox = await waitFor(
        () => t.prisma.outboxMessage.findFirstOrThrow({ where: { aggregateId: buildId } }),
        (row) => row.attempts >= 1,
      );
      expect(outbox).toMatchObject({ status: 'PENDING', lastError: 'redis down' });
      expect((await t.prisma.buildJob.findUniqueOrThrow({ where: { id: buildId } })).status).toBe(
        'PENDING',
      );

      // Redis recovers: make the row due now and run a dispatch pass.
      spy.mockRestore();
      await t.prisma.outboxMessage.update({
        where: { id: outbox.id },
        data: { availableAt: new Date() },
      });
      await dispatcher.tick();
      const recovered = await waitFor(
        () => t.prisma.buildJob.findUniqueOrThrow({ where: { id: buildId } }),
        (b) => b.status === 'QUEUED',
      );
      expect(recovered.status).toBe('QUEUED');
    } finally {
      spy.mockRestore();
    }
  });
});
