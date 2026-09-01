function assertUnique_(rows, field, tableName) {
  const seen = {};
  rows.forEach(function (row) {
    const value = String(row[field]);
    if (!value) throw schedulerError_('INTEGRITY_ERROR', tableName + '.' + field + ' cannot be empty.');
    if (seen[value]) throw schedulerError_('INTEGRITY_ERROR', tableName + '.' + field + ' must be unique: ' + value);
    seen[value] = true;
  });
}

function assertDatabaseIntegrity_(database) {
  assertUnique_(database.Users, 'user_id', 'Users');
  assertUnique_(database.Users, 'slug', 'Users');
  assertUnique_(database.UserPreferences, 'user_id', 'UserPreferences');
  assertUnique_(database.Semesters, 'semester_id', 'Semesters');
  assertUnique_(database.Subjects, 'subject_id', 'Subjects');
  assertUnique_(database.Offerings, 'offering_id', 'Offerings');
  assertUnique_(database.Groups, 'group_id', 'Groups');
  assertUnique_(database.Enrollments, 'enrollment_id', 'Enrollments');
  assertUnique_(database.Lessons, 'lesson_id', 'Lessons');

  const userIds = new Set(database.Users.map(function (row) { return row.user_id; }));
  const semesterIds = new Set(database.Semesters.map(function (row) { return row.semester_id; }));
  const subjectIds = new Set(database.Subjects.map(function (row) { return row.subject_id; }));
  const offeringIds = new Set(database.Offerings.map(function (row) { return row.offering_id; }));
  const groupIds = new Set(database.Groups.map(function (row) { return row.group_id; }));
  const lessonIds = new Set(database.Lessons.map(function (row) { return row.lesson_id; }));
  const preferenceUserIds = new Set(database.UserPreferences.map(function (row) { return row.user_id; }));

  database.Users.forEach(function (row) {
    if (ALLOWED_ROLES.indexOf(row.role) === -1) throw schedulerError_('INTEGRITY_ERROR', 'Invalid role for ' + row.slug);
    if (!preferenceUserIds.has(row.user_id)) throw schedulerError_('INTEGRITY_ERROR', 'UserPreferences is missing user: ' + row.user_id);
  });

  database.UserPreferences.forEach(function (row) {
    if (!userIds.has(row.user_id)) throw schedulerError_('INTEGRITY_ERROR', 'UserPreferences has unknown user: ' + row.user_id);
    validatePreferenceRow_(row);
  });

  const offeringKeys = {};
  database.Offerings.forEach(function (row) {
    if (!semesterIds.has(row.semester_id) || !subjectIds.has(row.subject_id)) {
      throw schedulerError_('INTEGRITY_ERROR', 'Offering has a broken foreign key: ' + row.offering_id);
    }
    const key = row.semester_id + '|' + row.external_code;
    if (offeringKeys[key]) throw schedulerError_('INTEGRITY_ERROR', 'Duplicate semester + external_code: ' + key);
    offeringKeys[key] = true;
  });

  database.Groups.forEach(function (row) {
    if (!offeringIds.has(row.offering_id)) throw schedulerError_('INTEGRITY_ERROR', 'Group has unknown offering: ' + row.group_id);
    const number = Number(row.group_number);
    if (!Number.isInteger(number) || number < 1) throw schedulerError_('INTEGRITY_ERROR', 'Invalid group number: ' + row.group_id);
  });

  const enrollmentKeys = {};
  database.Enrollments.forEach(function (row) {
    if (!userIds.has(row.user_id) || !offeringIds.has(row.offering_id)) {
      throw schedulerError_('INTEGRITY_ERROR', 'Enrollment has a broken foreign key: ' + row.enrollment_id);
    }
    if (row.group_id) {
      const group = database.Groups.find(function (item) { return item.group_id === row.group_id; });
      if (!group || group.offering_id !== row.offering_id) {
        throw schedulerError_('INTEGRITY_ERROR', 'Enrollment group belongs to another offering: ' + row.enrollment_id);
      }
    }
    const key = row.user_id + '|' + row.offering_id;
    if (isActive_(row.active) && enrollmentKeys[key]) throw schedulerError_('INTEGRITY_ERROR', 'Duplicate active enrollment: ' + key);
    if (isActive_(row.active)) enrollmentKeys[key] = true;
  });

  database.Lessons.forEach(function (row) {
    if (!offeringIds.has(row.offering_id)) throw schedulerError_('INTEGRITY_ERROR', 'Lesson has unknown offering: ' + row.lesson_id);
    if (ALLOWED_LESSON_TYPES.indexOf(row.type) === -1) throw schedulerError_('INTEGRITY_ERROR', 'Invalid lesson type: ' + row.lesson_id);
    if (ALLOWED_DAYS.indexOf(row.day) === -1) throw schedulerError_('INTEGRITY_ERROR', 'Invalid lesson day: ' + row.lesson_id);
    if (ALLOWED_FORMATS.indexOf(row.format) === -1) throw schedulerError_('INTEGRITY_ERROR', 'Invalid lesson format: ' + row.lesson_id);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(row.start_time) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.end_time) || row.start_time >= row.end_time) {
      throw schedulerError_('INTEGRITY_ERROR', 'Invalid lesson time: ' + row.lesson_id);
    }
  });

  database.LessonGroups.forEach(function (row) {
    if (!lessonIds.has(row.lesson_id) || !groupIds.has(row.group_id)) {
      throw schedulerError_('INTEGRITY_ERROR', 'LessonGroups has a broken foreign key.');
    }
    const lesson = database.Lessons.find(function (item) { return item.lesson_id === row.lesson_id; });
    const group = database.Groups.find(function (item) { return item.group_id === row.group_id; });
    if (lesson.offering_id !== group.offering_id) {
      throw schedulerError_('INTEGRITY_ERROR', 'Lesson group belongs to another offering: ' + row.lesson_id);
    }
  });

  database.LessonWeeks.forEach(function (row) {
    if (!lessonIds.has(row.lesson_id)) throw schedulerError_('INTEGRITY_ERROR', 'LessonWeeks has unknown lesson.');
    const lesson = database.Lessons.find(function (item) { return item.lesson_id === row.lesson_id; });
    const offering = database.Offerings.find(function (item) { return item.offering_id === lesson.offering_id; });
    const semester = database.Semesters.find(function (item) { return item.semester_id === offering.semester_id; });
    const week = Number(row.week);
    if (!Number.isInteger(week) || week < 1 || week > Number(semester.weeks_count)) {
      throw schedulerError_('INTEGRITY_ERROR', 'Lesson week is outside its semester: ' + row.lesson_id + '/' + row.week);
    }
  });
}

