import { execFile } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { SandboxError, ValidationError } from '@aab/shared-types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalGitProvider } from './local-git.provider';

const run = promisify(execFile);
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'aab-git-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const file = (path: string, content = 'x') => ({ path, content: Buffer.from(content) });

describe('LocalGitProvider', () => {
  it('commits a full snapshot each time (files from earlier exports are removed)', async () => {
    const git = new LocalGitProvider(root);
    await git.commitFiles('project-a', [file('a.txt'), file('dir/b.txt')], 'first');
    const second = await git.commitFiles('project-a', [file('dir'), file('c.txt')], 'second');
    expect(second.commitSha).toMatch(/^[0-9a-f]{40}$/);
    const { stdout } = await run('git', ['-C', join(root, 'repos', 'project-a'), 'ls-files']);
    // `dir` changed from a directory to a file without breaking the export.
    expect(stdout.trim().split('\n').sort()).toEqual(['c.txt', 'dir']);
  });

  it.each(['.git/config', './.git/config', 'a/../.git/hooks/pre-commit', '.GIT/config'])(
    'refuses to write into .git via %j',
    async (path) => {
      const git = new LocalGitProvider(root);
      await expect(git.commitFiles('project-b', [file(path)], 'evil')).rejects.toBeInstanceOf(
        ValidationError,
      );
    },
  );

  it('rejects traversal outside the repository and invalid repository names', async () => {
    const git = new LocalGitProvider(root);
    await expect(git.commitFiles('project-c', [file('../escape.txt')], 'x')).rejects.toBeInstanceOf(
      SandboxError,
    );
    await expect(git.commitFiles('../etc', [file('a.txt')], 'x')).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(access(join(root, 'repos', 'escape.txt'))).rejects.toThrow();
  });
});
