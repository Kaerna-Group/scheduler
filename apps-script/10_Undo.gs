function removeLessonForUndo_(database, lessonId) {
  database.LessonGroups = database.LessonGroups.filter(function (row) { return row.lesson_id !== lessonId; });
  database.LessonWeeks = database.LessonWeeks.filter(function (row) { return row.lesson_id !== lessonId; });
  database.Lessons = database.Lessons.filter(function (row) { return row.lesson_id !== lessonId; });
}

function restoreLessonForUndo_(database, lessonId, canonical) {
  const lesson = database.Lessons.find(function (row) { return row.lesson_id === lessonId; });
  if (!lesson) throw schedulerError_('UNDO_INTEGRITY_ERROR', 'Cannot restore missing lesson: ' + lessonId);
  lesson.type = canonical.type;
  lesson.day = canonical.day;
  lesson.start_time = canonical.startTime;
  lesson.end_time = canonical.endTime;
  lesson.format = canonical.format;
  lesson.room = canonical.room || '';
  lesson.teacher = canonical.teacher;
  lesson.active = 'yes';

  database.LessonWeeks = database.LessonWeeks.filter(function (row) { return row.lesson_id !== lessonId; });
  (canonical.weeks || []).forEach(function (week) {
    database.LessonWeeks.push({ lesson_id: lessonId, week: String(week) });
  });

  database.LessonGroups = database.LessonGroups.filter(function (row) { return row.lesson_id !== lessonId; });
  const groupNumbers = canonical.group === undefined ? [] : (Array.isArray(canonical.group) ? canonical.group : [canonical.group]);
  groupNumbers.forEach(function (groupNumber) {
    const group = database.Groups.find(function (row) {
      return row.offering_id === lesson.offering_id && Number(row.group_number) === Number(groupNumber);
    });
    if (!group) throw schedulerError_('UNDO_INTEGRITY_ERROR', 'Cannot restore lesson group ' + groupNumber + ' for ' + lessonId);
    database.LessonGroups.push({ lesson_id: lessonId, group_id: group.group_id });
  });
}

function replaceUndoRow_(rows, idField, entityId, previous) {
  const index = rows.findIndex(function (row) { return row[idField] === entityId; });
  if (index === -1) throw schedulerError_('UNDO_INTEGRITY_ERROR', 'Cannot restore missing entity: ' + entityId);
  rows[index] = Object.assign({}, previous);
}

function reverseImportAuditRow_(database, row) {
  const previous = parseAuditValue_(row.old_value);
  if (row.entity_type === 'Lesson') {
    if (row.action === 'CREATE' || row.action === 'REPLACE') {
      removeLessonForUndo_(database, row.entity_id);
      return;
    }
    if (row.action === 'UPDATE' || row.action === 'DEACTIVATE' || row.action === 'EXTEND_WEEKS') {
      restoreLessonForUndo_(database, row.entity_id, previous || {});
      return;
    }
  }

  if (row.entity_type === 'Enrollment') {
    if (row.action === 'ENROLL') {
      database.Enrollments = database.Enrollments.filter(function (item) { return item.enrollment_id !== row.entity_id; });
      return;
    }
    if (row.action === 'UPDATE' || row.action === 'UNENROLL') {
      replaceUndoRow_(database.Enrollments, 'enrollment_id', row.entity_id, previous);
      return;
    }
  }

  if (row.entity_type === 'Group' && row.action === 'CREATE') {
    database.LessonGroups = database.LessonGroups.filter(function (item) { return item.group_id !== row.entity_id; });
    database.Groups = database.Groups.filter(function (item) { return item.group_id !== row.entity_id; });
    return;
  }

  if (row.entity_type === 'Offering' && row.action === 'CREATE') {
    database.Offerings = database.Offerings.filter(function (item) { return item.offering_id !== row.entity_id; });
    return;
  }

  if (row.entity_type === 'Subject') {
    if (row.action === 'CREATE') {
      database.Subjects = database.Subjects.filter(function (item) { return item.subject_id !== row.entity_id; });
      return;
    }
    if (row.action === 'UPDATE') {
      replaceUndoRow_(database.Subjects, 'subject_id', row.entity_id, previous);
      return;
    }
  }

  throw schedulerError_('UNDO_UNSUPPORTED', 'The import contains an unsupported change: ' + row.entity_type + '/' + row.action);
}

function undoLastImport_(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(SCHEDULER_CONFIG.lockTimeoutMs);
  try {
    const database = loadDatabase_();
    const actor = authenticateEditToken_(database, body.editToken);
    requireRole_(actor, ['editor', 'admin']);
    const currentRevision = getRevisionFromDb_(database);
    if (Number(body.baseRevision) !== currentRevision) {
      throw schedulerError_('STALE_DATA', 'Data changed since this page was loaded. Refresh before undoing.', {
        expectedRevision: currentRevision,
        receivedRevision: Number(body.baseRevision),
      });
    }

    const reversible = findLatestReversibleImport_(database);
    if (!reversible.available || !reversible.marker) {
      throw schedulerError_('UNDO_NOT_AVAILABLE', reversible.reason || 'No reversible import was found.');
    }
    const importRevision = reversible.importRevision;
    const metadata = reversible.metadata || {};
    if (actor.role !== 'admin' && metadata.targetUserSlug !== actor.slug) {
      throw schedulerError_('FORBIDDEN', 'Editors may undo only imports made for their own schedule.');
    }
    const auditRows = database.AuditLog.filter(function (row) {
      return Number(row.revision) === importRevision && row.entity_type !== 'Import' && row.entity_type !== 'UserPreferences';
    });
    if (!auditRows.length) throw schedulerError_('UNDO_NOT_AVAILABLE', 'The import has no reversible changes.');

    auditRows.slice().reverse().forEach(function (row) { reverseImportAuditRow_(database, row); });
    assertDatabaseIntegrity_(database);

    const nextRevision = currentRevision + 1;
    setRevisionInDb_(database, nextRevision);
    database.AuditLog.push({
      timestamp: nowIso_(),
      actor_user_id: actor.user_id,
      actor_slug: actor.slug,
      action: 'UNDO_IMPORT',
      entity_type: 'Import',
      entity_id: 'UNDO-IMPORT-' + importRevision,
      old_value: JSON.stringify(metadata),
      new_value: JSON.stringify({
        undoneRevision: importRevision,
        undoRevision: nextRevision,
        targetUserSlug: metadata.targetUserSlug,
        semesterId: metadata.semesterId,
      }),
      revision: String(nextRevision),
    });
    persistDatabase_(database, [
      'Subjects', 'Offerings', 'Groups', 'Enrollments', 'Lessons',
      'LessonGroups', 'LessonWeeks', 'Meta', 'AuditLog',
    ]);

    return {
      revision: nextRevision,
      undoneRevision: importRevision,
      schedule: buildUserSchedule_(metadata.targetUserSlug, metadata.semesterId, database),
    };
  } finally {
    lock.releaseLock();
  }
}
