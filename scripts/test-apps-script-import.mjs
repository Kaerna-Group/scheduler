import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const configSource = readFileSync(new URL('../apps-script/00_Config.gs', import.meta.url), 'utf8');
const importSource = readFileSync(new URL('../apps-script/06_Import.gs', import.meta.url), 'utf8');
let idSequence = 0;
const context = {
  console,
  Set,
  Map,
  Date,
  JSON,
  Object,
  Array,
  Number,
  String,
  Error,
  Utilities: { getUuid: () => `00000000-0000-0000-0000-${String(++idSequence).padStart(12, '0')}` },
  requireRole_: (actor, roles) => {
    if (!roles.includes(actor.role)) throw new Error('Forbidden');
  },
};

vm.runInNewContext(`${configSource}\n${importSource}\nglobalThis.importTestApi = { syncLessons_ };`, context);
const { syncLessons_ } = context.importTestApi;

function makeDatabase() {
  return {
    Groups: [{ group_id: 'GR-4', offering_id: 'OFF-1', group_number: '4', label: 'Group 4', active: 'yes' }],
    Lessons: [
      { lesson_id: 'LES-LECTURE', offering_id: 'OFF-1', type: 'lecture', day: 'thursday', start_time: '08:30', end_time: '09:50', format: 'online', room: '', teacher: 'N. Lutska', active: 'yes' },
      { lesson_id: 'LES-GROUP-4', offering_id: 'OFF-1', type: 'group', day: 'thursday', start_time: '15:00', end_time: '16:20', format: 'online', room: '', teacher: 'N. Lutska', active: 'yes' },
    ],
    LessonGroups: [{ lesson_id: 'LES-GROUP-4', group_id: 'GR-4' }],
    LessonWeeks: [
      ...[1, 3, 5, 7, 9, 11, 13].map((week) => ({ lesson_id: 'LES-LECTURE', week: String(week) })),
      ...Array.from({ length: 14 }, (_, index) => ({ lesson_id: 'LES-GROUP-4', week: String(index + 1) })),
    ],
  };
}

const offering = { offering_id: 'OFF-1', external_code: 'LOCAL-INTELLIGENT-NETWORKS' };
const actor = { role: 'editor' };
const lecture = { type: 'lecture', day: 'thursday', startTime: '08:30', endTime: '09:50', weeks: [1, 3, 5, 7, 9, 11, 13], format: 'online', teacher: 'N. Lutska' };
const group3 = { type: 'group', group: 3, day: 'thursday', startTime: '13:30', endTime: '14:50', weeks: Array.from({ length: 14 }, (_, index) => index + 1), format: 'online', teacher: 'N. Lutska' };

{
  const database = makeDatabase();
  const changes = [];
  const conflicts = [];
  syncLessons_(database, offering, [lecture, group3], actor, false, changes, conflicts);
  assert.equal(conflicts.length, 0, 'a previously unknown group must be added without conflict');
  assert.equal(database.Lessons.filter((lesson) => lesson.active === 'yes').length, 3);
  assert.deepEqual(database.Groups.map((group) => Number(group.group_number)).sort((a, b) => a - b), [3, 4]);
  assert.equal(database.Lessons.find((lesson) => lesson.lesson_id === 'LES-GROUP-4').active, 'yes');
}

{
  const database = makeDatabase();
  const changes = [];
  const conflicts = [];
  const overlappingGroup4 = { ...group3, group: 4, startTime: '15:30', endTime: '16:50', teacher: 'Another Teacher' };
  syncLessons_(database, offering, [overlappingGroup4], actor, false, changes, conflicts);
  assert.equal(conflicts.length, 1, 'an overlapping rule for the same group and weeks must conflict');
  assert.equal(database.Lessons.length, 2);
}

{
  const database = makeDatabase();
  const changes = [];
  const conflicts = [];
  const separateGroup4Lesson = { ...group3, group: 4, startTime: '17:00', endTime: '18:20' };
  syncLessons_(database, offering, [separateGroup4Lesson], actor, false, changes, conflicts);
  assert.equal(conflicts.length, 0, 'a non-overlapping rule can represent another lesson');
  assert.equal(database.Lessons.length, 3);
}

{
  const database = makeDatabase();
  database.LessonWeeks = database.LessonWeeks.filter((row) => row.lesson_id !== 'LES-GROUP-4' || Number(row.week) <= 10);
  const changes = [];
  const conflicts = [];
  const sameGroup4WithMoreWeeks = { ...group3, group: 4, startTime: '15:00', endTime: '16:20' };
  syncLessons_(database, offering, [sameGroup4WithMoreWeeks], actor, false, changes, conflicts);
  const group4Weeks = database.LessonWeeks.filter((row) => row.lesson_id === 'LES-GROUP-4').map((row) => Number(row.week)).sort((a, b) => a - b);
  assert.deepEqual(group4Weeks, Array.from({ length: 14 }, (_, index) => index + 1), 'the same rule must be extended with missing weeks');
  assert.equal(database.Lessons.length, 2);
}

{
  const database = makeDatabase();
  const changes = [];
  const conflicts = [];
  const correctedGroup4 = { ...group3, group: 4, startTime: '15:30', endTime: '16:50', teacher: 'Another Teacher' };
  syncLessons_(database, offering, [correctedGroup4], actor, true, changes, conflicts);
  assert.equal(conflicts.length, 0);
  assert.equal(database.Lessons.find((lesson) => lesson.lesson_id === 'LES-GROUP-4').active, 'no');
  assert.equal(database.Lessons.filter((lesson) => lesson.active === 'yes' && lesson.type === 'group').length, 1);
}

console.log('Apps Script additive import tests passed');
