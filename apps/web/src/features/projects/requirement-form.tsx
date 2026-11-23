'use client';

import { type FormEvent, useState } from 'react';
import { ErrorMessage } from '@/components/ui';
import { errorMessage } from '@/hooks/use-api';
import { api } from '@/services/api-client';

interface Props {
  projectId: string;
  disabled: boolean;
  onCreated: () => Promise<void>;
}

/** Submit a new requirement revision (the newest revision is used by builds). */
export function RequirementForm({ projectId, disabled, onCreated }: Props) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api.createRequirement(projectId, prompt);
      setPrompt('');
      await onCreated();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={(e) => void onSubmit(e)} aria-label="New requirement revision">
      <label htmlFor="new-requirement">New requirement revision</label>
      <textarea
        id="new-requirement"
        rows={3}
        minLength={10}
        maxLength={5000}
        required
        disabled={disabled}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />
      {error && <ErrorMessage message={error} />}
      <button type="submit" disabled={disabled || busy}>
        {busy ? 'Submitting…' : 'Submit revision'}
      </button>
    </form>
  );
}
