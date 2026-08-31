import { fallbackSchedule } from '@/data/fallback-schedule';
import type { ScheduleImportV1, UserSchedule } from '@/lib/schedule/types';

const API_URL = (import.meta.env.VITE_SCHEDULE_API_URL as string | undefined)?.trim() ?? '';
const CACHE_PREFIX = 'scheduler_cache_v1:';
const EDIT_TOKEN_PREFIX = 'scheduler_edit_token_v1:';

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

export function getFallbackSchedule(userSlug = fallbackSchedule.user.slug): UserSchedule {
  const user = fallbackSchedule.users.find((item) => item.slug === userSlug) ?? fallbackSchedule.user;
  return { ...fallbackSchedule, user };
}

export function readCachedSchedule(userSlug: string, semesterId: string): UserSchedule | null {
  try {
    const raw = localStorage.getItem(cacheKey(userSlug, semesterId));
    return raw ? (JSON.parse(raw) as UserSchedule) : null;
  } catch {
    return null;
  }
}

function writeCachedSchedule(schedule: UserSchedule) {
  try {
    localStorage.setItem(cacheKey(schedule.user.slug, schedule.semester.id), JSON.stringify(schedule));
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
