import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotFoundError, SandboxError } from '@aab/shared-types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalArtifactStore } from './local-artifact-store';

let root: string;
let outside: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'aab-store-'));
  outside = await mkdtemp(join(tmpdir(), 'aab-store-out-'));
  await mkdir(join(root, 'workspaces', 'w1'), { recursive: true });
  await writeFile(join(root, 'workspaces', 'w1', 'a.json'), '{"a":1}');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe('LocalArtifactStore', () => {
  it('reads an artifact by storage key', async () => {
    const store = new LocalArtifactStore(root);
    expect((await store.read('workspaces/w1/a.json')).toString()).toBe('{"a":1}');
  });

  it('rejects traversal, missing files and symlinks', async () => {
    const store = new LocalArtifactStore(root);
    await expect(store.read('../etc/passwd')).rejects.toBeInstanceOf(SandboxError);
    await expect(store.read('workspaces/w1/missing.txt')).rejects.toBeInstanceOf(NotFoundError);
    await writeFile(join(outside, 'secret.txt'), 'secret');
    await symlink(join(outside, 'secret.txt'), join(root, 'workspaces', 'w1', 'link.txt'));
    await expect(store.read('workspaces/w1/link.txt')).rejects.toBeInstanceOf(SandboxError);
  });

  it('deletes idempotently and never follows a symlink target', async () => {
    const store = new LocalArtifactStore(root);
    await store.delete('workspaces/w1/a.json');
    await store.delete('workspaces/w1/a.json');
    await expect(store.read('workspaces/w1/a.json')).rejects.toBeInstanceOf(NotFoundError);

    await writeFile(join(outside, 'keep.txt'), 'keep');
    await symlink(join(outside, 'keep.txt'), join(root, 'workspaces', 'w1', 'l2.txt'));
    await store.delete('workspaces/w1/l2.txt');
    const { readFile } = await import('node:fs/promises');
    expect(await readFile(join(outside, 'keep.txt'), 'utf8')).toBe('keep');
  });
});
