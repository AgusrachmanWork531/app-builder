import { BUILD_STATUSES } from '@aab/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BuildQueue } from '../src/modules/jobs/build-queue';
import { type TestApp, createTestApp } from './support/test-app';

let t: TestApp;
let aliceToken: string;
let bobToken: string;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function project(token: string, name = 'P'): Promise<string> {
  const res = await t.http().post('/api/v1/projects').set(auth(token)).send({ name }).expect(201);
  return res.body.data.id as string;
}

async function requirement(token: string, projectId: string): Promise<void> {
  await t
    .http()
    .post(`/api/v1/projects/${projectId}/requirements`)
    .set(auth(token))
    .send({ prompt: 'A todo app with tasks' })
    .expect(201);
}

beforeAll(async () => {
  t = await createTestApp();
  const alice = await t.createUser();
  const bob = await t.createUser();
  aliceToken = await t.login(alice.email, alice.password);
  bobToken = await t.login(bob.email, bob.password);
});

afterAll(async () => {
  await t.app.get(BuildQueue).queue.obliterate({ force: true });
  await t.close();
});

describe('dashboard', () => {
  it('returns zeroed stats for a new user with every status present', async () => {
    const res = await t.http().get('/api/v1/dashboard').set(auth(bobToken)).expect(200);
    expect(res.body.data.projectCount).toEqual({ active: 0, archived: 0 });
    expect(res.body.data.recentProjects).toEqual([]);
    expect(Object.keys(res.body.data.buildStatusSummary).sort()).toEqual(
      [...BUILD_STATUSES].sort(),
    );
  });

  it("summarizes only the requesting user's projects and builds", async () => {
    const id = await project(aliceToken, 'Dash');
    await requirement(aliceToken, id);
    const build = await t
      .http()
      .post(`/api/v1/projects/${id}/builds`)
      .set(auth(aliceToken))
      .expect(202);

    const alice = await t.http().get('/api/v1/dashboard').set(auth(aliceToken));
    expect(alice.body.data.projectCount.active).toBeGreaterThanOrEqual(1);
    expect(alice.body.data.recentBuilds[0]).toMatchObject({
      id: build.body.data.id,
      projectName: 'Dash',
    });
    const total = Object.values(
      alice.body.data.buildStatusSummary as Record<string, number>,
    ).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(1);

    const bob = await t.http().get('/api/v1/dashboard').set(auth(bobToken));
    expect(bob.body.data.recentBuilds).toEqual([]);
    expect(bob.body.data.projectCount.active).toBe(0);
  });

  it('requires authentication', async () => {
    await t.http().get('/api/v1/dashboard').expect(401);
  });
});

describe('update project', () => {
  it('updates name and clears description', async () => {
    const id = await project(aliceToken, 'Old');
    const res = await t
      .http()
      .patch(`/api/v1/projects/${id}`)
      .set(auth(aliceToken))
      .send({ name: ' New name ', description: null })
      .expect(200);
    expect(res.body.data).toMatchObject({ name: 'New name', description: null });
  });

  it('rejects empty and unknown-field payloads', async () => {
    const id = await project(aliceToken);
    await t.http().patch(`/api/v1/projects/${id}`).set(auth(aliceToken)).send({}).expect(400);
    await t
      .http()
      .patch(`/api/v1/projects/${id}`)
      .set(auth(aliceToken))
      .send({ ownerId: 'someone-else' })
      .expect(400);
  });

  it("hides other users' projects behind 404", async () => {
    const id = await project(aliceToken);
    await t
      .http()
      .patch(`/api/v1/projects/${id}`)
      .set(auth(bobToken))
      .send({ name: 'x' })
      .expect(404);
    await t.http().post(`/api/v1/projects/${id}/archive`).set(auth(bobToken)).expect(404);
    await t.http().post(`/api/v1/projects/${id}/unarchive`).set(auth(bobToken)).expect(404);
  });
});

