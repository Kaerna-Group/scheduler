const SCHEDULER_CONTROL_SHEETS = Object.freeze({
  ControlPlans: ['plan_id', 'integration_id', 'expires_at', 'plan_json'],
  ControlOperations: ['operation_id', 'integration_id', 'plan_id', 'result_json', 'record_json'],
});
const CONTROL_SCOPES = Object.freeze(['catalog:read', 'users:read', 'lessons:write', 'catalog:write', 'enrollments:write', 'history:read', 'changes:undo']);
const CONTROL_TABLES = Object.freeze(['Semesters', 'Subjects', 'Offerings', 'Groups', 'Enrollments', 'Lessons', 'LessonGroups', 'LessonWeeks']);
const CONTROL_KEYS = Object.freeze({ Semesters: 'semester_id', Subjects: 'subject_id', Offerings: 'offering_id', Groups: 'group_id', Enrollments: 'enrollment_id', Lessons: 'lesson_id' });
const CONTROL_PROPERTY_PREFIX = 'SCHEDULER_INTEGRATION_';

// Owner-only editor helpers. None are reachable through doGet/doPost.
function setupSchedulerControl() {
  const lock = LockService.getScriptLock();
  lock.waitLock(SCHEDULER_CONFIG.lockTimeoutMs);
  try {
    assertSchemaMigrationIdle_();
    const database = loadDatabase_();
    if (databaseSchemaVersion_(database.Meta) !== Number(SCHEDULER_CONFIG.schemaVersion)) throw schedulerError_('SCHEMA_MISMATCH', 'Upgrade the core schema first.');
    assertDatabaseIntegrity_(database);
    const spreadsheet = getSchedulerSpreadsheet_();
    Object.keys(SCHEDULER_CONTROL_SHEETS).forEach(function (name) { ensureSheet_(spreadsheet, name, SCHEDULER_CONTROL_SHEETS[name]); });
    SpreadsheetApp.flush();
    return { controlVersion: 1, sheets: Object.keys(SCHEDULER_CONTROL_SHEETS) };
  } finally { lock.releaseLock(); }
}

function createSchedulerIntegration(integrationId, scopes) {
  controlId_(integrationId, 'integrationId');
  if (!Array.isArray(scopes) || !scopes.length || scopes.some(function (scope) { return CONTROL_SCOPES.indexOf(scope) === -1; })) throw schedulerError_('VALIDATION_ERROR', 'Provide an explicit list of supported integration scopes.');
  const lock = LockService.getScriptLock();
  lock.waitLock(SCHEDULER_CONFIG.lockTimeoutMs);
  try {
    const properties = PropertiesService.getScriptProperties();
    const key = CONTROL_PROPERTY_PREFIX + integrationId;
    if (properties.getProperty(key)) throw schedulerError_('INTEGRATION_EXISTS', 'Use another integration ID, or revoke the existing integration.');
    const token = 'sci_' + generateEditToken_();
    properties.setProperty(key, JSON.stringify({ id: integrationId, scopes: Array.from(new Set(scopes)), active: true,
      spreadsheetId: getSchedulerSpreadsheet_().getId(), tokenHash: hashEditToken_('scheduler-control:' + token) }));
    return { integrationId: integrationId, integrationToken: token, scopes: scopes };
  } finally { lock.releaseLock(); }
}

function revokeSchedulerIntegration(integrationId) {
  controlId_(integrationId, 'integrationId');
  const lock = LockService.getScriptLock();
  lock.waitLock(SCHEDULER_CONFIG.lockTimeoutMs);
  try {
    const properties = PropertiesService.getScriptProperties();
    const key = CONTROL_PROPERTY_PREFIX + integrationId;
    const value = properties.getProperty(key);
    if (!value) throw schedulerError_('INTEGRATION_NOT_FOUND', 'Integration does not exist.');
    const record = JSON.parse(value);
    record.active = false;
    properties.setProperty(key, JSON.stringify(record));
    return { integrationId: integrationId, revoked: true };
  } finally { lock.releaseLock(); }
}

function controlId_(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$/.test(value)) throw schedulerError_('VALIDATION_ERROR', label + ' must contain 3–80 letters, digits, underscores or hyphens.');
  return value;
}

function controlObject_(input, fields, required) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw schedulerError_('VALIDATION_ERROR', 'Expected an object.');
  if (Object.keys(input).some(function (key) { return fields.indexOf(key) === -1; })) throw schedulerError_('VALIDATION_ERROR', 'Unknown or forbidden field. Allowed fields: ' + fields.join(', '));
  (required || []).forEach(function (key) { if (input[key] === undefined) throw schedulerError_('VALIDATION_ERROR', key + ' is required.'); });
  return input;
}

