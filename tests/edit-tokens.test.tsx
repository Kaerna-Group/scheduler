// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditToken } from '@/hooks/use-edit-token';
import {
  EDIT_TOKEN_EVENT,
  forgetAllEditTokens,
  getEditTokenStorage,
  getEditTokenStorageIssue,
  getStoredEditToken,
  storeEditToken,
} from '@/lib/auth/edit-tokens';

const key = (slug = 'user') => 'scheduler_edit_token_v2:' + slug;
beforeEach(() => {
  forgetAllEditTokens();
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  forgetAllEditTokens();
});

describe('shared edit token lifetimes', () => {
  it('defaults to tab storage, survives a module reload, but not a new tab session', async () => {
    storeEditToken('user', '  private-token  ');
    expect(getStoredEditToken('user')).toBe('private-token');
    expect(getEditTokenStorage('user')).toBe('session');
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.getItem(key())).toBe('private-token');
    vi.resetModules();
    const reloaded = await import('@/lib/auth/edit-tokens');
    expect(reloaded.getStoredEditToken('user')).toBe('private-token');
    sessionStorage.clear(); // New tab session, same origin's persistent storage.
    expect(reloaded.getStoredEditToken('user')).toBe('');
  });

  it('persists only with explicit consent and removes the device copy when unchecked', () => {
    storeEditToken('user', 'remembered', true);
    expect(getEditTokenStorage('user')).toBe('device');
    expect(localStorage.getItem(key())).toBe('remembered');
    expect(sessionStorage.getItem(key())).toBeNull();
    sessionStorage.clear();
    expect(getStoredEditToken('user')).toBe('remembered');
    storeEditToken('user', 'remembered', false);
    expect(localStorage.getItem(key())).toBeNull();
    expect(sessionStorage.getItem(key())).toBe('remembered');
    expect(getEditTokenStorage('user')).toBe('session');
    sessionStorage.clear();
    expect(getStoredEditToken('user')).toBe('');
  });

  it('never treats an auto-saved legacy token as explicit consent', () => {
    localStorage.setItem('scheduler_edit_token_v1:user', 'legacy');
    expect(getStoredEditToken('user')).toBe('');
  });

  it('isolates users and removes both lifetimes without touching other application data', () => {
    storeEditToken('user', 'tab');
    storeEditToken('admin', 'device', true);
    expect(getStoredEditToken('unknown')).toBe('');
    expect(getStoredEditToken('admin')).toBe('device');
    localStorage.setItem('scheduler_cache_v1:user:semester', 'schedule');
    localStorage.setItem('scheduler_edit_token_v1:legacy', 'legacy');
    forgetAllEditTokens();
    expect(getStoredEditToken('user')).toBe('');
    expect(getStoredEditToken('admin')).toBe('');
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(1);
    expect(localStorage.getItem('scheduler_cache_v1:user:semester')).toBe(
      'schedule',
    );
  });

  it('reacts to edits, retention changes, removal and user switches without exposing tokens in events', () => {
    const listener = vi.fn();
    window.addEventListener(EDIT_TOKEN_EVENT, listener);
    const { result, rerender } = renderHook(({ slug }) => useEditToken(slug), {
      initialProps: { slug: 'user' },
    });
    act(() => storeEditToken('user', 'secret'));
    expect(result.current).toMatchObject({
      token: 'secret',
      storage: 'session',
    });
    expect(listener.mock.calls[0][0]).not.toHaveProperty('detail');
    act(() => storeEditToken('user', 'secret', true));
    expect(result.current.storage).toBe('device');
    rerender({ slug: 'other' });
    expect(result.current.token).toBe('');
    rerender({ slug: 'user' });
    act(() => {
      forgetAllEditTokens();
    });
    expect(result.current.token).toBe('');
    window.removeEventListener(EDIT_TOKEN_EVENT, listener);
  });

  it('observes persistent rotation/removal from another tab, but keeps independent temporary tokens', () => {
    storeEditToken('user', 'old', true);
    const { result } = renderHook(() => useEditToken('user'));
    const change = (token: string | null) =>
      act(() => {
        if (token) localStorage.setItem(key(), token);
        else localStorage.removeItem(key());
        window.dispatchEvent(
          new StorageEvent('storage', {
            key: key(),
            storageArea: localStorage,
          }),
        );
      });
    change('new');
    expect(result.current.token).toBe('new');
    change(null);
    expect(result.current.token).toBe('');
    act(() => storeEditToken('user', 'my-tab'));
    change('another-tab');
    expect(result.current).toMatchObject({
      token: 'my-tab',
      storage: 'session',
    });
  });

  it('falls back to memory when storage is blocked and can still forget the token', () => {
    const blocked = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('Denied');
      });
    storeEditToken('user', 'memory-secret');
    expect(getStoredEditToken('user')).toBe('memory-secret');
    expect(getEditTokenStorage('user')).toBe('memory');
    expect(getEditTokenStorageIssue('user')).toContain('reloads');
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    blocked.mockRestore();
    forgetAllEditTokens();
    expect(getStoredEditToken('user')).toBe('');
  });

  it('does not claim device storage when opting in fails', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota');
    });
    storeEditToken('user', 'secret', true);
    expect(getEditTokenStorage('user')).toBe('memory');
    expect(getEditTokenStorageIssue('user')).toContain('Could not save');
  });

  it('masks an old token and warns if the browser refuses to remove its persistent copy', () => {
    storeEditToken('user', 'saved', true);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('Denied');
    });
    storeEditToken('user', '');
    expect(getStoredEditToken('user')).toBe('');
    expect(getEditTokenStorageIssue('user')).toContain('may return');
  });

  it('reports incomplete removal when only tab storage refuses deletion', () => {
    storeEditToken('user', 'tab-secret');
    const remove = Storage.prototype.removeItem.bind(localStorage);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (
      this: Storage,
      name: string,
    ) {
      if (this === sessionStorage) throw new Error('Tab storage denied');
      remove(name);
    });
    expect(forgetAllEditTokens()).toBe(false);
    expect(getStoredEditToken('user')).toBe('');
    expect(getEditTokenStorageIssue('user')).toContain('previous tab token');
  });
});
