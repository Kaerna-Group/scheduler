import { useMemo } from 'react';
import {
  getLessonParticipants,
  type ParticipantsForLesson,
} from '@/lib/schedule/participants';
import type { UserSchedule } from '@/lib/schedule/types';

export function useLessonParticipants({
  schedule,
  ready,
  online,
  remoteConfigured,
  cached,
  loading,
}: {
  schedule: UserSchedule;
  ready: boolean;
  online: boolean;
  remoteConfigured: boolean;
  cached: boolean;
  loading: boolean;
}): ParticipantsForLesson {
  return useMemo(
    () => (lesson, week) => {
      const total = schedule.participantUserCount ?? schedule.users.length;
      if (loading) return { users: [], state: 'checking', checked: 0, total };
      if (
        !ready ||
        !schedule.lessonParticipants ||
        schedule.participantUserCount === undefined
      )
        return { users: [], state: 'unavailable', checked: 0, total };
      return {
        users: getLessonParticipants(schedule, lesson, week),
        state: cached || !online || !remoteConfigured ? 'stale' : 'complete',
        checked: total,
        total,
      };
    },
    [schedule, ready, loading, online, remoteConfigured, cached],
  );
}
