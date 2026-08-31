function getSchedulerSpreadsheet_() {
  const properties = PropertiesService.getScriptProperties();
  const storedId = properties.getProperty(SCHEDULER_CONFIG.spreadsheetProperty);
  if (storedId) return SpreadsheetApp.openById(storedId);

  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) {
    throw schedulerError_('SPREADSHEET_NOT_CONFIGURED', 'Run setupScheduler() from a spreadsheet-bound Apps Script project first.');
  }
  properties.setProperty(SCHEDULER_CONFIG.spreadsheetProperty, active.getId());
  return active;
}

function ensureSheet_(spreadsheet, name, headers) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);

  const currentHeaders = sheet.getLastColumn() > 0
    ? sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getDisplayValues()[0]
    : [];
  const headerMismatch = headers.some((header, index) => currentHeaders[index] !== header);
  if (headerMismatch) {
    if (sheet.getLastRow() > 1) {
      throw schedulerError_('SCHEMA_MISMATCH', 'Sheet ' + name + ' has unexpected columns and contains data.');
    }
    sheet.clear();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }

  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setBackground('#293638')
    .setFontColor('#ffffff');
  sheet.autoResizeColumns(1, headers.length);
  return sheet;
}

function readTable_(name) {
  const spreadsheet = getSchedulerSpreadsheet_();
  const headers = SCHEDULER_SHEETS[name];
  if (!headers) throw schedulerError_('UNKNOWN_TABLE', 'Unknown sheet: ' + name);
  const sheet = spreadsheet.getSheetByName(name);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getDisplayValues();
  return values
    .filter(function (row) { return row.some(function (cell) { return cell !== ''; }); })
    .map(function (row) {
      const record = {};
      headers.forEach(function (header, index) { record[header] = row[index]; });
      return record;
    });
}

function writeTable_(name, records) {
  const spreadsheet = getSchedulerSpreadsheet_();
  const headers = SCHEDULER_SHEETS[name];
  const sheet = ensureSheet_(spreadsheet, name, headers);
  const currentRows = Math.max(sheet.getLastRow() - 1, 0);
  if (currentRows > 0) sheet.getRange(2, 1, currentRows, headers.length).clearContent();
  if (!records.length) return;

  const values = records.map(function (record) {
    return headers.map(function (header) {
      const value = record[header];
      return value === undefined || value === null ? '' : value;
    });
  });
  sheet.getRange(2, 1, values.length, headers.length).setValues(values);
}

function appendRecords_(name, records) {
  if (!records.length) return;
  const spreadsheet = getSchedulerSpreadsheet_();
  const headers = SCHEDULER_SHEETS[name];
  const sheet = ensureSheet_(spreadsheet, name, headers);
  const values = records.map(function (record) {
    return headers.map(function (header) {
      const value = record[header];
      return value === undefined || value === null ? '' : value;
    });
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, values.length, headers.length).setValues(values);
}

function loadDatabase_() {
  const database = {};
  Object.keys(SCHEDULER_SHEETS).forEach(function (name) {
    database[name] = readTable_(name);
  });
  return database;
}

function getRevisionFromDb_(database) {
  const row = database.Meta.find(function (item) { return item.key === SCHEDULER_CONFIG.revisionKey; });
  return row ? Number(row.value) || 0 : 0;
}

function setRevisionInDb_(database, revision) {
  const row = database.Meta.find(function (item) { return item.key === SCHEDULER_CONFIG.revisionKey; });
  if (row) row.value = String(revision);
  else database.Meta.push({ key: SCHEDULER_CONFIG.revisionKey, value: String(revision) });
}

function persistDatabase_(database, changedTables) {
  changedTables.forEach(function (name) { writeTable_(name, database[name]); });
}
