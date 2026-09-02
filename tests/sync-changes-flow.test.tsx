// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScheduleApp } from '@/components/schedule/schedule-app';
import { useSchedule } from '@/hooks/use-schedule';
import { navigateSchedule } from '@/hooks/use-app-location';
import { createAdminUser } from '@/lib/admin/repository';
import { createSemester } from '@/lib/semesters/repository';
import { updatePreferences } from '@/lib/preferences/repository';
import {
  fetchSchedule,
  fetchScheduleUpdate,
  readCachedSchedule,
  readLastSync,
  storeEditToken,
  updateEnrollments,
} from '@/lib/schedule/repository';
import type { UserSchedule } from '@/lib/schedule/types';
import { createTestBackend } from './support/apps-script-backend';

vi.hoisted(() =>
  vi.stubEnv('VITE_SCHEDULE_API_URL', 'https://scheduler.test/exec'),
);
vi.mock('@/hooks/use-theme', () => ({ useTheme: vi.fn() }));
let backend: ReturnType<typeof createTestBackend>;
const semester = 'SEM-2026-FALL';
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/scheduler/');
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    value: true,
  });
  backend = createTestBackend();
  vi.stubGlobal('fetch', vi.fn(backend.fetch));
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-02T09:00:00Z'));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function dto(user = 'ermolz') {
  return backend.buildSchedule(user, semester) as UserSchedule;
}
function edit(change: (data: ReturnType<typeof backend.snapshot>) => void) {
  const data = backend.snapshot();
  change(data);
  const revision = data.Meta.find((row) => row.key === 'data_revision')!;
  revision.value = String(Number(revision.value) + 1);
  backend.replaceDatabase(data);
}
function rooms(count = 2, prefix = 'NEW') {
  const ids = dto()
    .lessons.slice(0, count)
    .map((lesson) => lesson.id);
  edit((data) =>
    ids.forEach((id, index) => {
      data.Lessons.find((row) => row.lesson_id === id)!.room =
        `${prefix}-${index + 1}`;
    }),
  );
  return ids;
}
function open(
  hash = `#/week/6?user=ermolz&semester=${semester}&subject=565095`,
) {
  window.history.replaceState(null, '', '/scheduler/' + hash);
  return render(<ScheduleApp />);
}
async function ready() {
  await screen.findByText(/Up to date · revision/);
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
}
async function refresh() {
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await ready();
}
async function details() {
  fireEvent.click(
    screen.getByRole('button', { name: /changed.*View changes/ }),
  );
  return screen.findByRole('dialog', { name: 'Changes since last sync' });
}
function network(online: boolean) {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    value: online,
  });
  fireEvent(window, new Event(online ? 'online' : 'offline'));
}

