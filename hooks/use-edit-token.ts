import { useSyncExternalStore } from 'react';
import {
  getEditTokenStorage,
  getEditTokenStorageIssue,
  getStoredEditToken,
  subscribeEditTokens,
} from '@/lib/auth/edit-tokens';

export function useEditToken(userSlug: string) {
  const token = useSyncExternalStore(
    subscribeEditTokens,
    () => getStoredEditToken(userSlug),
    () => '',
  );
  const storage = useSyncExternalStore(
    subscribeEditTokens,
    () => getEditTokenStorage(userSlug),
    () => 'none' as const,
  );
  const issue = useSyncExternalStore(
    subscribeEditTokens,
    () => getEditTokenStorageIssue(userSlug),
    () => '',
  );
  return { token, storage, issue };
}
