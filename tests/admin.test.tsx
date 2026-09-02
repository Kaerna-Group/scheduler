// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserEnrollments } from '@/components/admin/user-enrollments';
import { AdminPage } from '@/components/admin/admin-page';
import { AdminLink } from '@/components/admin/admin-link';
import { useAdmin } from '@/hooks/use-admin';
import { ApiError } from '@/lib/api/client';
import {
  getAdminAuditLog,
  getAdminOverview,
  getAdminUser,
} from '@/lib/admin/repository';
import {
  auditSummary,
  enrollmentDraft,
  enrollmentPayload,
} from '@/lib/admin/presentation';
import type {
  AdminAuditEntry,
  AdminOverview,
  AdminUserDetails,
} from '@/lib/admin/types';
import { getStoredEditToken, storeEditToken } from '@/lib/schedule/repository';

vi.mock('@/hooks/use-preferences', async () => {
  const { defaultPreferences } = await import('@/lib/preferences/defaults');
  return { usePreferences: () => ({ preferences: defaultPreferences }) };
});
vi.mock('@/hooks/use-theme', () => ({ useTheme: vi.fn() }));

vi.mock('@/lib/admin/repository', () => ({
  getAdminOverview: vi.fn(),
  getAdminUser: vi.fn(),
  getAdminAuditLog: vi.fn(),
}));
vi.mock('@/lib/api/client', async (original) => ({
  ...(await original<typeof import('@/lib/api/client')>()),
  hasRemoteApi: () => true,
}));

