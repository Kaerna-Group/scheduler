import { useCallback, useEffect, useRef, useState } from 'react';

import { useNetworkStatus } from '@/hooks/use-network-status';
import { useEditToken } from '@/hooks/use-edit-token';
import { ApiError, hasRemoteApi } from '@/lib/api/client';
import { readOnlineStatus } from '@/lib/network/connectivity';
import {
  acknowledgePreferences,
  getActivePreferencesUser,
  PREFERENCES_EVENT,
  PREFERENCES_USER_EVENT,
  readPreferencesRecord,
  resetPreferences,
  writePreferences,
} from '@/lib/preferences/local-storage';
import {
  getStalePreferences,
  updatePreferences,
} from '@/lib/preferences/repository';
import type {
  CachedPreferences,
  PreferencesSyncStatus,
  SchedulerPreferences,
} from '@/lib/preferences/types';

export function usePreferences() {
  const online = useNetworkStatus();
  const [userSlug, setUserSlug] = useState(getActivePreferencesUser);
  const { token } = useEditToken(userSlug);
  const [record, setRecord] = useState<CachedPreferences>(() =>
    readPreferencesRecord(getActivePreferencesUser()),
  );
  const [syncStatus, setSyncStatus] = useState<PreferencesSyncStatus>('local');
  const [syncError, setSyncError] = useState('');
  const requestSequence = useRef(0);
  const [retryTrigger, setRetryTrigger] = useState(0);

  useEffect(() => {
    const retry = () => setRetryTrigger((value) => value + 1);
    window.addEventListener('focus', retry);
    return () => {
      window.removeEventListener('focus', retry);
    };
  }, []);

  useEffect(() => {
    const syncPreferences = (event: Event) => {
      const detail = (
        event as CustomEvent<{ userSlug: string; record: CachedPreferences }>
      ).detail;
      if (detail?.userSlug === userSlug) setRecord(detail.record);
    };
    const switchUser = (event: Event) => {
      const detail = (
        event as CustomEvent<{ userSlug: string; record: CachedPreferences }>
      ).detail;
      if (!detail?.userSlug) return;
      requestSequence.current += 1;
      setUserSlug(detail.userSlug);
      setRecord(detail.record);
      setSyncError('');
      setSyncStatus('local');
    };
    const storage = () => setRecord(readPreferencesRecord(userSlug));
    window.addEventListener(PREFERENCES_EVENT, syncPreferences);
    window.addEventListener(PREFERENCES_USER_EVENT, switchUser);
    window.addEventListener('storage', storage);
    return () => {
      window.removeEventListener(PREFERENCES_EVENT, syncPreferences);
      window.removeEventListener(PREFERENCES_USER_EVENT, switchUser);
      window.removeEventListener('storage', storage);
    };
  }, [userSlug]);

  useEffect(() => {
    const sequence = ++requestSequence.current;
    const patch = record.pendingPatch;
    if (!patch) {
      setSyncStatus(
        hasRemoteApi() && token && !record.migration ? 'saved' : 'local',
      );
      setSyncError('');
      return;
    }
    if (!hasRemoteApi() || !token || !online) {
      setSyncStatus('pending');
      setSyncError('');
      return;
    }
    const pendingPatch = patch;
    const controller = new AbortController();
    const current = () =>
      !controller.signal.aborted && requestSequence.current === sequence;
    let retryTimer: number | undefined;
    let attempt = 0;
    setSyncStatus('saving');
    setSyncError('');
    const timer = window.setTimeout(async () => {
      async function send(baseSettingsRevision: number, retry = true) {
        if (!current() || !readOnlineStatus()) return;
        try {
          const response = await updatePreferences({
            userSlug,
            token,
            baseSettingsRevision,
            patch: pendingPatch,
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(30000),
            ]),
          });
          if (!current()) return;
          setRecord(
            acknowledgePreferences(
              userSlug,
              response.preferences,
              response.preferencesRevision,
              pendingPatch,
            ),
          );
          setSyncStatus('saved');
        } catch (error) {
          if (!current()) return;
          const fresh = getStalePreferences(error);
          if (fresh && retry) {
            await send(fresh.preferencesRevision, false);
            return;
          }
          setSyncStatus('error');
          setSyncError(
            error instanceof Error
              ? error.message
              : 'Could not synchronize preferences.',
          );
          // Preferences are idempotent patches. Retry transient failures with backoff,
          // including backend recovery without an online event. Never retry auth or
          // validation failures, or any import/admin mutation through this path.
          if (!(error instanceof ApiError) || error.code === 'INTERNAL_ERROR') {
            const delay = Math.min(30000, 2000 * 2 ** Math.min(attempt++, 4));
            retryTimer = window.setTimeout(
              () => void send(baseSettingsRevision),
              delay,
            );
          }
        }
      }
      await send(record.preferencesRevision);
    }, 600);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      window.clearTimeout(retryTimer);
    };
  }, [
    online,
    record.migration,
    record.pendingPatch,
    record.preferencesRevision,
    retryTrigger,
    userSlug,
    token,
  ]);

  const setPreferences = useCallback(
    (
      next:
        | SchedulerPreferences
        | ((current: SchedulerPreferences) => SchedulerPreferences),
    ) => {
      setRecord((current) =>
        writePreferences(
          userSlug,
          typeof next === 'function' ? next(current.preferences) : next,
        ),
      );
    },
    [userSlug],
  );

  const reset = useCallback(
    () => setRecord(resetPreferences(userSlug)),
    [userSlug],
  );

  return {
    preferences: record.preferences,
    setPreferences,
    resetPreferences: reset,
    preferencesRevision: record.preferencesRevision,
    syncStatus,
    syncError,
    hasPendingChanges: Boolean(record.pendingPatch),
    preferencesUser: userSlug,
  };
}
