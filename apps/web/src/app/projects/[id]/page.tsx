'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  EmptyState,
  ErrorMessage,
  Loading,
  MockNotice,
  StatusBadge,
  formatDate,
} from '@/components/ui';
import { errorMessage, useApi } from '@/hooks/use-api';
import { api } from '@/services/api-client';

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const project = useApi(() => api.getProject(id), [id]);
  const requirements = useApi(() => api.listRequirements(id), [id]);
  const builds = useApi(() => api.listBuilds(id), [id]);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string>();

  async function startBuild() {
    setStarting(true);
    setStartError(undefined);
    try {
      const build = await api.createBuild(id, crypto.randomUUID());
      router.push(`/builds/${build.id}`);
    } catch (e) {
      setStartError(errorMessage(e));
      setStarting(false);
    }
  }

  if (project.loading) return <Loading />;
  if (project.error || !project.data)
    return <ErrorMessage message={project.error ?? 'Not found'} />;
  const latest = requirements.data?.[0];
  const currentBuild = builds.data?.data[0];

  return (
    <>
      <MockNotice />
      <section className="card">
        <h1>{project.data.name}</h1>
        {project.data.description && <p>{project.data.description}</p>}
        <p className="muted small">
          Created {formatDate(project.data.createdAt)} · {project.data.status}
        </p>
        {currentBuild && (
          <p>
            Current build: <StatusBadge status={currentBuild.status} />{' '}
            <Link href={`/builds/${currentBuild.id}`}>view</Link>
          </p>
        )}
        <button type="button" onClick={() => void startBuild()} disabled={starting || !latest}>
          {starting ? 'Starting…' : 'Start mock build'}
        </button>
        {!latest && !requirements.loading && (
          <p className="muted small">Submit a requirement before starting a build.</p>
        )}
        {startError && <ErrorMessage message={startError} />}
      </section>

      <section className="card">
        <h2>Requirements</h2>
        {requirements.loading && <Loading />}
        {requirements.error && <ErrorMessage message={requirements.error} />}
        {requirements.data?.length === 0 && <EmptyState>No requirements yet.</EmptyState>}
        {requirements.data?.map((req) => (
          <article key={req.id} className="requirement">
            <h3>
              Revision {req.revision}: {req.specification.appName}
            </h3>
            <p>{req.rawPrompt}</p>
            <p className="muted small">
              Analyzer: {req.analyzer} · template:{' '}
              {req.specification.analysis.matchedTemplate ?? 'none (generic)'} · entities:{' '}
              {req.specification.entities.map((e) => e.name).join(', ')}
            </p>
            {req.specification.analysis.warnings.map((w) => (
              <p key={w} className="muted small">
                ⚠ {w}
              </p>
            ))}
          </article>
        ))}
      </section>

      <section className="card">
        <h2>Build history</h2>
        {builds.loading && <Loading />}
        {builds.error && <ErrorMessage message={builds.error} />}
        {builds.data?.data.length === 0 && <EmptyState>No builds yet.</EmptyState>}
        {builds.data && builds.data.data.length > 0 && (
          <table>
            <thead>
              <tr>
                <th scope="col">Build</th>
                <th scope="col">Status</th>
                <th scope="col">Attempt</th>
                <th scope="col">Created</th>
              </tr>
            </thead>
            <tbody>
              {builds.data.data.map((build) => (
                <tr key={build.id}>
                  <td>
                    <Link href={`/builds/${build.id}`}>{build.id.slice(0, 8)}</Link>
                  </td>
                  <td>
                    <StatusBadge status={build.status} />
                  </td>
                  <td>
                    {build.attempt}/{build.maxAttempts}
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
