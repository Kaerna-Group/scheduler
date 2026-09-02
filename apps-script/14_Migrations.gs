// Append-only registry: released IDs/versions must never be renumbered or reused.
// A new migration is registered here and raises SCHEDULER_CONFIG.schemaVersion.
const SCHEDULER_MIGRATIONS = Object.freeze([
  Object.freeze({ version: 1, id: '001-relational-baseline', apply: migrateSchema001_ }),
  Object.freeze({ version: 2, id: '002-user-preferences-and-current-semester', apply: migrateSchema002_ }),
]);
const SCHEDULER_SCHEMA_REPAIRS = Object.freeze({ 2: repairSchema002_ });

function schedulerMigrationRegistry_() {
  const expected = Number(SCHEDULER_CONFIG.schemaVersion);
  const ids = new Set();
  if (!Number.isSafeInteger(expected) || expected < 1 || SCHEDULER_MIGRATIONS.length !== expected) {
    throw schedulerError_('MIGRATION_REGISTRY_INVALID', 'The migration registry must cover every supported schema version.');
  }
  SCHEDULER_MIGRATIONS.forEach(function (migration, index) {
    if (migration.version !== index + 1 || !/^[a-z0-9-]+$/.test(migration.id) ||
        ids.has(migration.id) || typeof migration.apply !== 'function') {
      throw schedulerError_('MIGRATION_REGISTRY_INVALID', 'Migration versions must be consecutive and IDs must be unique.');
    }
    ids.add(migration.id);
  });
  return SCHEDULER_MIGRATIONS;
}

function databaseSchemaVersion_(meta) {
  const rows = meta.filter(function (row) { return row.key === 'schema_version'; });
  if (rows.length > 1 || (rows.length && !/^(0|[1-9]\d*)$/.test(String(rows[0].value)))) {
    throw schedulerError_('SCHEMA_VERSION_INVALID', 'Meta.schema_version must be one non-negative integer.');
  }
  const version = rows.length ? Number(rows[0].value) : 0;
  if (!Number.isSafeInteger(version)) throw schedulerError_('SCHEMA_VERSION_INVALID', 'Invalid schema version.');
  if (version > Number(SCHEDULER_CONFIG.schemaVersion)) {
    throw schedulerError_('SCHEMA_VERSION_UNSUPPORTED', 'This database uses a newer schema. Deploy a compatible backend; downgrades are not allowed.', {
      schemaVersion: version, expectedSchemaVersion: Number(SCHEDULER_CONFIG.schemaVersion),
    });
  }
  return version;
}

function assertSchemaMigrationIdle_() {
  if (PropertiesService.getScriptProperties().getProperty(SCHEDULER_CONFIG.migrationJournalProperty)) {
    throw schedulerError_('SCHEMA_MIGRATION_PENDING', 'A schema migration is incomplete. An administrator must rerun upgradeSchedulerSchema(); no API operations are allowed until recovery completes.');
  }
}

function setDatabaseSchemaVersion_(database, version) {
  const row = database.Meta.find(function (item) { return item.key === 'schema_version'; });
  if (row) row.value = String(version);
  else database.Meta.push({ key: 'schema_version', value: String(version) });
}

function migrationTableNames_(version) {
  return Object.keys(SCHEDULER_SHEETS).filter(function (name) {
    return version >= 2 || name !== 'UserPreferences';
  });
}

function planSchemaMigration_(database, migration, missingTables, repair) {
  const before = JSON.parse(JSON.stringify(database));
  const next = JSON.parse(JSON.stringify(database));
  assertUnique_(next.Meta, 'key', 'Meta');
  const fromVersion = databaseSchemaVersion_(next.Meta);
  if ((!repair && migration.version !== fromVersion + 1) || (repair && migration.version !== fromVersion)) {
    throw schedulerError_('MIGRATION_ORDER_INVALID', 'A migration may only advance to the next schema version.');
  }
  const summary = migration.apply(next) || {};
  setDatabaseSchemaVersion_(next, migration.version);
  assertDatabaseIntegrity_(next, migration.version);
  // The default runner handles table data, not destructive/reordered columns.
  const changed = migrationTableNames_(migration.version).filter(function (name) {
    return JSON.stringify(before[name]) !== JSON.stringify(next[name]) || missingTables.indexOf(name) !== -1;
  });
  if (!changed.length) return null;
  next.AuditLog.push({
    timestamp: nowIso_(), actor_user_id: 'SYSTEM', actor_slug: 'system',
    action: repair ? 'REPAIR_SCHEMA' : 'MIGRATE_SCHEMA', entity_type: 'Database', entity_id: migration.id,
    old_value: JSON.stringify({ schemaVersion: fromVersion }),
    new_value: JSON.stringify(Object.assign({ schemaVersion: migration.version, migrationId: migration.id }, summary)),
    revision: String(getRevisionFromDb_(next)),
  });
  const names = Array.from(new Set(changed.concat(['AuditLog', 'Meta'])));
  const tables = {};
  names.forEach(function (name) { tables[name] = next[name]; });
  return {
    format: 1, kind: repair ? 'repair' : 'migration', migrationId: migration.id,
    fromVersion: fromVersion, toVersion: migration.version, tables: tables, summary: summary,
  };
}

