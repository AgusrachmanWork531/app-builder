import { defineConfig } from 'vitest/config';
import { swcPlugin } from './vitest.config';

// Integration tests need PostgreSQL + Redis (`pnpm infra:up && pnpm db:migrate`).
export default defineConfig({
  plugins: [swcPlugin],
  test: {
    include: ['test/**/*.int-spec.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
