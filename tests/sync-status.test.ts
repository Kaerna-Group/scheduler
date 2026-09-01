import { describe, expect, it, vi } from 'vitest';

import { subscribeToNetworkStatus } from '@/lib/network/connectivity';
import { getScheduleSyncStatus } from '@/lib/schedule/sync-status';

const base = {
  online: true,
  remoteConfigured: true,
  source: 'remote' as const,
  lastSync: '2026-09-01T12:41:00.000Z',
  backendError: '',
  hasPendingChanges: false,
};

describe('schedule sync status', () => {
  it('prioritizes pending changes over connectivity states', () => {
    expect(
      getScheduleSyncStatus({
        ...base,
        online: false,
        hasPendingChanges: true,
      }),
    ).toEqual({ kind: 'pending', label: 'Unsynchronized changes' });
  });

  it('distinguishes current, offline, stale, and unavailable data', () => {
    expect(getScheduleSyncStatus(base)).toEqual({
      kind: 'current',
      label: 'Up to date',
    });
    expect(getScheduleSyncStatus({ ...base, online: false })).toMatchObject({
      kind: 'offline',
    });
    expect(getScheduleSyncStatus({ ...base, source: 'cache' })).toMatchObject({
      kind: 'stale',
    });
    expect(
      getScheduleSyncStatus({ ...base, backendError: 'Failed to fetch' }),
    ).toEqual({
      kind: 'unavailable',
      label: 'Backend unavailable',
    });
  });
});

describe('network status subscription', () => {
  it('reports browser online and offline events and unsubscribes cleanly', () => {
    const browserWindow = new EventTarget();
    vi.stubGlobal('window', browserWindow);
    const changes: boolean[] = [];
    const unsubscribe = subscribeToNetworkStatus((online) =>
      changes.push(online),
    );

    browserWindow.dispatchEvent(new Event('offline'));
    browserWindow.dispatchEvent(new Event('online'));
    unsubscribe();
    browserWindow.dispatchEvent(new Event('offline'));

    expect(changes).toEqual([false, true]);
  });
});