function cleanupMigrationChunks_(properties) {
  properties.getKeys().filter(function (key) {
    return key.indexOf(SCHEDULER_CONFIG.migrationChunkPrefix) === 0;
  }).forEach(function (key) { properties.deleteProperty(key); });
}

function stageSchemaMigration_(spreadsheet, plan) {
  const properties = PropertiesService.getScriptProperties();
  assertSchemaMigrationIdle_();
  const payload = JSON.stringify(plan);
  if (Utilities.newBlob(payload).getBytes().length > SCHEDULER_CONFIG.migrationMaxBytes) {
    throw schedulerError_('MIGRATION_TOO_LARGE', 'The migration recovery plan is too large. Split the migration or provide larger durable journal storage before changing any Sheets data.');
  }
  cleanupMigrationChunks_(properties);
  // At most 2,000 UTF-16 units / 6,000 UTF-8 bytes per property, without splitting
  // surrogate pairs. This stays below the Apps Script 9 KB per-value limit.
  const chunks = [];
  let chunk = '';
  for (const character of payload) {
    if (chunk.length + character.length > 2000) { chunks.push(chunk); chunk = ''; }
    chunk += character;
  }
  if (chunk) chunks.push(chunk);
  const manifest = {
    format: 1, spreadsheetId: spreadsheet.getId(), chunks: chunks.length,
    checksum: scheduleCacheHash_(payload), migrationId: plan.migrationId,
    fromVersion: plan.fromVersion, toVersion: plan.toVersion, kind: plan.kind,
  };
  chunks.forEach(function (value, index) {
    properties.setProperty(SCHEDULER_CONFIG.migrationChunkPrefix + index, value);
  });
  // Publish only after every chunk exists. Incomplete staging never changes Sheets.
  properties.setProperty(SCHEDULER_CONFIG.migrationJournalProperty, JSON.stringify(manifest));
  return readSchemaMigrationJournal_(spreadsheet);
}

function readSchemaMigrationJournal_(spreadsheet) {
  const properties = PropertiesService.getScriptProperties();
  const raw = properties.getProperty(SCHEDULER_CONFIG.migrationJournalProperty);
  if (!raw) return null;
  let manifest;
  let plan;
  try {
    manifest = JSON.parse(raw);
    if (manifest.format !== 1 || manifest.spreadsheetId !== spreadsheet.getId() ||
        !Number.isInteger(manifest.chunks) || manifest.chunks < 1 || manifest.chunks > 200) throw new Error('Invalid manifest');
    let payload = '';
    for (let index = 0; index < manifest.chunks; index += 1) {
      const chunk = properties.getProperty(SCHEDULER_CONFIG.migrationChunkPrefix + index);
      if (chunk === null) throw new Error('Missing chunk');
      payload += chunk;
    }
    if (scheduleCacheHash_(payload) !== manifest.checksum) throw new Error('Checksum mismatch');
    plan = JSON.parse(payload);
    if (plan.format !== 1 || plan.migrationId !== manifest.migrationId || plan.kind !== manifest.kind ||
        plan.fromVersion !== manifest.fromVersion || plan.toVersion !== manifest.toVersion ||
        !plan.tables || !Array.isArray(plan.tables.Meta) || !Array.isArray(plan.tables.AuditLog)) throw new Error('Invalid plan');
    const known = schedulerMigrationRegistry_().find(function (migration) { return migration.version === plan.toVersion; });
    if (!known || (plan.kind === 'migration' && (known.id !== plan.migrationId || plan.fromVersion + 1 !== plan.toVersion)) ||
        (plan.kind === 'repair' && (plan.migrationId !== 'repair-schema-' + plan.toVersion || plan.fromVersion !== plan.toVersion)) ||
        (plan.kind === 'seed' && (plan.migrationId !== 'seed-schema-' + plan.toVersion || plan.fromVersion !== 0)) ||
        ['migration', 'repair', 'seed'].indexOf(plan.kind) === -1) throw new Error('Unsupported migration');
    if (databaseSchemaVersion_(plan.tables.Meta) !== plan.toVersion) throw new Error('Version mismatch');
    Object.keys(plan.tables).forEach(function (name) {
      if (!Object.prototype.hasOwnProperty.call(SCHEDULER_SHEETS, name) || !Array.isArray(plan.tables[name])) throw new Error('Invalid table');
    });
  } catch (ignored) {
    // Never log journal contents: future steps may include private backend rows.
    throw schedulerError_('MIGRATION_JOURNAL_INVALID', 'The migration journal is corrupt, belongs to another spreadsheet, or requires another backend version. Preserve it and restore the compatible deployment or backup before retrying.');
  }
  return plan;
}

