import { useCallback, useEffect, useRef, useState } from 'react';

import { useNetworkStatus } from '@/hooks/use-network-status';
import {
  ApiError,
  hasRemoteApi,
  isApiCompatibilityError,
} from '@/lib/api/client';
import {
  getAdminAuditLog,
  getAdminOverview,
  getAdminUser,
} from '@/lib/admin/repository';
import type {
  AdminAuditFilters,
  AdminAuditResponse,
  AdminMutationResponse,
  AdminOverview,
  AdminUserDetails,
} from '@/lib/admin/types';
import { readOnlineStatus } from '@/lib/network/connectivity';
import { getStoredEditToken, storeEditToken } from '@/lib/schedule/repository';

function initialToken() {
  try {
    return getStoredEditToken(
      localStorage.getItem('scheduler_selected_user_v1') ?? '',
    );
  } catch {
    return '';
  }
}

export function adminErrorMessage(error: unknown) {
  if (isApiCompatibilityError(error)) return error.message;
  if (error instanceof ApiError) {
    if (error.code === 'UNKNOWN_ACTION')
      return 'This backend does not support the requested admin operation. Publish the latest Apps Script bundle to the existing web-app deployment, then try again.';
    const details = error.details as
      | { expectedRevision?: number; receivedRevision?: number }
      | undefined;
    if (error.code === 'STALE_DATA')
      return `Data changed while you were editing. Current revision: ${details?.expectedRevision ?? error.revision ?? '?'}, your revision: ${details?.receivedRevision ?? '?'}. Refresh and review; nothing was retried automatically.`;
    return `${error.code}: ${error.message}`;
  }
  return 'The request could not be confirmed. Refresh before retrying a write; it may already have reached the server.';
}

