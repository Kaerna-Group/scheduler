import { build, preview } from 'vite';

// Never inherit the real Sheets URL from .env or the shell. Isolated output also
// cannot accidentally replace dist/ or be uploaded by the deployment workflow.
process.env.VITE_SCHEDULE_API_URL = 'https://scheduler.test/exec';
await build({ mode: 'e2e', build: { outDir: '.e2e-dist' } });
await preview({
  mode: 'e2e',
  build: { outDir: '.e2e-dist' },
  preview: { host: '127.0.0.1', port: 4179, strictPort: true },
});
