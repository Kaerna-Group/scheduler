import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { AccessGate } from '@/components/access/access-gate';
import { AppRouter } from '@/components/app-router';
import '@/app/globals.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AccessGate>
      <AppRouter />
    </AccessGate>
  </StrictMode>,
);
