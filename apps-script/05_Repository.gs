function buildUserSchedule_(userSlug, semesterId, providedDatabase) {
  const database = providedDatabase || loadDatabase_();
  assertDatabaseIntegrity_(database);

  const activeUsers = database.Users.filter(function (row) { return isActive_(row.active); });
  const user = activeUsers.find(function (row) { return row.slug === userSlug; });
  if (!user) throw schedulerError_('USER_NOT_FOUND', 'Unknown or inactive user: ' + userSlug);

  const targetSemesterId = semesterId || SCHEDULER_CONFIG.defaultSemesterId;
  const semester = database.Semesters.find(function (row) {
    return row.semester_id === targetSemesterId && isActive_(row.active);
  });
  if (!semester) throw schedulerError_('SEMESTER_NOT_FOUND', 'Unknown or inactive semester: ' + targetSemesterId);

  const offeringById = {};
  database.Offerings.forEach(function (row) { offeringById[row.offering_id] = row; });
  const subjectById = {};
  database.Subjects.forEach(function (row) { subjectById[row.subject_id] = row; });
  const groupById = {};
  database.Groups.forEach(function (row) { groupById[row.group_id] = row; });

  const enrollments = database.Enrollments.filter(function (row) {
    const offering = offeringById[row.offering_id];
    return row.user_id === user.user_id && isActive_(row.active) && offering &&
      offering.semester_id === semester.semester_id && isActive_(offering.active);
  });
  const enrollmentByOffering = {};
  enrollments.forEach(function (row) { enrollmentByOffering[row.offering_id] = row; });

  const subjects = enrollments.map(function (enrollment) {
    const offering = offeringById[enrollment.offering_id];
    const subject = subjectById[offering.subject_id];
    const selectedGroup = enrollment.group_id ? groupById[enrollment.group_id] : null;
    const availableGroups = database.Groups
      .filter(function (group) { return group.offering_id === offering.offering_id && isActive_(group.active); })
      .map(function (group) { return Number(group.group_number); })
      .sort(function (a, b) { return a - b; });
    return {
      id: subject.subject_id,
      offeringId: offering.offering_id,
      externalCode: offering.external_code,
      name: subject.name,
      shortName: subject.short_name,
      color: subject.color,
      selectedGroup: selectedGroup ? Number(selectedGroup.group_number) : undefined,
      availableGroups: availableGroups,
    };
  }).sort(function (a, b) { return a.name.localeCompare(b.name); });

  const subjectIds = new Set(subjects.map(function (subject) { return subject.id; }));
  const lessonWeeks = {};
  database.LessonWeeks.forEach(function (row) {
    if (!lessonWeeks[row.lesson_id]) lessonWeeks[row.lesson_id] = [];
    lessonWeeks[row.lesson_id].push(Number(row.week));
  });
  const lessonGroups = {};
  database.LessonGroups.forEach(function (row) {
    if (!lessonGroups[row.lesson_id]) lessonGroups[row.lesson_id] = [];
    lessonGroups[row.lesson_id].push(row.group_id);
  });

  const lessons = database.Lessons.filter(function (lesson) {
    if (!isActive_(lesson.active)) return false;
    const offering = offeringById[lesson.offering_id];
    if (!offering || !subjectIds.has(offering.subject_id)) return false;
    const restrictedGroups = lessonGroups[lesson.lesson_id] || [];
    if (!restrictedGroups.length) return true;
    const enrollment = enrollmentByOffering[lesson.offering_id];
    return Boolean(enrollment && enrollment.group_id && restrictedGroups.indexOf(enrollment.group_id) !== -1);
  }).map(function (lesson) {
    const offering = offeringById[lesson.offering_id];
    const restrictedGroups = lessonGroups[lesson.lesson_id] || [];
    const group = restrictedGroups.length ? groupById[restrictedGroups[0]] : null;
    return {
      id: lesson.lesson_id,
      offeringId: offering.offering_id,
      subjectId: offering.subject_id,
      type: lesson.type,
      group: group ? Number(group.group_number) : undefined,
      day: lesson.day,
      startTime: lesson.start_time,
      endTime: lesson.end_time,
      weeks: (lessonWeeks[lesson.lesson_id] || []).sort(function (a, b) { return a - b; }),
      room: lesson.room || undefined,
      format: lesson.format,
      teacher: lesson.teacher,
    };
  });

  const userPreferences = getUserPreferences_(database, user.user_id);
  return {
    users: activeUsers.map(publicUser_).sort(function (a, b) { return a.displayName.localeCompare(b.displayName); }),
    user: publicUser_(user),
    semester: {
      id: semester.semester_id,
      title: semester.title,
      startDate: semester.start_date,
      weeksCount: Number(semester.weeks_count),
    },
    subjects: subjects,
    lessons: lessons,
    revision: getRevisionFromDb_(database),
    preferences: userPreferences.preferences,
    preferencesRevision: userPreferences.preferencesRevision,
    preferencesExists: userPreferences.preferencesExists,
  };
}

function canonicalLessonsForOffering_(database, offeringId) {
  const groups = {};
  database.Groups.forEach(function (row) { groups[row.group_id] = row; });
  const weeks = {};
  database.LessonWeeks.forEach(function (row) {
    if (!weeks[row.lesson_id]) weeks[row.lesson_id] = [];
    weeks[row.lesson_id].push(Number(row.week));
  });
  const lessonGroupNumbers = {};
  database.LessonGroups.forEach(function (row) {
    if (!lessonGroupNumbers[row.lesson_id]) lessonGroupNumbers[row.lesson_id] = [];
    if (groups[row.group_id]) lessonGroupNumbers[row.lesson_id].push(Number(groups[row.group_id].group_number));
  });

  return database.Lessons
    .filter(function (row) { return row.offering_id === offeringId && isActive_(row.active); })
    .map(function (row) {
      const groupNumbers = (lessonGroupNumbers[row.lesson_id] || []).sort(function (a, b) { return a - b; });
      return {
        type: row.type,
        group: groupNumbers.length === 1 ? groupNumbers[0] : (groupNumbers.length ? groupNumbers : undefined),
        day: row.day,
        startTime: row.start_time,
        endTime: row.end_time,
        weeks: (weeks[row.lesson_id] || []).sort(function (a, b) { return a - b; }),
        room: row.room || undefined,
        format: row.format,
        teacher: row.teacher,
      };
    })
    .sort(function (a, b) { return JSON.stringify(a).localeCompare(JSON.stringify(b)); });
}

function canonicalImportedLessons_(lessons) {
  return (lessons || []).map(function (lesson) {
    const result = {
      type: lesson.type,
      group: lesson.group === undefined ? undefined : Number(lesson.group),
      day: lesson.day,
      startTime: lesson.startTime,
      endTime: lesson.endTime,
      weeks: Array.from(new Set(lesson.weeks.map(Number))).sort(function (a, b) { return a - b; }),
      room: lesson.room || undefined,
      format: lesson.format,
      teacher: String(lesson.teacher).trim(),
    };
    return result;
  }).sort(function (a, b) { return JSON.stringify(a).localeCompare(JSON.stringify(b)); });
}
