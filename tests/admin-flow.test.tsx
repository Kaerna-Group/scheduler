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
import { AdminPage } from '@/components/admin/admin-page';
import { createTestBackend } from './support/apps-script-backend';

vi.hoisted(() => {
  vi.stubEnv('VITE_SCHEDULE_API_URL', 'https://scheduler.test/exec');
});
vi.mock('@/hooks/use-theme', () => ({ useTheme: vi.fn() }));
vi.mock('@/hooks/use-preferences', async () => {
  const { defaultPreferences } = await import('@/lib/preferences/defaults');
  return { usePreferences: () => ({ preferences: defaultPreferences }) };
});
let backend: ReturnType<typeof createTestBackend>;
beforeEach(() => {
  localStorage.clear();
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
async function login() {
  render(<AdminPage />);
  fireEvent.change(screen.getByLabelText('Admin edit token'), {
    target: { value: backend.token },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Verify token' }));
  await screen.findByRole('heading', { name: 'Overview' });
}
async function saveToken() {
  const button = await screen.findByRole('button', {
    name: 'I saved the token',
  });
  const dialog = screen.getByRole('dialog', { name: /Save .*token/ });
  const token = dialog.querySelector('code')!.textContent!;
  fireEvent.click(button);
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: /Save .*token/ })).toBeNull(),
  );
  return token;
}
async function confirmUserOperation(button: string) {
  fireEvent.click(screen.getByRole('button', { name: button }));
  const dialog = screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByLabelText(/I understand and confirm/));
  fireEvent.click(
    within(dialog).getByRole('button', {
      name: /^(Deactivate user|Reactivate user|Rotate edit token)$/,
    }),
  );
}

describe('full admin UI → repository → actual Apps Script', () => {
  it('creates, enrolls, edits roles, rotates, deactivates/reactivates and audits a user', async () => {
    const originalLessons = backend.snapshot().Lessons;
    await login();
    fireEvent.click(screen.getByRole('button', { name: 'Users' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create user' }));
    fireEvent.change(screen.getByLabelText('Display name'), {
      target: { value: 'QA Member' },
    });
    fireEvent.change(screen.getByLabelText('Slug (immutable)'), {
      target: { value: 'qa-member' },
    });
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Create user',
      }),
    );
    const firstToken = await saveToken();
    await screen.findByRole('heading', { name: 'QA Member' });
    const userId = backend
      .snapshot()
      .Users.find((user) => user.slug === 'qa-member')!.user_id;
    expect(
      backend.snapshot().UserPreferences.some((row) => row.user_id === userId),
    ).toBe(true);
    expect(JSON.stringify(localStorage)).not.toContain(firstToken);

    fireEvent.click(screen.getByLabelText(/Scrum Framework Fundamentals/));
    fireEvent.change(
      screen.getByLabelText('Group for Scrum Framework Fundamentals'),
      { target: { value: '2' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Review and save' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm enrollments' }),
    );
    await screen.findByText('Enrollments saved.');
    await screen.findByRole('button', { name: 'Edit name / role' });
    expect(
      backend
        .snapshot()
        .Enrollments.filter(
          (row) => row.user_id === userId && row.active === 'yes',
        ),
    ).toHaveLength(1);
    expect(backend.snapshot().Lessons).toEqual(originalLessons);

    fireEvent.click(screen.getByRole('button', { name: 'Edit name / role' }));
    fireEvent.change(screen.getByLabelText('Role'), {
      target: { value: 'editor' },
    });
    fireEvent.click(screen.getByLabelText(/I understand and confirm/));
    fireEvent.click(screen.getByRole('button', { name: 'Edit user' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await screen.findByRole('button', { name: 'Rotate token' });
    expect(
      backend.snapshot().Users.find((user) => user.user_id === userId)!.role,
    ).toBe('editor');

    await confirmUserOperation('Rotate token');
    const secondToken = await saveToken();
    expect(secondToken).not.toBe(firstToken);
    expect(
      backend.post({ action: 'adminOverview', editToken: firstToken }),
    ).toMatchObject({ ok: false, error: { code: 'UNAUTHORIZED' } });
    await screen.findByRole('button', { name: 'Deactivate' });
    await confirmUserOperation('Deactivate');
    await screen.findByRole('button', { name: 'Reactivate' });
    expect(
      backend.post({ action: 'adminOverview', editToken: secondToken }),
    ).toMatchObject({ ok: false, error: { code: 'UNAUTHORIZED' } });
    expect(
      backend.snapshot().Enrollments.some((row) => row.user_id === userId),
    ).toBe(true);
    await confirmUserOperation('Reactivate');
    const thirdToken = await saveToken();
    expect(thirdToken).not.toBe(secondToken);
    await screen.findByRole('button', { name: 'Deactivate' });

    fireEvent.click(screen.getByRole('button', { name: 'Audit' }));
    await screen.findByRole('heading', { name: 'Audit log' });
    fireEvent.change(screen.getByLabelText('Search'), {
      target: { value: 'QA Member' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Apply filters / refresh' }),
    );
    await waitFor(() =>
      expect(backend.calls.at(-1)?.body).toMatchObject({
        action: 'adminAuditLog',
        filters: { search: 'QA Member' },
      }),
    );
    await screen.findByText(/Created User: QA Member/);
    const audit = backend.snapshot().AuditLog;
    expect(
      audit.some(
        (row) => row.action === 'ROTATE_TOKEN' && row.entity_id === userId,
      ),
    ).toBe(true);
    expect(JSON.stringify(audit)).not.toMatch(/edit_token_hash/);
    expect(JSON.stringify(audit)).not.toContain(thirdToken);
    expect(
      backend.calls
        .filter((call) => String(call.action).startsWith('admin'))
        .every((call) => call.method === 'POST'),
    ).toBe(true);
  });

  it('creates a semester with copied subjects, changes current, and archives without copying lessons', async () => {
    const originalLessons = backend.snapshot().Lessons;
    await login();
    fireEvent.click(screen.getByRole('button', { name: 'System' }));
    fireEvent.change(screen.getByLabelText('ID'), {
      target: { value: 'SEM-TEST-SPRING' },
    });
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'QA Spring' },
    });
    fireEvent.change(screen.getByLabelText('Start date'), {
      target: { value: '2027-02-01' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create semester' }));
    await screen.findByText(/Semester created. Copied courses: 8/);
    let data = backend.snapshot();
    expect(data.Subjects).toHaveLength(16);
    expect(data.Lessons).toEqual(originalLessons);
    expect(data.Enrollments).toHaveLength(8);
    expect(
      data.Meta.find((row) => row.key === 'current_semester_id')!.value,
    ).toBe('SEM-TEST-SPRING');
    fireEvent.click(screen.getByRole('button', { name: 'Make current' }));
    await screen.findByText('Current semester changed.');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await screen.findByText('Semester archived.');
    data = backend.snapshot();
    expect(
      data.Semesters.find((row) => row.semester_id === 'SEM-TEST-SPRING')!
        .active,
    ).toBe('no');
    expect(
      data.Meta.find((row) => row.key === 'current_semester_id')!.value,
    ).toBe('SEM-2026-FALL');
    expect(data.AuditLog.some((row) => row.action === 'ARCHIVE')).toBe(true);
  });
});
