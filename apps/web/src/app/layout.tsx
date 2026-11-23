import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI App Builder Engine',
  description: 'Create projects, submit requirements and watch builds run (mock mode).',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <a href="/" className="brand">
            AI App Builder Engine
          </a>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