function commitSchemaMigration_(spreadsheet, plan) {
  const properties = PropertiesService.getScriptProperties();
  const actualVersion = databaseSchemaVersion_(readTable_('Meta', spreadsheet));
  if (actualVersion > plan.toVersion || (actualVersion !== 0 && actualVersion !== plan.fromVersion && actualVersion !== plan.toVersion)) {
    throw schedulerError_('MIGRATION_STATE_CONFLICT', 'The database version changed outside the pending migration. No recovery rows were written.');
  }
  schemaTablesNeedingSetup_(spreadsheet);
  const target = Object.assign(loadDatabase_(undefined, spreadsheet, true), plan.tables);
  assertUnique_(target.Meta, 'key', 'Meta');
  assertDatabaseIntegrity_(target, plan.toVersion);
  properties.setProperty(SCHEDULER_CONFIG.cacheWritePendingProperty, 'yes');
  // Replay the durable target rows, not apply(). A write may clear a table before
  // failing; the journal can restore that whole table on the next invocation.
  Object.keys(plan.tables).filter(function (name) { return name !== 'Meta'; }).forEach(function (name) {
    writeTable_(name, plan.tables[name]);
  });
  SpreadsheetApp.flush();
  writeTable_('Meta', plan.tables.Meta);
  SpreadsheetApp.flush();
  properties.setProperty(SCHEDULER_CONFIG.cacheRecoveryEpochProperty, newId_('CACHE'));
  properties.deleteProperty(SCHEDULER_CONFIG.cacheWritePendingProperty);
  // Drop the manifest LAST. A cleanup/flush failure retains the complete plan.
  properties.deleteProperty(SCHEDULER_CONFIG.migrationJournalProperty);
  try { cleanupMigrationChunks_(properties); } catch (ignored) { /* An idle journal's orphan chunks can be removed on the next run. */ }
  return plan;
}

function runSchedulerMigrationsLocked_(spreadsheet) {
  const migrations = schedulerMigrationRegistry_();
  const initialMeta = readTable_('Meta', spreadsheet);
  const previousVersion = databaseSchemaVersion_(initialMeta);
  const applied = [];
  const resumed = [];
  const repairs = [];
  const changedTables = new Set();
  let preferenceRowsAdded = 0;
  let currentSemesterAdded = false;
  function record(plan, recovered) {
    (recovered ? resumed : plan.kind === 'repair' ? repairs : applied).push(plan.migrationId);
    Object.keys(plan.tables).forEach(function (name) { changedTables.add(name); });
    preferenceRowsAdded += Number(plan.summary.preferenceRowsAdded || 0);
    currentSemesterAdded = currentSemesterAdded || Boolean(plan.summary.currentSemesterAdded);
  }
  const pending = readSchemaMigrationJournal_(spreadsheet);
  if (pending) record(commitSchemaMigration_(spreadsheet, pending), true);
  else cleanupMigrationChunks_(PropertiesService.getScriptProperties());
  let database = loadDatabase_();
  let version = databaseSchemaVersion_(database.Meta);
  // Preflight all headers before staging a plan or initializing a missing sheet.
  let missingTables = schemaTablesNeedingSetup_(spreadsheet);
  migrations.filter(function (migration) { return migration.version > version; }).forEach(function (migration) {
    const plan = planSchemaMigration_(database, migration, missingTables, false);
    record(commitSchemaMigration_(spreadsheet, stageSchemaMigration_(spreadsheet, plan)), false);
    database = loadDatabase_();
    version = migration.version;
    missingTables = schemaTablesNeedingSetup_(spreadsheet);
  });
  const repair = SCHEDULER_SCHEMA_REPAIRS[version];
  if (repair) {
    const plan = planSchemaMigration_(database, { version: version, id: 'repair-schema-' + version, apply: repair }, missingTables, true);
    if (plan) record(commitSchemaMigration_(spreadsheet, stageSchemaMigration_(spreadsheet, plan)), false);
  }
  const finalDatabase = loadDatabase_();
  assertUnique_(finalDatabase.Meta, 'key', 'Meta');
  assertDatabaseIntegrity_(finalDatabase, version);
  return {
    spreadsheetId: spreadsheet.getId(), previousSchemaVersion: previousVersion ? String(previousVersion) : null,
    schemaVersion: String(version), appliedMigrations: applied, resumedMigrations: resumed, repairs: repairs,
    preferenceRowsAdded: preferenceRowsAdded, currentSemesterAdded: currentSemesterAdded,
    changedTables: Array.from(changedTables),
  };
}

function upgradeSchedulerSchema() {
  const lock = LockService.getScriptLock();
  lock.waitLock(SCHEDULER_CONFIG.lockTimeoutMs);
  try { return runSchedulerMigrationsLocked_(getSchedulerSpreadsheet_()); }
  finally { lock.releaseLock(); }
}
