'use client';

import { type FormEvent, useState } from 'react';
import { ErrorMessage, formatDate } from '@/components/ui';
import { errorMessage } from '@/hooks/use-api';
import { api } from '@/services/api-client';
import type { Project } from '@/types/api';

interface Props {
  project: Project;
  onChanged: () => Promise<void>;
}

/** Project header with inline metadata editing and archive/unarchive. */
export function ProjectSettings({ project, onChanged }: Props) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const archived = project.status === 'ARCHIVED';

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      await onChanged();
      setEditing(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function onSave(event: FormEvent) {
    event.preventDefault();
    void run(() =>
      api.updateProject(project.id, {
        name,
        description: description.trim() === '' ? null : description,
      }),
    );
  }

  if (editing) {
    return (
      <form className="form" onSubmit={onSave} aria-label="Edit project">
        <label htmlFor="project-name">Project name</label>
        <input
          id="project-name"
          required
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <label htmlFor="project-description">Description</label>
        <textarea
          id="project-description"
          rows={3}
          maxLength={2000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        {error && <ErrorMessage message={error} />}
        <div className="actions">
          <button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setError(undefined);
              setEditing(false);
            }}
          >
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <>
      <div className="row-between">
        <h1>{project.name}</h1>
        <div className="actions">
          {!archived && (
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setName(project.name);
                setDescription(project.description ?? '');
                setEditing(true);
              }}
            >
              Edit
            </button>
          )}
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() =>
              void run(() =>
                archived ? api.unarchiveProject(project.id) : api.archiveProject(project.id),
              )
            }
          >
            {archived ? 'Unarchive' : 'Archive'}
          </button>
        </div>
      </div>
      {project.description && <p>{project.description}</p>}
      <p className="muted small">
        Created {formatDate(project.createdAt)} · {project.status}
        {archived && ` since ${formatDate(project.archivedAt)}`}
      </p>
      {archived && (
        <p className="mock-notice" role="status">
          This project is archived and read-only. Unarchive it to add requirements or start builds.
        </p>
      )}
      {error && <ErrorMessage message={error} />}
    </>
  );
}
