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
    label: 'Group ' + numericGroup,
    active: 'yes',
  };
  database.Groups.push(group);
  changes.push({ action: 'CREATE', entityType: 'Group', entityId: group.group_id, externalCode: offering.external_code, oldValue: null, newValue: group });
  return group;
}

function createOfferingFromImport_(database, semester, subjectInput, actor, changes) {
  requireRole_(actor, ['editor', 'admin']);
  // Codes identify offerings, not subject cards. Reuse a unique same-name
  // subject in this semester; historical semester copies remain independent.
  const semesterSubjects = new Set(database.Offerings.filter(function (row) {
    return row.semester_id === semester.semester_id && isActive_(row.active);
  }).map(function (row) { return row.subject_id; }));
  const referencedSubjects = new Set(database.Offerings.map(function (row) { return row.subject_id; }));
  const name = normalizedSubjectName_(subjectInput.name);
  const candidates = database.Subjects.filter(function (row) {
    return isActive_(row.active) && normalizedSubjectName_(row.name) === name &&
      (semesterSubjects.has(row.subject_id) || !referencedSubjects.has(row.subject_id));
  });
  if (candidates.length > 1) throw schedulerError_('AMBIGUOUS_SUBJECT', 'Merge the existing duplicate subject cards before importing another course code.', { subjectIds: candidates.map(function (row) { return row.subject_id; }) });
  const subject = candidates[0] || {
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
  if (!candidates.length) {
    database.Subjects.push(subject);
    changes.push({ action: 'CREATE', entityType: 'Subject', entityId: subject.subject_id, externalCode: offering.external_code, oldValue: null, newValue: subject });
  }
  database.Offerings.push(offering);
  changes.push({ action: 'CREATE', entityType: 'Offering', entityId: offering.offering_id, externalCode: offering.external_code, oldValue: null, newValue: offering });
  return offering;
}

function storedLessonViews_(database, offeringId) {
  const groupById = {};
  database.Groups.forEach(function (row) { groupById[row.group_id] = row; });

  return database.Lessons
    .filter(function (row) { return row.offering_id === offeringId && isActive_(row.active); })
    .map(function (row) {
      const groupNumbers = database.LessonGroups
        .filter(function (link) { return link.lesson_id === row.lesson_id && groupById[link.group_id]; })
        .map(function (link) { return Number(groupById[link.group_id].group_number); })
        .sort(function (a, b) { return a - b; });
      const weeks = database.LessonWeeks
        .filter(function (link) { return link.lesson_id === row.lesson_id; })
        .map(function (link) { return Number(link.week); })
        .sort(function (a, b) { return a - b; });
      return {
        lessonId: row.lesson_id,
        row: row,
        canonical: {
          type: row.type,
          group: groupNumbers.length === 1 ? groupNumbers[0] : (groupNumbers.length ? groupNumbers : undefined),
          day: row.day,
          startTime: row.start_time,
          endTime: row.end_time,
          weeks: weeks,
          room: row.room || undefined,
          format: row.format,
          teacher: row.teacher,
        },
      };
    });
}

function normalizeImportedLessonForSync_(lesson) {
  return {
    id: typeof lesson.id === 'string' ? lesson.id : undefined,
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
}

function lessonRuleSignature_(lesson) {
  return JSON.stringify({
    type: lesson.type,
    group: lesson.group,
    day: lesson.day,
    startTime: lesson.startTime,
    endTime: lesson.endTime,
    room: lesson.room,
    format: lesson.format,
    teacher: lesson.teacher,
  });
}

function lessonWeeksOverlap_(first, second) {
  return first.some(function (week) { return second.indexOf(week) !== -1; });
}

function lessonTimesOverlap_(first, second) {
  return first.startTime < second.endTime && second.startTime < first.endTime;
}

function lessonRulesConflict_(stored, imported) {
  if (imported.id && imported.id === stored.lessonId) {
    return lessonRuleSignature_(stored.canonical) !== lessonRuleSignature_(imported) ||
      JSON.stringify(stored.canonical.weeks) !== JSON.stringify(imported.weeks);
  }
  return stored.canonical.type === imported.type &&
    JSON.stringify(stored.canonical.group) === JSON.stringify(imported.group) &&
    stored.canonical.day === imported.day &&
    lessonWeeksOverlap_(stored.canonical.weeks, imported.weeks) &&
    lessonTimesOverlap_(stored.canonical, imported);
}

function appendImportedLesson_(database, offering, lessonInput, actor, changes, replacedLessons) {
  requireRole_(actor, ['editor', 'admin']);
  const lesson = {
    lesson_id: newId_('LES'),
    offering_id: offering.offering_id,
    type: lessonInput.type,
    day: lessonInput.day,
    start_time: lessonInput.startTime,
    end_time: lessonInput.endTime,
    format: lessonInput.format,
    room: lessonInput.room || '',
    teacher: lessonInput.teacher,
    active: 'yes',
  };
  database.Lessons.push(lesson);
  lessonInput.weeks.forEach(function (week) {
    database.LessonWeeks.push({ lesson_id: lesson.lesson_id, week: String(week) });
  });
  if (lessonInput.group !== undefined) {
    const group = findOrCreateGroup_(database, offering, lessonInput.group, actor, changes);
    database.LessonGroups.push({ lesson_id: lesson.lesson_id, group_id: group.group_id });
  }
  changes.push({
    action: replacedLessons && replacedLessons.length ? 'REPLACE' : 'CREATE', entityType: 'Lesson', entityId: lesson.lesson_id,
    externalCode: offering.external_code,
    oldValue: replacedLessons && replacedLessons.length ? replacedLessons.map(function (item) { return item.canonical; }) : null,
    newValue: lessonInput,
  });
}

function removeConflictingLessonWeeks_(database, offering, stored, imported, changes) {
  const removeEveryWeek = imported.id && imported.id === stored.lessonId;
  const removedWeeks = removeEveryWeek
    ? stored.canonical.weeks
    : stored.canonical.weeks.filter(function (week) { return imported.weeks.indexOf(week) !== -1; });
  database.LessonWeeks = database.LessonWeeks.filter(function (link) {
    return link.lesson_id !== stored.lessonId || removedWeeks.indexOf(Number(link.week)) === -1;
  });
  const remainingWeeks = stored.canonical.weeks.filter(function (week) { return removedWeeks.indexOf(week) === -1; });
  if (!remainingWeeks.length) stored.row.active = 'no';
  changes.push({
    action: remainingWeeks.length ? 'UPDATE' : 'DEACTIVATE',
    entityType: 'Lesson',
    entityId: stored.lessonId,
    externalCode: offering.external_code,
    partOfReplacement: true,
    oldValue: stored.canonical,
    newValue: remainingWeeks.length ? Object.assign({}, stored.canonical, { weeks: remainingWeeks }) : null,
  });
}

function syncLessons_(database, offering, importedLessons, actor, sharedResolution, changes, conflicts) {
  if (!importedLessons || !importedLessons.length) return;

  importedLessons.map(normalizeImportedLessonForSync_).forEach(function (incoming) {
    const stored = storedLessonViews_(database, offering.offering_id);
    const sameRule = stored.find(function (item) {
      return lessonRuleSignature_(item.canonical) === lessonRuleSignature_(incoming);
    });

    if (sameRule) {
      const missingWeeks = incoming.weeks.filter(function (week) {
        return sameRule.canonical.weeks.indexOf(week) === -1;
      });
      if (missingWeeks.length) {
        requireRole_(actor, ['editor', 'admin']);
        missingWeeks.forEach(function (week) {
          database.LessonWeeks.push({ lesson_id: sameRule.lessonId, week: String(week) });
        });
        changes.push({
          action: 'EXTEND_WEEKS', entityType: 'Lesson', entityId: sameRule.lessonId,
          externalCode: offering.external_code,
          oldValue: sameRule.canonical,
          newValue: Object.assign({}, sameRule.canonical, {
            weeks: sameRule.canonical.weeks.concat(missingWeeks).sort(function (a, b) { return a - b; }),
          }),
        });
      }
      return;
    }

    const incompatible = stored.filter(function (item) { return lessonRulesConflict_(item, incoming); });
    const applySharedUpdate = sharedResolution === true || sharedResolution === 'apply';
    const keepStored = sharedResolution === 'keep';
    if (incompatible.length) {
      conflicts.push({
        code: 'COURSE_DATA_CONFLICT',
        kind: 'lesson',
        externalCode: offering.external_code,
        offeringId: offering.offering_id,
        resolution: applySharedUpdate ? 'apply' : (keepStored ? 'keep' : undefined),
        stored: incompatible.map(function (item) { return item.canonical; }),
        imported: incoming,
      });
      if (!applySharedUpdate) return;
    }

    if (incompatible.length) {
      requireRole_(actor, ['editor', 'admin']);
      incompatible.forEach(function (item) {
        removeConflictingLessonWeeks_(database, offering, item, incoming, changes);
      });
    }
    appendImportedLesson_(database, offering, incoming, actor, changes, incompatible);
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
    changes.push({ action: 'ENROLL', entityType: 'Enrollment', entityId: enrollment.enrollment_id, externalCode: offering.external_code, oldValue: null, newValue: enrollment });
    return;
  }

  const previous = Object.assign({}, enrollment);
  enrollment.group_id = nextGroupId;
  enrollment.active = 'yes';
  if (JSON.stringify(previous) !== JSON.stringify(enrollment)) {
    changes.push({ action: 'UPDATE', entityType: 'Enrollment', entityId: enrollment.enrollment_id, externalCode: offering.external_code, oldValue: previous, newValue: enrollment });
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

function sharedResolutionFor_(body, externalCode) {
  const resolutions = body.sharedConflictResolutions;
  if (resolutions && typeof resolutions === 'object') {
    const resolution = resolutions[externalCode];
    if (resolution === 'apply' || resolution === 'keep') return resolution;
  }
  return undefined;
}

function planPersonalImport_(database, body, allowUnresolvedConflicts) {
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
    const sharedResolution = sharedResolutionFor_(body, code);

    const subject = database.Subjects.find(function (row) { return row.subject_id === offering.subject_id; });
    const incomingName = String(subjectInput.name).trim();
    if (normalizedSubjectName_(subject.name) !== normalizedSubjectName_(incomingName)) {
      conflicts.push({
        code: 'COURSE_DATA_CONFLICT', kind: 'subject', externalCode: code, offeringId: offering.offering_id,
        resolution: sharedResolution,
        stored: { name: subject.name }, imported: { name: incomingName },
      });
      if (sharedResolution === 'apply') {
        requireRole_(actor, ['editor', 'admin']);
        const previous = Object.assign({}, subject);
        subject.name = incomingName;
        subject.short_name = String(subjectInput.shortName || incomingName).trim();
        if (subjectInput.color) subject.color = String(subjectInput.color);
        changes.push({ action: 'UPDATE', entityType: 'Subject', entityId: subject.subject_id, externalCode: code, oldValue: previous, newValue: subject });
      }
    }

    const group = findOrCreateGroup_(database, offering, subjectInput.selectedGroup, actor, changes);
    syncLessons_(database, offering, subjectInput.lessons || [], actor, sharedResolution, changes, conflicts);
    upsertEnrollment_(database, targetUser, offering, group, changes);
  });

  const unresolvedConflicts = conflicts.filter(function (conflict) { return !conflict.resolution; });
  if (unresolvedConflicts.length && !allowUnresolvedConflicts) {
    throw schedulerError_('COURSE_DATA_CONFLICT', 'Imported shared course data differs from stored data.', unresolvedConflicts);
  }

  if (mode === 'replace') {
    database.Enrollments.forEach(function (enrollment) {
      const offering = database.Offerings.find(function (row) { return row.offering_id === enrollment.offering_id; });
      if (enrollment.user_id === targetUser.user_id && offering && offering.semester_id === semester.semester_id &&
          isActive_(enrollment.active) && importedOfferingIds.indexOf(enrollment.offering_id) === -1) {
        const previous = Object.assign({}, enrollment);
        enrollment.active = 'no';
        changes.push({ action: 'UNENROLL', entityType: 'Enrollment', entityId: enrollment.enrollment_id, externalCode: offering.external_code, oldValue: previous, newValue: enrollment });
      }
    });
  }

  assertDatabaseIntegrity_(database);
  return { database: database, actor: actor, targetUser: targetUser, semester: semester, changes: changes, conflicts: conflicts, currentRevision: currentRevision };
}

function importPersonalSchedule_(body, dryRun) {
  if (dryRun) {
    const planned = planPersonalImport_(loadDatabase_(), body, true);
    return {
      revision: planned.currentRevision,
      plan: planned.changes,
      conflicts: planned.conflicts,
      user: publicUser_(planned.targetUser),
    };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(SCHEDULER_CONFIG.lockTimeoutMs);
  try {
    const planned = planPersonalImport_(loadDatabase_(), body, false);
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
    planned.database.AuditLog.push({
      timestamp: nowIso_(),
      actor_user_id: planned.actor.user_id,
      actor_slug: planned.actor.slug,
      action: 'IMPORT',
      entity_type: 'Import',
      entity_id: 'IMPORT-' + nextRevision,
      old_value: JSON.stringify({ baseRevision: planned.currentRevision }),
      new_value: JSON.stringify({
        revision: nextRevision,
        targetUserSlug: planned.targetUser.slug,
        semesterId: planned.semester.semester_id,
        importMode: body.importMode === 'replace' ? 'replace' : 'merge',
        changeCount: planned.changes.length,
      }),
      revision: String(nextRevision),
    });
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
