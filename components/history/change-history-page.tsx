import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, Clock3, History, RefreshCw, RotateCcw, ShieldAlert, UserRound, UsersRound } from 'lucide-react';

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogMedia,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { SemesterSelect } from '@/components/schedule/semester-select';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { useSchedule } from '@/hooks/use-schedule';
import { describeScheduleChange } from '@/lib/history/describe-change';
import { fetchScheduleHistory, readCachedHistory, undoLastImport } from '@/lib/history/repository';
import type { ScheduleHistoryEvent, ScheduleHistoryResponse } from '@/lib/history/types';
import { getStoredEditToken } from '@/lib/schedule/repository';

type ScopeFilter = 'all' | 'shared' | 'personal';

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || 'Unknown time';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function HistoryCard({ event }: { event: ScheduleHistoryEvent }) {
  const description = describeScheduleChange(event);
  const subject = event.subject;
  return (
    <article className="relative rounded-[22px] border border-border bg-card/80 p-4 shadow-[0_12px_35px_rgb(var(--theme-shadow-color)/5%)] sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: subject?.color ?? 'var(--accent)' }} />
            <h2 className="truncate text-sm font-bold text-foreground sm:text-base">{subject ? subject.shortName || subject.name : 'Schedule import'}</h2>
            <span className={`rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-[0.08em] ${event.scope === 'shared' ? 'bg-warning-soft text-warning-foreground' : 'bg-secondary text-secondary-foreground'}`}>
              {event.scope === 'shared' ? 'Shared' : 'Personal'}
            </span>
          </div>
          <h3 className="mt-3 text-lg font-semibold tracking-[-0.025em] text-foreground">{description.title}</h3>
          {description.details.length > 0 && <ul className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">{description.details.map((detail) => <li key={detail}>• {detail}</li>)}</ul>}
        </div>
        <span className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-semibold text-muted-foreground">r{event.revision}</span>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><UserRound className="size-3.5" />{event.actor.displayName} {event.scope === 'shared' ? 'changed shared schedule data' : 'changed this enrollment'}</span>
        <time className="inline-flex items-center gap-1.5" dateTime={event.timestamp}><Clock3 className="size-3.5" />{formatTimestamp(event.timestamp)}</time>
        {subject && <span className="font-mono text-[9px]">{subject.externalCode}</span>}
      </div>
    </article>
  );
}

export function ChangeHistoryPage() {
  const { schedule, selectedUser, selectUser, selectedSemesterId, selectSemester, remoteConfigured, online, refresh: refreshSchedule } = useSchedule();
  const [history, setHistory] = useState<ScheduleHistoryResponse | null>(() => readCachedHistory(selectedUser, schedule.semester.id));
  const [source, setSource] = useState<'remote' | 'cache' | 'empty'>(() => history ? 'cache' : 'empty');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [scope, setScope] = useState<ScopeFilter>('all');
  const [subjectId, setSubjectId] = useState('all');
  const [undoing, setUndoing] = useState(false);
  const [undoDialogOpen, setUndoDialogOpen] = useState(false);
  const selectedUserName = schedule.users.find((user) => user.slug === selectedUser)?.displayName ?? schedule.user.displayName;

  useEffect(() => {
    const cached = readCachedHistory(selectedUser, schedule.semester.id);
    setHistory(cached);
    setSource(cached ? 'cache' : 'empty');
    setError('');
    setSubjectId('all');
    if (!remoteConfigured || !online) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    void fetchScheduleHistory(selectedUser, schedule.semester.id, controller.signal)
      .then((response) => {
        setHistory(response);
        setSource('remote');
      })
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) setError(requestError instanceof Error ? requestError.message : 'Could not load change history.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [online, remoteConfigured, schedule.semester.id, selectedUser]);

  const refresh = async () => {
    if (!remoteConfigured || !online || loading) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetchScheduleHistory(selectedUser, schedule.semester.id);
      setHistory(response);
      setSource('remote');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not load change history.');
    } finally {
      setLoading(false);
    }
  };

  const subjects = useMemo(() => {
    const byId = new Map<string, ScheduleHistoryEvent['subject']>();
    history?.events.forEach((event) => { if (event.subject) byId.set(event.subject.id, event.subject); });
    return [...byId.values()].filter((subject) => subject !== null).sort((first, second) => first.name.localeCompare(second.name));
  }, [history]);
  const visibleEvents = useMemo(() => (history?.events ?? []).filter((event) =>
    (scope === 'all' || event.scope === scope) && (subjectId === 'all' || event.subject?.id === subjectId),
  ), [history, scope, subjectId]);
  const selectedUserRole = schedule.users.find((user) => user.slug === selectedUser)?.role ?? schedule.user.role;
  const editToken = getStoredEditToken(selectedUser);
  const canAdminister = selectedUserRole === 'editor' || selectedUserRole === 'admin';
  const canUndoTarget = selectedUserRole === 'admin' || history?.undo?.targetUserSlug === selectedUser;

  const performUndo = async () => {
    if (!online || !remoteConfigured || !history?.undo?.available || !canUndoTarget || !editToken || undoing) return;
    setUndoing(true);
    setError('');
    try {
      await undoLastImport({ token: editToken, baseRevision: history.revision });
      await refreshSchedule();
      const response = await fetchScheduleHistory(selectedUser, schedule.semester.id);
      setHistory(response);
      setSource('remote');
    } catch (undoError) {
      setError(undoError instanceof Error ? undoError.message : 'Could not undo the last import.');
    } finally {
      setUndoing(false);
    }
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true"><div className="absolute -right-20 -top-28 size-[380px] rounded-full bg-glow-a/45 blur-3xl" /><div className="absolute -left-32 top-[38%] size-[340px] rounded-full bg-glow-b/45 blur-3xl" /></div>
      <header className="relative border-b border-border/80 bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1100px] flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-7 lg:px-10 xl:py-5">
          <a href="#/" className="inline-flex h-10 items-center gap-2 rounded-full px-2 text-sm font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Back to schedule</a>
          <div className="flex flex-wrap items-center gap-2"><SemesterSelect schedule={schedule} value={selectedSemesterId} onChange={selectSemester} />
          <Select value={selectedUser} onValueChange={(value) => value && selectUser(value)}>
            <SelectTrigger aria-label="History user" className="h-10 min-w-[210px] rounded-full border-border bg-card/80 px-3.5 text-xs font-semibold shadow-none"><UserRound className="size-3.5" /><span className="min-w-0 flex-1 truncate text-left">{selectedUserName}</span></SelectTrigger>
            <SelectContent>{schedule.users.map((user) => <SelectItem key={user.id} value={user.slug}>{user.displayName}</SelectItem>)}</SelectContent>
          </Select>
          </div>
        </div>
      </header>

      <div className="relative mx-auto max-w-[1100px] px-4 pb-24 pt-8 sm:px-7 lg:px-10 xl:pt-10">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-accent">Audit trail</p><h1 className="mt-2 text-4xl font-semibold tracking-[-0.055em] sm:text-5xl">Changes</h1><p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground">Who changed lessons, weeks, rooms, shared course data, and your enrollments.</p></div>
          <div className="flex items-center gap-2"><span className={`rounded-full px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] ${source === 'remote' ? 'bg-success-soft text-success-foreground' : 'bg-warning-soft text-warning-foreground'}`}>{!online ? 'Offline cache' : source === 'remote' ? 'Current' : source === 'cache' ? 'Cached' : 'No cache'}</span><Button variant="outline" size="icon-lg" aria-label="Refresh history" disabled={!remoteConfigured || !online || loading} onClick={() => void refresh()} className="rounded-full"><RefreshCw className={loading ? 'animate-spin' : ''} /></Button></div>
        </div>

        <section className="mt-8 flex flex-wrap gap-3 rounded-[22px] border border-border bg-card/75 p-3 sm:p-4">
          <div className="flex rounded-full bg-secondary p-1">
            {([['all', 'All'], ['shared', 'Shared'], ['personal', 'My schedule']] as const).map(([value, label]) => <button key={value} onClick={() => setScope(value)} className={`rounded-full px-3 py-2 text-xs font-semibold transition ${scope === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{label}</button>)}
          </div>
          <Select value={subjectId} onValueChange={(value) => value && setSubjectId(value)}><SelectTrigger aria-label="Filter history by course" className="h-10 min-w-[220px] flex-1 rounded-full bg-background sm:max-w-[330px]"><BookOpen className="size-3.5" /><span className="truncate text-left">{subjectId === 'all' ? 'All courses' : subjects.find((subject) => subject.id === subjectId)?.shortName}</span></SelectTrigger><SelectContent><SelectItem value="all">All courses</SelectItem>{subjects.map((subject) => <SelectItem key={subject.id} value={subject.id}>{subject.name}</SelectItem>)}</SelectContent></Select>
          <span className="ml-auto inline-flex items-center gap-1.5 px-2 text-xs text-muted-foreground"><History className="size-4" />{visibleEvents.length} events</span>
        </section>

        {canAdminister && history?.undo && (
          <section className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-[20px] border border-warning/35 bg-warning-soft p-4">
            <div className="flex items-start gap-3"><ShieldAlert className="mt-0.5 size-5 shrink-0 text-warning" /><div><h2 className="text-sm font-bold text-warning-foreground">Administrative undo</h2><p className="mt-1 text-xs leading-5 text-warning-foreground">{history.undo.available ? `Import revision ${history.undo.importRevision} by ${history.undo.actorDisplayName ?? 'unknown user'} can be undone. This creates a new revision.` : history.undo.reason}</p>{!canUndoTarget && <p className="mt-1 text-xs font-semibold text-warning-foreground">Only an admin can undo an import made for another user.</p>}{!editToken && <p className="mt-1 text-xs font-semibold text-warning-foreground">Store this editor’s edit token on the Import page first.</p>}</div></div>
            <AlertDialog open={undoDialogOpen} onOpenChange={setUndoDialogOpen}>
              <AlertDialogTrigger render={<Button variant="destructive" disabled={!online || !remoteConfigured || !history.undo.available || !canUndoTarget || !editToken || undoing} />}><RotateCcw />{undoing ? 'Undoing…' : 'Undo last import'}</AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader><AlertDialogMedia><RotateCcw /></AlertDialogMedia><AlertDialogTitle>Undo import revision {history.undo.importRevision}?</AlertDialogTitle><AlertDialogDescription>This restores the state before that import. It is allowed only while no newer schedule changes exist. The undo itself will be recorded as a new revision.</AlertDialogDescription></AlertDialogHeader>
                <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => { setUndoDialogOpen(false); void performUndo(); }}>Undo import</AlertDialogAction></AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </section>
        )}

        {error && <div className="mt-4 rounded-[16px] bg-destructive-soft px-4 py-3 text-xs text-destructive-foreground" role="alert">{error}{history ? ' Showing cached history.' : ''}</div>}
        {!remoteConfigured && <div className="mt-4 rounded-[16px] bg-warning-soft px-4 py-3 text-xs text-warning-foreground">The backend is not configured. History becomes available after connecting the Apps Script API.</div>}

        <div className="mt-5 space-y-3">
          {visibleEvents.map((event) => <HistoryCard key={event.id} event={event} />)}
          {!loading && visibleEvents.length === 0 && <div className="rounded-[24px] border border-dashed border-border bg-card/50 px-5 py-14 text-center"><UsersRound className="mx-auto size-7 text-muted-foreground" /><h2 className="mt-4 text-lg font-semibold">No matching changes</h2><p className="mt-2 text-xs text-muted-foreground">Try another filter or refresh the backend history.</p></div>}
        </div>
      </div>
    </main>
  );
}
