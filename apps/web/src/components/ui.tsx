import type { BuildStatus } from '@/types/api';

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <p className="muted" role="status" aria-live="polite">
      {label}
    </p>
  );
}

export function ErrorMessage({ message }: { message: string }) {
  return (
    <p className="error-box" role="alert">
      {message}
    </p>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="empty">{children}</p>;
}

const STATUS_TONE: Record<BuildStatus, 'ok' | 'error' | 'active' | 'idle'> = {
  PENDING: 'idle',
  QUEUED: 'idle',
  PLANNING: 'active',
  GENERATING: 'active',
  TESTING: 'active',
  REPAIRING: 'active',
  WAITING_APPROVAL: 'idle',
  COMPLETED: 'ok',
  FAILED: 'error',
  CANCELLED: 'idle',
};

export function StatusBadge({ status }: { status: BuildStatus }) {
  return (
    <span className={`badge badge-${STATUS_TONE[status]}`} data-testid="build-status">
      {status}
    </span>
  );
}

export function MockNotice() {
  return (
    <p className="mock-notice">
      Mock mode: requirements are analyzed by a deterministic template matcher and builds are
      simulated. No AI model is called; artifacts are labeled as mock.
    </p>
  );
}

export function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : '—';
}
