import { loadWorkspaceDotenv } from '@aab/shared-config';
import { defineConfig } from '@playwright/test';

loadWorkspaceDotenv();

/**
 * E2E runs an isolated stack (API :4100, web :3100, own queue prefix and its own
 * database `<db>_e2e`, migrated and seeded automatically) from the built apps,
 * so it never collides with `pnpm dev` and never calls a paid LLM
 * (LLM_PROVIDER is forced to mock regardless of .env).
 *
 * Prerequisites: PostgreSQL + Redis running and `pnpm build`.
 */
const API_PORT = '4100';
const WEB_PORT = '3100';

/** Same server as DATABASE_URL, separate database `<name>_e2e` (see e2e/start-backend.mjs). */
function e2eDatabaseUrl(): string {
  const url = new URL(process.env.DATABASE_URL ?? 'postgresql://aab:aab@localhost:5432/aab');
  url.pathname = `${url.pathname.replace(/^\//, '')}_e2e`.replace(/^/, '/');
  return url.toString();
}

const shared = {
  NODE_ENV: 'test',
  LLM_PROVIDER: 'mock',
  QUEUE_PREFIX: 'aab-e2e',
  LOG_LEVEL: 'warn',
  DATABASE_URL: e2eDatabaseUrl(),
};

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    channel: 'chrome',
    headless: true,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      // API + worker in one process group (the worker has no HTTP port to probe).
      command: 'node e2e/start-backend.mjs',
      url: `http://localhost:${API_PORT}/health/ready`,
      env: { ...shared, API_PORT, MOCK_STEP_DELAY_MS: '300' },
      reuseExistingServer: false,
      // Covers DB recreate + migrations + seed + API boot on a cold machine.
      timeout: 120_000,
    },
    {
      command: 'node scripts/next.mjs start',
      url: `http://localhost:${WEB_PORT}/login`,
      env: {
        ...shared,
        NODE_ENV: 'production',
        WEB_PORT,
        API_INTERNAL_URL: `http://localhost:${API_PORT}`,
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