const actor = {
  id: 'U1',
  slug: 'admin',
  displayName: 'Admin',
  role: 'admin' as const,
};
const overview: AdminOverview = {
  apiVersion: 1,
  actor,
  revision: 10,
  schema: { current: '2', expected: '2' },
  semester: {
    id: 'SEM-1',
    title: 'Fall',
    startDate: '2026-09-01',
    weeksCount: 14,
    archived: false,
    current: true,
  },
  semesters: [],
  statistics: {
    usersTotal: 2,
    usersActive: 2,
    subjects: 2,
    offerings: 2,
    groups: 1,
    lessons: 1,
    enrollments: 1,
    auditEntries: 1,
  },
  tables: [],
  diagnostics: [],
  users: [],
  recentAudit: [],
  auditOptions: { actions: [], entityTypes: [] },
};
const details: AdminUserDetails = {
  revision: 10,
  user: {
    id: 'U2',
    slug: 'member',
    displayName: 'Member',
    role: 'user',
    active: true,
    enrollmentCount: 1,
    preferencesRevision: 0,
  },
  semester: overview.semester!,
  catalog: [
    {
      offeringId: 'O1',
      externalCode: 'ONE',
      subject: {
        id: 'S1',
        name: 'Course one',
        shortName: 'One',
        color: '#ffffff',
      },
      availableGroups: [1, 2],
    },
    {
      offeringId: 'O2',
      externalCode: 'TWO',
      subject: {
        id: 'S2',
        name: 'Course two',
        shortName: 'Two',
        color: '#ffffff',
      },
      availableGroups: [],
    },
  ],
  enrollments: [{ offeringId: 'O1', externalCode: 'ONE', selectedGroup: 1 }],
  preferences: null,
  recentAudit: [],
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function apiFailure(code: string) {
  return new ApiError({
    ok: false,
    error: {
      code,
      message: 'Test failure',
      details: { expectedRevision: 11, receivedRevision: 10 },
    },
    revision: 11,
  });
}
function network(online: boolean) {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    value: online,
  });
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
}
function storedValues() {
  return Object.fromEntries(
    Array.from({ length: localStorage.length }, (_, index) => {
      const key = localStorage.key(index)!;
      return [key, localStorage.getItem(key)];
    }),
  );
}
beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  network(true);
  vi.mocked(getAdminOverview).mockResolvedValue(overview);
  vi.mocked(getAdminUser).mockResolvedValue(details);
  vi.mocked(getAdminAuditLog).mockResolvedValue({
    revision: 10,
    total: 0,
    limit: 25,
    offset: 0,
    entries: [],
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('admin session and safe mutations', () => {
  it('explains an outdated deployment without mistaking it for invalid credentials', async () => {
    vi.mocked(getAdminOverview).mockRejectedValueOnce(
      apiFailure('UNKNOWN_ACTION'),
    );
    const { result } = renderHook(useAdmin);
    await act(async () => {
      await result.current.authenticate('admin-token');
    });
    expect(result.current.overview).toBeNull();
    expect(result.current.error).toContain(
      'Publish the latest Apps Script bundle',
    );
    expect(result.current.backendAvailable).toBe(false);
  });

  it('marks failed backend checks as unavailable while retaining the last verified snapshot', async () => {
    const { result } = renderHook(useAdmin);
    await act(async () => {
      await result.current.authenticate('admin-token');
    });
    const verified = result.current.lastVerifiedAt;
    expect(result.current.backendAvailable).toBe(true);
    vi.mocked(getAdminOverview).mockRejectedValueOnce(
      apiFailure('INTERNAL_ERROR'),
    );
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.backendAvailable).toBe(false);
    expect(result.current.lastVerifiedAt).toBe(verified);
    expect(result.current.overview).toEqual(overview);
  });

  it('does not trust the selected admin profile; requires a successful server response', async () => {
    localStorage.setItem('scheduler_selected_user_v1', 'admin');
    const { result } = renderHook(useAdmin);
    expect(result.current.overview).toBeNull();
    expect(getAdminOverview).not.toHaveBeenCalled();
    vi.mocked(getAdminOverview).mockRejectedValueOnce(apiFailure('FORBIDDEN'));
    await act(async () => {
      await result.current.authenticate('user-token');
    });
    expect(result.current.overview).toBeNull();
    expect(result.current.error).toContain('FORBIDDEN');
    expect(result.current.verifiedToken).toBe('');
    await act(async () => {
      await result.current.authenticate('admin-token');
    });
    expect(result.current.overview?.actor.id).toBe('U1');
    expect(getStoredEditToken('admin')).toBe('');
    expect(localStorage.length).toBe(1); // Only the pre-existing selected-profile key.
  });

  it('remembers only an explicitly authorized own token and clears private state on logout', async () => {
    const { result } = renderHook(useAdmin);
    await act(async () => {
      await result.current.authenticate('admin-token', true);
    });
    expect(getStoredEditToken('admin')).toBe('admin-token');
    await act(async () => {
      await result.current.loadUser('U2');
      await result.current.loadAudit({});
    });
    expect(result.current.details?.user.id).toBe('U2');
    act(() => result.current.logout());
    expect(result.current.overview).toBeNull();
    expect(result.current.details).toBeNull();
    expect(result.current.audit).toBeNull();
    expect(result.current.verifiedToken).toBe('');
  });

  it('shows newly issued tokens only in memory, not in user caches or local storage', async () => {
    const { result } = renderHook(useAdmin);
    await act(async () => {
      await result.current.authenticate('admin-token');
    });
    const before = storedValues();
    await act(async () => {
      await result.current.mutate(async () => ({
        revision: 11,
        user: details.user,
        editToken: 'one-time-member-token',
      }));
    });
    expect(result.current.credential?.token).toBe('one-time-member-token');
    expect(storedValues()).toEqual(before);
    act(() => result.current.dismissCredential());
    expect(result.current.credential).toBeNull();
  });

  it('blocks duplicate writes and offline writes, without replay on reconnect', async () => {
    const { result } = renderHook(useAdmin);
    await act(async () => {
      await result.current.authenticate('admin-token');
    });
    const pending = deferred<{ revision: number }>();
    const write = vi.fn(() => pending.promise);
    let completion: Promise<unknown>;
    act(() => {
      completion = result.current.mutate(write);
    });
    await act(async () => {
      await result.current.mutate(write);
    });
    expect(write).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve({ revision: 11 });
      await completion;
    });
    act(() => network(false));
    expect(result.current.online).toBe(false);
    await act(async () => {
      await result.current.mutate(write);
    });
    expect(write).toHaveBeenCalledTimes(1);
    await act(async () => network(true));
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('keeps a stale draft and never retries a conflicting mutation', async () => {
    const { result } = renderHook(useAdmin);
    await act(async () => {
      await result.current.authenticate('admin-token');
      await result.current.loadUser('U2');
    });
    const write = vi.fn().mockRejectedValue(apiFailure('STALE_DATA'));
    await act(async () => {
      await result.current.mutate(write);
    });
    expect(write).toHaveBeenCalledTimes(1);
    expect(result.current.details?.revision).toBe(10);
    expect(result.current.error).toContain('Current revision: 11');
    expect(result.current.error).toContain('your revision: 10');
  });

  it.each([
    'FORBIDDEN',
    'UNAUTHORIZED',
    'API_VERSION_MISSING',
    'API_VERSION_MISMATCH',
    'INVALID_API_RESPONSE',
  ])(
    'clears all admin state when the server revokes access (%s)',
    async (code) => {
      const { result } = renderHook(useAdmin);
      await act(async () => {
        await result.current.authenticate('admin-token');
        await result.current.loadUser('U2');
      });
      vi.mocked(getAdminOverview).mockRejectedValueOnce(apiFailure(code));
      await act(async () => {
        await result.current.refresh();
      });
      expect(result.current.overview).toBeNull();
      expect(result.current.details).toBeNull();
      expect(result.current.verifiedToken).toBe('');
    },
  );

  it('invalidates old tokens during self-rotation, including late failures from pre-rotation reads', async () => {
    storeEditToken('admin', 'old-token');
    const { result } = renderHook(useAdmin);
    await act(async () => {
      await result.current.authenticate('old-token');
    });
    const pending = deferred<AdminUserDetails>();
    vi.mocked(getAdminUser).mockReturnValueOnce(pending.promise);
    let read: Promise<void>;
    act(() => {
      read = result.current.loadUser('U2');
    });
    await act(async () => {
      await result.current.mutate(async () => ({
        revision: 11,
        user: {
          ...actor,
          active: true,
          enrollmentCount: 0,
          preferencesRevision: 0,
        },
        editToken: 'new-token',
      }));
    });
    await act(async () => {
      pending.reject(apiFailure('UNAUTHORIZED'));
      await read;
    });
    expect(result.current.overview).not.toBeNull();
    expect(result.current.verifiedToken).toBe('new-token');
    expect(getStoredEditToken('admin')).toBe('new-token');
    expect(getAdminOverview).toHaveBeenLastCalledWith('new-token');
  });

  it('ends the session immediately after self-demotion', async () => {
    const { result } = renderHook(useAdmin);
    await act(async () => {
      await result.current.authenticate('admin-token');
    });
    await act(async () => {
      await result.current.mutate(async () => ({
        revision: 11,
        user: { ...actor, role: 'editor', active: true },
      }));
    });
    expect(result.current.overview).toBeNull();
    expect(result.current.verifiedToken).toBe('');
    expect(result.current.error).toContain('no longer');
  });

  it('discards late responses from logged-out sessions and out-of-order user reads', async () => {
    const { result } = renderHook(useAdmin);
    const login = deferred<AdminOverview>();
    vi.mocked(getAdminOverview).mockReturnValueOnce(login.promise);
    let authentication: Promise<void>;
    act(() => {
      authentication = result.current.authenticate('token');
    });
    act(() => result.current.logout());
    await act(async () => {
      login.resolve(overview);
      await authentication;
    });
    expect(result.current.overview).toBeNull();
    await act(async () => {
      await result.current.authenticate('token');
    });
    const oldRead = deferred<AdminUserDetails>();
    vi.mocked(getAdminUser).mockReturnValueOnce(oldRead.promise);
    let reading: Promise<void>;
    act(() => {
      reading = result.current.loadUser('old-user');
    });
    await act(async () => {
      await result.current.loadUser('U2');
    });
    await act(async () => {
      oldRead.resolve({
        ...details,
        user: { ...details.user, id: 'old-user' },
      });
      await reading;
    });
    expect(result.current.details?.user.id).toBe('U2');
  });
});

describe('admin interface', () => {
  it('gates the complete page on token verification, then exposes all four sections', async () => {
    render(<AdminPage />);
    expect(
      screen.getByRole('heading', { name: 'Verify admin access' }),
    ).toBeTruthy();
    expect(
      screen.queryByRole('navigation', { name: 'Admin sections' }),
    ).toBeNull();
    fireEvent.change(screen.getByLabelText('Admin edit token'), {
      target: { value: 'fixture-admin-token' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify token' }));
    await waitFor(() =>
      expect(
        screen.getByRole('navigation', { name: 'Admin sections' }),
      ).toBeTruthy(),
    );
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Users' }));
    expect(screen.getByRole('button', { name: 'Create user' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Audit' }));
    await waitFor(() => expect(getAdminAuditLog).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'System' }));
    expect(
      screen.getByRole('heading', { name: 'Health and schema' }),
    ).toBeTruthy();
    expect(screen.getByText('Available at last check')).toBeTruthy();
    expect(screen.getByText('v1 · site supports v1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'End session' }));
    expect(
      screen.queryByRole('navigation', { name: 'Admin sections' }),
    ).toBeNull();
  });
  it('hides the entry link unless both selected admin role and saved token are present', () => {
    const { rerender } = render(<AdminLink user={actor} />);
    expect(screen.queryByRole('link')).toBeNull();
    storeEditToken('admin', 'token');
    rerender(<AdminLink user={actor} />);
    expect(screen.getByRole('link').getAttribute('href')).toBe('#/admin');
    rerender(<AdminLink user={{ ...actor, role: 'editor' }} />);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('edits the full catalog with per-course group selection and explicit save confirmation', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<UserEnrollments details={details} enabled save={save} />);
    fireEvent.click(screen.getByLabelText(/Course two/));
    fireEvent.change(screen.getByLabelText('Group for Course one'), {
      target: { value: '2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Review and save' }));
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm enrollments' }),
    );
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith([
        { externalCode: 'ONE', selectedGroup: 2 },
        { externalCode: 'TWO', selectedGroup: undefined },
      ]),
    );
  });

  it.each(['inactive', 'archive', 'offline'])(
    'makes enrollments read-only for %s',
    (reason) => {
      const data = {
        ...details,
        user: { ...details.user, active: reason !== 'inactive' },
        semester: { ...details.semester, archived: reason === 'archive' },
      };
      const { container } = render(
        <UserEnrollments
          details={data}
          enabled={reason !== 'offline'}
          save={vi.fn()}
        />,
      );
      expect(container.querySelector('fieldset')?.disabled).toBe(true);
      expect(
        screen.queryByRole('button', { name: 'Review and save' }),
      ).toBeNull();
    },
  );

  it('creates independent enrollment drafts and summarizes field changes', () => {
    const draft = enrollmentDraft(details);
    delete draft.ONE;
    expect(details.enrollments).toHaveLength(1);
    expect(enrollmentPayload(draft)).toEqual([]);
    const entry: AdminAuditEntry = {
      id: '1',
      actorId: 'U1',
      actorName: 'Admin',
      timestamp: '',
      revision: 1,
      action: 'UPDATE',
      entityType: 'User',
      entityId: 'U2',
      label: 'Alice',
      oldValue: { display_name: 'Old', role: 'user' },
      newValue: { display_name: 'Alice', role: 'editor' },
    };
    expect(auditSummary(entry)).toContain('Name: Old → Alice');
    expect(auditSummary(entry)).toContain('Role: user → editor');
  });
});
