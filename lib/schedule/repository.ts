import { fallbackSchedule } from '@/data/fallback-schedule';
import { getApi, postApi } from '@/lib/api/client';
import type { ImportPlanResponse, LessonParticipantEntry, ScheduleImportV1, ScheduleUser, SharedConflictResolution, UserSchedule } from '@/lib/schedule/types';

const CACHE_PREFIX = 'scheduler_cache_v1:';
const PARTICIPANT_CACHE_PREFIX = 'scheduler_participants_v1:';
const USERS_CACHE_KEY = 'scheduler_users_v1';
export { EDIT_TOKEN_EVENT, getStoredEditToken, storeEditToken, forgetAllEditTokens } from '@/lib/auth/edit-tokens';
const LAST_SYNC_PREFIX = 'scheduler_last_sync_v1:';
const HISTORY_CACHE_PREFIX = 'scheduler_history_v1:';

function cacheKey(userSlug: string, semesterId: string) {
  return `${CACHE_PREFIX}${userSlug}:${semesterId}`;
}

function participantCacheKey(userSlug: string, semesterId: string) {
  return `${PARTICIPANT_CACHE_PREFIX}${userSlug}:${semesterId}`;
}

interface CachedParticipantChecks {
  version: 1;
  userSlug: string;
  semesterId: string;
  revision: number;
  lessonParticipants: LessonParticipantEntry[];
  participantUserCount: number;
}

type ParticipantChecks = Pick<
  CachedParticipantChecks,
  'lessonParticipants' | 'participantUserCount'
>;

function validParticipantEntries(value: unknown): value is LessonParticipantEntry[] {
  return Array.isArray(value) && value.every((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const item = entry as Partial<LessonParticipantEntry>;
    return typeof item.lessonId === 'string' && Number.isInteger(item.week) &&
      Number(item.week) > 0 && Array.isArray(item.userIds) &&
      item.userIds.every((userId) => typeof userId === 'string');
  });
}

function participantChecksForSchedule(
  schedule: UserSchedule,
): ParticipantChecks | null {
  if (!validParticipantEntries(schedule.lessonParticipants) ||
    !Number.isInteger(schedule.participantUserCount) ||
    Number(schedule.participantUserCount) < 0) return null;
  const occurrences = new Set(schedule.lessons.flatMap((lesson) =>
    lesson.weeks.map((week) => `${lesson.id}:${week}`)));
  if (schedule.lessonParticipants.some((entry) =>
    !occurrences.has(`${entry.lessonId}:${entry.week}`))) return null;
  return {
    lessonParticipants: schedule.lessonParticipants,
    participantUserCount: Number(schedule.participantUserCount),
  };
}

function readCachedParticipantChecks(
  schedule: UserSchedule,
): ParticipantChecks | null {
  try {
    const raw = localStorage.getItem(participantCacheKey(
      schedule.user.slug,
      schedule.semester.id,
    ));
    if (!raw) return null;
    const cached = JSON.parse(raw) as Partial<CachedParticipantChecks>;
    if (cached.version !== 1 || cached.userSlug !== schedule.user.slug ||
      cached.semesterId !== schedule.semester.id ||
      cached.revision !== schedule.revision) return null;
    return participantChecksForSchedule({
      ...schedule,
      lessonParticipants: cached.lessonParticipants,
      participantUserCount: cached.participantUserCount,
    });
  } catch {
    return null;
  }
}

function writeCachedParticipantChecks(schedule: UserSchedule) {
  const checks = participantChecksForSchedule(schedule);
  const key = participantCacheKey(schedule.user.slug, schedule.semester.id);
  try {
    if (!checks) {
      localStorage.removeItem(key);
      return;
    }
    const cached: CachedParticipantChecks = {
      version: 1,
      userSlug: schedule.user.slug,
      semesterId: schedule.semester.id,
      revision: schedule.revision,
      ...checks,
    };
    localStorage.setItem(key, JSON.stringify(cached));
  } catch {
    // Participant checks remain available from the in-memory schedule.
  }
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
    if (schedule.user.slug !== userSlug || schedule.semester.id !== semesterId)
      return null;
    const participantChecks = readCachedParticipantChecks(schedule) ??
      participantChecksForSchedule(schedule) ?? {};
    const users = mergeScheduleUsers(schedule.users, readCachedUsers());
    return {
      ...schedule,
      ...participantChecks,
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
    writeCachedParticipantChecks(schedule);
    writeCachedUsers(schedule.users);
  } catch {
    // Cache is a best-effort acceleration layer.
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
      if (key?.startsWith(CACHE_PREFIX) || key?.startsWith(PARTICIPANT_CACHE_PREFIX) || key?.startsWith(LAST_SYNC_PREFIX) || key?.startsWith(HISTORY_CACHE_PREFIX) || key === USERS_CACHE_KEY) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  } catch {
    // Clearing cache is best effort when storage is restricted.
  }
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
