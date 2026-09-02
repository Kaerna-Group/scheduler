import { afterEach, describe, expect, it, vi } from 'vitest';
import { fallbackSchedule } from '@/data/fallback-schedule';
import {
  getNextLessonState,
  minutesRemaining,
} from '@/lib/schedule/next-lesson';
import type { Lesson, UserSchedule } from '@/lib/schedule/types';

const lesson: Lesson = {
  id: 'electronics',
  subjectId: 'electronics',
  type: 'lecture',
  day: 'wednesday',
  startTime: '11:40',
  endTime: '13:00',
  weeks: [4],
  room: '1-001',
  format: 'offline',
  teacher: 'Teacher',
};
function schedule(lessons = [lesson]): UserSchedule {
  return {
    ...structuredClone(fallbackSchedule),
    lessons: structuredClone(lessons),
  };
}
function at(value: string, data = schedule()) {
  return getNextLessonState(data, new Date(value).getTime());
}
afterEach(() => vi.unstubAllEnvs());

describe('today’s next personal lesson', () => {
  it('finds the next class with an exact countdown and occurrence date', () => {
    const state = at('2026-09-23T11:03:00+03:00');
    expect(state.kind).toBe('lessons');
    if (state.kind !== 'lessons') throw new Error('Expected lessons');
    expect(state.current).toEqual([]);
    expect(state.next.map((item) => item.lesson.id)).toEqual(['electronics']);
    expect(new Date(state.next[0].start).toISOString()).toBe(
      '2026-09-23T08:40:00.000Z',
    );
    expect(
      minutesRemaining(
        state.next[0].start - Date.parse('2026-09-23T11:03:00+03:00'),
      ),
    ).toBe('37 хв');
  });

  it.each([
    { time: '11:39:59', current: 0, next: 1 },
    { time: '11:40:00', current: 1, next: 0 },
    { time: '12:59:59', current: 1, next: 0 },
  ])(
    'uses inclusive start/exclusive end at $time',
    ({ time, current, next }) => {
      const state = at(`2026-09-23T${time}+03:00`);
      expect(state.kind).toBe('lessons');
      if (state.kind !== 'lessons') throw new Error('Expected lessons');
      expect(state.current).toHaveLength(current);
      expect(state.next).toHaveLength(next);
    },
  );

  it('finishes exactly at the last end, without promoting tomorrow’s lesson', () => {
    const data = schedule([
      lesson,
      { ...lesson, id: 'tomorrow', day: 'thursday' },
    ]);
    expect(at('2026-09-23T13:00:00+03:00', data)).toEqual({ kind: 'done' });
    expect(at('2026-09-23T23:59:59+03:00', data)).toEqual({ kind: 'done' });
  });

  it('shows an ongoing class and the nearest upcoming class, then a gap', () => {
    const data = schedule([
      { ...lesson, id: 'later', startTime: '15:00', endTime: '16:20' },
      { ...lesson, id: 'first', startTime: '10:00', endTime: '11:20' },
      lesson,
    ]);
    const current = at('2026-09-23T11:00:00+03:00', data);
    expect(current.kind).toBe('lessons');
    if (current.kind !== 'lessons') throw new Error('Expected lessons');
    expect(current.current[0].lesson.id).toBe('first');
    expect(current.next[0].lesson.id).toBe('electronics');
    const gap = at('2026-09-23T11:20:00+03:00', data);
    expect(gap.kind === 'lessons' && gap.current).toEqual([]);
    expect(gap.kind === 'lessons' && gap.next[0].lesson.id).toBe('electronics');
  });

  it('keeps simultaneous next classes and all overlapping current classes', () => {
    const data = schedule([
      { ...lesson, id: 'z' },
      { ...lesson, id: 'a' },
      { ...lesson, id: 'overlap', startTime: '12:00', endTime: '13:20' },
    ]);
    const upcoming = at('2026-09-23T11:00:00+03:00', data);
    expect(
      upcoming.kind === 'lessons' &&
        upcoming.next.map((entry) => entry.lesson.id),
    ).toEqual(['a', 'z']);
    const current = at('2026-09-23T12:00:00+03:00', data);
    expect(
      current.kind === 'lessons' &&
        current.current.map((entry) => entry.lesson.id),
    ).toEqual(['a', 'z', 'overlap']);
    expect(current.kind === 'lessons' && current.next).toEqual([]);
  });

  it('respects selected personal groups even in an older unfiltered snapshot', () => {
    const data = schedule([
      {
        ...lesson,
        id: 'wrong-group',
        type: 'group',
        group: 1,
        startTime: '10:00',
        endTime: '11:20',
      },
      { ...lesson, type: 'group', group: 5 },
    ]);
    data.subjects.find(
      (subject) => subject.id === 'electronics',
    )!.selectedGroup = 5;
    const state = at('2026-09-23T09:00:00+03:00', data);
    expect(state.kind === 'lessons' && state.next[0].lesson.id).toBe(
      'electronics',
    );
  });

  it('stops 1–7 week rules after week 7 and preserves sparse weeks', () => {
    const data = schedule([
      { ...lesson, day: 'thursday', weeks: [1, 3, 7, 7] },
    ]);
    expect(at('2026-10-15T09:00:00+03:00', data).kind).toBe('lessons');
    expect(at('2026-10-22T09:00:00+03:00', data)).toEqual({ kind: 'free-day' });
    expect(at('2026-09-10T09:00:00+03:00', data)).toEqual({ kind: 'free-day' });
    const week3 = at('2026-09-17T09:00:00+03:00', data);
    expect(week3.kind === 'lessons' && week3.next).toHaveLength(1);
  });

  it('handles Sunday, an empty personal schedule and days without any rules', () => {
    expect(at('2026-09-27T09:00:00+03:00')).toEqual({ kind: 'free-day' });
    expect(at('2026-09-23T09:00:00+03:00', schedule([]))).toEqual({
      kind: 'free-day',
    });
    expect(at('2026-09-24T09:00:00+03:00')).toEqual({ kind: 'free-day' });
  });

  it('includes Saturday classes on their actual academic week', () => {
    const data = schedule([{ ...lesson, day: 'saturday', weeks: [4] }]);
    const state = at('2026-09-26T11:03:00+03:00', data);
    expect(state.kind === 'lessons' && state.next[0].lesson.id).toBe(
      'electronics',
    );
    expect(at('2026-10-03T11:03:00+03:00', data)).toEqual({ kind: 'free-day' });
  });

  it('never clamps dates outside the semester into active lesson weeks', () => {
    const data = schedule([{ ...lesson, weeks: [1, 14] }]);
    expect(at('2026-08-26T09:00:00+03:00', data)).toEqual({
      kind: 'before-semester',
    });
    expect(at('2026-12-09T09:00:00+02:00', data)).toEqual({
      kind: 'after-semester',
    });
    expect(at('2027-09-01T09:00:00+03:00', data)).toEqual({
      kind: 'after-semester',
    });
  });

  it('uses Monday-based academic weeks, including Monday before a Tuesday startDate', () => {
    const data = schedule([{ ...lesson, day: 'monday', weeks: [1] }]);
    expect(at('2026-08-31T09:00:00+03:00', data).kind).toBe('lessons');
    expect(at('2026-08-30T23:59:59+03:00', data).kind).toBe('before-semester');
  });

  it('handles the local midnight and final semester boundary independently of UTC', () => {
    const data = schedule([
      {
        ...lesson,
        day: 'monday',
        weeks: [5],
        startTime: '00:05',
        endTime: '01:00',
      },
    ]);
    expect(at('2026-09-27T20:59:59Z', data).kind).toBe('free-day');
    expect(at('2026-09-27T21:00:00Z', data).kind).toBe('lessons');
    expect(at('2026-12-06T21:59:59Z', data).kind).toBe('free-day');
    expect(at('2026-12-06T22:00:00Z', data).kind).toBe('after-semester');
  });

  it.each(['UTC', 'America/New_York', 'Asia/Tokyo', 'Europe/Simferopol'])(
    'ignores the device time zone: %s',
    (zone) => {
      vi.stubEnv('TZ', zone);
      const state = at('2026-09-23T08:03:00Z');
      expect(state.kind === 'lessons' && state.next[0].start).toBe(
        Date.parse('2026-09-23T08:40:00Z'),
      );
    },
  );

  it.each([
    { start: '2026-09-01', date: '2026-10-22', week: 8, offset: '+03:00' },
    { start: '2026-09-01', date: '2026-10-29', week: 9, offset: '+02:00' },
    { start: '2027-02-01', date: '2027-03-25', week: 8, offset: '+02:00' },
    { start: '2027-02-01', date: '2027-04-01', week: 9, offset: '+03:00' },
  ])(
    'counts correctly across clock changes: $date',
    ({ start, date, week, offset }) => {
      const data = schedule([{ ...lesson, day: 'thursday', weeks: [week] }]);
      data.semester.startDate = start;
      const state = at(`${date}T11:03:00${offset}`, data);
      expect(state.kind === 'lessons' && state.next[0].start).toBe(
        Date.parse(`${date}T11:40:00${offset}`),
      );
    },
  );

  it.each([
    { name: 'bad time', patch: { startTime: '25:00' } },
    { name: 'reversed duration', patch: { endTime: '11:00' } },
    { name: 'invalid weeks', patch: { weeks: [4, 99] } },
    { name: 'missing weeks', patch: { weeks: [] } },
    { name: 'missing subject', patch: { subjectId: 'missing' } },
  ])(
    'does not claim the day is over when data is invalid: $name',
    ({ patch }) => {
      expect(
        at('2026-09-23T11:00:00+03:00', schedule([{ ...lesson, ...patch }])),
      ).toEqual({ kind: 'unavailable' });
    },
  );

  it('handles invalid current dates/semesters and leaves the schedule unchanged', () => {
    const data = schedule();
    const original = structuredClone(data);
    at('2026-09-23T11:00:00+03:00', data);
    expect(data).toEqual(original);
    expect(getNextLessonState(data, NaN)).toEqual({ kind: 'unavailable' });
    data.semester.startDate = '2026-02-30';
    expect(at('2026-09-23T11:00:00+03:00', data)).toEqual({
      kind: 'unavailable',
    });
    data.semester.weeksCount = 0;
    expect(at('2026-09-23T11:00:00+03:00', data)).toEqual({
      kind: 'unavailable',
    });
  });

  it.each([
    [1, '1 хв'],
    [37 * 60_000, '37 хв'],
    [60 * 60_000, '1 год'],
    [61 * 60_000, '1 год 1 хв'],
    [121 * 60_000, '2 год 1 хв'],
  ])('formats a compact rounded-up countdown: %s ms', (milliseconds, label) => {
    expect(minutesRemaining(milliseconds)).toBe(label);
  });
});
