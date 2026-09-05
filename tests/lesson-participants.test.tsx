// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useLessonParticipants } from '@/hooks/use-lesson-participants';
import { getLessonParticipants } from '@/lib/schedule/participants';
import type { UserSchedule } from '@/lib/schedule/types';

const schedule: UserSchedule = {
  user: { id: 'U1', slug: 'owner', displayName: 'Owner', role: 'user' },
  users: [
    { id: 'U1', slug: 'owner', displayName: 'Owner', role: 'user' },
    { id: 'U2', slug: 'second', displayName: 'Second', role: 'user' },
    { id: 'U3', slug: 'third', displayName: 'Third', role: 'user' },
  ],
  semester: {
    id: 'SEM',
    title: 'Semester',
    startDate: '2026-09-01',
    weeksCount: 14,
  },
  subjects: [
    { id: 'course', name: 'Course', shortName: 'Course', color: '#123456' },
  ],
  lessons: [
    {
      id: 'L1',
      subjectId: 'course',
      type: 'lecture',
      day: 'monday',
      startTime: '10:00',
      endTime: '11:20',
      weeks: [1, 2],
      format: 'online',
      teacher: 'Teacher',
    },
  ],
  lessonParticipants: [
    { lessonId: 'L1', week: 1, userIds: ['U1', 'U2'] },
    { lessonId: 'L1', week: 2, userIds: ['U1'] },
  ],
  participantUserCount: 3,
  revision: 4,
};
afterEach(cleanup);

describe('canonical lesson participants', () => {
  it('uses only the backend lesson and week key and ignores unknown user IDs', () => {
    expect(
      getLessonParticipants(schedule, schedule.lessons[0], 1).map(
        (user) => user.id,
      ),
    ).toEqual(['U1', 'U2']);
    expect(
      getLessonParticipants(schedule, schedule.lessons[0], 2).map(
        (user) => user.id,
      ),
    ).toEqual(['U1']);
    expect(
      getLessonParticipants(
        {
          ...schedule,
          lessonParticipants: [
            { lessonId: 'L1', week: 1, userIds: ['U1', 'UNKNOWN'] },
          ],
        },
        schedule.lessons[0],
        1,
      ),
    ).toEqual([schedule.user]);
    expect(
      getLessonParticipants(schedule, { ...schedule.lessons[0], id: 'L2' }, 1),
    ).toEqual([]);
  });

  it.each([
    {
      name: 'checking',
      patch: { loading: true },
      state: 'checking',
      checked: 0,
    },
    { name: 'complete', patch: {}, state: 'complete', checked: 3 },
    { name: 'stale', patch: { cached: true }, state: 'stale', checked: 3 },
    {
      name: 'unavailable',
      patch: {
        schedule: {
          ...schedule,
          lessonParticipants: undefined,
          participantUserCount: undefined,
        },
      },
      state: 'unavailable',
      checked: 0,
    },
  ] as const)(
    'reports $name independently from the avatar count',
    ({ patch, state, checked }) => {
      const props = {
        schedule,
        ready: true,
        loading: false,
        online: true,
        remoteConfigured: true,
        cached: false,
        ...patch,
      };
      const { result } = renderHook(() => useLessonParticipants(props));
      expect(result.current(schedule.lessons[0], 2)).toMatchObject({
        state,
        checked,
        total: 3,
      });
    },
  );
});
