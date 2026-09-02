import { useState } from 'react';
import {
  ArrowLeft,
  LayoutDashboard,
  ListChecks,
  Server,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SemesterManagement } from '@/components/settings/semester-management';
import { useAdmin } from '@/hooks/use-admin';
import { usePreferences } from '@/hooks/use-preferences';
import { useTheme } from '@/hooks/use-theme';
import { AuditEntries, AuditLog } from './audit-log';
import { TokenDialog } from './user-dialogs';
import { UsersPanel } from './users-panel';

const tabs = [
  ['overview', 'Overview', LayoutDashboard],
  ['users', 'Users', Users],
  ['audit', 'Audit', ListChecks],
  ['system', 'System', Server],
] as const;
type Tab = (typeof tabs)[number][0];

export function AdminPage() {
  const admin = useAdmin();
  const { preferences } = usePreferences();
  useTheme(preferences.appearance);
  const [tab, setTab] = useState<Tab>('overview');
  const [token, setToken] = useState('');
  const [remember, setRemember] = useState(false);
  const [semesterNotice, setSemesterNotice] = useState('');
  const overview = admin.overview;
  const enabled = admin.online && !admin.saving && !admin.credential;
  return (
    <main className="min-h-screen bg-background pb-16 text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <a
            href="#/"
            className="inline-flex items-center gap-2 text-sm font-medium"
          >
            <ArrowLeft className="size-4" />
            Back to schedule
          </a>
          {overview && (
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span>
                Authenticated: <strong>{overview.actor.displayName}</strong> (
                {overview.actor.role}) · r{overview.revision}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={!enabled || admin.loading}
                onClick={() => void admin.refresh()}
              >
                {admin.loading ? 'Refreshing…' : 'Refresh'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={admin.saving}
                onClick={admin.logout}
              >
                End session
              </Button>
            </div>
          )}
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-4 py-7 sm:px-6">
        <div className="mb-6">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-accent">
            <ShieldCheck className="size-4" />
            Administration
          </p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight">
            Admin panel
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Server-verified access. Administrative data stays in memory; writes
            are never queued offline.
          </p>
        </div>
        {!admin.online && (
          <output className="mb-4 block rounded-xl bg-warning-soft p-4 text-sm text-warning-foreground">
            Offline. The current snapshot may be stale. All administrative
            writes are disabled.
          </output>
        )}
        {admin.error && (
          <p
            role="alert"
            className="mb-4 rounded-xl bg-destructive-soft p-4 text-sm text-destructive-foreground"
          >
            {admin.error}
          </p>
        )}
        {!overview ? (
          <section className="max-w-lg rounded-2xl border border-border bg-card p-5">
            <h2 className="text-lg font-semibold">Verify admin access</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              The site PIN and selected profile do not grant admin access. Enter
              the edit token of an active administrator.
            </p>
            {!admin.remoteConfigured && (
              <p className="mt-3 text-sm text-warning-foreground">
                Backend URL is not configured. Set VITE_SCHEDULE_API_URL and
                rebuild.
              </p>
            )}
            <form
              className="mt-5 space-y-4"
              onSubmit={async (event) => {
                event.preventDefault();
                const credential = token;
                setToken('');
                await admin.authenticate(credential, remember);
              }}
            >
              <label
                htmlFor="admin-login-token"
                className="block text-sm font-medium"
              >
                Admin edit token
                <Input
                  id="admin-login-token"
                  type="password"
                  autoComplete="off"
                  required
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  className="mt-2"
                />
              </label>
              <label
                htmlFor="admin-remember"
                className="flex items-center gap-2 text-sm"
              >
                <input
                  id="admin-remember"
                  type="checkbox"
                  checked={remember}
                  onChange={(event) => setRemember(event.target.checked)}
                />
                Remember my own token on this device
              </label>
              <p className="text-xs text-muted-foreground">
                Optional local storage. Use only on a trusted device. Ending the
                session clears admin data, but does not remove a previously
                saved token; remove saved tokens in Settings.
              </p>
              <Button
                type="submit"
                disabled={
                  admin.loading || !admin.online || !admin.remoteConfigured
                }
              >
                {admin.loading ? 'Verifying…' : 'Verify token'}
              </Button>
            </form>
          </section>
        ) : (
          <div className="grid items-start gap-6 lg:grid-cols-[210px_minmax(0,1fr)]">
            <nav
              aria-label="Admin sections"
              className="sticky top-2 z-20 flex gap-1 overflow-x-auto rounded-2xl border border-border bg-card/95 p-2 backdrop-blur-lg lg:top-6 lg:flex-col"
            >
              {tabs.map(([id, label, Icon]) => (
                <button
                  key={id}
                  type="button"
                  aria-current={tab === id ? 'page' : undefined}
                  className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-3 text-left text-sm font-medium ${tab === id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
                  onClick={() => setTab(id)}
                >
                  <Icon className="size-4" />
                  {label}
                </button>
              ))}
            </nav>
            <div className="min-w-0">
              {tab === 'overview' && (
                <section className="space-y-5">
                  <div>
                    <h2 className="text-xl font-semibold">Overview</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Current semester:{' '}
                      {overview.semester?.title ?? 'Not configured'} · schema{' '}
                      {overview.schema.current ?? 'missing'} / expected{' '}
                      {overview.schema.expected}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {Object.entries(overview.statistics).map(
                      ([name, count]) => (
                        <div
                          key={name}
                          className="rounded-2xl border border-border bg-card p-4"
                        >
                          <p className="text-xs capitalize text-muted-foreground">
                            {name.replace(/([A-Z])/g, ' $1')}
                          </p>
                          <p className="mt-2 text-2xl font-semibold tabular-nums">
                            {count}
                          </p>
                        </div>
                      ),
                    )}
                  </div>
                  {overview.diagnostics.some((item) => item.level !== 'ok') && (
                    <button
                      type="button"
                      className="w-full rounded-xl bg-warning-soft p-4 text-left text-sm text-warning-foreground"
                      onClick={() => setTab('system')}
                    >
                      System diagnostics need attention. Review details →
                    </button>
                  )}
                  <div className="rounded-2xl border border-border bg-card p-5">
                    <h3 className="font-semibold">Recent changes</h3>
                    <AuditEntries entries={overview.recentAudit} />
                    <Button variant="outline" onClick={() => setTab('audit')}>
                      Open audit log
                    </Button>
                  </div>
                </section>
              )}
              {tab === 'users' && (
                <UsersPanel admin={admin} overview={overview} />
              )}
              {tab === 'audit' && (
                <AuditLog
                  overview={overview}
                  data={admin.audit}
                  loading={admin.auditLoading}
                  online={admin.online}
                  load={admin.loadAudit}
                />
              )}
              {tab === 'system' && (
                <section className="space-y-5">
                  <h2 className="text-xl font-semibold">System</h2>
                  <div className="rounded-2xl border border-border bg-card p-5">
                    <h3 className="font-semibold">Health and schema</h3>
                    <dl className="mt-3 space-y-2 text-sm">
                      <div className="flex justify-between gap-3">
                        <dt>API</dt>
                        <dd>
                          {!admin.online
                            ? 'Offline'
                            : admin.backendAvailable
                              ? 'Online'
                              : 'Unavailable / unconfirmed'}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt>Google Sheets</dt>
                        <dd>
                          {admin.online && admin.backendAvailable
                            ? 'Available at last check'
                            : 'Last snapshot only'}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt>Last successful check</dt>
                        <dd>
                          {admin.lastVerifiedAt
                            ? new Date(admin.lastVerifiedAt).toLocaleString()
                            : 'Never'}
                        </dd>
                      </div>
                    </dl>
                    <p className="mt-2 text-sm">
                      Revision {overview.revision} · schema{' '}
                      {overview.schema.current ?? 'missing'} / expected{' '}
                      {overview.schema.expected}
                    </p>
                    <ul className="mt-4 space-y-2">
                      {overview.diagnostics.map((item) => (
                        <li
                          key={item.code}
                          className={`rounded-xl p-3 text-sm ${item.level === 'ok' ? 'bg-success-soft text-success-foreground' : item.level === 'error' ? 'bg-destructive-soft text-destructive-foreground' : 'bg-warning-soft text-warning-foreground'}`}
                        >
                          <strong>
                            {item.level.toUpperCase()} · {item.code}
                          </strong>
                          <span className="mt-1 block">{item.message}</span>
                        </li>
                      ))}
                    </ul>
                    {overview.schema.current !== overview.schema.expected && (
                      <p className="mt-4 text-sm">
                        An administrator must run{' '}
                        <code>upgradeSchedulerSchema()</code> in the Apps Script
                        editor. This page never runs migrations automatically.
                      </p>
                    )}
                  </div>
                  <div className="rounded-2xl border border-border bg-card p-5">
                    <h3 className="font-semibold">Tables</h3>
                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                      {overview.tables.map((table) => (
                        <div
                          key={table.name}
                          className="flex justify-between gap-2 border-b border-border py-2"
                        >
                          <dt>{table.name}</dt>
                          <dd className="tabular-nums">{table.rows}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                  <div className="rounded-2xl border border-border bg-card p-5">
                    <h3 className="mb-4 font-semibold">Semesters</h3>
                    <SemesterManagement
                      semesters={overview.semesters}
                      currentSemesterId={overview.semester?.id ?? ''}
                      revision={overview.revision}
                      token={admin.verifiedToken}
                      enabled={
                        enabled &&
                        overview.schema.current === overview.schema.expected
                      }
                      execute={(operation) => admin.mutate(() => operation())}
                      onRefresh={() => void admin.refresh()}
                      onSelect={(id) =>
                        setSemesterNotice(
                          `Semester ${id}. To view its timetable, use the semester selector on the schedule page.`,
                        )
                      }
                    />
                    <output className="mt-3 block text-xs">
                      {semesterNotice}
                    </output>
                  </div>
                </section>
              )}
            </div>
          </div>
        )}
      </div>
      {overview && admin.credential && (
        <TokenDialog
          key={admin.credential.token}
          credential={admin.credential}
          dismiss={admin.dismissCredential}
        />
      )}
    </main>
  );
}
