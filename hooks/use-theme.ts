import { useCallback, useEffect, useMemo, useState } from 'react';

import { themeById, type ResolvedThemeMode, type ThemeId } from '@/lib/theme/theme-registry';
import {
  PREFERENCES_EVENT,
  readPreferences,
  resetPreferences,
  type SchedulerPreferences,
  writePreferences,
} from '@/lib/theme/theme-storage';

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

export function useTheme() {
  const [preferences, setPreferencesState] = useState(readPreferences);

  useEffect(() => {
    applyPreferences(preferences);
  }, [preferences]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => applyPreferences(readPreferences());
    const sync = (event: Event) => setPreferencesState((event as CustomEvent<SchedulerPreferences>).detail ?? readPreferences());
    media.addEventListener('change', apply);
    window.addEventListener(PREFERENCES_EVENT, sync);
    window.addEventListener('storage', apply);
    return () => {
      media.removeEventListener('change', apply);
      window.removeEventListener(PREFERENCES_EVENT, sync);
      window.removeEventListener('storage', apply);
    };
  }, []);

  const setPreferences = useCallback((next: SchedulerPreferences | ((current: SchedulerPreferences) => SchedulerPreferences)) => {
    setPreferencesState((current) => writePreferences(typeof next === 'function' ? next(current) : next));
  }, []);

  const reset = useCallback(() => setPreferencesState(resetPreferences()), []);
  const resolved = useMemo(() => resolveTheme(preferences), [preferences]);

  return { preferences, setPreferences, resetPreferences: reset, ...resolved };
}
