function findOrCreateGroup_(database, offering, groupNumber, actor, changes) {
  if (groupNumber === undefined || groupNumber === null || groupNumber === '') return null;
  const numericGroup = Number(groupNumber);
  let group = database.Groups.find(function (row) {
    return row.offering_id === offering.offering_id && Number(row.group_number) === numericGroup && isActive_(row.active);
  });
  if (group) return group;

  requireRole_(actor, ['editor', 'admin']);
  group = {
    group_id: newId_('GR'),
    offering_id: offering.offering_id,
    group_number: String(numericGroup),
    label: numericGroup + ' група',
    active: 'yes',
  };
  database.Groups.push(group);
  changes.push({ action: 'CREATE', entityType: 'Group', entityId: group.group_id, oldValue: null, newValue: group });
  return group;
}

function createOfferingFromImport_(database, semester, subjectInput, actor, changes) {
  requireRole_(actor, ['editor', 'admin']);
  const subject = {
    subject_id: newId_('SUB'),
    name: String(subjectInput.name).trim(),
    short_name: String(subjectInput.shortName || subjectInput.name).trim(),
    color: String(subjectInput.color || '#748c8a'),
    active: 'yes',
  };
  const offering = {
    offering_id: newId_('OFF'),
    semester_id: semester.semester_id,
    subject_id: subject.subject_id,
    external_code: String(subjectInput.externalCode).trim(),
    active: 'yes',
  };
  database.Subjects.push(subject);
  database.Offerings.push(offering);
  changes.push({ action: 'CREATE', entityType: 'Subject', entityId: subject.subject_id, oldValue: null, newValue: subject });
  changes.push({ action: 'CREATE', entityType: 'Offering', entityId: offering.offering_id, oldValue: null, newValue: offering });
  return offering;
}

function syncLessons_(database, offering, importedLessons, actor, allowSharedUpdates, changes, conflicts) {
  if (!importedLessons || !importedLessons.length) return;
  const existing = canonicalLessonsForOffering_(database, offering.offering_id);
  const incoming = canonicalImportedLessons_(importedLessons);
  if (JSON.stringify(existing) === JSON.stringify(incoming)) return;

  if (existing.length && (!allowSharedUpdates || ['editor', 'admin'].indexOf(actor.role) === -1)) {
    conflicts.push({
      code: 'COURSE_DATA_CONFLICT',
      externalCode: offering.external_code,
      offeringId: offering.offering_id,
      stored: existing,
      imported: incoming,
    });
    return;
  }
  requireRole_(actor, ['editor', 'admin']);

  const oldLessons = database.Lessons.filter(function (row) {
    return row.offering_id === offering.offering_id && isActive_(row.active);
  });
  oldLessons.forEach(function (row) { row.active = 'no'; });

  importedLessons.forEach(function (lessonInput) {
    const lesson = {
      lesson_id: newId_('LES'),
      offering_id: offering.offering_id,
      type: lessonInput.type,
      day: lessonInput.day,
      start_time: lessonInput.startTime,
      end_time: lessonInput.endTime,
      format: lessonInput.format,
      room: lessonInput.room || '',
      teacher: String(lessonInput.teacher).trim(),
      active: 'yes',
    };
    database.Lessons.push(lesson);
    Array.from(new Set(lessonInput.weeks.map(Number))).sort(function (a, b) { return a - b; }).forEach(function (week) {
      database.LessonWeeks.push({ lesson_id: lesson.lesson_id, week: String(week) });
    });
    if (lessonInput.group !== undefined) {
      const group = findOrCreateGroup_(database, offering, lessonInput.group, actor, changes);
      database.LessonGroups.push({ lesson_id: lesson.lesson_id, group_id: group.group_id });
    }
  });

  changes.push({
    action: existing.length ? 'UPDATE' : 'CREATE',
    entityType: 'OfferingLessons',
    entityId: offering.offering_id,
    oldValue: existing,
    newValue: incoming,
  });
}

function upsertEnrollment_(database, user, offering, group, changes) {
  let enrollment = database.Enrollments.find(function (row) {
    return row.user_id === user.user_id && row.offering_id === offering.offering_id;
  });
  const nextGroupId = group ? group.group_id : '';
  if (!enrollment) {
    enrollment = {
      enrollment_id: newId_('ENR'),
      user_id: user.user_id,
      offering_id: offering.offering_id,
      group_id: nextGroupId,
      active: 'yes',
    };
    database.Enrollments.push(enrollment);
    changes.push({ action: 'ENROLL', entityType: 'Enrollment', entityId: enrollment.enrollment_id, oldValue: null, newValue: enrollment });
    return;
  }

  const previous = Object.assign({}, enrollment);
  enrollment.group_id = nextGroupId;
  enrollment.active = 'yes';
  if (JSON.stringify(previous) !== JSON.stringify(enrollment)) {
    changes.push({ action: 'UPDATE', entityType: 'Enrollment', entityId: enrollment.enrollment_id, oldValue: previous, newValue: enrollment });
  }
}

