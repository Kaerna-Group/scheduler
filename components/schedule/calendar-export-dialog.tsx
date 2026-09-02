import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  exportSemesterCalendar,
  SCHEDULE_TIME_ZONE,
} from '@/lib/schedule/calendar';
import { downloadSemesterCalendar } from '@/lib/schedule/calendar-download';
import type { ScheduleSource, UserSchedule } from '@/lib/schedule/types';

export interface CalendarExportSnapshot {
  schedule: UserSchedule;
  source: ScheduleSource;
  lastSync: string;
  online: boolean;
  backendError: boolean;
}

export function CalendarExportDialog({
  snapshot,
  onClose,
}: {
  snapshot: CalendarExportSnapshot;
  onClose: () => void;
}) {
  const { schedule, source, lastSync, online, backendError } = snapshot;
  const [downloadError, setDownloadError] = useState('');
  const [downloaded, setDownloaded] = useState(false);
  const result = useMemo(() => {
    try {
      return { calendar: exportSemesterCalendar(schedule), error: '' };
    } catch (error) {
      return {
        calendar: null,
        error:
          error instanceof Error
            ? error.message
            : 'Could not create the calendar. Refresh the schedule and try again.',
      };
    }
  }, [schedule]);
  const syncDate = lastSync ? new Date(lastSync) : null;
  const saved = source === 'cache' || !online || backendError;

  function download() {
    if (!result.calendar) return;
    setDownloadError('');
    setDownloaded(false);
    try {
      downloadSemesterCalendar(result.calendar);
      setDownloaded(true);
    } catch {
      setDownloadError(
        'Could not start the download. Allow file downloads in your browser and try again.',
      );
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Export semester to calendar</DialogTitle>
          <DialogDescription>
            Download the entire personal semester as an .ics file. The visible
            week and course filter do not limit this export.
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-xl bg-muted/60 p-4 text-sm">
          <dt className="text-muted-foreground">User</dt>
          <dd className="break-words font-medium">
            {schedule.user.displayName}
          </dd>
          <dt className="text-muted-foreground">Semester</dt>
          <dd className="break-words">{schedule.semester.title}</dd>
          <dt className="text-muted-foreground">Time zone</dt>
          <dd>{SCHEDULE_TIME_ZONE}</dd>
          {result.calendar && (
            <>
              <dt className="text-muted-foreground">Events</dt>
              <dd>{result.calendar.eventCount}</dd>
            </>
          )}
          <dt className="text-muted-foreground">Revision</dt>
          <dd>{schedule.revision}</dd>
        </dl>
        {source === 'fallback' ? (
          <p className="rounded-xl bg-warning-soft p-3 text-xs text-warning-foreground">
            Local example data — this is not a synchronized personal schedule.
          </p>
        ) : saved ? (
          <p className="rounded-xl bg-warning-soft p-3 text-xs text-warning-foreground">
            Exporting a saved snapshot. It may not include recent changes.
            {syncDate && Number.isFinite(syncDate.getTime())
              ? ` Last synchronized: ${syncDate.toLocaleString()}.`
              : ''}
          </p>
        ) : null}
        <p className="text-xs leading-5 text-muted-foreground">
          Each class is included only on its scheduled weeks. Times follow the
          university time zone, including clock changes; your calendar may
          display them in its own time zone.
        </p>
        <p className="text-xs leading-5 text-muted-foreground">
          This is a one-time export, not a subscription. Later changes and
          deletions will not update imported events. Re-importing may leave old
          events or create duplicates, depending on your calendar app.
        </p>
        {result.error && (
          <p className="text-sm text-muted-foreground" role="alert">
            {result.error}
          </p>
        )}
        {downloadError && (
          <p className="text-sm text-destructive" role="alert">
            {downloadError}
          </p>
        )}
        {downloaded && (
          <output className="text-sm text-success">
            Download started — {result.calendar?.eventCount} calendar events.
          </output>
        )}
        <DialogFooter>
          <Button onClick={download} disabled={!result.calendar}>
            <Download className="size-4" /> Download .ics
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