function validateImportPayload_(payload, semester) {
  const errors = [];
  if (!payload || typeof payload !== 'object') errors.push('payload must be an object.');
  if (payload && payload.schemaVersion !== 1) errors.push('schemaVersion must equal 1.');
  if (payload && payload.semesterId !== semester.semester_id) errors.push('semesterId does not match the target semester.');
  if (!payload || !Array.isArray(payload.subjects)) errors.push('subjects must be an array.');

  const codes = {};
  if (payload && Array.isArray(payload.subjects)) {
    payload.subjects.forEach(function (subject, subjectIndex) {
      const prefix = 'subjects[' + subjectIndex + ']';
      if (!subject || typeof subject !== 'object') {
        errors.push(prefix + ' must be an object.');
        return;
      }
      const code = String(subject.externalCode || '').trim();
      if (!code) errors.push(prefix + '.externalCode is required.');
      if (codes[code]) errors.push(prefix + '.externalCode is duplicated.');
      codes[code] = true;
      if (!String(subject.name || '').trim()) errors.push(prefix + '.name is required.');
      if (subject.selectedGroup !== undefined && (!Number.isInteger(Number(subject.selectedGroup)) || Number(subject.selectedGroup) < 1)) {
        errors.push(prefix + '.selectedGroup must be a positive integer.');
      }
      if (subject.lessons !== undefined && !Array.isArray(subject.lessons)) errors.push(prefix + '.lessons must be an array.');

      (subject.lessons || []).forEach(function (lesson, lessonIndex) {
        const lessonPrefix = prefix + '.lessons[' + lessonIndex + ']';
        if (ALLOWED_LESSON_TYPES.indexOf(lesson.type) === -1) errors.push(lessonPrefix + '.type is invalid.');
        if (ALLOWED_DAYS.indexOf(lesson.day) === -1) errors.push(lessonPrefix + '.day is invalid.');
        if (ALLOWED_FORMATS.indexOf(lesson.format) === -1) errors.push(lessonPrefix + '.format is invalid.');
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(lesson.startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(lesson.endTime) || lesson.startTime >= lesson.endTime) {
          errors.push(lessonPrefix + ' has invalid time.');
        }
        if (!String(lesson.teacher || '').trim()) errors.push(lessonPrefix + '.teacher is required.');
        if (lesson.type === 'group' && (!Number.isInteger(Number(lesson.group)) || Number(lesson.group) < 1)) {
          errors.push(lessonPrefix + '.group is required for group lessons.');
        }
        if (!Array.isArray(lesson.weeks) || !lesson.weeks.length) errors.push(lessonPrefix + '.weeks must not be empty.');
        (lesson.weeks || []).forEach(function (week) {
          if (!Number.isInteger(Number(week)) || Number(week) < 1 || Number(week) > Number(semester.weeks_count)) {
            errors.push(lessonPrefix + '.weeks contains an out-of-range value.');
          }
        });
      });
    });
  }

  if (errors.length) throw schedulerError_('VALIDATION_ERROR', 'Import validation failed.', errors);
}
