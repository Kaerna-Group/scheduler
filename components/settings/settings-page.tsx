import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Brush,
  CalendarCog,
  Database,
  ExternalLink,
  Info,
  KeyRound,
  LockKeyhole,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  UserRound,
} from 'lucide-react';

import { lockAccess } from '@/components/access/access-gate';
import { ThemeCard } from '@/components/settings/theme-card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useSchedule } from '@/hooks/use-schedule';
import { usePreferences } from '@/hooks/use-preferences';
import { useTheme } from '@/hooks/use-theme';
import {
  clearScheduleCache,
  forgetAllEditTokens,
  getStoredEditToken,
} from '@/lib/schedule/repository';
import { getScheduleSyncStatus } from '@/lib/schedule/sync-status';
import { darkThemeIds, lightThemeIds, themeById, themes, type ThemeMode } from '@/lib/theme/theme-registry';
import { clearAllPreferenceCaches } from '@/lib/preferences/local-storage';
import type { SchedulerPreferences } from '@/lib/preferences/types';

const sections = [
  ['appearance', 'Appearance', Brush],
  ['schedule', 'Schedule view', CalendarCog],
  ['sync', 'User and synchronization', RefreshCw],
  ['privacy', 'Data and privacy', ShieldCheck],
  ['about', 'About', Info],
] as const;

type ConfirmAction = 'token' | 'cache' | 'device' | 'reset' | null;