function appendAuditChanges_(database, actor, changes, revision) {
  changes.forEach(function (change) {
    database.AuditLog.push({
      timestamp: nowIso_(),
      actor_user_id: actor.user_id,
      actor_slug: actor.slug,
      action: change.action,
      entity_type: change.entityType,
      entity_id: change.entityId,
      old_value: change.oldValue === null ? '' : JSON.stringify(change.oldValue),
      new_value: change.newValue === null ? '' : JSON.stringify(change.newValue),
      revision: String(revision),
    });
  });
}

function planPersonalImport_(database, body) {
  const actor = authenticateEditToken_(database, body.editToken);
  const targetUser = resolveWritableUser_(database, actor, body.userSlug);
  const baseRevision = Number(body.baseRevision);
  const currentRevision = getRevisionFromDb_(database);
  if (!Number.isInteger(baseRevision) || baseRevision !== currentRevision) {
    throw schedulerError_('STALE_DATA', 'Data changed since this page was loaded. Refresh before saving.', {
      expectedRevision: currentRevision,
      receivedRevision: baseRevision,
    });
  }

  const semesterId = body.payload && body.payload.semesterId;
  const semester = database.Semesters.find(function (row) {
    return row.semester_id === semesterId && isActive_(row.active);
  });
  if (!semester) throw schedulerError_('SEMESTER_NOT_FOUND', 'Unknown or inactive semester: ' + semesterId);
  validateImportPayload_(body.payload, semester);

  const mode = body.importMode === 'replace' ? 'replace' : 'merge';
  const allowSharedUpdates = body.allowSharedUpdates === true;
  const changes = [];
  const conflicts = [];
  const importedOfferingIds = [];

  body.payload.subjects.forEach(function (subjectInput) {
    const code = String(subjectInput.externalCode).trim();
    let offering = database.Offerings.find(function (row) {
      return row.semester_id === semester.semester_id && row.external_code === code && isActive_(row.active);
    });
    if (!offering) offering = createOfferingFromImport_(database, semester, subjectInput, actor, changes);
    importedOfferingIds.push(offering.offering_id);

    const subject = database.Subjects.find(function (row) { return row.subject_id === offering.subject_id; });
    const incomingName = String(subjectInput.name).trim();
    if (subject.name !== incomingName && !allowSharedUpdates) {
      conflicts.push({
        code: 'COURSE_DATA_CONFLICT', externalCode: code, offeringId: offering.offering_id,
        stored: { name: subject.name }, imported: { name: incomingName },
      });
    } else if (subject.name !== incomingName) {
      requireRole_(actor, ['editor', 'admin']);
      const previous = Object.assign({}, subject);
      subject.name = incomingName;
      subject.short_name = String(subjectInput.shortName || incomingName).trim();
      if (subjectInput.color) subject.color = String(subjectInput.color);
      changes.push({ action: 'UPDATE', entityType: 'Subject', entityId: subject.subject_id, oldValue: previous, newValue: subject });
    }

    const group = findOrCreateGroup_(database, offering, subjectInput.selectedGroup, actor, changes);
    syncLessons_(database, offering, subjectInput.lessons || [], actor, allowSharedUpdates, changes, conflicts);
    upsertEnrollment_(database, targetUser, offering, group, changes);
  });

  if (conflicts.length) {
    throw schedulerError_('COURSE_DATA_CONFLICT', 'Imported shared course data differs from stored data.', conflicts);
  }

  if (mode === 'replace') {
    database.Enrollments.forEach(function (enrollment) {
      const offering = database.Offerings.find(function (row) { return row.offering_id === enrollment.offering_id; });
      if (enrollment.user_id === targetUser.user_id && offering && offering.semester_id === semester.semester_id &&
          isActive_(enrollment.active) && importedOfferingIds.indexOf(enrollment.offering_id) === -1) {
        const previous = Object.assign({}, enrollment);
        enrollment.active = 'no';
        changes.push({ action: 'UNENROLL', entityType: 'Enrollment', entityId: enrollment.enrollment_id, oldValue: previous, newValue: enrollment });
      }
    });
  }

  assertDatabaseIntegrity_(database);
  return { database: database, actor: actor, targetUser: targetUser, semester: semester, changes: changes, currentRevision: currentRevision };
}

