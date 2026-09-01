import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, Check, CheckCircle2, Clipboard, Download, FileJson2,
  Fingerprint, KeyRound, RefreshCw, ShieldAlert, Upload, UserRound,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useSchedule } from '@/hooks/use-schedule';
import { usePreferences } from '@/hooks/use-preferences';
import { buildLlmImportPrompt, scheduleImportExample } from '@/lib/schedule/import-guide';
import { exportSchedule, validateScheduleImport } from '@/lib/schedule/import';
import { getStoredEditToken, importPersonalSchedule, storeEditToken } from '@/lib/schedule/repository';
import { getScheduleSyncStatus } from '@/lib/schedule/sync-status';

const rules = [
  ['Response format', 'Plain JSON only. No Markdown blocks, comments, explanations, or extra text.'],
  ['Document root', 'An object with schemaVersion: 1, the exact semesterId, and a subjects array.'],
  ['Course code', 'externalCode is required, stable, and unique in the file. The same code identifies a shared course for all users.'],
  ['Missing code', 'Use a stable LOCAL-LATIN-SLUG and reuse it in later imports.'],
  ['Course', 'name is required; shortName, color, selectedGroup, and lessons are optional. Do not use extra fields.'],
  ['Color', 'Use #RRGGBB, for example #7b86c6.'],
  ['Selected group', 'selectedGroup is a positive integer that determines which group lessons the user sees.'],
  ['Personal and shared data', 'selectedGroup belongs to the user. lessons belong to the shared course and may contain rules for different groups.'],
  ['New group', 'Add lessons only for a group present in the source. The server preserves known groups and attaches the new one.'],
  ['No lessons', 'A course may use lessons: [] and remains in the course list.'],
  ['One rule', 'One lesson describes an immutable day, time, type, format, teacher, room, and group for a specific set of weeks.'],
  ['Changing conditions', 'Create a separate lesson whenever any condition changes between weeks.'],
  ['Lesson type', 'type is lecture or group. A group lesson requires a positive integer group.'],
  ['Days', 'Only monday, tuesday, wednesday, thursday, friday, and saturday are supported.'],
  ['Time', 'startTime/endTime use HH:mm with a leading zero; start precedes end; overnight lessons are forbidden.'],
  ['Weeks', 'Use a non-empty sorted array of unique integers within the semester. Do not use strings or ranges.'],
  ['Format', 'Only offline, online, and hybrid are supported.'],
  ['Teacher', 'teacher is a non-empty string. Use "Vacancy" when no teacher is assigned.'],
  ['Room', 'room is optional. It is normally omitted online and provided for offline lessons when known.'],
  ['Lesson ID', 'id is optional and normally omitted because the server creates internal IDs.'],
  ['Do not duplicate courses', 'Keep the lecture and practice of one course as lessons inside one subject.'],
  ['Do not invent data', 'Preserve source spelling and do not infer teachers, rooms, or weeks.'],
];

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function safeFilename(value: string) {
  return value.trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'user';
}

