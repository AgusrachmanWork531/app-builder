import { getApiReadiness } from '@/services/system';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const readiness = await getApiReadiness();

  return (
    <section className="card">
      <h1>AI App Builder Engine</h1>
      <p className="muted">
        Mock mode: builds are simulated and every artifact is labeled as mock.
      </p>
      <p>
        API status:{' '}
        {readiness.ok ? (
          <strong className="status-ok">ready</strong>
        ) : (
          <strong className="status-error">unavailable ({readiness.reason})</strong>
        )}
      </p>
    </section>
  );
}
