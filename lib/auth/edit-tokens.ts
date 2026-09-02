// Only v2 persistent keys represent explicit consent. Legacy v1 keys are moved
// to sessionStorage by the versioned bootstrap migration, never read here.
const TOKEN_PREFIX = 'scheduler_edit_token_v2:';
const LEGACY_PREFIX = 'scheduler_edit_token_v1:';
export const EDIT_TOKEN_EVENT = 'scheduler-edit-token-changed';
export type EditTokenStorage = 'none' | 'session' | 'device' | 'memory';
type TokenState = { token: string; storage: EditTokenStorage };
const empty: TokenState = { token: '', storage: 'none' };
const fallback = new Map<string, TokenState>();
const issues = new Map<string, string>();
let revision = 0;

function browserStorage(kind: 'localStorage' | 'sessionStorage') {
  try {
    return window[kind];
  } catch {
    return undefined;
  }
}

function readToken(userSlug: string): TokenState {
  if (!userSlug) return empty;
  const memory = fallback.get(userSlug);
  if (memory) return memory;
  const key = TOKEN_PREFIX + userSlug;
  for (const [kind, storage] of [
    ['sessionStorage', 'session'],
    ['localStorage', 'device'],
  ] as const) {
    try {
      const token = browserStorage(kind)?.getItem(key);
      if (token) return { token, storage };
    } catch {
      /* Storage can be disabled independently for either lifetime. */
    }
  }
  return empty;
}

export function getStoredEditToken(userSlug: string) {
  return readToken(userSlug).token;
}
export function getEditTokenStorage(userSlug: string) {
  return readToken(userSlug).storage;
}
export function getEditTokenStorageIssue(userSlug: string) {
  return issues.get(userSlug) ?? '';
}
export function getEditTokenRevision() {
  return revision;
}

function notify() {
  revision += 1;
  if (typeof window !== 'undefined')
    window.dispatchEvent(new Event(EDIT_TOKEN_EVENT));
}

export function subscribeEditTokens(listener: () => void) {
  const storageChanged = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(TOKEN_PREFIX)) {
      revision += 1;
      listener();
    }
  };
  window.addEventListener(EDIT_TOKEN_EVENT, listener);
  window.addEventListener('storage', storageChanged);
  window.addEventListener('focus', listener);
  return () => {
    window.removeEventListener(EDIT_TOKEN_EVENT, listener);
    window.removeEventListener('storage', storageChanged);
    window.removeEventListener('focus', listener);
  };
}

/** Session-only by default. Callers must explicitly opt in to device storage. */
export function storeEditToken(
  userSlug: string,
  value: string,
  remember = false,
) {
  if (!userSlug) return;
  const token = value.trim();
  const key = TOKEN_PREFIX + userSlug;
  let persistent = false;
  let removalFailed = false;
  issues.delete(userSlug);
  try {
    const storage = browserStorage('localStorage');
    if (!storage) throw new Error('Storage unavailable');
    if (token && remember) {
      storage.setItem(key, token);
      persistent = true;
    } else storage.removeItem(key);
  } catch {
    removalFailed = !remember || !token;
    issues.set(
      userSlug,
      removalFailed
        ? 'Browser storage is restricted. A previously saved token may remain on the device; clear this site’s data in browser settings to remove it completely.'
        : 'Could not save on this device. The token is available only in this tab.',
    );
  }
  let sessionSaved = false;
  try {
    const storage = browserStorage('sessionStorage');
    if (!storage) throw new Error('Storage unavailable');
    if (token && !persistent) storage.setItem(key, token);
    else storage.removeItem(key);
    sessionSaved = true;
  } catch {
    if (!token || persistent)
      issues.set(
        userSlug,
        [
          issues.get(userSlug),
          'Could not clear the previous tab token. It is not used on this page, but may return after reload; close this tab or clear this site’s data.',
        ]
          .filter(Boolean)
          .join(' '),
      );
    else if (!issues.has(userSlug))
      issues.set(
        userSlug,
        'Tab storage is unavailable. The current token will be lost when this page reloads; clear site data if a previous token was stored.',
      );
  }
  if (!sessionSaved || removalFailed)
    fallback.set(userSlug, {
      token,
      storage: !token
        ? 'none'
        : persistent
          ? 'device'
          : sessionSaved
            ? 'session'
            : 'memory',
    });
  else fallback.delete(userSlug);
  notify();
}

export function forgetAllEditTokens() {
  const users = new Set(fallback.keys());
  let complete = true;
  for (const kind of ['localStorage', 'sessionStorage'] as const) {
    try {
      const storage = browserStorage(kind);
      if (!storage) {
        complete = false;
        continue;
      }
      const legacy: string[] = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key?.startsWith(TOKEN_PREFIX))
          users.add(key.slice(TOKEN_PREFIX.length));
        if (key?.startsWith(LEGACY_PREFIX)) legacy.push(key);
      }
      legacy.forEach((key) => storage.removeItem(key));
    } catch {
      complete = false;
    }
  }
  users.forEach((slug) => storeEditToken(slug, ''));
  notify();
  return complete && [...users].every((slug) => !issues.has(slug));
}
