import { cloneDefaultPreferences, defaultPreferences } from '@/lib/preferences/defaults';
import type {
  CardDensity,
  AppearancePreferences,
  InitialWeekPreference,
  ScheduleDefaultView,
  ScheduleViewPreferences,
  SchedulerPreferences,
  PreferencesPatch,
} from '@/lib/preferences/types';
import {
  isDarkThemeId,
  isLightThemeId,
  isThemeId,
  type ReducedMotionPreference,
  type ThemeMode,
} from '@/lib/theme/theme-registry';

function booleanOr(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

export function validatePreferences(value: unknown): SchedulerPreferences {
  if (!value || typeof value !== 'object') return cloneDefaultPreferences();
  const raw = value as Partial<SchedulerPreferences>;
  const appearance: Partial<AppearancePreferences> = raw.appearance && typeof raw.appearance === 'object' ? raw.appearance : {};
  const schedule: Partial<ScheduleViewPreferences> = raw.schedule && typeof raw.schedule === 'object' ? raw.schedule : {};
  const mode = ['light', 'dark', 'system'].includes(String(appearance.mode)) ? appearance.mode as ThemeMode : defaultPreferences.appearance.mode;
  const reducedMotion = ['system', 'reduce', 'allow'].includes(String(appearance.reducedMotion)) ? appearance.reducedMotion as ReducedMotionPreference : defaultPreferences.appearance.reducedMotion;
  const defaultView = ['today', 'week', 'subjects'].includes(String(schedule.defaultView)) ? schedule.defaultView as ScheduleDefaultView : defaultPreferences.schedule.defaultView;
  const initialWeek = ['current', 'last-opened'].includes(String(schedule.initialWeek)) ? schedule.initialWeek as InitialWeekPreference : defaultPreferences.schedule.initialWeek;
  const density = ['comfortable', 'compact'].includes(String(schedule.density)) ? schedule.density as CardDensity : defaultPreferences.schedule.density;

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

export function applyPreferencesPatch(preferences: SchedulerPreferences, patch?: PreferencesPatch) {
  if (!patch) return validatePreferences(preferences);
  return validatePreferences({
    ...preferences,
    appearance: { ...preferences.appearance, ...patch.appearance },
    schedule: { ...preferences.schedule, ...patch.schedule },
  });
}

export function validatePreferencesPatch(value: unknown): PreferencesPatch | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as PreferencesPatch;
  const validated = applyPreferencesPatch(defaultPreferences, raw);
  const patch: PreferencesPatch = {};
  if (raw.appearance && typeof raw.appearance === 'object') {
    const appearance: PreferencesPatch['appearance'] = {};
    (Object.keys(defaultPreferences.appearance) as Array<keyof SchedulerPreferences['appearance']>).forEach((key) => {
      if (key in raw.appearance! && raw.appearance![key] === validated.appearance[key]) appearance![key] = validated.appearance[key] as never;
    });
    if (Object.keys(appearance).length) patch.appearance = appearance;
  }
  if (raw.schedule && typeof raw.schedule === 'object') {
    const schedule: PreferencesPatch['schedule'] = {};
    (Object.keys(defaultPreferences.schedule) as Array<keyof SchedulerPreferences['schedule']>).forEach((key) => {
      if (key in raw.schedule! && raw.schedule![key] === validated.schedule[key]) schedule![key] = validated.schedule[key] as never;
    });
    if (Object.keys(schedule).length) patch.schedule = schedule;
  }
  return Object.keys(patch).length ? patch : undefined;
}

export function diffPreferences(current: SchedulerPreferences, next: SchedulerPreferences): PreferencesPatch {
  const patch: PreferencesPatch = {};
  (Object.keys(next.appearance) as Array<keyof SchedulerPreferences['appearance']>).forEach((key) => {
    if (current.appearance[key] !== next.appearance[key]) (patch.appearance ??= {})[key] = next.appearance[key] as never;
  });
  (Object.keys(next.schedule) as Array<keyof SchedulerPreferences['schedule']>).forEach((key) => {
    if (current.schedule[key] !== next.schedule[key]) (patch.schedule ??= {})[key] = next.schedule[key] as never;
  });
  return patch;
}

export function mergePreferencesPatch(first?: PreferencesPatch, second?: PreferencesPatch): PreferencesPatch | undefined {
  if (!first && !second) return undefined;
  const merged: PreferencesPatch = {};
  if (first?.appearance || second?.appearance) merged.appearance = { ...first?.appearance, ...second?.appearance };
  if (first?.schedule || second?.schedule) merged.schedule = { ...first?.schedule, ...second?.schedule };
  return Object.keys(merged).length ? merged : undefined;
}
