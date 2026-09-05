function controlText_(value, label, empty) {
  if (typeof value !== 'string' || value.length > 500 || (!empty && !value.trim())) throw schedulerError_('VALIDATION_ERROR', label + ' must be a string of at most 500 characters' + (empty ? '.' : ' and cannot be empty.'));
  return value.trim();
}

function controlRow_(database, table, id, writable) {
  controlId_(id, table + ' ID');
  const row = database[table].find(function (item) { return item[CONTROL_KEYS[table]] === id; });
  if (!row) throw schedulerError_('NOT_FOUND', table + ' record was not found: ' + id);
  if (writable && !isActive_(row.active)) throw schedulerError_('ARCHIVED', 'Archived records cannot be changed: ' + id);
  return row;
}

function controlSemester_(database, id, writable) {
  return controlRow_(database, 'Semesters', id || getCurrentSemesterId_(database), writable);
}

function controlOffering_(database, id) {
  const row = controlRow_(database, 'Offerings', id, true);
  controlSemester_(database, row.semester_id, true);
  controlRow_(database, 'Subjects', row.subject_id, true);
  return row;
}

function controlWeeks_(value, maximum) {
  if (!Array.isArray(value) || !value.length || value.length > maximum || value.some(function (week) { return !Number.isInteger(week) || week < 1 || week > maximum; }) || new Set(value).size !== value.length) throw schedulerError_('VALIDATION_ERROR', 'weeks must contain distinct week numbers within the semester.');
  return value.slice().sort(function (a, b) { return a - b; });
}

function controlLessonDto_(database, row) {
  return { lessonId: row.lesson_id, offeringId: row.offering_id, type: row.type, day: row.day, startTime: row.start_time, endTime: row.end_time,
    format: row.format, room: row.room, teacher: row.teacher, active: isActive_(row.active),
    weeks: database.LessonWeeks.filter(function (item) { return item.lesson_id === row.lesson_id; }).map(function (item) { return Number(item.week); }).sort(function (a, b) { return a - b; }),
    groupIds: database.LessonGroups.filter(function (item) { return item.lesson_id === row.lesson_id; }).map(function (item) { return item.group_id; }).sort() };
}

function controlCatalog_(database, semesterId) {
  const semester = controlSemester_(database, semesterId, false);
  const offerings = database.Offerings.filter(function (row) { return row.semester_id === semester.semester_id; });
  const ids = new Set(offerings.map(function (row) { return row.offering_id; }));
  return { revision: getRevisionFromDb_(database), semesterId: semester.semester_id, semesters: publicSemesters_(database),
    subjects: database.Subjects, offerings: offerings, groups: database.Groups.filter(function (row) { return ids.has(row.offering_id); }),
    // Enrollment lookup uses a separate scope because it contains user IDs.
    controlVersion: 1 };
}

function controlFindLessons_(database, filters) {
  controlObject_(filters, ['semesterId', 'course', 'offeringId', 'lessonId', 'type', 'day', 'startTime']);
  Object.keys(filters).forEach(function (key) { controlText_(filters[key], key, false); });
  const semester = controlSemester_(database, filters.semesterId, false);
  const offeringIds = new Set(database.Offerings.filter(function (row) { return row.semester_id === semester.semester_id && isActive_(row.active) &&
    (!filters.course || row.external_code === filters.course) && (!filters.offeringId || row.offering_id === filters.offeringId); }).map(function (row) { return row.offering_id; }));
  const lessons = database.Lessons.filter(function (row) { return isActive_(row.active) && offeringIds.has(row.offering_id) &&
    (!filters.lessonId || row.lesson_id === filters.lessonId) && (!filters.type || row.type === filters.type) &&
    (!filters.day || row.day === filters.day) && (!filters.startTime || row.start_time === filters.startTime); }).map(function (row) { return controlLessonDto_(database, row); });
  return { revision: getRevisionFromDb_(database), semesterId: semester.semester_id, lessons: lessons, count: lessons.length, ambiguous: lessons.length > 1 };
}

function controlReplaceLinks_(database, table, lessonId, values) {
  database[table] = database[table].filter(function (row) { return row.lesson_id !== lessonId; });
  values.forEach(function (value) {
    const row = { lesson_id: lessonId };
    row[table === 'LessonWeeks' ? 'week' : 'group_id'] = String(value);
    database[table].push(row);
  });
}

