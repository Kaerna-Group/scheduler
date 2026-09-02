import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { AccessGate } from '@/components/access/access-gate';
import { AppRouter } from '@/components/app-router';
import { PwaProvider } from '@/components/pwa/pwa-provider';
import { createPwaClient } from '@/lib/pwa/client';
import '@/app/globals.css';

const pwa = createPwaClient({
  enabled: import.meta.env.PROD,
  baseUrl: import.meta.env.BASE_URL,
});
pwa.start();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PwaProvider client={pwa}>
      <AccessGate>
        <AppRouter />
      </AccessGate>
    </PwaProvider>
  </StrictMode>,
);
