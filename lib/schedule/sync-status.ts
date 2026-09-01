import type { ScheduleSource } from '@/lib/schedule/types';

export type ScheduleSyncStatusKind =
  | 'current'
  | 'offline'
  | 'pending'
  | 'unavailable'
  | 'stale'
  | 'local';

export interface ScheduleSyncStatus {
  kind: ScheduleSyncStatusKind;
  label: string;
}

interface ScheduleSyncStatusInput {
  online: boolean;
  remoteConfigured: boolean;
  source: ScheduleSource;
  lastSync: string;
  backendError: string;
  hasPendingChanges: boolean;
}

function formatSyncTime(value: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function dataAgeLabel(prefix: string, lastSync: string, fallback: string) {
  const time = formatSyncTime(lastSync);
  return time ? `${prefix} ${time}` : fallback;
}

export function getScheduleSyncStatus(
  input: ScheduleSyncStatusInput,
): ScheduleSyncStatus {
  if (input.hasPendingChanges) {
    return { kind: 'pending', label: 'Unsynchronized changes' };
  }
  if (!input.remoteConfigured) {
    return { kind: 'unavailable', label: 'Backend unavailable' };
  }
  if (!input.online) {
    return {
      kind: 'offline',
      label: dataAgeLabel(
        'Offline — data from',
        input.lastSync,
        'Offline — local data',
      ),
    };
  }
  if (input.backendError) {
    return { kind: 'unavailable', label: 'Backend unavailable' };
  }
  if (input.source === 'remote') {
    return { kind: 'current', label: 'Up to date' };
  }
  if (input.source === 'cache') {
    return {
      kind: 'stale',
      label: dataAgeLabel('Cache — data from', input.lastSync, 'Cached data'),
    };
  }
  return { kind: 'local', label: 'Local fallback data' };
}
