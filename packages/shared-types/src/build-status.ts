/**
 * Workflow statuses for a build job. PostgreSQL (`build_jobs.status`) is the
 * source of truth; these literals must stay in sync with the Prisma enum
 * `BuildStatus` (verified by a test in @aab/database).
 */
export const BUILD_STATUSES = [
  'PENDING',
  'QUEUED',
  'PLANNING',
  'GENERATING',
  'TESTING',
  'REPAIRING',
  'WAITING_APPROVAL',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;

export type BuildStatus = (typeof BUILD_STATUSES)[number];

export const TERMINAL_BUILD_STATUSES: ReadonlySet<BuildStatus> = new Set<BuildStatus>([
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

export function isBuildStatus(value: unknown): value is BuildStatus {
  return typeof value === 'string' && (BUILD_STATUSES as readonly string[]).includes(value);
}

export function isTerminalBuildStatus(status: BuildStatus): boolean {
  return TERMINAL_BUILD_STATUSES.has(status);
}