function controlLessonFields_(database, lesson, fields, creating) {
  const mapping = { type: 'type', day: 'day', startTime: 'start_time', endTime: 'end_time', format: 'format', room: 'room', teacher: 'teacher' };
  controlObject_(fields, Object.keys(mapping).concat(['weeks', 'groupIds']), creating ? ['type', 'day', 'startTime', 'endTime', 'format', 'teacher', 'weeks'] : []);
  Object.keys(mapping).forEach(function (key) {
    if (fields[key] !== undefined) lesson[mapping[key]] = controlText_(fields[key], key, key === 'room');
  });
  const offering = controlOffering_(database, lesson.offering_id);
  const semester = controlSemester_(database, offering.semester_id, true);
  if (fields.weeks !== undefined) controlReplaceLinks_(database, 'LessonWeeks', lesson.lesson_id, controlWeeks_(fields.weeks, Number(semester.weeks_count)));
  if (fields.groupIds !== undefined) {
    if (!Array.isArray(fields.groupIds) || fields.groupIds.length > 100 || new Set(fields.groupIds).size !== fields.groupIds.length) throw schedulerError_('VALIDATION_ERROR', 'groupIds must be a list of distinct group IDs.');
    fields.groupIds.forEach(function (id) {
      const group = controlRow_(database, 'Groups', id, true);
      if (group.offering_id !== offering.offering_id) throw schedulerError_('VALIDATION_ERROR', 'Group belongs to a different offering.');
    });
    controlReplaceLinks_(database, 'LessonGroups', lesson.lesson_id, fields.groupIds);
  }
  if (lesson.type === 'group' && !database.LessonGroups.some(function (row) { return row.lesson_id === lesson.lesson_id; })) throw schedulerError_('VALIDATION_ERROR', 'Group lessons must specify groupIds.');
  if (lesson.type === 'lecture' && database.LessonGroups.some(function (row) { return row.lesson_id === lesson.lesson_id; })) throw schedulerError_('VALIDATION_ERROR', 'Lectures are shared by the offering; groupIds must be empty.');
}

function controlCommandScope_(command) {
  if (!command || typeof command.type !== 'string') throw schedulerError_('VALIDATION_ERROR', 'A typed command is required.');
  const scopes = {
    'lesson.create': 'lessons:write', 'lesson.update': 'lessons:write', 'lesson.move': 'lessons:write', 'lesson.cancel': 'lessons:write',
    'subject.create': 'catalog:write', 'subject.update': 'catalog:write', 'subject.archive': 'catalog:write',
    'offering.create': 'catalog:write', 'offering.update': 'catalog:write', 'offering.archive': 'catalog:write',
    'group.create': 'catalog:write', 'group.update': 'catalog:write', 'group.archive': 'catalog:write',
    'semester.create': 'catalog:write', 'semester.update': 'catalog:write', 'semester.archive': 'catalog:write', 'semester.setCurrent': 'catalog:write',
    'enrollment.add': 'enrollments:write', 'enrollment.changeGroup': 'enrollments:write', 'enrollment.remove': 'enrollments:write',
    'changes.undo': 'changes:undo',
  };
  if (!Object.prototype.hasOwnProperty.call(scopes, command.type)) throw schedulerError_('FORBIDDEN', 'Unsupported command. Account, preference and raw table writes are forbidden.');
  return scopes[command.type];
}

