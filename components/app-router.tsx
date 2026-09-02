import { lazy, Suspense } from 'react';
import { ChangeHistoryPage } from '@/components/history/change-history-page';
import { ImportGuidePage } from '@/components/schedule/import-guide-page';
import { ScheduleApp } from '@/components/schedule/schedule-app';
import { SettingsPage } from '@/components/settings/settings-page';
import { useAppLocation } from '@/hooks/use-app-location';
import { pagePath } from '@/lib/schedule/location';

const AdminPage = lazy(() =>
  import('@/components/admin/admin-page').then((module) => ({
    default: module.AdminPage,
  })),
);

export function AppRouter() {
  const path = pagePath(useAppLocation());
  if (path === '/import') return <ImportGuidePage />;
  if (path === '/changes') return <ChangeHistoryPage />;
  if (path === '/settings') return <SettingsPage />;
  if (path === '/admin')
    return (
      <Suspense
        fallback={
          <output className="block p-8">Loading administration…</output>
        }
      >
        <AdminPage />
      </Suspense>
    );
  return <ScheduleApp />;
}
