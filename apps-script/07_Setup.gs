function setupScheduler() {
  const spreadsheet = getSchedulerSpreadsheet_();
  Object.keys(SCHEDULER_SHEETS).forEach(function (name) {
    ensureSheet_(spreadsheet, name, SCHEDULER_SHEETS[name]);
  });

  const database = loadDatabase_();
  if (database.Users.length) {
    assertDatabaseIntegrity_(database);
    return {
      spreadsheetId: spreadsheet.getId(),
      seeded: false,
      message: 'Schema already exists. No data or tokens were changed.',
    };
  }

  const token = generateEditToken_();
  const seeded = createSeedDatabase_(token);
  Object.keys(SCHEDULER_SHEETS).forEach(function (name) { writeTable_(name, seeded[name]); });
  return {
    spreadsheetId: spreadsheet.getId(),
    seeded: true,
    editTokens: { ermolz: token },
    warning: 'Copy the edit token now. Only its SHA-256 hash is stored in Sheets.',
  };
}

function createSeedDatabase_(ermolzToken) {
  const database = {};
  Object.keys(SCHEDULER_SHEETS).forEach(function (name) { database[name] = []; });

  database.Users.push({
    user_id: 'U001', slug: 'ermolz', display_name: 'Ermolz', role: 'editor',
    edit_token_hash: hashEditToken_(ermolzToken), active: 'yes',
  });
  database.Semesters.push({
    semester_id: 'SEM-2026-FALL', title: 'Осінь 2026 / 27', start_date: '2026-09-01',
    weeks_count: '14', active: 'yes',
  });

  const courses = [
    { subjectId: 'SUB-ELECTRONICS', offeringId: 'OFF-ELECTRONICS-26', code: '564966', name: 'Електроніка та цифрова електроніка', short: 'Електроніка', color: '#f59f65', group: 5 },
    { subjectId: 'SUB-SCRUM', offeringId: 'OFF-SCRUM-26', code: '565095', name: 'Основи фреймворку Скрам', short: 'Основи Скрам', color: '#7b86c6', group: 3, groups: [1, 2, 3] },
    { subjectId: 'SUB-WEB-SECURITY', offeringId: 'OFF-WEB-SECURITY-26', code: '565115', name: 'Інформаційна безпека веб-застосунків', short: 'Безпека веб-застосунків', color: '#5f8fdb', group: 4 },
    { subjectId: 'SUB-CRYPTONOMICS', offeringId: 'OFF-CRYPTONOMICS-26', code: 'LOCAL-CRYPTONOMICS', name: 'Криптономіка', short: 'Криптономіка', color: '#4c9d8b', group: 2 },
    { subjectId: 'SUB-CODING-SYSTEMS', offeringId: 'OFF-CODING-SYSTEMS-26', code: 'LOCAL-CODING-SYSTEMS', name: 'Системи кодування інформації', short: 'Системи кодування', color: '#d87575', group: 1 },
    { subjectId: 'SUB-QUALIFICATION', offeringId: 'OFF-QUALIFICATION-26', code: 'LOCAL-QUALIFICATION', name: 'Кваліфікаційна робота', short: 'Кваліфікаційна робота', color: '#a276c7', group: 2 },
    { subjectId: 'SUB-INTELLIGENT-NETWORKS', offeringId: 'OFF-INTELLIGENT-NETWORKS-26', code: 'LOCAL-INTELLIGENT-NETWORKS', name: 'Інтелектуальні мережі', short: 'Інтелектуальні мережі', color: '#9b8c51', group: 4 },
    { subjectId: 'SUB-PARALLEL-PROGRAMMING', offeringId: 'OFF-PARALLEL-PROGRAMMING-26', code: 'LOCAL-PARALLEL-PROGRAMMING', name: 'Багатозадачне та паралельне програмування', short: 'Паралельне програмування', color: '#5c7e83', group: 2 },
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
        label: groupNumber + ' група', active: 'yes',
      });
    });
    database.Enrollments.push({
      enrollment_id: 'ENR-ERMOLZ-' + String(index + 1).padStart(2, '0'), user_id: 'U001',
      offering_id: course.offeringId, group_id: groupIdByCourse[course.offeringId + ':' + course.group], active: 'yes',
    });
  });

  const lessons = [
    { id: 'LES-ELECTRONICS-G5', offering: 'OFF-ELECTRONICS-26', type: 'group', group: 5, day: 'wednesday', start: '11:40', end: '13:00', weeks: range_(4, 12), room: '1-001', format: 'offline', teacher: 'І. Раєць' },
    { id: 'LES-ELECTRONICS-LECTURE', offering: 'OFF-ELECTRONICS-26', type: 'lecture', day: 'saturday', start: '08:30', end: '09:50', weeks: range_(3, 11), room: '1-310', format: 'offline', teacher: 'Я. І. Вознюк' },
    { id: 'LES-SCRUM-LECTURE', offering: 'OFF-SCRUM-26', type: 'lecture', day: 'thursday', start: '10:00', end: '11:20', weeks: range_(1, 7), room: '', format: 'online', teacher: 'О. О. Палієнко' },
    { id: 'LES-SCRUM-G1', offering: 'OFF-SCRUM-26', type: 'group', group: 1, day: 'thursday', start: '11:40', end: '13:00', weeks: range_(1, 7), room: '', format: 'online', teacher: 'О. О. Палієнко' },
    { id: 'LES-SCRUM-G2', offering: 'OFF-SCRUM-26', type: 'group', group: 2, day: 'thursday', start: '13:30', end: '14:50', weeks: range_(1, 7), room: '', format: 'online', teacher: 'О. О. Палієнко' },
    { id: 'LES-SCRUM-G3', offering: 'OFF-SCRUM-26', type: 'group', group: 3, day: 'thursday', start: '15:00', end: '16:20', weeks: range_(1, 7), room: '', format: 'online', teacher: 'О. О. Палієнко' },
    { id: 'LES-WEB-SECURITY-LECTURE', offering: 'OFF-WEB-SECURITY-26', type: 'lecture', day: 'friday', start: '10:00', end: '11:20', weeks: range_(1, 10), room: '1-225', format: 'offline', teacher: 'Т. А. Бабич' },
    { id: 'LES-WEB-SECURITY-G4', offering: 'OFF-WEB-SECURITY-26', type: 'group', group: 4, day: 'friday', start: '16:30', end: '17:50', weeks: range_(1, 10), room: '1-331', format: 'offline', teacher: 'Т. А. Бабич' },
    { id: 'LES-CRYPTONOMICS-LECTURE', offering: 'OFF-CRYPTONOMICS-26', type: 'lecture', day: 'friday', start: '08:30', end: '09:50', weeks: range_(3, 12), room: '1-223', format: 'hybrid', teacher: 'К. С. Гороховський' },
    { id: 'LES-CRYPTONOMICS-G2', offering: 'OFF-CRYPTONOMICS-26', type: 'group', group: 2, day: 'saturday', start: '11:40', end: '13:00', weeks: range_(3, 12), room: '', format: 'online', teacher: 'К. С. Гороховський' },
    { id: 'LES-CODING-LECTURE', offering: 'OFF-CODING-SYSTEMS-26', type: 'lecture', day: 'saturday', start: '08:30', end: '09:50', weeks: [1, 3, 5, 7, 9, 11, 12], room: '', format: 'online', teacher: "П. Г. Прокоф'єв" },
    { id: 'LES-CODING-G1', offering: 'OFF-CODING-SYSTEMS-26', type: 'group', group: 1, day: 'saturday', start: '10:00', end: '11:20', weeks: range_(1, 14), room: '', format: 'online', teacher: "П. Г. Прокоф'єв" },
    { id: 'LES-NETWORKS-LECTURE', offering: 'OFF-INTELLIGENT-NETWORKS-26', type: 'lecture', day: 'thursday', start: '08:30', end: '09:50', weeks: [1, 3, 5, 7, 9, 11, 13], room: '', format: 'online', teacher: 'Н. Луцька' },
    { id: 'LES-NETWORKS-G4', offering: 'OFF-INTELLIGENT-NETWORKS-26', type: 'group', group: 4, day: 'thursday', start: '15:00', end: '16:20', weeks: range_(1, 14), room: '', format: 'online', teacher: 'Н. Луцька' },
    { id: 'LES-PARALLEL-LECTURE', offering: 'OFF-PARALLEL-PROGRAMMING-26', type: 'lecture', day: 'wednesday', start: '10:00', end: '11:20', weeks: range_(2, 12), room: '', format: 'online', teacher: 'Г. І. Малашонок' },
    { id: 'LES-PARALLEL-G2', offering: 'OFF-PARALLEL-PROGRAMMING-26', type: 'group', group: 2, day: 'wednesday', start: '13:30', end: '14:50', weeks: range_(2, 12), room: '', format: 'online', teacher: 'Г. І. Малашонок' },
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
  const safeSlug = String(slug || '').trim().toLowerCase();
  const safeName = String(displayName || '').trim();
  const safeRole = role || 'user';
  if (!/^[a-z0-9-]{2,40}$/.test(safeSlug)) throw new Error('slug must contain 2–40 lowercase letters, digits, or hyphens.');
  if (!safeName) throw new Error('displayName is required.');
  if (ALLOWED_ROLES.indexOf(safeRole) === -1) throw new Error('role must be user, editor, or admin.');

  const lock = LockService.getScriptLock();
  lock.waitLock(SCHEDULER_CONFIG.lockTimeoutMs);
  try {
    const database = loadDatabase_();
    if (database.Users.some(function (user) { return user.slug === safeSlug; })) throw new Error('User slug already exists.');
    const token = generateEditToken_();
    const user = {
      user_id: newId_('USR'), slug: safeSlug, display_name: safeName, role: safeRole,
      edit_token_hash: hashEditToken_(token), active: 'yes',
    };
    database.Users.push(user);
    const revision = getRevisionFromDb_(database) + 1;
    setRevisionInDb_(database, revision);
    appendAuditChanges_(database, { user_id: 'SYSTEM', slug: 'system' }, [{
      action: 'CREATE', entityType: 'User', entityId: user.user_id, oldValue: null,
      newValue: { user_id: user.user_id, slug: user.slug, display_name: user.display_name, role: user.role, active: user.active },
    }], revision);
    persistDatabase_(database, ['Users', 'Meta', 'AuditLog']);
    return { user: publicUser_(user), editToken: token, warning: 'Copy this token now; only its hash is stored.' };
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
    const token = generateEditToken_();
    user.edit_token_hash = hashEditToken_(token);
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

function migrateTymofiiUserToErmolz() {
  const lock = LockService.getScriptLock();
  lock.waitLock(SCHEDULER_CONFIG.lockTimeoutMs);
  try {
    const database = loadDatabase_();
    const existing = database.Users.find(function (row) { return row.slug === 'ermolz'; });
    const legacy = database.Users.find(function (row) { return row.slug === 'tymofii'; });
    if (!legacy) {
      if (existing) return { migrated: false, user: publicUser_(existing), message: 'User already uses slug ermolz.' };
      throw new Error('User with slug tymofii was not found.');
    }
    if (existing && existing.user_id !== legacy.user_id) throw new Error('Slug ermolz is already used by another user.');

    const previous = Object.assign({}, legacy);
    legacy.slug = 'ermolz';
    if (legacy.display_name === 'Tymofii') legacy.display_name = 'Ermolz';
    const revision = getRevisionFromDb_(database) + 1;
    setRevisionInDb_(database, revision);
    appendAuditChanges_(database, { user_id: 'SYSTEM', slug: 'system' }, [{
      action: 'UPDATE', entityType: 'User', entityId: legacy.user_id,
      oldValue: { slug: previous.slug, display_name: previous.display_name },
      newValue: { slug: legacy.slug, display_name: legacy.display_name },
    }], revision);
    assertDatabaseIntegrity_(database);
    persistDatabase_(database, ['Users', 'Meta', 'AuditLog']);
    return { migrated: true, user: publicUser_(legacy), revision: revision };
  } finally {
    lock.releaseLock();
  }
}

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
      subject.name = 'Основи фреймворку Скрам';
      subject.short_name = 'Основи Скрам';
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
        label: groupNumber + ' група',
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
        teacher: 'О. О. Палієнко',
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
