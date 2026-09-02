import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readAppsScriptSource } from './apps-script-sources.mjs';

const database = {
  Users: [
    { user_id: 'USR-1', slug: 'one', role: 'user' },
    { user_id: 'USR-2', slug: 'two', role: 'user' },
  ],
  UserPreferences: [],
  Semesters: [
    {
      semester_id: 'SEM-1',
      title: 'Semester 1',
      start_date: '2026-09-01',
      weeks_count: '14',
      active: 'yes',
    },
  ],
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
  `${readAppsScriptSource()}\nglobalThis.schemaTestApi = { planSchemaMigration_, schedulerMigrationRegistry_, repairSchema002_, assertDatabaseIntegrity_ };`,
  context,
);

const first = context.schemaTestApi.planSchemaMigration_(
  database,
  context.schemaTestApi.schedulerMigrationRegistry_()[1],
  [],
  false,
);
assert.equal(first.fromVersion, 1);
assert.equal(first.toVersion, 2);
assert.equal(first.summary.preferenceRowsAdded, 2);
assert.deepEqual(Object.keys(first.tables).sort(), [
  'AuditLog',
  'Meta',
  'UserPreferences',
]);
Object.assign(database, first.tables);
assert.equal(
  database.Meta.find((row) => row.key === 'schema_version').value,
  '2',
);
assert.equal(
  database.Meta.find((row) => row.key === 'data_revision').value,
  '7',
);
assert.equal(
  database.Meta.find((row) => row.key === 'current_semester_id').value,
  'SEM-1',
);
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

const second = context.schemaTestApi.planSchemaMigration_(
  database,
  {
    version: 2,
    id: 'repair-schema-2',
    apply: context.schemaTestApi.repairSchema002_,
  },
  [],
  true,
);
assert.equal(second, null);
assert.equal(database.AuditLog.length, 1);

console.log('Apps Script schema migration tests passed');
