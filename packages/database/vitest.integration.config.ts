import { defineConfig } from 'vitest/config';
import { testDatabaseUrl } from '../../scripts/test-db.mjs';

// Requires PostgreSQL with migrations applied (`pnpm infra:up && pnpm db:migrate`).
export default defineConfig({
  test: {
    include: ['test/**/*.int-spec.ts'],
    // Dedicated <db>_test database (created + migrated by the global setup).
    globalSetup: ['../../scripts/test-db.mjs'],
    env: { DATABASE_URL: testDatabaseUrl() },
    testTimeout: 30_000,
    fileParallelism: false,
  },
});
