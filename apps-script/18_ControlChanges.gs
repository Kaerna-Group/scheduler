function controlCanonical_(value) {
  if (Array.isArray(value)) return '[' + value.map(controlCanonical_).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(function (key) { return JSON.stringify(key) + ':' + controlCanonical_(value[key]); }).join(',') + '}';
  return JSON.stringify(value);
}

function controlFingerprint_(database) {
  const values = {};
  CONTROL_TABLES.forEach(function (table) { values[table] = database[table].map(controlCanonical_).sort(); });
  values.users = database.Users.map(function (row) { return controlCanonical_({ id: row.user_id, slug: row.slug, displayName: row.display_name, active: isActive_(row.active) }); }).sort();
  values.currentSemester = getCurrentSemesterId_(database);
  return hashEditToken_(controlCanonical_(values));
}

function controlKey_(table, row) {
  return table === 'Meta' ? row.key : table === 'LessonWeeks' ? row.lesson_id + ':' + row.week : table === 'LessonGroups' ? row.lesson_id + ':' + row.group_id : row[CONTROL_KEYS[table]];
}

function controlDiff_(before, after) {
  const changes = [];
  CONTROL_TABLES.concat(['Meta']).forEach(function (table) {
    const previous = new Map();
    const next = new Map();
    function add(rows, target) { rows.forEach(function (row) {
      if (table === 'Meta' && row.key !== 'current_semester_id') return;
      const key = controlKey_(table, row);
      if (target.has(key)) throw schedulerError_('INTEGRITY_ERROR', 'Duplicate relation in ' + table);
      target.set(key, row);
    }); }
    add(before[table], previous); add(after[table], next);
    Array.from(new Set(Array.from(previous.keys()).concat(Array.from(next.keys())))).sort().forEach(function (key) {
      const oldValue = previous.get(key) || null;
      const newValue = next.get(key) || null;
      if (controlCanonical_(oldValue) !== controlCanonical_(newValue)) changes.push({ table: table, key: key, before: oldValue, after: newValue });
    });
  });
  return changes;
}

function controlPatch_(database, changes, reverse) {
  changes.forEach(function (change) {
    if (CONTROL_TABLES.indexOf(change.table) === -1 && !(change.table === 'Meta' && change.key === 'current_semester_id')) throw schedulerError_('FORBIDDEN', 'The saved plan contains a forbidden table.');
    const oldValue = reverse ? change.after : change.before;
    const newValue = reverse ? change.before : change.after;
    const rows = database[change.table];
    const index = rows.findIndex(function (row) { return controlKey_(change.table, row) === change.key; });
    if (controlCanonical_(index === -1 ? null : rows[index]) !== controlCanonical_(oldValue)) throw schedulerError_('STALE_DATA', 'A planned record has changed. Prepare a new plan.');
    if (newValue && controlKey_(change.table, newValue) !== change.key) throw schedulerError_('PLAN_INVALID', 'The saved record key is inconsistent.');
    if (newValue) {
      const copy = JSON.parse(JSON.stringify(newValue));
      if (index === -1) rows.push(copy); else rows[index] = copy;
    } else if (index !== -1) rows.splice(index, 1);
  });
}

function controlScheduleView_(database, user, semesterId) {
  const schedule = buildUserSchedule_(user.slug, semesterId, database);
  return { semester: schedule.semester, subjects: schedule.subjects.slice().sort(function (a, b) { return a.offeringId.localeCompare(b.offeringId); }),
    lessons: schedule.lessons.slice().sort(function (a, b) { return a.id.localeCompare(b.id); }) };
}

function controlAffectedUsers_(before, after) {
  const checks = [];
  after.Users.filter(function (user) { return isActive_(user.active); }).forEach(function (user) {
    const semesters = new Set(before.Semesters.concat(after.Semesters).map(function (row) { return row.semester_id; }));
    semesters.forEach(function (semesterId) {
      const next = after.Semesters.some(function (row) { return row.semester_id === semesterId; }) ? controlScheduleView_(after, user, semesterId) : null;
      const previous = before.Semesters.some(function (row) { return row.semester_id === semesterId; }) ? controlScheduleView_(before, user, semesterId) : null;
      const expectedHash = next ? hashEditToken_(controlCanonical_(next)) : null;
      if (expectedHash !== (previous ? hashEditToken_(controlCanonical_(previous)) : null)) checks.push({ user: controlUser_(user), semesterId: semesterId,
        expectedHash: expectedHash, lessonCount: next ? next.lessons.length : 0 });
    });
  });
  return checks;
}

