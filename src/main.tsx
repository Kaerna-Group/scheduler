import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { AccessGate } from '@/components/access/access-gate';
import { ImportGuidePage } from '@/components/schedule/import-guide-page';
import { ScheduleApp } from '@/components/schedule/schedule-app';
import '@/app/globals.css';

function AppRouter() {
  const [hash, setHash] = useState(window.location.hash);

  useEffect(() => {
    const handleHashChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  return hash === '#/import' ? <ImportGuidePage /> : <ScheduleApp />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AccessGate>
      <AppRouter />
    </AccessGate>
  </StrictMode>,
);