function importPersonalSchedule_(body, dryRun) {
  if (dryRun) {
    const planned = planPersonalImport_(loadDatabase_(), body);
    return {
      revision: planned.currentRevision,
      plan: planned.changes,
      user: publicUser_(planned.targetUser),
    };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(SCHEDULER_CONFIG.lockTimeoutMs);
  try {
    const planned = planPersonalImport_(loadDatabase_(), body);
    if (!planned.changes.length) {
      return {
        revision: planned.currentRevision,
        plan: [],
        schedule: buildUserSchedule_(planned.targetUser.slug, planned.semester.semester_id, planned.database),
      };
    }
    const nextRevision = planned.currentRevision + 1;
    setRevisionInDb_(planned.database, nextRevision);
    appendAuditChanges_(planned.database, planned.actor, planned.changes, nextRevision);
    persistDatabase_(planned.database, [
      'Subjects', 'Offerings', 'Groups', 'Enrollments', 'Lessons',
      'LessonGroups', 'LessonWeeks', 'Meta', 'AuditLog',
    ]);
    return {
      revision: nextRevision,
      plan: planned.changes,
      schedule: buildUserSchedule_(planned.targetUser.slug, planned.semester.semester_id, planned.database),
    };
  } finally {
    lock.releaseLock();
  }
}

function updateEnrollments_(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(SCHEDULER_CONFIG.lockTimeoutMs);
  try {
    const database = loadDatabase_();
    const actor = authenticateEditToken_(database, body.editToken);
    const targetUser = resolveWritableUser_(database, actor, body.userSlug);
    const currentRevision = getRevisionFromDb_(database);
    if (Number(body.baseRevision) !== currentRevision) {
      throw schedulerError_('STALE_DATA', 'Data changed since this page was loaded. Refresh before saving.', {
        expectedRevision: currentRevision, receivedRevision: Number(body.baseRevision),
      });
    }
    const semester = database.Semesters.find(function (row) {
      return row.semester_id === body.semesterId && isActive_(row.active);
    });
    if (!semester) throw schedulerError_('SEMESTER_NOT_FOUND', 'Unknown or inactive semester.');
    if (!Array.isArray(body.enrollments)) throw schedulerError_('VALIDATION_ERROR', 'enrollments must be an array.');

    const changes = [];
    const keep = [];
    body.enrollments.forEach(function (input) {
      const offering = database.Offerings.find(function (row) {
        return row.semester_id === semester.semester_id && row.external_code === String(input.externalCode) && isActive_(row.active);
      });
      if (!offering) throw schedulerError_('OFFERING_NOT_FOUND', 'Unknown course code: ' + input.externalCode);
      let group = null;
      if (input.selectedGroup !== undefined) {
        group = database.Groups.find(function (row) {
          return row.offering_id === offering.offering_id && Number(row.group_number) === Number(input.selectedGroup) && isActive_(row.active);
        });
        if (!group) throw schedulerError_('GROUP_NOT_FOUND', 'Unknown group for course ' + input.externalCode + '.');
      }
      keep.push(offering.offering_id);
      upsertEnrollment_(database, targetUser, offering, group, changes);
    });

    database.Enrollments.forEach(function (enrollment) {
      const offering = database.Offerings.find(function (row) { return row.offering_id === enrollment.offering_id; });
      if (enrollment.user_id === targetUser.user_id && offering && offering.semester_id === semester.semester_id &&
          isActive_(enrollment.active) && keep.indexOf(enrollment.offering_id) === -1) {
        const previous = Object.assign({}, enrollment);
        enrollment.active = 'no';
        changes.push({ action: 'UNENROLL', entityType: 'Enrollment', entityId: enrollment.enrollment_id, oldValue: previous, newValue: enrollment });
      }
    });

    assertDatabaseIntegrity_(database);
    if (!changes.length) {
      return {
        revision: currentRevision,
        schedule: buildUserSchedule_(targetUser.slug, semester.semester_id, database),
      };
    }
    const nextRevision = currentRevision + 1;
    setRevisionInDb_(database, nextRevision);
    appendAuditChanges_(database, actor, changes, nextRevision);
    persistDatabase_(database, ['Enrollments', 'Meta', 'AuditLog']);
    return {
      revision: nextRevision,
      schedule: buildUserSchedule_(targetUser.slug, semester.semester_id, database),
    };
  } finally {
    lock.releaseLock();
  }
}
