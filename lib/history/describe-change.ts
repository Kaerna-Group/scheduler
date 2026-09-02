import type { ScheduleHistoryEvent } from '@/lib/history/types';

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function scalar(value: unknown, fallback = 'not set') {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : fallback;
}

function weeks(value: unknown) {
  if (!Array.isArray(value)) return '';
  const values = value.map(Number).filter(Number.isInteger).sort((first, second) => first - second);
  if (!values.length) return '';
  if (values.length > 1 && values.every((week, index) => index === 0 || week === values[index - 1] + 1)) {
    return `${values[0]}–${values[values.length - 1]}`;
  }
  return values.join(', ');
}

function lessonSnapshot(value: unknown) {
  if (Array.isArray(value)) return recordOf(value[0]);
  return recordOf(value);
}

function lessonLocation(value: Record<string, unknown>) {
  const day = scalar(value.day, 'day');
  const start = scalar(value.startTime ?? value.start_time, '—');
  const end = scalar(value.endTime ?? value.end_time, '—');
  return `${day} ${start}–${end}`;
}

export interface HistoryDescription {
  title: string;
  details: string[];
}

export function describeScheduleChange(event: ScheduleHistoryEvent): HistoryDescription {
  if (event.entityType === 'Import') {
    const value = recordOf(event.newValue);
    if (event.action === 'UNDO_IMPORT') {
      return { title: 'Import undone', details: [`Restored state before revision ${scalar(value.undoneRevision, '—')}`] };
    }
    return { title: 'Schedule imported', details: [`${scalar(value.importMode, 'merge')} · ${scalar(value.changeCount, '0')} changes`] };
  }
  const oldValue = lessonSnapshot(event.oldValue);
  const newValue = lessonSnapshot(event.newValue);

  if (event.entityType === 'Lesson') {
    if (event.action === 'CREATE') {
      return { title: 'Lesson added', details: [lessonLocation(newValue), `Weeks ${weeks(newValue.weeks) || '—'}`] };
    }
    if (event.action === 'DEACTIVATE') {
      return { title: 'Lesson removed', details: [lessonLocation(oldValue), `Weeks ${weeks(oldValue.weeks) || '—'}`] };
    }

    const details: string[] = [];
    const oldWeeks = weeks(oldValue.weeks);
    const newWeeks = weeks(newValue.weeks);
    if (oldWeeks !== newWeeks) details.push(`Weeks ${oldWeeks || '—'} → ${newWeeks || '—'}`);
    const comparisons = [
      ['Room', oldValue.room, newValue.room],
      ['Teacher', oldValue.teacher, newValue.teacher],
      ['Day', oldValue.day, newValue.day],
      ['Start', oldValue.startTime ?? oldValue.start_time, newValue.startTime ?? newValue.start_time],
      ['End', oldValue.endTime ?? oldValue.end_time, newValue.endTime ?? newValue.end_time],
      ['Format', oldValue.format, newValue.format],
      ['Group', oldValue.group, newValue.group],
    ] as const;
    comparisons.forEach(([label, before, after]) => {
      if (scalar(before) !== scalar(after)) details.push(`${label} ${scalar(before)} → ${scalar(after)}`);
    });
    return { title: event.action === 'EXTEND_WEEKS' ? 'Lesson weeks extended' : 'Lesson changed', details: details.length ? details : [lessonLocation(newValue)] };
  }

  if (event.entityType === 'Subject') {
    if (event.action === 'CREATE') return { title: 'Course added', details: [] };
    const before = recordOf(event.oldValue);
    const after = recordOf(event.newValue);
    const details: string[] = [];
    if (scalar(before.name) !== scalar(after.name)) details.push(`Name ${scalar(before.name)} → ${scalar(after.name)}`);
    if (scalar(before.color) !== scalar(after.color)) details.push(`Color ${scalar(before.color)} → ${scalar(after.color)}`);
    return { title: 'Course details changed', details };
  }

  if (event.entityType === 'Enrollment') {
    if (event.action === 'UNENROLL') return { title: 'Course removed from this schedule', details: [] };
    if (event.action === 'ENROLL') return { title: 'Course added to this schedule', details: [] };
    const before = recordOf(event.oldValue);
    const after = recordOf(event.newValue);
    return { title: 'Selected group changed', details: [`Group ${scalar(before.group_id)} → ${scalar(after.group_id)}`] };
  }

  if (event.entityType === 'Group') return { title: 'Shared group added', details: [] };
  return { title: 'Shared course schedule changed', details: [] };
}