function controlConflicts_(database) {
  const conflicts = [];
  database.Semesters.filter(function (row) { return isActive_(row.active); }).forEach(function (semester) {
    const offerings = new Set(database.Offerings.filter(function (row) { return row.semester_id === semester.semester_id && isActive_(row.active); }).map(function (row) { return row.offering_id; }));
    const lessons = database.Lessons.filter(function (row) { return isActive_(row.active) && offerings.has(row.offering_id); }).map(function (row) { return controlLessonDto_(database, row); });
    const attendees = new Map();
    lessons.forEach(function (lesson) {
      const users = new Set(database.Enrollments.filter(function (row) { return row.offering_id === lesson.offeringId && isActive_(row.active) && (!lesson.groupIds.length || lesson.groupIds.indexOf(row.group_id) !== -1); }).map(function (row) { return row.user_id; }));
      attendees.set(lesson.lessonId, database.Users.filter(function (row) { return isActive_(row.active) && users.has(row.user_id); }).map(function (row) { return row.user_id; }));
    });
    lessons.forEach(function (first, index) {
      lessons.slice(index + 1).forEach(function (second) {
        if (first.day !== second.day || first.startTime >= second.endTime || second.startTime >= first.endTime) return;
        const weeks = first.weeks.filter(function (week) { return second.weeks.indexOf(week) !== -1; });
        if (!weeks.length) return;
        const userIds = attendees.get(first.lessonId).filter(function (id) { return attendees.get(second.lessonId).indexOf(id) !== -1; }).sort();
        const sameTeacher = Boolean(first.teacher.trim()) && first.teacher.trim().toLowerCase() === second.teacher.trim().toLowerCase();
        const sameRoom = first.format !== 'online' && second.format !== 'online' && Boolean(first.room.trim()) && first.room.trim().toLowerCase() === second.room.trim().toLowerCase();
        if (userIds.length || sameTeacher || sameRoom) conflicts.push({ semesterId: semester.semester_id, lessonIds: [first.lessonId, second.lessonId].sort(), weeks: weeks,
          userIds: userIds, teacher: sameTeacher ? first.teacher : null, room: sameRoom ? first.room : null });
      });
    });
  });
  return conflicts;
}

function controlPacked_(value) {
  const text = JSON.stringify(value);
  if (Utilities.newBlob(text).getBytes().length > 40000) throw schedulerError_('PLAN_TOO_LARGE', 'The plan exceeds the 40 KB storage limit. Split the request into smaller reviewed changes.');
  return text;
}

function controlStored_(text) {
  try {
    const stored = JSON.parse(text);
    if (stored.format !== 1 || stored.checksum !== hashEditToken_(controlCanonical_(stored.plan))) throw new Error('Invalid checksum');
    return stored.plan;
  } catch (ignored) { throw schedulerError_('PLAN_INVALID', 'The stored plan is corrupt or incompatible.'); }
}

function controlPublicPlan_(plan) {
  return { planId: plan.planId, baseRevision: plan.baseRevision, expiresAt: plan.expiresAt, initiator: plan.initiator, reason: plan.reason,
    commands: plan.commands, changes: plan.changes, affectedUsers: plan.userChecks.map(function (check) { return { user: check.user, semesterId: check.semesterId, lessonCount: check.lessonCount }; }),
    conflicts: plan.conflicts, requiresConfirmation: plan.confirmationReasons.length > 0, confirmationReasons: plan.confirmationReasons };
}

