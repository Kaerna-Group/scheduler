import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { AccessGate } from '@/components/access/access-gate';
import { ScheduleApp } from '@/components/schedule/schedule-app';
import '@/app/globals.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AccessGate>
      <ScheduleApp />
    </AccessGate>
  </StrictMode>,
);
