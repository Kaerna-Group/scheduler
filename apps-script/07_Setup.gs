function setupScheduler() {
  const lock = LockService.getScriptLock();
  lock.waitLock(SCHEDULER_CONFIG.lockTimeoutMs);
  try { return setupSchedulerLocked_(); } finally { lock.releaseLock(); }
}

function setupSchedulerLocked_() {
  const spreadsheet = getSchedulerSpreadsheet_();
  schedulerMigrationRegistry_();
  databaseSchemaVersion_(readTable_('Meta', spreadsheet));
  const pending = PropertiesService.getScriptProperties().getProperty(SCHEDULER_CONFIG.migrationJournalProperty);
  if (pending) {
    return Object.assign({ seeded: false, message: 'Recovered the pending migration. No new seed data or credentials were generated.' },
      runSchedulerMigrationsLocked_(spreadsheet));
  }
  const database = loadDatabase_();
  // Never infer an empty installation from Users alone: that could overwrite
  // an existing timetable after an interrupted write or a manual edit.
  if (Object.keys(SCHEDULER_SHEETS).some(function (name) { return database[name].length; })) {
    const upgrade = runSchedulerMigrationsLocked_(spreadsheet);
    return Object.assign({
      seeded: false,
      message: upgrade.changedTables.length
        ? 'Schema migration or repair completed without changing existing edit tokens or schedule data.'
        : 'The database schema is current. No data or tokens were changed.',
    }, upgrade);
  }
  schemaTablesNeedingSetup_(spreadsheet);
  const token = generateEditToken_();
  const seeded = createSeedDatabase_(token);
  const plan = {
    format: 1, kind: 'seed', migrationId: 'seed-schema-' + SCHEDULER_CONFIG.schemaVersion,
    fromVersion: 0, toVersion: Number(SCHEDULER_CONFIG.schemaVersion), tables: seeded, summary: {},
  };
  commitSchemaMigration_(spreadsheet, stageSchemaMigration_(spreadsheet, plan));
  return {
    spreadsheetId: spreadsheet.getId(), seeded: true,
    schemaVersion: SCHEDULER_CONFIG.schemaVersion,
    editTokens: { ermolz: token },
    warning: 'Copy the edit token now. Only its SHA-256 hash is stored in Sheets.',
  };
}