function controlRunCommand_(database, command) {
  const type = command.type;
  if (type.indexOf('lesson.') === 0) {
    if (type === 'lesson.create') {
      controlObject_(command, ['type', 'offeringId', 'fields'], ['offeringId', 'fields']);
      controlOffering_(database, command.offeringId);
      const lesson = { lesson_id: newId_('LES'), offering_id: command.offeringId, room: '', active: 'yes' };
      database.Lessons.push(lesson);
      controlLessonFields_(database, lesson, command.fields, true);
      return;
    }
    const allowed = type === 'lesson.update' ? ['type', 'lessonId', 'fields'] : type === 'lesson.move' ? ['type', 'lessonId', 'startTime', 'day', 'weeks', 'fromWeek'] : ['type', 'lessonId', 'weeks', 'fromWeek'];
    controlObject_(command, allowed, type === 'lesson.move' ? ['lessonId', 'startTime'] : type === 'lesson.update' ? ['lessonId', 'fields'] : ['lessonId']);
    const lesson = controlRow_(database, 'Lessons', command.lessonId, true);
    const offering = controlOffering_(database, lesson.offering_id);
    if (type === 'lesson.update') { controlLessonFields_(database, lesson, command.fields, false); return; }
    const original = controlLessonDto_(database, lesson);
    const semester = controlSemester_(database, offering.semester_id, true);
    if (command.weeks !== undefined && command.fromWeek !== undefined) throw schedulerError_('VALIDATION_ERROR', 'Use either weeks or fromWeek.');
    if (command.fromWeek !== undefined && (!Number.isInteger(command.fromWeek) || command.fromWeek < 1 || command.fromWeek > Number(semester.weeks_count))) throw schedulerError_('VALIDATION_ERROR', 'fromWeek is outside the semester.');
    const selected = command.weeks !== undefined ? controlWeeks_(command.weeks, Number(semester.weeks_count)) : original.weeks.filter(function (week) { return command.fromWeek === undefined || week >= command.fromWeek; });
    if (!selected.length || selected.some(function (week) { return original.weeks.indexOf(week) === -1; })) throw schedulerError_('VALIDATION_ERROR', 'Selected weeks must occur in the existing lesson.');
    const remaining = original.weeks.filter(function (week) { return selected.indexOf(week) === -1; });
    if (type === 'lesson.cancel') {
      if (!remaining.length) lesson.active = 'no';
      else controlReplaceLinks_(database, 'LessonWeeks', lesson.lesson_id, remaining);
      return;
    }
    if (typeof command.startTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(command.startTime)) throw schedulerError_('VALIDATION_ERROR', 'startTime must be HH:mm.');
    function minutes(time) { const parts = time.split(':').map(Number); return parts[0] * 60 + parts[1]; }
    const end = minutes(command.startTime) + minutes(lesson.end_time) - minutes(lesson.start_time);
    if (end >= 24 * 60) throw schedulerError_('VALIDATION_ERROR', 'A lesson cannot cross midnight.');
    if (command.startTime === lesson.start_time && (command.day === undefined || command.day === lesson.day)) throw schedulerError_('NO_CHANGES', 'The lesson is already at the requested time.');
    let target = lesson;
    if (remaining.length) {
      target = Object.assign({}, lesson, { lesson_id: newId_('LES') });
      database.Lessons.push(target);
      controlReplaceLinks_(database, 'LessonWeeks', lesson.lesson_id, remaining);
      controlReplaceLinks_(database, 'LessonWeeks', target.lesson_id, selected);
      controlReplaceLinks_(database, 'LessonGroups', target.lesson_id, original.groupIds);
    }
    target.start_time = command.startTime;
    target.end_time = String(Math.floor(end / 60)).padStart(2, '0') + ':' + String(end % 60).padStart(2, '0');
    if (command.day !== undefined) target.day = controlText_(command.day, 'day', false);
    return;
  }
  if (type.indexOf('enrollment.') === 0) {
    controlObject_(command, type === 'enrollment.add' ? ['type', 'userId', 'offeringId', 'groupId'] : ['type', 'enrollmentId', 'groupId'], type === 'enrollment.add' ? ['userId', 'offeringId'] : ['enrollmentId']);
    if (type === 'enrollment.remove' && command.groupId !== undefined) throw schedulerError_('VALIDATION_ERROR', 'remove does not accept groupId.');
    if (type === 'enrollment.changeGroup' && command.groupId === undefined) throw schedulerError_('VALIDATION_ERROR', 'groupId is required; use null to clear it.');
    let enrollment;
    if (type === 'enrollment.add') {
      controlId_(command.userId, 'userId');
      if (!database.Users.some(function (row) { return row.user_id === command.userId && isActive_(row.active); })) throw schedulerError_('USER_NOT_FOUND', 'An existing active user is required.');
      controlOffering_(database, command.offeringId);
      if (database.Enrollments.some(function (row) { return row.user_id === command.userId && row.offering_id === command.offeringId && isActive_(row.active); })) throw schedulerError_('ENROLLMENT_EXISTS', 'Use enrollment.changeGroup for an existing enrollment.');
      enrollment = { enrollment_id: newId_('ENR'), user_id: command.userId, offering_id: command.offeringId, group_id: '', active: 'yes' };
      database.Enrollments.push(enrollment);
    } else {
      enrollment = controlRow_(database, 'Enrollments', command.enrollmentId, true);
      controlOffering_(database, enrollment.offering_id);
      if (!database.Users.some(function (row) { return row.user_id === enrollment.user_id && isActive_(row.active); })) throw schedulerError_('USER_NOT_FOUND', 'Inactive users cannot receive enrollment changes.');
    }
    if (type === 'enrollment.remove') { enrollment.active = 'no'; return; }
    if (command.groupId !== undefined) {
      if (command.groupId !== null) {
        const group = controlRow_(database, 'Groups', command.groupId, true);
        if (group.offering_id !== enrollment.offering_id) throw schedulerError_('VALIDATION_ERROR', 'Enrollment group belongs to another offering.');
      }
      enrollment.group_id = command.groupId || '';
    }
    return;
  }
  controlCatalogCommand_(database, command);
}

