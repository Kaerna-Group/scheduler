import { postApi } from '@/lib/api/client';
import type { UserRole } from '@/lib/schedule/types';
import type {
  AdminAuditFilters,
  AdminAuditResponse,
  AdminMutationResponse,
  AdminOverview,
  AdminUserDetails,
  AdminUserPatch,
} from './types';

// Admin responses and generated credentials are never persisted or queued offline.
function request<T>(
  token: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
) {
  return postApi<T>(
    { ...body, editToken: token },
    signal ?? AbortSignal.timeout(45000),
  );
}

export const getAdminOverview = (token: string, signal?: AbortSignal) =>
  request<AdminOverview>(token, { action: 'adminOverview' }, signal);
export const getAdminUser = (
  token: string,
  targetUserId: string,
  semesterId?: string,
  signal?: AbortSignal,
) =>
  request<AdminUserDetails>(
    token,
    { action: 'adminUserDetails', targetUserId, semesterId },
    signal,
  );
export const getAdminAuditLog = (
  token: string,
  filters: AdminAuditFilters,
  signal?: AbortSignal,
) =>
  request<AdminAuditResponse>(
    token,
    { action: 'adminAuditLog', filters },
    signal,
  );
export const createAdminUser = (
  token: string,
  baseRevision: number,
  input: { displayName: string; slug: string; role: UserRole },
) =>
  request<AdminMutationResponse>(token, {
    action: 'adminCreateUser',
    baseRevision,
    ...input,
  });
export const updateAdminUser = (
  token: string,
  baseRevision: number,
  targetUserId: string,
  patch: AdminUserPatch,
) =>
  request<AdminMutationResponse>(token, {
    action: 'adminUpdateUser',
    baseRevision,
    targetUserId,
    patch,
  });
export const setAdminUserActive = (
  token: string,
  baseRevision: number,
  targetUserId: string,
  active: boolean,
  rotateToken = true,
) =>
  request<AdminMutationResponse>(token, {
    action: 'adminSetUserActive',
    baseRevision,
    targetUserId,
    active,
    rotateToken,
  });
export const rotateAdminUserToken = (
  token: string,
  baseRevision: number,
  targetUserId: string,
) =>
  request<AdminMutationResponse>(token, {
    action: 'adminRotateUserToken',
    baseRevision,
    targetUserId,
  });
