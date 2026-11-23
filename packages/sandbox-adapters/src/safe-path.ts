import { isAbsolute, normalize, relative, resolve, sep } from 'node:path';
import { SandboxError } from '@aab/shared-types';

const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function assertWorkspaceId(id: string): void {
  if (!WORKSPACE_ID_PATTERN.test(id)) {
    throw new SandboxError(`Invalid workspace id`, { details: { id } });
  }
}

/**
 * Resolve a workspace-relative path to an absolute path guaranteed to stay
 * inside `root`. Rejects absolute paths, traversal, NUL bytes and empty paths.
 */
export function resolveInside(root: string, relativePath: string): string {
  if (
    relativePath.length === 0 ||
    relativePath.length > 512 ||
    relativePath.includes('\0') ||
    isAbsolute(relativePath) ||
    /^[A-Za-z]:/.test(relativePath)
  ) {
    throw new SandboxError('Path is not an allowed workspace-relative path', {
      details: { path: relativePath.slice(0, 200) },
    });
  }
  const target = resolve(root, normalize(relativePath));
  const rel = relative(root, target);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new SandboxError('Path escapes the workspace root', {
      details: { path: relativePath.slice(0, 200) },
    });
  }
  return target;
}

/** Normalize to forward-slash form for storage and display. */
export function toPosix(path: string): string {
  return path.split(sep).join('/');
}
