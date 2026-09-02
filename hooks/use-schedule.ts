import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SetStateAction } from 'react';

import { useNetworkStatus } from '@/hooks/use-network-status';
import { readOnlineStatus } from '@/lib/network/connectivity';
import {
  acceptRemotePreferences,
  activatePreferencesUser,
  readPreferences,
} from '@/lib/preferences/local-storage';
import {
  fetchSchedule,
  getFallbackSchedule,
  hasRemoteApi,
  readCachedSchedule,
  readCachedUsers,
  readLastSync,
} from '@/lib/schedule/repository';
import type { ScheduleSource, UserSchedule } from '@/lib/schedule/types';

const USER_KEY = 'scheduler_selected_user_v1';
const SEMESTER_KEY = 'scheduler_selected_semester_v1';
interface Selection {
  userSlug?: string;
  semesterId?: string;
  fromLink?: boolean;
}
interface Snapshot {
  key: string;
  schedule: UserSchedule;
  source: ScheduleSource;
  available: boolean;
}

function initialUser() {
  try {
    const users = readCachedUsers();
    const stored = localStorage.getItem(USER_KEY);
    return users.some((user) => user.slug === stored)
      ? String(stored)
      : (users[0]?.slug ?? 'ermolz');
  } catch {
    return 'ermolz';
  }
}
function initialSemester() {
  try {
    return localStorage.getItem(SEMESTER_KEY) ?? '';
  } catch {
    return '';
  }
}
function selectionSnapshot(userSlug: string, semesterId: string): Snapshot {
  const key = JSON.stringify([userSlug, semesterId]);
  const fallback = getFallbackSchedule();
  const cached = readCachedSchedule(
    userSlug,
    semesterId || fallback.semester.id,
  );
  if (cached)
    return { key, schedule: cached, source: 'cache', available: true };
  if (
    userSlug === fallback.user.slug &&
    (!semesterId || semesterId === fallback.semester.id)
  ) {
    return { key, schedule: fallback, source: 'fallback', available: true };
  }
  // A link can name a user/semester not present on this device. Never display
  // another user's fallback lessons under that requested identity.
  const user = fallback.users.find((item) => item.slug === userSlug) ?? {
    id: '',
    slug: userSlug,
    displayName: userSlug,
    role: 'user' as const,
  };
  return {
    key,
    source: 'fallback',
    available: false,
    schedule: { ...fallback, user, subjects: [], lessons: [] },
  };
}

