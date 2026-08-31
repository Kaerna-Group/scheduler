import { describe, expect, it } from 'vitest';

import { fallbackSchedule } from '@/data/fallback-schedule';
import { exportSchedule, validateScheduleImport } from '@/lib/schedule/import';
import type { Lesson } from '@/lib/schedule/types';
import { getConflictIds, getLessonsForDay, lessonsOverlap } from '@/lib/schedule/utils';

const baseLesson: Lesson = {
  id: 'a', subjectId: 'subject-a', type: 'lecture', day: 'wednesday',
  startTime: '10:00', endTime: '11:20', weeks: [1, 3, 5], format: 'online', teacher: 'Teacher',
};

describe('schedule conflicts', () => {
  it('detects overlap only on a common day and week', () => {
    const overlapping: Lesson = { ...baseLesson, id: 'b', startTime: '11:00', endTime: '12:00', weeks: [3] };
    expect(lessonsOverlap(baseLesson, overlapping, 3)).toBe(true);
    expect(lessonsOverlap(baseLesson, overlapping, 1)).toBe(false);
    expect(getConflictIds([baseLesson, overlapping], 3)).toEqual(new Set(['a', 'b']));
  });

  it('supports a course changing day across week ranges', () => {
    const first: Lesson = { ...baseLesson, id: 'first', weeks: [1, 2] };
    const second: Lesson = { ...baseLesson, id: 'second', day: 'friday', weeks: [3, 4] };
    expect(getLessonsForDay([first, second], 1, 'wednesday')).toEqual([first]);
    expect(getLessonsForDay([first, second], 3, 'friday')).toEqual([second]);
  });
});

describe('import contract', () => {
  it('round-trips the fallback schedule including a subject without lessons', () => {
    const exported = exportSchedule(fallbackSchedule);
    const validation = validateScheduleImport(exported, 14);
    expect(validation.errors).toEqual([]);
    expect(validation.value?.subjects.some((subject) =>
      subject.name === 'Кваліфікаційна робота' && subject.lessons?.length === 0,
    )).toBe(true);
  });

  it('accepts odd weeks and several lesson rules for one course', () => {
    const validation = validateScheduleImport({
      schemaVersion: 1,
      semesterId: 'SEM-2026-FALL',
      subjects: [{
        externalCode: '123',
        name: 'Course',
        selectedGroup: 3,
        lessons: [
          { type: 'group', group: 3, day: 'wednesday', startTime: '10:00', endTime: '11:20', weeks: [1, 3, 5], format: 'online', teacher: 'A' },
          { type: 'group', group: 3, day: 'friday', startTime: '13:30', endTime: '14:50', weeks: [2, 4], format: 'offline', room: '1-101', teacher: 'A' },
        ],
      }],
    });
    expect(validation.errors).toEqual([]);
  });

  it('rejects duplicate course codes and out-of-range weeks', () => {
    const validation = validateScheduleImport({
      schemaVersion: 1,
      semesterId: 'SEM-2026-FALL',
      subjects: [
        { externalCode: '123', name: 'A', lessons: [] },
        { externalCode: '123', name: 'B', lessons: [{ type: 'lecture', day: 'monday', startTime: '10:00', endTime: '11:20', weeks: [72], format: 'online', teacher: 'B' }] },
      ],
    });
    expect(validation.errors.some((error) => error.includes('дублюється'))).toBe(true);
    expect(validation.errors.some((error) => error.includes('діапазоном'))).toBe(true);
  });
});

describe('seed fixtures', () => {
  it('contains Scrum and qualification work but no target-security course', () => {
    const names = fallbackSchedule.subjects.map((subject) => subject.name);
    expect(names).toContain('Основи фреймворку Скрам');
    expect(names).toContain('Кваліфікаційна робота');
    expect(names).not.toContain('Інформаційна безпека цільових систем');
  });
});
