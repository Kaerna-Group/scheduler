import { fallbackSchedule } from '@/data/fallback-schedule';
import { getApi, postApi } from '@/lib/api/client';
import type { ImportPlanResponse, ScheduleImportV1, ScheduleUser, SharedConflictResolution, UserSchedule } from '@/lib/schedule/types';

const CACHE_PREFIX = 'scheduler_cache_v1:';
const USERS_CACHE_KEY = 'scheduler_users_v1';
const EDIT_TOKEN_PREFIX = 'scheduler_edit_token_v1:';
export const EDIT_TOKEN_EVENT = 'scheduler-edit-token-changed';
const LAST_SYNC_PREFIX = 'scheduler_last_sync_v1:';
const HISTORY_CACHE_PREFIX = 'scheduler_history_v1:';

function cacheKey(userSlug: string, semesterId: string) {
  return `${CACHE_PREFIX}${userSlug}:${semesterId}`;
}

function lastSyncKey(userSlug: string, semesterId: string) {
  return `${LAST_SYNC_PREFIX}${userSlug}:${semesterId}`;
}

export { hasRemoteApi } from '@/lib/api/client';

function isScheduleUser(value: unknown): value is ScheduleUser {
  if (!value || typeof value !== 'object') return false;
  const user = value as Partial<ScheduleUser>;
  return typeof user.id === 'string' && typeof user.slug === 'string' &&
    typeof user.displayName === 'string' && ['user', 'editor', 'admin'].includes(String(user.role));
}

export function mergeScheduleUsers(...collections: ScheduleUser[][]): ScheduleUser[] {
  const users = new Map<string, ScheduleUser>();
  collections.flat().forEach((user) => {
    users.set(user.slug, user);
  });
  return [...users.values()].sort((first, second) => first.displayName.localeCompare(second.displayName));
}

function writeCachedUsers(users: ScheduleUser[]) {
  try {
    localStorage.setItem(USERS_CACHE_KEY, JSON.stringify(mergeScheduleUsers(users)));
  } catch {
    // The schedule remains usable when browser storage is unavailable.
  }
}

function usersFromJson(raw: string | null): ScheduleUser[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (Array.isArray(value)) return value.filter(isScheduleUser);
    if (value && typeof value === 'object' && 'users' in value && Array.isArray(value.users)) {
      return value.users.filter(isScheduleUser);
    }
  } catch {
    // Ignore one damaged cache entry and keep reading the others.
  }
  return [];
}

export function readCachedUsers(): ScheduleUser[] {
  try {
    const dedicatedCache = usersFromJson(localStorage.getItem(USERS_CACHE_KEY));
    if (dedicatedCache.length) return mergeScheduleUsers(dedicatedCache);

    const collections: ScheduleUser[][] = [fallbackSchedule.users];

    // Migrate user lists already embedded in per-user schedule caches.
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(CACHE_PREFIX)) continue;
      collections.push(usersFromJson(localStorage.getItem(key)));
    }

    const users = mergeScheduleUsers(...collections);
    writeCachedUsers(users);
    return users;
  } catch {
    return fallbackSchedule.users;
  }
}

export function getFallbackSchedule(userSlug = fallbackSchedule.user.slug): UserSchedule {
  const users = readCachedUsers();
  const user = users.find((item) => item.slug === userSlug) ?? fallbackSchedule.user;
  return { ...fallbackSchedule, users, user };
}

export function readCachedSchedule(userSlug: string, semesterId: string): UserSchedule | null {
  try {
    const raw = localStorage.getItem(cacheKey(userSlug, semesterId));
    if (!raw) return null;
    const schedule = JSON.parse(raw) as UserSchedule;
    const users = mergeScheduleUsers(schedule.users, readCachedUsers());
    return {
      ...schedule,
      users,
      user: users.find((item) => item.slug === userSlug) ?? schedule.user,
    };
  } catch {
    return null;
  }
}