export function useSchedule(selection?: Selection) {
  const online = useNetworkStatus();
  const [localSelection, setLocalSelection] = useState(() => ({
    userSlug: initialUser(),
    semesterId: initialSemester(),
  }));
  const selectedUser = selection?.userSlug ?? localSelection.userSlug;
  const requestedSemesterId =
    selection?.semesterId ?? localSelection.semesterId;
  const initial = useMemo(
    () => selectionSnapshot(selectedUser, requestedSemesterId),
    [selectedUser, requestedSemesterId],
  );
  const [snapshot, setSnapshot] = useState(initial);
  const current = snapshot.key === initial.key ? snapshot : initial;
  const { schedule, source } = current;
  const selectedSemesterId = requestedSemesterId || schedule.semester.id;
  const [request, setRequest] = useState({
    key: initial.key,
    loading: hasRemoteApi(),
    error: '',
  });
  const requestRef = useRef<AbortController | null>(null);
  const previousOnlineRef = useRef(online);
  const resolvedSnapshot = useRef<Snapshot | null>(null);
  const previousSelectionKey = useRef<string | null>(null);
  const forceInitialRead = useRef(Boolean(selection?.fromLink));
  // Read policy applies when selecting a user/semester, not when a URL is
  // normalized or only its week/filter changes.
  useEffect(() => {
    forceInitialRead.current = Boolean(selection?.fromLink);
  }, [selection?.fromLink]);

  const refresh = useCallback(async () => {
    if (!hasRemoteApi() || !readOnlineStatus()) {
      resolvedSnapshot.current = initial;
      setRequest({ key: initial.key, loading: false, error: '' });
      return;
    }
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setRequest({ key: initial.key, loading: true, error: '' });
    try {
      const remote = await fetchSchedule(
        selectedUser,
        requestedSemesterId || undefined,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (remote.preferences && Number.isInteger(remote.preferencesRevision)) {
        const revision = remote.preferencesRevision ?? 0;
        acceptRemotePreferences(
          selectedUser,
          remote.preferences,
          revision,
          remote.preferencesExists ?? revision > 0,
        );
      }
      const next: Snapshot = {
        key: initial.key,
        schedule: remote,
        source: 'remote',
        available: true,
      };
      resolvedSnapshot.current = next;
      setSnapshot(next);
      setRequest({ key: initial.key, loading: false, error: '' });
    } catch (error) {
      if (!controller.signal.aborted)
        setRequest({
          key: initial.key,
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : 'Could not refresh the schedule.',
        });
    }
  }, [initial, requestedSemesterId, selectedUser]);

  useEffect(() => {
    requestRef.current?.abort();
    const previousKey = previousSelectionKey.current;
    previousSelectionKey.current = initial.key;
    const previous = resolvedSnapshot.current;
    // Resolving an implicit current semester to its canonical URL is not a
    // second navigation and must not trigger a duplicate network request.
    if (
      previousKey === JSON.stringify([selectedUser, '']) &&
      previous?.key === previousKey &&
      previous.available &&
      requestedSemesterId === previous.schedule.semester.id
    ) {
      const next = { ...previous, key: initial.key };
      setSnapshot(next);
      setRequest({ key: initial.key, loading: false, error: '' });
      resolvedSnapshot.current = next;
    } else {
      setSnapshot(initial);
      if (
        (previousKey !== null && previousKey !== initial.key) ||
        forceInitialRead.current ||
        readPreferences(selectedUser).schedule.refreshOnOpen
      )
        void refresh();
      else {
        resolvedSnapshot.current = initial;
        setRequest({ key: initial.key, loading: false, error: '' });
      }
    }
    return () => requestRef.current?.abort();
  }, [initial, refresh, selectedUser, requestedSemesterId]);

  useEffect(() => {
    const cameOnline = online && !previousOnlineRef.current;
    previousOnlineRef.current = online;
    if (!online) {
      requestRef.current?.abort();
      setRequest((currentRequest) => ({ ...currentRequest, loading: false }));
    } else if (cameOnline) void refresh();
  }, [online, refresh]);

  useEffect(() => {
    try {
      localStorage.setItem(USER_KEY, selectedUser);
      if (requestedSemesterId)
        localStorage.setItem(SEMESTER_KEY, requestedSemesterId);
    } catch {
      /* Keep the in-memory selection when storage is blocked. */
    }
    activatePreferencesUser(selectedUser);
  }, [selectedUser, requestedSemesterId]);

  const selectUser = useCallback(
    (userSlug: string) => {
      setLocalSelection({ userSlug, semesterId: selectedSemesterId });
    },
    [selectedSemesterId],
  );
  const selectSemester = useCallback(
    (semesterId: string) => {
      if (semesterId) setLocalSelection({ userSlug: selectedUser, semesterId });
    },
    [selectedUser],
  );
  const setSchedule = useCallback(
    (value: SetStateAction<UserSchedule>) => {
      setSnapshot((previous) => ({
        key: initial.key,
        source: previous.source,
        available: true,
        schedule:
          typeof value === 'function'
            ? value(
                previous.key === initial.key
                  ? previous.schedule
                  : initial.schedule,
              )
            : value,
      }));
    },
    [initial],
  );

  return {
    schedule,
    setSchedule,
    selectedUser,
    selectUser,
    selectedSemesterId,
    selectSemester,
    source,
    selectionReady:
      current.available &&
      schedule.user.slug === selectedUser &&
      (!requestedSemesterId || schedule.semester.id === requestedSemesterId),
    loading:
      request.key === initial.key ? request.loading : hasRemoteApi() && online,
    error: request.key === initial.key ? request.error : '',
    refresh,
    remoteConfigured: hasRemoteApi(),
    lastSync: readLastSync(selectedUser, selectedSemesterId),
    online,
  };
}
