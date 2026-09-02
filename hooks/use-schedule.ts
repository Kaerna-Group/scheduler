import { useCallback, useEffect, useRef, useState } from 'react';

import { semester as fallbackSemester } from '@/data/semester';
import { useNetworkStatus } from '@/hooks/use-network-status';
import { readOnlineStatus } from '@/lib/network/connectivity';
import { acceptRemotePreferences, activatePreferencesUser, readPreferences } from '@/lib/preferences/local-storage';
import {
  fetchSchedule, getFallbackSchedule, hasRemoteApi, readCachedSchedule, readCachedUsers, readLastSync,
} from '@/lib/schedule/repository';
import type { ScheduleSource, SemesterSummary, UserSchedule } from '@/lib/schedule/types';

const USER_KEY = 'scheduler_selected_user_v1';
const SEMESTER_KEY = 'scheduler_selected_semester_v1';
const DEFAULT_USER_SLUG = 'ermolz';

function initialUser() {
  try {
    const users = readCachedUsers();
    const stored = localStorage.getItem(USER_KEY);
    return users.some((user) => user.slug === stored) ? String(stored) : (users[0]?.slug ?? DEFAULT_USER_SLUG);
  } catch { return DEFAULT_USER_SLUG; }
}

function initialSemester() {
  try { return localStorage.getItem(SEMESTER_KEY) ?? ''; } catch { return ''; }
}

function semesterList(schedule: UserSchedule): SemesterSummary[] {
  return schedule.semesters?.length ? schedule.semesters : [{ ...schedule.semester, archived: false, current: true }];
}

export function useSchedule() {
  const online = useNetworkStatus();
  const initialUserSlug = initialUser();
  const initialSemesterId = initialSemester();
  const initialSchedule = readCachedSchedule(initialUserSlug, initialSemesterId || fallbackSemester.id) ?? getFallbackSchedule(initialUserSlug);
  const [selectedUser, setSelectedUserState] = useState(initialUserSlug);
  const [selectedSemesterId, setSelectedSemesterId] = useState(initialSemesterId || initialSchedule.semester.id);
  const [schedule, setSchedule] = useState<UserSchedule>(initialSchedule);
  const [source, setSource] = useState<ScheduleSource>(() => readCachedSchedule(initialUserSlug, initialSemesterId || fallbackSemester.id) ? 'cache' : 'fallback');
  const [loading, setLoading] = useState(hasRemoteApi());
  const [error, setError] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  const activeUserRef = useRef(selectedUser);
  const activeSemesterRef = useRef(initialSemesterId);
  const previousOnlineRef = useRef(online);

  const refresh = useCallback(async (userSlug: string, semesterId = activeSemesterRef.current) => {
    if (!hasRemoteApi() || !readOnlineStatus()) { setLoading(false); return; }
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError('');
    try {
      const remote = await fetchSchedule(userSlug, semesterId || undefined, controller.signal);
      if (controller.signal.aborted || activeUserRef.current !== userSlug || (semesterId && activeSemesterRef.current !== semesterId)) return;
      if (remote.preferences && Number.isInteger(remote.preferencesRevision)) {
        const revision = remote.preferencesRevision ?? 0;
        acceptRemotePreferences(userSlug, remote.preferences, revision, remote.preferencesExists ?? revision > 0);
      }
      activeSemesterRef.current = remote.semester.id;
      setSelectedSemesterId(remote.semester.id);
      setSchedule(remote);
      setSource('remote');
    } catch (requestError) {
      if (controller.signal.aborted || activeUserRef.current !== userSlug) return;
      setError(requestError instanceof Error ? requestError.message : 'Could not refresh the schedule.');
    } finally {
      if (!controller.signal.aborted && activeUserRef.current === userSlug) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const cameOnline = online && !previousOnlineRef.current;
    previousOnlineRef.current = online;
    if (!online) { requestRef.current?.abort(); setLoading(false); return; }
    if (cameOnline && hasRemoteApi()) void refresh(activeUserRef.current);
  }, [online, refresh]);

  useEffect(() => {
    if (readPreferences(selectedUser).schedule.refreshOnOpen) void refresh(selectedUser);
    else setLoading(false);
    return () => requestRef.current?.abort();
  }, [refresh, selectedUser]);

  useEffect(() => {
    try { localStorage.setItem(USER_KEY, selectedUser); } catch { /* keep the in-memory selection */ }
  }, [selectedUser]);

  const selectUser = useCallback((userSlug: string) => {
    if (userSlug === activeUserRef.current) return;
    activeUserRef.current = userSlug;
    activatePreferencesUser(userSlug);
    requestRef.current?.abort();
    setSelectedUserState(userSlug);
    const semesterId = activeSemesterRef.current || schedule.semester.id;
    const cached = readCachedSchedule(userSlug, semesterId);
    if (cached) { setSchedule(cached); setSource('cache'); }
    else {
      const fallback = getFallbackSchedule(userSlug);
      setSchedule((current) => ({ ...current, users: fallback.users, user: fallback.user, subjects: [], lessons: [] }));
      setSource('fallback');
    }
    setError('');
    setLoading(hasRemoteApi() && readOnlineStatus());
  }, [schedule.semester.id]);

  const selectSemester = useCallback((semesterId: string) => {
    if (!semesterId || semesterId === activeSemesterRef.current) return;
    activeSemesterRef.current = semesterId;
    setSelectedSemesterId(semesterId);
    try { localStorage.setItem(SEMESTER_KEY, semesterId); } catch { /* keep the in-memory selection */ }
    requestRef.current?.abort();
    const cached = readCachedSchedule(activeUserRef.current, semesterId);
    if (cached) { setSchedule(cached); setSource('cache'); }
    else {
      setSchedule((current) => {
        const selected = semesterList(current).find((item) => item.id === semesterId);
        return selected ? { ...current, semester: selected, subjects: [], lessons: [] } : current;
      });
      setSource('fallback');
    }
    setError('');
    setLoading(hasRemoteApi() && readOnlineStatus());
    if (hasRemoteApi() && readOnlineStatus()) void refresh(activeUserRef.current, semesterId);
  }, [refresh]);

  return {
    schedule, setSchedule, selectedUser, selectUser, selectedSemesterId, selectSemester,
    source, loading, error, refresh: () => refresh(selectedUser), remoteConfigured: hasRemoteApi(),
    lastSync: readLastSync(selectedUser, selectedSemesterId), online,
  };
}
