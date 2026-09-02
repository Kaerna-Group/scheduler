// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePreferences } from '@/hooks/use-preferences';
import { ApiError } from '@/lib/api/client';
import { defaultPreferences } from '@/lib/preferences/defaults';
import {
  activatePreferencesUser,
  preferencesStorageKey,
  readPreferencesRecord,
} from '@/lib/preferences/local-storage';
import { updatePreferences } from '@/lib/preferences/repository';
import { storeEditToken } from '@/lib/schedule/repository';

vi.mock('@/lib/api/client', async (original) => ({
  ...(await original<typeof import('@/lib/api/client')>()),
  hasRemoteApi: () => true,
}));
vi.mock('@/lib/preferences/repository', async (original) => ({
  ...(await original<typeof import('@/lib/preferences/repository')>()),
  updatePreferences: vi.fn(),
}));
const compact = {
  ...defaultPreferences,
  schedule: { ...defaultPreferences.schedule, density: 'compact' as const },
};
function stale() {
  return new ApiError({
    ok: false,
    error: {
      code: 'SETTINGS_STALE',
      message: 'Changed remotely',
      details: { preferences: defaultPreferences, preferencesRevision: 9 },
    },
  });
}
function network(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value });
  window.dispatchEvent(new Event(value ? 'online' : 'offline'));
}
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  vi.useFakeTimers();
  network(true);
  localStorage.setItem('scheduler_selected_user_v1', 'ermolz');
  localStorage.setItem(
    preferencesStorageKey('ermolz'),
    JSON.stringify({
      preferences: compact,
      preferencesRevision: 4,
      pendingPatch: { schedule: { density: 'compact' } },
    }),
  );
  storeEditToken('ermolz', 'fixture-token');
  vi.mocked(updatePreferences).mockResolvedValue({
    preferences: compact,
    preferencesRevision: 5,
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('pending preference synchronization', () => {
  it('preserves offline patches and sends them on reconnect', async () => {
    network(false);
    const { result } = renderHook(usePreferences);
    await advance(10000);
    expect(updatePreferences).not.toHaveBeenCalled();
    expect(result.current.syncStatus).toBe('pending');
    act(() => network(true));
    await advance(600);
    expect(updatePreferences).toHaveBeenCalledTimes(1);
    expect(result.current.syncStatus).toBe('saved');
    expect(result.current.hasPendingChanges).toBe(false);
    expect(readPreferencesRecord('ermolz').preferences.schedule.density).toBe(
      'compact',
    );
  });
  it('retries transient backend failures without needing a new online event', async () => {
    vi.mocked(updatePreferences).mockRejectedValueOnce(
      new Error('Backend down'),
    );
    const { result } = renderHook(usePreferences);
    await advance(600);
    expect(result.current.syncStatus).toBe('error');
    expect(result.current.hasPendingChanges).toBe(true);
    await advance(1999);
    expect(updatePreferences).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(updatePreferences).toHaveBeenCalledTimes(2);
    expect(result.current.hasPendingChanges).toBe(false);
  });
  it('retries a settings conflict once with the server revision', async () => {
    vi.mocked(updatePreferences).mockRejectedValueOnce(stale());
    renderHook(usePreferences);
    await advance(600);
    expect(updatePreferences).toHaveBeenCalledTimes(2);
    expect(
      vi.mocked(updatePreferences).mock.calls[1][0].baseSettingsRevision,
    ).toBe(9);
  });
  it.each([
    'API_VERSION_MISSING',
    'API_VERSION_MISMATCH',
    'INVALID_API_RESPONSE',
  ])(
    'preserves pending preferences and does not automatically retry %s',
    async (code) => {
      vi.mocked(updatePreferences).mockRejectedValueOnce(
        new ApiError({
          ok: false,
          error: { code, message: 'Update the backend or frontend' },
        }),
      );
      const { result } = renderHook(usePreferences);
      await advance(600);
      await advance(60000);
      expect(updatePreferences).toHaveBeenCalledTimes(1);
      expect(result.current.syncStatus).toBe('error');
      expect(result.current.hasPendingChanges).toBe(true);
      expect(readPreferencesRecord('ermolz').pendingPatch).toBeDefined();
    },
  );

  it('does not retry revoked credentials but resumes after a token replacement', async () => {
    vi.mocked(updatePreferences).mockRejectedValueOnce(
      new ApiError({
        ok: false,
        error: { code: 'UNAUTHORIZED', message: 'Revoked' },
      }),
    );
    renderHook(usePreferences);
    await advance(600);
    await advance(60000);
    expect(updatePreferences).toHaveBeenCalledTimes(1);
    act(() => storeEditToken('ermolz', 'replacement-token'));
    await advance(600);
    expect(updatePreferences).toHaveBeenCalledTimes(2);
    expect(vi.mocked(updatePreferences).mock.calls[1][0].token).toBe(
      'replacement-token',
    );
  });
  it('cancels retries and ignores late conflict responses after switching users', async () => {
    let reject!: (error: unknown) => void;
    vi.mocked(updatePreferences).mockReturnValueOnce(
      new Promise((_resolve, no) => {
        reject = no;
      }),
    );
    const { result } = renderHook(usePreferences);
    await advance(600);
    await act(async () => {
      activatePreferencesUser('other');
    });
    await act(async () => reject(stale()));
    await advance(60000);
    expect(updatePreferences).toHaveBeenCalledTimes(1);
    expect(result.current.preferencesUser).toBe('other');
    expect(readPreferencesRecord('ermolz').pendingPatch).toBeDefined();
    expect(vi.mocked(updatePreferences).mock.calls[0][0].signal?.aborted).toBe(
      true,
    );
  });
  it('cancels backoff on unmount and never sends after cleanup', async () => {
    vi.mocked(updatePreferences).mockRejectedValueOnce(new Error('Network'));
    const { unmount } = renderHook(usePreferences);
    await advance(600);
    unmount();
    await advance(60000);
    expect(updatePreferences).toHaveBeenCalledTimes(1);
  });
  it('keeps the newer local preference when an older request finishes late', async () => {
    let resolve!: (
      value: Awaited<ReturnType<typeof updatePreferences>>,
    ) => void;
    vi.mocked(updatePreferences).mockReturnValueOnce(
      new Promise((yes) => {
        resolve = yes;
      }),
    );
    const { result } = renderHook(usePreferences);
    await advance(600);
    act(() =>
      result.current.setPreferences((current) => ({
        ...current,
        schedule: { ...current.schedule, density: 'comfortable' },
      })),
    );
    await act(async () =>
      resolve({ preferences: compact, preferencesRevision: 5 }),
    );
    expect(result.current.preferences.schedule.density).toBe('comfortable');
    expect(result.current.hasPendingChanges).toBe(true);
  });
});
