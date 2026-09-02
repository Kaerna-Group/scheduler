// @vitest-environment jsdom
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
import { createSemester } from '@/lib/semesters/repository';
import { fetchSchedule, updateEnrollments } from '@/lib/schedule/repository';
import { createTestBackend } from './support/apps-script-backend';

vi.hoisted(() =>
  vi.stubEnv('VITE_SCHEDULE_API_URL', 'https://scheduler.test/exec'),
);
vi.mock('@/hooks/use-theme', () => ({ useTheme: vi.fn() }));
let backend: ReturnType<typeof createTestBackend>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-23T11:03:00+03:00'));
  localStorage.clear();
  window.history.replaceState(null, '', '/scheduler/');
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    value: true,
  });
  backend = createTestBackend();
  vi.stubGlobal('fetch', vi.fn(backend.fetch));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function url(user = 'ermolz', semester = 'SEM-2026-FALL') {
  return `/scheduler/#/week/6?user=${user}&semester=${semester}&subject=565095`;
}
function open(user?: string, semester?: string) {
  window.history.replaceState(null, '', url(user, semester));
  return render(<ScheduleApp />);
}
const banner = () =>
  within(screen.getByRole('region', { name: 'Найближча пара' }));
async function ready() {
  await screen.findByText(/Up to date · revision/);
  await waitFor(() =>
    expect(banner().queryByText('Оновлюємо розклад…')).toBeNull(),
  );
}
async function addMember() {
  const result = await createAdminUser(backend.token, 1, {
    displayName: 'Next Member',
    slug: 'next-member',
    role: 'user',
  });
  await updateEnrollments({
    userSlug: result.user.slug,
    token: backend.token,
    semesterId: 'SEM-2026-FALL',
    baseRevision: result.revision,
    enrollments: [{ externalCode: '565095', selectedGroup: 2 }],
  });
}

describe('next lesson through the real schedule/backend flow', () => {
  it('uses today and the full personal DTO, not the linked week or course filter, without extra network polling', async () => {
    open();
    await ready();
    expect(banner().getByText('Electronics')).toBeTruthy();
    expect(banner().getByText('11:40')).toBeTruthy();
    expect(banner().getByText('1-001')).toBeTruthy();
    expect(banner().getByText('· через 37 хв')).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: 'Week 6' })
        .getAttribute('aria-current'),
    ).toBe('true');
    expect(window.location.hash).toContain('subject=565095');
    const calls = backend.calls.length;
    vi.setSystemTime(new Date('2026-09-23T11:04:00+03:00'));
    fireEvent.focus(window);
    expect(banner().getByText('· через 36 хв')).toBeTruthy();
    expect(backend.calls).toHaveLength(calls);
    const views = within(
      screen.getByRole('navigation', { name: 'Schedule view' }),
    );
    fireEvent.click(views.getByRole('button', { name: 'Courses' }));
    expect(banner().getByText('Electronics')).toBeTruthy();
    expect(banner().getByText('· через 36 хв')).toBeTruthy();
  });

  it('changes with the selected user and respects real personal enrollments/groups', async () => {
    await addMember();
    vi.setSystemTime(new Date('2026-09-24T11:03:00+03:00'));
    open();
    await ready();
    expect(banner().getAllByText('15:00')).toHaveLength(2);
    act(() => navigateSchedule(window.location.origin + url('next-member')));
    expect(banner().queryByText('15:00')).toBeNull();
    await ready();
    expect(banner().getByText('Зараз:')).toBeTruthy();
    expect(banner().getByText('10:00–11:20')).toBeTruthy();
    expect(banner().getByText('13:30')).toBeTruthy();
    expect(banner().queryByText('11:40')).toBeNull();
    expect(banner().queryByText('15:00')).toBeNull();
  });

  it('continues from the selected cached schedule offline', async () => {
    await fetchSchedule('ermolz', 'SEM-2026-FALL');
    backend.calls.length = 0;
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    });
    open();
    expect(banner().getByText('· Офлайн · збережені дані')).toBeTruthy();
    expect(banner().getByText('Electronics')).toBeTruthy();
    expect(banner().getByText('· через 37 хв')).toBeTruthy();
    expect(backend.calls).toEqual([]);
  });

  it('does not invent a class or a finished day for an unknown user', async () => {
    open('missing-user');
    expect(banner().queryByText('Electronics')).toBeNull();
    await screen.findByText(/Unknown or inactive user/);
    expect(banner().getByText('Розклад недоступний')).toBeTruthy();
    expect(banner().queryByText('На сьогодні все')).toBeNull();
  });

  it('switches to the selected future semester without leaking today’s fall lessons', async () => {
    await createSemester({
      token: backend.token,
      baseRevision: 1,
      semester: {
        id: 'SEM-NEXT-SPRING',
        title: 'Spring',
        startDate: '2027-02-01',
        weeksCount: 16,
      },
      copySubjects: true,
      sourceSemesterId: 'SEM-2026-FALL',
      makeCurrent: false,
    });
    open();
    await ready();
    expect(banner().getByText('Electronics')).toBeTruthy();
    act(() =>
      navigateSchedule(
        window.location.origin + url('ermolz', 'SEM-NEXT-SPRING'),
      ),
    );
    expect(banner().queryByText('Electronics')).toBeNull();
    await ready();
    expect(banner().getByText('Семестр ще не розпочався')).toBeTruthy();
    expect(banner().queryByText('Наступна:')).toBeNull();
  });
});
