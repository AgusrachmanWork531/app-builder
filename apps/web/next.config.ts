import { loadWorkspaceDotenv } from '@aab/shared-config';
import type { NextConfig } from 'next';

loadWorkspaceDotenv();
const apiInternalUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Same-origin proxy: the browser only talks to the web origin, so the
  // httpOnly session cookie works for fetch and EventSource (SSE) alike.
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${apiInternalUrl}/api/v1/:path*` }];
  },
};

export default nextConfig;
