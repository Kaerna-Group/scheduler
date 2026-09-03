import { describe, expect, it } from 'vitest';
import { getCourseOccurrences } from '@/lib/schedule/course-occurrences';
import type { Lesson, Semester } from '@/lib/schedule/types';

const semester: Semester = {
  id: 'SEM-TEST',
  title: 'Test semester',
  startDate: '2026-09-01',
  weeksCount: 14,
};
const subject = { id: 'course' };
const lecture: Lesson = {
  id: 'lecture',
  subjectId: 'course',
  type: 'lecture',
  day: 'saturday',
  startTime: '10:00',
  endTime: '11:20',
  weeks: [1, 3, 9, 14],
  format: 'online',
  teacher: 'A',
};
const localDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

describe('course semester occurrences', () => {
  it('expands sparse weeks from the semester Monday, including Saturdays across the clock change', () => {
    const results = getCourseOccurrences([lecture], semester, subject);
    expect(results.map(({ week, date }) => [week, localDate(date)])).toEqual([
      [1, '2026-09-05'],
      [3, '2026-09-19'],
      [9, '2026-10-31'],
      [14, '2026-12-05'],
    ]);
    expect(results.every(({ lesson }) => lesson.startTime === '10:00')).toBe(
      true,
    );
    expect(
      localDate(
        getCourseOccurrences(
          [{ ...lecture, day: 'monday', weeks: [1] }],
          semester,
          subject,
        )[0].date,
      ),
    ).toBe('2026-08-31');
  });

  it('sorts changed days and times chronologically without merging simultaneous classes or including other subjects', () => {
    const lessons: Lesson[] = [
      {
        ...lecture,
        id: 'later',
        day: 'friday',
        weeks: [4],
        teacher: 'B',
        room: '202',
        format: 'offline',
      },
      {
        ...lecture,
        id: 'early-time',
        startTime: '08:30',
        endTime: '09:50',
        weeks: [1],
      },
      {
        ...lecture,
        id: 'group',
        type: 'group',
        group: 2,
        weeks: [1],
        format: 'hybrid',
        room: '101',
      },
      { ...lecture, weeks: [3, 1, 1, 0, 15, 1.5] },
      { ...lecture, id: 'other', subjectId: 'other' },
    ];
    const results = getCourseOccurrences(lessons, semester, subject);
    expect(results.map(({ lesson, week }) => [lesson.id, week])).toEqual([
      ['early-time', 1],
      ['group', 1],
      ['lecture', 1],
      ['lecture', 3],
      ['later', 4],
    ]);
    expect(results.at(-1)).toMatchObject({
      lesson: { teacher: 'B', room: '202', format: 'offline' },
    });
    expect(lessons[3].weeks).toEqual([3, 1, 1, 0, 15, 1.5]);
  });

  it('keeps only the selected personal group when an example or old cache also includes other groups', () => {
    const lessons: Lesson[] = [
      { ...lecture, weeks: [1] },
      { ...lecture, id: 'mine', type: 'group', group: 2, weeks: [1] },
      { ...lecture, id: 'other-group', type: 'group', group: 3, weeks: [1] },
    ];
    expect(
      getCourseOccurrences(lessons, semester, {
        ...subject,
        selectedGroup: 2,
      }).map(({ lesson }) => lesson.id),
    ).toEqual(['lecture', 'mine']);
    expect(getCourseOccurrences(lessons, semester, subject)).toHaveLength(3);
  });

  it('uses the selected semester dates across a year boundary and returns no invented classes', () => {
    const archive = { ...semester, startDate: '2025-12-30', weeksCount: 2 };
    expect(
      getCourseOccurrences(
        [{ ...lecture, weeks: [1, 2, 3] }],
        archive,
        subject,
      ).map(({ date }) => localDate(date)),
    ).toEqual(['2026-01-03', '2026-01-10']);
    expect(
      getCourseOccurrences([lecture], semester, { id: 'missing' }),
    ).toEqual([]);
    expect(
      getCourseOccurrences([{ ...lecture, weeks: [] }], semester, subject),
    ).toEqual([]);
  });
});