function SettingRow({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-b border-border py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="pr-4"><div className="text-sm font-semibold text-foreground">{title}</div>{description && <div className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">{description}</div>}</div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function SettingsSection({ id, title, icon: Icon, children }: { id: string; title: string; icon: typeof Brush; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-28 rounded-[24px] border border-border bg-card p-5 shadow-[0_14px_38px_rgb(var(--theme-shadow-color)/7%)] sm:p-6">
      <div className="mb-3 flex items-center gap-3"><span className="grid size-9 place-items-center rounded-[12px] bg-secondary text-foreground"><Icon className="size-4" /></span><h2 className="text-lg font-semibold tracking-[-0.03em]">{title}</h2></div>
      {children}
    </section>
  );
}

export function SettingsPage() {
  const { preferences, setPreferences, resetPreferences, preferencesRevision, syncStatus, syncError, hasPendingChanges } = usePreferences();
  const { themeId } = useTheme(preferences.appearance);
  const { schedule, selectedUser, selectUser, source, loading, error, refresh, remoteConfigured, lastSync, online } = useSchedule();
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [notice, setNotice] = useState('');
  const selectedUserName = schedule.users.find((user) => user.slug === selectedUser)?.displayName ?? schedule.user.displayName;
  const hasToken = Boolean(getStoredEditToken(selectedUser));
  const preferencesStatus = syncStatus === 'saving'
    ? 'Saving…'
    : syncStatus === 'saved'
      ? 'Synchronized'
      : syncStatus === 'pending'
        ? 'Unsynchronized changes'
      : syncStatus === 'error'
        ? 'Synchronization error'
        : hasToken ? 'Saved locally' : 'Local · edit token required';

  const updateAppearance = (patch: Partial<SchedulerPreferences['appearance']>) => setPreferences((current) => ({ ...current, appearance: { ...current.appearance, ...patch } }));
  const updateSchedule = (patch: Partial<SchedulerPreferences['schedule']>) => setPreferences((current) => ({ ...current, schedule: { ...current.schedule, ...patch } }));
  const notify = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(''), 2200); };
  const sourceLabel = source === 'remote' ? 'Remote · Google Sheets' : source === 'cache' ? 'Device cache' : 'Local example';
  const formattedSync = useMemo(() => lastSync ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(lastSync)) : 'Never', [lastSync]);
  const dataSyncStatus = getScheduleSyncStatus({
    online,
    remoteConfigured,
    source,
    lastSync,
    backendError: error,
    hasPendingChanges,
  });

  function scrollToSection(sectionId: string) {
    const motion = document.documentElement.dataset.reducedMotion;
    const reduceMotion = motion === 'reduce' || (motion === 'system' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    document.getElementById(sectionId)?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }

  function selectMode(mode: ThemeMode) {
    if (mode === 'system') updateAppearance({ mode });
    else {
      const candidate = themes.find((theme) => theme.mode === mode && theme.id === preferences.appearance.themeId)
        ?? themeById.get(mode === 'dark' ? preferences.appearance.systemDarkThemeId : preferences.appearance.systemLightThemeId)!;
      updateAppearance({ mode, themeId: candidate.id });
    }
  }

  function selectTheme(selectedTheme: (typeof themes)[number]) {
    if (preferences.appearance.mode === 'system') {
      updateAppearance(selectedTheme.mode === 'dark'
        ? { systemDarkThemeId: selectedTheme.id as typeof preferences.appearance.systemDarkThemeId }
        : { systemLightThemeId: selectedTheme.id as typeof preferences.appearance.systemLightThemeId });
      return;
    }
    updateAppearance({ mode: selectedTheme.mode, themeId: selectedTheme.id });
  }

  function executeConfirmedAction() {
    if (confirmAction === 'token') {
      forgetAllEditTokens();
      notify('Edit token removed');
    } else if (confirmAction === 'cache') {
      clearScheduleCache();
      notify('Schedule cache cleared');
    } else if (confirmAction === 'reset') {
      resetPreferences();
      notify('Preferences reset');
    } else if (confirmAction === 'device') {
      clearScheduleCache();
      forgetAllEditTokens();
      clearAllPreferenceCaches();
      try {
        ['schedule_access_v1', 'scheduler_selected_user_v1', 'scheduler_selected_week_v1', 'scheduler_subject_filter_v1'].forEach((key) => localStorage.removeItem(key));
      } catch { /* storage may be unavailable */ }
      window.location.hash = '#/';
      window.location.reload();
    }
    setConfirmAction(null);
  }

  const confirmCopy = confirmAction === 'device'
    ? ['Forget this device?', 'This removes PIN access, appearance and view preferences, the selected user, edit tokens, and cache. Google Sheets data will not change.']
    : confirmAction === 'cache'
      ? ['Clear the cache?', 'The local schedule copy and user list will be removed. Remote data will not change.']
      : confirmAction === 'token'
        ? ['Remove edit tokens?', 'All edit tokens saved on this device will be removed. Enter them again for the next import.']
        : ['Reset preferences?', 'Appearance and view preferences will return to defaults. The schedule, cache, access, and tokens will remain.'];

  return (
    <main className="relative min-h-screen overflow-hidden bg-background pb-24 text-foreground">
      <div className="pointer-events-none fixed inset-0" aria-hidden="true"><div className="absolute -right-24 -top-32 size-[420px] rounded-full bg-glow-a/50 blur-3xl" /><div className="absolute -left-32 top-[45%] size-[360px] rounded-full bg-glow-b/45 blur-3xl" /></div>
      <header className="relative border-b border-border/80 bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <a href="#/" className="inline-flex h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold text-foreground hover:bg-muted"><ArrowLeft className="size-4" /> Back to schedule</a>
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><UserRound className="size-4" /><span className="font-semibold text-foreground">{selectedUserName}</span></div>
        </div>
      </header>

      <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-accent">For {selectedUserName}</p><h1 className="mt-2 text-4xl font-semibold tracking-[-0.055em] sm:text-5xl">Settings</h1><p className="mt-3 text-sm text-muted-foreground">Changes apply immediately, are saved on this device, and synchronize separately for each user.</p></div>

        <nav className="sticky top-3 z-30 mb-5 flex gap-2 overflow-x-auto rounded-[18px] border border-border bg-background/90 p-2 backdrop-blur-xl lg:hidden" aria-label="Settings sections">
          {sections.map(([id, label]) => <button key={id} type="button" onClick={() => scrollToSection(id)} className="shrink-0 rounded-xl px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground">{label}</button>)}
        </nav>

        <div className="grid items-start gap-7 lg:grid-cols-[230px_minmax(0,840px)]">
          <aside className="sticky top-6 hidden rounded-[22px] border border-border bg-card p-3 lg:block">
            <nav className="space-y-1" aria-label="Settings sections">{sections.map(([id, label, Icon]) => <button key={id} type="button" onClick={() => scrollToSection(id)} className="flex w-full items-center gap-3 rounded-[13px] px-3 py-2.5 text-left text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"><Icon className="size-4" />{label}</button>)}</nav>
          </aside>

          <div className="space-y-5">
            <SettingsSection id="appearance" title="Appearance" icon={Brush}>
              <SettingRow title="Mode" description="Use a light or dark theme, or follow the system automatically.">
                <div className="flex rounded-full border border-border bg-secondary p-1">{([['light', 'Light'], ['dark', 'Dark'], ['system', 'System']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => selectMode(value)} className={`rounded-full px-3 py-2 text-xs font-semibold transition ${preferences.appearance.mode === value ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{label}</button>)}</div>
              </SettingRow>

              {preferences.appearance.mode === 'system' && <div className="grid gap-3 border-b border-border py-4 sm:grid-cols-2">
                <div className="text-xs font-semibold"><span>Light theme</span><Select value={preferences.appearance.systemLightThemeId} onValueChange={(value) => value && updateAppearance({ systemLightThemeId: value as typeof preferences.appearance.systemLightThemeId })}><SelectTrigger aria-label="System light theme" className="mt-2 h-10 w-full bg-background"><SelectValue /></SelectTrigger><SelectContent>{lightThemeIds.map((id) => <SelectItem key={id} value={id}>{themeById.get(id)?.name}</SelectItem>)}</SelectContent></Select></div>
                <div className="text-xs font-semibold"><span>Dark theme</span><Select value={preferences.appearance.systemDarkThemeId} onValueChange={(value) => value && updateAppearance({ systemDarkThemeId: value as typeof preferences.appearance.systemDarkThemeId })}><SelectTrigger aria-label="System dark theme" className="mt-2 h-10 w-full bg-background"><SelectValue /></SelectTrigger><SelectContent>{darkThemeIds.map((id) => <SelectItem key={id} value={id}>{themeById.get(id)?.name}</SelectItem>)}</SelectContent></Select></div>
              </div>}

              <div className="py-4"><div className="mb-3 text-sm font-semibold">Palette</div><div role="radiogroup" aria-label="Appearance theme" className="grid gap-3 sm:grid-cols-2">{themes.filter((theme) => preferences.appearance.mode === 'system' || theme.mode === preferences.appearance.mode).map((theme) => <ThemeCard key={theme.id} theme={theme} selected={themeId === theme.id} onSelect={() => selectTheme(theme)} />)}</div></div>
              <SettingRow title="Reduce motion"><Select value={preferences.appearance.reducedMotion} onValueChange={(value) => value && updateAppearance({ reducedMotion: value as typeof preferences.appearance.reducedMotion })}><SelectTrigger className="h-10 min-w-44 bg-background"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="system">System</SelectItem><SelectItem value="reduce">Enabled</SelectItem><SelectItem value="allow">Disabled</SelectItem></SelectContent></Select></SettingRow>
            </SettingsSection>

            <SettingsSection id="schedule" title="Schedule view" icon={CalendarCog}>
              <SettingRow title="Initial view"><Select value={preferences.schedule.defaultView} onValueChange={(value) => value && updateSchedule({ defaultView: value as typeof preferences.schedule.defaultView })}><SelectTrigger className="h-10 min-w-44 bg-background"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="today">Today</SelectItem><SelectItem value="week">Week</SelectItem><SelectItem value="subjects">Courses</SelectItem></SelectContent></Select></SettingRow>
              <SettingRow title="Initial week"><Select value={preferences.schedule.initialWeek} onValueChange={(value) => value && updateSchedule({ initialWeek: value as typeof preferences.schedule.initialWeek })}><SelectTrigger className="h-10 min-w-44 bg-background"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="current">Current</SelectItem><SelectItem value="last-opened">Last opened</SelectItem></SelectContent></Select></SettingRow>
              <SettingRow title="Empty days"><Switch checked={preferences.schedule.showEmptyDays} onCheckedChange={(checked) => updateSchedule({ showEmptyDays: checked })} /></SettingRow>
              <SettingRow title="Card density"><Select value={preferences.schedule.density} onValueChange={(value) => value && updateSchedule({ density: value as typeof preferences.schedule.density })}><SelectTrigger className="h-10 min-w-44 bg-background"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="comfortable">Comfortable</SelectItem><SelectItem value="compact">Compact</SelectItem></SelectContent></Select></SettingRow>
              <SettingRow title="Highlight conflicts"><Switch checked={preferences.schedule.highlightConflicts} onCheckedChange={(checked) => updateSchedule({ highlightConflicts: checked })} /></SettingRow>
              <SettingRow title="Show Saturday" description="When disabled, an empty Saturday is hidden."><Switch checked={preferences.schedule.showSaturday} onCheckedChange={(checked) => updateSchedule({ showSaturday: checked })} /></SettingRow>
              <SettingRow title="Remember course filter"><Switch checked={preferences.schedule.rememberSubjectFilter} onCheckedChange={(checked) => updateSchedule({ rememberSubjectFilter: checked })} /></SettingRow>
            </SettingsSection>

            <SettingsSection id="sync" title="User and synchronization" icon={RefreshCw}>
              <SettingRow title="Default schedule"><Select value={selectedUser} onValueChange={(value) => value && selectUser(value)}><SelectTrigger className="h-10 min-w-52 bg-background"><SelectValue>{selectedUserName}</SelectValue></SelectTrigger><SelectContent>{schedule.users.map((user) => <SelectItem key={user.id} value={user.slug}>{user.displayName}</SelectItem>)}</SelectContent></Select></SettingRow>
              <SettingRow title="Synchronization status"><output aria-live="polite" className={`rounded-full px-3 py-2 text-xs font-semibold ${dataSyncStatus.kind === 'current' ? 'bg-success-soft text-success-foreground' : dataSyncStatus.kind === 'unavailable' ? 'bg-destructive-soft text-destructive-foreground' : 'bg-warning-soft text-warning-foreground'}`}>{dataSyncStatus.label}</output></SettingRow>
              <SettingRow title="Data source"><span className="rounded-full bg-secondary px-3 py-2 text-xs font-semibold">{sourceLabel}</span></SettingRow>
              <SettingRow title="Last synchronization" description={`Revision ${schedule.revision}`}><span className="text-xs font-medium text-muted-foreground">{formattedSync}</span></SettingRow>
              <SettingRow title="Preferences synchronization" description={`Settings revision ${preferencesRevision}`}><span className={`rounded-full px-3 py-2 text-xs font-semibold ${syncStatus === 'error' ? 'bg-destructive-soft text-destructive-foreground' : syncStatus === 'saved' ? 'bg-success-soft text-success-foreground' : syncStatus === 'pending' ? 'bg-warning-soft text-warning-foreground' : 'bg-secondary text-muted-foreground'}`}>{preferencesStatus}</span></SettingRow>
              {syncError && <div className="rounded-[14px] bg-destructive-soft p-3 text-xs text-destructive-foreground">{syncError} Changes remain in the local cache and retry automatically when the connection returns.</div>}
              <SettingRow title="Refresh on open"><Switch checked={preferences.schedule.refreshOnOpen} onCheckedChange={(checked) => updateSchedule({ refreshOnOpen: checked })} /></SettingRow>
              <div className="pt-4"><Button onClick={() => void refresh()} disabled={!remoteConfigured || loading || !online} className="h-10 rounded-full px-4"><RefreshCw className={loading ? 'animate-spin' : ''} />{loading ? 'Refreshing…' : 'Refresh now'}</Button>{!remoteConfigured && <p className="mt-2 text-xs text-muted-foreground">The remote API is not configured. See the <a className="underline" href="#/import">import guide</a>.</p>}{error && online && <p className="mt-2 text-xs text-destructive-foreground">{error}</p>}</div>
            </SettingsSection>

            <SettingsSection id="privacy" title="Data and privacy" icon={ShieldCheck}>
              <SettingRow title="Personal edit token" description="The token itself is never displayed on this page."><span className={`rounded-full px-3 py-2 text-xs font-semibold ${hasToken ? 'bg-success-soft text-success-foreground' : 'bg-secondary text-muted-foreground'}`}>{hasToken ? 'Saved on device' : 'Not saved'}</span></SettingRow>
              <SettingRow title="Remove edit tokens"><Button variant="outline" disabled={!hasToken} onClick={() => setConfirmAction('token')}><KeyRound />Remove</Button></SettingRow>
              <SettingRow title="Clear schedule cache" description="Remote data in Google Sheets is not removed."><Button variant="outline" onClick={() => setConfirmAction('cache')}><Database />Clear</Button></SettingRow>
              <SettingRow title="Lock now"><Button variant="outline" onClick={lockAccess}><LockKeyhole />Lock</Button></SettingRow>
              <SettingRow title="Forget this device" description="Removes all local preferences, tokens, cache, and PIN access."><Button variant="destructive" onClick={() => setConfirmAction('device')}><Trash2 />Forget</Button></SettingRow>
            </SettingsSection>

            <SettingsSection id="about" title="About" icon={Info}>
              <SettingRow title="Version"><span className="font-mono text-xs text-muted-foreground">frontend 0.1.0 · preferences schema 1</span></SettingRow>
              <SettingRow title="Semester"><span className="text-xs font-medium text-muted-foreground">{schedule.semester.title} · revision {schedule.revision}</span></SettingRow>
              <SettingRow title="Links"><div className="flex flex-wrap justify-end gap-2"><a className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-2 text-xs font-semibold hover:bg-muted" href="https://github.com/Kaerna-Group/scheduler" target="_blank" rel="noreferrer">GitHub <ExternalLink className="size-3.5" /></a><a className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-2 text-xs font-semibold hover:bg-muted" href="#/import">Import guide</a></div></SettingRow>
              <div className="rounded-[16px] bg-info-soft p-4 text-xs leading-6 text-info-foreground">Theme and view preferences synchronize through Google Sheets and are cached on this device for fast startup. PIN access and edit tokens remain local.</div>
            </SettingsSection>

            <div className="flex flex-col items-start justify-between gap-4 rounded-[22px] border border-border bg-card p-5 sm:flex-row sm:items-center"><div><div className="text-sm font-semibold">Default preferences</div><div className="mt-1 text-xs text-muted-foreground">Does not remove the schedule, cache, access, or edit tokens.</div></div><Button variant="outline" onClick={() => setConfirmAction('reset')}><RotateCcw />Reset preferences</Button></div>
          </div>
        </div>
      </div>

      {notice && <output className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground shadow-lg">{notice}</output>}

      <AlertDialog open={confirmAction !== null} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{confirmCopy[0]}</AlertDialogTitle><AlertDialogDescription>{confirmCopy[1]}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={executeConfirmedAction} className={confirmAction === 'device' ? 'bg-destructive text-primary-foreground' : ''}>Confirm</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
