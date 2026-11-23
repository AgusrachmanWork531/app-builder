'use client';

import Link from 'next/link';
import {
  EmptyState,
  ErrorMessage,
  Loading,
  MockNotice,
  StatusBadge,
  formatDate,
} from '@/components/ui';
import { useApi } from '@/hooks/use-api';
import { api } from '@/services/api-client';
import type { BuildStatus } from '@/types/api';

export default function DashboardPage() {
  const dashboard = useApi(() => api.dashboard(), []);

  if (dashboard.loading) return <Loading />;
  if (dashboard.error || !dashboard.data) {
    return <ErrorMessage message={dashboard.error ?? 'Dashboard unavailable'} />;
  }
  const d = dashboard.data;
  const statuses = (Object.entries(d.buildStatusSummary) as [BuildStatus, number][]).filter(
    ([, count]) => count > 0,
  );

  return (
    <>
      <MockNotice />
      <section className="stats" aria-label="Summary">
        <div className="card stat">
          <span className="stat-value" data-testid="project-count">
            {d.projectCount.active}
          </span>
          <span className="muted small">active projects</span>
        </div>
        <div className="card stat">
          <span className="stat-value">{d.projectCount.archived}</span>
          <span className="muted small">archived</span>
        </div>
        <div className="card stat stat-wide">
          <span className="muted small">Build status summary</span>
          {statuses.length === 0 ? (
            <span className="muted">No builds yet</span>
          ) : (
            <ul className="status-summary">
              {statuses.map(([status, count]) => (
                <li key={status}>
                  <StatusBadge status={status} /> {count}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="card">
        <div className="row-between">
          <h2>Recent projects</h2>
          <div className="actions">
            <Link href="/projects">All projects</Link>
            <Link href="/projects/new" className="button">
              New project
            </Link>
          </div>
        </div>
        {d.recentProjects.length === 0 ? (
          <EmptyState>
            No projects yet. <Link href="/projects/new">Create your first project</Link>.
          </EmptyState>
        ) : (
          <ul className="list" aria-label="Recent projects">
            {d.recentProjects.map((project) => (
              <li key={project.id}>
                <Link href={`/projects/${project.id}`}>{project.name}</Link>
                <span className="muted small"> · updated {formatDate(project.updatedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Recent builds</h2>
        {d.recentBuilds.length === 0 ? (
          <EmptyState>No builds yet.</EmptyState>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">Build</th>
                <th scope="col">Project</th>
                <th scope="col">Status</th>
                <th scope="col">Created</th>
              </tr>
            </thead>
            <tbody>
              {d.recentBuilds.map((build) => (
                <tr key={build.id}>
                  <td>
                    <Link href={`/builds/${build.id}`}>{build.id.slice(0, 8)}</Link>
                  </td>
                  <td>
                    <Link href={`/projects/${build.projectId}`}>{build.projectName}</Link>
                  </td>
                  <td>
                    <StatusBadge status={build.status} />
                  </td>
                  <td>{formatDate(build.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
