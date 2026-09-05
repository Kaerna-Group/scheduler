// Merge only explicit, equivalent subject cards. Course codes, lessons, groups
// and user enrollments remain distinct; only Offerings.subject_id is redirected.
function mergeSubjectCards_(database, command) {
  controlObject_(command, ['type', 'targetSubjectId', 'sourceSubjectIds'], ['targetSubjectId', 'sourceSubjectIds']);
  const target = controlRow_(database, 'Subjects', command.targetSubjectId, true);
  const ids = command.sourceSubjectIds;
  if (!Array.isArray(ids) || !ids.length || ids.length > 50 || new Set(ids).size !== ids.length || ids.indexOf(target.subject_id) !== -1) {
    throw schedulerError_('VALIDATION_ERROR', 'Provide 1–50 distinct source subject IDs excluding the target.');
  }
  const name = normalizedSubjectName_(target.name);
  if (!name) throw schedulerError_('VALIDATION_ERROR', 'A subject name is required.');
  ids.forEach(function (id) {
    const source = controlRow_(database, 'Subjects', id, true);
    if (normalizedSubjectName_(source.name) !== name) throw schedulerError_('SUBJECT_NAME_MISMATCH', 'Only equivalent subject names can be merged.', { targetSubjectId: target.subject_id, sourceSubjectId: id });
  });
  const sources = new Set(ids);
  database.Offerings.forEach(function (offering) {
    if (sources.has(offering.subject_id) || offering.subject_id === target.subject_id) controlSemester_(database, offering.semester_id, true);
  });
  database.Offerings.forEach(function (offering) {
    if (sources.has(offering.subject_id)) offering.subject_id = target.subject_id;
  });
  database.Subjects = database.Subjects.filter(function (subject) { return !sources.has(subject.subject_id); });
}

function duplicateSubjectCommands_(database) {
  const names = Object.create(null);
  database.Subjects.filter(function (row) { return isActive_(row.active); }).forEach(function (row) {
    const key = normalizedSubjectName_(row.name);
    if (!key) return;
    if (!names[key]) names[key] = [];
    names[key].push(row.subject_id);
  });
  return Object.keys(names).filter(function (key) { return names[key].length > 1; }).map(function (key) {
    return { type: 'subject.merge', targetSubjectId: names[key][0], sourceSubjectIds: names[key].slice(1) };
  });
}

// Editor-only maintenance. The colon makes this identity impossible to create
// or authenticate as an integration (integration IDs reject colons).
function subjectMaintenanceActor_() {
  return { id: 'owner:subject-maintenance', scopes: CONTROL_SCOPES.slice() };
}

function loadSubjectMaintenanceDatabase_() {
  assertSchemaMigrationIdle_();
  const database = loadDatabase_();
  if (databaseSchemaVersion_(database.Meta) !== Number(SCHEDULER_CONFIG.schemaVersion)) throw schedulerError_('SCHEMA_MISMATCH', 'Upgrade the core schema first.');
  assertDatabaseIntegrity_(database);
  return database;
}

function saveSubjectMaintenancePlan_(database, commands, reason) {
  const plan = controlPlan_(database, subjectMaintenanceActor_(), { commands: commands,
    initiator: 'apps-script-owner-editor', reason: reason });
  PropertiesService.getScriptProperties().setProperty('SCHEDULER_SUBJECT_MAINTENANCE', JSON.stringify({ planId: plan.planId, operationId: newId_('OP'), spreadsheetId: getSchedulerSpreadsheet_().getId() }));
  console.log(JSON.stringify(plan));
  return plan;
}

function previewSchedulerSubjectDeduplication() {
  setupSchedulerControl();
  const lock = LockService.getScriptLock();
  lock.waitLock(SCHEDULER_CONFIG.lockTimeoutMs);
  try {
    const database = loadSubjectMaintenanceDatabase_();
    const commands = duplicateSubjectCommands_(database);
    if (!commands.length) {
      const result = { noChanges: true, revision: getRevisionFromDb_(database), message: 'No duplicate active subject names.' };
      console.log(JSON.stringify(result));
      return result;
    }
    return saveSubjectMaintenancePlan_(database, commands, 'Merge duplicate subject cards; preserve all course codes, lessons, groups and enrollments.');
  } finally { lock.releaseLock(); }
}

function previewSchedulerSubjectDeduplicationUndo() {
  const lock = LockService.getScriptLock();
  lock.waitLock(SCHEDULER_CONFIG.lockTimeoutMs);
  try {
    assertSchemaMigrationIdle_();
    const raw = PropertiesService.getScriptProperties().getProperty('SCHEDULER_SUBJECT_MAINTENANCE');
    if (!raw) throw schedulerError_('OPERATION_NOT_FOUND', 'No subject maintenance operation is saved.');
    const pending = JSON.parse(raw);
    if (pending.spreadsheetId !== getSchedulerSpreadsheet_().getId()) throw schedulerError_('PLAN_INVALID', 'The operation belongs to another spreadsheet.');
    const database = loadSubjectMaintenanceDatabase_();
    return saveSubjectMaintenancePlan_(database, [{ type: 'changes.undo', operationId: pending.operationId }], 'Restore the unchanged latest subject maintenance operation.');
  } finally { lock.releaseLock(); }
}

function applySchedulerSubjectDeduplication() {
  const lock = LockService.getScriptLock();
  lock.waitLock(SCHEDULER_CONFIG.lockTimeoutMs);
  try {
    assertSchemaMigrationIdle_();
    const raw = PropertiesService.getScriptProperties().getProperty('SCHEDULER_SUBJECT_MAINTENANCE');
    if (!raw) throw schedulerError_('PLAN_NOT_FOUND', 'Run previewSchedulerSubjectDeduplication() and review its result first.');
    const pending = JSON.parse(raw);
    if (pending.spreadsheetId !== getSchedulerSpreadsheet_().getId()) throw schedulerError_('PLAN_INVALID', 'Prepare a plan for this spreadsheet.');
    const actor = subjectMaintenanceActor_();
    const database = loadSubjectMaintenanceDatabase_();
    const applied = controlApply_(database, actor, { planId: pending.planId, operationId: pending.operationId, confirmPlanId: pending.planId });
    const stored = controlOperation_(readControlTable_('ControlOperations'), actor, pending.operationId);
    const verification = controlVerify_(loadDatabase_(), actor, stored);
    const result = { applied: applied, verification: verification };
    console.log(JSON.stringify(result));
    return result;
  } finally { lock.releaseLock(); }
}
