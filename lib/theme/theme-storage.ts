import {
  isDarkThemeId,
  isLightThemeId,
  isThemeId,
  type DarkThemeId,
  type LightThemeId,
  type ReducedMotionPreference,
  type ThemeId,
  type ThemeMode,
} from '@/lib/theme/theme-registry';

export const PREFERENCES_KEY = 'scheduler_preferences_v1';
export const PREFERENCES_EVENT = 'scheduler-preferences-changed';

export type ScheduleDefaultView = 'today' | 'week' | 'subjects';
export type InitialWeekPreference = 'current' | 'last-opened';
export type CardDensity = 'comfortable' | 'compact';

export interface SchedulerPreferences {
  version: 1;
  appearance: {
    mode: ThemeMode;
    themeId: ThemeId;
    systemLightThemeId: LightThemeId;
    systemDarkThemeId: DarkThemeId;
    reducedMotion: ReducedMotionPreference;
  };
  schedule: {
    defaultView: ScheduleDefaultView;
    initialWeek: InitialWeekPreference;
    showEmptyDays: boolean;
    density: CardDensity;
    highlightConflicts: boolean;
    showSaturday: boolean;
    rememberSubjectFilter: boolean;
    refreshOnOpen: boolean;
  };
}

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

function booleanOr(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

export function validatePreferences(value: unknown): SchedulerPreferences {
  if (!value || typeof value !== 'object') return structuredClone(defaultPreferences);
  const raw = value as Partial<SchedulerPreferences>;
  const appearance: Partial<SchedulerPreferences['appearance']> = raw.appearance && typeof raw.appearance === 'object' ? raw.appearance : {};
  const schedule: Partial<SchedulerPreferences['schedule']> = raw.schedule && typeof raw.schedule === 'object' ? raw.schedule : {};
  const mode = ['light', 'dark', 'system'].includes(String(appearance.mode)) ? appearance.mode as ThemeMode : defaultPreferences.appearance.mode;
  const reducedMotion = ['system', 'reduce', 'allow'].includes(String(appearance.reducedMotion))
    ? appearance.reducedMotion as ReducedMotionPreference
    : defaultPreferences.appearance.reducedMotion;
  const defaultView = ['today', 'week', 'subjects'].includes(String(schedule.defaultView))
    ? schedule.defaultView as ScheduleDefaultView
    : defaultPreferences.schedule.defaultView;
  const initialWeek = ['current', 'last-opened'].includes(String(schedule.initialWeek))
    ? schedule.initialWeek as InitialWeekPreference
    : defaultPreferences.schedule.initialWeek;
  const density = ['comfortable', 'compact'].includes(String(schedule.density))
    ? schedule.density as CardDensity
    : defaultPreferences.schedule.density;

  return {
    version: 1,
    appearance: {
      mode,
      themeId: isThemeId(appearance.themeId) ? appearance.themeId : defaultPreferences.appearance.themeId,
      systemLightThemeId: isLightThemeId(appearance.systemLightThemeId) ? appearance.systemLightThemeId : defaultPreferences.appearance.systemLightThemeId,
      systemDarkThemeId: isDarkThemeId(appearance.systemDarkThemeId) ? appearance.systemDarkThemeId : defaultPreferences.appearance.systemDarkThemeId,
      reducedMotion,
    },
    schedule: {
      defaultView,
      initialWeek,
      showEmptyDays: booleanOr(schedule.showEmptyDays, defaultPreferences.schedule.showEmptyDays),
      density,
      highlightConflicts: booleanOr(schedule.highlightConflicts, defaultPreferences.schedule.highlightConflicts),
      showSaturday: booleanOr(schedule.showSaturday, defaultPreferences.schedule.showSaturday),
      rememberSubjectFilter: booleanOr(schedule.rememberSubjectFilter, defaultPreferences.schedule.rememberSubjectFilter),
      refreshOnOpen: booleanOr(schedule.refreshOnOpen, defaultPreferences.schedule.refreshOnOpen),
    },
  };
}

export function readPreferences(): SchedulerPreferences {
  try {
    return validatePreferences(JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? 'null'));
  } catch {
    return structuredClone(defaultPreferences);
  }
}

export function writePreferences(preferences: SchedulerPreferences) {
  const safe = validatePreferences(preferences);
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(safe));
  } catch {
    // Preferences remain active in memory when storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent(PREFERENCES_EVENT, { detail: safe }));
  return safe;
}

export function resetPreferences() {
  try { localStorage.removeItem(PREFERENCES_KEY); } catch { /* storage may be unavailable */ }
  const preferences = structuredClone(defaultPreferences);
  window.dispatchEvent(new CustomEvent(PREFERENCES_EVENT, { detail: preferences }));
  return preferences;
}