function writeCachedSchedule(schedule: UserSchedule) {
  try {
    localStorage.setItem(cacheKey(schedule.user.slug, schedule.semester.id), JSON.stringify(schedule));
    writeCachedUsers(schedule.users);
  } catch {
    // Cache is a best-effort acceleration layer.
  }
}

export function getStoredEditToken(userSlug: string) {
  try {
    return localStorage.getItem(`${EDIT_TOKEN_PREFIX}${userSlug}`) ?? '';
  } catch {
    return '';
  }
}

export function storeEditToken(userSlug: string, token: string) {
  try {
    const key = `${EDIT_TOKEN_PREFIX}${userSlug}`;
    if (token) localStorage.setItem(key, token);
    else localStorage.removeItem(key);
  } catch {
    // The token stays only in component state when storage is unavailable.
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EDIT_TOKEN_EVENT));
}

export function readLastSync(userSlug: string, semesterId: string) {
  try { return localStorage.getItem(lastSyncKey(userSlug, semesterId)) ?? ''; } catch { return ''; }
}

export function clearScheduleCache() {
  try {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(CACHE_PREFIX) || key?.startsWith(LAST_SYNC_PREFIX) || key?.startsWith(HISTORY_CACHE_PREFIX) || key === USERS_CACHE_KEY) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  } catch {
    // Clearing cache is best effort when storage is restricted.
  }
}

export function forgetAllEditTokens() {
  try {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(EDIT_TOKEN_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  } catch {
    // Tokens may already be inaccessible.
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EDIT_TOKEN_EVENT));
}

export async function fetchScheduleUpdate(userSlug: string, semesterId?: string, signal?: AbortSignal) {
  const parameters: Record<string, string> = { action: 'schedule', user: userSlug };
  if (semesterId) parameters.semester = semesterId;
  const schedule = await getApi<UserSchedule>(parameters, signal);
  // A canceled/obsolete refresh must not overwrite the comparison baseline.
  signal?.throwIfAborted();
  if (schedule.user.slug !== userSlug || (semesterId && schedule.semester.id !== semesterId))
    throw new Error('The backend returned a different user or semester. The saved schedule was not replaced.');
  const previousSchedule = readCachedSchedule(schedule.user.slug, schedule.semester.id);
  const previousSync = readLastSync(schedule.user.slug, schedule.semester.id);
  const syncedAt = new Date().toISOString();
  writeCachedSchedule(schedule);
  try { localStorage.setItem(lastSyncKey(schedule.user.slug, schedule.semester.id), syncedAt); } catch { /* metadata is optional */ }
  return { schedule, previousSchedule, previousSync, syncedAt };
}

export async function fetchSchedule(userSlug: string, semesterId?: string, signal?: AbortSignal) {
  return (await fetchScheduleUpdate(userSlug, semesterId, signal)).schedule;
}

export async function importPersonalSchedule(args: {
  userSlug: string;
  token: string;
  schedule: ScheduleImportV1;
  mode: 'merge' | 'replace';
  baseRevision: number;
  sharedConflictResolutions?: Record<string, SharedConflictResolution>;
  dryRun?: boolean;
}) {
  return postApi<ImportPlanResponse>({
    action: args.dryRun ? 'previewImport' : 'importSchedule',
    userSlug: args.userSlug,
    editToken: args.token,
    importMode: args.mode,
    baseRevision: args.baseRevision,
    sharedConflictResolutions: args.sharedConflictResolutions ?? {},
    payload: args.schedule,
  });
}

export async function updateEnrollments(args: {
  userSlug: string;
  token: string;
  semesterId: string;
  enrollments: Array<{ externalCode: string; selectedGroup?: number }>;
  baseRevision: number;
  signal?: AbortSignal;
}) {
  return postApi<{ schedule: UserSchedule; revision: number }>({
    action: 'updateEnrollments',
    userSlug: args.userSlug,
    editToken: args.token,
    semesterId: args.semesterId,
    enrollments: args.enrollments,
    baseRevision: args.baseRevision,
  }, args.signal);
}