describe('archive', () => {
  it('makes a project read-only and hides it from the default list until unarchived', async () => {
    const id = await project(aliceToken, 'Archivable');
    await requirement(aliceToken, id);
    const archived = await t
      .http()
      .post(`/api/v1/projects/${id}/archive`)
      .set(auth(aliceToken))
      .expect(200);
    expect(archived.body.data).toMatchObject({
      status: 'ARCHIVED',
      archivedAt: expect.any(String),
    });

    const active = await t.http().get('/api/v1/projects?pageSize=100').set(auth(aliceToken));
    expect(active.body.data.map((p: { id: string }) => p.id)).not.toContain(id);
    const onlyArchived = await t
      .http()
      .get('/api/v1/projects?status=archived&pageSize=100')
      .set(auth(aliceToken));
    expect(onlyArchived.body.data.map((p: { id: string }) => p.id)).toContain(id);

    await t.http().get(`/api/v1/projects/${id}`).set(auth(aliceToken)).expect(200);
    await t
      .http()
      .patch(`/api/v1/projects/${id}`)
      .set(auth(aliceToken))
      .send({ name: 'x' })
      .expect(409);
    await t
      .http()
      .post(`/api/v1/projects/${id}/requirements`)
      .set(auth(aliceToken))
      .send({ prompt: 'A blog with posts please' })
      .expect(409);
    await t.http().post(`/api/v1/projects/${id}/builds`).set(auth(aliceToken)).expect(409);

    const restored = await t
      .http()
      .post(`/api/v1/projects/${id}/unarchive`)
      .set(auth(aliceToken))
      .expect(200);
    expect(restored.body.data).toMatchObject({ status: 'ACTIVE', archivedAt: null });
    await t.http().post(`/api/v1/projects/${id}/builds`).set(auth(aliceToken)).expect(202);
  });

  it('refuses to archive while a build is still running', async () => {
    const id = await project(aliceToken);
    await requirement(aliceToken, id);
    const build = await t
      .http()
      .post(`/api/v1/projects/${id}/builds`)
      .set(auth(aliceToken))
      .expect(202);
    await t.http().post(`/api/v1/projects/${id}/archive`).set(auth(aliceToken)).expect(409);
    await t
      .http()
      .post(`/api/v1/builds/${build.body.data.id}/cancel`)
      .set(auth(aliceToken))
      .expect(202);
    await t.http().post(`/api/v1/projects/${id}/archive`).set(auth(aliceToken)).expect(200);
  });
});

describe('concurrency invariants', () => {
  it('never leaves an archived project with a running build (archive vs create race)', async () => {
    for (let round = 0; round < 5; round++) {
      const id = await project(aliceToken, `Race ${round}`);
      await requirement(aliceToken, id);
      const [archiveRes, buildRes] = await Promise.all([
        t.http().post(`/api/v1/projects/${id}/archive`).set(auth(aliceToken)),
        t.http().post(`/api/v1/projects/${id}/builds`).set(auth(aliceToken)),
      ]);
      // Exactly one side wins: either archived with no builds, or a build with archive refused.
      const proj = await t.prisma.project.findUniqueOrThrow({ where: { id } });
      const running = await t.prisma.buildJob.count({
        where: { projectId: id, status: { notIn: ['COMPLETED', 'FAILED', 'CANCELLED'] } },
      });
      if (proj.status === 'ARCHIVED') {
        expect(running).toBe(0);
        expect(buildRes.status).toBe(409);
      } else {
        expect(archiveRes.status).toBe(409);
        expect(buildRes.status).toBe(202);
      }
    }
  });

  it('assigns unique, gap-free requirement revisions under concurrency', async () => {
    const id = await project(aliceToken, 'Revisions');
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        t
          .http()
          .post(`/api/v1/projects/${id}/requirements`)
          .set(auth(aliceToken))
          .send({ prompt: `A todo app, variant number ${i}` }),
      ),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    const revisions = results.map((r) => r.body.data.revision as number).sort();
    expect(revisions).toEqual([1, 2, 3, 4, 5]);
  });

  it('stores an empty description as null', async () => {
    const id = await project(aliceToken);
    const res = await t
      .http()
      .patch(`/api/v1/projects/${id}`)
      .set(auth(aliceToken))
      .send({ description: '   ' })
      .expect(200);
    expect(res.body.data.description).toBeNull();
  });
});

describe('project list pagination', () => {
  it('returns an empty page with consistent meta beyond the last page', async () => {
    const res = await t.http().get('/api/v1/projects?page=999&pageSize=50').set(auth(aliceToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta.pagination.page).toBe(999);
    expect(res.body.meta.pagination.total).toBeGreaterThan(0);
  });

  it('pages through projects with consistent meta', async () => {
    for (let i = 0; i < 3; i++) await project(bobToken, `Bob ${i}`);
    const first = await t.http().get('/api/v1/projects?page=1&pageSize=2').set(auth(bobToken));
    const second = await t.http().get('/api/v1/projects?page=2&pageSize=2').set(auth(bobToken));
    expect(first.body.meta.pagination).toMatchObject({
      page: 1,
      pageSize: 2,
      total: 3,
      totalPages: 2,
    });
    expect(first.body.data).toHaveLength(2);
    expect(second.body.data).toHaveLength(1);
    await t.http().get('/api/v1/projects?status=deleted').set(auth(bobToken)).expect(400);
  });
});