function createSeedDatabase_(ermolzToken) {
  const database = {};
  Object.keys(SCHEDULER_SHEETS).forEach(function (name) { database[name] = []; });

  database.Users.push({
    user_id: 'U001', slug: 'ermolz', display_name: 'Ermolz', role: 'admin',
    edit_token_hash: hashEditToken_(ermolzToken), active: 'yes',
  });
  database.UserPreferences.push(createDefaultPreferenceRow_('U001'));
  database.Semesters.push({
    semester_id: 'SEM-2026-FALL', title: 'Fall 2026 / 27', start_date: '2026-09-01',
    weeks_count: '14', active: 'yes',
  });

  const courses = [
    { subjectId: 'SUB-ELECTRONICS', offeringId: 'OFF-ELECTRONICS-26', code: '564966', name: 'Electronics and Digital Electronics', short: 'Electronics', color: '#f59f65', group: 5 },
    { subjectId: 'SUB-SCRUM', offeringId: 'OFF-SCRUM-26', code: '565095', name: 'Scrum Framework Fundamentals', short: 'Scrum Fundamentals', color: '#7b86c6', group: 3, groups: [1, 2, 3] },
    { subjectId: 'SUB-WEB-SECURITY', offeringId: 'OFF-WEB-SECURITY-26', code: '565115', name: 'Web Application Security', short: 'Web Security', color: '#5f8fdb', group: 4 },
    { subjectId: 'SUB-CRYPTONOMICS', offeringId: 'OFF-CRYPTONOMICS-26', code: 'LOCAL-CRYPTONOMICS', name: 'Cryptonomics', short: 'Cryptonomics', color: '#4c9d8b', group: 2 },
    { subjectId: 'SUB-CODING-SYSTEMS', offeringId: 'OFF-CODING-SYSTEMS-26', code: 'LOCAL-CODING-SYSTEMS', name: 'Information Coding Systems', short: 'Coding Systems', color: '#d87575', group: 1 },
    { subjectId: 'SUB-QUALIFICATION', offeringId: 'OFF-QUALIFICATION-26', code: 'LOCAL-QUALIFICATION', name: 'Qualification Project', short: 'Qualification Project', color: '#a276c7', group: 2 },
    { subjectId: 'SUB-INTELLIGENT-NETWORKS', offeringId: 'OFF-INTELLIGENT-NETWORKS-26', code: 'LOCAL-INTELLIGENT-NETWORKS', name: 'Intelligent Networks', short: 'Intelligent Networks', color: '#9b8c51', group: 4 },
    { subjectId: 'SUB-PARALLEL-PROGRAMMING', offeringId: 'OFF-PARALLEL-PROGRAMMING-26', code: 'LOCAL-PARALLEL-PROGRAMMING', name: 'Multitasking and Parallel Programming', short: 'Parallel Programming', color: '#5c7e83', group: 2 },
  ];

  const groupIdByCourse = {};
  courses.forEach(function (course, index) {
    database.Subjects.push({
      subject_id: course.subjectId, name: course.name, short_name: course.short,
      color: course.color, active: 'yes',
    });
    database.Offerings.push({
      offering_id: course.offeringId, semester_id: 'SEM-2026-FALL', subject_id: course.subjectId,
      external_code: course.code, active: 'yes',
    });
    (course.groups || [course.group]).forEach(function (groupNumber) {
      const groupId = 'GR-' + course.subjectId.replace('SUB-', '') + '-' + groupNumber;
      groupIdByCourse[course.offeringId + ':' + groupNumber] = groupId;
      database.Groups.push({
        group_id: groupId, offering_id: course.offeringId, group_number: String(groupNumber),
        label: 'Group ' + groupNumber, active: 'yes',
      });
    });
    database.Enrollments.push({
      enrollment_id: 'ENR-ERMOLZ-' + String(index + 1).padStart(2, '0'), user_id: 'U001',
      offering_id: course.offeringId, group_id: groupIdByCourse[course.offeringId + ':' + course.group], active: 'yes',
    });
  });

  const lessons = [
    { id: 'LES-ELECTRONICS-G5', offering: 'OFF-ELECTRONICS-26', type: 'group', group: 5, day: 'wednesday', start: '11:40', end: '13:00', weeks: range_(4, 12), room: '1-001', format: 'offline', teacher: 'I. Raiets' },
    { id: 'LES-ELECTRONICS-LECTURE', offering: 'OFF-ELECTRONICS-26', type: 'lecture', day: 'saturday', start: '08:30', end: '09:50', weeks: range_(3, 11), room: '1-310', format: 'offline', teacher: 'Ya. I. Vozniuk' },
    { id: 'LES-SCRUM-LECTURE', offering: 'OFF-SCRUM-26', type: 'lecture', day: 'thursday', start: '10:00', end: '11:20', weeks: range_(1, 7), room: '', format: 'online', teacher: 'O. O. Paliienko' },
    { id: 'LES-SCRUM-G1', offering: 'OFF-SCRUM-26', type: 'group', group: 1, day: 'thursday', start: '11:40', end: '13:00', weeks: range_(1, 7), room: '', format: 'online', teacher: 'O. O. Paliienko' },
    { id: 'LES-SCRUM-G2', offering: 'OFF-SCRUM-26', type: 'group', group: 2, day: 'thursday', start: '13:30', end: '14:50', weeks: range_(1, 7), room: '', format: 'online', teacher: 'O. O. Paliienko' },
    { id: 'LES-SCRUM-G3', offering: 'OFF-SCRUM-26', type: 'group', group: 3, day: 'thursday', start: '15:00', end: '16:20', weeks: range_(1, 7), room: '', format: 'online', teacher: 'O. O. Paliienko' },
    { id: 'LES-WEB-SECURITY-LECTURE', offering: 'OFF-WEB-SECURITY-26', type: 'lecture', day: 'friday', start: '10:00', end: '11:20', weeks: range_(1, 10), room: '1-225', format: 'offline', teacher: 'T. A. Babych' },
    { id: 'LES-WEB-SECURITY-G4', offering: 'OFF-WEB-SECURITY-26', type: 'group', group: 4, day: 'friday', start: '16:30', end: '17:50', weeks: range_(1, 10), room: '1-331', format: 'offline', teacher: 'T. A. Babych' },
    { id: 'LES-CRYPTONOMICS-LECTURE', offering: 'OFF-CRYPTONOMICS-26', type: 'lecture', day: 'friday', start: '08:30', end: '09:50', weeks: range_(3, 12), room: '1-223', format: 'hybrid', teacher: 'K. S. Horokhovskyi' },
    { id: 'LES-CRYPTONOMICS-G2', offering: 'OFF-CRYPTONOMICS-26', type: 'group', group: 2, day: 'saturday', start: '11:40', end: '13:00', weeks: range_(3, 12), room: '', format: 'online', teacher: 'K. S. Horokhovskyi' },
    { id: 'LES-CODING-LECTURE', offering: 'OFF-CODING-SYSTEMS-26', type: 'lecture', day: 'saturday', start: '08:30', end: '09:50', weeks: [1, 3, 5, 7, 9, 11, 12], room: '', format: 'online', teacher: 'P. H. Prokofiev' },
    { id: 'LES-CODING-G1', offering: 'OFF-CODING-SYSTEMS-26', type: 'group', group: 1, day: 'saturday', start: '10:00', end: '11:20', weeks: range_(1, 14), room: '', format: 'online', teacher: 'P. H. Prokofiev' },
    { id: 'LES-NETWORKS-LECTURE', offering: 'OFF-INTELLIGENT-NETWORKS-26', type: 'lecture', day: 'thursday', start: '08:30', end: '09:50', weeks: [1, 3, 5, 7, 9, 11, 13], room: '', format: 'online', teacher: 'N. Lutska' },
    { id: 'LES-NETWORKS-G4', offering: 'OFF-INTELLIGENT-NETWORKS-26', type: 'group', group: 4, day: 'thursday', start: '15:00', end: '16:20', weeks: range_(1, 14), room: '', format: 'online', teacher: 'N. Lutska' },
    { id: 'LES-PARALLEL-LECTURE', offering: 'OFF-PARALLEL-PROGRAMMING-26', type: 'lecture', day: 'wednesday', start: '10:00', end: '11:20', weeks: range_(2, 12), room: '', format: 'online', teacher: 'H. I. Malashonok' },
    { id: 'LES-PARALLEL-G2', offering: 'OFF-PARALLEL-PROGRAMMING-26', type: 'group', group: 2, day: 'wednesday', start: '13:30', end: '14:50', weeks: range_(2, 12), room: '', format: 'online', teacher: 'H. I. Malashonok' },
  ];

  lessons.forEach(function (lesson) {
    database.Lessons.push({
      lesson_id: lesson.id, offering_id: lesson.offering, type: lesson.type, day: lesson.day,
      start_time: lesson.start, end_time: lesson.end, format: lesson.format, room: lesson.room,
      teacher: lesson.teacher, active: 'yes',
    });
    if (lesson.group !== undefined) {
      database.LessonGroups.push({ lesson_id: lesson.id, group_id: groupIdByCourse[lesson.offering + ':' + lesson.group] });
    }
    lesson.weeks.forEach(function (week) {
      database.LessonWeeks.push({ lesson_id: lesson.id, week: String(week) });
    });
  });

  database.Meta.push({ key: 'schema_version', value: SCHEDULER_CONFIG.schemaVersion });
  database.Meta.push({ key: SCHEDULER_CONFIG.revisionKey, value: '1' });
  database.Meta.push({ key: 'current_semester_id', value: 'SEM-2026-FALL' });
  database.AuditLog.push({
    timestamp: nowIso_(), actor_user_id: 'SYSTEM', actor_slug: 'system', action: 'SEED',
    entity_type: 'Database', entity_id: 'SEM-2026-FALL', old_value: '',
    new_value: JSON.stringify({ users: 1, subjects: courses.length, lessons: lessons.length }), revision: '1',
  });
  assertDatabaseIntegrity_(database);
  return database;
}

