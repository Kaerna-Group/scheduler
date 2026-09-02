import ICAL from 'ical.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fallbackSchedule } from '@/data/fallback-schedule';
import {
  exportSemesterCalendar,
  SCHEDULE_TIME_ZONE,
} from '@/lib/schedule/calendar';
import type { UserSchedule } from '@/lib/schedule/types';

const exportedAt = new Date('2026-09-02T12:34:56.789Z');
function fixture() {
  const schedule = structuredClone(fallbackSchedule);
  const subject = schedule.subjects.find(
    (item) => item.externalCode === '565095',
  )!;
  schedule.subjects = [subject];
  schedule.lessons = [
    {
      id: 'LESSON-CALENDAR',
      subjectId: subject.id,
      type: 'lecture',
      day: 'thursday',
      startTime: '08:30',
      endTime: '09:50',
      weeks: [1, 2, 3, 4, 5, 6, 7],
      format: 'offline',
      room: '1-225',
      teacher: 'Teacher',
    },
  ];
  return schedule;
}
function parse(schedule: UserSchedule) {
  const result = exportSemesterCalendar(schedule, exportedAt);
  const calendar = new ICAL.Component(ICAL.parse(result.content));
  const events = calendar
    .getAllSubcomponents('vevent')
    .map((component) => new ICAL.Event(component));
  return { ...result, calendar, events };
}
function starts(schedule: UserSchedule) {
  return parse(schedule).events.map((event) =>
    event.startDate.toJSDate().toISOString(),
  );
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('semester iCalendar export', () => {
  it('expands weeks 1–7 into exactly seven dated events, without recurrence beyond week 7', () => {
    const result = parse(fixture());
    expect(result.eventCount).toBe(7);
    expect(result.events).toHaveLength(7);
    expect(result.events.map((event) => event.startDate.toString())).toEqual([
      '2026-09-03T05:30:00Z',
      '2026-09-10T05:30:00Z',
      '2026-09-17T05:30:00Z',
      '2026-09-24T05:30:00Z',
      '2026-10-01T05:30:00Z',
      '2026-10-08T05:30:00Z',
      '2026-10-15T05:30:00Z',
    ]);
    expect(result.content).not.toMatch(/RRULE|RDATE|EXDATE|RECURRENCE-ID/);
    expect(result.calendar.getFirstPropertyValue('version')).toBe('2.0');
    expect(result.calendar.getFirstPropertyValue('calscale')).toBe('GREGORIAN');
    for (const event of result.events) {
      expect(event.duration.toSeconds()).toBe(80 * 60);
      expect(event.startDate.zone.tzid).toBe('UTC');
      expect(event.component.getFirstPropertyValue('dtstamp')?.toString()).toBe(
        '2026-09-02T12:34:56Z',
      );
    }
  });

  it('preserves sparse weeks and removes duplicate weeks without adding gaps', () => {
    const schedule = fixture();
    schedule.lessons[0].weeks = [7, 1, 3, 3, 7];
    const result = parse(schedule);
    expect(result.eventCount).toBe(3);
    expect(result.events.map((event) => event.startDate.day)).toEqual([
      3, 17, 15,
    ]);
    expect(
      result.events.map((event) => event.description.match(/Week: (\d+)/)?.[1]),
    ).toEqual(['1', '3', '7']);
  });

  it('converts each autumn occurrence using its own Kyiv offset', () => {
    const schedule = fixture();
    schedule.lessons[0].weeks = [8, 9];
    expect(starts(schedule)).toEqual([
      '2026-10-22T05:30:00.000Z',
      '2026-10-29T06:30:00.000Z',
    ]);
    expect(
      parse(schedule).events.map((event) => event.endDate.toString()),
    ).toEqual(['2026-10-22T06:50:00Z', '2026-10-29T07:50:00Z']);
  });

  it('converts the spring clock transition without moving university clock times', () => {
    const schedule = fixture();
    schedule.semester.startDate = '2026-03-23';
    schedule.lessons[0].weeks = [1, 2];
    expect(starts(schedule)).toEqual([
      '2026-03-26T06:30:00.000Z',
      '2026-04-02T05:30:00.000Z',
    ]);
  });

  it.each(['UTC', 'America/New_York', 'Asia/Tokyo', 'Europe/Simferopol'])(
    'does not depend on the exporting device time zone (%s)',
    (zone) => {
      vi.stubEnv('TZ', zone);
      const schedule = fixture();
      schedule.lessons[0].weeks = [8, 9];
      expect(starts(schedule)).toEqual([
        '2026-10-22T05:30:00.000Z',
        '2026-10-29T06:30:00.000Z',
      ]);
      expect(parse(schedule).timeZone).toBe(SCHEDULE_TIME_ZONE);
    },
  );

  it('handles leap days and a semester crossing a year boundary', () => {
    const schedule = fixture();
    schedule.semester.startDate = '2024-02-26';
    schedule.lessons[0].weeks = [1, 2];
    expect(starts(schedule)).toEqual([
      '2024-02-29T06:30:00.000Z',
      '2024-03-07T06:30:00.000Z',
    ]);
    schedule.semester.startDate = '2026-12-28';
    schedule.lessons[0].day = 'saturday';
    expect(starts(schedule)).toEqual([
      '2027-01-02T06:30:00.000Z',
      '2027-01-09T06:30:00.000Z',
    ]);
  });

  it('uses the same Monday-based week 1 as the UI when startDate is not Monday', () => {
    const schedule = fixture();
    schedule.lessons[0].weeks = [1];
    schedule.lessons[0].day = 'monday';
    expect(starts(schedule)).toEqual(['2026-08-31T05:30:00.000Z']);
  });

  it('handles midnight correctly, including a UTC date on the previous day', () => {
    const schedule = fixture();
    Object.assign(schedule.lessons[0], {
      weeks: [1],
      startTime: '00:00',
      endTime: '01:00',
    });
    const event = parse(schedule).events[0];
    expect(event.startDate.toString()).toBe('2026-09-02T21:00:00Z');
    expect(event.endDate.toString()).toBe('2026-09-02T22:00:00Z');
  });

  it('includes course, teacher, group, location, format and semester without inventing classes for empty courses', () => {
    const schedule = fixture();
    Object.assign(schedule.lessons[0], {
      type: 'group',
      group: 3,
      weeks: [6],
      format: 'hybrid',
    });
    schedule.subjects.push({
      id: 'EMPTY',
      name: 'Thesis',
      shortName: 'Thesis',
      color: '#000000',
    });
    const result = parse(schedule);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].summary).toBe(
      'Scrum Framework Fundamentals — Group 3',
    );
    expect(result.events[0].location).toBe('Hybrid · 1-225');
    expect(result.events[0].description).toContain('Teacher: Teacher');
    expect(result.events[0].description).toContain('Week: 6 of 14');
    expect(result.events[0].description).toContain('Course code: 565095');
    expect(result.events[0].description).toContain('Time zone: Europe/Kyiv');
    expect(result.content).not.toContain('Thesis');
  });

  it.each(['online', 'offline', 'hybrid'] as const)(
    'provides an honest location without a room (%s)',
    (format) => {
      const schedule = fixture();
      Object.assign(schedule.lessons[0], {
        weeks: [1],
        format,
        room: undefined,
      });
      expect(parse(schedule).events[0].location).toBe(
        { online: 'Online', offline: 'Room to be announced', hybrid: 'Hybrid' }[
          format
        ],
      );
    },
  );

  it('has deterministic unique UIDs scoped to user, semester, lesson and academic week', () => {
    const schedule = fixture();
    const first = parse(schedule);
    expect(new Set(first.events.map((event) => event.uid)).size).toBe(7);
    schedule.revision += 1;
    Object.assign(schedule.lessons[0], {
      room: 'New room',
      startTime: '09:00',
      endTime: '10:20',
      day: 'friday',
    });
    const changed = parse(schedule);
    expect(changed.events.map((event) => event.uid)).toEqual(
      first.events.map((event) => event.uid),
    );
    expect(changed.events[0].sequence).toBe(schedule.revision);
    const user = structuredClone(schedule);
    user.user.id = 'OTHER-USER';
    const semester = structuredClone(schedule);
    semester.semester.id = 'SEM-OTHER';
    const lesson = structuredClone(schedule);
    lesson.lessons[0].id = 'OTHER-LESSON';
    for (const other of [user, semester, lesson])
      expect(parse(other).events[0].uid).not.toBe(changed.events[0].uid);
  });

  it('sorts events deterministically and does not mutate the DTO or week arrays', () => {
    const schedule = fixture();
    schedule.lessons.push({
      ...schedule.lessons[0],
      id: 'EARLIER',
      day: 'monday',
      weeks: [14, 3],
    });
    const before = structuredClone(schedule);
    const first = parse(schedule);
    expect(schedule).toEqual(before);
    schedule.lessons.reverse();
    schedule.lessons.forEach((lesson) => lesson.weeks.reverse());
    expect(parse(schedule).content).toBe(first.content);
    expect(first.events.map((event) => event.startDate.toUnixTime())).toEqual(
      first.events
        .map((event) => event.startDate.toUnixTime())
        .sort((a, b) => a - b),
    );
  });

  it('escapes text and folds UTF-8 lines without corrupting Cyrillic/emoji or injecting properties', () => {
    const schedule = fixture();
    const name =
      'Скрам 🗓️, команда; A\\B: ' +
      'довга назва '.repeat(25) +
      '\r\nBEGIN:VALARM\nACTION:DISPLAY';
    schedule.subjects[0].name = name;
    schedule.lessons[0].teacher = 'Викладач, А; Б\\В\nДругий рядок\u0000';
    schedule.lessons[0].weeks = [1];
    const result = parse(schedule);
    expect(result.events[0].summary).toBe(
      name.replace(/\r\n/g, '\n') + ' — Lecture',
    );
    expect(result.events[0].description).toContain(
      'Teacher: Викладач, А; Б\\В\nДругий рядок',
    );
    expect(result.events[0].component.getAllSubcomponents()).toEqual([]);
    expect(result.calendar.getAllSubcomponents()).toHaveLength(1);
    expect(result.content).not.toContain('\u0000');
    expect(result.content).toContain('\r\n ');
    expect(result.content.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    for (const line of result.content.split('\r\n'))
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(result.content.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('exports only allowlisted public fields with a safe filename, never credentials or invitations', () => {
    const schedule = fixture();
    Object.assign(schedule, {
      editToken: 'PRIVATE-SECRET',
      arbitraryUrl: 'https://example.test/?pin=1234',
    });
    Object.assign(schedule.user, {
      edit_token_hash: 'PRIVATE-HASH',
      slug: '../../bad\\name:folder',
    });
    const result = parse(schedule);
    expect(result.filename).toMatch(/^schedule-[a-z0-9_-]+\.ics$/i);
    expect(result.content).not.toMatch(
      /PRIVATE-SECRET|PRIVATE-HASH|arbitraryUrl|pin=1234|ATTENDEE|ORGANIZER|BEGIN:VALARM/,
    );
  });

  it.each([[], [0], [15], [-1], [1.5], [NaN]].map((weeks) => ({ weeks })))(
    'rejects invalid weeks $weeks instead of silently exporting a partial calendar',
    ({ weeks }) => {
      const schedule = fixture();
      schedule.lessons[0].weeks = weeks;
      expect(() => parse(schedule)).toThrow(/weeks/);
    },
  );
  it.each(['2026-02-30', '2026-13-01', 'not-a-date'])(
    'rejects invalid semester date %s',
    (date) => {
      const schedule = fixture();
      schedule.semester.startDate = date;
      expect(() => parse(schedule)).toThrow(/start date/);
    },
  );
  it.each(['24:00', '8:30', '08:60', 'bad'])(
    'rejects invalid lesson time %s',
    (time) => {
      const schedule = fixture();
      schedule.lessons[0].startTime = time;
      expect(() => parse(schedule)).toThrow(/time/);
    },
  );
  it('rejects invalid duration, weekday, missing course, duplicate ID, empty semester and unsupported clock data', () => {
    const schedule = fixture();
    schedule.lessons[0].endTime = schedule.lessons[0].startTime;
    expect(() => parse(schedule)).toThrow(/end after/);
    schedule.lessons = fixture().lessons;
    Object.assign(schedule.lessons[0], { day: 'sunday' });
    expect(() => parse(schedule)).toThrow(/weekday/);
    schedule.lessons = fixture().lessons;
    schedule.subjects = [];
    expect(() => parse(schedule)).toThrow(/missing course/);
    schedule.subjects = fixture().subjects;
    schedule.lessons.push(schedule.lessons[0]);
    expect(() => parse(schedule)).toThrow(/duplicated/);
    schedule.lessons = [];
    expect(() => parse(schedule)).toThrow(/No scheduled classes/);
    schedule.lessons = fixture().lessons;
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => {
      throw new RangeError('Unsupported timezone');
    });
    expect(() => parse(schedule)).toThrow(/cannot resolve Europe\/Kyiv/);
  });
});
