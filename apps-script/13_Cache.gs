function scheduleCacheHash_(value) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8
  )).replace(/=+$/, '');
}

function scheduleCacheKey_(spreadsheetId, metadata, user, semesterId, recoveryEpoch) {
  // Scope the script-wide cache to its spreadsheet and DTO implementation.
  // Include live public metadata as well: settings have their own revision,
  // schema repairs need not bump data_revision, and users can be deactivated.
  // Token hashes are deliberately excluded, even from the key fingerprint.
  const preferences = metadata.UserPreferences.find(function (row) { return row.user_id === user.user_id; });
  const scope = scheduleCacheHash_(JSON.stringify({
    spreadsheetId: spreadsheetId,
    apiVersion: SCHEDULER_CONFIG.apiVersion,
    schemaVersion: SCHEDULER_CONFIG.schemaVersion,
    cacheVersion: SCHEDULER_CONFIG.scheduleCacheVersion,
    recoveryEpoch: recoveryEpoch || '',
    meta: metadata.Meta,
    users: metadata.Users.map(function (row) { return Object.assign(publicUser_(row), { active: row.active }); }),
    semesters: metadata.Semesters,
    preferences: preferences || null,
  }));
  const key = 'schedule:' + scope + ':' + encodeURIComponent(user.slug) + ':' + encodeURIComponent(semesterId) +
    ':' + getRevisionFromDb_(metadata) + ':settings:' + (preferences ? preferences.settings_revision : '0');
  // Legacy/manual identifiers can exceed the normal UI limits. Never let a
  // long identifier break the 250-character CacheService key limit.
  return key.length <= 250 ? key : 'schedule:' + scheduleCacheHash_(key);
}

function readScheduleCache_(cache, key, user, semesterId, revision, preferencesRevision) {
  const raw = cache.get(key);
  if (!raw) return null;
  const entry = JSON.parse(raw);
  if (!entry || entry.key !== key || typeof entry.payload !== 'string' ||
      entry.checksum !== scheduleCacheHash_(entry.payload)) return null;
  const schedule = JSON.parse(entry.payload);
  if (!schedule || !schedule.user || schedule.user.id !== user.user_id || schedule.user.slug !== user.slug ||
      !schedule.semester || schedule.semester.id !== semesterId || schedule.revision !== revision ||
      schedule.preferencesRevision !== preferencesRevision || !Array.isArray(schedule.users) ||
      !Array.isArray(schedule.subjects) || !Array.isArray(schedule.lessons)) return null;
  return schedule;
}

function writeScheduleCache_(cache, key, schedule) {
  const payload = JSON.stringify(schedule);
  const entry = JSON.stringify({ key: key, checksum: scheduleCacheHash_(payload), payload: payload });
  // CacheService limits values in bytes, not JS UTF-16 characters. Leave room
  // below its 100 KB limit and skip oversized DTOs instead of truncating them.
  if (Utilities.newBlob(entry).getBytes().length > SCHEDULER_CONFIG.scheduleCacheMaxBytes) return;
  cache.put(key, entry, SCHEDULER_CONFIG.scheduleCacheTtlSeconds);
}

function getCachedUserSchedule_(userSlug, requestedSemesterId) {
  // The same lock is held by import/undo/preferences/admin/semester writes.
  // It also prevents concurrent cold GETs from rebuilding the same snapshot.
  // Do not call this wrapper inside a mutation: use buildUserSchedule_ with
  // that operation's in-memory database, without caching uncommitted state.
  const lock = LockService.getScriptLock();
  lock.waitLock(SCHEDULER_CONFIG.lockTimeoutMs);
  try {
    assertSchemaMigrationIdle_();
    const spreadsheet = getSchedulerSpreadsheet_();
    const metadata = {};
    ['Meta', 'Users', 'Semesters', 'UserPreferences'].forEach(function (name) {
      metadata[name] = readTable_(name, spreadsheet);
    });
    const user = metadata.Users.find(function (row) { return row.slug === userSlug && isActive_(row.active); });
    if (!user) throw schedulerError_('USER_NOT_FOUND', 'Unknown or inactive user: ' + userSlug);
    const semesterId = requestedSemesterId || getCurrentSemesterId_(metadata);
    if (!metadata.Semesters.some(function (row) { return row.semester_id === semesterId; })) {
      throw schedulerError_('SEMESTER_NOT_FOUND', 'Unknown or inactive semester: ' + semesterId);
    }
    const revision = getRevisionFromDb_(metadata);
    const preferencesRevision = getUserPreferences_(metadata, user.user_id).preferencesRevision;
    let cache = null;
    let key = null;
    try {
      const properties = PropertiesService.getScriptProperties();
      if (!properties.getProperty(SCHEDULER_CONFIG.cacheWritePendingProperty)) {
        cache = CacheService.getScriptCache();
        key = scheduleCacheKey_(spreadsheet.getId(), metadata, user, semesterId,
          properties.getProperty(SCHEDULER_CONFIG.cacheRecoveryEpochProperty));
        const cached = readScheduleCache_(cache, key, user, semesterId, revision, preferencesRevision);
        if (cached) return cached;
      }
    } catch (ignored) {
      // Eviction, invalid JSON, unavailable CacheService or a cache quota is a
      // cache miss, never an API failure or a reason to serve an older revision.
    }

    // Only a miss reads the eight remaining tables. Reuse metadata so the first
    // request still reads each of the twelve tables exactly once.
    const database = loadDatabase_(metadata, spreadsheet);
    const schedule = buildUserSchedule_(userSlug, semesterId, database);
    if (cache && key) {
      try { writeScheduleCache_(cache, key, schedule); } catch (ignored) { /* Best-effort acceleration. */ }
    }
    return schedule;
  } finally {
    lock.releaseLock();
  }
}
