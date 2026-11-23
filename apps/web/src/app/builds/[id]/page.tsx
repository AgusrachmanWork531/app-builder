'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect } from 'react';
import { ErrorMessage, Loading, MockNotice, StatusBadge, formatDate } from '@/components/ui';
import { useApi } from '@/hooks/use-api';
import { api } from '@/services/api-client';
import type { BuildStatus } from '@/types/api';

const TERMINAL: BuildStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED'];
const POLL_MS = 1000;

export default function BuildPage() {
  const { id } = useParams<{ id: string }>();
  const build = useApi(() => api.getBuild(id), [id]);
  const events = useApi(() => api.getBuildEvents(id), [id]);
  const status = build.data?.status;
  const done = status ? TERMINAL.includes(status) : false;
  const reloadBuild = build.reload;
  const reloadEvents = events.reload;

  // Poll until the build reaches a terminal state.
  useEffect(() => {
    if (!status || done) return;
    const timer = setInterval(() => {
      void reloadBuild();
      void reloadEvents();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [status, done, reloadBuild, reloadEvents]);

  // The terminal status and its final event may land between two polls: fetch
  // events once more after the build becomes terminal so history is complete.
  useEffect(() => {
    if (done) void reloadEvents();
  }, [done, reloadEvents]);

  if (build.loading) return <Loading />;
  if (build.error || !build.data) return <ErrorMessage message={build.error ?? 'Not found'} />;
  const b = build.data;

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
        <dl className="facts">
          <dt>Current step</dt>
          <dd data-testid="current-step">{b.currentStep ?? '—'}</dd>
          <dt>Attempt</dt>
          <dd>
            {b.attempt}/{b.maxAttempts}
          </dd>
          <dt>Started</dt>
          <dd>{formatDate(b.startedAt)}</dd>
          <dt>Completed</dt>
          <dd>{formatDate(b.completedAt)}</dd>
        </dl>
        {b.error && (
          <ErrorMessage message={`${b.error.code}: ${b.error.message ?? 'Build failed'}`} />
        )}
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
              <li key={a.path}>
                <code>{a.path}</code>{' '}
                <span className="muted small">
                  {a.sizeBytes} B · {a.isMock ? 'MOCK' : 'generated'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h2>Event history</h2>
        {events.error && <ErrorMessage message={events.error} />}
        <ol className="events" aria-label="Build events">
          {events.data?.map((event) => (
            <li key={event.sequence}>
              <span className="muted small">
                #{event.sequence} · {formatDate(event.createdAt)}
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
