import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const configSource = readFileSync(new URL('../apps-script/00_Config.gs', import.meta.url), 'utf8');
const historySource = readFileSync(new URL('../apps-script/09_History.gs', import.meta.url), 'utf8');
const undoSource = readFileSync(new URL('../apps-script/10_Undo.gs', import.meta.url), 'utf8');
const database = {};
let persistedTables = [];
const context = {
  console, JSON, Object, Array, Number, String, Error, Math, Set, Date,
  Utilities: { getUuid: () => 'test' },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  loadDatabase_: () => database,
  authenticateEditToken_: () => ({ user_id: 'ADMIN', slug: 'admin', display_name: 'Admin', role: 'admin' }),
  requireRole_: (actor, roles) => { if (!roles.includes(actor.role)) throw new Error('Forbidden'); },
  getRevisionFromDb_: (value) => Number(value.Meta.find((row) => row.key === 'data_revision').value),
  setRevisionInDb_: (value, revision) => { value.Meta.find((row) => row.key === 'data_revision').value = String(revision); },
  assertDatabaseIntegrity_: () => {},
  persistDatabase_: (_value, tables) => { persistedTables = tables; },
  buildUserSchedule_: (slug, semesterId) => ({ user: { slug }, semester: { id: semesterId }, revision: 3 }),
};

vm.runInNewContext(`${configSource}\n${historySource}\n${undoSource}\nglobalThis.undoTestApi = { undoLastImport_, reverseImportAuditRow_ };`, context);
const { undoLastImport_, reverseImportAuditRow_ } = context.undoTestApi;

Object.assign(database, {
  Users: [], UserPreferences: [], Semesters: [],
  Subjects: [{ subject_id: 'SUB-NEW', name: 'New course' }],
  Offerings: [{ offering_id: 'OFF-NEW', subject_id: 'SUB-NEW', semester_id: 'SEM-1' }],
  Groups: [{ group_id: 'GR-NEW', offering_id: 'OFF-NEW', group_number: '3' }],
  Enrollments: [{ enrollment_id: 'ENR-NEW', user_id: 'U1', offering_id: 'OFF-NEW', group_id: 'GR-NEW', active: 'yes' }],
  Lessons: [{ lesson_id: 'LES-NEW', offering_id: 'OFF-NEW', active: 'yes' }],
  LessonGroups: [{ lesson_id: 'LES-NEW', group_id: 'GR-NEW' }],
  LessonWeeks: [{ lesson_id: 'LES-NEW', week: '1' }],
  Meta: [{ key: 'data_revision', value: '2' }],
  AuditLog: [
    { timestamp: '2026-09-01T10:00:00.000Z', actor_user_id: 'U1', actor_slug: 'ermolz', action: 'CREATE', entity_type: 'Subject', entity_id: 'SUB-NEW', old_value: '', new_value: '{}', revision: '2' },
    { timestamp: '2026-09-01T10:00:00.000Z', actor_user_id: 'U1', actor_slug: 'ermolz', action: 'CREATE', entity_type: 'Offering', entity_id: 'OFF-NEW', old_value: '', new_value: '{}', revision: '2' },
    { timestamp: '2026-09-01T10:00:00.000Z', actor_user_id: 'U1', actor_slug: 'ermolz', action: 'CREATE', entity_type: 'Group', entity_id: 'GR-NEW', old_value: '', new_value: '{}', revision: '2' },
    { timestamp: '2026-09-01T10:00:00.000Z', actor_user_id: 'U1', actor_slug: 'ermolz', action: 'CREATE', entity_type: 'Lesson', entity_id: 'LES-NEW', old_value: '', new_value: '{}', revision: '2' },
    { timestamp: '2026-09-01T10:00:00.000Z', actor_user_id: 'U1', actor_slug: 'ermolz', action: 'ENROLL', entity_type: 'Enrollment', entity_id: 'ENR-NEW', old_value: '', new_value: '{}', revision: '2' },
    { timestamp: '2026-09-01T10:00:01.000Z', actor_user_id: 'U1', actor_slug: 'ermolz', action: 'IMPORT', entity_type: 'Import', entity_id: 'IMPORT-2', old_value: '{"baseRevision":1}', new_value: '{"targetUserSlug":"ermolz","semesterId":"SEM-1","changeCount":5}', revision: '2' },
  ],
});

const result = undoLastImport_({ editToken: 'valid-token', baseRevision: 2 });
assert.equal(result.undoneRevision, 2);
assert.equal(result.revision, 3);
assert.equal(database.Subjects.length, 0);
assert.equal(database.Offerings.length, 0);
assert.equal(database.Groups.length, 0);
assert.equal(database.Enrollments.length, 0);
assert.equal(database.Lessons.length, 0);
assert.equal(database.LessonGroups.length, 0);
assert.equal(database.LessonWeeks.length, 0);
assert.equal(database.AuditLog.at(-1).action, 'UNDO_IMPORT');
assert.equal(persistedTables.includes('AuditLog'), true);

const lessonDatabase = {
  Groups: [{ group_id: 'GR-4', offering_id: 'OFF-1', group_number: '4' }],
  Lessons: [{ lesson_id: 'LES-1', offering_id: 'OFF-1', active: 'no' }],
  LessonGroups: [], LessonWeeks: [],
};
reverseImportAuditRow_(lessonDatabase, {
  action: 'DEACTIVATE', entity_type: 'Lesson', entity_id: 'LES-1',
  old_value: JSON.stringify({ type: 'group', group: 4, day: 'friday', startTime: '10:00', endTime: '11:20', weeks: [1, 2, 3], room: '1-101', format: 'offline', teacher: 'Teacher' }),
});
assert.equal(lessonDatabase.Lessons[0].active, 'yes');
assert.equal(lessonDatabase.Lessons[0].room, '1-101');
assert.deepEqual(lessonDatabase.LessonWeeks.map((row) => Number(row.week)), [1, 2, 3]);
assert.equal(lessonDatabase.LessonGroups[0].group_id, 'GR-4');

console.log('Apps Script undo tests passed');
