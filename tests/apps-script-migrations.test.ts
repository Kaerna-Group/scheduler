// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import vm from 'node:vm';
import { ApiError, getApiHealth } from '@/lib/api/client';
import { fetchSchedule } from '@/lib/schedule/repository';
import { createTestBackend } from './support/apps-script-backend';
import {
  appsScriptFiles,
  readAppsScriptSource,
} from '../scripts/apps-script-sources.mjs';

vi.hoisted(() =>
  vi.stubEnv('VITE_SCHEDULE_API_URL', 'https://scheduler.test/exec'),
);
const journalKey = 'SCHEDULER_SCHEMA_MIGRATION';
const chunkPrefix = journalKey + '_CHUNK_';
const migration2 = '002-user-preferences-and-current-semester';
let backend: ReturnType<typeof createTestBackend>;
type Database = ReturnType<typeof backend.snapshot>;
beforeEach(() => {
  backend = createTestBackend();
  vi.stubGlobal('fetch', vi.fn(backend.fetch));
});
afterEach(() => vi.unstubAllGlobals());

function legacy(version: string | null = '1', users = 2) {
  const data = backend.snapshot();
  for (let index = 1; index < users; index++)
    data.Users.push({
      ...data.Users[0],
      user_id: 'USER-' + index,
      slug: 'user-' + index,
      display_name: 'User ' + index,
      role: 'user',
    });
  data.UserPreferences = [];
  data.Meta = data.Meta.filter(
    (row) => row.key !== 'current_semester_id' && row.key !== 'schema_version',
  );
  if (version !== null)
    data.Meta.push({ key: 'schema_version', value: version });
  data.Meta.find((row) => row.key === 'data_revision')!.value = '17';
  backend.replaceDatabase(data);
  return data;
}
function schema(data = backend.snapshot()) {
  return data.Meta.find((row) => row.key === 'schema_version')?.value;
}
function migrations(data = backend.snapshot()) {
  return data.AuditLog.filter((row) => row.action === 'MIGRATE_SCHEMA');
}
function staged() {
  const manifest = JSON.parse(backend.properties.get(journalKey)!);
  const chunks = Array.from({ length: manifest.chunks }, (_, index) =>
    backend.properties.get(chunkPrefix + index),
  );
  return JSON.parse(chunks.join('')) as { tables: Database; summary: unknown };
}
function expectPreserved(before: Database) {
  for (const name of [
    'Users',
    'Subjects',
    'Offerings',
    'Groups',
    'Enrollments',
    'Lessons',
    'LessonGroups',
    'LessonWeeks',
    'Semesters',
  ])
    expect(backend.snapshot()[name], name).toEqual(before[name]);
  expect(
    backend.snapshot().Meta.find((row) => row.key === 'data_revision')!.value,
  ).toBe('17');
}
function expectNoJournal() {
  expect(
    [...backend.properties.keys()].filter((key) => key.startsWith(journalKey)),
  ).toEqual([]);
  expect(backend.properties.has('SCHEDULER_CACHE_WRITE_PENDING')).toBe(false);
}

