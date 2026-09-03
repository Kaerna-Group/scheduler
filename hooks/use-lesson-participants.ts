import { useEffect, useMemo, useRef, useState } from 'react';
import { readCachedSchedule } from '@/lib/schedule/repository';
import {
  fetchParticipantSchedule,
  getLessonParticipants,
  type ParticipantSchedule,
  type ParticipantsForLesson,
} from '@/lib/schedule/participants';
import type { UserSchedule } from '@/lib/schedule/types';

export function useLessonParticipants({
  schedule,
  ready,
  online,
  remoteConfigured,
  cached,
}: {
  schedule: UserSchedule;
  ready: boolean;
  online: boolean;
  remoteConfigured: boolean;
  cached: boolean;
}): ParticipantsForLesson {
  const cache = useRef(new Map<string, ParticipantSchedule>());
  const [snapshot, setSnapshot] = useState<{
    owner: UserSchedule;
    peers: ParticipantSchedule[];
    incomplete: boolean;
  } | null>(null);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    const users = [
      ...new Map(
        schedule.users
          .filter((user) => user.id !== schedule.user.id)
          .map((user) => [user.id, user]),
      ).values(),
    ];
    const peers: ParticipantSchedule[] = [];
    let remaining = users.length;
    let failed = false;
    const publish = () => {
      if (!controller.signal.aborted)
        setSnapshot({
          owner: schedule,
          peers: [...peers],
          incomplete: failed || remaining > 0,
        });
    };
    const pending = users.filter((user) => {
      const key = JSON.stringify([user.id, user.slug, schedule.semester.id]);
      const saved =
        cache.current.get(key) ??
        readCachedSchedule(user.slug, schedule.semester.id);
      if (
        saved &&
        saved.user.id === user.id &&
        saved.user.slug === user.slug &&
        saved.semester.id === schedule.semester.id &&
        saved.revision === schedule.revision
      ) {
        peers.push(saved);
        remaining--;
        return false;
      }
      return true;
    });
    publish();
    if (online && remoteConfigured) {
      // One read per other user and revision, shared by every card; limit concurrency.
      let next = 0;
      const worker = async () => {
        while (next < pending.length && !controller.signal.aborted) {
          const user = pending[next++];
          try {
            const peer = await fetchParticipantSchedule(
              user,
              schedule.semester.id,
              controller.signal,
            );
            if (controller.signal.aborted) return;
            if (peer.revision !== schedule.revision)
              throw new Error('Schedule revisions differ.');
            cache.current.set(
              JSON.stringify([user.id, user.slug, schedule.semester.id]),
              peer,
            );
            peers.push(peer);
          } catch {
            if (controller.signal.aborted) return;
            failed = true;
          }
          remaining--;
          publish();
        }
      };
      void Promise.all(
        Array.from({ length: Math.min(3, pending.length) }, worker),
      );
    }
    return () => controller.abort();
  }, [schedule, ready, online, remoteConfigured]);

  return useMemo(
    () => (lesson, week) => {
      const current = ready && snapshot?.owner === schedule ? snapshot : null;
      return {
        users: current
          ? getLessonParticipants(schedule, current.peers, lesson, week)
          : [],
        incomplete: current?.incomplete ?? true,
        cached: cached || !online || !remoteConfigured,
      };
    },
    [schedule, ready, snapshot, online, remoteConfigured, cached],
  );
}
