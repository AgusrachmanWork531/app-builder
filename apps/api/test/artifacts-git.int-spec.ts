import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ArtifactCleanupService } from '../src/modules/artifacts/artifact-cleanup.service';
import { BuildQueue } from '../src/modules/jobs/build-queue';
import { type TestApp, createTestApp } from './support/test-app';

const run = promisify(execFile);
let t: TestApp;
let storage: string;
let aliceToken: string;
let bobToken: string;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Create a build via the API, then materialize COMPLETED state + artifact files. */
async function completedBuild(files: Record<string, string>, expiresAt: Date | null = null) {
  const project = await t.http().post('/api/v1/projects').set(auth(aliceToken)).send({ name: 'A' });
  const projectId = project.body.data.id as string;
  await t
    .http()
    .post(`/api/v1/projects/${projectId}/requirements`)
    .set(auth(aliceToken))
    .send({ prompt: 'A todo app with tasks' })
    .expect(201);
  const build = await t
    .http()
    .post(`/api/v1/projects/${projectId}/builds`)
    .set(auth(aliceToken))
    .expect(202);
  const buildId = build.body.data.id as string;
  await t.prisma.buildJob.update({ where: { id: buildId }, data: { status: 'COMPLETED' } });
  const ids: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    const storageKey = `workspaces/${buildId}_a1/${path}`;
    await mkdir(join(storage, storageKey, '..'), { recursive: true });
    await writeFile(join(storage, storageKey), content);
    const row = await t.prisma.projectArtifact.create({
      data: {
        projectId,
        buildJobId: buildId,
        attempt: 1,
        path,
        storageKey,
        sizeBytes: Buffer.byteLength(content),
        sha256: createHash('sha256').update(content).digest('hex'),
        contentType: 'application/json',
        isMock: true,
        expiresAt,
      },
    });
    ids[path] = row.id;
  }
  return { buildId, projectId, ids };
}

beforeAll(async () => {
  storage = await mkdtemp(join(tmpdir(), 'aab-api-artifacts-'));
  t = await createTestApp({ ARTIFACT_STORAGE_PATH: storage });
  const alice = await t.createUser();
  const bob = await t.createUser();
  aliceToken = await t.login(alice.email, alice.password);
  bobToken = await t.login(bob.email, bob.password);
});

afterAll(async () => {
  await t.app.get(BuildQueue).queue.obliterate({ force: true });
  await t.close();
  await rm(storage, { recursive: true, force: true });
});

describe('artifact download', () => {
  it('serves the file as a sandboxed attachment to the owner only', async () => {
    const { buildId, ids } = await completedBuild({ 'app-spec.json': '{"mock":true}' });
    const url = `/api/v1/builds/${buildId}/artifacts/${ids['app-spec.json']}/download`;

    const res = await t.http().get(url).set(auth(aliceToken)).buffer(true).expect(200);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['content-disposition']).toBe('attachment; filename="app-spec.json"');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-artifact-sha256']).toBe(
      createHash('sha256').update('{"mock":true}').digest('hex'),
    );
    expect(Buffer.from(res.body as Buffer).toString()).toBe('{"mock":true}');

    await t.http().get(url).set(auth(bobToken)).expect(404);
    await t.http().get(url).expect(401);
  });

  it('rejects artifacts from another build and expired artifacts', async () => {
    const a = await completedBuild({ 'a.json': '{}' });
    const b = await completedBuild({ 'b.json': '{}' });
    await t
      .http()
      .get(`/api/v1/builds/${a.buildId}/artifacts/${b.ids['b.json']}/download`)
      .set(auth(aliceToken))
      .expect(404);

    const expired = await completedBuild({ 'old.json': '{}' }, new Date(Date.now() - 1000));
    const res = await t
      .http()
      .get(`/api/v1/builds/${expired.buildId}/artifacts/${expired.ids['old.json']}/download`)
      .set(auth(aliceToken))
      .expect(404);
    expect(res.body.error.message).toMatch(/expired/);
  });

  it('exposes artifact ids and expiry in build detail', async () => {
    const { buildId, ids } = await completedBuild(
      { 'x.json': '{}' },
      new Date(Date.now() + 86_400_000),
    );
    const res = await t.http().get(`/api/v1/builds/${buildId}`).set(auth(aliceToken));
    expect(res.body.data.artifacts[0]).toMatchObject({ id: ids['x.json'], path: 'x.json' });
    expect(res.body.data.artifacts[0].expiresAt).toEqual(expect.any(String));
  });
});

describe('artifact cleanup', () => {
  it('removes expired files and rows, keeping unexpired ones', async () => {
    const expired = await completedBuild({ 'gone.json': '{}' }, new Date(Date.now() - 1000));
    const fresh = await completedBuild({ 'kept.json': '{}' }, new Date(Date.now() + 86_400_000));
    await t.app.get(ArtifactCleanupService).cleanup();

    expect(await t.prisma.projectArtifact.count({ where: { id: expired.ids['gone.json'] } })).toBe(
      0,
    );
    await expect(
      access(join(storage, `workspaces/${expired.buildId}_a1/gone.json`)),
    ).rejects.toThrow();
    expect(await t.prisma.projectArtifact.count({ where: { id: fresh.ids['kept.json'] } })).toBe(1);
    await access(join(storage, `workspaces/${fresh.buildId}_a1/kept.json`));
  });
});

describe('git export (local platform repository)', () => {
  it('commits the artifacts of a COMPLETED build and records an event', async () => {
    const { buildId, projectId } = await completedBuild({
      'MOCK_README.md': '# mock',
      'api/routes.mock.json': '{"routes":[]}',
    });
    const res = await t
      .http()
      .post(`/api/v1/builds/${buildId}/git-export`)
      .set(auth(aliceToken))
      .expect(200);
    expect(res.body.data).toMatchObject({
      repository: `local:project-${projectId}`,
      files: 2,
      commitSha: expect.stringMatching(/^[0-9a-f]{40}$/),
    });

    const repo = join(storage, 'repos', `project-${projectId}`);
    const { stdout: tree } = await run('git', ['-C', repo, 'ls-files']);
    expect(tree.trim().split('\n').sort()).toEqual(['MOCK_README.md', 'api/routes.mock.json']);
    const { stdout: msg } = await run('git', ['-C', repo, 'log', '-1', '--format=%s']);
    expect(msg).toMatch(/\[MOCK artifacts\]/);

    const second = await t
      .http()
      .post(`/api/v1/builds/${buildId}/git-export`)
      .set(auth(aliceToken))
      .expect(200);
    expect(second.body.data.commitSha).not.toBe(res.body.data.commitSha);

    const events = await t.http().get(`/api/v1/builds/${buildId}/events`).set(auth(aliceToken));
    const exported = events.body.data.filter((e: { type: string }) => e.type === 'GIT_EXPORTED');
    expect(exported[0].metadata).toMatchObject({ commitSha: res.body.data.commitSha });
  });

  it('refuses unfinished builds and other users', async () => {
    const { buildId } = await completedBuild({ 'a.json': '{}' });
    await t.http().post(`/api/v1/builds/${buildId}/git-export`).set(auth(bobToken)).expect(404);
    await t.prisma.buildJob.update({ where: { id: buildId }, data: { status: 'FAILED' } });
    await t.http().post(`/api/v1/builds/${buildId}/git-export`).set(auth(aliceToken)).expect(409);
  });
});
