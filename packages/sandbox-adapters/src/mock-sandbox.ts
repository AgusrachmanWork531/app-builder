import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import type {
  CollectedArtifact,
  CommandResult,
  SandboxProvider,
  SandboxWorkspace,
} from '@aab/agent-core';
import { ResourceLimitError, SandboxError } from '@aab/shared-types';
import { assertWorkspaceId, resolveInside, toPosix } from './safe-path';

/** Walk up from `path` to the closest directory that exists on disk. */
async function nearestExistingAncestor(path: string): Promise<string> {
  let current = path;
  for (;;) {
    if (
      await lstat(current).then(
        () => true,
        () => false,
      )
    )
      return current;
    const parent = dirname(current);
    if (parent === current) return current;
    current = parent;
  }
}

export interface SandboxLimits {
  maxFileBytes: number;
  maxFiles: number;
  maxTotalBytes: number;
}

export const DEFAULT_LIMITS: SandboxLimits = {
  maxFileBytes: 1024 * 1024,
  maxFiles: 500,
  maxTotalBytes: 10 * 1024 * 1024,
};

const CONTENT_TYPES: Record<string, string> = {
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.ts': 'text/x-typescript',
  '.tsx': 'text/x-typescript',
  '.js': 'text/javascript',
  '.prisma': 'text/plain',
  '.sql': 'application/sql',
  '.txt': 'text/plain',
};

/**
 * MOCK sandbox for development. It only reads and writes files inside a
 * per-workspace directory under the artifact storage root. It never executes
 * commands: real execution requires a hardened container/microVM provider
 * (see docs/security/sandbox.md).
 */
export class MockSandboxProvider implements SandboxProvider {
  readonly name = 'mock';
  readonly isMock = true;
  private readonly root: string;

  constructor(
    storageRoot: string,
    private readonly limits: SandboxLimits = DEFAULT_LIMITS,
  ) {
    this.root = resolve(storageRoot);
  }

  async createWorkspace(workspaceId: string): Promise<SandboxWorkspace> {
    assertWorkspaceId(workspaceId);
    const dir = join(this.root, 'workspaces', workspaceId);
    await mkdir(dir, { recursive: true });
    return new MockSandboxWorkspace(workspaceId, await realpath(dir), this.limits);
  }
}

class MockSandboxWorkspace implements SandboxWorkspace {
  constructor(
    readonly id: string,
    private readonly dir: string,
    private readonly limits: SandboxLimits,
  ) {}

  async writeFile(path: string, content: string): Promise<void> {
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > this.limits.maxFileBytes) {
      throw new ResourceLimitError(`File exceeds ${this.limits.maxFileBytes} bytes`, {
        details: { path },
      });
    }
    const target = resolveInside(this.dir, path);
    const existing = await this.listFiles();
    const isNew = !existing.includes(toPosix(path));
    if (isNew && existing.length >= this.limits.maxFiles) {
      throw new ResourceLimitError(`Workspace file count limit (${this.limits.maxFiles}) reached`);
    }
    const total = await this.totalBytes(existing);
    if (total + bytes > this.limits.maxTotalBytes) {
      throw new ResourceLimitError(`Workspace size limit (${this.limits.maxTotalBytes}) reached`);
    }
    // Check the nearest existing ancestor BEFORE mkdir so a symlinked
    // directory can never cause directories to be created outside the root.
    await this.assertRealInside(await nearestExistingAncestor(dirname(target)));
    await mkdir(dirname(target), { recursive: true });
    await this.assertRealInside(dirname(target));
    await this.assertNotSymlink(target);
    // O_NOFOLLOW: refuse to write through a symlink swapped in after the checks.
    const handle = await open(
      target,
      constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
      0o644,
    ).catch((error: unknown) => {
      throw new SandboxError('Cannot write workspace file', { cause: error });
    });
    try {
      await handle.writeFile(content, 'utf8');
    } finally {
      await handle.close();
    }
  }

  async readFile(path: string): Promise<string> {
    const target = resolveInside(this.dir, path);
    await this.assertNotSymlink(target);
    const real = await this.assertRealInside(target);
    return readFile(real, 'utf8');
  }

  /** Reject symlinks and non-regular files at `path` (absent paths are allowed). */
  private async assertNotSymlink(path: string): Promise<void> {
    const info = await lstat(path).catch(() => undefined);
    if (info && (info.isSymbolicLink() || !info.isFile())) {
      throw new SandboxError('Workspace path is not a regular file');
    }
  }

  /** Resolve symlinks and ensure the real location is still inside the workspace. */
  private async assertRealInside(path: string): Promise<string> {
    const real = await realpath(path).catch(() => {
      throw new SandboxError('File not found in workspace');
    });
    if (real !== this.dir && !real.startsWith(this.dir + sep)) {
      throw new SandboxError('Path resolves outside the workspace root');
    }
    return real;
  }

  async listFiles(): Promise<string[]> {
    const entries = await readdir(this.dir, { recursive: true, withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => toPosix(join(entry.parentPath, entry.name).slice(this.dir.length + 1)))
      .sort();
  }

  async executeCommand(command: string): Promise<CommandResult> {
    throw new SandboxError(
      'Command execution is disabled in the mock sandbox; configure a hardened sandbox provider',
      { details: { command: command.slice(0, 100) } },
    );
  }

  async collectArtifacts(): Promise<CollectedArtifact[]> {
    const files = await this.listFiles();
    return Promise.all(
      files.map(async (path) => {
        const content = await readFile(resolveInside(this.dir, path));
        return {
          path,
          storageKey: `workspaces/${this.id}/${path}`,
          sizeBytes: content.byteLength,
          sha256: createHash('sha256').update(content).digest('hex'),
          contentType: CONTENT_TYPES[extname(path)] ?? 'application/octet-stream',
        };
      }),
    );
  }

  /** No processes run in the mock sandbox. */
  async terminate(): Promise<void> {}

  /** Mock workspaces hold only collected artifacts; nothing transient to remove. */
  async cleanup(): Promise<void> {}

  private async totalBytes(files: string[]): Promise<number> {
    const sizes = await Promise.all(
      files.map(async (file) => (await stat(resolveInside(this.dir, file))).size),
    );
    return sizes.reduce((sum, size) => sum + size, 0);
  }
}
