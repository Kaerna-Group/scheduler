import { cloneDefaultPreferences } from '@/lib/preferences/defaults';
import type { CachedPreferences, PreferencesPatch, SchedulerPreferences } from '@/lib/preferences/types';
import {
  applyPreferencesPatch,
  diffPreferences,
  mergePreferencesPatch,
  validatePreferences,
  validatePreferencesPatch,
} from '@/lib/preferences/validation';

export const LEGACY_PREFERENCES_KEY = 'scheduler_preferences_v1';
export const PREFERENCES_PREFIX = 'scheduler_preferences_v2:';
export const PREFERENCES_EVENT = 'scheduler-preferences-changed';
export const PREFERENCES_USER_EVENT = 'scheduler-preferences-user-changed';
const SELECTED_USER_KEY = 'scheduler_selected_user_v1';
const DEFAULT_USER_SLUG = 'ermolz';

export function getActivePreferencesUser() {
  try {
    return localStorage.getItem(SELECTED_USER_KEY) || DEFAULT_USER_SLUG;
  } catch {
    return DEFAULT_USER_SLUG;
  }
}

export function preferencesStorageKey(userSlug: string) {
  return `${PREFERENCES_PREFIX}${userSlug}`;
}

function fullPreferencesPatch(preferences: SchedulerPreferences): PreferencesPatch {
  return { appearance: { ...preferences.appearance }, schedule: { ...preferences.schedule } };
}

function isFullLegacyPatch(patch: PreferencesPatch | undefined) {
  if (!patch) return false;
  return Object.keys(patch.appearance ?? {}).length === 5 && Object.keys(patch.schedule ?? {}).length === 8;
}

function removeLegacyPreferences() {
  try { localStorage.removeItem(LEGACY_PREFERENCES_KEY); } catch { /* storage may be unavailable */ }
}

function writeRecord(userSlug: string, record: CachedPreferences, emit = true) {
  const pendingPatch = validatePreferencesPatch(record.pendingPatch);
  const safeRecord: CachedPreferences = {
    preferences: validatePreferences(record.preferences),
    preferencesRevision: Number.isInteger(record.preferencesRevision) && record.preferencesRevision >= 0 ? record.preferencesRevision : 0,
    ...(pendingPatch ? { pendingPatch } : {}),
    ...(record.migration === 'legacy-v1' ? { migration: record.migration } : {}),
  };
  try { localStorage.setItem(preferencesStorageKey(userSlug), JSON.stringify(safeRecord)); } catch { /* memory state still works */ }
  if (emit) window.dispatchEvent(new CustomEvent(PREFERENCES_EVENT, { detail: { userSlug, record: safeRecord } }));
  return safeRecord;
}

export function readPreferencesRecord(userSlug = getActivePreferencesUser()): CachedPreferences {
  try {
    const raw = localStorage.getItem(preferencesStorageKey(userSlug));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<CachedPreferences>;
      const pendingPatch = validatePreferencesPatch(parsed.pendingPatch);
      const inferredLegacyMigration = Number(parsed.preferencesRevision) === 0 && isFullLegacyPatch(pendingPatch);
      return {
        preferences: validatePreferences(parsed.preferences ?? parsed),
        preferencesRevision: Number.isInteger(parsed.preferencesRevision) && Number(parsed.preferencesRevision) >= 0 ? Number(parsed.preferencesRevision) : 0,
        ...(pendingPatch && !inferredLegacyMigration ? { pendingPatch } : {}),
        ...(parsed.migration === 'legacy-v1' || inferredLegacyMigration ? { migration: 'legacy-v1' as const } : {}),
      };
    }

    if (userSlug === getActivePreferencesUser()) {
      const legacyRaw = localStorage.getItem(LEGACY_PREFERENCES_KEY);
      if (legacyRaw) {
        const migrated: CachedPreferences = {
          preferences: validatePreferences(JSON.parse(legacyRaw)),
          preferencesRevision: 0,
          migration: 'legacy-v1',
        };
        return writeRecord(userSlug, migrated, false);
      }
    }
  } catch {
    // Fall back to defaults when browser storage is blocked or damaged.
  }
  return { preferences: cloneDefaultPreferences(), preferencesRevision: 0 };
}

export function readPreferences(userSlug = getActivePreferencesUser()) {
  return readPreferencesRecord(userSlug).preferences;
}

export function writePreferences(userSlug: string, preferences: SchedulerPreferences) {
  const current = readPreferencesRecord(userSlug);
  const safe = validatePreferences(preferences);
  if (current.migration === 'legacy-v1') return writeRecord(userSlug, { ...current, preferences: safe });
  const pendingPatch = mergePreferencesPatch(current.pendingPatch, diffPreferences(current.preferences, safe));
  return writeRecord(userSlug, { ...current, preferences: safe, ...(pendingPatch ? { pendingPatch } : {}) });
}

export function acceptRemotePreferences(
  userSlug: string,
  preferences: unknown,
  preferencesRevision: number,
  preferencesExists = true,
) {
  const current = readPreferencesRecord(userSlug);
  const remote = validatePreferences(preferences);
  if (current.migration === 'legacy-v1') {
    const record = preferencesExists
      ? { preferences: remote, preferencesRevision }
      : {
          preferences: current.preferences,
          preferencesRevision,
          pendingPatch: fullPreferencesPatch(current.preferences),
        };
    removeLegacyPreferences();
    return writeRecord(userSlug, record);
  }
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
  return writePreferences(userSlug, cloneDefaultPreferences());
}

export function clearAllPreferenceCaches() {
  try {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key === LEGACY_PREFERENCES_KEY || key?.startsWith(PREFERENCES_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  } catch { /* storage may be unavailable */ }
}