describe('migration header preflight with real storage helpers', () => {
  function fixture(initialHeaders: string[], rowCount: number) {
    const context = vm.createContext({});
    vm.runInContext(readAppsScriptSource(), context);
    const expected = vm.runInContext(
      'SCHEDULER_SHEETS.Users',
      context,
    ) as string[];
    let headers = [...initialHeaders];
    const range = {
      getDisplayValues: () => [headers],
      setValues: vi.fn((values: string[][]) => {
        headers = [...values[0]];
      }),
      setFontWeight: () => range,
      setBackground: () => range,
      setFontColor: () => range,
    };
    const sheet = {
      getLastRow: () => rowCount,
      getLastColumn: () => headers.length,
      getRange: () => range,
      clear: vi.fn(() => {
        headers = [];
      }),
      setFrozenRows: vi.fn(),
      autoResizeColumns: vi.fn(),
    };
    const spreadsheet = {
      getSheetByName: (name: string) => (name === 'Users' ? sheet : null),
    };
    return {
      expected,
      sheet,
      range,
      preflight: () =>
        context.schemaTablesNeedingSetup_(spreadsheet) as string[],
      ensure: () => context.ensureSheet_(spreadsheet, 'Users', expected),
    };
  }

  it.each(['reordered', 'missing', 'extra'])(
    'rejects %s columns in a populated sheet before any mutation',
    (kind) => {
      const headers = [
        'user_id',
        'slug',
        'display_name',
        'role',
        'edit_token_hash',
        'active',
      ];
      if (kind === 'reordered')
        [headers[0], headers[1]] = [headers[1], headers[0]];
      if (kind === 'missing') headers.pop();
      if (kind === 'extra') headers.push('unexpected');
      const test = fixture(headers, 2);
      expect(() => test.preflight()).toThrow(/unexpected columns/);
      expect(() => test.ensure()).toThrow(/unexpected columns/);
      expect(test.sheet.clear).not.toHaveBeenCalled();
      expect(test.range.setValues).not.toHaveBeenCalled();
    },
  );

  it('repairs an empty sheet with surplus headers once, without repeating the repair', () => {
    const test = fixture(
      [
        'user_id',
        'slug',
        'display_name',
        'role',
        'edit_token_hash',
        'active',
        'extra',
      ],
      1,
    );
    expect(test.preflight()).toContain('Users');
    test.ensure();
    expect(test.range.setValues).toHaveBeenCalledWith([test.expected]);
    expect(test.preflight()).not.toContain('Users');
    expect(test.preflight()).toContain('UserPreferences');
    test.ensure();
    expect(test.sheet.clear).toHaveBeenCalledTimes(1);
    expect(test.range.setValues).toHaveBeenCalledTimes(1);
  });
});

