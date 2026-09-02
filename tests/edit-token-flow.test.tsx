// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImportGuidePage } from '@/components/schedule/import-guide-page';
import { SettingsPage } from '@/components/settings/settings-page';
import { AdminPage } from '@/components/admin/admin-page';
import {
  getEditTokenStorage,
  getStoredEditToken,
  storeEditToken,
} from '@/lib/auth/edit-tokens';
import { createTestBackend } from './support/apps-script-backend';
import { createAdminUser } from '@/lib/admin/repository';

vi.hoisted(() =>
  vi.stubEnv('VITE_SCHEDULE_API_URL', 'https://scheduler.test/exec'),
);
vi.mock('@/hooks/use-theme', () => ({ useTheme: () => ({ themeId: 'test' }) }));
vi.mock('@/hooks/use-preferences', async () => {
  const { defaultPreferences } = await import('@/lib/preferences/defaults');
  return {
    usePreferences: () => ({
      preferences: defaultPreferences,
      setPreferences: vi.fn(),
      resetPreferences: vi.fn(),
      preferencesRevision: 0,
      syncStatus: 'local',
      syncError: '',
      hasPendingChanges: false,
    }),
  };
});
let backend: ReturnType<typeof createTestBackend>;
const tokenKey = 'scheduler_edit_token_v2:ermolz';
const remember = () =>
  screen.getByRole('checkbox', {
    name: 'Remember this edit token on this device',
  }) as HTMLInputElement;
const field = () =>
  screen.getByLabelText('Personal edit token') as HTMLInputElement;
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('scheduler_selected_user_v1', 'ermolz');
  backend = createTestBackend();
  vi.stubGlobal('fetch', vi.fn(backend.fetch));
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    value: true,
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function openImport() {
  const page = render(<ImportGuidePage />);
  await waitFor(() =>
    expect(
      (
        screen.getByRole('button', {
          name: 'Refresh data before import',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  return page;
}

describe('edit token controls across pages', () => {
  it('defaults to a tab-only token, shares it with Settings and Import, and exposes its actual lifetime', async () => {
    const page = await openImport();
    expect(remember().checked).toBe(false);
    fireEvent.change(field(), { target: { value: backend.token } });
    expect(localStorage.getItem(tokenKey)).toBeNull();
    expect(sessionStorage.getItem(tokenKey)).toBe(backend.token);
    page.unmount();
    const settings = render(<SettingsPage />);
    await screen.findByText('Until this tab closes');
    expect(remember().checked).toBe(false);
    fireEvent.click(remember());
    expect(localStorage.getItem(tokenKey)).toBe(backend.token);
    expect(sessionStorage.getItem(tokenKey)).toBeNull();
    expect(screen.getByText('Saved on device')).toBeTruthy();
    fireEvent.click(remember());
    expect(screen.getByText('Until this tab closes')).toBeTruthy();
    expect(localStorage.getItem(tokenKey)).toBeNull();
    settings.unmount();
    await openImport();
    expect(field().value).toBe(backend.token);
    expect(remember().checked).toBe(false);
    expect(
      backend.calls.every((call) =>
        ['schedule', 'health'].includes(String(call.action)),
      ),
    ).toBe(true);
  });

  it('supports opting in before typing and removes the persistent copy as soon as consent is withdrawn', async () => {
    await openImport();
    fireEvent.click(remember());
    fireEvent.change(field(), { target: { value: backend.token } });
    expect(remember().checked).toBe(true);
    expect(localStorage.getItem(tokenKey)).toBe(backend.token);
    fireEvent.click(remember());
    expect(localStorage.getItem(tokenKey)).toBeNull();
    expect(field().value).toBe(backend.token);
    expect(getEditTokenStorage('ermolz')).toBe('session');
    fireEvent.change(field(), { target: { value: '' } });
    expect(getStoredEditToken('ermolz')).toBe('');
    expect(sessionStorage.getItem(tokenKey)).toBeNull();
  });

  it('does not leak a token or its remember choice into a different user profile', async () => {
    await createAdminUser(
      backend.token,
      (backend.buildSchedule('ermolz') as { revision: number }).revision,
      { displayName: 'Other User', slug: 'other-user', role: 'user' },
    );
    await openImport();
    fireEvent.click(remember());
    fireEvent.change(field(), { target: { value: backend.token } });
    fireEvent.click(screen.getByRole('combobox', { name: 'Import user' }));
    const otherUser = backend
      .snapshot()
      .Users.find((row) => row.slug !== 'ermolz')!;
    const option = await screen.findByRole('option', {
      name: String(otherUser.display_name),
    });
    fireEvent.pointerDown(option, { pointerType: 'mouse' });
    fireEvent.click(option);
    await waitFor(() =>
      expect(screen.getByText('User: ' + otherUser.display_name)).toBeTruthy(),
    );
    expect(field().value).toBe('');
    expect(remember().checked).toBe(false);
    expect(localStorage.getItem(tokenKey)).toBe(backend.token);
  });

  it('removes temporary and persistent credentials using the Settings confirmation', async () => {
    storeEditToken('ermolz', backend.token);
    storeEditToken('other', 'remembered-other', true);
    render(<SettingsPage />);
    await screen.findByText('Until this tab closes');
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(getStoredEditToken('ermolz')).toBe('');
    expect(getStoredEditToken('other')).toBe('');
    expect(screen.getByText('Not saved')).toBeTruthy();
  });

  it('shares a verified non-remembered admin token with import and removes its shortcut when forgotten', async () => {
    const page = render(<AdminPage />);
    expect(
      (
        screen.getByRole('checkbox', {
          name: 'Remember my own token on this device',
        }) as HTMLInputElement
      ).checked,
    ).toBe(false);
    fireEvent.change(screen.getByLabelText('Admin edit token'), {
      target: { value: backend.token },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify token' }));
    await screen.findByRole('heading', { name: 'Overview' });
    expect(getEditTokenStorage('ermolz')).toBe('session');
    expect(localStorage.getItem(tokenKey)).toBeNull();
    page.unmount();
    await openImport();
    expect(field().value).toBe(backend.token);
    expect(remember().checked).toBe(false);
    act(() => storeEditToken('ermolz', ''));
    expect(field().value).toBe('');
    expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull();
  });
});
