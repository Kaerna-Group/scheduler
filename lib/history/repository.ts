import { getApi, postApi } from '@/lib/api/client';
import type { ScheduleHistoryResponse } from '@/lib/history/types';
import type { UserSchedule } from '@/lib/schedule/types';

const HISTORY_CACHE_PREFIX = 'scheduler_history_v1:';

function historyCacheKey(userSlug: string, semesterId: string) {
  return `${HISTORY_CACHE_PREFIX}${userSlug}:${semesterId}`;
}

export function readCachedHistory(userSlug: string, semesterId: string): ScheduleHistoryResponse | null {
  try {
    const raw = localStorage.getItem(historyCacheKey(userSlug, semesterId));
    return raw ? JSON.parse(raw) as ScheduleHistoryResponse : null;
  } catch {
    return null;
  }
}

function writeCachedHistory(response: ScheduleHistoryResponse) {
  try {
    localStorage.setItem(historyCacheKey(response.user.slug, response.semesterId), JSON.stringify(response));
  } catch {
    // History remains available in memory when storage is unavailable.
  }
}

export async function fetchScheduleHistory(userSlug: string, semesterId: string, signal?: AbortSignal) {
  const history = await getApi<ScheduleHistoryResponse>({
    action: 'changes', user: userSlug, semester: semesterId, limit: '150',
  }, signal);
  writeCachedHistory(history);
  return history;
}

export async function undoLastImport(args: { token: string; baseRevision: number }) {
  return postApi<{ revision: number; undoneRevision: number; schedule: UserSchedule }>({
    action: 'undoLastImport',
    editToken: args.token,
    baseRevision: args.baseRevision,
  });
}