describe('synchronization change notice', () => {
  it('captures the previous DTO and timestamp before overwriting the cache', async () => {
    const first = await fetchSchedule('ermolz', semester);
    const saved = readLastSync('ermolz', semester);
    rooms();
    vi.setSystemTime(new Date('2026-09-02T10:00:00Z'));
    const update = await fetchScheduleUpdate('ermolz', semester);
    expect(update.previousSchedule).toEqual(first);
    expect(update.previousSync).toBe(saved);
    expect(update.syncedAt).toBe('2026-09-02T10:00:00.000Z');
    expect(readCachedSchedule('ermolz', semester)).toEqual(update.schedule);
    expect(readLastSync('ermolz', semester)).toBe(update.syncedAt);
    expect(update.previousSchedule?.lessons).not.toEqual(
      update.schedule.lessons,
    );
  });

  it('shows a clickable 2-class notice from real DTOs, independent of the selected week/filter', async () => {
    storeEditToken('ermolz', 'secret-not-for-diff');
    open();
    await ready();
    expect(screen.queryByRole('button', { name: /View changes/ })).toBeNull();
    rooms();
    await refresh();
    expect(
      screen.getByRole('button', { name: '2 classes changed View changes' }),
    ).toBeTruthy();
    const requests = backend.calls.length;
    const dialog = await details();
    expect(within(dialog).getByText(/Ermolz ·/)).toBeTruthy();
    expect(within(dialog).getByText('Revision 1 → 2')).toBeTruthy();
    expect(
      within(dialog).getByText('0 added · 2 updated · 0 removed'),
    ).toBeTruthy();
    expect(within(dialog).getByText('NEW-1')).toBeTruthy();
    expect(within(dialog).getByText('NEW-2')).toBeTruthy();
    expect(dialog.textContent).not.toContain('secret-not-for-diff');
    expect(backend.calls).toHaveLength(requests);
    expect(backend.calls.every((call) => call.method === 'GET')).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(
      screen.getByRole('button', { name: /2 classes changed/ }),
    ).toBeTruthy();
  });

  it('compares initial refresh with the saved cache on reopening, including implicit URL normalization', async () => {
    await fetchSchedule('ermolz', semester);
    rooms(1);
    open('');
    await ready();
    expect(
      screen.getByRole('button', { name: '1 class changed View changes' }),
    ).toBeTruthy();
    expect(window.location.hash).toContain(`semester=${semester}`);
    expect(
      backend.calls.filter((call) => call.action === 'schedule'),
    ).toHaveLength(2);
  });

  it('uses the immediately previous sync on each refresh, never the original mount snapshot', async () => {
    open();
    await ready();
    rooms(1, 'FIRST');
    await refresh();
    rooms(1, 'SECOND');
    await refresh();
    const dialog = await details();
    expect(within(dialog).getByText('Revision 2 → 3')).toBeTruthy();
    expect(within(dialog).getByText('FIRST-1')).toBeTruthy();
    expect(within(dialog).getByText('SECOND-1')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await refresh();
    expect(screen.queryByRole('button', { name: /View changes/ })).toBeNull();
  });

  it('can dismiss the notice without clearing or modifying the schedule cache', async () => {
    await fetchSchedule('ermolz', semester);
    rooms(1);
    open();
    await ready();
    const cached = readCachedSchedule('ermolz', semester);
    const dialog = await details();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Dismiss notice' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('button', { name: /View changes/ })).toBeNull();
    expect(readCachedSchedule('ermolz', semester)).toEqual(cached);
    await refresh();
    expect(screen.queryByRole('button', { name: /View changes/ })).toBeNull();
  });

  it('ignores preferences-only and unrelated user/revision changes', async () => {
    open();
    await ready();
    await updatePreferences({
      userSlug: 'ermolz',
      token: backend.token,
      baseSettingsRevision: 0,
      patch: { schedule: { density: 'compact' } },
    });
    await refresh();
    expect(screen.queryByRole('button', { name: /View changes/ })).toBeNull();
    await createAdminUser(backend.token, 1, {
      displayName: 'Unrelated',
      slug: 'unrelated',
      role: 'user',
    });
    await refresh();
    expect(screen.queryByRole('button', { name: /View changes/ })).toBeNull();
  });

  it('preserves the last successful comparison on a failed refresh, then resumes on reconnect', async () => {
    open();
    await ready();
    rooms(1, 'FIRST');
    await refresh();
    const cached = readCachedSchedule('ermolz', semester);
    rooms(1, 'SECOND');
    vi.mocked(fetch).mockRejectedValueOnce(
      new Error('Temporary network failure'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByText('Temporary network failure');
    expect(readCachedSchedule('ermolz', semester)).toEqual(cached);
    expect(
      screen.getByRole('button', { name: '1 class changed View changes' }),
    ).toBeTruthy();
    network(false);
    network(true);
    await ready();
    const dialog = await details();
    expect(within(dialog).getByText('FIRST-1')).toBeTruthy();
    expect(within(dialog).getByText('SECOND-1')).toBeTruthy();
  });

  it('compares a cached offline snapshot when connectivity returns', async () => {
    await fetchSchedule('ermolz', semester);
    rooms(1);
    network(false);
    open();
    expect(screen.queryByRole('button', { name: /View changes/ })).toBeNull();
    network(true);
    await ready();
    expect(
      screen.getByRole('button', { name: '1 class changed View changes' }),
    ).toBeTruthy();
  });

  it('does not show fallback-to-first-remote data as user changes', async () => {
    rooms(2);
    open();
    await ready();
    expect(screen.queryByRole('button', { name: /View changes/ })).toBeNull();
  });

  it('clears an open comparison when navigating to another user', async () => {
    await createAdminUser(backend.token, 1, {
      displayName: 'Different',
      slug: 'different',
      role: 'user',
    });
    open();
    await ready();
    rooms(1);
    await refresh();
    await details();
    act(() =>
      navigateSchedule(
        window.location.origin +
          `/scheduler/#/week/6?user=different&semester=${semester}`,
      ),
    );
    await ready();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('button', { name: /View changes/ })).toBeNull();
  });

  it('does not compare a newly selected semester with the previously displayed one', async () => {
    await fetchSchedule('ermolz', semester);
    const created = await createSemester({
      token: backend.token,
      baseRevision: 1,
      semester: {
        id: 'SEM-SYNC-NEW',
        title: 'Spring',
        startDate: '2027-02-01',
        weeksCount: 16,
      },
      copySubjects: true,
      sourceSemesterId: semester,
      makeCurrent: true,
    });
    open('');
    await ready();
    expect(window.location.hash).toContain('SEM-SYNC-NEW');
    expect(screen.queryByRole('button', { name: /View changes/ })).toBeNull();
    expect(created.revision).toBe(2);
  });

  it('detects real personal group changes and course enrollments without lessons', async () => {
    open();
    await ready();
    const before = dto();
    const scrum = before.subjects.find(
      (subject) => subject.externalCode === '565095',
    )!;
    await updateEnrollments({
      userSlug: 'ermolz',
      token: backend.token,
      semesterId: semester,
      baseRevision: before.revision,
      enrollments: before.subjects
        .filter((subject) => subject.externalCode)
        .map((subject) => ({
          externalCode: subject.externalCode!,
          selectedGroup: subject.id === scrum.id ? 2 : subject.selectedGroup,
        })),
    });
    await refresh();
    const dialog = await details();
    expect(within(dialog).getByText('Selected group')).toBeTruthy();
    expect(
      within(dialog).getByText('1 added · 0 updated · 1 removed'),
    ).toBeTruthy();
    expect(
      within(dialog).getByRole('region', { name: 'Courses and enrollments' }),
    ).toBeTruthy();
  });

  it('keeps comparing in memory when browser storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Storage blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage blocked');
    });
    const { result } = renderHook(() =>
      useSchedule({ userSlug: 'ermolz', semesterId: semester, fromLink: true }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.syncChanges).toBeNull();
    rooms(1);
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.syncChanges?.lessons).toHaveLength(1);
    expect(result.current.syncChanges?.fromRevision).toBe(1);
    expect(result.current.syncChanges?.previousSync).toBe(
      '2026-09-02T09:00:00.000Z',
    );
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.syncChanges).toBeNull();
  });

  it('does not let a canceled older refresh replace the current cache or diff', async () => {
    const { result } = renderHook(() =>
      useSchedule({ userSlug: 'ermolz', semesterId: semester, fromLink: true }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    rooms(1, 'STALE');
    const stale = await backend.fetch(
      `https://scheduler.test/exec?action=schedule&user=ermolz&semester=${semester}`,
    );
    let release!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    let older!: Promise<void>;
    act(() => {
      older = result.current.refresh();
    });
    rooms(1, 'LATEST');
    await act(async () => {
      await result.current.refresh();
    });
    const latestDiff = result.current.syncChanges;
    await act(async () => {
      release(stale);
      await older;
    });
    expect(result.current.schedule.revision).toBe(3);
    expect(readCachedSchedule('ermolz', semester)?.revision).toBe(3);
    expect(result.current.syncChanges).toBe(latestDiff);
    expect(JSON.stringify(result.current.syncChanges)).toContain('LATEST-1');
    expect(JSON.stringify(result.current.syncChanges)).not.toContain('STALE-1');
  });

  it('rejects a response for a different user without replacing either cache', async () => {
    const before = await fetchSchedule('ermolz', semester);
    const wrong = { ...before, user: { ...before.user, slug: 'wrong-user' } };
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, apiVersion: 1, data: wrong })),
    );
    await expect(fetchScheduleUpdate('ermolz', semester)).rejects.toThrow(
      'different user or semester',
    );
    expect(readCachedSchedule('ermolz', semester)).toEqual(before);
    expect(readCachedSchedule('wrong-user', semester)).toBeNull();
  });
});
