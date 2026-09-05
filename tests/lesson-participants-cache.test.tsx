// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSchedule } from '@/hooks/use-schedule';
import {
  clearScheduleCache,
  fetchSchedule,
  readCachedSchedule,
} from '@/lib/schedule/repository';
import type { UserSchedule } from '@/lib/schedule/types';
import { createTestBackend } from './support/apps-script-backend';

vi.hoisted(() =>
  vi.stubEnv('VITE_SCHEDULE_API_URL', 'https://scheduler.test/exec'),
);

let backend: ReturnType<typeof createTestBackend>;
const semester = 'SEM-2026-FALL';

beforeEach(() => {
  localStorage.clear();
  backend = createTestBackend();
  const data = backend.snapshot();
  data.Users.push({
    ...data.Users[0],
    user_id: 'U002',
    slug: 'second-profile',
    display_name: 'Second Profile',
    role: 'user',
    edit_token_hash: '',
  });
  data.UserPreferences.push({
    ...data.UserPreferences[0],
    user_id: 'U002',
  });
  data.Enrollments.push({
    enrollment_id: 'ENR-U002-SCRUM',
    user_id: 'U002',
    offering_id: 'OFF-SCRUM-26',
    group_id: 'GR-SCRUM-2',
    active: 'yes',
  });
  backend.replaceDatabase(data);
  vi.stubGlobal('fetch', vi.fn(backend.fetch));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function withoutEmbeddedChecks(key: string) {
  const schedule = JSON.parse(localStorage.getItem(key)!) as UserSchedule;
  delete schedule.lessonParticipants;
  delete schedule.participantUserCount;
  localStorage.setItem(key, JSON.stringify(schedule));
}

describe('participant checks cache', () => {
  it('stores and restores checks separately for profiles with different courses', async () => {
    const first = await fetchSchedule('ermolz', semester);
    const second = await fetchSchedule('second-profile', semester);
    const firstKey = `scheduler_participants_v1:ermolz:${semester}`;
    const secondKey = `scheduler_participants_v1:second-profile:${semester}`;
    expect(localStorage.getItem(firstKey)).toBeTruthy();
    expect(localStorage.getItem(secondKey)).toBeTruthy();

    const secondLessonIds = new Set(second.lessons.map((lesson) => lesson.id));
    expect(second.lessonParticipants?.every((entry) =>
      secondLessonIds.has(entry.lessonId))).toBe(true);
    expect(first.lessonParticipants?.some((entry) =>
      !secondLessonIds.has(entry.lessonId))).toBe(true);

    const secondScheduleKey = `scheduler_cache_v1:second-profile:${semester}`;
    withoutEmbeddedChecks(secondScheduleKey);
    expect(readCachedSchedule('second-profile', semester)).toMatchObject({
      user: { slug: 'second-profile' },
      lessonParticipants: second.lessonParticipants,
      participantUserCount: second.participantUserCount,
    });

    localStorage.setItem(secondKey, localStorage.getItem(firstKey)!);
    const isolated = readCachedSchedule('second-profile', semester);
    expect(isolated?.lessonParticipants).toBeUndefined();
    expect(isolated?.participantUserCount).toBeUndefined();
  });

  it('refreshes an old profile cache that has no participant checks', async () => {
    await fetchSchedule('ermolz', semester);
    const scheduleKey = `scheduler_cache_v1:ermolz:${semester}`;
    withoutEmbeddedChecks(scheduleKey);
    localStorage.removeItem(`scheduler_participants_v1:ermolz:${semester}`);
    backend.calls.length = 0;

    const { result } = renderHook(() =>
      useSchedule({ userSlug: 'ermolz', semesterId: semester }),
    );
    await waitFor(() => expect(result.current.source).toBe('remote'));
    expect(result.current.schedule.lessonParticipants?.length).toBeGreaterThan(0);
    expect(backend.calls.filter((call) => call.action === 'schedule')).toHaveLength(1);
  });

  it('clears participant checks together with schedule cache', async () => {
    await fetchSchedule('ermolz', semester);
    expect(localStorage.getItem(
      `scheduler_participants_v1:ermolz:${semester}`,
    )).toBeTruthy();
    clearScheduleCache();
    expect(localStorage.getItem(
      `scheduler_participants_v1:ermolz:${semester}`,
    )).toBeNull();
  });
});