function range_(from, to) {
  const result = [];
  for (let value = from; value <= to; value += 1) result.push(value);
  return result;
}

function createSchedulerUser(displayName, slug, role) {
  const lock = LockService.getScriptLock();
  lock.waitLock(SCHEDULER_CONFIG.lockTimeoutMs);
  try {
    const database = loadDatabase_();
    const created = createUserRecord_(database, displayName, slug, role);
    const user = created.user;
    const revision = getRevisionFromDb_(database) + 1;
    setRevisionInDb_(database, revision);
    appendAuditChanges_(database, { user_id: 'SYSTEM', slug: 'system' }, [{
      action: 'CREATE', entityType: 'User', entityId: user.user_id, oldValue: null,
      newValue: { user_id: user.user_id, slug: user.slug, display_name: user.display_name, role: user.role, active: user.active },
    }], revision);
    persistDatabase_(database, ['Users', 'UserPreferences', 'Meta', 'AuditLog']);
    return { user: publicUser_(user), editToken: created.editToken, warning: 'Copy this token now; only its hash is stored.' };
  } finally {
    lock.releaseLock();
  }
}

function rotateSchedulerEditToken(slug) {
  const lock = LockService.getScriptLock();
  lock.waitLock(SCHEDULER_CONFIG.lockTimeoutMs);
  try {
    const database = loadDatabase_();
    const user = database.Users.find(function (row) { return row.slug === slug && isActive_(row.active); });
    if (!user) throw new Error('User not found.');
    const token = rotateUserTokenRecord_(user);
    const revision = getRevisionFromDb_(database) + 1;
    setRevisionInDb_(database, revision);
    appendAuditChanges_(database, { user_id: 'SYSTEM', slug: 'system' }, [{
      action: 'ROTATE_TOKEN', entityType: 'User', entityId: user.user_id, oldValue: null, newValue: { slug: user.slug },
    }], revision);
    persistDatabase_(database, ['Users', 'Meta', 'AuditLog']);
    return { user: publicUser_(user), editToken: token, warning: 'The previous token is now invalid.' };
  } finally {
    lock.releaseLock();
  }
}
