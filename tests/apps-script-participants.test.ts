import { describe, expect, it } from 'vitest';
import type { UserSchedule } from '@/lib/schedule/types';
import { createTestBackend } from './support/apps-script-backend';

function addUser(
  data: Record<string, Array<Record<string, string>>>,
  id: string,
  slug: string,
  name: string,
  offering: string,
  groupId: string,
) {
  data.Users.push({
    ...data.Users[0],
    user_id: id,
    slug,
    display_name: name,
    role: 'user',
    edit_token_hash: '',
  });
  data.UserPreferences.push({ ...data.UserPreferences[0], user_id: id });
  data.Enrollments.push({
    enrollment_id: `ENR-${id}`,
    user_id: id,
    offering_id: offering,
    group_id: groupId,
    active: 'yes',
  });
}

describe('backend participant projection', () => {
  it('identifies one multi-group lesson by lesson ID for users in both allowed groups', () => {
    const backend = createTestBackend();
    const data = backend.snapshot();
    addUser(
      data,
      'U002',
      'group-two',
      'Group Two',
      'OFF-SCRUM-26',
      'GR-SCRUM-2',
    );
    const shared = data.Lessons.find(
      (row) => row.lesson_id === 'LES-SCRUM-G3',
    )!;
    shared.start_time = '11:40';
    shared.end_time = '13:00';
    data.LessonGroups.push({
      lesson_id: shared.lesson_id,
      group_id: 'GR-SCRUM-2',
    });
    backend.replaceDatabase(data);
    const first = backend.buildSchedule('ermolz') as UserSchedule;
    const second = backend.buildSchedule('group-two') as UserSchedule;
    const occurrence = (value: UserSchedule) =>
      value.lessonParticipants?.find(
        (entry) => entry.lessonId === shared.lesson_id && entry.week === 1,
      );
    expect(
      first.lessons.find((lesson) => lesson.id === shared.lesson_id),
    ).toMatchObject({ group: 3, groups: [2, 3] });
    expect(
      second.lessons.find((lesson) => lesson.id === shared.lesson_id),
    ).toMatchObject({ group: 2, groups: [2, 3] });
    expect(occurrence(first)?.userIds).toEqual(['U001', 'U002']);
    expect(occurrence(second)?.userIds).toEqual(['U001', 'U002']);
  });

  it('keeps simultaneous restricted lectures separate by canonical lesson ID', () => {
    const backend = createTestBackend();
    const data = backend.snapshot();
    addUser(
      data,
      'U002',
      'group-two',
      'Group Two',
      'OFF-SCRUM-26',
      'GR-SCRUM-2',
    );
    const original = data.Lessons.find(
      (row) => row.lesson_id === 'LES-SCRUM-LECTURE',
    )!;
    const separate = {
      ...original,
      lesson_id: 'LES-SCRUM-LECTURE-G2',
      teacher: 'Another teacher',
      room: '2-202',
    };
    data.Lessons.push(separate);
    data.LessonGroups.push(
      { lesson_id: original.lesson_id, group_id: 'GR-SCRUM-3' },
      { lesson_id: separate.lesson_id, group_id: 'GR-SCRUM-2' },
    );
    data.LessonWeeks.filter(
      (row) => row.lesson_id === original.lesson_id,
    ).forEach((row) =>
      data.LessonWeeks.push({ ...row, lesson_id: separate.lesson_id }),
    );
    backend.replaceDatabase(data);
    const first = backend.buildSchedule('ermolz') as UserSchedule;
    const second = backend.buildSchedule('group-two') as UserSchedule;
    expect(first.lessons.map((lesson) => lesson.id)).toContain(
      original.lesson_id,
    );
    expect(first.lessons.map((lesson) => lesson.id)).not.toContain(
      separate.lesson_id,
    );
    expect(second.lessons.map((lesson) => lesson.id)).toContain(
      separate.lesson_id,
    );
    expect(second.lessons.map((lesson) => lesson.id)).not.toContain(
      original.lesson_id,
    );
    expect(
      first.lessonParticipants?.find(
        (entry) => entry.lessonId === original.lesson_id && entry.week === 1,
      )?.userIds,
    ).toEqual(['U001']);
    expect(
      second.lessonParticipants?.find(
        (entry) => entry.lessonId === separate.lesson_id && entry.week === 1,
      )?.userIds,
    ).toEqual(['U002']);
  });

  it('includes only active enrolled users and omits weeks when the lesson does not occur', () => {
    const backend = createTestBackend();
    const schedule = backend.buildSchedule('ermolz') as UserSchedule;
    const lecture = schedule.lessonParticipants?.find(
      (entry) => entry.lessonId === 'LES-SCRUM-LECTURE' && entry.week === 1,
    );
    expect(lecture?.userIds).toEqual(['U001']);
    expect(
      schedule.lessonParticipants?.some(
        (entry) => entry.lessonId === 'LES-SCRUM-LECTURE' && entry.week === 8,
      ),
    ).toBe(false);
    expect(schedule.participantUserCount).toBe(1);
  });

  it('returns the participant projection in one cached schedule response', async () => {
    const backend = createTestBackend();
    const url =
      'https://scheduler.test/exec?action=schedule&user=ermolz&semester=SEM-2026-FALL&apiVersion=1';
    const first = (await (await backend.fetch(url)).json()) as {
      ok: boolean;
      data: UserSchedule;
    };
    const second = (await (await backend.fetch(url)).json()) as {
      ok: boolean;
      data: UserSchedule;
    };
    expect(first.ok).toBe(true);
    expect(first.data.lessonParticipants?.length).toBeGreaterThan(0);
    expect(first.data).toEqual(second.data);
    expect(backend.calls).toHaveLength(2);
    expect(backend.cache.calls.some((call) => call.operation === 'put')).toBe(
      true,
    );
  });

  it('reports duplicate subjects and enrollment problems without merging them', () => {
    const backend = createTestBackend();
    const data = backend.snapshot();
    data.Subjects.push({
      ...data.Subjects[0],
      subject_id: 'SUB-DUPLICATE',
      name: `  ${data.Subjects[0].name.toUpperCase()}  `,
    });
    data.Enrollments.push({
      ...data.Enrollments[0],
      enrollment_id: 'ENR-DUPLICATE',
    });
    data.Enrollments.push({
      ...data.Enrollments[0],
      enrollment_id: 'ENR-BAD-GROUP',
      offering_id: 'OFF-SCRUM-26',
    });
    backend.replaceDatabase(data);
    const response = backend.post({
      action: 'adminOverview',
      apiVersion: 1,
      editToken: backend.token,
    }) as { ok: boolean; data: { diagnostics: Array<{ code: string }> } };
    expect(response.ok).toBe(true);
    expect(response.data.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        'DUPLICATE_SUBJECTS',
        'DUPLICATE_ENROLLMENTS',
        'ENROLLMENT_GROUPS',
      ]),
    );
    expect(data.Subjects).toHaveLength(9);
  });
});