describe('ordered schema migrations', () => {
  it('bundles the runner, numbered migrations and manual maintenance without dist or credentials', () => {
    expect(appsScriptFiles()).toEqual(
      expect.arrayContaining([
        '14_Migrations.gs',
        'migrations/001_Baseline.gs',
        'migrations/002_UserPreferences.gs',
        'maintenance/01_Scrum2026.gs',
      ]),
    );
    expect(appsScriptFiles().some((file) => /dist|clasp|json/.test(file))).toBe(
      false,
    );
  });

  it.each([null, '0'])(
    'runs an unversioned/v%s database through 1 then 2, never reseeding it',
    (version) => {
      const before = legacy(version);
      expect(backend.upgrade()).toMatchObject({
        schemaVersion: '2',
        appliedMigrations: ['001-relational-baseline', migration2],
        resumedMigrations: [],
        preferenceRowsAdded: 2,
      });
      expect(
        migrations().map((row) => JSON.parse(row.new_value).schemaVersion),
      ).toEqual([1, 2]);
      expect(backend.snapshot().UserPreferences).toHaveLength(2);
      expectPreserved(before);
      expectNoJournal();
    },
  );

  it('upgrades v1, commits Meta only after data flush, and is an exact no-op on retry', () => {
    const before = legacy();
    expect(backend.upgrade()).toMatchObject({
      previousSchemaVersion: '1',
      schemaVersion: '2',
      appliedMigrations: [migration2],
      repairs: [],
    });
    expect(schema()).toBe('2');
    expectPreserved(before);
    const metaWrite = backend.storage.events.indexOf('write:Meta');
    expect(backend.storage.events[metaWrite - 1]).toBe('flush');
    expect(backend.storage.events[metaWrite + 1]).toBe('flush');
    expect(backend.storage.writes).toEqual([
      'UserPreferences',
      'AuditLog',
      'Meta',
    ]);
    expect(backend.storage.events.at(-1)).toBe('unlock');
    const done = backend.snapshot();
    backend.storage.writes.length = 0;
    expect(backend.upgrade()).toMatchObject({
      appliedMigrations: [],
      resumedMigrations: [],
      repairs: [],
      changedTables: [],
    });
    expect(backend.snapshot()).toEqual(done);
    expect(backend.storage.writes).toEqual([]);
    expectNoJournal();
  });

  it('preserves existing preferences and settings_revision while adding missing user rows', () => {
    const row = {
      ...backend.snapshot().UserPreferences[0],
      theme_id: 'air-light',
      settings_revision: '8',
    };
    legacy();
    const data = backend.snapshot();
    data.UserPreferences = [row];
    backend.replaceDatabase(data);
    expect(backend.upgrade()).toMatchObject({ preferenceRowsAdded: 1 });
    expect(backend.snapshot().UserPreferences[0]).toEqual(row);
  });

  it('repairs missing current-version rows separately without rerunning migration 2', () => {
    const before = legacy('2');
    expect(backend.upgrade()).toMatchObject({
      appliedMigrations: [],
      repairs: ['repair-schema-2'],
      schemaVersion: '2',
    });
    expect(migrations()).toEqual([]);
    expect(backend.snapshot().AuditLog.at(-1)?.action).toBe('REPAIR_SCHEMA');
    expectPreserved(before);
    const result = backend.snapshot();
    backend.upgrade();
    expect(backend.snapshot()).toEqual(result);
  });

  it.each(['3', '99', '-1', '1.5', 'abc', '', '02', '9007199254740992'])(
    'rejects unsupported/malformed schema %j without mutations',
    (version) => {
      const before = legacy(version);
      expect(() => backend.upgrade()).toThrow();
      expect(() => backend.setup()).toThrow();
      expect(backend.snapshot()).toEqual(before);
      expect(backend.storage.writes).toEqual([]);
      expect(backend.properties.size).toBe(0);
      expect(backend.storage.events.at(-1)).toBe('unlock');
    },
  );

  it('rejects duplicate version rows and broken foreign keys before staging', () => {
    const before = legacy();
    before.Meta.push({ key: 'schema_version', value: '1' });
    backend.replaceDatabase(before);
    expect(() => backend.upgrade()).toThrow(/one non-negative integer/);
    before.Meta.pop();
    before.Enrollments[0].offering_id = 'unknown';
    backend.replaceDatabase(before);
    expect(() => backend.upgrade()).toThrow(/foreign key/);
    expect(backend.snapshot()).toEqual(before);
    expect(backend.properties.size).toBe(0);
  });

  it('does not treat a timetable with missing Users as an empty installation', () => {
    const before = legacy();
    before.Users = [];
    backend.replaceDatabase(before);
    expect(() => backend.setup()).toThrow();
    expect(backend.snapshot()).toEqual(before);
    expect(backend.storage.writes).toEqual([]);
  });

  it.each(['gap', 'duplicate-id', 'missing-step'])(
    'validates the complete registry before any mutation: %s',
    (problem) => {
      backend = createTestBackend({
        transformSource: (source) => {
          if (problem === 'gap')
            return source.replace(
              "version: 2, id: '002-",
              "version: 3, id: '002-",
            );
          if (problem === 'duplicate-id')
            return source.replace(
              "id: '002-user-preferences-and-current-semester'",
              "id: '001-relational-baseline'",
            );
          return source.replace("schemaVersion: '2'", "schemaVersion: '3'");
        },
      });
      const before = legacy();
      expect(() => backend.upgrade()).toThrow(/registry|consecutive/);
      expect(backend.snapshot()).toEqual(before);
      expect(backend.storage.writes).toEqual([]);
      expect(backend.properties.size).toBe(0);
    },
  );

  it('supports a future third migration and resumes only the remaining step after a failure', () => {
    backend = createTestBackend({
      transformSource: (source) =>
        source
          .replace("schemaVersion: '2'", "schemaVersion: '3'")
          .replace(
            /\]\);\r?\nconst SCHEDULER_SCHEMA_REPAIRS/,
            "  Object.freeze({ version: 3, id: '003-test-only', apply: migrateSchema003_ }),\n]);\nconst SCHEDULER_SCHEMA_REPAIRS",
          ) +
        `\nfunction migrateSchema003_(database) {
        if (PropertiesService.getScriptProperties().getProperty('TEST_FAIL_3')) throw new Error('Injected step 3 failure');
        database.Meta.push({ key: 'test_step_3', value: 'complete' });
        return {};
      }`,
    });
    const before = legacy(null);
    backend.properties.set('TEST_FAIL_3', 'yes');
    expect(() => backend.upgrade()).toThrow(/step 3/);
    expect(schema()).toBe('2');
    expect(migrations()).toHaveLength(2);
    expect(backend.properties.has(journalKey)).toBe(false);
    backend.properties.delete('TEST_FAIL_3');
    expect(backend.upgrade()).toMatchObject({
      previousSchemaVersion: '2',
      schemaVersion: '3',
      appliedMigrations: ['003-test-only'],
    });
    expect(
      migrations().map((row) => JSON.parse(row.new_value).schemaVersion),
    ).toEqual([1, 2, 3]);
    expectPreserved(before);
    expectNoJournal();
  });

  it('creates a missing preferences sheet without changing existing data', () => {
    const before = legacy();
    delete before.UserPreferences;
    backend.replaceDatabase(before);
    backend.upgrade();
    expect(backend.snapshot().UserPreferences).toHaveLength(2);
    expectPreserved(before);
  });
});

