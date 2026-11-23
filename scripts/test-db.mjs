// Shared Vitest globalSetup for integration tests: run them against a dedicated
// database `<db>_test` (created if missing, migrated) so they never share outbox
// rows or data with a running `pnpm dev` stack on the same PostgreSQL server.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const databasePkg = `${root}packages/database/`;
const require = createRequire(`${databasePkg}package.json`);

/** DATABASE_URL from the workspace .env with `_test` appended to the database name. */
export function testDatabaseUrl() {
  require('@aab/shared-config').loadWorkspaceDotenv(root);
  const base = process.env.TEST_BASE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL is required for integration tests');
  const url = new URL(base);
  if (!url.pathname.endsWith('_test')) url.pathname = `${url.pathname}_test`;
  return url.toString();
}

export default async function setup() {
  const url = testDatabaseUrl();
  const dbName = decodeURIComponent(new URL(url).pathname.slice(1));
  if (!/^[A-Za-z0-9_]+_test$/.test(dbName)) {
    throw new Error(`refusing to prepare non-test database "${dbName}"`);
  }
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const { Client } = require('pg');
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (exists.rowCount === 0) await client.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await client.end();
  }
  const migrate = spawnSync(`${databasePkg}node_modules/.bin/prisma`, ['migrate', 'deploy'], {
    cwd: databasePkg,
    env: { ...process.env, DATABASE_URL: url },
    encoding: 'utf8',
  });
  if (migrate.status !== 0) {
    throw new Error(
      `prisma migrate deploy failed for ${dbName}:\n${migrate.stderr || migrate.stdout}`,
    );
  }
}
