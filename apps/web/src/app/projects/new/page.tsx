'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { ErrorMessage, MockNotice } from '@/components/ui';
import { errorMessage } from '@/hooks/use-api';
import { ApiClientError, api } from '@/services/api-client';

export default function NewProjectPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    try {
      const project = await api.createProject(name);
      await api.createRequirement(project.id, prompt);
      router.push(`/projects/${project.id}`);
    } catch (e) {
      if (e instanceof ApiClientError && e.isUnauthenticated) {
        router.replace('/login');
        return;
      }
      setError(errorMessage(e));
      setSubmitting(false);
    }
  }

  return (
    <>
      <MockNotice />
      <section className="card">
        <h1>New project</h1>
        <form onSubmit={(e) => void onSubmit(e)} className="form">
          <label htmlFor="name">Project name</label>
          <input
            id="name"
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <label htmlFor="prompt">What should the app do?</label>
          <textarea
            id="prompt"
            required
            minLength={10}
            maxLength={5000}
            rows={6}
            aria-describedby="prompt-help"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <p id="prompt-help" className="muted small">
            The mock analyzer recognizes todo/task, blog and inventory apps; anything else yields a
            generic specification.
          </p>
          {error && <ErrorMessage message={error} />}
          <button type="submit" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create project'}
          </button>
        </form>
      </section>
    </>
  );
}
