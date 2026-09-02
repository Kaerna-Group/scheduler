import type { Lesson, UserSchedule } from '@/lib/schedule/types';
import { dayOrder } from '@/lib/schedule/utils';
import {
  clockMinutes,
  createClockConverter,
  DAY_MS,
  semesterMonday,
  SCHEDULE_TIME_ZONE,
} from '@/lib/schedule/clock';

export { SCHEDULE_TIME_ZONE } from '@/lib/schedule/clock';
export const CALENDAR_MIME_TYPE = 'text/calendar;charset=utf-8';
const encoder = new TextEncoder();

export interface CalendarExport {
  content: string;
  filename: string;
  eventCount: number;
  timeZone: string;
}

function textValue(value: string) {
  let clean = '';
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if ((code >= 32 && code !== 127) || ['\r', '\n', '\t'].includes(character))
      clean += character;
  }
  return clean
    .replaceAll('\\', '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,');
}

// RFC 5545: 75 octets per physical line, including continuation whitespace.
// Iterate code points so folding never cuts a UTF-8 sequence in half.
function foldLine(line: string) {
  let output = '';
  let width = 0;
  for (const character of line) {
    const bytes = encoder.encode(character).length;
    if (width + bytes > 75) {
      output += '\r\n ';
      width = 1;
    }
    output += character;
    width += bytes;
  }
  return output;
}

function utcStamp(date: Date) {
  if (
    !Number.isFinite(date.getTime()) ||
    date.getUTCFullYear() < 1 ||
    date.getUTCFullYear() > 9999
  ) {
    throw new Error('The calendar contains an unsupported date.');
  }
  return date.toISOString().slice(0, 19).replace(/[-:]/g, '') + 'Z';
}

function filePart(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 80) || 'schedule';
}

function lessonKind(lesson: Lesson) {
  if (lesson.type === 'lecture') return 'Lecture';
  if (
    lesson.type !== 'group' ||
    !Number.isInteger(lesson.group) ||
    Number(lesson.group) < 1
  )
    throw new Error('A lesson has an invalid type or group.');
  return `Group ${lesson.group}`;
}

export function exportSemesterCalendar(
  schedule: UserSchedule,
  exportedAt = new Date(),
): CalendarExport {
  const { semester, user } = schedule;
  if (
    !Number.isInteger(semester.weeksCount) ||
    semester.weeksCount < 1 ||
    semester.weeksCount > 30
  )
    throw new Error('The semester week count is invalid.');
  if (
    !Number.isInteger(schedule.revision) ||
    schedule.revision < 0 ||
    schedule.revision > 2_147_483_647
  )
    throw new Error('The schedule revision is invalid.');
  if (!user.slug || !semester.id)
    throw new Error('Select a user and semester before exporting.');
  const monday = semesterMonday(semester.startDate);
  const stamp = utcStamp(exportedAt);
  const toUtc = createClockConverter();
  const seen = new Set<string>();
  const subjects = new Map(
    schedule.subjects.map((subject) => [subject.id, subject]),
  );
  const events: Array<{ start: number; uid: string; lines: string[] }> = [];
  for (const lesson of schedule.lessons) {
    if (!lesson.id || seen.has(lesson.id))
      throw new Error(
        'A lesson ID is missing or duplicated. Refresh the schedule before exporting.',
      );
    seen.add(lesson.id);
    const subject = subjects.get(lesson.subjectId);
    if (!subject)
      throw new Error(
        'A lesson refers to a missing course. Refresh the schedule before exporting.',
      );
    const day = dayOrder.indexOf(lesson.day);
    if (day === -1) throw new Error('A lesson has an invalid weekday.');
    const startMinutes = clockMinutes(lesson.startTime);
    const endMinutes = clockMinutes(lesson.endTime);
    if (endMinutes <= startMinutes)
      throw new Error('A lesson must end after it starts on the same day.');
    if (!Array.isArray(lesson.weeks))
      throw new Error('A lesson has an invalid weeks list.');
    const weeks = [...new Set(lesson.weeks)].sort((a, b) => a - b);
    if (
      !weeks.length ||
      weeks.some(
        (week) =>
          !Number.isInteger(week) || week < 1 || week > semester.weeksCount,
      )
    )
      throw new Error(
        'A lesson has missing or out-of-range weeks. Refresh the schedule before exporting.',
      );
    const kind = lessonKind(lesson);
    const format = { online: 'Online', offline: 'On campus', hybrid: 'Hybrid' }[
      lesson.format
    ];
    if (!format) throw new Error('A lesson has an invalid format.');
    const location =
      lesson.format === 'offline'
        ? lesson.room || 'Room to be announced'
        : [format, lesson.room].filter(Boolean).join(' · ');
    for (const week of weeks) {
      const date = monday + ((week - 1) * 7 + day) * DAY_MS;
      const start = toUtc(date + startMinutes * 60_000);
      const end = toUtc(date + endMinutes * 60_000);
      if (end <= start)
        throw new Error('A lesson has an invalid duration at a clock change.');
      // IDs do not change when times/rooms/revision change. Components are
      // percent-encoded separately to avoid delimiter collisions or injection.
      const uid =
        [
          'scheduler',
          user.id || user.slug,
          semester.id,
          lesson.id,
          `week-${week}`,
        ]
          .map(encodeURIComponent)
          .join('/') + '@kaerna-group.github.io';
      const description = [
        `Teacher: ${lesson.teacher}`,
        `Type: ${kind}`,
        `Format: ${format}`,
        ...(subject.externalCode
          ? [`Course code: ${subject.externalCode}`]
          : []),
        `Schedule: ${user.displayName}`,
        `Semester: ${semester.title}`,
        `Week: ${week} of ${semester.weeksCount}`,
        `Time zone: ${SCHEDULE_TIME_ZONE}`,
      ].join('\n');
      events.push({
        start,
        uid,
        lines: [
          'BEGIN:VEVENT',
          `UID:${textValue(uid)}`,
          `DTSTAMP:${stamp}`,
          `DTSTART:${utcStamp(new Date(start))}`,
          `DTEND:${utcStamp(new Date(end))}`,
          `SEQUENCE:${schedule.revision}`,
          `SUMMARY:${textValue(`${subject.name} — ${kind}`)}`,
          `DESCRIPTION:${textValue(description)}`,
          `LOCATION:${textValue(location)}`,
          'TRANSP:OPAQUE',
          'CLASS:PRIVATE',
          'END:VEVENT',
        ],
      });
    }
  }
  if (!events.length)
    throw new Error(
      'No scheduled classes to export for this user and semester.',
    );
  events.sort((a, b) => a.start - b.start || a.uid.localeCompare(b.uid));
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Kaerna Group//Scheduler//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${textValue(`${user.displayName} — ${semester.title}`)}`,
    ...events.flatMap((event) => event.lines),
    'END:VCALENDAR',
  ];
  return {
    content: lines.map(foldLine).join('\r\n') + '\r\n',
    filename: `schedule-${filePart(user.slug)}-${filePart(semester.id)}.ics`,
    eventCount: events.length,
    timeZone: SCHEDULE_TIME_ZONE,
  };
}
