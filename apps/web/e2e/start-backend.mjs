// Starts an isolated backend for E2E: prepares a dedicated database
// (<db>_e2e: dropped + recreated, migrated, seeded), then runs the built API and AI
// worker together. Playwright waits on the API readiness URL. Both children are
// stopped on SIGINT/SIGTERM, and the run fails loudly if either child dies.
//
// A separate database matters: outbox rows are shared by every API instance
// connected to a database, so a concurrently running `pnpm dev` API would
// otherwise dispatch E2E builds to its own queue.
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const apps = `${root}apps/`;
const databasePkg = `${root}packages/database/`;
const e2eUrl = process.env.DATABASE_URL;
if (!e2eUrl) throw new Error('DATABASE_URL is required');

/** Drop and recreate the dedicated E2E database so every run starts clean. */
async function recreateDatabase(url) {
  const target = new URL(url);
  const dbName = decodeURIComponent(target.pathname.slice(1));
  if (!/^[A-Za-z0-9_]+_e2e$/.test(dbName)) {
    // Safety: never migrate/seed/drop anything but a dedicated *_e2e database.
    throw new Error(`refusing to use non-E2E database "${dbName}" (name must end with _e2e)`);
  }
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const { Client } = createRequire(`${databasePkg}package.json`)('pg');
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await client.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await client.end();
  }
}

function runStep(label, command, args) {
  const result = spawnSync(command, args, {
    cwd: databasePkg,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: e2eUrl },
  });
  if (result.status !== 0) throw new Error(`${label} failed (exit ${result.status})`);
}

await recreateDatabase(e2eUrl);
runStep('migrate', `${databasePkg}node_modules/.bin/prisma`, ['migrate', 'deploy']);
runStep('seed', process.execPath, [`${databasePkg}dist/seed.js`]);

const children = [
  spawn(process.execPath, [`${apps}api/dist/main.js`], { stdio: 'inherit', env: process.env }),
  spawn(process.execPath, [`${apps}ai-worker/dist/main.js`], {
    stdio: 'inherit',
    env: process.env,
  }),
];

let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 5000).unref();
  Promise.all(children.map((c) => new Promise((r) => c.once('exit', r)))).then(() =>
    process.exit(code),
  );
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(0));
for (const child of children) child.on('exit', (code) => stop(code ?? 1));
