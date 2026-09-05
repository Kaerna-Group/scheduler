#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const result = spawnSync(
  process.execPath,
  [
    '--experimental-strip-types',
    '--disable-warning=ExperimentalWarning',
    fileURLToPath(new URL('../cli/main.ts', import.meta.url)),
    ...process.argv.slice(2),
  ],
  { stdio: 'inherit', windowsHide: true },
);
if (result.error)
  process.stdout.write(
    JSON.stringify({
      ok: false,
      error: {
        code: 'CLI_START_FAILED',
        message:
          'Could not start Scheduler CLI. Node.js 22.13 or newer is required.',
      },
    }) + '\n',
  );
process.exitCode = result.status ?? 1;
