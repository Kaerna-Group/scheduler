function preferenceBoolean_(value, fallback) {
  if (value === true || String(value).toLowerCase() === 'yes' || String(value) === '1') return true;
  if (value === false || String(value).toLowerCase() === 'no' || String(value) === '0') return false;
  return fallback;
}

function preferenceBooleanCell_(value) {
  return value ? 'yes' : 'no';
}

function createDefaultPreferenceRow_(userId) {
  return {
    user_id: userId,
    preferences_version: '1',
    appearance_mode: 'light',
    theme_id: 'paper-current',
    system_light_theme_id: 'paper-current',
    system_dark_theme_id: 'graphite-current',
    reduced_motion: 'system',
    default_view: 'week',
    initial_week: 'last-opened',
    show_empty_days: 'yes',
    density: 'comfortable',
    highlight_conflicts: 'yes',
    show_saturday: 'yes',
    remember_subject_filter: 'no',
    refresh_on_open: 'yes',
    settings_revision: '0',
    updated_at: nowIso_(),
  };
}

function ensureUserPreferenceRows_(database) {
  let added = 0;
  const existing = new Set(database.UserPreferences.map(function (row) { return row.user_id; }));
  database.Users.filter(function (row) { return isActive_(row.active); }).forEach(function (user) {
    if (existing.has(user.user_id)) return;
    database.UserPreferences.push(createDefaultPreferenceRow_(user.user_id));
    existing.add(user.user_id);
    added += 1;
  });
  return added;
}

function preferenceRowToPublic_(row) {
  return {
    version: 1,
    appearance: {
      mode: row.appearance_mode,
      themeId: row.theme_id,
      systemLightThemeId: row.system_light_theme_id,
      systemDarkThemeId: row.system_dark_theme_id,
      reducedMotion: row.reduced_motion,
    },
    schedule: {
      defaultView: row.default_view,
      initialWeek: row.initial_week,
      showEmptyDays: preferenceBoolean_(row.show_empty_days, true),
      density: row.density,
      highlightConflicts: preferenceBoolean_(row.highlight_conflicts, true),
      showSaturday: preferenceBoolean_(row.show_saturday, true),
      rememberSubjectFilter: preferenceBoolean_(row.remember_subject_filter, false),
      refreshOnOpen: preferenceBoolean_(row.refresh_on_open, true),
    },
  };
}

function getUserPreferences_(database, userId) {
  const storedRow = database.UserPreferences.find(function (item) { return item.user_id === userId; });
  const row = storedRow || createDefaultPreferenceRow_(userId);
  return {
    preferences: preferenceRowToPublic_(row),
    preferencesRevision: Number(row.settings_revision) || 0,
    // Revision 0 is an uninitialized default row. Legacy local preferences may seed it once.
    preferencesExists: Boolean(storedRow) && (Number(storedRow.settings_revision) || 0) > 0,
  };
}

function assertPreferenceValue_(allowed, value, field) {
  if (allowed.indexOf(value) === -1) throw schedulerError_('VALIDATION_ERROR', field + ' has an invalid value.');
}

function validatePreferenceRow_(row) {
  if (Number(row.preferences_version) !== 1) throw schedulerError_('INTEGRITY_ERROR', 'Unsupported preferences_version for ' + row.user_id);
  assertPreferenceValue_(ALLOWED_THEME_MODES, row.appearance_mode, 'appearance_mode');
  assertPreferenceValue_(ALLOWED_THEME_IDS, row.theme_id, 'theme_id');
  assertPreferenceValue_(ALLOWED_LIGHT_THEME_IDS, row.system_light_theme_id, 'system_light_theme_id');
  assertPreferenceValue_(ALLOWED_DARK_THEME_IDS, row.system_dark_theme_id, 'system_dark_theme_id');
  assertPreferenceValue_(ALLOWED_REDUCED_MOTION, row.reduced_motion, 'reduced_motion');
  assertPreferenceValue_(ALLOWED_DEFAULT_VIEWS, row.default_view, 'default_view');
  assertPreferenceValue_(ALLOWED_INITIAL_WEEKS, row.initial_week, 'initial_week');
  assertPreferenceValue_(ALLOWED_DENSITIES, row.density, 'density');
  ['show_empty_days', 'highlight_conflicts', 'show_saturday', 'remember_subject_filter', 'refresh_on_open'].forEach(function (field) {
    if (['yes', 'no'].indexOf(String(row[field]).toLowerCase()) === -1) throw schedulerError_('INTEGRITY_ERROR', field + ' must be yes or no.');
  });
  const revision = Number(row.settings_revision);
  if (!Number.isInteger(revision) || revision < 0) throw schedulerError_('INTEGRITY_ERROR', 'settings_revision must be a non-negative integer.');
}

