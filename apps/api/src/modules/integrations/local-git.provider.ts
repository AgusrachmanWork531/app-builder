import { execFile } from 'node:child_process';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { resolveInside } from '@aab/sandbox-adapters';
import { ExternalProviderError, ValidationError } from '@aab/shared-types';
import type { GitCommitResult, GitFile, GitProvider } from './git-provider';

const run = promisify(execFile);
const REPO_NAME = /^[a-z0-9][a-z0-9-]{0,99}$/;
const GIT_TIMEOUT_MS = 15_000;
const AUTHOR = 'AI App Builder <noreply@aab.local>';

/**
 * Commits files into platform-owned repositories under
 * <ARTIFACT_STORAGE_PATH>/repos/<name>. Hardening:
 *  - execFile with fixed argv (no shell, no user-controlled flags);
 *  - isolated environment: HOME points at the repos root, global/system
 *    config is ignored and hooks are disabled, so host git config or hooks
 *    can never run;
 *  - file paths confined to the repository via resolveInside, and any path
 *    whose normalized form touches `.git` is rejected (no config/hook writes);
 *  - risky git features disabled (fsmonitor, ssh, protocols, symlinks).
 * Each commit is a full snapshot: the work tree is cleared (except .git)
 * before the build's files are written.
 */
export class LocalGitProvider implements GitProvider {
  readonly name = 'local-git';
  private readonly root: string;
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(storageRoot: string) {
    this.root = resolve(storageRoot, 'repos');
  }

  async commitFiles(
    repository: string,
    files: GitFile[],
    message: string,
  ): Promise<GitCommitResult> {
    if (!REPO_NAME.test(repository)) throw new ValidationError('Invalid repository name');
    // Serialize operations per repository within this process.
    const previous = this.locks.get(repository) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => this.commitNow(repository, files, message));
    this.locks.set(repository, next);
    try {
      return await next;
    } finally {
      if (this.locks.get(repository) === next) this.locks.delete(repository);
    }
  }

  private async commitNow(
    repository: string,
    files: GitFile[],
    message: string,
  ): Promise<GitCommitResult> {
    const dir = join(this.root, repository);
    await mkdir(dir, { recursive: true });
    await this.git(dir, ['init', '--quiet', '--initial-branch=main']);
    const targets = files.map((file) => {
      const target = resolveInside(dir, file.path);
      const segments = relative(dir, target).split(sep);
      if (segments.some((segment) => segment.trim().toLowerCase() === '.git')) {
        throw new ValidationError('Refusing to write into .git');
      }
      return { target, content: file.content };
    });
    // Snapshot semantics: remove everything from the previous export except .git.
    for (const entry of await readdir(dir)) {
      if (entry !== '.git') await rm(join(dir, entry), { recursive: true, force: true });
    }
    for (const { target, content } of targets) {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
    }
    await this.git(dir, ['add', '--all']);
    await this.git(dir, [
      'commit',
      '--quiet',
      '--allow-empty',
      `--author=${AUTHOR}`,
      '-m',
      message,
    ]);
    const { stdout } = await this.git(dir, ['rev-parse', 'HEAD']);
    return { repository: `local:${repository}`, commitSha: stdout.trim(), files: files.length };
  }

  private async git(cwd: string, args: string[]): Promise<{ stdout: string }> {
    try {
      return await run(
        'git',
        [
          '-c',
          'core.hooksPath=/dev/null',
          '-c',
          'user.name=AI App Builder',
          '-c',
          'user.email=noreply@aab.local',
          '-c',
          'commit.gpgsign=false',
          '-c',
          'core.fsmonitor=false',
          '-c',
          'core.sshCommand=/bin/false',
          '-c',
          'protocol.allow=never',
          '-c',
          'core.symlinks=false',
          ...args,
        ],
        {
          cwd,
          timeout: GIT_TIMEOUT_MS,
          maxBuffer: 1024 * 1024,
          env: {
            PATH: process.env.PATH ?? '/usr/bin:/bin',
            HOME: this.root,
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: '/dev/null',
            GIT_TERMINAL_PROMPT: '0',
          },
        },
      );
    } catch (error) {
      const code = (error as { code?: string }).code;
      throw new ExternalProviderError(
        code === 'ENOENT' ? 'git is not installed on the API host' : `git ${args[0]} failed`,
        { retryable: false, cause: error },
      );
    }
  }
}
