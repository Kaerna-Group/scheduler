import { useRef, useState } from 'react';
import { ArrowRight, ArrowRightLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { syncDiffSummary } from '@/lib/schedule/sync-diff';
import type {
  ScheduleSyncDiff,
  SyncFieldChange,
  SyncItemChange,
} from '@/lib/schedule/sync-diff';

function timestamp(value: string) {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime())
    ? date.toLocaleString()
    : 'Time unavailable';
}

function ChangedFields({ fields }: { fields: SyncFieldChange[] }) {
  return (
    <dl className="mt-2 space-y-2 text-xs leading-5">
      {fields.map((field) => (
        <div
          key={field.label}
          className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2"
        >
          <dt className="text-muted-foreground">{field.label}</dt>
          <dd className="min-w-0 break-words">
            <span className="text-muted-foreground">
              <span className="sr-only">Before: </span>
              {field.before}
            </span>
            <span className="mx-1.5" aria-hidden="true">
              →
            </span>
            <span className="font-medium">
              <span className="sr-only">After: </span>
              {field.after}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ChangeList({
  title,
  changes,
}: {
  title: string;
  changes: SyncItemChange[];
}) {
  if (!changes.length) return null;
  return (
    <section aria-label={title}>
      <h3 className="mb-2 text-sm font-semibold">
        {title} · {changes.length}
      </h3>
      <ul className="space-y-2">
        {changes.map((change) => (
          <li
            key={change.id}
            className="min-w-0 rounded-xl border border-border bg-muted/30 p-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h4 className="min-w-0 break-words text-sm font-medium">
                {change.title}
              </h4>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${change.kind === 'added' ? 'bg-success-soft text-success-foreground' : change.kind === 'removed' ? 'bg-destructive-soft text-destructive-foreground' : 'bg-info-soft text-info-foreground'}`}
              >
                {
                  { added: 'Added', updated: 'Updated', removed: 'Removed' }[
                    change.kind
                  ]
                }
              </span>
            </div>
            <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">
              {change.context}
            </p>
            <ChangedFields fields={change.fields} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SyncChangesNotice({
  comparison,
  onDismiss,
}: {
  comparison: ScheduleSyncDiff;
  onDismiss: () => void;
}) {
  // Keep a dialog tied to the exact comparison it opened. If another refresh
  // arrives, close it rather than silently replacing a diff being read.
  const [opened, setOpened] = useState<ScheduleSyncDiff | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const summary = syncDiffSummary(comparison);
  const counts = {
    added: comparison.lessons.filter((change) => change.kind === 'added')
      .length,
    updated: comparison.lessons.filter((change) => change.kind === 'updated')
      .length,
    removed: comparison.lessons.filter((change) => change.kind === 'removed')
      .length,
  };
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        onClick={() => setOpened(comparison)}
        aria-haspopup="dialog"
        aria-label={`${summary} View changes`}
        className="mt-3 h-auto w-full justify-start gap-2 rounded-xl bg-info-soft px-3 py-2 text-left text-info-foreground hover:bg-info-soft/80 hover:text-info-foreground"
      >
        <ArrowRightLeft className="size-4 shrink-0" />
        <output className="min-w-0 flex-1 whitespace-normal text-xs">
          {summary}
        </output>{' '}
        <span className="shrink-0 text-xs underline underline-offset-2">
          View changes
        </span>
        <ArrowRight className="size-3.5 shrink-0" />
      </Button>
      <Dialog
        open={opened === comparison}
        onOpenChange={(open) => {
          if (!open) setOpened(null);
        }}
      >
        <DialogContent
          initialFocus={titleRef}
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl"
        >
          <DialogHeader>
            <DialogTitle
              ref={titleRef}
              tabIndex={-1}
              className="pr-6 outline-none"
            >
              Changes since last sync
            </DialogTitle>
            <DialogDescription>
              {comparison.userName} · {comparison.semesterTitle}. Compared with
              this user’s previous saved schedule, across all weeks and courses.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl bg-muted/60 p-3 text-xs leading-5">
            <p className="font-medium">
              Revision {comparison.fromRevision} → {comparison.toRevision}
            </p>
            <p className="text-muted-foreground">
              Previous sync: {timestamp(comparison.previousSync)}
            </p>
            <p className="text-muted-foreground">
              Current sync: {timestamp(comparison.syncedAt)}
            </p>
            {comparison.lessons.length > 0 && (
              <p className="mt-1">
                {counts.added} added · {counts.updated} updated ·{' '}
                {counts.removed} removed
              </p>
            )}
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            Each recurring lesson rule is counted once, even if several fields
            or weeks changed. This is the net difference between two syncs, not
            the full edit history.
          </p>
          <ChangeList title="Classes" changes={comparison.lessons} />
          <ChangeList
            title="Courses and enrollments"
            changes={comparison.subjects}
          />
          {comparison.semester.length > 0 && (
            <section
              aria-label="Semester changes"
              className="rounded-xl border border-border p-3"
            >
              <h3 className="text-sm font-semibold">Semester</h3>
              <ChangedFields fields={comparison.semester} />
            </section>
          )}
          <DialogFooter className="gap-2">
            <a
              href="#/changes"
              className="inline-flex min-h-9 items-center justify-center rounded-md px-3 text-xs font-medium underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
            >
              Full change history
            </a>
            <Button variant="outline" onClick={onDismiss}>
              Dismiss notice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
