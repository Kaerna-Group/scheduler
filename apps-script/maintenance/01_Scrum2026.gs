// Explicit, historical content correction. Never called by the schema runner.
function migrateScrumSchedule2026() {
  const lock = LockService.getScriptLock();
  lock.waitLock(SCHEDULER_CONFIG.lockTimeoutMs);
  try {
    const database = loadDatabase_();
    const offering = database.Offerings.find(function (row) {
      return row.offering_id === 'OFF-SCRUM-26' ||
        (row.semester_id === 'SEM-2026-FALL' && row.external_code === '565095');
    });
    if (!offering) throw new Error('Scrum offering was not found.');

    const subject = database.Subjects.find(function (row) { return row.subject_id === offering.subject_id; });
    if (subject) {
      subject.name = 'Scrum Framework Fundamentals';
      subject.short_name = 'Scrum Fundamentals';
    }

    const groupsByNumber = {};
    database.Groups.forEach(function (row) {
      if (row.offering_id === offering.offering_id && isActive_(row.active)) groupsByNumber[Number(row.group_number)] = row;
    });
    [1, 2, 3].forEach(function (groupNumber) {
      if (groupsByNumber[groupNumber]) return;
      const group = {
        group_id: 'GR-SCRUM-' + groupNumber,
        offering_id: offering.offering_id,
        group_number: String(groupNumber),
        label: 'Group ' + groupNumber,
        active: 'yes',
      };
      database.Groups.push(group);
      groupsByNumber[groupNumber] = group;
    });

    const oldLessons = database.Lessons.filter(function (row) { return row.offering_id === offering.offering_id; });
    const oldLessonIds = new Set(oldLessons.map(function (row) { return row.lesson_id; }));
    database.Lessons = database.Lessons.filter(function (row) { return !oldLessonIds.has(row.lesson_id); });
    database.LessonGroups = database.LessonGroups.filter(function (row) { return !oldLessonIds.has(row.lesson_id); });
    database.LessonWeeks = database.LessonWeeks.filter(function (row) { return !oldLessonIds.has(row.lesson_id); });

    const scrumLessons = [
      { id: 'LES-SCRUM-LECTURE', type: 'lecture', day: 'thursday', start: '10:00', end: '11:20' },
      { id: 'LES-SCRUM-G1', type: 'group', group: 1, day: 'thursday', start: '11:40', end: '13:00' },
      { id: 'LES-SCRUM-G2', type: 'group', group: 2, day: 'thursday', start: '13:30', end: '14:50' },
      { id: 'LES-SCRUM-G3', type: 'group', group: 3, day: 'thursday', start: '15:00', end: '16:20' },
    ];
    scrumLessons.forEach(function (lesson) {
      database.Lessons.push({
        lesson_id: lesson.id,
        offering_id: offering.offering_id,
        type: lesson.type,
        day: lesson.day,
        start_time: lesson.start,
        end_time: lesson.end,
        format: 'online',
        room: '',
        teacher: 'O. O. Paliienko',
        active: 'yes',
      });
      if (lesson.group !== undefined) {
        database.LessonGroups.push({ lesson_id: lesson.id, group_id: groupsByNumber[lesson.group].group_id });
      }
      range_(1, 7).forEach(function (week) {
        database.LessonWeeks.push({ lesson_id: lesson.id, week: String(week) });
      });
    });

    const revision = getRevisionFromDb_(database) + 1;
    setRevisionInDb_(database, revision);
    appendAuditChanges_(database, { user_id: 'SYSTEM', slug: 'system' }, [{
      action: 'UPDATE',
      entityType: 'Offering',
      entityId: offering.offering_id,
      oldValue: { lessons: oldLessons },
      newValue: { lessons: scrumLessons, weeks: range_(1, 7), groups: [1, 2, 3] },
    }], revision);
    assertDatabaseIntegrity_(database);
    persistDatabase_(database, ['Subjects', 'Groups', 'Lessons', 'LessonGroups', 'LessonWeeks', 'Meta', 'AuditLog']);
    return { migrated: true, offeringId: offering.offering_id, revision: revision, lessons: scrumLessons.length };
  } finally {
    lock.releaseLock();
  }
}
