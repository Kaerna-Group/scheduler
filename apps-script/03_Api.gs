function doGet(event) {
  return apiBoundary_(function () {
    const parameters = event && event.parameter ? event.parameter : {};
    const action = parameters.action || 'health';
    if (action === 'health') {
      return { status: 'ok', revision: getRevisionFromDb_(loadDatabase_()) };
    }
    if (action === 'schedule') {
      return buildUserSchedule_(parameters.user, parameters.semester);
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

    if (body.action === 'previewImport') return importPersonalSchedule_(body, true);
    if (body.action === 'importSchedule') return importPersonalSchedule_(body, false);
    if (body.action === 'updateEnrollments') return updateEnrollments_(body);
    if (body.action === 'updatePreferences') return updatePreferences_(body);
    throw schedulerError_('UNKNOWN_ACTION', 'Unknown POST action: ' + body.action);
  });
}

function apiBoundary_(operation) {
  try {
    return jsonOutput_({ ok: true, data: operation() });
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    let revision;
    try { revision = getRevisionFromDb_(loadDatabase_()); } catch (ignored) { revision = undefined; }
    return jsonOutput_({
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
