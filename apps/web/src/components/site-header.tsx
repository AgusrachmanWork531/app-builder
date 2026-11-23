'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '@/services/api-client';

export function SiteHeader() {
  const router = useRouter();
  const pathname = usePathname();

  async function logout() {
    await api.logout().catch(() => undefined);
    router.replace('/login');
  }

  return (
    <header className="site-header">
      <nav className="nav" aria-label="Main">
        <Link href="/" className="brand">
          AI App Builder Engine
        </Link>
        {pathname !== '/login' && (
          <div className="nav-actions">
            <Link href="/projects">Projects</Link>
            <Link href="/projects/new">New project</Link>
            <button type="button" className="link-button" onClick={() => void logout()}>
              Log out
            </button>
          </div>
        )}
      </nav>
    </header>
  );
}
