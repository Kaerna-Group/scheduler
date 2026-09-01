import { useEffect, useMemo, useState } from 'react';

import type { AppearancePreferences } from '@/lib/preferences/types';
import { themeById, type ResolvedThemeMode, type ThemeId } from '@/lib/theme/theme-registry';

function resolveTheme(appearance: AppearancePreferences, systemDark: boolean): { themeId: ThemeId; mode: ResolvedThemeMode } {
  if (appearance.mode === 'system') {
    return { themeId: systemDark ? appearance.systemDarkThemeId : appearance.systemLightThemeId, mode: systemDark ? 'dark' : 'light' };
  }
  const selected = themeById.get(appearance.themeId);
  if (selected?.mode === appearance.mode) return { themeId: selected.id, mode: selected.mode };
  return appearance.mode === 'dark'
    ? { themeId: appearance.systemDarkThemeId, mode: 'dark' }
    : { themeId: appearance.systemLightThemeId, mode: 'light' };
}

export function applyAppearance(appearance: AppearancePreferences, systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches) {
  const { themeId, mode } = resolveTheme(appearance, systemDark);
  const root = document.documentElement;
  root.dataset.theme = themeId;
  root.dataset.mode = mode;
  root.dataset.reducedMotion = appearance.reducedMotion;
  root.classList.toggle('dark', mode === 'dark');
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(root).getPropertyValue('--theme-background').trim() || (mode === 'dark' ? '#080a0d' : '#fcfdfb');
  return { themeId, mode };
}

export function useTheme(appearance: AppearancePreferences) {
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const resolved = useMemo(() => resolveTheme(appearance, systemDark), [appearance, systemDark]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const syncSystemTheme = () => setSystemDark(media.matches);
    media.addEventListener('change', syncSystemTheme);
    return () => media.removeEventListener('change', syncSystemTheme);
  }, []);

  useEffect(() => { applyAppearance(appearance, systemDark); }, [appearance, systemDark]);

  return resolved;
}
