import { useCallback, useEffect, useRef, useState } from 'react';

import { hasRemoteApi } from '@/lib/api/client';
import {
  acknowledgePreferences,
  getActivePreferencesUser,
  PREFERENCES_EVENT,
  PREFERENCES_USER_EVENT,
  readPreferencesRecord,
  resetPreferences,
  writePreferences,
} from '@/lib/preferences/local-storage';
import { getStalePreferences, updatePreferences } from '@/lib/preferences/repository';
import type { CachedPreferences, PreferencesSyncStatus, SchedulerPreferences } from '@/lib/preferences/types';
import { getStoredEditToken } from '@/lib/schedule/repository';

export function usePreferences() {
  const [userSlug, setUserSlug] = useState(getActivePreferencesUser);
  const [record, setRecord] = useState<CachedPreferences>(() => readPreferencesRecord(getActivePreferencesUser()));
  const [syncStatus, setSyncStatus] = useState<PreferencesSyncStatus>('local');
  const [syncError, setSyncError] = useState('');
  const requestSequence = useRef(0);

  useEffect(() => {
    const syncPreferences = (event: Event) => {
      const detail = (event as CustomEvent<{ userSlug: string; record: CachedPreferences }>).detail;
      if (detail?.userSlug === userSlug) setRecord(detail.record);
    };
    const switchUser = (event: Event) => {
      const detail = (event as CustomEvent<{ userSlug: string; record: CachedPreferences }>).detail;
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
    const patch = record.pendingPatch;
    const token = getStoredEditToken(userSlug);
    if (!patch) {
      setSyncStatus(hasRemoteApi() && token && !record.migration ? 'saved' : 'local');
      setSyncError('');
      return;
    }
    if (!hasRemoteApi() || !token) {
      setSyncStatus('local');
      return;
    }
    const pendingPatch = patch;
    const sequence = ++requestSequence.current;
    setSyncStatus('saving');
    setSyncError('');
    const timer = window.setTimeout(async () => {
      async function send(baseSettingsRevision: number, retry = true) {
        try {
          const response = await updatePreferences({ userSlug, token, baseSettingsRevision, patch: pendingPatch });
          if (requestSequence.current !== sequence) return;
          setRecord(acknowledgePreferences(userSlug, response.preferences, response.preferencesRevision, pendingPatch));
          setSyncStatus('saved');
        } catch (error) {
          const fresh = getStalePreferences(error);
          if (fresh && retry) {
            await send(fresh.preferencesRevision, false);
            return;
          }
          if (requestSequence.current !== sequence) return;
          setSyncStatus('error');
          setSyncError(error instanceof Error ? error.message : 'Не вдалося синхронізувати налаштування.');
        }
      }
      await send(record.preferencesRevision);
    }, 600);
    return () => window.clearTimeout(timer);
  }, [record.migration, record.pendingPatch, record.preferencesRevision, userSlug]);

  const setPreferences = useCallback((next: SchedulerPreferences | ((current: SchedulerPreferences) => SchedulerPreferences)) => {
    setRecord((current) => writePreferences(userSlug, typeof next === 'function' ? next(current.preferences) : next));
  }, [userSlug]);

  const reset = useCallback(() => setRecord(resetPreferences(userSlug)), [userSlug]);

  return {
    preferences: record.preferences,
    setPreferences,
    resetPreferences: reset,
    preferencesRevision: record.preferencesRevision,
    syncStatus,
    syncError,
    preferencesUser: userSlug,
  };
}
