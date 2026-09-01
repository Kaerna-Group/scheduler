import type { SchedulerPreferences } from '@/lib/preferences/types';

export const defaultPreferences: SchedulerPreferences = {
  version: 1,
  appearance: {
    mode: 'light',
    themeId: 'paper-current',
    systemLightThemeId: 'paper-current',
    systemDarkThemeId: 'graphite-current',
    reducedMotion: 'system',
  },
  schedule: {
    defaultView: 'week',
    initialWeek: 'last-opened',
    showEmptyDays: true,
    density: 'comfortable',
    highlightConflicts: true,
    showSaturday: true,
    rememberSubjectFilter: false,
    refreshOnOpen: true,
  },
};

export function cloneDefaultPreferences() {
  return structuredClone(defaultPreferences);
}
