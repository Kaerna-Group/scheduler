import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getStoredEditToken, hasRemoteApi, ScheduleApiError, updatePreferences } from '@/lib/schedule/repository';
import { themeById, type ResolvedThemeMode, type ThemeId } from '@/lib/theme/theme-registry';
import {
  acknowledgePreferences,
  getActivePreferencesUser,
  PREFERENCES_EVENT,
  PREFERENCES_USER_EVENT,
  readPreferences,
  readPreferencesRecord,
  resetPreferences,
  type CachedPreferences,
  type SchedulerPreferences,
  writePreferences,
} from '@/lib/theme/theme-storage';

export type PreferencesSyncStatus = 'saved' | 'saving' | 'local' | 'error';

function resolveTheme(preferences: SchedulerPreferences): { themeId: ThemeId; mode: ResolvedThemeMode } {
  if (preferences.appearance.mode === 'system') {
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return { themeId: dark ? preferences.appearance.systemDarkThemeId : preferences.appearance.systemLightThemeId, mode: dark ? 'dark' : 'light' };
  }
  const selected = themeById.get(preferences.appearance.themeId);
  if (selected?.mode === preferences.appearance.mode) return { themeId: selected.id, mode: selected.mode };
  return preferences.appearance.mode === 'dark'
    ? { themeId: preferences.appearance.systemDarkThemeId, mode: 'dark' }
    : { themeId: preferences.appearance.systemLightThemeId, mode: 'light' };
}

export function applyPreferences(preferences: SchedulerPreferences) {
  const { themeId, mode } = resolveTheme(preferences);
  const root = document.documentElement;
  root.dataset.theme = themeId;
  root.dataset.mode = mode;
  root.dataset.reducedMotion = preferences.appearance.reducedMotion;
  root.classList.toggle('dark', mode === 'dark');
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(root).getPropertyValue('--theme-background').trim() || (mode === 'dark' ? '#080a0d' : '#fcfdfb');
}

function staleDetails(error: ScheduleApiError) {
  if (error.code !== 'SETTINGS_STALE' || !error.details || typeof error.details !== 'object') return null;
  const details = error.details as { preferences?: unknown; preferencesRevision?: unknown };
  if (!details.preferences || !Number.isInteger(details.preferencesRevision)) return null;
  return { preferences: details.preferences, preferencesRevision: Number(details.preferencesRevision) };
}

export function useTheme() {
  const [userSlug, setUserSlug] = useState(getActivePreferencesUser);
  const [record, setRecord] = useState<CachedPreferences>(() => readPreferencesRecord(getActivePreferencesUser()));
  const [syncStatus, setSyncStatus] = useState<PreferencesSyncStatus>('local');
  const [syncError, setSyncError] = useState('');
  const requestSequence = useRef(0);
  const preferences = record.preferences;

  useEffect(() => applyPreferences(preferences), [preferences]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => applyPreferences(readPreferences(userSlug));
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
    media.addEventListener('change', apply);
    window.addEventListener(PREFERENCES_EVENT, syncPreferences);
    window.addEventListener(PREFERENCES_USER_EVENT, switchUser);
    window.addEventListener('storage', storage);
    return () => {
      media.removeEventListener('change', apply);
      window.removeEventListener(PREFERENCES_EVENT, syncPreferences);
      window.removeEventListener(PREFERENCES_USER_EVENT, switchUser);
      window.removeEventListener('storage', storage);
    };
  }, [userSlug]);

  useEffect(() => {
    const patch = record.pendingPatch;
    const token = getStoredEditToken(userSlug);
    if (!patch) {
      setSyncStatus(hasRemoteApi() && token ? 'saved' : 'local');
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
          const fresh = error instanceof ScheduleApiError ? staleDetails(error) : null;
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
  }, [record.pendingPatch, record.preferencesRevision, userSlug]);

  const setPreferences = useCallback((next: SchedulerPreferences | ((current: SchedulerPreferences) => SchedulerPreferences)) => {
    setRecord((current) => writePreferences(userSlug, typeof next === 'function' ? next(current.preferences) : next));
  }, [userSlug]);

  const reset = useCallback(() => setRecord(resetPreferences(userSlug)), [userSlug]);
  const resolved = useMemo(() => resolveTheme(preferences), [preferences]);

  return {
    preferences,
    setPreferences,
    resetPreferences: reset,
    preferencesRevision: record.preferencesRevision,
    syncStatus,
    syncError,
    preferencesUser: userSlug,
    ...resolved,
  };
}
