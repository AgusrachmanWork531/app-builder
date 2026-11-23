import { defineConfig } from 'vitest/config';

// Requires PostgreSQL + Redis (`pnpm infra:up && pnpm db:migrate`).
export default defineConfig({
  test: {
    include: ['test/**/*.int-spec.ts'],
    testTimeout: 60_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
