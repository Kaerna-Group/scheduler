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
import { useTheme } from '@/hooks/use-theme';
import {
  clearScheduleCache,
  forgetAllEditTokens,
  getStoredEditToken,
} from '@/lib/schedule/repository';
import { darkThemeIds, lightThemeIds, themeById, themes, type ThemeMode } from '@/lib/theme/theme-registry';
import { PREFERENCES_KEY, type SchedulerPreferences } from '@/lib/theme/theme-storage';

const sections = [
  ['appearance', 'Оформлення', Brush],
  ['schedule', 'Вигляд розкладу', CalendarCog],
  ['sync', 'Користувач і синхронізація', RefreshCw],
  ['privacy', 'Дані та приватність', ShieldCheck],
  ['about', 'Про застосунок', Info],
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
  const { preferences, setPreferences, resetPreferences, themeId } = useTheme();
  const { schedule, selectedUser, selectUser, source, loading, error, refresh, remoteConfigured, lastSync } = useSchedule();
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [notice, setNotice] = useState('');
  const selectedUserName = schedule.users.find((user) => user.slug === selectedUser)?.displayName ?? schedule.user.displayName;
  const hasToken = Boolean(getStoredEditToken(selectedUser));

  const updateAppearance = (patch: Partial<SchedulerPreferences['appearance']>) => setPreferences((current) => ({ ...current, appearance: { ...current.appearance, ...patch } }));
  const updateSchedule = (patch: Partial<SchedulerPreferences['schedule']>) => setPreferences((current) => ({ ...current, schedule: { ...current.schedule, ...patch } }));
  const notify = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(''), 2200); };
  const sourceLabel = source === 'remote' ? 'Remote · Google Sheets' : source === 'cache' ? 'Кеш цього пристрою' : 'Локальний приклад';
  const formattedSync = useMemo(() => lastSync ? new Intl.DateTimeFormat('uk-UA', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(lastSync)) : 'Ще не виконувалась', [lastSync]);

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
      notify('Edit token забуто');
    } else if (confirmAction === 'cache') {
      clearScheduleCache();
      notify('Кеш розкладу очищено');
    } else if (confirmAction === 'reset') {
      resetPreferences();
      notify('Налаштування скинуто');
    } else if (confirmAction === 'device') {
      clearScheduleCache();
      forgetAllEditTokens();
      try {
        ['schedule_access_v1', PREFERENCES_KEY, 'scheduler_selected_user_v1', 'scheduler_selected_week_v1', 'scheduler_subject_filter_v1'].forEach((key) => localStorage.removeItem(key));
      } catch { /* storage may be unavailable */ }
      window.location.hash = '#/';
      window.location.reload();
    }
    setConfirmAction(null);
  }

  const confirmCopy = confirmAction === 'device'
    ? ['Забути цей пристрій?', 'Буде видалено PIN-доступ, оформлення, параметри вигляду, вибраного користувача, edit token і кеш. Дані в Google Sheets не зміняться.']
    : confirmAction === 'cache'
      ? ['Очистити кеш?', 'Локальна копія розкладу й список користувачів буде видалено. Remote-дані не зміняться.']
      : confirmAction === 'token'
        ? ['Забути edit token?', 'Усі збережені на цьому пристрої edit token буде видалено. Для наступного імпорту їх потрібно буде ввести знову.']
        : ['Скинути налаштування?', 'Оформлення та параметри вигляду повернуться до стандартних. Розклад, кеш, доступ і token залишаться.'];

  return (
    <main className="relative min-h-screen overflow-hidden bg-background pb-24 text-foreground">
      <div className="pointer-events-none fixed inset-0" aria-hidden="true"><div className="absolute -right-24 -top-32 size-[420px] rounded-full bg-glow-a/50 blur-3xl" /><div className="absolute -left-32 top-[45%] size-[360px] rounded-full bg-glow-b/45 blur-3xl" /></div>
      <header className="relative border-b border-border/80 bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <a href="#/" className="inline-flex h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold text-foreground hover:bg-muted"><ArrowLeft className="size-4" /> До розкладу</a>
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><UserRound className="size-4" /><span className="font-semibold text-foreground">{selectedUserName}</span></div>
        </div>
      </header>

      <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-accent">Локально на пристрої</p><h1 className="mt-2 text-4xl font-semibold tracking-[-0.055em] sm:text-5xl">Налаштування</h1><p className="mt-3 text-sm text-muted-foreground">Зміни зберігаються на цьому пристрої. Синхронізація розкладу працює окремо.</p></div>

        <nav className="sticky top-3 z-30 mb-5 flex gap-2 overflow-x-auto rounded-[18px] border border-border bg-background/90 p-2 backdrop-blur-xl lg:hidden" aria-label="Розділи налаштувань">
          {sections.map(([id, label]) => <button key={id} type="button" onClick={() => scrollToSection(id)} className="shrink-0 rounded-xl px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground">{label}</button>)}
        </nav>

        <div className="grid items-start gap-7 lg:grid-cols-[230px_minmax(0,840px)]">
          <aside className="sticky top-6 hidden rounded-[22px] border border-border bg-card p-3 lg:block">
            <nav className="space-y-1" aria-label="Розділи налаштувань">{sections.map(([id, label, Icon]) => <button key={id} type="button" onClick={() => scrollToSection(id)} className="flex w-full items-center gap-3 rounded-[13px] px-3 py-2.5 text-left text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"><Icon className="size-4" />{label}</button>)}</nav>
          </aside>

          <div className="space-y-5">
            <SettingsSection id="appearance" title="Оформлення" icon={Brush}>
              <SettingRow title="Режим" description="Світла, темна тема або автоматичне перемикання разом із системою.">
                <div className="flex rounded-full border border-border bg-secondary p-1">{([['light', 'Світлі'], ['dark', 'Темні'], ['system', 'Як у системі']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => selectMode(value)} className={`rounded-full px-3 py-2 text-xs font-semibold transition ${preferences.appearance.mode === value ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{label}</button>)}</div>
              </SettingRow>

              {preferences.appearance.mode === 'system' && <div className="grid gap-3 border-b border-border py-4 sm:grid-cols-2">
                <div className="text-xs font-semibold"><span>Світла тема</span><Select value={preferences.appearance.systemLightThemeId} onValueChange={(value) => value && updateAppearance({ systemLightThemeId: value as typeof preferences.appearance.systemLightThemeId })}><SelectTrigger aria-label="Світла системна тема" className="mt-2 h-10 w-full bg-background"><SelectValue /></SelectTrigger><SelectContent>{lightThemeIds.map((id) => <SelectItem key={id} value={id}>{themeById.get(id)?.name}</SelectItem>)}</SelectContent></Select></div>
                <div className="text-xs font-semibold"><span>Темна тема</span><Select value={preferences.appearance.systemDarkThemeId} onValueChange={(value) => value && updateAppearance({ systemDarkThemeId: value as typeof preferences.appearance.systemDarkThemeId })}><SelectTrigger aria-label="Темна системна тема" className="mt-2 h-10 w-full bg-background"><SelectValue /></SelectTrigger><SelectContent>{darkThemeIds.map((id) => <SelectItem key={id} value={id}>{themeById.get(id)?.name}</SelectItem>)}</SelectContent></Select></div>
              </div>}

              <div className="py-4"><div className="mb-3 text-sm font-semibold">Палітра</div><div role="radiogroup" aria-label="Тема оформлення" className="grid gap-3 sm:grid-cols-2">{themes.filter((theme) => preferences.appearance.mode === 'system' || theme.mode === preferences.appearance.mode).map((theme) => <ThemeCard key={theme.id} theme={theme} selected={themeId === theme.id} onSelect={() => selectTheme(theme)} />)}</div></div>
              <SettingRow title="Зменшити рух"><Select value={preferences.appearance.reducedMotion} onValueChange={(value) => value && updateAppearance({ reducedMotion: value as typeof preferences.appearance.reducedMotion })}><SelectTrigger className="h-10 min-w-44 bg-background"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="system">Як у системі</SelectItem><SelectItem value="reduce">Увімкнено</SelectItem><SelectItem value="allow">Вимкнено</SelectItem></SelectContent></Select></SettingRow>
            </SettingsSection>

            <SettingsSection id="schedule" title="Вигляд розкладу" icon={CalendarCog}>
              <SettingRow title="Початковий вигляд"><Select value={preferences.schedule.defaultView} onValueChange={(value) => value && updateSchedule({ defaultView: value as typeof preferences.schedule.defaultView })}><SelectTrigger className="h-10 min-w-44 bg-background"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="today">Сьогодні</SelectItem><SelectItem value="week">Тиждень</SelectItem><SelectItem value="subjects">Предмети</SelectItem></SelectContent></Select></SettingRow>
              <SettingRow title="Початковий тиждень"><Select value={preferences.schedule.initialWeek} onValueChange={(value) => value && updateSchedule({ initialWeek: value as typeof preferences.schedule.initialWeek })}><SelectTrigger className="h-10 min-w-44 bg-background"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="current">Поточний</SelectItem><SelectItem value="last-opened">Останній відкритий</SelectItem></SelectContent></Select></SettingRow>
              <SettingRow title="Порожні дні"><Switch checked={preferences.schedule.showEmptyDays} onCheckedChange={(checked) => updateSchedule({ showEmptyDays: checked })} /></SettingRow>
              <SettingRow title="Щільність карток"><Select value={preferences.schedule.density} onValueChange={(value) => value && updateSchedule({ density: value as typeof preferences.schedule.density })}><SelectTrigger className="h-10 min-w-44 bg-background"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="comfortable">Звичайна</SelectItem><SelectItem value="compact">Компактна</SelectItem></SelectContent></Select></SettingRow>
              <SettingRow title="Підсвічувати конфлікти"><Switch checked={preferences.schedule.highlightConflicts} onCheckedChange={(checked) => updateSchedule({ highlightConflicts: checked })} /></SettingRow>
              <SettingRow title="Показувати суботу" description="Якщо вимкнено, порожня субота буде прихована."><Switch checked={preferences.schedule.showSaturday} onCheckedChange={(checked) => updateSchedule({ showSaturday: checked })} /></SettingRow>
              <SettingRow title="Запам’ятовувати фільтр дисципліни"><Switch checked={preferences.schedule.rememberSubjectFilter} onCheckedChange={(checked) => updateSchedule({ rememberSubjectFilter: checked })} /></SettingRow>
            </SettingsSection>

            <SettingsSection id="sync" title="Користувач і синхронізація" icon={RefreshCw}>
              <SettingRow title="Розклад за замовчуванням"><Select value={selectedUser} onValueChange={(value) => value && selectUser(value)}><SelectTrigger className="h-10 min-w-52 bg-background"><SelectValue>{selectedUserName}</SelectValue></SelectTrigger><SelectContent>{schedule.users.map((user) => <SelectItem key={user.id} value={user.slug}>{user.displayName}</SelectItem>)}</SelectContent></Select></SettingRow>
              <SettingRow title="Джерело даних"><span className="rounded-full bg-secondary px-3 py-2 text-xs font-semibold">{sourceLabel}</span></SettingRow>
              <SettingRow title="Остання синхронізація" description={`Revision ${schedule.revision}`}><span className="text-xs font-medium text-muted-foreground">{formattedSync}</span></SettingRow>
              <SettingRow title="Оновлювати при відкритті"><Switch checked={preferences.schedule.refreshOnOpen} onCheckedChange={(checked) => updateSchedule({ refreshOnOpen: checked })} /></SettingRow>
              <div className="pt-4"><Button onClick={() => void refresh()} disabled={!remoteConfigured || loading} className="h-10 rounded-full px-4"><RefreshCw className={loading ? 'animate-spin' : ''} />{loading ? 'Оновлюю…' : 'Оновити зараз'}</Button>{!remoteConfigured && <p className="mt-2 text-xs text-muted-foreground">Remote API не налаштовано. Скористайся <a className="underline" href="#/import">інструкцією імпорту</a>.</p>}{error && <p className="mt-2 text-xs text-destructive-foreground">{error}</p>}</div>
            </SettingsSection>

            <SettingsSection id="privacy" title="Дані та приватність" icon={ShieldCheck}>
              <SettingRow title="Персональний edit token" description="Сам token ніколи не показується на сторінці."><span className={`rounded-full px-3 py-2 text-xs font-semibold ${hasToken ? 'bg-success-soft text-success-foreground' : 'bg-secondary text-muted-foreground'}`}>{hasToken ? 'Збережено на пристрої' : 'Не збережено'}</span></SettingRow>
              <SettingRow title="Забути edit token"><Button variant="outline" disabled={!hasToken} onClick={() => setConfirmAction('token')}><KeyRound />Забути</Button></SettingRow>
              <SettingRow title="Очистити кеш розкладу" description="Remote-дані в Google Sheets не видаляються."><Button variant="outline" onClick={() => setConfirmAction('cache')}><Database />Очистити</Button></SettingRow>
              <SettingRow title="Заблокувати зараз"><Button variant="outline" onClick={lockAccess}><LockKeyhole />Заблокувати</Button></SettingRow>
              <SettingRow title="Забути цей пристрій" description="Видаляє всі локальні налаштування, token, кеш і PIN-доступ."><Button variant="destructive" onClick={() => setConfirmAction('device')}><Trash2 />Забути</Button></SettingRow>
            </SettingsSection>

            <SettingsSection id="about" title="Про застосунок" icon={Info}>
              <SettingRow title="Версія"><span className="font-mono text-xs text-muted-foreground">frontend 0.1.0 · preferences schema 1</span></SettingRow>
              <SettingRow title="Семестр"><span className="text-xs font-medium text-muted-foreground">{schedule.semester.title} · revision {schedule.revision}</span></SettingRow>
              <SettingRow title="Посилання"><div className="flex flex-wrap justify-end gap-2"><a className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-2 text-xs font-semibold hover:bg-muted" href="https://github.com/Kaerna-Group/scheduler" target="_blank" rel="noreferrer">GitHub <ExternalLink className="size-3.5" /></a><a className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-2 text-xs font-semibold hover:bg-muted" href="#/import">Інструкція імпорту</a></div></SettingRow>
              <div className="rounded-[16px] bg-info-soft p-4 text-xs leading-6 text-info-foreground">Тема, вигляд і доступ зберігаються лише на цьому пристрої. Спільний розклад зберігається в Google Sheets і завантажується через Apps Script.</div>
            </SettingsSection>

            <div className="flex flex-col items-start justify-between gap-4 rounded-[22px] border border-border bg-card p-5 sm:flex-row sm:items-center"><div><div className="text-sm font-semibold">Стандартні налаштування</div><div className="mt-1 text-xs text-muted-foreground">Не видаляє розклад, кеш, доступ або edit token.</div></div><Button variant="outline" onClick={() => setConfirmAction('reset')}><RotateCcw />Скинути налаштування</Button></div>
          </div>
        </div>
      </div>

      {notice && <output className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground shadow-lg">{notice}</output>}

      <AlertDialog open={confirmAction !== null} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{confirmCopy[0]}</AlertDialogTitle><AlertDialogDescription>{confirmCopy[1]}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Скасувати</AlertDialogCancel><AlertDialogAction onClick={executeConfirmedAction} className={confirmAction === 'device' ? 'bg-destructive text-primary-foreground' : ''}>Підтвердити</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
