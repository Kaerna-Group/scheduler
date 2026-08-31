import { useMemo, useState } from 'react';
import { Download, FileJson2, KeyRound, Save, Settings2, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { exportSchedule, validateScheduleImport } from '@/lib/schedule/import';
import {
  getStoredEditToken, importPersonalSchedule, storeEditToken, updateEnrollments,
} from '@/lib/schedule/repository';
import type { UserSchedule } from '@/lib/schedule/types';

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ManageScheduleDialog({
  schedule,
  remoteConfigured,
  onSchedule,
  onRefresh,
}: {
  schedule: UserSchedule;
  remoteConfigured: boolean;
  onSchedule: (value: UserSchedule) => void;
  onRefresh: () => Promise<void> | void;
}) {
  const exported = useMemo(() => exportSchedule(schedule), [schedule]);
  const [token, setToken] = useState(() => getStoredEditToken(schedule.user.slug));
  const [importText, setImportText] = useState(() => JSON.stringify(exported, null, 2));
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [allowSharedUpdates, setAllowSharedUpdates] = useState(false);
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [groups, setGroups] = useState<Record<string, number | undefined>>(() =>
    Object.fromEntries(schedule.subjects.map((subject) => [subject.id, subject.selectedGroup])),
  );

  const rememberToken = (value: string) => {
    setToken(value);
    storeEditToken(schedule.user.slug, value.trim());
  };

  const parseImport = () => {
    setMessage('');
    try {
      const result = validateScheduleImport(JSON.parse(importText), schedule.semester.weeksCount);
      setErrors(result.errors);
      return result.value;
    } catch {
      setErrors(['JSON має синтаксичну помилку.']);
      return undefined;
    }
  };

  const previewOrImport = async (dryRun: boolean) => {
    const value = parseImport();
    if (!value) return;
    if (!remoteConfigured) {
      setErrors(['Remote API ще не налаштовано. JSON перевірено лише локально.']);
      return;
    }
    if (!token.trim()) {
      setErrors(['Введи персональний edit token.']);
      return;
    }

    setBusy(true);
    try {
      const response = await importPersonalSchedule({
        userSlug: schedule.user.slug, token: token.trim(), schedule: value, mode, baseRevision: schedule.revision,
        allowSharedUpdates, dryRun,
      });
      setErrors([]);
      if (response.schedule) onSchedule(response.schedule);
      setMessage(dryRun
        ? `Перевірка успішна: заплановано змін — ${Array.isArray(response.plan) ? response.plan.length : 0}.`
        : `Імпорт завершено. Revision ${response.revision}.`);
      if (!dryRun) await onRefresh();
    } catch (error) {
      const details = error && typeof error === 'object' && 'details' in error ? (error as { details?: unknown }).details : undefined;
      setErrors([
        error instanceof Error ? error.message : 'Не вдалося виконати імпорт.',
        ...(Array.isArray(details) ? details.map((item) => typeof item === 'string' ? item : JSON.stringify(item)) : []),
      ]);
    } finally {
      setBusy(false);
    }
  };

  const saveGroups = async () => {
    if (!remoteConfigured) {
      setErrors(['Remote API ще не налаштовано.']);
      return;
    }
    if (!token.trim()) {
      setErrors(['Введи персональний edit token у вкладці Import / Export.']);
      return;
    }
    setBusy(true);
    setErrors([]);
    try {
      const response = await updateEnrollments({
        userSlug: schedule.user.slug,
        token: token.trim(),
        semesterId: schedule.semester.id,
        baseRevision: schedule.revision,
        enrollments: schedule.subjects.map((subject) => ({
          externalCode: subject.externalCode ?? subject.id,
          ...(groups[subject.id] === undefined ? {} : { selectedGroup: groups[subject.id] }),
        })),
      });
      onSchedule(response.schedule);
      setMessage(`Групи збережено. Revision ${response.revision}.`);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : 'Не вдалося зберегти групи.']);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" className="h-10 rounded-full border-[#dedacf] bg-white/80 px-3.5 text-xs font-semibold shadow-none" />}>
        <Settings2 className="size-3.5" />
        <span className="hidden sm:inline">Керування</span>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] w-[min(760px,calc(100%-24px))] max-w-none overflow-y-auto rounded-[26px] border-[#dedad0] p-5 sm:p-7">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold tracking-[-0.035em]">Керування розкладом</DialogTitle>
          <DialogDescription>Дисципліни, персональні групи та обмін стандартним JSON.</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="subjects" className="mt-2">
          <TabsList className="h-10 w-full rounded-[14px] bg-[#f1efe9]">
            <TabsTrigger value="subjects" className="rounded-[11px]">Мої дисципліни</TabsTrigger>
            <TabsTrigger value="import" className="rounded-[11px]">Import / Export</TabsTrigger>
          </TabsList>

          <TabsContent value="subjects" className="mt-5">
            <div className="space-y-2.5">
              {schedule.subjects.map((subject) => (
                <div key={subject.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[17px] border border-[#e5e1d7] bg-[#faf9f5] px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="size-2.5 rounded-full" style={{ backgroundColor: subject.color }} />
                      <span className="truncate text-sm font-semibold text-[#30383a]">{subject.name}</span>
                    </div>
                    <div className="mt-1 pl-[18px] text-[11px] text-[#99988f]">Код: {subject.externalCode ?? '—'}</div>
                  </div>
                  {subject.availableGroups?.length ? (
                    <select
                      aria-label={`Група для ${subject.name}`}
                      value={groups[subject.id] ?? ''}
                      onChange={(event) => setGroups((current) => ({ ...current, [subject.id]: Number(event.target.value) }))}
                      className="h-9 rounded-xl border border-[#ddd9cf] bg-white px-3 text-xs font-semibold outline-none focus:border-[#d98a5b]"
                    >
                      {subject.availableGroups.map((group) => <option key={group} value={group}>Група {group}</option>)}
                    </select>
                  ) : <span className="text-xs text-[#aaa79f]">Без групи</span>}
                </div>
              ))}
            </div>
            <Button onClick={saveGroups} disabled={busy || !remoteConfigured} className="mt-4 h-11 w-full rounded-[14px]">
              <Save className="size-4" /> Зберегти вибір груп
            </Button>
          </TabsContent>

          <TabsContent value="import" className="mt-5">
            <label htmlFor="schedule-edit-token" className="block text-xs font-semibold text-[#575e5e]">
              Персональний edit token
              <div className="relative mt-2">
                <KeyRound className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#8c908b]" />
                <Input
                  id="schedule-edit-token"
                  type="password"
                  autoComplete="off"
                  value={token}
                  onChange={(event) => rememberToken(event.target.value)}
                  placeholder="Вводиться один раз на цьому пристрої"
                  className="h-11 rounded-[14px] pl-10"
                />
              </div>
            </label>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex rounded-xl bg-[#f1efe9] p-1">
                {(['merge', 'replace'] as const).map((value) => (
                  <button key={value} onClick={() => setMode(value)} className={`rounded-lg px-3 py-2 text-xs font-semibold ${mode === value ? 'bg-white text-[#293638] shadow-sm' : 'text-[#81817b]'}`}>
                    {value === 'merge' ? 'Merge' : 'Replace my enrollments'}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-2 text-xs text-[#676b68]">
                <input type="checkbox" checked={allowSharedUpdates} onChange={(event) => setAllowSharedUpdates(event.target.checked)} />
                Дозволити спільні зміни
              </label>
            </div>

            <Textarea
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              spellCheck={false}
              className="mt-3 min-h-[260px] rounded-[16px] bg-[#fbfaf7] font-mono text-xs leading-relaxed"
              aria-label="JSON розкладу"
            />

            {errors.length > 0 && (
              <div className="mt-3 rounded-[14px] bg-[#fff0ed] px-4 py-3 text-xs leading-relaxed text-[#a64f45]">
                {errors.map((error, index) => <div key={`${error}-${index}`}>• {error}</div>)}
              </div>
            )}
            {message && <div className="mt-3 rounded-[14px] bg-[#edf5ef] px-4 py-3 text-xs text-[#50705a]">{message}</div>}

            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <Button variant="outline" onClick={() => previewOrImport(true)} disabled={busy} className="h-11 rounded-[14px]">
                <FileJson2 className="size-4" /> Перевірити
              </Button>
              <Button onClick={() => previewOrImport(false)} disabled={busy || !remoteConfigured} className="h-11 rounded-[14px]">
                <Upload className="size-4" /> Імпортувати
              </Button>
              <Button variant="outline" onClick={() => downloadJson(`schedule-${schedule.user.slug}.json`, exported)} className="h-11 rounded-[14px]">
                <Download className="size-4" /> Експортувати
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