export function useAdmin() {
  const online = useNetworkStatus();
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [details, setDetails] = useState<AdminUserDetails | null>(null);
  const [audit, setAudit] = useState<AdminAuditResponse | null>(null);
  const [credential, setCredential] = useState<{
    displayName: string;
    token: string;
  } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastVerifiedAt, setLastVerifiedAt] = useState<string | null>(null);
  const [backendAvailable, setBackendAvailable] = useState(false);
  const tokenRef = useRef('');
  const actorRef = useRef<AdminOverview['actor'] | null>(null);
  const session = useRef(0);
  const readSequence = useRef({ overview: 0, details: 0, audit: 0 });
  const writeBusy = useRef(false);

  const logout = useCallback(() => {
    session.current += 1;
    tokenRef.current = '';
    actorRef.current = null;
    setOverview(null);
    setDetails(null);
    setAudit(null);
    setCredential(null);
    setLastVerifiedAt(null);
    setBackendAvailable(false);
    setLoading(false);
    setDetailLoading(false);
    setAuditLoading(false);
    setError('');
  }, []);

  const report = useCallback(
    (failure: unknown) => {
      if (
        isApiCompatibilityError(failure) ||
        (failure instanceof ApiError &&
          ['UNAUTHORIZED', 'FORBIDDEN'].includes(failure.code))
      )
        logout();
      setError(adminErrorMessage(failure));
      if (
        !(failure instanceof ApiError) ||
        ['INTERNAL_ERROR', 'UNKNOWN_ACTION'].includes(failure.code)
      )
        setBackendAvailable(false);
    },
    [logout],
  );

  const authenticate = useCallback(
    async (token: string, remember = false) => {
      logout();
      if (!hasRemoteApi() || !readOnlineStatus()) {
        setError(
          'An online backend is required. Admin data is not cached offline.',
        );
        return;
      }
      const generation = session.current;
      setLoading(true);
      try {
        const data = await getAdminOverview(token.trim());
        if (session.current !== generation) return;
        tokenRef.current = token.trim();
        actorRef.current = data.actor;
        setOverview(data);
        setLastVerifiedAt(new Date().toISOString());
        setBackendAvailable(true);
        if (remember) storeEditToken(data.actor.slug, token.trim());
      } catch (failure) {
        if (session.current === generation) report(failure);
      } finally {
        if (session.current === generation) setLoading(false);
      }
    },
    [logout, report],
  );

  const refresh = useCallback(async () => {
    if (!tokenRef.current || !readOnlineStatus()) return;
    const generation = session.current;
    const sequence = ++readSequence.current.overview;
    setLoading(true);
    setError('');
    try {
      const data = await getAdminOverview(tokenRef.current);
      if (
        generation !== session.current ||
        sequence !== readSequence.current.overview
      )
        return;
      actorRef.current = data.actor;
      setOverview(data);
      setLastVerifiedAt(new Date().toISOString());
      setBackendAvailable(true);
    } catch (failure) {
      if (
        generation === session.current &&
        sequence === readSequence.current.overview
      )
        report(failure);
    } finally {
      if (
        generation === session.current &&
        sequence === readSequence.current.overview
      )
        setLoading(false);
    }
  }, [report]);

  const loadUser = useCallback(
    async (userId: string, semesterId?: string) => {
      const generation = session.current;
      const sequence = ++readSequence.current.details;
      setDetails(null);
      setDetailLoading(true);
      setError('');
      try {
        const data = await getAdminUser(tokenRef.current, userId, semesterId);
        if (
          generation === session.current &&
          sequence === readSequence.current.details
        )
          setDetails(data);
      } catch (failure) {
        if (
          generation === session.current &&
          sequence === readSequence.current.details
        )
          report(failure);
      } finally {
        if (
          generation === session.current &&
          sequence === readSequence.current.details
        )
          setDetailLoading(false);
      }
    },
    [report],
  );

  const loadAudit = useCallback(
    async (filters: AdminAuditFilters) => {
      const generation = session.current;
      const sequence = ++readSequence.current.audit;
      setAudit(null);
      setAuditLoading(true);
      setError('');
      try {
        const data = await getAdminAuditLog(tokenRef.current, filters);
        if (
          generation === session.current &&
          sequence === readSequence.current.audit
        )
          setAudit(data);
      } catch (failure) {
        if (
          generation === session.current &&
          sequence === readSequence.current.audit
        )
          report(failure);
      } finally {
        if (
          generation === session.current &&
          sequence === readSequence.current.audit
        )
          setAuditLoading(false);
      }
    },
    [report],
  );

  const mutate = useCallback(
    async <T extends { revision: number }>(
      operation: (token: string) => Promise<T>,
    ): Promise<T | undefined> => {
      if (writeBusy.current || !tokenRef.current || !readOnlineStatus()) return;
      writeBusy.current = true;
      // Ignore in-flight reads made with a pre-mutation token/revision (especially
      // self-rotation). Their late auth failures must not terminate the new session.
      readSequence.current.overview += 1;
      readSequence.current.details += 1;
      readSequence.current.audit += 1;
      setLoading(false);
      setDetailLoading(false);
      setAuditLoading(false);
      setSaving(true);
      setError('');
      const generation = session.current;
      try {
        const result = await operation(tokenRef.current);
        if (generation !== session.current) return;
        const userResult = result as T & Partial<AdminMutationResponse>;
        if (userResult.user && userResult.user.id === actorRef.current?.id) {
          if (!userResult.user.active || userResult.user.role !== 'admin') {
            logout();
            setError('Your account no longer has active admin access.');
            return result;
          }
          if (userResult.editToken) {
            if (getStoredEditToken(userResult.user.slug) === tokenRef.current)
              storeEditToken(userResult.user.slug, userResult.editToken);
            tokenRef.current = userResult.editToken;
          }
        }
        if (userResult.editToken && userResult.user)
          setCredential({
            displayName: userResult.user.displayName,
            token: userResult.editToken,
          });
        await refresh();
        return generation === session.current ? result : undefined;
      } catch (failure) {
        if (generation === session.current) report(failure);
        return undefined;
      } finally {
        writeBusy.current = false;
        setSaving(false);
      }
    },
    [logout, refresh, report],
  );

  useEffect(() => {
    const token = initialToken();
    if (token) void authenticate(token);
    return () => {
      session.current += 1;
      tokenRef.current = '';
    };
  }, [authenticate]);

  useEffect(() => {
    const recheck = () => {
      if (document.visibilityState === 'visible' && !writeBusy.current)
        void refresh();
    };
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', recheck);
    if (online && !writeBusy.current) void refresh();
    return () => {
      window.removeEventListener('focus', recheck);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, [online, refresh]);

  return {
    lastVerifiedAt,
    backendAvailable,
    overview,
    details,
    audit,
    credential,
    dismissCredential: () => setCredential(null),
    error,
    loading,
    detailLoading,
    auditLoading,
    saving,
    online,
    remoteConfigured: hasRemoteApi(),
    authenticate,
    logout,
    refresh,
    loadUser,
    loadAudit,
    mutate,
    // Only a verified session can supply credentials to the existing semester component.
    verifiedToken: overview ? tokenRef.current : '',
  };
}
