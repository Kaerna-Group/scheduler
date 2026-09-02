import { useEffect, useMemo, useState } from 'react';
import { Archive, CalendarPlus, CheckCircle2, Copy } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { archiveSemester, createSemester, setCurrentSemester } from '@/lib/semesters/repository';
import type { SemesterSummary } from '@/lib/schedule/types';

export function SemesterManagement({ semesters, currentSemesterId, revision, token, enabled, execute, onSelect, onRefresh }: {
  semesters: SemesterSummary[];
  currentSemesterId: string;
  revision: number;
  token: string;
  enabled: boolean;
  execute?: (operation: () => Promise<{ revision: number; copiedSubjects?: number }>) => Promise<{ revision: number; copiedSubjects?: number } | undefined>;
  onSelect: (semesterId: string) => void;
  onRefresh: () => void;
}) {
  const active = semesters.filter((semester) => !semester.archived);
  const defaultSource = currentSemesterId || active[0]?.id || '';
  const [id, setId] = useState('');
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState('');
  const [weeksCount, setWeeksCount] = useState('14');
  const [sourceSemesterId, setSourceSemesterId] = useState(defaultSource);
  const [copySubjects, setCopySubjects] = useState(true);
  const [makeCurrent, setMakeCurrent] = useState(true);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [draftRevision, setDraftRevision] = useState(revision);
  const sorted = useMemo(() => [...semesters].sort((a, b) => b.startDate.localeCompare(a.startDate)), [semesters]);

  useEffect(() => {
    if (!semesters.some((semester) => semester.id === sourceSemesterId)) setSourceSemesterId(defaultSource);
  }, [defaultSource, semesters, sourceSemesterId]);

  async function run(key: string, operation: () => Promise<{ revision: number; copiedSubjects?: number }>, success: (result: { copiedSubjects?: number }) => string) {
    setBusy(key);
    setMessage('');
    try {
      const result = execute ? await execute(operation) : await operation();
      if (!result) return;
      setDraftRevision(result.revision);
      setMessage(success(result));
      if (!execute) onRefresh();
    } catch (operationError) {
      setMessage(operationError instanceof Error ? operationError.message : 'Semester operation failed.');
    } finally { setBusy(''); }
  }

  function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedId = id.trim().toUpperCase();
    void run('create', () => createSemester({
      token, baseRevision: draftRevision, signal: AbortSignal.timeout(45000),
      semester: { id: normalizedId, title: title.trim(), startDate, weeksCount: Number(weeksCount) },
      sourceSemesterId: copySubjects ? sourceSemesterId : undefined,
      copySubjects, makeCurrent,
    }), (result) => {
      if (makeCurrent) onSelect(normalizedId);
      setId(''); setTitle(''); setStartDate('');
      return `Semester created. Copied courses: ${result.copiedSubjects ?? 0}. Lessons were not copied.`;
    });
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        {sorted.map((semester) => (
          <div key={semester.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-border bg-background p-3">
            <button type="button" onClick={() => onSelect(semester.id)} className="min-w-0 text-left">
              <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">{semester.title}{semester.current && <span className="rounded-full bg-success-soft px-2 py-1 text-[9px] uppercase tracking-wide text-success-foreground">Current</span>}{semester.archived && <span className="rounded-full bg-secondary px-2 py-1 text-[9px] uppercase tracking-wide text-muted-foreground">Archive</span>}</div>
              <div className="mt-1 text-xs text-muted-foreground">{semester.id} · {semester.startDate} · {semester.weeksCount} weeks</div>
            </button>
            {enabled && !semester.archived && <div className="flex gap-2">
              {!semester.current && <Button type="button" size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void run(`current:${semester.id}`, () => setCurrentSemester({ token, baseRevision: revision, semesterId: semester.id, signal: AbortSignal.timeout(45000) }), () => { onSelect(semester.id); return 'Current semester changed.'; })}><CheckCircle2 />Make current</Button>}
              {!semester.current && <Button type="button" size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => { if (window.confirm(`Archive “${semester.title}”? It will remain available for read-only viewing.`)) void run(`archive:${semester.id}`, () => archiveSemester({ token, baseRevision: revision, semesterId: semester.id, signal: AbortSignal.timeout(45000) }), () => 'Semester archived.'); }}><Archive />Archive</Button>}
            </div>}
          </div>
        ))}
      </div>

      {enabled ? <form onSubmit={submit} className="rounded-[18px] border border-border bg-secondary/35 p-4">
        {draftRevision !== revision && <div className="mb-4 rounded-xl bg-warning-soft p-3 text-sm text-warning-foreground">Data changed since this form opened (r{draftRevision} → r{revision}). Review the semester list before continuing.<Button type="button" variant="outline" className="mt-2" onClick={() => setDraftRevision(revision)}>I reviewed the latest data</Button></div>}
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold"><CalendarPlus className="size-4" />Create semester</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label htmlFor="semester-id" className="text-xs font-semibold">ID<Input id="semester-id" required value={id} onChange={(event) => setId(event.target.value)} placeholder="SEM-2027-SPRING" className="mt-2 bg-background" /></label>
          <label htmlFor="semester-title" className="text-xs font-semibold">Title<Input id="semester-title" required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Spring 2027" className="mt-2 bg-background" /></label>
          <label htmlFor="semester-start" className="text-xs font-semibold">Start date<Input id="semester-start" required type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="mt-2 bg-background" /></label>
          <label htmlFor="semester-weeks" className="text-xs font-semibold">Weeks<Input id="semester-weeks" required type="number" min="1" max="30" value={weeksCount} onChange={(event) => setWeeksCount(event.target.value)} className="mt-2 bg-background" /></label>
        </div>
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3"><span className="flex items-center gap-2 text-xs font-semibold"><Copy className="size-3.5" />Copy courses from previous semester</span><Switch aria-label="Copy courses from previous semester" checked={copySubjects} onCheckedChange={setCopySubjects} /></div>
          {copySubjects && <Select value={sourceSemesterId} onValueChange={(value) => value && setSourceSemesterId(value)}><SelectTrigger aria-label="Source semester" className="bg-background"><SelectValue placeholder="Source semester" /></SelectTrigger><SelectContent>{semesters.map((semester) => <SelectItem key={semester.id} value={semester.id}>{semester.title}</SelectItem>)}</SelectContent></Select>}
          <div className="flex items-center justify-between gap-3"><span className="text-xs font-semibold">Make current immediately</span><Switch aria-label="Make current immediately" checked={makeCurrent} onCheckedChange={setMakeCurrent} /></div>
          <p className="text-xs leading-5 text-muted-foreground">Subjects and offerings are copied as new records. Lessons, groups, and enrollments always start empty.</p>
        </div>
        <Button type="submit" disabled={Boolean(busy) || draftRevision !== revision} className="mt-4 rounded-full"><CalendarPlus />{busy === 'create' ? 'Creating…' : 'Create semester'}</Button>
      </form> : <p className="text-xs leading-6 text-muted-foreground">Viewing and switching semesters is available to everyone. Creating, selecting the current semester, and archiving require an admin edit token.</p>}
      {message && <output className="block rounded-[14px] bg-secondary p-3 text-xs text-foreground">{message}</output>}
    </div>
  );
}
