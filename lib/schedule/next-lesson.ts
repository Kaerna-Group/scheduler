import {
  clockMinutes,
  createClockConverter,
  DAY_MS,
  scheduleDate,
  semesterMonday,
} from '@/lib/schedule/clock';
import type { Lesson, Subject, UserSchedule } from '@/lib/schedule/types';
import { dayOrder } from '@/lib/schedule/utils';

export interface TimedLesson {
  lesson: Lesson;
  subject: Subject;
  start: number;
  end: number;
}

export type NextLessonState =
  | {
      kind:
        | 'before-semester'
        | 'after-semester'
        | 'free-day'
        | 'done'
        | 'unavailable';
    }
  | { kind: 'lessons'; current: TimedLesson[]; next: TimedLesson[] };

// Today's complete personal schedule, deliberately independent of view filters.
// Never clamp a real date into week 1/the last week of an inactive semester.
export function getNextLessonState(
  schedule: UserSchedule,
  now: number,
): NextLessonState {
  try {
    const { semester } = schedule;
    if (
      !Number.isFinite(now) ||
      !Number.isInteger(semester.weeksCount) ||
      semester.weeksCount < 1 ||
      semester.weeksCount > 30
    )
      return { kind: 'unavailable' };
    const monday = semesterMonday(semester.startDate);
    const date = new Date(scheduleDate(now) + 'T00:00:00.000Z');
    const dayOffset = Math.floor((date.getTime() - monday) / DAY_MS);
    if (dayOffset < 0) return { kind: 'before-semester' };
    if (dayOffset >= semester.weeksCount * 7) return { kind: 'after-semester' };
    const week = Math.floor(dayOffset / 7) + 1;
    const day = dayOrder[(date.getUTCDay() + 6) % 7];
    if (!day) return { kind: 'free-day' };
    const subjects = new Map(
      schedule.subjects.map((subject) => [subject.id, subject]),
    );
    const toUtc = createClockConverter();
    const today: TimedLesson[] = [];
    for (const lesson of schedule.lessons) {
      if (lesson.day !== day) continue;
      if (
        !Array.isArray(lesson.weeks) ||
        !lesson.weeks.length ||
        lesson.weeks.some(
          (value) =>
            !Number.isInteger(value) ||
            value < 1 ||
            value > semester.weeksCount,
        )
      )
        return { kind: 'unavailable' };
      if (!lesson.weeks.includes(week)) continue;
      const subject = subjects.get(lesson.subjectId);
      if (!subject) return { kind: 'unavailable' };
      // The remote DTO is already personal. Also respect selectedGroup in the
      // bundled example/older caches, which can contain other groups' rules.
      if (
        lesson.type === 'group' &&
        subject.selectedGroup !== undefined &&
        lesson.group !== subject.selectedGroup
      )
        continue;
      const startMinutes = clockMinutes(lesson.startTime);
      const endMinutes = clockMinutes(lesson.endTime);
      if (endMinutes <= startMinutes) return { kind: 'unavailable' };
      const start = toUtc(date.getTime() + startMinutes * 60_000);
      const end = toUtc(date.getTime() + endMinutes * 60_000);
      if (end <= start) return { kind: 'unavailable' };
      today.push({ lesson, subject, start, end });
    }
    today.sort(
      (a, b) =>
        a.start - b.start ||
        a.end - b.end ||
        a.lesson.id.localeCompare(b.lesson.id),
    );
    if (!today.length) return { kind: 'free-day' };
    const current = today.filter(
      (entry) => entry.start <= now && now < entry.end,
    );
    const upcoming = today.filter((entry) => entry.start > now);
    const next = upcoming.filter((entry) => entry.start === upcoming[0].start);
    if (!current.length && !next.length) return { kind: 'done' };
    return { kind: 'lessons', current, next };
  } catch {
    // A damaged cache or missing time-zone support must not crash the schedule
    // or assert that the user's classes have finished.
    return { kind: 'unavailable' };
  }
}

export function minutesRemaining(milliseconds: number) {
  const minutes = Math.max(1, Math.ceil(milliseconds / 60_000));
  if (minutes < 60) return `${minutes} хв`;
  const remainder = minutes % 60;
  return `${Math.floor(minutes / 60)} год${remainder ? ` ${remainder} хв` : ''}`;
}
