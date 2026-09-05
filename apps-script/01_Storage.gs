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
  const headerMismatch = headers.some((header, index) => currentHeaders[index] !== header) ||
    currentHeaders.slice(headers.length).some(function (header) { return header !== ''; });
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

function readTable_(name, providedSpreadsheet) {
  const spreadsheet = providedSpreadsheet || getSchedulerSpreadsheet_();
  const headers = SCHEDULER_SHEETS[name];
  if (!headers) throw schedulerError_('UNKNOWN_TABLE', 'Unknown sheet: ' + name);
  const sheet = spreadsheet.getSheetByName(name);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const range = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length);
  const values = range.getValues();
  const displayValues = range.getDisplayValues();
  const timezone = spreadsheet.getSpreadsheetTimeZone();
  return values
    .map(function (row, rowIndex) {
      const record = {};
      headers.forEach(function (header, index) {
        record[header] = normalizeSheetCell_(header, row[index], displayValues[rowIndex][index], timezone);
      });
      return record;
    })
    .filter(function (record) {
      return headers.some(function (header) { return record[header] !== ''; });
    });
}

function normalizeSheetCell_(header, value, displayValue, timezone) {
  if (header === 'start_time' || header === 'end_time') {
    if (value instanceof Date) return Utilities.formatDate(value, timezone, 'HH:mm');

    const time = String(displayValue || value || '').trim();
    const match = time.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (match) return String(Number(match[1])).padStart(2, '0') + ':' + match[2];
    return time;
  }

  return displayValue === undefined || displayValue === null ? '' : String(displayValue);
}

function formatTimeColumnsAsText_(sheet, headers, startRow, rowCount) {
  if (rowCount < 1) return;
  headers.forEach(function (header, index) {
    if (header === 'start_time' || header === 'end_time') {
      sheet.getRange(startRow, index + 1, rowCount, 1).setNumberFormat('@');
    }
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
  formatTimeColumnsAsText_(sheet, headers, 2, values.length);
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
  const startRow = sheet.getLastRow() + 1;
  formatTimeColumnsAsText_(sheet, headers, startRow, values.length);
  sheet.getRange(startRow, 1, values.length, headers.length).setValues(values);
}

function loadDatabase_(preloadedTables, providedSpreadsheet, allowMigration) {
  if (!allowMigration) assertSchemaMigrationIdle_();
  const database = {};
  Object.keys(SCHEDULER_SHEETS).forEach(function (name) {
    database[name] = preloadedTables && Object.prototype.hasOwnProperty.call(preloadedTables, name)
      ? preloadedTables[name]
      : readTable_(name, providedSpreadsheet);
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
  if (!changedTables.length) return;
  assertSchemaMigrationIdle_();
  databaseSchemaVersion_(database.Meta);
  // One Sheets API transaction includes data, revision and audit rows.
  const properties = PropertiesService.getScriptProperties();
  const recoveringWrite = properties.getProperty(SCHEDULER_CONFIG.cacheWritePendingProperty);
  properties.setProperty(SCHEDULER_CONFIG.cacheWritePendingProperty, 'yes');
  let allWritten = false;
  try {
    writeTablesAtomically_(database, changedTables);
    allWritten = true;
  } finally {
    // Commit buffered writes before the caller releases its script lock, so a
    // subsequent cached GET cannot observe a revision ahead of its tables.
    SpreadsheetApp.flush();
    if (allWritten) {
      try {
        // A previous partial write may not have advanced data_revision. Do not
        // resurrect its old entries when a later successful write clears bypass.
        if (recoveringWrite) properties.setProperty(SCHEDULER_CONFIG.cacheRecoveryEpochProperty, newId_('CACHE'));
        properties.deleteProperty(SCHEDULER_CONFIG.cacheWritePendingProperty);
      } catch (ignored) { /* Keep bypassing cache if cleanup fails. */ }
    }
  }
}

function schemaTablesNeedingSetup_(spreadsheet) {
  return Object.keys(SCHEDULER_SHEETS).filter(function (name) {
    const sheet = spreadsheet.getSheetByName(name);
    if (!sheet) return true;
    const expected = SCHEDULER_SHEETS[name];
    const width = Math.max(sheet.getLastColumn(), expected.length);
    const headers = sheet.getLastColumn() ? sheet.getRange(1, 1, 1, width).getDisplayValues()[0] : [];
    const mismatch = expected.some(function (header, index) { return headers[index] !== header; }) ||
      headers.slice(expected.length).some(function (header) { return header !== ''; });
    if (mismatch && sheet.getLastRow() > 1) {
      throw schedulerError_('SCHEMA_MISMATCH', 'Sheet ' + name + ' has unexpected columns and contains data. Use an explicit column migration; no table headers were changed.');
    }
    return mismatch;
  });
}
