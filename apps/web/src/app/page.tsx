'use client';

import Link from 'next/link';
import { EmptyState, ErrorMessage, Loading, MockNotice, formatDate } from '@/components/ui';
import { useApi } from '@/hooks/use-api';
import { api } from '@/services/api-client';

export default function DashboardPage() {
  const projects = useApi(() => api.listProjects(1, 20), []);

  return (
    <>
      <MockNotice />
      <section className="card">
        <div className="row-between">
          <h1>Projects</h1>
          <Link href="/projects/new" className="button">
            New project
          </Link>
        </div>
        {projects.loading && <Loading />}
        {projects.error && <ErrorMessage message={projects.error} />}
        {projects.data && projects.data.data.length === 0 && (
          <EmptyState>
            No projects yet. <Link href="/projects/new">Create your first project</Link>.
          </EmptyState>
        )}
        {projects.data && projects.data.data.length > 0 && (
          <ul className="list" aria-label="Projects">
            {projects.data.data.map((project) => (
              <li key={project.id}>
                <Link href={`/projects/${project.id}`}>{project.name}</Link>
                <span className="muted small"> · updated {formatDate(project.updatedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
