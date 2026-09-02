import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const configSource = readFileSync(new URL('../apps-script/00_Config.gs', import.meta.url), 'utf8');
const semesterSource = readFileSync(new URL('../apps-script/11_Semesters.gs', import.meta.url), 'utf8');
const repositorySource = readFileSync(new URL('../apps-script/05_Repository.gs', import.meta.url), 'utf8');
let sequence = 0;
const database = {};
let persisted = [];
const context = {
  console, JSON, Object, Array, Number, String, Error, Set, Date,
  Utilities: { getUuid: () => `00000000-0000-0000-0000-${String(++sequence).padStart(12, '0')}` },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  isActive_: (value) => value === 'yes',
  schedulerError_: (code, message, details) => Object.assign(new Error(message), { code, details }),
  loadDatabase_: () => database,
  authenticateEditToken_: () => ({ user_id: 'ADMIN', slug: 'admin', role: 'admin' }),
  requireRole_: (actor, roles) => { if (!roles.includes(actor.role)) throw new Error('Forbidden'); },
  getRevisionFromDb_: (value) => Number(value.Meta.find((row) => row.key === 'data_revision').value),
  setRevisionInDb_: (value, revision) => { value.Meta.find((row) => row.key === 'data_revision').value = String(revision); },
  appendAuditChanges_: (value, actor, changes, revision) => changes.forEach((change) => value.AuditLog.push({ actor_slug: actor.slug, action: change.action, entity_type: change.entityType, entity_id: change.entityId, revision: String(revision) })),
  assertDatabaseIntegrity_: () => {},
  persistDatabase_: (_value, tables) => { persisted = tables; },
  publicUser_: (user) => ({ id: user.user_id, slug: user.slug, displayName: user.display_name, role: user.role }),
  getUserPreferences_: () => ({ preferences: {}, preferencesRevision: 0, preferencesExists: false }),
};

vm.runInNewContext(`${configSource}\n${semesterSource}\n${repositorySource}\nglobalThis.semesterTestApi = { createSemester_, setCurrentSemester_, archiveSemester_, publicSemesters_, buildUserSchedule_ };`, context);

Object.assign(database, {
  Users: [{ user_id: 'U1', slug: 'one', display_name: 'One', role: 'user', active: 'yes' }],
  Semesters: [{ semester_id: 'SEM-OLD', title: 'Old', start_date: '2026-09-01', weeks_count: '14', active: 'yes' }],
  Subjects: [{ subject_id: 'SUB-1', name: 'Scrum', short_name: 'Scrum', color: '#123', active: 'yes' }],
  Offerings: [{ offering_id: 'OFF-1', semester_id: 'SEM-OLD', subject_id: 'SUB-1', external_code: 'SCRUM', active: 'yes' }],
  Groups: [{ group_id: 'GR-1', offering_id: 'OFF-1', group_number: '1', active: 'yes' }],
  Enrollments: [{ enrollment_id: 'ENR-1', user_id: 'U1', offering_id: 'OFF-1', group_id: 'GR-1', active: 'yes' }],
  Lessons: [{ lesson_id: 'LES-1', offering_id: 'OFF-1', active: 'yes' }],
  LessonGroups: [{ lesson_id: 'LES-1', group_id: 'GR-1' }],
  LessonWeeks: [{ lesson_id: 'LES-1', week: '1' }],
  Meta: [{ key: 'data_revision', value: '4' }, { key: 'current_semester_id', value: 'SEM-OLD' }],
  AuditLog: [],
});

const created = context.semesterTestApi.createSemester_({
  editToken: 'token', baseRevision: 4,
  semester: { id: 'sem-new', title: 'New', startDate: '2027-02-01', weeksCount: 15 },
  sourceSemesterId: 'SEM-OLD', copySubjects: true, makeCurrent: true,
});
assert.equal(created.semester.id, 'SEM-NEW');
assert.equal(created.copiedSubjects, 1);
assert.equal(database.Subjects.length, 2);
assert.equal(database.Offerings.length, 2);
assert.equal(database.Offerings[1].semester_id, 'SEM-NEW');
assert.equal(database.Groups.length, 1, 'groups are not copied');
assert.equal(database.Enrollments.length, 1, 'enrollments are not copied');
assert.equal(database.Lessons.length, 1, 'lessons are not copied');
assert.equal(database.LessonGroups.length, 1, 'lesson-group links are not copied');
assert.equal(database.LessonWeeks.length, 1, 'lesson weeks are not copied');
assert.equal(database.Meta.find((row) => row.key === 'current_semester_id').value, 'SEM-NEW');
assert.equal(persisted.includes('Subjects'), true);

context.semesterTestApi.setCurrentSemester_({ editToken: 'token', baseRevision: 5, semesterId: 'SEM-OLD' });
assert.equal(database.Meta.find((row) => row.key === 'current_semester_id').value, 'SEM-OLD');
context.semesterTestApi.archiveSemester_({ editToken: 'token', baseRevision: 6, semesterId: 'SEM-NEW' });
assert.equal(database.Semesters.find((row) => row.semester_id === 'SEM-NEW').active, 'no');
assert.equal(context.semesterTestApi.publicSemesters_(database).find((semester) => semester.id === 'SEM-NEW').archived, true);
assert.throws(
  () => context.semesterTestApi.archiveSemester_({ editToken: 'token', baseRevision: 7, semesterId: 'SEM-OLD' }),
  (error) => error.code === 'CURRENT_SEMESTER',
);

database.Offerings.push({ offering_id: 'OFF-OTHER', semester_id: 'SEM-NEW', subject_id: 'SUB-1', external_code: 'OTHER', active: 'yes' });
database.Lessons.push({ lesson_id: 'LES-OTHER', offering_id: 'OFF-OTHER', active: 'yes' });
const oldSchedule = context.semesterTestApi.buildUserSchedule_('one', undefined, database);
assert.equal(oldSchedule.semester.id, 'SEM-OLD', 'omitted semester uses currentSemesterId');
assert.deepEqual(Array.from(oldSchedule.lessons, (lesson) => lesson.id), ['LES-1'], 'a shared Subject must not leak lessons from another semester');
assert.equal(oldSchedule.currentSemesterId, 'SEM-OLD');
const archivedSchedule = context.semesterTestApi.buildUserSchedule_('one', 'SEM-NEW', database);
assert.equal(archivedSchedule.semester.id, 'SEM-NEW', 'archived semesters remain readable');
assert.equal(archivedSchedule.lessons.length, 0);

assert.throws(
  () => context.semesterTestApi.createSemester_({ editToken: 'token', baseRevision: 7, semester: { id: 'SEM-BAD', title: 'Bad', startDate: '2027-02-31', weeksCount: 14 } }),
  (error) => error.code === 'VALIDATION_ERROR',
);

console.log('Apps Script semester lifecycle tests passed');
