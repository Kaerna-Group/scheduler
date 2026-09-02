import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const configSource = readFileSync(new URL('../apps-script/00_Config.gs', import.meta.url), 'utf8');
const historySource = readFileSync(new URL('../apps-script/09_History.gs', import.meta.url), 'utf8');
const context = {
  console,
  JSON,
  Object,
  Array,
  Number,
  String,
  Error,
  Math,
  Utilities: { getUuid: () => 'test' },
  publicUser_: (user) => ({ id: user.user_id, slug: user.slug, displayName: user.display_name, role: user.role }),
  getRevisionFromDb_: () => 12,
};

vm.runInNewContext(`${configSource}\n${historySource}\nglobalThis.historyTestApi = { buildScheduleHistory_ };`, context);
const { buildScheduleHistory_ } = context.historyTestApi;

const lessonBefore = { type: 'lecture', day: 'thursday', startTime: '10:00', endTime: '11:20', weeks: Array.from({ length: 14 }, (_, index) => index + 1), room: '1-101', format: 'offline', teacher: 'Teacher' };
const lessonAfter = { ...lessonBefore, weeks: Array.from({ length: 7 }, (_, index) => index + 1), room: '1-202' };
const database = {
  Users: [
    { user_id: 'U1', slug: 'ermolz', display_name: 'Ermolz', role: 'editor', active: 'yes' },
    { user_id: 'U2', slug: 'zahar', display_name: 'Zahar', role: 'editor', active: 'yes' },
  ],
  Semesters: [{ semester_id: 'SEM-1', active: 'yes' }, { semester_id: 'SEM-2', active: 'yes' }],
  Subjects: [
    { subject_id: 'SUB-1', name: 'Scrum', short_name: 'Scrum', color: '#123456' },
    { subject_id: 'SUB-2', name: 'Old course', short_name: 'Old', color: '#654321' },
  ],
  Offerings: [
    { offering_id: 'OFF-1', semester_id: 'SEM-1', subject_id: 'SUB-1', external_code: 'SCRUM' },
    { offering_id: 'OFF-2', semester_id: 'SEM-2', subject_id: 'SUB-2', external_code: 'OLD' },
  ],
  Lessons: [
    { lesson_id: 'LES-1', offering_id: 'OFF-1', active: 'yes' },
    { lesson_id: 'LES-2', offering_id: 'OFF-2', active: 'yes' },
  ],
  Groups: [],
  Enrollments: [
    { enrollment_id: 'ENR-1', user_id: 'U1', offering_id: 'OFF-1', active: 'no' },
    { enrollment_id: 'ENR-2', user_id: 'U2', offering_id: 'OFF-1', active: 'no' },
  ],
  AuditLog: [
    { timestamp: '2026-09-01T10:00:00.000Z', actor_user_id: 'U2', actor_slug: 'zahar', action: 'UPDATE', entity_type: 'Lesson', entity_id: 'LES-1', old_value: JSON.stringify(lessonBefore), new_value: JSON.stringify(lessonAfter), revision: '10' },
    { timestamp: '2026-09-01T11:00:00.000Z', actor_user_id: 'U1', actor_slug: 'ermolz', action: 'UNENROLL', entity_type: 'Enrollment', entity_id: 'ENR-1', old_value: JSON.stringify({ user_id: 'U1', offering_id: 'OFF-1' }), new_value: JSON.stringify({ user_id: 'U1', offering_id: 'OFF-1', active: 'no' }), revision: '11' },
    { timestamp: '2026-09-01T12:00:00.000Z', actor_user_id: 'U2', actor_slug: 'zahar', action: 'UNENROLL', entity_type: 'Enrollment', entity_id: 'ENR-2', old_value: JSON.stringify({ user_id: 'U2', offering_id: 'OFF-1' }), new_value: JSON.stringify({ user_id: 'U2', offering_id: 'OFF-1', active: 'no' }), revision: '12' },
    { timestamp: '2026-09-01T13:00:00.000Z', actor_user_id: 'U2', actor_slug: 'zahar', action: 'UPDATE', entity_type: 'Lesson', entity_id: 'LES-2', old_value: '{}', new_value: '{}', revision: '12' },
    { timestamp: '2026-09-01T14:00:00.000Z', actor_user_id: 'U1', actor_slug: 'ermolz', action: 'UPDATE_PREFERENCES', entity_type: 'UserPreferences', entity_id: 'U1', old_value: '{}', new_value: '{}', revision: '12' },
  ],
};

const history = buildScheduleHistory_('ermolz', 'SEM-1', 100, database);
assert.equal(history.revision, 12);
assert.equal(history.events.length, 2, 'history exposes shared schedule changes and only the selected user enrollment changes');
assert.equal(history.events[0].scope, 'personal');
assert.equal(history.events[1].scope, 'shared');
assert.equal(history.events[1].actor.displayName, 'Zahar');
assert.equal(history.events[1].subject.name, 'Scrum');
assert.deepEqual(history.events[1].oldValue.weeks, lessonBefore.weeks);

console.log('Apps Script history tests passed');