function controlPlan_(database, actor, body) {
  controlRequireScope_(actor, 'catalog:read');
  controlRequireScope_(actor, 'users:read');
  const initiator = controlText_(body.initiator, 'initiator', false);
  const reason = body.reason === undefined ? '' : controlText_(body.reason, 'reason', true);
  if (!Array.isArray(body.commands) || !body.commands.length || body.commands.length > 30) throw schedulerError_('VALIDATION_ERROR', 'Provide 1–30 commands.');
  const scopes = Array.from(new Set(body.commands.map(controlCommandScope_)));
  scopes.forEach(function (scope) { controlRequireScope_(actor, scope); });
  const next = JSON.parse(JSON.stringify(database));
  let undoOperationId = null;
  body.commands.forEach(function (command) {
    if (command.type === 'changes.undo') {
      controlObject_(command, ['type', 'operationId'], ['operationId']);
      if (body.commands.length !== 1) throw schedulerError_('VALIDATION_ERROR', 'Undo must be planned by itself.');
      const operation = controlOperation_(readControlTable_('ControlOperations'), actor, command.operationId);
      const original = controlStored_(operation.record_json);
      const result = JSON.parse(operation.result_json);
      if (getRevisionFromDb_(database) !== result.revision || controlFingerprint_(database) !== original.expectedFingerprint) throw schedulerError_('UNDO_NOT_AVAILABLE', 'Only an unchanged latest schedule operation belonging to this integration can be undone.');
      original.scopes.forEach(function (scope) { controlRequireScope_(actor, scope); if (scopes.indexOf(scope) === -1) scopes.push(scope); });
      controlPatch_(next, original.changes, true);
      undoOperationId = command.operationId;
    } else controlRunCommand_(next, command);
  });
  assertDatabaseIntegrity_(next);
  const changes = controlDiff_(database, next);
  if (!changes.length) throw schedulerError_('NO_CHANGES', 'The commands do not change the database.');
  const previousConflicts = new Set(controlConflicts_(database).map(controlCanonical_));
  const conflicts = controlConflicts_(next).filter(function (conflict) { return !previousConflicts.has(controlCanonical_(conflict)); });
  const confirmationReasons = [];
  if (body.commands.some(function (command) { return command.type === 'subject.merge'; })) confirmationReasons.push('SUBJECT_MERGE');
  if (body.commands.some(function (command) { return command.type === 'semester.archive'; })) confirmationReasons.push('SEMESTER_ARCHIVE');
  if (body.commands.filter(function (command) { return /\.(archive|cancel|remove)$/.test(command.type); }).length > 1) confirmationReasons.push('BULK_REMOVAL');
  // Undo can remove several newly created records with one typed command.
  // Its destructive size must be judged from the saved changes as well.
  if (changes.filter(function (change) { return CONTROL_KEYS[change.table] && change.before && !change.after; }).length > 1 &&
      confirmationReasons.indexOf('BULK_REMOVAL') === -1) confirmationReasons.push('BULK_REMOVAL');
  if (body.commands.some(function (command) {
    return command.type === 'offering.archive' && (database.Lessons.filter(function (row) { return row.offering_id === command.id && isActive_(row.active); }).length > 1 ||
      database.Enrollments.filter(function (row) { return row.offering_id === command.id && isActive_(row.active); }).length > 1);
  }) && confirmationReasons.indexOf('BULK_REMOVAL') === -1) confirmationReasons.push('BULK_REMOVAL');
  if (conflicts.length) confirmationReasons.push('SCHEDULE_CONFLICTS');
  const plan = { planId: newId_('PLAN'), integrationId: actor.id, scopes: scopes, initiator: initiator, reason: reason,
    baseRevision: getRevisionFromDb_(database), baseFingerprint: controlFingerprint_(database), expectedFingerprint: controlFingerprint_(next),
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(), commands: body.commands, changes: changes,
    userChecks: controlAffectedUsers_(database, next), conflicts: conflicts, confirmationReasons: confirmationReasons, undoOperationId: undoOperationId };
  const serialized = controlPacked_({ format: 1, checksum: hashEditToken_(controlCanonical_(plan)), plan: plan });
  // Durable Sheets storage, never CacheService. Expiry cleanup cannot remove
  // operation records used for idempotency or undo.
  const plans = readControlTable_('ControlPlans').filter(function (row) { return Date.parse(row.expires_at) > Date.now(); });
  if (plans.length >= 200) throw schedulerError_('PLAN_LIMIT', 'Too many unexpired plans. Wait for their 15-minute expiry.');
  plans.push({ plan_id: plan.planId, integration_id: actor.id, expires_at: plan.expiresAt, plan_json: serialized });
  writeTablesAtomically_({ ControlPlans: plans }, ['ControlPlans']);
  return controlPublicPlan_(plan);
}

function controlOperation_(operations, actor, operationId) {
  controlId_(operationId, 'operationId');
  const row = operations.find(function (item) { return item.operation_id === operationId && item.integration_id === actor.id; });
  if (!row) throw schedulerError_('OPERATION_NOT_FOUND', 'No operation with this ID belongs to the integration.');
  return row;
}

