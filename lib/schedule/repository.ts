import { fallbackSchedule } from '@/data/fallback-schedule';
import type { ScheduleImportV1, ScheduleUser, UserSchedule } from '@/lib/schedule/types';

const API_URL = (import.meta.env.VITE_SCHEDULE_API_URL as string | undefined)?.trim() ?? '';
const CACHE_PREFIX = 'scheduler_cache_v1:';
const USERS_CACHE_KEY = 'scheduler_users_v1';
const EDIT_TOKEN_PREFIX = 'scheduler_edit_token_v1:';
const LAST_SYNC_PREFIX = 'scheduler_last_sync_v1:';
const LEGACY_USER_SLUG = 'tymofii';
const DEFAULT_USER_SLUG = 'ermolz';

interface ApiSuccess<T> {
  ok: true;
  data: T;
}

interface ApiFailure {
  ok: false;
  error: { code: string; message: string; details?: unknown };
  revision?: number;
}

type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export class ScheduleApiError extends Error {
  code: string;
  details?: unknown;
  revision?: number;

  constructor(response: ApiFailure) {
    super(response.error.message);
    this.name = 'ScheduleApiError';
    this.code = response.error.code;
    this.details = response.error.details;
    this.revision = response.revision;
  }
}

function cacheKey(userSlug: string, semesterId: string) {
  return `${CACHE_PREFIX}${userSlug}:${semesterId}`;
}

function lastSyncKey(userSlug: string, semesterId: string) {
  return `${LAST_SYNC_PREFIX}${userSlug}:${semesterId}`;
}

function parseResponse<T>(value: unknown): T {
  const response = value as ApiResponse<T>;
  if (!response || typeof response !== 'object' || typeof response.ok !== 'boolean') {
    throw new Error('Сервер повернув невідомий формат відповіді.');
  }
  if (!response.ok) throw new ScheduleApiError(response);
  return response.data;
}

export function hasRemoteApi() {
  return Boolean(API_URL);
}

function isScheduleUser(value: unknown): value is ScheduleUser {
  if (!value || typeof value !== 'object') return false;
  const user = value as Partial<ScheduleUser>;
  return typeof user.id === 'string' && typeof user.slug === 'string' &&
    typeof user.displayName === 'string' && ['user', 'editor', 'admin'].includes(String(user.role));
}

export function mergeScheduleUsers(...collections: ScheduleUser[][]): ScheduleUser[] {
  const users = new Map<string, ScheduleUser>();
  collections.flat().forEach((user) => {
    const normalized = user.slug === LEGACY_USER_SLUG
      ? { ...user, slug: DEFAULT_USER_SLUG, displayName: user.displayName === 'Tymofii' ? 'Ermolz' : user.displayName }
      : user;
    users.set(normalized.slug, normalized);
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
    const raw = localStorage.getItem(cacheKey(userSlug, semesterId)) ?? (
      userSlug === DEFAULT_USER_SLUG ? localStorage.getItem(cacheKey(LEGACY_USER_SLUG, semesterId)) : null
    );
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
    const currentKey = `${EDIT_TOKEN_PREFIX}${userSlug}`;
    const current = localStorage.getItem(currentKey);
    if (current || userSlug !== DEFAULT_USER_SLUG) return current ?? '';
    const legacyKey = `${EDIT_TOKEN_PREFIX}${LEGACY_USER_SLUG}`;
    const legacy = localStorage.getItem(legacyKey) ?? '';
    if (legacy) {
      localStorage.setItem(currentKey, legacy);
      localStorage.removeItem(legacyKey);
    }
    return legacy;
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
}

export function readLastSync(userSlug: string, semesterId: string) {
  try { return localStorage.getItem(lastSyncKey(userSlug, semesterId)) ?? ''; } catch { return ''; }
}

export function clearScheduleCache() {
  try {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(CACHE_PREFIX) || key?.startsWith(LAST_SYNC_PREFIX) || key === USERS_CACHE_KEY) keys.push(key);
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
}

export async function fetchSchedule(userSlug: string, semesterId: string, signal?: AbortSignal) {
  if (!API_URL) throw new Error('Remote API ще не налаштовано.');
  const url = new URL(API_URL);
  url.searchParams.set('action', 'schedule');
  url.searchParams.set('user', userSlug);
  url.searchParams.set('semester', semesterId);
  const response = await fetch(url, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error(`API недоступне: HTTP ${response.status}.`);
  const schedule = parseResponse<UserSchedule>(await response.json());
  writeCachedSchedule(schedule);
  try { localStorage.setItem(lastSyncKey(schedule.user.slug, schedule.semester.id), new Date().toISOString()); } catch { /* metadata is optional */ }
  return schedule;
}

async function post<T>(body: Record<string, unknown>) {
  if (!API_URL) throw new Error('Remote API ще не налаштовано.');
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`API недоступне: HTTP ${response.status}.`);
  return parseResponse<T>(await response.json());
}

export async function importPersonalSchedule(args: {
  userSlug: string;
  token: string;
  schedule: ScheduleImportV1;
  mode: 'merge' | 'replace';
  baseRevision: number;
  allowSharedUpdates: boolean;
  dryRun?: boolean;
}) {
  return post<{ schedule?: UserSchedule; revision: number; plan: unknown }>({
    action: args.dryRun ? 'previewImport' : 'importSchedule',
    userSlug: args.userSlug,
    editToken: args.token,
    importMode: args.mode,
    baseRevision: args.baseRevision,
    allowSharedUpdates: args.allowSharedUpdates,
    payload: args.schedule,
  });
}

export async function updateEnrollments(args: {
  userSlug: string;
  token: string;
  semesterId: string;
  enrollments: Array<{ externalCode: string; selectedGroup?: number }>;
  baseRevision: number;
}) {
  return post<{ schedule: UserSchedule; revision: number }>({
    action: 'updateEnrollments',
    userSlug: args.userSlug,
    editToken: args.token,
    semesterId: args.semesterId,
    enrollments: args.enrollments,
    baseRevision: args.baseRevision,
  });
}
