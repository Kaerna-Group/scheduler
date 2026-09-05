#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// stdout is exclusively MCP JSON-RPC. Resolve the entry relative to this file
// so clients may launch it from any working directory, including paths with spaces.
const child = spawn(
  process.execPath,
  [
    '--experimental-strip-types',
    '--disable-warning=ExperimentalWarning',
    fileURLToPath(new URL('../mcp/main.ts', import.meta.url)),
    ...process.argv.slice(2),
  ],
  { stdio: 'inherit', windowsHide: true },
);
child.once('error', () => {
  process.stderr.write(
    'Could not start Scheduler MCP. Node.js 22.13 or newer is required.\n',
  );
  process.exitCode = 1;
});
child.once('exit', (code) => {
  process.exitCode = code ?? 1;
});
process.once('SIGINT', () => child.kill('SIGINT'));
process.once('SIGTERM', () => child.kill('SIGTERM'));
