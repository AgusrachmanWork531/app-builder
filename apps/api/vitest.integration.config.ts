import { defineConfig } from 'vitest/config';
import { testDatabaseUrl } from '../../scripts/test-db.mjs';
import { swcPlugin } from './vitest.config';

// Integration tests need PostgreSQL + Redis (`pnpm infra:up && pnpm db:migrate`).
export default defineConfig({
  plugins: [swcPlugin],
  test: {
    include: ['test/**/*.int-spec.ts'],
    // Dedicated <db>_test database (created + migrated by the global setup).
    globalSetup: ['../../scripts/test-db.mjs'],
    env: { DATABASE_URL: testDatabaseUrl() },
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
