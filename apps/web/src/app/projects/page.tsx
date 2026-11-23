'use client';

import Link from 'next/link';
import { useState } from 'react';
import { EmptyState, ErrorMessage, Loading, formatDate } from '@/components/ui';
import { useApi } from '@/hooks/use-api';
import { api } from '@/services/api-client';
import type { ProjectListStatus } from '@/types/api';

const PAGE_SIZE = 10;

export default function ProjectsPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<ProjectListStatus>('active');
  const projects = useApi(() => api.listProjects(page, PAGE_SIZE, status), [page, status]);
  const pagination = projects.data?.pagination;

  return (
    <section className="card">
      <div className="row-between">
        <h1>Projects</h1>
        <Link href="/projects/new" className="button">
          New project
        </Link>
      </div>
      <div className="actions">
        <label htmlFor="status-filter" className="small">
          Show
        </label>
        <select
          id="status-filter"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as ProjectListStatus);
            setPage(1);
          }}
        >
          <option value="active">Active</option>
          <option value="archived">Archived</option>
          <option value="all">All</option>
        </select>
      </div>
      {projects.loading && <Loading />}
      {projects.error && <ErrorMessage message={projects.error} />}
      {projects.data && projects.data.data.length === 0 && (
        <EmptyState>No {status === 'all' ? '' : status} projects.</EmptyState>
      )}
      {projects.data && projects.data.data.length > 0 && (
        <table>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Status</th>
              <th scope="col">Updated</th>
            </tr>
          </thead>
          <tbody>
            {projects.data.data.map((project) => (
              <tr key={project.id}>
                <td>
                  <Link href={`/projects/${project.id}`}>{project.name}</Link>
                </td>
                <td>{project.status}</td>
                <td>{formatDate(project.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {pagination && pagination.totalPages > 1 && (
        <nav className="actions" aria-label="Pagination">
          <button
            type="button"
            className="secondary"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </button>
          <span className="small">
            Page {pagination.page} of {pagination.totalPages} ({pagination.total} projects)
          </span>
          <button
            type="button"
            className="secondary"
            disabled={page >= pagination.totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </nav>
      )}
    </section>
  );
}
