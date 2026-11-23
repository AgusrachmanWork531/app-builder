// Runs `next <command>` with the workspace .env loaded and --port taken from WEB_PORT.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { loadWorkspaceDotenv } from '@aab/shared-config';

loadWorkspaceDotenv();
const command = process.argv[2] ?? 'dev';
const port = process.env.WEB_PORT ?? '3000';
const nextBin = createRequire(import.meta.url).resolve('next/dist/bin/next');

const child = spawn(process.execPath, [nextBin, command, '--port', port], {
  stdio: 'inherit',
  env: process.env,
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('exit', (code) => process.exit(code ?? 0));
