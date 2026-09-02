import { lazy, StrictMode, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { AccessGate } from '@/components/access/access-gate';
import { ChangeHistoryPage } from '@/components/history/change-history-page';
import { ImportGuidePage } from '@/components/schedule/import-guide-page';
import { ScheduleApp } from '@/components/schedule/schedule-app';
import { SettingsPage } from '@/components/settings/settings-page';
import '@/app/globals.css';

const AdminPage = lazy(() => import('@/components/admin/admin-page').then((module) => ({ default: module.AdminPage })));

function AppRouter() {
  const [hash, setHash] = useState(window.location.hash);

  useEffect(() => {
    const handleHashChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  if (hash === '#/import') return <ImportGuidePage />;
  if (hash === '#/changes') return <ChangeHistoryPage />;
  if (hash === '#/settings') return <SettingsPage />;
  if (hash === '#/admin') return <Suspense fallback={<output className="block p-8">Loading administration…</output>}><AdminPage /></Suspense>;
  return <ScheduleApp />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AccessGate>
      <AppRouter />
    </AccessGate>
  </StrictMode>,
);
