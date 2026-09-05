// Schema migrations retain their durable recovery journal. Ordinary mutations
// never fall back to the old sequential writer if the Sheets service is absent.
function writeTablesAtomically_(database, changedTables) {
  if (typeof Sheets === 'undefined') throw schedulerError_('SHEETS_SERVICE_REQUIRED', 'Enable the Advanced Sheets v4 service before writing.');
  const spreadsheet = getSchedulerSpreadsheet_();
  const requests = [];
  Array.from(new Set(changedTables)).forEach(function (name) {
    const headers = SCHEDULER_SHEETS[name] || SCHEDULER_CONTROL_SHEETS[name];
    const sheet = spreadsheet.getSheetByName(name);
    if (!headers || !sheet || !Array.isArray(database[name])) throw schedulerError_('SCHEMA_MISMATCH', 'Missing or unknown table: ' + name);
    const actual = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getDisplayValues()[0];
    if (headers.some(function (header, index) { return actual[index] !== header; }) || actual.slice(headers.length).some(Boolean)) {
      throw schedulerError_('SCHEMA_MISMATCH', 'Unexpected columns in ' + name + '. Run the documented setup/upgrade first.');
    }
    const sheetId = sheet.getSheetId();
    const requiredRows = Math.max(database[name].length + 1, 2);
    if (requiredRows > sheet.getMaxRows()) requests.push({ appendDimension: { sheetId: sheetId, dimension: 'ROWS', length: requiredRows - sheet.getMaxRows() } });
    const endRow = Math.max(requiredRows, sheet.getLastRow(), 2);
    // A bounded range clears trailing old rows when the new table is shorter.
    // stringValue keeps user content literal, including leading '=' and times.
    requests.push({ updateCells: {
      range: { sheetId: sheetId, startRowIndex: 1, endRowIndex: endRow, startColumnIndex: 0, endColumnIndex: headers.length },
      rows: database[name].map(function (record) { return { values: headers.map(function (header) {
        return { userEnteredValue: { stringValue: String(record[header] === undefined || record[header] === null ? '' : record[header]) } };
      }) }; }),
      fields: 'userEnteredValue',
    } });
  });
  if (Utilities.newBlob(JSON.stringify({ requests: requests })).getBytes().length > 1800000) {
    throw schedulerError_('WRITE_TOO_LARGE', 'The atomic write exceeds the 1.8 MB application limit. Archive audit history through a reviewed maintenance procedure.');
  }
  if (requests.length) Sheets.Spreadsheets.batchUpdate({ requests: requests }, spreadsheet.getId());
}