export function ImportGuidePage() {
  const { hasPendingChanges } = usePreferences();
  const { schedule, setSchedule, selectedUser, selectUser, source, loading, error, refresh, remoteConfigured, lastSync, online } = useSchedule();
  const fileInput = useRef<HTMLInputElement>(null);
  const exported = useMemo(() => exportSchedule(schedule), [schedule]);
  const prompt = useMemo(() => buildLlmImportPrompt(schedule.semester.id, schedule.semester.weeksCount), [schedule.semester.id, schedule.semester.weeksCount]);
  const [token, setToken] = useState(() => getStoredEditToken(schedule.user.slug));
  const [importText, setImportText] = useState(() => JSON.stringify(scheduleImportExample, null, 2));
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [allowSharedUpdates, setAllowSharedUpdates] = useState(false);
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const selectedUserName = schedule.users.find((user) => user.slug === selectedUser)?.displayName ?? schedule.user.displayName;
  const dataSyncStatus = getScheduleSyncStatus({
    online,
    remoteConfigured,
    source,
    lastSync,
    backendError: error,
    hasPendingChanges,
  });

  useEffect(() => setToken(getStoredEditToken(schedule.user.slug)), [schedule.user.slug]);

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
      setErrors(['The JSON has a syntax error. Check commas, quotation marks, and brackets.']);
      return undefined;
    }
  };

  const previewOrImport = async (dryRun: boolean) => {
    const value = parseImport();
    if (!value) return;
    if (!remoteConfigured) {
      setErrors(['The remote API is not configured. The JSON was validated only in the browser.']);
      return;
    }
    if (!online) {
      setErrors(['There is no network connection. The JSON was validated only in the browser.']);
      return;
    }
    if (!token.trim()) {
      setErrors(['Enter the selected user’s personal edit token.']);
      return;
    }

    setBusy(true);
    try {
      const response = await importPersonalSchedule({
        userSlug: schedule.user.slug,
        token: token.trim(),
        schedule: value,
        mode,
        baseRevision: schedule.revision,
        allowSharedUpdates,
        dryRun,
      });
      setErrors([]);
      if (response.schedule) setSchedule(response.schedule);
      setMessage(dryRun
        ? `Validation succeeded. Planned changes: ${Array.isArray(response.plan) ? response.plan.length : 0}. No data has been written.`
        : `Import completed. Revision ${response.revision}.`);
      if (!dryRun) await refresh();
    } catch (importError) {
      const details = importError && typeof importError === 'object' && 'details' in importError ? (importError as { details?: unknown }).details : undefined;
      setErrors([
        importError instanceof Error ? importError.message : 'Could not complete the import.',
        ...(Array.isArray(details) ? details.map((item) => typeof item === 'string' ? item : JSON.stringify(item)) : []),
      ]);
    } finally {
      setBusy(false);
    }
  };

  const copyPrompt = async () => {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const loadFile = async (file?: File) => {
    if (!file) return;
    setImportText(await file.text());
    setErrors([]);
    setMessage(`Loaded ${file.name} into the editor.`);
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -right-20 -top-28 size-[380px] rounded-full bg-glow-a/45 blur-3xl" />
        <div className="absolute -left-32 top-[38%] size-[340px] rounded-full bg-glow-b/45 blur-3xl" />
      </div>

      <header className="relative border-b border-border/80 bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1360px] flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-7 lg:px-10 xl:py-5">
          <a href="#/" className="inline-flex h-10 items-center gap-2 rounded-full px-2 text-sm font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Back to schedule</a>
          <Select value={selectedUser} onValueChange={(value) => value && selectUser(value)}>
            <SelectTrigger aria-label="Import user" className="h-10 min-w-[210px] rounded-full border-border bg-card/80 px-3.5 text-xs font-semibold text-foreground shadow-none xl:h-11 xl:min-w-[240px] xl:text-sm">
              <UserRound className="size-3.5" />
              <span className="min-w-0 flex-1 truncate text-left">{selectedUserName}</span>
            </SelectTrigger>
            <SelectContent align="center" sideOffset={7} className="min-w-[260px] rounded-[17px] border border-border bg-popover p-1.5 shadow-[0_18px_50px_rgb(var(--theme-shadow-color)/16%)]">
              {schedule.users.map((user) => <SelectItem key={user.id} value={user.slug} className="min-h-10 rounded-xl px-3 text-sm focus:bg-muted">{user.displayName}</SelectItem>)}
            </SelectContent>
          </Select>
          <Badge variant="secondary" className="h-8 rounded-full border-0 bg-secondary px-3 text-[10px] font-bold uppercase tracking-[0.08em] text-secondary-foreground">JSON schema v1</Badge>
        </div>
      </header>

      <div className="relative mx-auto max-w-[1360px] px-4 pb-24 pt-8 sm:px-7 lg:px-10 xl:pt-10">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-accent">The only editing workflow</p>
            <h1 className="mt-2 max-w-3xl text-4xl font-semibold tracking-[-0.055em] text-foreground sm:text-5xl">Schedule import</h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground">Paste prepared JSON or upload a file. Validate it safely before importing.</p>
          </div>
          <div className="text-right text-xs leading-6 text-muted-foreground"><div>{schedule.semester.title} · {schedule.semester.weeksCount} weeks</div><output aria-live="polite">{dataSyncStatus.label} · revision {schedule.revision}</output></div>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(330px,.75fr)] xl:gap-8">
          <section className="rounded-[26px] border border-border bg-card/80 p-4 shadow-[0_16px_55px_rgb(var(--theme-shadow-color)/6%)] sm:p-6 xl:p-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><h2 className="text-xl font-semibold tracking-[-0.035em] text-foreground">Import JSON</h2><p className="mt-1 text-xs text-muted-foreground">User: {schedule.user.displayName}</p></div>
              <div className="flex flex-wrap gap-2">
                <input ref={fileInput} type="file" accept="application/json,.json" className="hidden" onChange={(event) => loadFile(event.target.files?.[0])} />
                <Button variant="outline" onClick={() => fileInput.current?.click()} className="h-9 rounded-xl"><Upload className="size-3.5" /> Open file</Button>
                <Button variant="outline" onClick={() => setImportText(JSON.stringify(exported, null, 2))} className="h-9 rounded-xl">Current JSON</Button>
              </div>
            </div>

            <label htmlFor="schedule-edit-token" className="mt-5 block text-xs font-semibold text-foreground">
              Personal edit token
              <div className="relative mt-2">
                <KeyRound className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="schedule-edit-token" type="password" autoComplete="off" value={token} onChange={(event) => rememberToken(event.target.value)} placeholder="Stored only on this device" className="h-11 rounded-[14px] pl-10" />
              </div>
            </label>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <button onClick={() => setMode('merge')} className={`rounded-[15px] border p-3 text-left transition ${mode === 'merge' ? 'border-ring bg-warning-soft' : 'border-border bg-background'}`}><div className="text-xs font-bold text-foreground">Merge</div><div className="mt-1 text-[11px] leading-5 text-muted-foreground">Add or update the listed courses without removing others.</div></button>
              <button onClick={() => setMode('replace')} className={`rounded-[15px] border p-3 text-left transition ${mode === 'replace' ? 'border-ring bg-warning-soft' : 'border-border bg-background'}`}><div className="text-xs font-bold text-foreground">Replace my enrollments</div><div className="mt-1 text-[11px] leading-5 text-muted-foreground">Keep only the courses listed in this JSON for the user.</div></button>
            </div>

            <label className="mt-3 flex items-start gap-3 rounded-[14px] bg-secondary p-3 text-xs leading-5 text-muted-foreground"><input type="checkbox" checked={allowSharedUpdates} onChange={(event) => setAllowSharedUpdates(event.target.checked)} className="mt-1" /><span><strong className="text-foreground">Allow conflicting shared changes.</strong> A new group does not require this option. Enable it only to replace a rule that conflicts with stored data.</span></label>

            <Textarea value={importText} onChange={(event) => setImportText(event.target.value)} spellCheck={false} className="mt-4 min-h-[420px] rounded-[17px] bg-background font-mono text-xs leading-relaxed" aria-label="Schedule JSON" />

            {errors.length > 0 && <div className="mt-3 rounded-[14px] bg-destructive-soft px-4 py-3 text-xs leading-relaxed text-destructive-foreground" role="alert">{errors.map((validationError, index) => <div key={`${validationError}-${index}`}>• {validationError}</div>)}</div>}
            {message && <output className="mt-3 block rounded-[14px] bg-success-soft px-4 py-3 text-xs leading-5 text-success-foreground">{message}</output>}
            {error && <div className="mt-3 text-xs text-destructive-foreground">{error}</div>}

            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <Button variant="outline" onClick={() => previewOrImport(true)} disabled={busy} className="h-11 rounded-[14px]"><FileJson2 className="size-4" /> Validate</Button>
              <Button onClick={() => previewOrImport(false)} disabled={busy || !remoteConfigured || !online} className="h-11 rounded-[14px]"><Upload className="size-4" /> Import</Button>
              <Button variant="outline" onClick={() => downloadJson(`schedule-${safeFilename(schedule.user.displayName)}.json`, exported)} className="h-11 rounded-[14px]"><Download className="size-4" /> Export</Button>
            </div>
            <Button variant="ghost" onClick={refresh} disabled={loading || !remoteConfigured || !online} className="mt-2 w-full rounded-xl text-xs"><RefreshCw className={loading ? 'size-3.5 animate-spin' : 'size-3.5'} /> Refresh data before import</Button>
          </section>

          <aside className="space-y-5 lg:sticky lg:top-5 lg:self-start">
            <section className="rounded-[24px] bg-primary p-5 text-primary-foreground shadow-[0_18px_45px_rgb(var(--theme-shadow-color)/15%)]">
              <div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary-foreground/50">For ChatGPT / Claude / Gemini</p><h2 className="mt-2 text-xl font-semibold tracking-[-0.035em]">Ready-to-use LLM prompt</h2></div><Clipboard className="size-5 text-accent" /></div>
              <p className="mt-3 text-xs leading-6 text-primary-foreground/65">Copy the rules into the model, then send a screenshot or the schedule text in your next message.</p>
              <Button onClick={copyPrompt} className="mt-5 h-11 w-full rounded-[14px] bg-card text-foreground hover:bg-card/90">{copied ? <Check className="size-4" /> : <Clipboard className="size-4" />}{copied ? 'Prompt copied' : 'Copy prompt'}</Button>
            </section>

            <section className="rounded-[24px] border border-border bg-card/75 p-5">
              <h2 className="text-sm font-bold text-foreground">Safe workflow</h2>
              <ol className="mt-4 space-y-3 text-xs leading-5 text-muted-foreground">{['Select the correct user.', 'Enter the personal edit token.', 'Paste the JSON and click Validate.', 'Review errors or the change plan.', 'Only then click Import.'].map((step, index) => <li key={step} className="flex gap-3"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-secondary text-[10px] font-bold text-foreground">{index + 1}</span><span>{step}</span></li>)}</ol>
            </section>

            <section className="rounded-[24px] border border-warning/35 bg-warning-soft p-5"><div className="flex gap-3"><ShieldAlert className="mt-0.5 size-5 shrink-0 text-warning" /><div><h2 className="text-sm font-bold text-warning-foreground">Shared data</h2><p className="mt-2 text-xs leading-6 text-warning-foreground">Every user shares the course name and lessons for the same externalCode. New groups and non-conflicting rules are added to the offering; rules absent from the JSON are not deleted.</p></div></div></section>

            <details className="group rounded-[24px] border border-border bg-card/75 p-5">
              <summary className="flex cursor-pointer list-none items-center gap-3 text-sm font-bold text-foreground">
                <Fingerprint className="size-4 text-muted-foreground" />
                Technical user data
                <span className="ml-auto text-[10px] font-semibold text-muted-foreground group-open:hidden">Show</span>
              </summary>
              <dl className="mt-4 grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-2 border-t border-border pt-4 text-xs">
                <dt className="text-muted-foreground">display_name</dt><dd className="font-semibold text-foreground">{schedule.user.displayName}</dd>
                <dt className="text-muted-foreground">slug</dt><dd className="break-all font-mono text-foreground">{schedule.user.slug}</dd>
                <dt className="text-muted-foreground">user_id</dt><dd className="break-all font-mono text-foreground">{schedule.user.id}</dd>
                <dt className="text-muted-foreground">role</dt><dd className="font-mono text-foreground">{schedule.user.role}</dd>
              </dl>
            </details>
          </aside>
        </div>

        <section className="mt-12 border-t border-border pt-10">
          <div className="max-w-3xl"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Full specification</p><h2 className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-foreground">All import rules</h2><p className="mt-3 text-sm leading-7 text-muted-foreground">This list matches browser and Apps Script validation and can be shared with another person or an LLM without project code access.</p></div>
          <div className="mt-7 grid gap-3 md:grid-cols-2">{rules.map(([title, description], index) => <article key={title} className="flex gap-4 rounded-[19px] border border-border bg-card/70 p-4"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">{index + 1}</span><div><h3 className="text-sm font-bold text-foreground">{title}</h3><p className="mt-1.5 text-xs leading-6 text-muted-foreground">{description}</p></div></article>)}</div>
        </section>

        <section className="mt-12 grid gap-6 lg:grid-cols-2">
          <div className="rounded-[24px] border border-border bg-card/75 p-5 sm:p-6">
            <h2 className="text-xl font-semibold tracking-[-0.035em] text-foreground">Exact allowed values</h2>
            <div className="mt-5 overflow-x-auto"><table className="w-full border-collapse text-left text-xs"><thead><tr className="border-b border-border text-muted-foreground"><th className="pb-3 pr-4 font-semibold">Field</th><th className="pb-3 font-semibold">Value</th></tr></thead><tbody className="align-top text-foreground">{[
              ['schemaVersion', '1'], ['semesterId', schedule.semester.id], ['type', 'lecture | group'], ['day', 'monday | tuesday | wednesday | thursday | friday | saturday'], ['format', 'offline | online | hybrid'], ['time', 'HH:mm, for example 08:30'], ['weeks', `integers 1–${schedule.semester.weeksCount}`], ['selectedGroup / group', 'positive integer'],
            ].map(([field, value]) => <tr key={field} className="border-b border-border"><td className="py-3 pr-4 font-mono font-semibold">{field}</td><td className="py-3 font-mono leading-5">{value}</td></tr>)}</tbody></table></div>
          </div>

          <div className="rounded-[24px] border border-border bg-primary p-5 text-primary-foreground sm:p-6"><div className="flex items-center justify-between gap-3"><h2 className="text-xl font-semibold tracking-[-0.035em]">JSON example</h2><CheckCircle2 className="size-5 text-success" /></div><pre className="mt-5 max-h-[500px] overflow-auto rounded-[16px] bg-primary-foreground/10 p-4 text-[11px] leading-5 text-primary-foreground/75"><code>{JSON.stringify(scheduleImportExample, null, 2)}</code></pre></div>
        </section>

        <section className="mt-8 rounded-[24px] border border-destructive/35 bg-destructive-soft p-5 sm:p-6"><div className="flex gap-4"><AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" /><div><h2 className="text-sm font-bold text-destructive-foreground">Merge, Replace, and conflicts</h2><ul className="mt-3 space-y-2 text-xs leading-6 text-destructive-foreground"><li>• Merge does not remove the user’s other enrollments.</li><li>• Replace removes only this user’s current-semester enrollments that are absent from the JSON; shared courses and lessons are not physically deleted.</li><li>• An exact lesson match is not duplicated; extra weeks join the same rule; a new group or non-conflicting lesson joins the offering.</li><li>• A conflict exists only when a rule for the same group, type, day, and weeks overlaps in time but contains different data. Allowing shared changes replaces only conflicting weeks.</li><li>• If the revision is stale, refresh the data and repeat validation and import.</li><li>• Validate writes nothing. The server applies a successful import atomically under a lock and records it in AuditLog.</li></ul></div></div></section>
      </div>
    </main>
  );
}
