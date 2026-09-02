import {
  CALENDAR_MIME_TYPE,
  type CalendarExport,
} from '@/lib/schedule/calendar';

export function downloadSemesterCalendar(calendar: CalendarExport) {
  const blob = new Blob([calendar.content], { type: CALENDAR_MIME_TYPE });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = calendar.filename;
  anchor.hidden = true;
  try {
    document.body.append(anchor);
    anchor.click();
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  } finally {
    anchor.remove();
  }
  // Give browsers time to consume the blob after the user-initiated click.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
