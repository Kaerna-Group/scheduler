import { describe, expect, it } from 'vitest';

import { fallbackSchedule } from '@/data/fallback-schedule';
import { buildLlmImportPrompt, scheduleImportExample } from '@/lib/schedule/import-guide';
import { exportSchedule, validateScheduleImport } from '@/lib/schedule/import';
import { mergeScheduleUsers } from '@/lib/schedule/repository';
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
      subject.name === 'Qualification Project' && subject.lessons?.length === 0,
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
    expect(validation.errors.some((error) => error.includes('duplicated'))).toBe(true);
    expect(validation.errors.some((error) => error.includes('outside'))).toBe(true);
  });

  it('validates subject colors and assigns the shared palette when omitted', () => {
    const invalid = validateScheduleImport({ schemaVersion: 1, semesterId: 'SEM-2026-FALL', subjects: [{ externalCode: 'A', name: 'A', color: 'red', lessons: [] }] });
    expect(invalid.errors.some((error) => error.includes('#RRGGBB'))).toBe(true);
    const withoutColor = validateScheduleImport({ schemaVersion: 1, semesterId: 'SEM-2026-FALL', subjects: [{ externalCode: 'A', name: 'A', lessons: [] }] });
    expect(withoutColor.value?.subjects[0].color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('keeps the published example and LLM prompt aligned with schema v1', () => {
    expect(validateScheduleImport(scheduleImportExample, 14).errors).toEqual([]);
    const prompt = buildLlmImportPrompt('SEM-2026-FALL', 14);
    expect(prompt).toContain('ONLY valid JSON');
    expect(prompt).toContain('"semesterId": "SEM-2026-FALL"');
    expect(prompt).toContain('from 1 to 14');
    expect(prompt).toContain('One lesson object');
    expect(prompt).toContain("selectedGroup is the user's personal choice");
    expect(prompt).toContain('the server preserves known groups');
  });
});

describe('seed fixtures', () => {
  it('contains Scrum and qualification work but no target-security course', () => {
    const names = fallbackSchedule.subjects.map((subject) => subject.name);
    expect(names).toContain('Scrum Framework Fundamentals');
    expect(names).toContain('Qualification Project');
    expect(names).not.toContain('Target Systems Information Security');
  });

  it('contains the corrected Scrum lecture and all three groups only on weeks 1–7', () => {
    const scrum = fallbackSchedule.subjects.find((subject) => subject.id === 'scrum-framework');
    const scrumLessons = fallbackSchedule.lessons.filter((lesson) => lesson.subjectId === scrum?.id);
    expect(scrum).toMatchObject({ selectedGroup: 3, availableGroups: [1, 2, 3] });
    expect(scrumLessons).toHaveLength(4);
    expect(scrumLessons.map((lesson) => [lesson.type, lesson.group, lesson.startTime, lesson.endTime])).toEqual([
      ['lecture', undefined, '10:00', '11:20'],
      ['group', 1, '11:40', '13:00'],
      ['group', 2, '13:30', '14:50'],
      ['group', 3, '15:00', '16:20'],
    ]);
    scrumLessons.forEach((lesson) => {
      expect(lesson.day).toBe('thursday');
      expect(lesson.weeks).toEqual([1, 2, 3, 4, 5, 6, 7]);
      expect(lesson.format).toBe('online');
      expect(lesson.teacher).toBe('O. O. Paliienko');
    });
  });

  it('merges cached user lists by slug and keeps the newest profile', () => {
    const merged = mergeScheduleUsers(
      [{ id: '1', slug: 'anna', displayName: 'Anna', role: 'user' }],
      [
        { id: '1', slug: 'anna', displayName: 'Anna Updated', role: 'editor' },
        { id: '2', slug: 'bohdan', displayName: 'Bohdan', role: 'user' },
      ],
    );
    expect(merged).toHaveLength(2);
    expect(merged.find((user) => user.slug === 'anna')).toMatchObject({ displayName: 'Anna Updated', role: 'editor' });
  });

});
