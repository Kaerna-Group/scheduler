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
export const PREFERENCES_PREFIX = 'scheduler_preferences_v2:';
export const PREFERENCES_EVENT = 'scheduler-preferences-changed';
export const PREFERENCES_USER_EVENT = 'scheduler-preferences-user-changed';
const SELECTED_USER_KEY = 'scheduler_selected_user_v1';
const DEFAULT_USER_SLUG = 'ermolz';

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

export type PreferencesPatch = {
  appearance?: Partial<SchedulerPreferences['appearance']>;
  schedule?: Partial<SchedulerPreferences['schedule']>;
};

export interface CachedPreferences {
  preferences: SchedulerPreferences;
  preferencesRevision: number;
  pendingPatch?: PreferencesPatch;
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

function cloneDefaults() {
  return structuredClone(defaultPreferences);
}

function booleanOr(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

export function validatePreferences(value: unknown): SchedulerPreferences {
  if (!value || typeof value !== 'object') return cloneDefaults();
  const raw = value as Partial<SchedulerPreferences>;
  const appearance: Partial<SchedulerPreferences['appearance']> = raw.appearance && typeof raw.appearance === 'object' ? raw.appearance : {};
  const schedule: Partial<SchedulerPreferences['schedule']> = raw.schedule && typeof raw.schedule === 'object' ? raw.schedule : {};
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

export function getActivePreferencesUser() {
  try { return localStorage.getItem(SELECTED_USER_KEY) || DEFAULT_USER_SLUG; } catch { return DEFAULT_USER_SLUG; }
}

export function preferencesStorageKey(userSlug: string) {
  return `${PREFERENCES_PREFIX}${userSlug}`;
}

function fullPreferencesPatch(preferences: SchedulerPreferences): PreferencesPatch {
  return { appearance: { ...preferences.appearance }, schedule: { ...preferences.schedule } };
}

function safePatch(value: unknown): PreferencesPatch | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as PreferencesPatch;
  const validated = applyPreferencesPatch(defaultPreferences, raw);
  const patch: PreferencesPatch = {};
  if (raw.appearance && typeof raw.appearance === 'object') {
    const appearance: Partial<SchedulerPreferences['appearance']> = {};
    (Object.keys(defaultPreferences.appearance) as Array<keyof SchedulerPreferences['appearance']>).forEach((key) => {
      if (key in raw.appearance! && raw.appearance![key] === validated.appearance[key]) appearance[key] = validated.appearance[key] as never;
    });
    if (Object.keys(appearance).length) patch.appearance = appearance;
  }
  if (raw.schedule && typeof raw.schedule === 'object') {
    const schedule: Partial<SchedulerPreferences['schedule']> = {};
    (Object.keys(defaultPreferences.schedule) as Array<keyof SchedulerPreferences['schedule']>).forEach((key) => {
      if (key in raw.schedule! && raw.schedule![key] === validated.schedule[key]) schedule[key] = validated.schedule[key] as never;
    });
    if (Object.keys(schedule).length) patch.schedule = schedule;
  }
  return Object.keys(patch).length ? patch : undefined;
}

export function readPreferencesRecord(userSlug = getActivePreferencesUser()): CachedPreferences {
  try {
    const raw = localStorage.getItem(preferencesStorageKey(userSlug));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<CachedPreferences>;
      return {
        preferences: validatePreferences(parsed.preferences ?? parsed),
        preferencesRevision: Number.isInteger(parsed.preferencesRevision) && Number(parsed.preferencesRevision) >= 0 ? Number(parsed.preferencesRevision) : 0,
        ...(safePatch(parsed.pendingPatch) ? { pendingPatch: safePatch(parsed.pendingPatch) } : {}),
      };
    }

    if (userSlug === getActivePreferencesUser()) {
      const legacyRaw = localStorage.getItem(PREFERENCES_KEY);
      if (legacyRaw) {
        const preferences = validatePreferences(JSON.parse(legacyRaw));
        const migrated = { preferences, preferencesRevision: 0, pendingPatch: fullPreferencesPatch(preferences) };
        localStorage.setItem(preferencesStorageKey(userSlug), JSON.stringify(migrated));
        localStorage.removeItem(PREFERENCES_KEY);
        return migrated;
      }
    }
  } catch {
    // Fall back to defaults when browser storage is blocked or damaged.
  }
  return { preferences: cloneDefaults(), preferencesRevision: 0 };
}

export function readPreferences(userSlug = getActivePreferencesUser()) {
  return readPreferencesRecord(userSlug).preferences;
}

function writeRecord(userSlug: string, record: CachedPreferences, emit = true) {
  const safeRecord: CachedPreferences = {
    preferences: validatePreferences(record.preferences),
    preferencesRevision: Number.isInteger(record.preferencesRevision) && record.preferencesRevision >= 0 ? record.preferencesRevision : 0,
    ...(safePatch(record.pendingPatch) ? { pendingPatch: safePatch(record.pendingPatch) } : {}),
  };
  try { localStorage.setItem(preferencesStorageKey(userSlug), JSON.stringify(safeRecord)); } catch { /* memory state still works */ }
  if (emit) window.dispatchEvent(new CustomEvent(PREFERENCES_EVENT, { detail: { userSlug, record: safeRecord } }));
  return safeRecord;
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

export function applyPreferencesPatch(preferences: SchedulerPreferences, patch?: PreferencesPatch) {
  if (!patch) return validatePreferences(preferences);
  return validatePreferences({
    ...preferences,
    appearance: { ...preferences.appearance, ...patch.appearance },
    schedule: { ...preferences.schedule, ...patch.schedule },
  });
}

export function writePreferences(userSlug: string, preferences: SchedulerPreferences) {
  const current = readPreferencesRecord(userSlug);
  const safe = validatePreferences(preferences);
  const pendingPatch = mergePreferencesPatch(current.pendingPatch, diffPreferences(current.preferences, safe));
  return writeRecord(userSlug, { ...current, preferences: safe, ...(pendingPatch ? { pendingPatch } : {}) });
}

export function acceptRemotePreferences(userSlug: string, preferences: unknown, preferencesRevision: number) {
  const current = readPreferencesRecord(userSlug);
  const remote = validatePreferences(preferences);
  return writeRecord(userSlug, {
    preferences: applyPreferencesPatch(remote, current.pendingPatch),
    preferencesRevision: Number.isInteger(preferencesRevision) ? preferencesRevision : 0,
    ...(current.pendingPatch ? { pendingPatch: current.pendingPatch } : {}),
  });
}

function removeAcknowledgedPatch(pending: PreferencesPatch | undefined, sent: PreferencesPatch) {
  if (!pending) return undefined;
  const remaining: PreferencesPatch = { appearance: { ...pending.appearance }, schedule: { ...pending.schedule } };
  (Object.keys(sent.appearance ?? {}) as Array<keyof SchedulerPreferences['appearance']>).forEach((key) => {
    const appearance = remaining.appearance;
    if (appearance && appearance[key] === sent.appearance?.[key]) delete appearance[key];
  });
  (Object.keys(sent.schedule ?? {}) as Array<keyof SchedulerPreferences['schedule']>).forEach((key) => {
    const schedule = remaining.schedule;
    if (schedule && schedule[key] === sent.schedule?.[key]) delete schedule[key];
  });
  if (remaining.appearance && !Object.keys(remaining.appearance).length) delete remaining.appearance;
  if (remaining.schedule && !Object.keys(remaining.schedule).length) delete remaining.schedule;
  return Object.keys(remaining).length ? remaining : undefined;
}

export function acknowledgePreferences(userSlug: string, preferences: unknown, preferencesRevision: number, sentPatch: PreferencesPatch) {
  const current = readPreferencesRecord(userSlug);
  const remaining = removeAcknowledgedPatch(current.pendingPatch, sentPatch);
  return writeRecord(userSlug, {
    preferences: applyPreferencesPatch(validatePreferences(preferences), remaining),
    preferencesRevision,
    ...(remaining ? { pendingPatch: remaining } : {}),
  });
}

export function activatePreferencesUser(userSlug: string) {
  const record = readPreferencesRecord(userSlug);
  window.dispatchEvent(new CustomEvent(PREFERENCES_USER_EVENT, { detail: { userSlug, record } }));
  return record;
}

export function resetPreferences(userSlug = getActivePreferencesUser()) {
  return writePreferences(userSlug, cloneDefaults());
}

export function clearAllPreferenceCaches() {
  try {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key === PREFERENCES_KEY || key?.startsWith(PREFERENCES_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  } catch { /* storage may be unavailable */ }
}
