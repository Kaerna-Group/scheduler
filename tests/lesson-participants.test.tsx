// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getApi } from '@/lib/api/client';
import { useLessonParticipants } from '@/hooks/use-lesson-participants';
import {
  fetchParticipantSchedule,
  getLessonParticipants,
} from '@/lib/schedule/participants';
import type { UserSchedule } from '@/lib/schedule/types';

vi.mock('@/lib/api/client', () => ({ getApi: vi.fn() }));
const owner: UserSchedule = {
  user: { id: 'U1', slug: 'owner', displayName: 'Owner', role: 'user' },
  users: [
    { id: 'U1', slug: 'owner', displayName: 'Owner', role: 'user' },
    { id: 'U2', slug: 'classmate', displayName: 'Classmate', role: 'user' },
  ],
  semester: {
    id: 'SEM-FALL',
    title: 'Fall',
    startDate: '2026-09-01',
    weeksCount: 14,
  },
  revision: 7,
  subjects: [
    {
      id: 'scrum',
      offeringId: 'OFF-SCRUM',
      externalCode: '123',
      name: 'Scrum',
      shortName: 'Scrum',
      color: '#112233',
      selectedGroup: 3,
    },
  ],
  lessons: [
    {
      id: 'lecture',
      subjectId: 'scrum',
      type: 'lecture',
      day: 'thursday',
      startTime: '10:00',
      endTime: '11:20',
      weeks: [1, 3, 5],
      teacher: 'Teacher',
      format: 'online',
    },
    {
      id: 'practice',
      subjectId: 'scrum',
      type: 'group',
      group: 3,
      day: 'thursday',
      startTime: '11:40',
      endTime: '13:00',
      weeks: [1, 3, 5],
      teacher: 'Teacher',
      format: 'online',
    },
  ],
};
function peer(): UserSchedule {
  return { ...structuredClone(owner), user: owner.users[1] };
}
const props = {
  schedule: owner,
  ready: true,
  online: true,
  remoteConfigured: true,
  cached: false,
};
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('shared class matching', () => {
  it('includes both users only on common weeks, independent of rule IDs and duplicate matches', () => {
    const other = peer();
    other.lessons = [
      { ...other.lessons[0], id: 'different-id', weeks: [3] },
      { ...other.lessons[0], weeks: [3] },
    ];
    expect(
      getLessonParticipants(owner, [other, other], owner.lessons[0], 3).map(
        (user) => user.slug,
      ),
    ).toEqual(['owner', 'classmate']);
    expect(getLessonParticipants(owner, [other], owner.lessons[0], 1)).toEqual([
      owner.user,
    ]);
    expect(getLessonParticipants(owner, [other], owner.lessons[0], 2)).toEqual(
      [],
    );
  });

  it('does not mix simultaneous practices from different groups or bundled lessons outside the selected group', () => {
    const other = peer();
    other.subjects[0].selectedGroup = 2;
    other.lessons[1].group = 2;
    expect(getLessonParticipants(owner, [other], owner.lessons[1], 3)).toEqual([
      owner.user,
    ]);
    expect(
      getLessonParticipants(owner, [other], owner.lessons[0], 3),
    ).toHaveLength(2);
    other.lessons[1].group = 3;
    expect(getLessonParticipants(owner, [other], owner.lessons[1], 3)).toEqual([
      owner.user,
    ]);
  });

  it.each([
    'course',
    'day',
    'start',
    'end',
    'type',
    'semester',
    'dates',
    'enrollment',
  ] as const)('rejects a mismatched %s', (field) => {
    const other = peer();
    if (field === 'course') other.subjects[0].offeringId = 'OTHER';
    if (field === 'day') other.lessons[0].day = 'friday';
    if (field === 'start') other.lessons[0].startTime = '10:05';
    if (field === 'end') other.lessons[0].endTime = '11:25';
    if (field === 'type') {
      other.lessons[0].type = 'group';
      other.lessons[0].group = 3;
    }
    if (field === 'semester') other.semester.id = 'SEM-OTHER';
    if (field === 'dates') other.semester.startDate = '2027-02-01';
    if (field === 'enrollment') other.subjects = [];
    expect(getLessonParticipants(owner, [other], owner.lessons[0], 3)).toEqual([
      owner.user,
    ]);
  });
});

