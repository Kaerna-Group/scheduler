// @vitest-environment jsdom
import ICAL from 'ical.js';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScheduleApp } from '@/components/schedule/schedule-app';
import { navigateSchedule } from '@/hooks/use-app-location';
import { createAdminUser } from '@/lib/admin/repository';
import { archiveSemester, createSemester } from '@/lib/semesters/repository';
import {
  fetchSchedule,
  readCachedSchedule,
  storeEditToken,
  updateEnrollments,
} from '@/lib/schedule/repository';
import { createTestBackend } from './support/apps-script-backend';

vi.hoisted(() =>
  vi.stubEnv('VITE_SCHEDULE_API_URL', 'https://scheduler.test/exec'),
);
vi.mock('@/hooks/use-theme', () => ({
  useTheme: () => ({ themeId: 'paper-current' }),
}));
let backend: ReturnType<typeof createTestBackend>;
let blobs: Blob[];
let downloads: Array<{ filename: string; href: string; attached: boolean }>;
let revoke: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/scheduler/');
  backend = createTestBackend();
  vi.stubGlobal('fetch', vi.fn(backend.fetch));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    value: true,
  });
  blobs = [];
  downloads = [];
  revoke = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn((blob: Blob) => {
      blobs.push(blob);
      return `blob:calendar-${blobs.length}`;
    }),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: revoke,
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
    function (this: HTMLAnchorElement) {
      downloads.push({
        filename: this.download,
        href: this.href,
        attached: this.isConnected,
      });
    },
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function open(user = 'ermolz', semester = 'SEM-2026-FALL') {
  window.history.replaceState(
    null,
    '',
    `/scheduler/#/week/6?user=${user}&semester=${semester}&subject=565095`,
  );
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
async function exportDialog() {
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
  fireEvent.click(
    await screen.findByRole('menuitem', { name: 'Export semester (.ics)' }),
  );
  return screen.findByRole('dialog', { name: 'Export semester to calendar' });
}
function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Expected a text calendar file.'));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}
async function downloadedEvents() {
  const text = await readBlob(blobs.at(-1)!);
  const calendar = new ICAL.Component(ICAL.parse(text));
  return {
    text,
    events: calendar
      .getAllSubcomponents('vevent')
      .map((component) => new ICAL.Event(component)),
  };
}
async function createMember() {
  const created = await createAdminUser(backend.token, 1, {
    displayName: 'Calendar Member',
    slug: 'calendar-member',
    role: 'user',
  });
  await updateEnrollments({
    userSlug: created.user.slug,
    token: backend.token,
    semesterId: 'SEM-2026-FALL',
    baseRevision: created.revision,
    enrollments: [{ externalCode: '565095', selectedGroup: 2 }],
  });
  backend.calls.length = 0;
  return created.user;
}

describe('personal semester ICS download', () => {
  it('downloads the full real backend DTO despite the visible week/course filter, without another API request', async () => {
    storeEditToken('ermolz', 'isolated-secret-must-not-be-exported');
    open();
    await ready();
    const snapshot = readCachedSchedule('ermolz', 'SEM-2026-FALL')!;
    const expectedCount = snapshot.lessons.reduce(
      (total, lesson) => total + new Set(lesson.weeks).size,
      0,
    );
    const requests = backend.calls.length;
    const dialog = await exportDialog();
    expect(within(dialog).getByText('Ermolz')).toBeTruthy();
    expect(within(dialog).getByText('Europe/Kyiv')).toBeTruthy();
    expect(within(dialog).getByText(String(expectedCount))).toBeTruthy();
    expect(
      within(dialog).getByText(/visible week and course filter do not limit/),
    ).toBeTruthy();
    expect(
      within(dialog).getByText(/one-time export, not a subscription/),
    ).toBeTruthy();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Download .ics' }),
    );
    expect(blobs).toHaveLength(1);
    expect(blobs[0].type).toBe('text/calendar;charset=utf-8');
    expect(downloads).toEqual([
      {
        filename: 'schedule-ermolz-SEM-2026-FALL.ics',
        href: 'blob:calendar-1',
        attached: true,
      },
    ]);
    expect(document.querySelector('a[download]')).toBeNull();
    const { text, events } = await downloadedEvents();
    expect(events).toHaveLength(expectedCount);
    expect(events.some((event) => event.summary.includes('Electronics'))).toBe(
      true,
    );
    expect(
      events.some((event) => event.description.includes('Week: 1 of')),
    ).toBe(true);
    expect(
      events.some((event) => event.description.includes('Week: 14 of')),
    ).toBe(true);
    expect(text).not.toContain('isolated-secret');
    expect(backend.calls).toHaveLength(requests);
    expect(within(dialog).getByText(/Download started/)).toBeTruthy();
  });

  it('exports only the selected user’s enrollment and group from actual LessonWeeks', async () => {
    const user = await createMember();
    open(user.slug);
    await ready();
    const schedule = readCachedSchedule(user.slug, 'SEM-2026-FALL')!;
    const dialog = await exportDialog();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Download .ics' }),
    );
    const { events } = await downloadedEvents();
    expect(events).toHaveLength(
      schedule.lessons.reduce((n, lesson) => n + lesson.weeks.length, 0),
    );
    expect(events.every((event) => event.summary.includes('Scrum'))).toBe(true);
    expect(events.some((event) => event.summary.endsWith('Group 2'))).toBe(
      true,
    );
    expect(events.some((event) => event.summary.includes('Group 3'))).toBe(
      false,
    );
    expect(downloads[0].filename).toBe(
      'schedule-calendar-member-SEM-2026-FALL.ics',
    );
    for (const lesson of schedule.lessons) {
      const exportedWeeks = events
        .filter((event) => event.uid.includes(`/${lesson.id}/`))
        .map((event) => Number(event.description.match(/Week: (\d+)/)?.[1]));
      expect(exportedWeeks.sort((a, b) => a - b)).toEqual(lesson.weeks);
    }
  });

  it('exports the selected archived semester rather than the backend’s new current semester', async () => {
    const created = await createSemester({
      token: backend.token,
      baseRevision: 1,
      semester: {
        id: 'SEM-CALENDAR-SPRING',
        title: 'New Spring',
        startDate: '2027-02-01',
        weeksCount: 16,
      },
      copySubjects: true,
      sourceSemesterId: 'SEM-2026-FALL',
      makeCurrent: true,
    });
    await archiveSemester({
      token: backend.token,
      baseRevision: created.revision,
      semesterId: 'SEM-2026-FALL',
    });
    backend.calls.length = 0;
    open();
    await ready();
    const dialog = await exportDialog();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Download .ics' }),
    );
    const { events } = await downloadedEvents();
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => event.startDate.year === 2026)).toBe(true);
    expect(downloads[0].filename).toContain('SEM-2026-FALL');
    expect(backend.calls.every((call) => call.method === 'GET')).toBe(true);
  });

  it('allows cached offline export and clearly labels the saved snapshot', async () => {
    await fetchSchedule('ermolz', 'SEM-2026-FALL');
    backend.calls.length = 0;
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    });
    open();
    const dialog = await exportDialog();
    expect(within(dialog).getByText(/Exporting a saved snapshot/)).toBeTruthy();
    expect(within(dialog).getByText(/Last synchronized:/)).toBeTruthy();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Download .ics' }),
    );
    expect(blobs).toHaveLength(1);
    expect(backend.calls).toEqual([]);
  });

  it('labels bundled fallback data as an example, never as synchronized personal data', async () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    });
    open();
    const dialog = await exportDialog();
    expect(within(dialog).getByText(/Local example data/)).toBeTruthy();
    expect(within(dialog).queryByText(/Exporting a saved snapshot/)).toBeNull();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Download .ics' }),
    );
    expect(blobs).toHaveLength(1);
  });

  it('does not download a misleading empty calendar for a user without lessons', async () => {
    const created = await createAdminUser(backend.token, 1, {
      displayName: 'Empty Calendar',
      slug: 'empty-calendar',
      role: 'user',
    });
    open(created.user.slug);
    await ready();
    const dialog = await exportDialog();
    expect(
      within(dialog).getByText(/No scheduled classes to export/),
    ).toBeTruthy();
    expect(
      (
        within(dialog).getByRole('button', {
          name: 'Download .ics',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(blobs).toEqual([]);
  });

  it('disables export while the selection is loading and when the requested user is unavailable', async () => {
    open('unknown-user');
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    const action = await screen.findByRole('menuitem', {
      name: 'Export semester (.ics)',
    });
    expect(action.hasAttribute('data-disabled')).toBe(true);
    await screen.findByText(/Unknown or inactive user/);
    expect(action.hasAttribute('data-disabled')).toBe(true);
    expect(blobs).toEqual([]);
  });

  it('rejects corrupted cached weeks without saving a partial file', async () => {
    const schedule = await fetchSchedule('ermolz', 'SEM-2026-FALL');
    schedule.lessons.at(-1)!.weeks = [999];
    localStorage.setItem(
      'scheduler_cache_v1:ermolz:SEM-2026-FALL',
      JSON.stringify(schedule),
    );
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    });
    open();
    const dialog = await exportDialog();
    expect(within(dialog).getByText(/out-of-range weeks/)).toBeTruthy();
    expect(
      (
        within(dialog).getByRole('button', {
          name: 'Download .ics',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(blobs).toEqual([]);
  });

  it('closes an open export when URL navigation changes the selected user', async () => {
    await createMember();
    open();
    await ready();
    await exportDialog();
    act(() =>
      navigateSchedule(
        window.location.origin +
          '/scheduler/#/week/6?user=calendar-member&semester=SEM-2026-FALL',
      ),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await ready();
    expect(blobs).toEqual([]);
    const dialog = await exportDialog();
    expect(within(dialog).getByText('Calendar Member')).toBeTruthy();
  });

  it('reports download failure, cleans up the temporary link and allows retry', async () => {
    open();
    await ready();
    const dialog = await exportDialog();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementationOnce(
      () => {
        throw new Error('Download blocked');
      },
    );
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Download .ics' }),
    );
    expect(
      within(dialog).getByText(/Could not start the download/),
    ).toBeTruthy();
    expect(within(dialog).queryByText(/Download started/)).toBeNull();
    expect(document.querySelector('a[download]')).toBeNull();
    expect(revoke).toHaveBeenCalledWith('blob:calendar-1');
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Download .ics' }),
    );
    expect(within(dialog).getByText(/Download started/)).toBeTruthy();
  });

  it('releases blob URLs after the browser has time to start the download', async () => {
    open();
    await ready();
    const dialog = await exportDialog();
    vi.useFakeTimers();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Download .ics' }),
    );
    expect(revoke).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(revoke).toHaveBeenCalledWith('blob:calendar-1');
  });
});
