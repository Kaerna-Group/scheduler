function doGet(event) {
  return apiBoundary_(function () {
    const parameters = event && event.parameter ? event.parameter : {};
    const action = parameters.action || 'health';
    if (action === 'health') {
      const database = loadDatabase_();
      const schemaRow = database.Meta.find(function (row) { return row.key === 'schema_version'; });
      return {
        apiVersion: SCHEDULER_CONFIG.apiVersion,
        status: 'ok',
        revision: getRevisionFromDb_(database),
        schemaVersion: schemaRow ? String(schemaRow.value) : null,
        expectedSchemaVersion: SCHEDULER_CONFIG.schemaVersion,
        sheets: Object.keys(SCHEDULER_SHEETS),
      };
    }
    assertApiVersion_(parameters.apiVersion);
    if (action === 'schedule') {
      return getCachedUserSchedule_(parameters.user, parameters.semester);
    }
    if (action === 'changes') {
      return buildScheduleHistory_(parameters.user, parameters.semester, parameters.limit);
    }
    throw schedulerError_('UNKNOWN_ACTION', 'Unknown GET action: ' + action);
  });
}

function doPost(event) {
  return apiBoundary_(function () {
    if (!event || !event.postData || !event.postData.contents) {
      throw schedulerError_('INVALID_JSON', 'Request body is empty.');
    }
    let body;
    try {
      body = JSON.parse(event.postData.contents);
    } catch (error) {
      throw schedulerError_('INVALID_JSON', 'Request body must contain valid JSON.');
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw schedulerError_('INVALID_JSON', 'Request body must be a JSON object.');
    }
    assertApiVersion_(body.apiVersion);
    if (body.action === 'previewImport') return importPersonalSchedule_(body, true);
    if (body.action === 'importSchedule') return importPersonalSchedule_(body, false);
    if (body.action === 'updateEnrollments') return updateEnrollments_(body);
    if (body.action === 'updatePreferences') return updatePreferences_(body);
    if (body.action === 'undoLastImport') return undoLastImport_(body);
    if (body.action === 'createSemester') return createSemester_(body);
    if (body.action === 'setCurrentSemester') return setCurrentSemester_(body);
    if (body.action === 'archiveSemester') return archiveSemester_(body);
    if (body.action === 'adminOverview') return adminOverview_(body);
    if (body.action === 'adminUserDetails') return adminUserDetails_(body);
    if (body.action === 'adminAuditLog') return adminAuditLog_(body);
    if (body.action === 'adminCreateUser') return adminCreateUser_(body);
    if (body.action === 'adminUpdateUser') return adminUpdateUser_(body);
    if (body.action === 'adminSetUserActive') return adminSetUserActive_(body);
    if (body.action === 'adminRotateUserToken') return adminRotateUserToken_(body);
    throw schedulerError_('UNKNOWN_ACTION', 'Unknown POST action: ' + body.action);
  });
}

function assertApiVersion_(requestedVersion) {
  // Unversioned clients use the original v1 contract, not whichever version is newest.
  const clientVersion = requestedVersion === undefined ? 1 : requestedVersion;
  if (clientVersion !== SCHEDULER_CONFIG.apiVersion && clientVersion !== String(SCHEDULER_CONFIG.apiVersion)) {
    throw schedulerError_('API_VERSION_MISMATCH', 'The client and backend API versions are incompatible. Update the older deployment before retrying.', {
      serverApiVersion: SCHEDULER_CONFIG.apiVersion,
      clientApiVersion: clientVersion,
    });
  }
}

function apiBoundary_(operation) {
  try {
    return jsonOutput_({ apiVersion: SCHEDULER_CONFIG.apiVersion, ok: true, data: operation() });
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    let revision;
    try { revision = getRevisionFromDb_(loadDatabase_()); } catch (ignored) { revision = undefined; }
    return jsonOutput_({
      apiVersion: SCHEDULER_CONFIG.apiVersion,
      ok: false,
      error: {
        code: error.code || 'INTERNAL_ERROR',
        message: error.code ? error.message : 'Unexpected server error.',
        details: error.details || null,
      },
      revision: revision,
    });
  }
}

function jsonOutput_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