describe('durable recovery after interrupted Sheets writes', () => {
  it('does not repeat a committed earlier migration when the next step is interrupted', () => {
    legacy(null);
    backend.storage.failWriteAfterClearFor = 'UserPreferences';
    expect(() => backend.upgrade()).toThrow();
    expect(schema()).toBe('1');
    expect(migrations().map((row) => row.entity_id)).toEqual([
      '001-relational-baseline',
    ]);
    backend.storage.failWriteAfterClearFor = '';
    expect(backend.upgrade()).toMatchObject({
      appliedMigrations: [],
      resumedMigrations: [migration2],
    });
    expect(migrations().map((row) => row.entity_id)).toEqual([
      '001-relational-baseline',
      migration2,
    ]);
  });
  it.each([
    ['failWriteFor', 'UserPreferences'],
    ['failWriteAfterClearFor', 'UserPreferences'],
    ['failWriteFor', 'AuditLog'],
    ['failWriteAfterClearFor', 'AuditLog'],
    ['failWriteFor', 'Meta'],
    ['failWriteAfterClearFor', 'Meta'],
    ['failWriteAfterStoreFor', 'Meta'],
  ] as const)(
    'recovers %s:%s with the exact staged rows and one audit entry',
    async (failure, table) => {
      const before = legacy();
      backend.storage[failure] = table;
      expect(() => backend.upgrade()).toThrow();
      const target = Object.assign(structuredClone(before), staged().tables);
      expect(backend.properties.has(journalKey)).toBe(true);
      expect(backend.storage.events.at(-1)).toBe('unlock');
      await expect(fetchSchedule('ermolz')).rejects.toMatchObject({
        code: 'SCHEMA_MIGRATION_PENDING',
      });
      await expect(getApiHealth()).rejects.toBeInstanceOf(ApiError);
      const partial = backend.snapshot();
      const response = backend.post({
        action: 'adminCreateUser',
        editToken: backend.token,
        baseRevision: 17,
        displayName: 'Blocked',
        slug: 'blocked',
        role: 'user',
      });
      expect(response).toMatchObject({
        ok: false,
        error: { code: 'SCHEMA_MIGRATION_PENDING' },
      });
      expect(backend.snapshot()).toEqual(partial);
      backend.storage[failure] = '';
      expect(backend.upgrade()).toMatchObject({
        appliedMigrations: [],
        resumedMigrations: [migration2],
      });
      expect(backend.snapshot()).toEqual(target);
      expect(migrations()).toHaveLength(1);
      expectPreserved(before);
      expectNoJournal();
      expect((await fetchSchedule('ermolz')).revision).toBe(17);
    },
  );

  it.each([1, 2])(
    'retains the journal if flush %s fails, even when schema_version was already written',
    (flush) => {
      const before = legacy();
      backend.storage.failFlushAt = flush;
      expect(() => backend.upgrade()).toThrow(/flush failed/);
      if (flush === 1) expect(schema()).toBe('1');
      else expect(schema()).toBe('2');
      const target = Object.assign(before, staged().tables);
      backend.storage.failFlushAt = 0;
      backend.upgrade();
      expect(backend.snapshot()).toEqual(target);
      expectNoJournal();
    },
  );

  it.each([
    journalKey,
    'SCHEDULER_CACHE_WRITE_PENDING',
    'SCHEDULER_CACHE_RECOVERY_EPOCH',
  ])('resumes after failed cleanup of %s', (key) => {
    legacy();
    if (key === 'SCHEDULER_CACHE_RECOVERY_EPOCH')
      backend.storage.failPropertySetFor = key;
    else backend.storage.failPropertyDeleteFor = key;
    expect(() => backend.upgrade()).toThrow();
    expect(schema()).toBe('2');
    const target = backend.snapshot();
    expect(backend.properties.has(journalKey)).toBe(true);
    backend.storage.failPropertySetFor = '';
    backend.storage.failPropertyDeleteFor = '';
    backend.upgrade();
    expect(backend.snapshot()).toEqual(target);
    expectNoJournal();
  });

  it('never modifies Sheets if staging fails, and removes orphan chunks on retry', () => {
    const before = legacy('1', 12);
    backend.storage.failPropertySetFor = chunkPrefix + '1';
    expect(() => backend.upgrade()).toThrow(/quota/);
    expect(backend.snapshot()).toEqual(before);
    expect(backend.storage.writes).toEqual([]);
    expect(backend.properties.has(journalKey)).toBe(false);
    expect(backend.properties.has(chunkPrefix + '0')).toBe(true);
    backend.storage.failPropertySetFor = '';
    backend.upgrade();
    expect(backend.snapshot().UserPreferences).toHaveLength(12);
    expectNoJournal();
  });

  it('recovers a published journal after its acknowledgement is lost', () => {
    const before = legacy();
    backend.storage.failPropertyAfterSetFor = journalKey;
    expect(() => backend.upgrade()).toThrow(/response lost/);
    expect(backend.snapshot()).toEqual(before);
    expect(backend.storage.writes).toEqual([]);
    backend.storage.failPropertyAfterSetFor = '';
    expect(backend.upgrade()).toMatchObject({
      resumedMigrations: [migration2],
    });
    expectNoJournal();
  });

  it.each(['checksum', 'missing-chunk', 'spreadsheet', 'invalid-json'])(
    'fails closed on a damaged or foreign journal: %s',
    (damage) => {
      legacy();
      backend.storage.failWriteFor = 'UserPreferences';
      expect(() => backend.upgrade()).toThrow();
      backend.storage.failWriteFor = '';
      if (damage === 'checksum')
        backend.properties.set(chunkPrefix + '0', 'damaged');
      if (damage === 'missing-chunk')
        backend.properties.delete(chunkPrefix + '0');
      if (damage === 'invalid-json') backend.properties.set(journalKey, '{');
      if (damage === 'spreadsheet') {
        const manifest = JSON.parse(backend.properties.get(journalKey)!);
        manifest.spreadsheetId = 'another-sheet';
        backend.properties.set(journalKey, JSON.stringify(manifest));
      }
      const before = backend.snapshot();
      backend.storage.writes.length = 0;
      expect(() => backend.upgrade()).toThrow(/journal/);
      expect(backend.snapshot()).toEqual(before);
      expect(backend.storage.writes).toEqual([]);
      expect(backend.properties.has(journalKey)).toBe(true);
    },
  );

  it('does not replay an old plan over a manually advanced schema', () => {
    legacy();
    backend.storage.failWriteFor = 'UserPreferences';
    expect(() => backend.upgrade()).toThrow();
    backend.storage.failWriteFor = '';
    const data = backend.snapshot();
    data.Meta.find((row) => row.key === 'schema_version')!.value = '99';
    backend.replaceDatabase(data);
    backend.storage.writes.length = 0;
    expect(() => backend.upgrade()).toThrow(/newer schema/);
    expect(backend.storage.writes).toEqual([]);
    expect(backend.snapshot()).toEqual(data);
  });

  it('recovers initial setup without reseeding or minting another token', () => {
    const empty = backend.snapshot();
    Object.keys(empty).forEach((name) => {
      empty[name] = [];
    });
    backend.replaceDatabase(empty);
    backend.storage.failWriteAfterClearFor = 'Lessons';
    expect(() => backend.setup()).toThrow();
    const target = staged().tables;
    backend.storage.failWriteAfterClearFor = '';
    expect(backend.setup()).toMatchObject({
      seeded: false,
      resumedMigrations: ['seed-schema-2'],
    });
    expect(backend.snapshot()).toEqual(target);
    expectNoJournal();
  });

  it('rejects oversized recovery plans before changing any Sheets rows', () => {
    const before = legacy();
    before.AuditLog[0].new_value = 'x'.repeat(201000);
    backend.replaceDatabase(before);
    expect(() => backend.upgrade()).toThrow(/too large/);
    expect(backend.snapshot()).toEqual(before);
    expect(backend.storage.writes).toEqual([]);
    expect(backend.properties.size).toBe(0);
  });

  it('cleans idle chunks without touching unrelated script properties', () => {
    backend.properties.set(chunkPrefix + '0', 'orphan');
    backend.properties.set('ANOTHER_SETTING', 'keep');
    backend.upgrade();
    expect(backend.properties.get('ANOTHER_SETTING')).toBe('keep');
    expect(backend.properties.has(chunkPrefix + '0')).toBe(false);
    expect(backend.storage.writes).toEqual([]);
  });
});