function controlAuthenticate_(body) {
  if (typeof body.integrationId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$/.test(body.integrationId) ||
      typeof body.integrationToken !== 'string' || body.integrationToken.length < 28 || body.integrationToken.length > 200) throw schedulerError_('UNAUTHORIZED', 'Integration credentials are required.');
  const raw = PropertiesService.getScriptProperties().getProperty(CONTROL_PROPERTY_PREFIX + body.integrationId);
  const actor = raw ? JSON.parse(raw) : null;
  if (!actor || !actor.active || actor.spreadsheetId !== getSchedulerSpreadsheet_().getId() ||
      actor.tokenHash !== hashEditToken_('scheduler-control:' + body.integrationToken)) throw schedulerError_('UNAUTHORIZED', 'Integration credentials are invalid or revoked.');
  return { id: actor.id, scopes: actor.scopes };
}

function controlRequireScope_(actor, scope) {
  if (actor.scopes.indexOf(scope) === -1) throw schedulerError_('FORBIDDEN', 'Integration permission required: ' + scope);
}

function readControlTable_(name) {
  const spreadsheet = getSchedulerSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(name);
  if (!sheet) throw schedulerError_('CONTROL_NOT_CONFIGURED', 'Run setupSchedulerControl() in the Apps Script editor.');
  const headers = SCHEDULER_CONTROL_SHEETS[name];
  const values = sheet.getDataRange().getDisplayValues();
  if (JSON.stringify(values[0]) !== JSON.stringify(headers)) throw schedulerError_('SCHEMA_MISMATCH', 'Unexpected columns in ' + name);
  return values.slice(1).filter(function (row) { return row.some(Boolean); }).map(function (row) {
    const result = {};
    headers.forEach(function (header, index) { result[header] = row[index] || ''; });
    return result;
  });
}

function controlUser_(row) { return { id: row.user_id, slug: row.slug, displayName: row.display_name }; }

function controlApi_(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(SCHEDULER_CONFIG.lockTimeoutMs);
  try {
    assertSchemaMigrationIdle_();
    const actor = controlAuthenticate_(body);
    const fields = {
      'control.catalog': ['semesterId'], 'control.users': ['query'], 'control.lessons.find': ['filters'],
      'control.enrollments.find': ['filters'],
      'control.changes.plan': ['commands', 'initiator', 'reason'],
      'control.changes.apply': ['planId', 'operationId', 'confirmPlanId'],
      'control.changes.verify': ['operationId'], 'control.history': ['limit'],
    };
    if (!Object.prototype.hasOwnProperty.call(fields, body.action)) throw schedulerError_('FORBIDDEN', 'Unsupported Control API action.');
    controlObject_(body, ['action', 'apiVersion', 'integrationId', 'integrationToken'].concat(fields[body.action]));
    const database = loadDatabase_();
    if (databaseSchemaVersion_(database.Meta) !== Number(SCHEDULER_CONFIG.schemaVersion)) throw schedulerError_('SCHEMA_MISMATCH', 'Upgrade the core schema first.');
    assertDatabaseIntegrity_(database);
    if (body.action === 'control.enrollments.find') {
      controlRequireScope_(actor, 'users:read'); controlRequireScope_(actor, 'catalog:read');
      const filters = controlObject_(body.filters || {}, ['userId', 'offeringId']);
      Object.keys(filters).forEach(function (field) { controlId_(filters[field], field); });
      return { revision: getRevisionFromDb_(database), enrollments: database.Enrollments.filter(function (row) {
        return isActive_(row.active) && (!filters.userId || row.user_id === filters.userId) && (!filters.offeringId || row.offering_id === filters.offeringId);
      }) };
    }
    if (body.action === 'control.users') {
      controlRequireScope_(actor, 'users:read');
      if (body.query !== undefined) controlText_(body.query, 'query', true);
      const query = String(body.query || '').toLowerCase();
      return { revision: getRevisionFromDb_(database), users: database.Users.filter(function (row) {
        return isActive_(row.active) && [row.user_id, row.slug, row.display_name].join(' ').toLowerCase().indexOf(query) !== -1;
      }).map(controlUser_) };
    }
    if (body.action === 'control.catalog' || body.action === 'control.lessons.find') {
      controlRequireScope_(actor, 'catalog:read');
      return body.action === 'control.catalog' ? controlCatalog_(database, body.semesterId) : controlFindLessons_(database, body.filters || {});
    }
    if (body.action === 'control.changes.plan') return controlPlan_(database, actor, body);
    if (body.action === 'control.changes.apply') return controlApply_(database, actor, body);
    controlRequireScope_(actor, 'history:read');
    const operations = readControlTable_('ControlOperations');
    if (body.action === 'control.changes.verify') return controlVerify_(database, actor, controlOperation_(operations, actor, body.operationId));
    const limit = body.limit === undefined ? 25 : body.limit;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw schedulerError_('VALIDATION_ERROR', 'limit must be 1–100.');
    controlRequireScope_(actor, 'catalog:read'); controlRequireScope_(actor, 'users:read');
    return { revision: getRevisionFromDb_(database), operations: operations.filter(function (row) { return row.integration_id === actor.id; }).slice(-limit).reverse().map(function (row) {
      return Object.assign({}, JSON.parse(row.result_json), { plan: controlPublicPlan_(controlStored_(row.record_json)) });
    }) };
  } finally { lock.releaseLock(); }
}
