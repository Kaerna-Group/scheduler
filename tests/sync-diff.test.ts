import { describe, expect, it } from 'vitest';
import { fallbackSchedule } from '@/data/fallback-schedule';
import { compareScheduleSync, syncDiffSummary } from '@/lib/schedule/sync-diff';
import { formatWeeks } from '@/lib/schedule/weeks';
import type { UserSchedule } from '@/lib/schedule/types';

const oldTime = '2026-09-02T09:00:00Z';
const newTime = '2026-09-02T10:00:00Z';
const schedule = () => structuredClone(fallbackSchedule);
const compare = (before: UserSchedule | null, after: UserSchedule) =>
  compareScheduleSync(before, after, oldTime, newTime);

describe('previous synchronization DTO comparison', () => {
  it('counts changed lesson rules once and describes each changed field', () => {
    const before = schedule();
    const after = schedule();
    after.revision = 2;
    after.lessons[0].room = '2-202';
    after.lessons[0].teacher = 'New teacher';
    after.lessons[0].weeks = [4, 5, 6, 7];
    after.lessons[1].day = 'friday';
    after.lessons[1].startTime = '10:00';
    after.lessons[1].endTime = '11:20';
    const result = compare(before, after)!;
    expect(result.lessons).toHaveLength(2);
    expect(result.subjects).toEqual([]);
    expect(result.semester).toEqual([]);
    expect(syncDiffSummary(result)).toBe('2 classes changed');
    expect(
      result.lessons.find((item) => item.id === after.lessons[0].id)?.fields,
    ).toEqual([
      { label: 'Weeks', before: '4–12', after: '4–7' },
      { label: 'Room', before: '1-001', after: '2-202' },
      { label: 'Teacher', before: 'I. Raiets', after: 'New teacher' },
    ]);
    expect(result).toMatchObject({
      fromRevision: 0,
      toRevision: 2,
      previousSync: oldTime,
      syncedAt: newTime,
      userSlug: after.user.slug,
      semesterId: after.semester.id,
    });
  });

  it('classifies added and removed rules and retains useful removed context', () => {
    const before = schedule();
    const after = schedule();
    const removed = after.lessons.shift()!;
    after.lessons.push({ ...after.lessons[0], id: 'new-rule', room: '3-303' });
    const result = compare(before, after)!;
    expect(result.lessons).toHaveLength(2);
    expect(result.lessons.find((item) => item.id === removed.id)).toMatchObject(
      { kind: 'removed', context: expect.stringContaining('1-001') },
    );
    expect(result.lessons.find((item) => item.id === 'new-rule')).toMatchObject(
      { kind: 'added', context: expect.stringContaining('3-303') },
    );
  });

  it('keeps subject-only enrollment additions/removals even without lessons', () => {
    const before = schedule();
    const after = schedule();
    const noLessons = before.subjects.find(
      (subject) =>
        !before.lessons.some((lesson) => lesson.subjectId === subject.id),
    )!;
    after.subjects = after.subjects.filter(
      (subject) => subject.id !== noLessons.id,
    );
    after.subjects.push({
      id: 'new-empty',
      name: 'New course',
      shortName: 'New',
      color: '#123456',
    });
    const result = compare(before, after)!;
    expect(result.lessons).toEqual([]);
    expect(result.subjects).toHaveLength(2);
    expect(syncDiffSummary(result)).toBe('2 courses changed');
    expect(result.subjects.find((item) => item.id === noLessons.id)?.kind).toBe(
      'removed',
    );
    expect(result.subjects.find((item) => item.id === 'new-empty')?.kind).toBe(
      'added',
    );
  });

  it('lists a renamed course once, not one fake lesson change for every rule', () => {
    const before = schedule();
    const after = schedule();
    after.subjects[0].name = 'New course name';
    after.subjects[0].shortName = 'New short name';
    after.subjects[0].externalCode = 'NEW-CODE';
    const result = compare(before, after)!;
    expect(result.lessons).toEqual([]);
    expect(result.subjects).toHaveLength(1);
    expect(result.subjects[0].fields.map((field) => field.label)).toEqual([
      'Name',
      'Short name',
      'Course code',
    ]);
    expect(syncDiffSummary(result)).toBe('1 course changed');
  });

  it('shows selected group changes separately from the added/removed personal lessons', () => {
    const before = schedule();
    const after = schedule();
    after.subjects[0].selectedGroup = 2;
    expect(compare(before, after)?.subjects[0].fields).toEqual([
      { label: 'Selected group', before: '5', after: '2' },
    ]);
  });

  it('describes course reassignment, lesson type, group, format and an emptied room', () => {
    const before = schedule();
    const after = schedule();
    after.lessons[0] = {
      ...after.lessons[0],
      subjectId: after.subjects[1].id,
      type: 'lecture',
      group: undefined,
      format: 'online',
      room: undefined,
    };
    const result = compare(before, after)!;
    expect(result.lessons[0].fields.map((field) => field.label)).toEqual([
      'Course',
      'Type',
      'Group',
      'Room',
      'Format',
    ]);
    expect(
      result.lessons[0].fields.find((field) => field.label === 'Room'),
    ).toEqual({ label: 'Room', before: '1-001', after: 'Not set' });
  });

  it('ignores revision, preferences, profiles, other users/semesters and visual metadata', () => {
    const before = schedule();
    const after = schedule();
    after.revision = 123;
    after.preferencesRevision = 456;
    after.preferencesExists = true;
    after.users.reverse();
    after.user.displayName = 'Renamed user';
    after.user.role = 'user';
    after.currentSemesterId = 'another-semester';
    after.semesters = [];
    after.subjects[0].availableGroups = [1, 2, 3, 4, 5, 6];
    after.subjects[0].color = '#abcdef';
    after.subjects[0].offeringId = 'different-internal-id';
    after.lessons[0].offeringId = 'different-internal-id';
    expect(compare(before, after)).toBeNull();
  });

  it('ignores array order, duplicated week values and empty-versus-missing room', () => {
    const before = schedule();
    const after = schedule();
    after.lessons.reverse();
    after.subjects.reverse();
    for (const lesson of after.lessons) {
      lesson.weeks = [...lesson.weeks].reverse().concat(lesson.weeks[0]);
      if (lesson.room === undefined) lesson.room = '';
    }
    expect(compare(before, after)).toBeNull();
  });

  it('compares semantic data even when the backend revision did not change', () => {
    const before = schedule();
    const after = schedule();
    after.lessons[0].room = 'Changed directly in sheet';
    expect(compare(before, after)?.lessons).toHaveLength(1);
  });

  it('reports semester date, length and title changes without inventing per-lesson changes', () => {
    const before = schedule();
    const after = schedule();
    after.semester.startDate = '2026-09-07';
    after.semester.title = 'Updated semester';
    after.semester.weeksCount = 16;
    const result = compare(before, after)!;
    expect(result.lessons).toEqual([]);
    expect(result.semester.map((field) => field.label)).toEqual([
      'Title',
      'Start date',
      'Week count',
    ]);
    expect(syncDiffSummary(result)).toBe('Semester changed');
  });

  it.each(['user id', 'user slug', 'semester'])(
    'never compares different %s targets',
    (target) => {
      const before = schedule();
      const after = schedule();
      after.lessons = [];
      if (target === 'user id') after.user.id = 'another-id';
      if (target === 'user slug') after.user.slug = 'another-user';
      if (target === 'semester') after.semester.id = 'another-semester';
      expect(compare(before, after)).toBeNull();
    },
  );

  it.each([
    'null',
    'missing arrays',
    'duplicate lesson',
    'duplicate subject',
    'invalid weeks',
    'missing subject',
  ])('ignores an invalid previous snapshot: %s', (kind) => {
    const before = schedule();
    const after = schedule();
    after.lessons = [];
    if (kind === 'null') expect(compare(null, after)).toBeNull();
    else {
      if (kind === 'missing arrays') Reflect.deleteProperty(before, 'lessons');
      if (kind === 'duplicate lesson') before.lessons.push(before.lessons[0]);
      if (kind === 'duplicate subject')
        before.subjects.push(before.subjects[0]);
      if (kind === 'invalid weeks') before.lessons[0].weeks = [999];
      if (kind === 'missing subject') before.lessons[0].subjectId = 'missing';
      expect(compare(before, after)).toBeNull();
    }
  });

  it('does not leak extra fields and does not mutate either DTO', () => {
    const before = schedule();
    const after = schedule();
    Object.assign(after, { editToken: 'secret-token', secret: 'private data' });
    after.lessons[0].room = 'New';
    const originalBefore = structuredClone(before);
    const originalAfter = structuredClone(after);
    const result = compare(before, after)!;
    expect(JSON.stringify(result)).not.toContain('secret-token');
    expect(JSON.stringify(result)).not.toContain('private data');
    expect(before).toEqual(originalBefore);
    expect(after).toEqual(originalAfter);
  });

  it('does not guess identity when a replace import recreates a rule', () => {
    const before = schedule();
    const after = schedule();
    after.lessons[0].id = 'recreated-rule';
    expect(
      compare(before, after)
        ?.lessons.map((item) => item.kind)
        .sort(),
    ).toEqual(['added', 'removed']);
  });

  it.each([
    { value: [1, 2, 3, 4, 5, 6, 7], text: '1–7' },
    { value: [7, 1, 2, 3, 5, 6, 6], text: '1–3, 5–7' },
    { value: [1, 3, 5], text: '1, 3, 5' },
    { value: [1], text: '1' },
    { value: [], text: '' },
  ])('formats exact weeks as compact ranges: $text', ({ value, text }) => {
    expect(formatWeeks(value)).toBe(text);
  });
});
