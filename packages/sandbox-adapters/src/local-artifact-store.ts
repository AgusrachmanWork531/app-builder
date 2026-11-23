import { lstat, readFile, realpath, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { ArtifactStore } from '@aab/agent-core';
import { NotFoundError, SandboxError } from '@aab/shared-types';
import { resolveInside } from './safe-path';

const MAX_READ_BYTES = 10 * 1024 * 1024;

/**
 * Local-disk ArtifactStore rooted at ARTIFACT_STORAGE_PATH. Storage keys are
 * relative paths (e.g. workspaces/<id>/<file>); every access is confined to
 * the root, refuses symlinks and is size-bounded.
 */
export class LocalArtifactStore implements ArtifactStore {
  readonly name = 'local';
  private readonly root: string;

  constructor(storageRoot: string) {
    this.root = resolve(storageRoot);
  }

  async read(storageKey: string): Promise<Buffer> {
    const target = resolveInside(this.root, storageKey);
    const info = await lstat(target).catch(() => undefined);
    if (!info) throw new NotFoundError('Artifact file not found');
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new SandboxError('Artifact path is not a regular file');
    }
    if (info.size > MAX_READ_BYTES)
      throw new SandboxError('Artifact exceeds the download size limit');
    const real = await realpath(target);
    const realRoot = await realpath(this.root);
    if (!real.startsWith(realRoot + sep))
      throw new SandboxError('Artifact resolves outside storage');
    return readFile(real);
  }

  async delete(storageKey: string): Promise<void> {
    const target = resolveInside(this.root, storageKey);
    const info = await lstat(target).catch(() => undefined);
    if (!info) return;
    if (!info.isFile() && !info.isSymbolicLink()) {
      throw new SandboxError('Refusing to delete a non-file artifact path');
    }
    // rm on a symlink removes the link itself, never its target.
    await rm(target, { force: true });
  }
}