function controlApply_(database, actor, body) {
  controlId_(body.operationId, 'operationId'); controlId_(body.planId, 'planId');
  controlRequireScope_(actor, 'catalog:read'); controlRequireScope_(actor, 'users:read');
  const operations = readControlTable_('ControlOperations');
  const existing = operations.find(function (row) { return row.operation_id === body.operationId; });
  if (existing) {
    if (existing.integration_id !== actor.id || existing.plan_id !== body.planId) throw schedulerError_('OPERATION_ID_CONFLICT', 'operationId has already been used for another plan.');
    controlStored_(existing.record_json).scopes.forEach(function (scope) { controlRequireScope_(actor, scope); });
    return JSON.parse(existing.result_json);
  }
  if (operations.some(function (row) { return row.plan_id === body.planId; })) throw schedulerError_('PLAN_ALREADY_APPLIED', 'This plan was already applied. Retry using the original operationId.');
  const row = readControlTable_('ControlPlans').find(function (item) { return item.plan_id === body.planId && item.integration_id === actor.id; });
  if (!row) throw schedulerError_('PLAN_NOT_FOUND', 'The plan was not found or has expired.');
  const plan = controlStored_(row.plan_json);
  if (plan.integrationId !== actor.id || plan.planId !== body.planId) throw schedulerError_('PLAN_INVALID', 'The stored plan identity is inconsistent.');
  plan.scopes.forEach(function (scope) { controlRequireScope_(actor, scope); });
  if (Date.parse(plan.expiresAt) <= Date.now()) throw schedulerError_('PLAN_EXPIRED', 'Prepare a new plan.');
  if (getRevisionFromDb_(database) !== plan.baseRevision || controlFingerprint_(database) !== plan.baseFingerprint) throw schedulerError_('STALE_DATA', 'The database changed. Prepare and review a new plan.', { expectedRevision: getRevisionFromDb_(database), receivedRevision: plan.baseRevision });
  if (plan.confirmationReasons.length && body.confirmPlanId !== plan.planId) throw schedulerError_('CONFIRMATION_REQUIRED', 'Review the plan and explicitly confirm its ID.', { planId: plan.planId, reasons: plan.confirmationReasons });
  controlPatch_(database, plan.changes, false);
  assertDatabaseIntegrity_(database);
  if (controlFingerprint_(database) !== plan.expectedFingerprint) throw schedulerError_('PLAN_INVALID', 'The saved plan does not produce its expected state.');
  const revision = plan.baseRevision + 1;
  setRevisionInDb_(database, revision);
  const result = { operationId: body.operationId, planId: plan.planId, revision: revision, integrationId: actor.id, initiator: plan.initiator,
    appliedAt: nowIso_(), undoOperationId: plan.undoOperationId, affectedUsers: controlPublicPlan_(plan).affectedUsers, changeCount: plan.changes.length };
  const auditActor = { user_id: 'integration:' + actor.id, slug: 'integration:' + actor.id };
  appendAuditChanges_(database, auditActor, plan.changes.map(function (change) {
    return { action: change.before === null ? 'CREATE' : change.after === null ? 'DELETE' : 'UPDATE',
      entityType: { Semesters: 'Semester', Subjects: 'Subject', Offerings: 'Offering', Groups: 'Group', Enrollments: 'Enrollment', Lessons: 'Lesson' }[change.table] || change.table,
      entityId: change.key, oldValue: change.before, newValue: change.after };
  }), revision);
  appendAuditChanges_(database, auditActor, [{ action: plan.undoOperationId ? 'CONTROL_UNDO' : 'CONTROL_APPLY', entityType: 'ControlOperation', entityId: body.operationId,
    oldValue: null, newValue: Object.assign({}, result, { reason: plan.reason, confirmationReasons: plan.confirmationReasons, confirmed: body.confirmPlanId === plan.planId }) }], revision);
  operations.push({ operation_id: body.operationId, integration_id: actor.id, plan_id: plan.planId, result_json: controlPacked_(result), record_json: row.plan_json });
  database.ControlOperations = operations;
  persistDatabase_(database, Array.from(new Set(plan.changes.map(function (change) { return change.table; }).concat(['Meta', 'AuditLog', 'ControlOperations']))));
  return result;
}

function controlVerify_(database, actor, operation) {
  const plan = controlStored_(operation.record_json);
  controlRequireScope_(actor, 'users:read');
  const result = JSON.parse(operation.result_json);
  const participants = plan.userChecks.map(function (check) {
    const user = database.Users.find(function (row) { return row.user_id === check.user.id && isActive_(row.active); });
    const semester = database.Semesters.find(function (row) { return row.semester_id === check.semesterId; });
    const matches = check.expectedHash === null ? !semester : Boolean(user && semester && hashEditToken_(controlCanonical_(controlScheduleView_(database, user, check.semesterId))) === check.expectedHash);
    return { user: check.user, semesterId: check.semesterId, matches: matches };
  });
  const checks = { plannedStateMatches: controlFingerprint_(database) === plan.expectedFingerprint,
    changedRecordsMatch: plan.changes.every(function (change) {
      const actual = database[change.table].find(function (row) { return controlKey_(change.table, row) === change.key; }) || null;
      return controlCanonical_(actual) === controlCanonical_(change.after);
    }), participantSchedulesMatch: participants.every(function (check) { return check.matches; }) };
  return { operationId: result.operationId, appliedRevision: result.revision, currentRevision: getRevisionFromDb_(database),
    verified: Object.keys(checks).every(function (key) { return checks[key]; }), checks: checks, participants: participants };
}
