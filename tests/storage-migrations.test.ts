import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

class MemoryStorage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, String(value));
  }
}

const migrationSource = readFileSync(
  new URL('../public/storage-migrations.js', import.meta.url),
  'utf8',
);

function runMigrations() {
  runInNewContext(migrationSource, { localStorage });
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
});

describe('local storage migrations', () => {
  it('migrates the old user identity once before the application starts', () => {
    localStorage.setItem('scheduler_selected_user_v1', 'tymofii');
    localStorage.setItem('scheduler_edit_token_v1:tymofii', 'secret');
    localStorage.setItem(
      'scheduler_last_sync_v1:tymofii:fall',
      '2026-09-01T12:00:00.000Z',
    );
    localStorage.setItem(
      'scheduler_preferences_v2:tymofii',
      JSON.stringify({ preferencesRevision: 3 }),
    );
    localStorage.setItem(
      'scheduler_users_v1',
      JSON.stringify([
        { id: 'U001', slug: 'tymofii', displayName: 'Tymofii', role: 'editor' },
        { id: 'U002', slug: 'anna', displayName: 'Anna', role: 'user' },
      ]),
    );
    localStorage.setItem(
      'scheduler_cache_v1:tymofii:fall',
      JSON.stringify({
        user: {
          id: 'U001',
          slug: 'tymofii',
          displayName: 'Tymofii',
          role: 'editor',
        },
        users: [
          {
            id: 'U001',
            slug: 'tymofii',
            displayName: 'Tymofii',
            role: 'editor',
          },
        ],
        semester: { id: 'fall' },
      }),
    );

    runMigrations();

    expect(localStorage.getItem('scheduler_storage_schema_version')).toBe('2');
    expect(localStorage.getItem('scheduler_selected_user_v1')).toBe('ermolz');
    expect(localStorage.getItem('scheduler_edit_token_v1:ermolz')).toBe(
      'secret',
    );
    expect(localStorage.getItem('scheduler_last_sync_v1:ermolz:fall')).toBe(
      '2026-09-01T12:00:00.000Z',
    );
    expect(localStorage.getItem('scheduler_preferences_v2:ermolz')).toBe(
      JSON.stringify({ preferencesRevision: 3 }),
    );
    expect(
      JSON.parse(localStorage.getItem('scheduler_users_v1')!)[0],
    ).toMatchObject({ slug: 'ermolz', displayName: 'Ermolz' });
    expect(
      JSON.parse(localStorage.getItem('scheduler_cache_v1:ermolz:fall')!),
    ).toMatchObject({
      user: { slug: 'ermolz', displayName: 'Ermolz' },
      users: [{ slug: 'ermolz', displayName: 'Ermolz' }],
    });
    expect(
      [...Array(localStorage.length).keys()].map((index) =>
        localStorage.key(index),
      ),
    ).not.toContainEqual(expect.stringContaining('tymofii'));
  });

  it('keeps current values when both old and current keys exist', () => {
    localStorage.setItem('scheduler_edit_token_v1:tymofii', 'old-secret');
    localStorage.setItem('scheduler_edit_token_v1:ermolz', 'current-secret');
    localStorage.setItem('scheduler_preferences_v2:tymofii', 'old-preferences');
    localStorage.setItem(
      'scheduler_preferences_v2:ermolz',
      'current-preferences',
    );

    runMigrations();

    expect(localStorage.getItem('scheduler_edit_token_v1:ermolz')).toBe(
      'current-secret',
    );
    expect(localStorage.getItem('scheduler_preferences_v2:ermolz')).toBe(
      'current-preferences',
    );
    expect(localStorage.getItem('scheduler_edit_token_v1:tymofii')).toBeNull();
    expect(localStorage.getItem('scheduler_preferences_v2:tymofii')).toBeNull();
  });

  it('does not rerun version 2 migrations', () => {
    localStorage.setItem('scheduler_storage_schema_version', '2');
    localStorage.setItem('scheduler_selected_user_v1', 'tymofii');

    runMigrations();

    expect(localStorage.getItem('scheduler_selected_user_v1')).toBe('tymofii');
  });
});