function normalizePreferencesPatch_(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw schedulerError_('VALIDATION_ERROR', 'patch must be an object.');
  const normalized = {};
  const topLevelKeys = Object.keys(patch);
  topLevelKeys.forEach(function (key) {
    if (['appearance', 'schedule'].indexOf(key) === -1) throw schedulerError_('VALIDATION_ERROR', 'Unknown preferences section: ' + key);
  });

  if (patch.appearance !== undefined) {
    if (!patch.appearance || typeof patch.appearance !== 'object' || Array.isArray(patch.appearance)) throw schedulerError_('VALIDATION_ERROR', 'appearance patch must be an object.');
    normalized.appearance = {};
    Object.keys(patch.appearance).forEach(function (key) {
      const value = patch.appearance[key];
      if (key === 'mode') assertPreferenceValue_(ALLOWED_THEME_MODES, value, 'appearance.mode');
      else if (key === 'themeId') assertPreferenceValue_(ALLOWED_THEME_IDS, value, 'appearance.themeId');
      else if (key === 'systemLightThemeId') assertPreferenceValue_(ALLOWED_LIGHT_THEME_IDS, value, 'appearance.systemLightThemeId');
      else if (key === 'systemDarkThemeId') assertPreferenceValue_(ALLOWED_DARK_THEME_IDS, value, 'appearance.systemDarkThemeId');
      else if (key === 'reducedMotion') assertPreferenceValue_(ALLOWED_REDUCED_MOTION, value, 'appearance.reducedMotion');
      else throw schedulerError_('VALIDATION_ERROR', 'Unknown appearance preference: ' + key);
      normalized.appearance[key] = value;
    });
  }

  if (patch.schedule !== undefined) {
    if (!patch.schedule || typeof patch.schedule !== 'object' || Array.isArray(patch.schedule)) throw schedulerError_('VALIDATION_ERROR', 'schedule patch must be an object.');
    normalized.schedule = {};
    Object.keys(patch.schedule).forEach(function (key) {
      const value = patch.schedule[key];
      if (key === 'defaultView') assertPreferenceValue_(ALLOWED_DEFAULT_VIEWS, value, 'schedule.defaultView');
      else if (key === 'initialWeek') assertPreferenceValue_(ALLOWED_INITIAL_WEEKS, value, 'schedule.initialWeek');
      else if (key === 'density') assertPreferenceValue_(ALLOWED_DENSITIES, value, 'schedule.density');
      else if (['showEmptyDays', 'highlightConflicts', 'showSaturday', 'rememberSubjectFilter', 'refreshOnOpen'].indexOf(key) !== -1) {
        if (typeof value !== 'boolean') throw schedulerError_('VALIDATION_ERROR', 'schedule.' + key + ' must be boolean.');
      } else throw schedulerError_('VALIDATION_ERROR', 'Unknown schedule preference: ' + key);
      normalized.schedule[key] = value;
    });
  }
  if (!Object.keys(normalized).length) throw schedulerError_('VALIDATION_ERROR', 'patch must contain at least one preference.');
  return normalized;
}

function applyPreferencesPatchToRow_(row, patch) {
  const appearanceFields = {
    mode: 'appearance_mode', themeId: 'theme_id', systemLightThemeId: 'system_light_theme_id',
    systemDarkThemeId: 'system_dark_theme_id', reducedMotion: 'reduced_motion',
  };
  const scheduleFields = {
    defaultView: 'default_view', initialWeek: 'initial_week', showEmptyDays: 'show_empty_days', density: 'density',
    highlightConflicts: 'highlight_conflicts', showSaturday: 'show_saturday',
    rememberSubjectFilter: 'remember_subject_filter', refreshOnOpen: 'refresh_on_open',
  };
  Object.keys(patch.appearance || {}).forEach(function (key) { row[appearanceFields[key]] = patch.appearance[key]; });
  Object.keys(patch.schedule || {}).forEach(function (key) {
    const value = patch.schedule[key];
    row[scheduleFields[key]] = typeof value === 'boolean' ? preferenceBooleanCell_(value) : value;
  });
}

function resolvePreferenceOwner_(actor, requestedSlug) {
  const slug = String(requestedSlug || '').trim();
  if (!slug) throw schedulerError_('VALIDATION_ERROR', 'userSlug is required for preference updates.');
  if (slug !== actor.slug) throw schedulerError_('FORBIDDEN', 'Preferences can be changed only with their owner edit token.');
  return actor;
}

function updatePreferences_(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(SCHEDULER_CONFIG.lockTimeoutMs);
  try {
    const database = loadDatabase_();
    const actor = authenticateEditToken_(database, body.editToken);
    const target = resolvePreferenceOwner_(actor, body.userSlug);
    let row = database.UserPreferences.find(function (item) { return item.user_id === target.user_id; });
    if (!row) {
      row = createDefaultPreferenceRow_(target.user_id);
      database.UserPreferences.push(row);
    }
    const currentRevision = Number(row.settings_revision) || 0;
    const baseRevision = Number(body.baseSettingsRevision);
    if (!Number.isInteger(baseRevision) || baseRevision !== currentRevision) {
      throw schedulerError_('SETTINGS_STALE', 'Preferences changed on another device.', {
        preferences: preferenceRowToPublic_(row),
        preferencesRevision: currentRevision,
      });
    }
    const patch = normalizePreferencesPatch_(body.patch);
    const oldValue = preferenceRowToPublic_(row);
    applyPreferencesPatchToRow_(row, patch);
    row.settings_revision = String(currentRevision + 1);
    row.updated_at = nowIso_();
    validatePreferenceRow_(row);
    appendAuditChanges_(database, actor, [{
      action: 'UPDATE_PREFERENCES', entityType: 'UserPreferences', entityId: target.user_id,
      oldValue: oldValue, newValue: preferenceRowToPublic_(row),
    }], getRevisionFromDb_(database));
    persistDatabase_(database, ['UserPreferences', 'AuditLog']);
    return { preferences: preferenceRowToPublic_(row), preferencesRevision: Number(row.settings_revision) };
  } finally {
    lock.releaseLock();
  }
}

function setupUserPreferences() {
  const spreadsheet = getSchedulerSpreadsheet_();
  ensureSheet_(spreadsheet, 'UserPreferences', SCHEDULER_SHEETS.UserPreferences);
  const database = loadDatabase_();
  const added = ensureUserPreferenceRows_(database);
  assertDatabaseIntegrity_(database);
  if (added) persistDatabase_(database, ['UserPreferences']);
  return { users: database.Users.length, added: added };
}
