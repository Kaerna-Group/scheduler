import { AlertTriangle, BookPlus, CalendarPlus, Pencil, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { buildImportDiff } from '@/lib/schedule/import-diff';
import type { ImportPlanChange, ImportPlanResponse, SharedConflictResolution } from '@/lib/schedule/types';

interface ImportDiffEditorProps {
  response: ImportPlanResponse;
  resolutions: Record<string, SharedConflictResolution>;
  subjectNames: Record<string, string>;
  busy: boolean;
  onResolve: (externalCode: string, resolution: SharedConflictResolution) => void;
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function textOf(value: unknown, fallback = '—') {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : fallback;
}

function subjectLabel(change: ImportPlanChange, names: Record<string, string>) {
  const value = recordOf(change.newValue);
  return textOf(value.name, names[change.externalCode ?? ''] ?? change.externalCode ?? change.entityId);
}

function lessonLabel(value: unknown) {
  const lesson = recordOf(value);
  const weeks = Array.isArray(lesson.weeks) ? lesson.weeks.map((week) => textOf(week)).join(', ') : '—';
  const group = lesson.group === undefined ? 'lecture' : `group ${textOf(lesson.group)}`;
  return `${textOf(lesson.day, 'day')} · ${textOf(lesson.startTime)}–${textOf(lesson.endTime)} · ${group} · weeks ${weeks}`;
}

function previousLessonLabel(value: unknown) {
  if (Array.isArray(value)) return `${value.length} stored lesson rule${value.length === 1 ? '' : 's'}`;
  return lessonLabel(value);
}

function ChangeList({ changes, names, changed = false }: { changes: ImportPlanChange[]; names: Record<string, string>; changed?: boolean }) {
  if (!changes.length) return null;
  return (
    <ul className="mt-3 space-y-2">
      {changes.map((change, index) => (
        <li key={`${change.entityId}-${change.action}-${index}`} className="rounded-xl border border-border bg-background px-3 py-2.5 text-xs">
          <div className="font-semibold text-foreground">{names[change.externalCode ?? ''] ?? change.externalCode ?? change.entityId}</div>
          {changed
            ? <div className="mt-1 text-muted-foreground"><span className="line-through opacity-70">{previousLessonLabel(change.oldValue)}</span><span className="mx-1.5">→</span>{change.newValue ? lessonLabel(change.newValue) : 'removed conflicting rule'}</div>
            : <div className="mt-1 text-muted-foreground">{change.entityType === 'Subject' ? subjectLabel(change, names) : lessonLabel(change.newValue)}</div>}
        </li>
      ))}
    </ul>
  );
}

export function ImportDiffEditor({ response, resolutions, subjectNames, busy, onResolve }: ImportDiffEditorProps) {
  const diff = buildImportDiff(response);
  const unresolved = diff.conflictsBySubject.filter(({ externalCode }) => !resolutions[externalCode]).length;
  const summary = [
    ['New courses', diff.newSubjects.length, BookPlus],
    ['New lessons', diff.newLessons.length, CalendarPlus],
    ['Changed lessons', diff.changedLessons.length, Pencil],
    ['Removed enrollments', diff.removedEnrollments.length, Trash2],
    ['Shared conflicts', diff.conflictsBySubject.length, AlertTriangle],
  ] as const;

  return (
    <section className="mt-5 rounded-[20px] border border-border bg-card p-4 sm:p-5" aria-label="Import change plan">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-foreground">Import diff</h3>
          <p className="mt-1 text-xs text-muted-foreground">Previewed against backend revision {response.revision}. Nothing has been written yet.</p>
        </div>
        <span className={`rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.08em] ${unresolved ? 'bg-warning-soft text-warning-foreground' : 'bg-success-soft text-success-foreground'}`}>
          {unresolved ? `${unresolved} decision${unresolved === 1 ? '' : 's'} required` : 'Ready to import'}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {summary.map(([label, count, Icon]) => (
          <div key={label} className="rounded-[14px] bg-secondary p-3">
            <Icon className="size-4 text-muted-foreground" />
            <div className="mt-2 text-xl font-semibold text-foreground">{count}</div>
            <div className="mt-0.5 text-[10px] leading-4 text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>

      {diff.newSubjects.length > 0 && <div className="mt-5"><h4 className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">New courses</h4><ChangeList changes={diff.newSubjects} names={subjectNames} /></div>}
      {diff.newLessons.length > 0 && <div className="mt-5"><h4 className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">New lessons</h4><ChangeList changes={diff.newLessons} names={subjectNames} /></div>}
      {diff.changedLessons.length > 0 && <div className="mt-5"><h4 className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">Changed lessons</h4><ChangeList changes={diff.changedLessons} names={subjectNames} changed /></div>}
      {diff.removedEnrollments.length > 0 && (
        <div className="mt-5">
          <h4 className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">Enrollments removed by replace</h4>
          <ul className="mt-3 space-y-2">{diff.removedEnrollments.map((change) => <li key={change.entityId} className="rounded-xl border border-destructive/25 bg-destructive-soft px-3 py-2.5 text-xs font-semibold text-destructive-foreground">{subjectNames[change.externalCode ?? ''] ?? change.externalCode ?? change.entityId}</li>)}</ul>
        </div>
      )}

      {diff.conflictsBySubject.length > 0 && (
        <div className="mt-5 space-y-3">
          <h4 className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">Shared conflicts — decide per course</h4>
          {diff.conflictsBySubject.map(({ externalCode, conflicts }) => {
            const resolution = resolutions[externalCode] ?? conflicts[0]?.resolution;
            return (
              <article key={externalCode} className="rounded-[16px] border border-warning/35 bg-warning-soft p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><h5 className="text-sm font-bold text-warning-foreground">{subjectNames[externalCode] ?? externalCode}</h5><p className="mt-1 font-mono text-[10px] text-warning-foreground/75">{externalCode} · {conflicts.length} conflict{conflicts.length === 1 ? '' : 's'}</p></div>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant={resolution === 'keep' ? 'default' : 'outline'} disabled={busy} onClick={() => onResolve(externalCode, 'keep')}>Keep stored</Button>
                    <Button type="button" size="sm" variant={resolution === 'apply' ? 'default' : 'outline'} disabled={busy} onClick={() => onResolve(externalCode, 'apply')}>Apply imported</Button>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {conflicts.map((conflict, index) => (
                    <div key={`${conflict.kind ?? 'shared'}-${index}`} className="contents">
                      <div className="min-w-0 rounded-xl bg-background/75 p-3"><div className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Stored {conflict.kind ?? 'data'}</div><pre className="mt-2 overflow-auto whitespace-pre-wrap break-words text-[10px] leading-4 text-foreground">{JSON.stringify(conflict.stored, null, 2)}</pre></div>
                      <div className="min-w-0 rounded-xl bg-background/75 p-3"><div className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Imported {conflict.kind ?? 'data'}</div><pre className="mt-2 overflow-auto whitespace-pre-wrap break-words text-[10px] leading-4 text-foreground">{JSON.stringify(conflict.imported, null, 2)}</pre></div>
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
