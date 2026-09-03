import type { Lesson, Semester, Subject } from '@/lib/schedule/types';
import { getWeekDates } from '@/lib/schedule/utils';

export interface CourseOccurrence {
  lesson: Lesson;
  week: number;
  date: Date;
}

export function getCourseOccurrences(
  lessons: Lesson[],
  semester: Semester,
  subject: Pick<Subject, 'id' | 'selectedGroup'>,
): CourseOccurrence[] {
  const dates = new Map<number, ReturnType<typeof getWeekDates>>();
  return lessons
    .filter(
      (lesson) =>
        lesson.subjectId === subject.id &&
        // Bundled examples and older caches can contain other groups.
        (lesson.type === 'lecture' ||
          subject.selectedGroup === undefined ||
          lesson.group === subject.selectedGroup),
    )
    .flatMap((lesson) =>
      [...new Set(lesson.weeks)]
        .filter(
          (week) =>
            Number.isInteger(week) && week >= 1 && week <= semester.weeksCount,
        )
        .map((week) => {
          if (!dates.has(week))
            dates.set(week, getWeekDates(semester.startDate, week));
          return { lesson, week, date: dates.get(week)![lesson.day] };
        }),
    )
    .sort(
      (a, b) =>
        a.date.getTime() - b.date.getTime() ||
        a.lesson.startTime.localeCompare(b.lesson.startTime) ||
        a.lesson.endTime.localeCompare(b.lesson.endTime) ||
        a.lesson.id.localeCompare(b.lesson.id),
    );
}