function controlCatalogCommand_(database, command) {
  const parts = command.type.split('.');
  const entity = parts[0];
  const operation = parts[1];
  const table = { subject: 'Subjects', offering: 'Offerings', group: 'Groups', semester: 'Semesters' }[entity];
  if (!table) throw schedulerError_('FORBIDDEN', 'Unsupported catalog command.');
  controlObject_(command, ['type', 'id', 'fields'], operation === 'create' ? ['fields'] : ['id']);
  if ((operation === 'archive' || operation === 'setCurrent') && command.fields !== undefined) throw schedulerError_('VALIDATION_ERROR', 'This command does not accept fields.');
  const mapping = {
    subject: { name: 'name', shortName: 'short_name', color: 'color' },
    offering: { semesterId: 'semester_id', subjectId: 'subject_id', externalCode: 'external_code' },
    group: { offeringId: 'offering_id', groupNumber: 'group_number', label: 'label' },
    semester: { title: 'title', startDate: 'start_date', weeksCount: 'weeks_count' },
  }[entity];
  let row;
  if (operation === 'create') {
    const required = { subject: ['name', 'shortName', 'color'], offering: ['semesterId', 'subjectId', 'externalCode'], group: ['offeringId', 'groupNumber', 'label'], semester: ['title', 'startDate', 'weeksCount'] }[entity];
    controlObject_(command.fields, Object.keys(mapping), required);
    if (entity === 'semester' && !command.id) throw schedulerError_('VALIDATION_ERROR', 'An explicit semester id is required.');
    const id = command.id === undefined ? newId_({ subject: 'SUB', offering: 'OFF', group: 'GR' }[entity]) : controlId_(command.id, 'id');
    if (database[table].some(function (item) { return item[CONTROL_KEYS[table]] === id; })) throw schedulerError_('ALREADY_EXISTS', 'This ID already exists.');
    row = { active: 'yes' };
    row[CONTROL_KEYS[table]] = id;
    database[table].push(row);
  } else {
    row = controlRow_(database, table, command.id, true);
    if (entity === 'offering') controlSemester_(database, row.semester_id, true);
    if (entity === 'group') controlOffering_(database, row.offering_id);
    if (entity === 'subject' && database.Offerings.some(function (item) {
      return item.subject_id === row.subject_id && !isActive_(controlSemester_(database, item.semester_id, false).active);
    })) throw schedulerError_('ARCHIVED', 'A subject used by an archived semester is read-only.');
  }
  if (operation === 'setCurrent') { setCurrentSemesterId_(database, row.semester_id); return; }
  if (operation === 'archive') {
    const blocked = entity === 'subject' ? database.Offerings.some(function (item) { return item.subject_id === row.subject_id && isActive_(item.active); }) :
      entity === 'group' ? database.Enrollments.some(function (item) { return item.group_id === row.group_id && isActive_(item.active); }) || database.LessonGroups.some(function (item) { return item.group_id === row.group_id && isActive_(controlRow_(database, 'Lessons', item.lesson_id, false).active); }) : false;
    if (blocked) throw schedulerError_('DEPENDENT_RECORDS', 'Archive or reassign the active related records first.');
    if (entity === 'semester' && getCurrentSemesterId_(database) === row.semester_id) throw schedulerError_('CURRENT_SEMESTER', 'Select another current semester before archiving this one.');
    row.active = 'no';
    return;
  }
  controlObject_(command.fields, Object.keys(mapping));
  Object.keys(command.fields).forEach(function (field) {
    if (operation === 'update' && ['semesterId', 'subjectId', 'offeringId'].indexOf(field) !== -1) throw schedulerError_('FORBIDDEN', 'Catalog parent IDs are immutable.');
    const value = command.fields[field];
    if (field === 'weeksCount' || field === 'groupNumber') {
      if (!Number.isInteger(value) || value < 1 || value > (field === 'weeksCount' ? 30 : 999)) throw schedulerError_('VALIDATION_ERROR', 'Invalid ' + field);
      row[mapping[field]] = String(value);
    } else row[mapping[field]] = controlText_(value, field, false);
  });
  if (entity === 'subject' && !/^#[0-9a-fA-F]{6}$/.test(row.color)) throw schedulerError_('VALIDATION_ERROR', 'color must be #RRGGBB.');
  if (entity === 'semester') {
    const date = new Date(row.start_date + 'T00:00:00.000Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.start_date) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== row.start_date) throw schedulerError_('VALIDATION_ERROR', 'startDate must be a valid YYYY-MM-DD.');
  }
  if (entity === 'offering') { controlSemester_(database, row.semester_id, true); controlRow_(database, 'Subjects', row.subject_id, true); }
  if (entity === 'group') {
    controlOffering_(database, row.offering_id);
    if (database.Groups.some(function (item) { return item !== row && item.offering_id === row.offering_id && item.group_number === row.group_number && isActive_(item.active); })) throw schedulerError_('ALREADY_EXISTS', 'The offering already has this group number.');
  }
}
