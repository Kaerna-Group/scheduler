// Historical relational schema. Version 0 means an unversioned database.
// Never reseed users, rotate credentials, or alter schedule rows in a migration.
function migrateSchema001_(database) {
  if (!database.Meta.some(function (row) { return row.key === SCHEDULER_CONFIG.revisionKey; })) {
    database.Meta.push({ key: SCHEDULER_CONFIG.revisionKey, value: '0' });
  }
  return {};
}
