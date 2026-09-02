// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TokenDialog, UserDialogForm } from '@/components/admin/user-dialogs';
import type { AdminUser } from '@/lib/admin/types';

const admin: AdminUser = {
  id: 'U1',
  slug: 'admin',
  displayName: 'Admin',
  role: 'admin',
  active: true,
  enrollmentCount: 2,
  preferencesRevision: 1,
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe('admin confirmation dialogs', () => {
  it('protects the last admin and explains self-demotion', () => {
    render(
      <UserDialogForm
        action={{ kind: 'edit', revision: 5, user: admin }}
        actorId="U1"
        lastAdmin
        disabled={false}
        busy={false}
        error=""
        close={vi.fn()}
        submit={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Role'), {
      target: { value: 'editor' },
    });
    expect(screen.getByText(/You will lose admin access/)).toBeTruthy();
    expect(screen.getByText(/last active admin cannot/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/I understand/));
    expect(
      (screen.getByRole('button', { name: 'Edit user' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('requires confirmation before token rotation and keeps errors visible inside the dialog', async () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    render(
      <UserDialogForm
        action={{ kind: 'rotate', revision: 5, user: admin }}
        actorId="U1"
        lastAdmin
        disabled={false}
        busy={false}
        error="STALE_DATA: refresh"
        close={vi.fn()}
        submit={submit}
      />,
    );
    expect(
      (
        screen.getByRole('button', {
          name: 'Rotate edit token',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('STALE_DATA');
    fireEvent.click(screen.getByLabelText(/I understand/));
    fireEvent.click(screen.getByRole('button', { name: 'Rotate edit token' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  });

  it('defaults reactivation to a new token and still permits cancellation offline', () => {
    const close = vi.fn();
    render(
      <UserDialogForm
        action={{
          kind: 'active',
          revision: 5,
          user: { ...admin, active: false },
        }}
        actorId="U2"
        lastAdmin={false}
        disabled
        busy={false}
        error=""
        close={close}
        submit={vi.fn()}
      />,
    );
    expect(
      (screen.getByLabelText(/Generate a new token/) as HTMLInputElement)
        .checked,
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('copies a one-time token only on explicit click and requires acknowledgement', async () => {
    const copy = vi.fn().mockResolvedValue(undefined);
    const dismiss = vi.fn();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: copy },
    });
    render(
      <TokenDialog
        credential={{ displayName: 'Test', token: 'one-time-fixture-token' }}
        dismiss={dismiss}
      />,
    );
    expect(copy).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    fireEvent.keyDown(screen.getByRole('dialog'), {
      key: 'Escape',
      code: 'Escape',
    });
    expect(dismiss).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Copy token' }));
    await waitFor(() =>
      expect(copy).toHaveBeenCalledWith('one-time-fixture-token'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'I saved the token' }));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });
});
