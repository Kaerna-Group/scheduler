// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScheduleActionsMenu } from '@/components/schedule/schedule-actions-menu';
import { ScheduleApp } from '@/components/schedule/schedule-app';
import { fallbackSchedule } from '@/data/fallback-schedule';
import { getSemesterWeek } from '@/lib/schedule/utils';
import { storeEditToken } from '@/lib/schedule/repository';
import type { ScheduleUser } from '@/lib/schedule/types';

vi.mock('@/hooks/use-theme', () => ({ useTheme: vi.fn() }));
vi.mock('@/hooks/use-preferences', async () => {
  const { defaultPreferences } = await import('@/lib/preferences/defaults');
  return {
    usePreferences: () => ({
      preferences: defaultPreferences,
      hasPendingChanges: false,
    }),
  };
});
vi.mock('@/hooks/use-schedule', async () => {
  const { fallbackSchedule: schedule } =
    await import('@/data/fallback-schedule');
  return {
    useSchedule: () => ({
      schedule,
      selectedUser: schedule.user.slug,
      selectUser: vi.fn(),
      selectedSemesterId: schedule.semester.id,
      selectSemester: vi.fn(),
      source: 'fallback',
      selectionReady: true,
      loading: false,
      error: '',
      refresh: vi.fn(),
      remoteConfigured: false,
      lastSync: null,
      online: true,
    }),
  };
});

const admin: ScheduleUser = {
  id: 'A1',
  slug: 'admin',
  displayName: 'Administrator',
  role: 'admin',
};

beforeEach(() => {
  localStorage.clear();
  window.location.hash = '';
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
  return screen.findByRole('menu');
}

describe('compact schedule navigation', () => {
  it('hides secondary links behind one accessible menu, preserving their destinations', async () => {
    const { container } = render(<ScheduleApp />);
    const header = within(container.querySelector('header')!);
    expect(header.getByRole('combobox', { name: 'Semester' })).toBeTruthy();
    expect(
      header.getByRole('combobox', { name: 'Schedule user' }),
    ).toBeTruthy();
    expect(header.queryAllByRole('link')).toHaveLength(0);
    expect(header.queryByRole('button', { name: 'Go to today' })).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();

    const menu = within(await openMenu());
    expect(menu.getAllByRole('menuitem')).toHaveLength(5);
    expect(
      menu
        .getByRole('menuitem', { name: 'Import schedule' })
        .getAttribute('href'),
    ).toBe('#/import');
    expect(
      menu.getByRole('menuitem', { name: 'Changes' }).getAttribute('href'),
    ).toBe('#/changes');
    expect(
      menu.getByRole('menuitem', { name: 'Settings' }).getAttribute('href'),
    ).toBe('#/settings');
  });

  it.each([
    { role: 'admin' as const, token: true, visible: true },
    { role: 'admin' as const, token: false, visible: false },
    { role: 'editor' as const, token: true, visible: false },
    { role: 'user' as const, token: true, visible: false },
  ])(
    'preserves admin shortcut visibility: $role, token=$token',
    async ({ role, token, visible }) => {
      if (token) storeEditToken(admin.slug, 'local-ui-test-token');
      render(<ScheduleActionsMenu user={{ ...admin, role }} />);
      const menu = within(await openMenu());
      const link = menu.queryByRole('menuitem', { name: 'Admin panel' });
      expect(Boolean(link)).toBe(visible);
      if (visible) expect(link?.getAttribute('href')).toBe('#/admin');
    },
  );

  it('opens with the keyboard and restores focus when Escape closes the menu', async () => {
    render(<ScheduleActionsMenu />);
    const trigger = screen.getByRole('button', { name: 'More actions' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown', code: 'ArrowDown' });
    const menu = await screen.findByRole('menu');
    fireEvent.keyDown(menu, { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('follows a menu link and closes the popup', async () => {
    render(<ScheduleActionsMenu />);
    const menu = within(await openMenu());
    fireEvent.click(menu.getByRole('menuitem', { name: 'Settings' }));
    await waitFor(() => expect(window.location.hash).toBe('#/settings'));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('uses Today to reset the week and keeps mobile navigation to three views', () => {
    render(<ScheduleApp />);
    const current = getSemesterWeek(
      fallbackSchedule.semester.startDate,
      fallbackSchedule.semester.weeksCount,
    );
    const other = current === 2 ? 3 : 2;
    fireEvent.click(screen.getByRole('button', { name: `Week ${other}` }));
    expect(
      screen
        .getByRole('button', { name: `Week ${other}` })
        .getAttribute('aria-current'),
    ).toBe('true');
    const desktop = within(
      screen.getByRole('navigation', { name: 'Schedule view' }),
    );
    fireEvent.click(desktop.getByRole('button', { name: 'Today' }));
    expect(
      screen
        .getByRole('button', { name: `Week ${current}` })
        .getAttribute('aria-current'),
    ).toBe('true');
    expect(
      desktop
        .getByRole('button', { name: 'Today' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    const mobile = within(
      screen.getByRole('navigation', { name: 'Main navigation' }),
    );
    expect(mobile.getAllByRole('button')).toHaveLength(3);
    expect(mobile.queryAllByRole('link')).toHaveLength(0);
  });
});
