import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ResourceLimitError, SandboxError } from '@aab/shared-types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MockSandboxProvider } from './mock-sandbox';

let root: string;
let outside: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'aab-sbx-'));
  outside = await mkdtemp(join(tmpdir(), 'aab-outside-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe('MockSandboxProvider', () => {
  it('writes, reads and lists files inside the workspace', async () => {
    const ws = await new MockSandboxProvider(root).createWorkspace('build-1_a1');
    await ws.writeFile('src/app.ts', 'export {}');
    await ws.writeFile('README.md', '# hi');
    expect(await ws.readFile('src/app.ts')).toBe('export {}');
    expect(await ws.listFiles()).toEqual(['README.md', 'src/app.ts']);
  });

  it('is idempotent for the same workspace id', async () => {
    const provider = new MockSandboxProvider(root);
    await (await provider.createWorkspace('w1')).writeFile('a.txt', 'a');
    expect(await (await provider.createWorkspace('w1')).listFiles()).toEqual(['a.txt']);
  });

  it.each(['../escape.txt', 'a/../../escape.txt', '/etc/passwd', 'C:\\x', 'a\0b', ''])(
    'rejects unsafe path %j',
    async (path) => {
      const ws = await new MockSandboxProvider(root).createWorkspace('w1');
      await expect(ws.writeFile(path, 'x')).rejects.toBeInstanceOf(SandboxError);
    },
  );

  it('rejects invalid workspace ids', async () => {
    await expect(new MockSandboxProvider(root).createWorkspace('../x')).rejects.toBeInstanceOf(
      SandboxError,
    );
  });

  it('refuses to follow symlinks out of the workspace', async () => {
    const ws = await new MockSandboxProvider(root).createWorkspace('w1');
    await writeFile(join(outside, 'secret.txt'), 'secret');
    await symlink(outside, join(root, 'workspaces', 'w1', 'link'));
    await expect(ws.readFile('link/secret.txt')).rejects.toBeInstanceOf(SandboxError);
    await expect(ws.writeFile('link/new.txt', 'x')).rejects.toBeInstanceOf(SandboxError);
  });

  it('refuses to write or read through a symlinked file and never collects it', async () => {
    const ws = await new MockSandboxProvider(root).createWorkspace('w1');
    const victim = join(outside, 'victim.txt');
    await writeFile(victim, 'original');
    await symlink(victim, join(root, 'workspaces', 'w1', 'link.txt'));
    await expect(ws.writeFile('link.txt', 'pwned')).rejects.toBeInstanceOf(SandboxError);
    await expect(ws.readFile('link.txt')).rejects.toBeInstanceOf(SandboxError);
    expect(await readFile(victim, 'utf8')).toBe('original');
    expect((await ws.collectArtifacts()).map((a) => a.path)).not.toContain('link.txt');
  });

  it('does not create directories outside the root via a symlinked directory', async () => {
    const ws = await new MockSandboxProvider(root).createWorkspace('w1');
    await symlink(outside, join(root, 'workspaces', 'w1', 'dirlink'));
    await expect(ws.writeFile('dirlink/nested/deep/x.txt', 'x')).rejects.toBeInstanceOf(
      SandboxError,
    );
    await expect(access(join(outside, 'nested'))).rejects.toThrow();
  });

  it('enforces size and count limits', async () => {
    const ws = await new MockSandboxProvider(root, {
      maxFileBytes: 10,
      maxFiles: 2,
      maxTotalBytes: 15,
    }).createWorkspace('w1');
    await expect(ws.writeFile('big.txt', 'x'.repeat(11))).rejects.toBeInstanceOf(
      ResourceLimitError,
    );
    await ws.writeFile('a.txt', 'x'.repeat(8));
    await expect(ws.writeFile('b.txt', 'x'.repeat(8))).rejects.toBeInstanceOf(ResourceLimitError);
    await ws.writeFile('b.txt', 'x');
    await expect(ws.writeFile('c.txt', 'x')).rejects.toBeInstanceOf(ResourceLimitError);
  });

  it('never executes commands', async () => {
    const ws = await new MockSandboxProvider(root).createWorkspace('w1');
    await expect(ws.executeCommand('rm', ['-rf', '/'])).rejects.toBeInstanceOf(SandboxError);
  });

  it('collects artifacts with checksums and storage keys', async () => {
    const ws = await new MockSandboxProvider(root).createWorkspace('w1');
    await ws.writeFile('spec.json', '{}');
    const [artifact] = await ws.collectArtifacts();
    expect(artifact).toEqual({
      path: 'spec.json',
      storageKey: 'workspaces/w1/spec.json',
      sizeBytes: 2,
      sha256: createHash('sha256').update('{}').digest('hex'),
      contentType: 'application/json',
    });
  });
});
