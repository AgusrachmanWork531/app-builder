'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ErrorMessage, Loading, MockNotice, StatusBadge, formatDate } from '@/components/ui';
import { errorMessage } from '@/hooks/use-api';
import { TERMINAL_STATUSES, useBuildStream } from '@/hooks/use-build-stream';
import { api } from '@/services/api-client';
import type { BuildStatus } from '@/types/api';

const CANCELLABLE: BuildStatus[] = [
  'PENDING',
  'QUEUED',
  'PLANNING',
  'GENERATING',
  'TESTING',
  'REPAIRING',
  'WAITING_APPROVAL',
];
const RETRYABLE: BuildStatus[] = ['FAILED', 'CANCELLED'];

export default function BuildPage() {
  const { id } = useParams<{ id: string }>();
  const stream = useBuildStream(id);
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [exported, setExported] = useState<string>();

  async function act(action: () => Promise<unknown>) {
    setActing(true);
    setActionError(undefined);
    try {
      await action();
      await stream.refresh();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setActing(false);
    }
  }

  if (stream.loading) return <Loading />;
  if (stream.error || !stream.build) {
    return <ErrorMessage message={stream.error ?? 'Not found'} />;
  }
  const b = stream.build;
  const canCancel = CANCELLABLE.includes(b.status) && !b.cancelRequested;
  const canRetry = RETRYABLE.includes(b.status) && b.attempt < b.maxAttempts;

  return (
    <>
      <MockNotice />
      <section className="card" aria-live="polite">
        <p className="small">
          <Link href={`/projects/${b.projectId}`}>← Project</Link>
        </p>
        <h1>
          Build {b.id.slice(0, 8)} <StatusBadge status={b.status} />
        </h1>
        <p className="muted small" data-testid="live-state">
          Updates: {stream.live}
        </p>
        <dl className="facts">
          <dt>Current step</dt>
          <dd data-testid="current-step">{b.currentStep ?? '—'}</dd>
          <dt>Attempt</dt>
          <dd>
            {b.attempt}/{b.maxAttempts}
          </dd>
          <dt>Repair rounds</dt>
          <dd>{b.repairAttempts}</dd>
          <dt>Simulation</dt>
          <dd>{b.options.simulateFailure ?? 'none'}</dd>
          <dt>Started</dt>
          <dd>{formatDate(b.startedAt)}</dd>
          <dt>Completed</dt>
          <dd>{formatDate(b.completedAt)}</dd>
        </dl>
        {b.cancelRequested && !TERMINAL_STATUSES.includes(b.status) && (
          <p className="muted">Cancellation requested; waiting for the worker to stop…</p>
        )}
        {b.error && (
          <ErrorMessage message={`${b.error.code}: ${b.error.message ?? 'Build failed'}`} />
        )}
        <div className="actions">
          {canCancel && (
            <button
              type="button"
              className="secondary"
              disabled={acting}
              onClick={() => void act(() => api.cancelBuild(b.id))}
            >
              Cancel build
            </button>
          )}
          {canRetry && (
            <button
              type="button"
              disabled={acting}
              onClick={() => void act(() => api.retryBuild(b.id))}
            >
              Retry (attempt {b.attempt + 1})
            </button>
          )}
        </div>
        {actionError && <ErrorMessage message={actionError} />}
      </section>

      {b.plan && (
        <section className="card">
          <h2>Execution plan</h2>
          <p>{b.plan.summary}</p>
          <ol>
            {b.plan.tasks.map((task) => (
              <li key={task.key}>
                {task.title} <span className="muted small">({task.status})</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {b.artifacts.length > 0 && (
        <section className="card">
          <h2>Artifacts</h2>
          <ul className="list" aria-label="Artifacts">
            {b.artifacts.map((a) => (
              <li key={a.id}>
                <a href={api.artifactDownloadUrl(b.id, a.id)} download>
                  <code>{a.path}</code>
                </a>{' '}
                <span className="muted small">
                  {a.sizeBytes} B · {a.isMock ? 'MOCK' : 'generated'}
                  {a.expiresAt && ` · expires ${formatDate(a.expiresAt)}`}
                </span>
              </li>
            ))}
          </ul>
          {b.status === 'COMPLETED' && (
            <div className="actions">
              <button
                type="button"
                className="secondary"
                disabled={acting}
                onClick={() =>
                  void act(async () => {
                    const result = await api.exportBuildToGit(b.id);
                    setExported(`${result.repository} @ ${result.commitSha.slice(0, 10)}`);
                  })
                }
              >
                Export to git (local)
              </button>
              {exported && (
                <span className="small" role="status">
                  Committed to {exported}
                </span>
              )}
            </div>
          )}
        </section>
      )}

      <section className="card">
        <h2>Event history</h2>
        <ol className="events" aria-label="Build events">
          {stream.events.map((event) => (
            <li key={event.sequence}>
              <span className="muted small">
                #{event.sequence} · attempt {event.attempt} · {formatDate(event.createdAt)}
              </span>{' '}
              <strong>{event.type}</strong>
              {event.toStatus && <> → {event.toStatus}</>} — {event.message}
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
