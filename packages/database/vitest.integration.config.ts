import { defineConfig } from 'vitest/config';

// Requires PostgreSQL with migrations applied (`pnpm infra:up && pnpm db:migrate`).
export default defineConfig({
  test: {
    include: ['test/**/*.int-spec.ts'],
    testTimeout: 30_000,
    fileParallelism: false,
  },
});
