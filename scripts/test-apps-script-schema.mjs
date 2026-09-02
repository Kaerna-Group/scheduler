import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const configSource = readFileSync(
  new URL('../apps-script/00_Config.gs', import.meta.url),
  'utf8',
);
const validationSource = readFileSync(
  new URL('../apps-script/04_Validation.gs', import.meta.url),
  'utf8',
);
const setupSource = readFileSync(
  new URL('../apps-script/07_Setup.gs', import.meta.url),
  'utf8',
);
const preferencesSource = readFileSync(
  new URL('../apps-script/08_Preferences.gs', import.meta.url),
  'utf8',
);
const semestersSource = readFileSync(new URL('../apps-script/11_Semesters.gs', import.meta.url), 'utf8');

const database = {
  Users: [
    { user_id: 'USR-1', slug: 'one', role: 'user' },
    { user_id: 'USR-2', slug: 'two', role: 'user' },
  ],
  UserPreferences: [],
  Semesters: [{ semester_id: 'SEM-1', title: 'Semester 1', start_date: '2026-09-01', weeks_count: '14', active: 'yes' }],
  Subjects: [],
  Offerings: [],
  Groups: [],
  Enrollments: [],
  Lessons: [],
  LessonGroups: [],
  LessonWeeks: [],
  Meta: [
    { key: 'schema_version', value: '1' },
    { key: 'data_revision', value: '7' },
  ],
  AuditLog: [],
};

const context = {
  console,
  Set,
  Date,
  JSON,
  Object,
  Array,
  Number,
  String,
  Error,
  nowIso_: () => '2026-09-01T00:00:00.000Z',
  getRevisionFromDb_: (value) =>
    Number(value.Meta.find((row) => row.key === 'data_revision').value),
};

vm.runInNewContext(
  `${configSource}\n${preferencesSource}\n${validationSource}\n${setupSource}\n${semestersSource}\nglobalThis.schemaTestApi = { upgradeDatabaseSchema_, assertDatabaseIntegrity_ };`,
  context,
);

const first = context.schemaTestApi.upgradeDatabaseSchema_(database);
assert.equal(first.previousSchemaVersion, '1');
assert.equal(first.schemaVersion, '2');
assert.equal(first.preferenceRowsAdded, 2);
assert.deepEqual(Array.from(first.changedTables), [
  'Meta',
  'UserPreferences',
  'AuditLog',
]);
assert.equal(
  database.Meta.find((row) => row.key === 'schema_version').value,
  '2',
);
assert.equal(
  database.Meta.find((row) => row.key === 'data_revision').value,
  '7',
);
assert.equal(database.Meta.find((row) => row.key === 'current_semester_id').value, 'SEM-1');
assert.deepEqual(
  database.UserPreferences.map((row) => row.user_id),
  ['USR-1', 'USR-2'],
);
assert.equal(database.AuditLog[0].action, 'MIGRATE_SCHEMA');

const missingPreference = structuredClone(database);
missingPreference.UserPreferences.pop();
assert.throws(
  () => context.schemaTestApi.assertDatabaseIntegrity_(missingPreference),
  (error) =>
    error.code === 'INTEGRITY_ERROR' &&
    error.message.includes('UserPreferences is missing user'),
);

const orphanPreference = structuredClone(database);
orphanPreference.UserPreferences.push({
  ...database.UserPreferences[0],
  user_id: 'USR-ORPHAN',
});
assert.throws(
  () => context.schemaTestApi.assertDatabaseIntegrity_(orphanPreference),
  (error) =>
    error.code === 'INTEGRITY_ERROR' &&
    error.message.includes('UserPreferences has unknown user'),
);

const second = context.schemaTestApi.upgradeDatabaseSchema_(database);
assert.equal(second.preferenceRowsAdded, 0);
assert.deepEqual(Array.from(second.changedTables), []);
assert.equal(database.AuditLog.length, 1);

console.log('Apps Script schema migration tests passed');
