import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAdminUser,
  getAdminAuditLog,
  getAdminOverview,
  getAdminUser,
  rotateAdminUserToken,
  setAdminUserActive,
  updateAdminUser,
} from '@/lib/admin/repository';
import { postApi } from '@/lib/api/client';

vi.mock('@/lib/api/client', () => ({
  postApi: vi.fn().mockResolvedValue({ revision: 2 }),
}));
afterEach(() => vi.clearAllMocks());

describe('admin transport', () => {
  it('sends all seven actions as authenticated POST bodies, with immutable target IDs and base revisions', async () => {
    const token = 'private-test-credential';
    await getAdminOverview(token);
    await getAdminUser(token, 'U2', 'SEM-2');
    await getAdminAuditLog(token, {
      actorId: 'U2',
      search: 'name',
      offset: 25,
    });
    await createAdminUser(token, 4, {
      displayName: 'Test',
      slug: 'test',
      role: 'user',
    });
    await updateAdminUser(token, 5, 'U2', { role: 'editor' });
    await setAdminUserActive(token, 6, 'U2', true);
    await rotateAdminUserToken(token, 7, 'U2');
    const calls = vi.mocked(postApi).mock.calls;
    expect(calls.map(([body]) => body.action)).toEqual([
      'adminOverview',
      'adminUserDetails',
      'adminAuditLog',
      'adminCreateUser',
      'adminUpdateUser',
      'adminSetUserActive',
      'adminRotateUserToken',
    ]);
    for (const [body, signal] of calls) {
      expect(body.editToken).toBe(token);
      expect(signal).toBeInstanceOf(AbortSignal);
    }
    expect(calls[1][0]).toMatchObject({
      targetUserId: 'U2',
      semesterId: 'SEM-2',
    });
    expect(calls[5][0]).toMatchObject({ baseRevision: 6, rotateToken: true });
    expect(calls[6][0]).toMatchObject({ baseRevision: 7, targetUserId: 'U2' });
  });

  it('forwards caller cancellation and never retries failed writes', async () => {
    const controller = new AbortController();
    await getAdminOverview('test', controller.signal);
    expect(vi.mocked(postApi).mock.calls[0][1]).toBe(controller.signal);
    vi.mocked(postApi).mockRejectedValueOnce(new Error('Disconnected'));
    await expect(rotateAdminUserToken('test', 2, 'U2')).rejects.toThrow(
      'Disconnected',
    );
    expect(postApi).toHaveBeenCalledTimes(2);
  });
});
