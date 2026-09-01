import { useCallback, useEffect, useRef, useState } from 'react';

import { semester as fallbackSemester } from '@/data/semester';
import {
  fetchSchedule,
  getFallbackSchedule,
  hasRemoteApi,
  readCachedSchedule,
  readCachedUsers,
  readLastSync,
} from '@/lib/schedule/repository';
import { acceptRemotePreferences, activatePreferencesUser, readPreferences } from '@/lib/preferences/local-storage';
import type { ScheduleSource, UserSchedule } from '@/lib/schedule/types';

const USER_KEY = 'scheduler_selected_user_v1';
const LEGACY_USER_SLUG = 'tymofii';
const DEFAULT_USER_SLUG = 'ermolz';

function initialUser() {
  try {
    const users = readCachedUsers();
    const rawStored = localStorage.getItem(USER_KEY);
    const stored = rawStored === LEGACY_USER_SLUG ? DEFAULT_USER_SLUG : rawStored;
    return users.some((user) => user.slug === stored) ? String(stored) : (users[0]?.slug ?? DEFAULT_USER_SLUG);
  } catch {
    return DEFAULT_USER_SLUG;
  }
}

export function useSchedule() {
  const [selectedUser, setSelectedUserState] = useState(initialUser);
  const [schedule, setSchedule] = useState<UserSchedule>(() =>
    readCachedSchedule(initialUser(), fallbackSemester.id) ?? getFallbackSchedule(initialUser()),
  );
  const [source, setSource] = useState<ScheduleSource>(() =>
    readCachedSchedule(initialUser(), fallbackSemester.id) ? 'cache' : 'fallback',
  );
  const [loading, setLoading] = useState(hasRemoteApi());
  const [error, setError] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  const activeUserRef = useRef(selectedUser);

  const refresh = useCallback(async (userSlug: string) => {
    if (!hasRemoteApi()) {
      setLoading(false);
      return;
    }

    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError('');

    try {
      const remote = await fetchSchedule(userSlug, schedule.semester.id, controller.signal);
      if (activeUserRef.current !== userSlug) return;
      if (remote.preferences && Number.isInteger(remote.preferencesRevision)) {
        acceptRemotePreferences(userSlug, remote.preferences, remote.preferencesRevision ?? 0, remote.preferencesExists ?? true);
      }
      setSchedule(remote);
      setSource('remote');
    } catch (requestError) {
      if (controller.signal.aborted || activeUserRef.current !== userSlug) return;
      setError(requestError instanceof Error ? requestError.message : 'Не вдалося оновити розклад.');
    } finally {
      if (!controller.signal.aborted && activeUserRef.current === userSlug) setLoading(false);
    }
  }, [schedule.semester.id]);

  useEffect(() => {
    if (readPreferences(selectedUser).schedule.refreshOnOpen) void refresh(selectedUser);
    else setLoading(false);
    return () => requestRef.current?.abort();
  }, [refresh, selectedUser]);

  useEffect(() => {
    try {
      localStorage.setItem(USER_KEY, selectedUser);
    } catch {
      // The selection still remains in memory when storage is unavailable.
    }
  }, [selectedUser]);

  const selectUser = useCallback((userSlug: string) => {
    if (userSlug === activeUserRef.current) return;
    activeUserRef.current = userSlug;
    activatePreferencesUser(userSlug);
    requestRef.current?.abort();
    setSelectedUserState(userSlug);
    const cached = readCachedSchedule(userSlug, schedule.semester.id);
    if (cached) {
      setSchedule(cached);
      setSource('cache');
    } else {
      const fallback = getFallbackSchedule(userSlug);
      setSchedule((current) => ({
        ...current,
        users: fallback.users,
        user: fallback.user,
        subjects: [],
        lessons: [],
      }));
      setSource('fallback');
    }
    setError('');
    setLoading(hasRemoteApi());
  }, [schedule.semester.id]);

  return {
    schedule,
    setSchedule,
    selectedUser,
    selectUser,
    source,
    loading,
    error,
    refresh: () => refresh(selectedUser),
    remoteConfigured: hasRemoteApi(),
    lastSync: readLastSync(selectedUser, schedule.semester.id),
  };
}