describe('participant schedule loading', () => {
  it('reads each peer once per revision, shares data between cards, and leaves preferences and sync caches untouched', async () => {
    vi.mocked(getApi).mockResolvedValue(peer());
    localStorage.setItem('unrelated', 'keep');
    const { result, rerender } = renderHook(useLessonParticipants, {
      initialProps: props,
    });
    await waitFor(() =>
      expect(result.current(owner.lessons[0], 3).users).toHaveLength(2),
    );
    expect(result.current(owner.lessons[1], 3).users).toHaveLength(2);
    expect(result.current(owner.lessons[0], 3).incomplete).toBe(false);
    rerender({ ...props });
    expect(getApi).toHaveBeenCalledTimes(1);
    expect(getApi).toHaveBeenCalledWith(
      { action: 'schedule', user: 'classmate', semester: 'SEM-FALL' },
      expect.any(AbortSignal),
    );
    expect(Object.keys(localStorage)).toEqual(['unrelated']);
    rerender({ ...props, schedule: structuredClone(owner) });
    await waitFor(() =>
      expect(result.current(owner.lessons[0], 3).users).toHaveLength(2),
    );
    expect(getApi).toHaveBeenCalledTimes(1);
    const next = { ...peer(), revision: 8, lessons: [] };
    vi.mocked(getApi).mockResolvedValue(next);
    rerender({ ...props, schedule: { ...owner, revision: 8 } });
    await waitFor(() =>
      expect(result.current(owner.lessons[0], 3).incomplete).toBe(false),
    );
    expect(result.current(owner.lessons[0], 3).users).toHaveLength(1);
    expect(getApi).toHaveBeenCalledTimes(2);
  });

  it('cancels and ignores a late reply when the selected semester changes', async () => {
    let release!: (value: UserSchedule) => void;
    vi.mocked(getApi).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const { result, rerender } = renderHook(useLessonParticipants, {
      initialProps: props,
    });
    const signal = vi.mocked(getApi).mock.calls[0][1];
    vi.mocked(getApi).mockResolvedValue({
      ...peer(),
      semester: { ...owner.semester, id: 'SEM-NEXT' },
      lessons: [],
    });
    rerender({
      ...props,
      schedule: { ...owner, semester: { ...owner.semester, id: 'SEM-NEXT' } },
    });
    expect(signal?.aborted).toBe(true);
    await act(async () => release(peer()));
    await waitFor(() =>
      expect(result.current(owner.lessons[0], 3).incomplete).toBe(false),
    );
    expect(result.current(owner.lessons[0], 3).users).toHaveLength(1);
  });

  it('uses same-revision saved schedules offline and marks the list as cached', () => {
    localStorage.setItem(
      'scheduler_cache_v1:classmate:SEM-FALL',
      JSON.stringify(peer()),
    );
    const { result } = renderHook(useLessonParticipants, {
      initialProps: { ...props, online: false, cached: true },
    });
    expect(result.current(owner.lessons[0], 3)).toMatchObject({
      cached: true,
      incomplete: false,
    });
    expect(result.current(owner.lessons[0], 3).users).toHaveLength(2);
    expect(getApi).not.toHaveBeenCalled();
  });

  it('does not invent participants for uncached, failed or inconsistent responses', async () => {
    vi.mocked(getApi).mockRejectedValue(new Error('Offline'));
    const { result, rerender } = renderHook(useLessonParticipants, {
      initialProps: { ...props, online: false },
    });
    expect(result.current(owner.lessons[0], 3).users).toHaveLength(1);
    expect(result.current(owner.lessons[0], 3).incomplete).toBe(true);
    expect(getApi).not.toHaveBeenCalled();
    rerender(props);
    await waitFor(() => expect(getApi).toHaveBeenCalledTimes(1));
    expect(result.current(owner.lessons[0], 3).users).toHaveLength(1);
    vi.mocked(getApi).mockResolvedValue(owner);
    await expect(
      fetchParticipantSchedule(
        owner.users[1],
        owner.semester.id,
        new AbortController().signal,
      ),
    ).rejects.toThrow('does not match');
  });
});
