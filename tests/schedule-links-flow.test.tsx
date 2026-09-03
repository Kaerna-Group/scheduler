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
import { AppRouter } from '@/components/app-router';
import { ACCESS_KEY, AccessGate } from '@/components/access/access-gate';
import { navigateSchedule } from '@/hooks/use-app-location';
import { useSchedule } from '@/hooks/use-schedule';
import { createAdminUser } from '@/lib/admin/repository';
import { createSemester } from '@/lib/semesters/repository';
import {
  fetchSchedule,
  storeEditToken,
  updateEnrollments,
} from '@/lib/schedule/repository';
import { cloneDefaultPreferences } from '@/lib/preferences/defaults';
import { preferencesStorageKey } from '@/lib/preferences/local-storage';
import { parseScheduleLocation } from '@/lib/schedule/location';
import { getSemesterWeek } from '@/lib/schedule/utils';
import { fallbackSchedule } from '@/data/fallback-schedule';
import { createTestBackend } from './support/apps-script-backend';

vi.hoisted(() =>
  vi.stubEnv('VITE_SCHEDULE_API_URL', 'https://scheduler.test/exec'),
);
vi.mock('@/hooks/use-theme', () => ({
  useTheme: () => ({ themeId: 'paper-current' }),
}));
let backend: ReturnType<typeof createTestBackend>;
let copy: ReturnType<typeof vi.fn>;
let scroll: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
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
  copy = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: copy },
  });
  scroll = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: scroll,
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function open(hash: string) {
  window.history.replaceState(null, '', '/scheduler/' + hash);
  return render(<ScheduleApp />);
}
function chosenWeek(week: number) {
  expect(
    screen
      .getByRole('button', { name: `Week ${week}` })
      .getAttribute('aria-current'),
  ).toBe('true');
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
function route() {
  return parseScheduleLocation(window.location.href);
}
async function copyLink() {
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
  fireEvent.click(
    await screen.findByRole('menuitem', { name: 'Copy schedule link' }),
  );
}
async function selectOption(name: string) {
  const option = await screen.findByRole('option', { name });
  fireEvent.pointerDown(option, { pointerType: 'mouse' });
  fireEvent.click(option);
}
async function member() {
  const created = await createAdminUser(backend.token, 1, {
    displayName: 'Linked User',
    slug: 'linked-user',
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
  return created;
}
function savedPreferences(
  patch: Partial<ReturnType<typeof cloneDefaultPreferences>['schedule']>,
) {
  const preferences = cloneDefaultPreferences();
  Object.assign(preferences.schedule, patch);
  localStorage.setItem(
    preferencesStorageKey('ermolz'),
    JSON.stringify({ preferences, preferencesRevision: 0 }),
  );
}

describe('shareable schedule state', () => {
  it('opens every course occurrence from a catalog link and copies a link that works with empty device storage', async () => {
    savedPreferences({ showSaturday: false, showEmptyDays: false });
    open('#/courses?user=ermolz&semester=SEM-2026-FALL&week=14');
    await ready();
    const card = screen.getByRole('link', {
      name: 'View Electronics and Digital Electronics',
    });
    expect(card.textContent).toContain('18 classes this semester');
    fireEvent.click(card);
    await screen.findByRole('heading', {
      name: 'Electronics and Digital Electronics',
      level: 1,
    });
    expect(route()).toMatchObject({
      view: 'subjects',
      week: 14,
      subject: '564966',
    });
    const lectures = within(screen.getByRole('region', { name: 'Lectures' }));
    const groups = within(
      screen.getByRole('region', { name: 'Group classes' }),
    );
    expect(lectures.getAllByRole('listitem')).toHaveLength(9);
    expect(groups.getAllByRole('listitem')).toHaveLength(9);
    expect(lectures.getByText('19 Sept 2026')).toBeTruthy();
    expect(lectures.getByText('14 Nov 2026')).toBeTruthy();
    expect(groups.getByText('23 Sept 2026')).toBeTruthy();
    expect(groups.getByText('18 Nov 2026')).toBeTruthy();
    const first = within(lectures.getAllByRole('listitem')[0]);
    for (const text of [
      'Saturday · Week 3',
      '08:30',
      '09:50',
      'Ya. I. Vozniuk',
      '1-310',
      'On campus',
    ])
      expect(first.getByText(text)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Next week' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Weekdays' })).toBeNull();
    await copyLink();
    await screen.findByText('Link copied');
    const copied = copy.mock.calls[0][0] as string;
    expect(parseScheduleLocation(copied)).toMatchObject({
      view: 'subjects',
      user: 'ermolz',
      semester: 'SEM-2026-FALL',
      subject: '564966',
    });
    cleanup();
    localStorage.clear();
    sessionStorage.clear();
    open(new URL(copied).hash);
    await ready();
    expect(
      within(screen.getByRole('region', { name: 'Lectures' })).getAllByRole(
        'listitem',
      ),
    ).toHaveLength(9);
    fireEvent.click(screen.getByRole('link', { name: 'Back to all courses' }));
    await screen.findByRole('link', {
      name: 'View Electronics and Digital Electronics',
    });
    expect(route()).toMatchObject({
      view: 'subjects',
      user: 'ermolz',
      semester: 'SEM-2026-FALL',
      week: 14,
    });
    expect(route()?.subject).toBeUndefined();
    expect(backend.calls.every((call) => call.method === 'GET')).toBe(true);
  });

  it('opens the course filter as a full detail view using only the linked user’s personal group, including offline', async () => {
    await member();
    open('#/courses?user=linked-user&semester=SEM-2026-FALL&week=14');
    await ready();
    fireEvent.click(screen.getByRole('combobox', { name: 'Course filter' }));
    await selectOption('Scrum Fundamentals');
    expect(
      screen.getByRole('heading', {
        name: 'Scrum Framework Fundamentals',
        level: 1,
      }),
    ).toBeTruthy();
    const groups = within(
      screen.getByRole('region', { name: 'Group classes' }),
    );
    expect(groups.getAllByRole('listitem')).toHaveLength(7);
    expect(groups.getAllByText('Group 2')).toHaveLength(7);
    expect(groups.queryByText('Group 1')).toBeNull();
    expect(groups.queryByText('Group 3')).toBeNull();
    expect(groups.getAllByText('Online')).toHaveLength(7);
    const hash = window.location.hash;
    cleanup();
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    });
    backend.calls.length = 0;
    open(hash);
    expect(
      within(
        screen.getByRole('region', { name: 'Group classes' }),
      ).getAllByRole('listitem'),
    ).toHaveLength(7);
    expect(backend.calls).toHaveLength(0);
  });

  it('shows empty and missing courses explicitly and recovers through the catalog', async () => {
    open(
      '#/courses?user=ermolz&semester=SEM-2026-FALL&subject=LOCAL-QUALIFICATION',
    );
    await ready();
    expect(
      screen.getByRole('heading', { name: 'Qualification Project', level: 1 }),
    ).toBeTruthy();
    expect(
      screen.getByText('No classes scheduled for this course this semester.'),
    ).toBeTruthy();
    expect(
      within(screen.getByRole('region', { name: 'Lectures' })).queryAllByRole(
        'listitem',
      ),
    ).toHaveLength(0);
    act(() =>
      navigateSchedule(
        window.location.origin +
          '/scheduler/#/courses?user=ermolz&semester=SEM-2026-FALL&subject=UNKNOWN',
      ),
    );
    expect(
      screen.getByRole('heading', { name: 'Course not found', level: 1 }),
    ).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Lectures' })).toBeNull();
    expect(route()?.subject).toBe('UNKNOWN');
    fireEvent.click(screen.getByRole('button', { name: 'Show all courses' }));
    expect(
      screen.getByRole('link', { name: 'View Qualification Project' }),
    ).toBeTruthy();
  });

  it('retains the latest linked profile when navigation removes URL selection', async () => {
    await member();
    const { result, rerender } = renderHook(
      ({ userSlug }: { userSlug: string | undefined }) =>
        useSchedule({ userSlug }),
      { initialProps: { userSlug: 'ermolz' as string | undefined } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender({ userSlug: 'linked-user' });
    await waitFor(() =>
      expect(result.current.schedule.user.slug).toBe('linked-user'),
    );
    expect(localStorage.getItem('scheduler_selected_user_v1')).toBe(
      'linked-user',
    );
    rerender({ userSlug: undefined });
    expect(result.current.selectedUser).toBe('linked-user');
    expect(localStorage.getItem('scheduler_selected_user_v1')).toBe(
      'linked-user',
    );
  });

  it('opens Scrum on week 6 ahead of local week/filter/view preferences and preserves it after refresh', async () => {
    localStorage.setItem('scheduler_selected_week_v1', '2');
    localStorage.setItem('scheduler_subject_filter_v1', '564966');
    savedPreferences({ defaultView: 'today', rememberSubjectFilter: true });
    open('#/week/6?user=ermolz&semester=SEM-2026-FALL&subject=565095');
    await ready();
    chosenWeek(6);
    expect(
      screen.getByRole('combobox', { name: 'Course filter' }).textContent,
    ).toContain('Scrum');
    expect(
      screen.queryByRole('heading', {
        name: 'Electronics and Digital Electronics',
      }),
    ).toBeNull();
    expect(
      screen.getAllByRole('heading', { name: 'Scrum Framework Fundamentals' })
        .length,
    ).toBeGreaterThan(0);
    const link = window.location.href;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await ready();
    chosenWeek(6);
    expect(window.location.href).toBe(link);
    expect(backend.calls.every((call) => call.method === 'GET')).toBe(true);
  });

  it('resolves #/week/5 to a complete current-semester link without a duplicate GET', async () => {
    open('#/week/5');
    await ready();
    chosenWeek(5);
    expect(route()).toMatchObject({
      week: 5,
      user: 'ermolz',
      semester: 'SEM-2026-FALL',
    });
    expect(
      backend.calls.filter((call) => call.action === 'schedule'),
    ).toHaveLength(1);
  });

  it('uses remembered week/filter only for a bare entry, and retains them offline', () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    });
    savedPreferences({
      rememberSubjectFilter: true,
      initialWeek: 'last-opened',
    });
    localStorage.setItem('scheduler_selected_week_v1', '9');
    localStorage.setItem('scheduler_subject_filter_v1', '565095');
    open('#/');
    chosenWeek(9);
    expect(route()).toMatchObject({ week: 9, subject: '565095' });
    expect(backend.calls).toEqual([]);
  });

  it('normalizes a bare entry with a stored semester without reloading it twice', async () => {
    localStorage.setItem('scheduler_selected_semester_v1', 'SEM-2026-FALL');
    open('#/');
    await ready();
    expect(route()?.semester).toBe('SEM-2026-FALL');
    expect(
      backend.calls.filter((call) => call.action === 'schedule'),
    ).toHaveLength(1);
  });

  it.each(['', 'SEM-2026-FALL'])(
    'respects disabled refresh-on-open when normalizing a bare entry (stored semester: %s)',
    async (semester) => {
      if (semester)
        localStorage.setItem('scheduler_selected_semester_v1', semester);
      savedPreferences({ refreshOnOpen: false, initialWeek: 'last-opened' });
      localStorage.setItem('scheduler_selected_week_v1', '9');
      open('#/');
      await waitFor(() => expect(route()?.week).toBe(9));
      chosenWeek(9);
      fireEvent.click(screen.getByRole('button', { name: 'Week 6' }));
      chosenWeek(6);
      expect(backend.calls).toEqual([]);
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
      await ready();
      expect(
        backend.calls.filter((call) => call.action === 'schedule'),
      ).toHaveLength(1);
    },
  );

  it('loads an explicit link even when the device disables refresh-on-open', async () => {
    savedPreferences({ refreshOnOpen: false });
    open('#/week/6?user=ermolz&semester=SEM-2026-FALL&subject=565095');
    await ready();
    chosenWeek(6);
    expect(
      backend.calls.filter((call) => call.action === 'schedule'),
    ).toHaveLength(1);
  });

  it('loads a linked user missing from local storage, without showing the default user’s lessons', async () => {
    await member();
    localStorage.setItem('scheduler_selected_user_v1', 'ermolz');
    open('#/week/6?user=linked-user&semester=SEM-2026-FALL&subject=565095');
    expect(
      screen.queryByRole('heading', {
        name: 'Electronics and Digital Electronics',
      }),
    ).toBeNull();
    await ready();
    chosenWeek(6);
    expect(
      screen.getByRole('combobox', { name: 'Schedule user' }).textContent,
    ).toContain('Linked User');
    expect(
      backend.calls
        .filter((call) => call.action === 'schedule')
        .map((call) => call.body.user),
    ).toEqual(['linked-user', 'ermolz']);
    expect(localStorage.getItem('scheduler_selected_user_v1')).toBe(
      'linked-user',
    );
    expect(screen.getAllByText('Group 2').length).toBeGreaterThan(0);
  });

  it('keeps an unavailable user link intact and never substitutes fallback lessons', async () => {
    const hash =
      '#/week/6?user=missing-user&semester=SEM-2026-FALL&subject=565095';
    open(hash);
    await screen.findByText(/Unknown or inactive user/);
    expect(window.location.hash).toBe(hash);
    expect(screen.getByText('Schedule unavailable')).toBeTruthy();
    expect(
      screen.queryByRole('heading', { name: 'Scrum Framework Fundamentals' }),
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    const action = await screen.findByRole('menuitem', {
      name: 'Copy schedule link',
    });
    expect(action.hasAttribute('data-disabled')).toBe(true);
  });

  it('does not overwrite an unknown semester link with the stored semester', async () => {
    localStorage.setItem('scheduler_selected_semester_v1', 'SEM-2026-FALL');
    const hash = '#/week/6?user=ermolz&semester=SEM-UNKNOWN';
    open(hash);
    await screen.findByText(/Unknown or inactive semester/);
    expect(window.location.hash).toBe(hash);
    expect(
      screen.getByRole('combobox', { name: 'Semester' }).textContent,
    ).toContain('SEM-UNKNOWN');
    expect(
      screen.queryByRole('heading', { name: 'Scrum Framework Fundamentals' }),
    ).toBeNull();
  });

  it('waits for a 16-week semester before validating week 16 against the fallback’s 14 weeks', async () => {
    await createSemester({
      token: backend.token,
      baseRevision: 1,
      semester: {
        id: 'SEM-LINK-SPRING',
        title: 'Linked Spring',
        startDate: '2027-02-01',
        weeksCount: 16,
      },
      copySubjects: true,
      sourceSemesterId: 'SEM-2026-FALL',
      makeCurrent: true,
    });
    let release: (() => void) | undefined;
    vi.stubGlobal(
      'fetch',
      async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const response = await backend.fetch(input, init);
        return new Promise<Response>((resolve) => {
          release = () => resolve(response);
        });
      },
    );
    const hash = '#/week/16?user=ermolz&semester=SEM-LINK-SPRING';
    open(hash);
    await waitFor(() => expect(release).toBeTypeOf('function'));
    expect(window.location.hash).toBe(hash);
    await act(async () => {
      release!();
    });
    await ready();
    chosenWeek(16);
    expect(
      screen.getByRole('combobox', { name: 'Semester' }).textContent,
    ).toContain('Linked Spring');
    expect(route()?.week).toBe(16);
  });

  it('normalizes an out-of-range week only after loading the target semester', async () => {
    open('#/week/999?user=ermolz&semester=SEM-2026-FALL');
    await ready();
    chosenWeek(14);
    expect(route()?.week).toBe(14);
    expect(screen.getByText(/Week 999 is outside this semester/)).toBeTruthy();
  });

  it('reports an unknown course without silently showing all courses, and lets the user clear it', async () => {
    open('#/week/6?user=ermolz&semester=SEM-2026-FALL&subject=UNKNOWN');
    await ready();
    expect(
      screen.getByText(/The linked course is not in this user/),
    ).toBeTruthy();
    expect(
      screen.queryByRole('heading', { name: 'Scrum Framework Fundamentals' }),
    ).toBeNull();
    expect(route()?.subject).toBe('UNKNOWN');
    fireEvent.click(screen.getByRole('button', { name: 'Show all courses' }));
    expect(route()?.subject).toBeUndefined();
    expect(
      screen.getAllByRole('heading', { name: 'Scrum Framework Fundamentals' })
        .length,
    ).toBeGreaterThan(0);
  });

  it('restores the exact week/filter/view with browser Back and Forward', async () => {
    open('#/week/5?user=ermolz&semester=SEM-2026-FALL&subject=565095');
    await ready();
    const start = window.location.href;
    fireEvent.click(screen.getByRole('button', { name: 'Week 6' }));
    const six = window.location.href;
    const views = within(
      screen.getByRole('navigation', { name: 'Schedule view' }),
    );
    fireEvent.click(views.getByRole('button', { name: 'Courses' }));
    expect(route()).toMatchObject({
      view: 'subjects',
      week: 6,
      subject: '565095',
    });
    expect(
      screen.getByRole('heading', {
        name: 'Scrum Framework Fundamentals',
        level: 1,
      }),
    ).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Lectures' })).toBeTruthy();
    act(() => window.history.back());
    await waitFor(() => expect(window.location.href).toBe(six));
    chosenWeek(6);
    expect(
      views.getByRole('button', { name: 'Week' }).getAttribute('aria-pressed'),
    ).toBe('true');
    act(() => window.history.back());
    await waitFor(() => expect(window.location.href).toBe(start));
    chosenWeek(5);
    act(() => window.history.forward());
    await waitFor(() => expect(window.location.href).toBe(six));
    chosenWeek(6);
    expect(
      backend.calls.filter((call) => call.action === 'schedule'),
    ).toHaveLength(1);
  });

  it('updates user/filter selectors in one URL history entry and restores the previous user', async () => {
    await member();
    open('#/week/6?user=ermolz&semester=SEM-2026-FALL&subject=565095');
    await ready();
    const start = window.location.href;
    const push = vi.spyOn(window.history, 'pushState');
    fireEvent.click(screen.getByRole('combobox', { name: 'Schedule user' }));
    await selectOption('Linked User');
    await ready();
    expect(route()).toMatchObject({ user: 'linked-user', week: 6 });
    expect(route()?.subject).toBeUndefined();
    expect(push).toHaveBeenCalledTimes(1);
    act(() => window.history.back());
    await waitFor(() => expect(window.location.href).toBe(start));
    await ready();
    expect(
      screen.getByRole('combobox', { name: 'Schedule user' }).textContent,
    ).toContain('Ermolz');
    expect(
      screen.getByRole('combobox', { name: 'Course filter' }).textContent,
    ).toContain('Scrum');
  });

  it('changes filters using stable external course codes, including after a reload', async () => {
    const page = open('#/week/6?user=ermolz&semester=SEM-2026-FALL');
    await ready();
    fireEvent.click(screen.getByRole('combobox', { name: 'Course filter' }));
    await selectOption('Scrum Fundamentals');
    expect(route()?.subject).toBe('565095');
    const href = window.location.href;
    page.unmount();
    render(<ScheduleApp />);
    await ready();
    expect(window.location.href).toBe(href);
    chosenWeek(6);
    expect(
      screen.getByRole('combobox', { name: 'Course filter' }).textContent,
    ).toContain('Scrum');
  });

  it('scrolls weekdays without replacing the state hash', async () => {
    open('#/week/6?user=ermolz&semester=SEM-2026-FALL&subject=565095');
    await ready();
    const href = window.location.href;
    fireEvent.click(
      within(screen.getByRole('navigation', { name: 'Weekdays' })).getByRole(
        'button',
        { name: /Thu/ },
      ),
    );
    expect(scroll).toHaveBeenCalled();
    expect(window.location.href).toBe(href);
  });

  it('Today selects the current week and moving to another week selects the weekly view', async () => {
    open('#/week/6?user=ermolz&semester=SEM-2026-FALL');
    await ready();
    const views = within(
      screen.getByRole('navigation', { name: 'Schedule view' }),
    );
    fireEvent.click(views.getByRole('button', { name: 'Today' }));
    expect(route()).toMatchObject({
      view: 'today',
      week: getSemesterWeek(fallbackSchedule.semester.startDate, 14),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Week 5' }));
    expect(route()).toMatchObject({ view: 'week', week: 5 });
  });

  it('copies only viewing state, not stored tokens or unrelated URL parameters', async () => {
    storeEditToken('ermolz', 'test-token-that-must-never-be-shared');
    open(
      '?editToken=ignored-secret#/week/6?user=ermolz&semester=SEM-2026-FALL&subject=565095&pin=1234',
    );
    await ready();
    await copyLink();
    await screen.findByText('Link copied');
    expect(copy).toHaveBeenCalledTimes(1);
    const copied = String(copy.mock.calls[0][0]);
    expect(parseScheduleLocation(copied)).toMatchObject({
      week: 6,
      subject: '565095',
      user: 'ermolz',
      semester: 'SEM-2026-FALL',
    });
    expect(copied).not.toMatch(/token|secret|pin|1234/i);
    expect(backend.calls.every((call) => call.method === 'GET')).toBe(true);
  });

  it.each(['denied', 'unavailable'] as const)(
    'provides selectable manual copy when clipboard is %s',
    async (reason) => {
      if (reason === 'denied')
        copy.mockRejectedValue(new Error('Permission denied'));
      else
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: undefined,
        });
      open('#/week/6?user=ermolz&semester=SEM-2026-FALL&subject=565095');
      await ready();
      await copyLink();
      const dialog = await screen.findByRole('dialog', {
        name: 'Copy schedule link',
      });
      const field = within(dialog).getByRole('textbox', {
        name: 'Schedule link',
      }) as HTMLInputElement;
      expect(field.readOnly).toBe(true);
      expect(parseScheduleLocation(field.value)).toMatchObject({
        week: 6,
        subject: '565095',
      });
      fireEvent.focus(field);
      expect(field.selectionEnd).toBe(field.value.length);
      fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    },
  );

  it('uses a cached deep link offline and resolves an uncached user on reconnection', async () => {
    await member();
    await fetchSchedule('ermolz', 'SEM-2026-FALL');
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    });
    const page = open(
      '#/week/6?user=ermolz&semester=SEM-2026-FALL&subject=565095',
    );
    chosenWeek(6);
    expect(screen.getByText(/Offline — data from/)).toBeTruthy();
    page.unmount();
    open('#/week/6?user=linked-user&semester=SEM-2026-FALL&subject=565095');
    expect(screen.getByText(/not cached on this device/)).toBeTruthy();
    expect(route()?.user).toBe('linked-user');
    act(() => {
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        value: true,
      });
      window.dispatchEvent(new Event('online'));
    });
    await ready();
    chosenWeek(6);
    expect(
      screen.getByRole('combobox', { name: 'Schedule user' }).textContent,
    ).toContain('Linked User');
  });

  it('ignores a late response from a previous user after hash navigation', async () => {
    await member();
    let release: (() => void) | undefined;
    let oldSignal: AbortSignal | null | undefined;
    vi.stubGlobal(
      'fetch',
      async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const response = await backend.fetch(input, init);
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (url.includes('user=ermolz') && !release) {
          oldSignal = init?.signal;
          return new Promise<Response>((resolve) => {
            release = () => resolve(response);
          });
        }
        return response;
      },
    );
    open('#/week/2?user=ermolz&semester=SEM-2026-FALL');
    await waitFor(() => expect(release).toBeTypeOf('function'));
    act(() =>
      navigateSchedule(
        window.location.origin +
          '/scheduler/#/week/6?user=linked-user&semester=SEM-2026-FALL&subject=565095',
      ),
    );
    await ready();
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => {
      release!();
    });
    chosenWeek(6);
    expect(route()?.user).toBe('linked-user');
    expect(
      screen.getByRole('combobox', { name: 'Schedule user' }).textContent,
    ).toContain('Linked User');
    expect(
      screen.queryByRole('heading', {
        name: 'Electronics and Digital Electronics',
      }),
    ).toBeNull();
  });

  it('supports links even when browser storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Blocked');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('Blocked');
    });
    open('#/week/6?user=ermolz&semester=SEM-2026-FALL&subject=565095');
    await ready();
    chosenWeek(6);
    await copyLink();
    await screen.findByText('Link copied');
    expect(copy).toHaveBeenCalledTimes(1);
  });

  it('keeps the deep link behind the PIN gate until access is granted', async () => {
    const hash = '#/week/6?user=ermolz&semester=SEM-2026-FALL&subject=565095';
    window.history.replaceState(null, '', '/scheduler/' + hash);
    const gate = render(
      <AccessGate>
        <AppRouter />
      </AccessGate>,
    );
    expect(
      screen.getByRole('heading', { name: 'Enter your PIN' }),
    ).toBeTruthy();
    expect(window.location.hash).toBe(hash);
    expect(backend.calls).toEqual([]);
    gate.unmount();
    // Simulate a completed unlock in this isolated browser fixture, not a real PIN.
    localStorage.setItem(ACCESS_KEY, 'granted');
    render(
      <AccessGate>
        <AppRouter />
      </AccessGate>,
    );
    await ready();
    chosenWeek(6);
    expect(route()?.subject).toBe('565095');
  });

  it('preserves settings routes and restores the schedule via browser Back', async () => {
    window.history.replaceState(
      null,
      '',
      '/scheduler/#/week/6?user=ermolz&semester=SEM-2026-FALL&subject=565095',
    );
    render(<AppRouter />);
    await ready();
    const href = window.location.href;
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Settings' }));
    await waitFor(() => expect(window.location.hash).toBe('#/settings'));
    await screen.findByRole('heading', { name: 'Settings', level: 1 });
    act(() => window.history.back());
    await waitFor(() => expect(window.location.href).toBe(href));
    await ready();
    chosenWeek(6);
    expect(route()?.subject).toBe('565095');
  });
});
