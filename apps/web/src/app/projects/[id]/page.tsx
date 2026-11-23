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
import { ProjectSettings } from '@/features/projects/project-settings';
import { RequirementForm } from '@/features/projects/requirement-form';
import { errorMessage, useApi } from '@/hooks/use-api';
import { api } from '@/services/api-client';
import type { SimulateFailure } from '@/types/api';

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const project = useApi(() => api.getProject(id), [id]);
  const requirements = useApi(() => api.listRequirements(id), [id]);
  const builds = useApi(() => api.listBuilds(id), [id]);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string>();
  const [simulateFailure, setSimulateFailure] = useState<SimulateFailure>('none');

  async function startBuild() {
    setStarting(true);
    setStartError(undefined);
    try {
      const build = await api.createBuild(id, crypto.randomUUID(), simulateFailure);
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
  const archived = project.data.status === 'ARCHIVED';

  return (
    <>
      <MockNotice />
      <section className="card">
        <ProjectSettings project={project.data} onChanged={project.reload} />
        {currentBuild && (
          <p>
            Current build: <StatusBadge status={currentBuild.status} />{' '}
            <Link href={`/builds/${currentBuild.id}`}>view</Link>
          </p>
        )}
        <div className="actions">
          <label htmlFor="simulate" className="small">
            Mock scenario
          </label>
          <select
            id="simulate"
            value={simulateFailure}
            onChange={(e) => setSimulateFailure(e.target.value as SimulateFailure)}
          >
            <option value="none">Succeeds</option>
            <option value="validation-once">Fails once, repaired</option>
            <option value="validation-always">Fails after max repairs</option>
          </select>
          <button
            type="button"
            onClick={() => void startBuild()}
            disabled={starting || !latest || archived}
          >
            {starting ? 'Starting…' : 'Start mock build'}
          </button>
        </div>
        {!latest && !requirements.loading && (
          <p className="muted small">Submit a requirement before starting a build.</p>
        )}
        {startError && <ErrorMessage message={startError} />}
      </section>

      <section className="card">
        <h2>Requirements</h2>
        <RequirementForm projectId={id} disabled={archived} onCreated={requirements.reload} />
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
