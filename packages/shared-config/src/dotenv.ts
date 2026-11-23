import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config } from 'dotenv';

/** Locate the monorepo root (directory containing pnpm-workspace.yaml). */
export function findWorkspaceRoot(start: string = process.cwd()): string | undefined {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Load `<workspace root>/.env` for local development. Variables already set in
 * the process environment always win, so deployments configure via real env.
 */
export function loadWorkspaceDotenv(start?: string): void {
  const root = findWorkspaceRoot(start);
  if (!root) return;
  const file = join(root, '.env');
  if (existsSync(file)) config({ path: file, override: false, quiet: true });
}
