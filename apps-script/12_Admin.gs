// Admin DTOs never contain credential hashes. All entry points are POST-only.
function requireAdmin_(database, body) {
  const actor = authenticateEditToken_(database, body && body.editToken);
  requireRole_(actor, ['admin']);
  return actor;
}

function adminUserDto_(database, user, semesterId) {
  const offeringIds = new Set(database.Offerings.filter(function (row) {
    return (!semesterId || row.semester_id === semesterId) && isActive_(row.active);
  }).map(function (row) { return row.offering_id; }));
  const preferences = database.UserPreferences.find(function (row) { return row.user_id === user.user_id; });
  return Object.assign(publicUser_(user), {
    active: isActive_(user.active),
    enrollmentCount: database.Enrollments.filter(function (row) {
      return row.user_id === user.user_id && isActive_(row.active) && offeringIds.has(row.offering_id);
    }).length,
    preferencesRevision: preferences ? Number(preferences.settings_revision) || 0 : null,
  });
}

function adminSafeUserRow_(user) {
  return { user_id: user.user_id, slug: user.slug, display_name: user.display_name, role: user.role, active: user.active };
}

function createUserRecord_(database, displayName, slug, role) {
  if (typeof displayName !== 'string' || typeof slug !== 'string') throw schedulerError_('VALIDATION_ERROR', 'Display name and slug must be strings.');
  const safeSlug = String(slug || '').trim().toLowerCase();
  const safeName = String(displayName || '').trim();
  const safeRole = role === undefined ? 'user' : role;
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(safeSlug)) throw schedulerError_('VALIDATION_ERROR', 'Slug must contain 2–40 lowercase letters, digits, or hyphens, starting with a letter or digit.');
  if (!safeName || safeName.length > 120) throw schedulerError_('VALIDATION_ERROR', 'Display name must contain 1–120 characters.');
  if (ALLOWED_ROLES.indexOf(safeRole) === -1) throw schedulerError_('VALIDATION_ERROR', 'Invalid role.');
  if (database.Users.some(function (row) { return row.slug === safeSlug; })) throw schedulerError_('USER_EXISTS', 'This slug is already used, including by inactive users.');
  const token = generateEditToken_();
  const user = { user_id: newId_('USR'), slug: safeSlug, display_name: safeName, role: safeRole, edit_token_hash: hashEditToken_(token), active: 'yes' };
  database.Users.push(user);
  database.UserPreferences.push(createDefaultPreferenceRow_(user.user_id));
  return { user: user, editToken: token };
}

function rotateUserTokenRecord_(user) {
  const token = generateEditToken_();
  user.edit_token_hash = hashEditToken_(token);
  return token;
}

function assertRemainingAdmin_(database, target, nextRole, nextActive) {
  if (target.role !== 'admin' || !isActive_(target.active) || (nextRole === 'admin' && nextActive)) return;
  if (!database.Users.some(function (row) { return row.user_id !== target.user_id && row.role === 'admin' && isActive_(row.active); })) {
    throw schedulerError_('FORBIDDEN_LAST_ADMIN', 'Cannot remove the last active administrator.');
  }
}

function adminMutateUser_(body, operation) {
  const lock = LockService.getScriptLock();
  lock.waitLock(SCHEDULER_CONFIG.lockTimeoutMs);
  try {
    const database = loadDatabase_();
    const actor = requireAdmin_(database, body);
    const revision = getRevisionFromDb_(database);
    if (typeof body.baseRevision !== 'number' || !Number.isInteger(body.baseRevision) || body.baseRevision !== revision) {
      throw schedulerError_('STALE_DATA', 'Data changed while you were editing. Refresh and review before saving.', { expectedRevision: revision, receivedRevision: body.baseRevision });
    }
    // Capture identity before self-demotion/deactivation mutates the actor row.
    const auditActor = { user_id: actor.user_id, slug: actor.slug };
    let target;
    let token;
    const changes = [];
    if (operation === 'create') {
      const created = createUserRecord_(database, body.displayName, body.slug, body.role);
      target = created.user;
      token = created.editToken;
      changes.push({ action: 'CREATE', entityType: 'User', entityId: target.user_id, oldValue: null, newValue: adminSafeUserRow_(target) });
    } else {
      target = database.Users.find(function (row) { return row.user_id === body.targetUserId; });
      if (!target) throw schedulerError_('USER_NOT_FOUND', 'Target user was not found.');
      if (operation === 'rotate') {
        token = rotateUserTokenRecord_(target);
        changes.push({ action: 'ROTATE_TOKEN', entityType: 'User', entityId: target.user_id, oldValue: null, newValue: { slug: target.slug } });
      } else {
        const patch = operation === 'active' ? { active: body.active } : body.patch;
        if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(function (key) { return ['displayName', 'role', 'active'].indexOf(key) === -1; })) {
          throw schedulerError_('VALIDATION_ERROR', 'Only displayName, role, and active may change. Slug and user ID are immutable.');
        }
        if (patch.active !== undefined && typeof patch.active !== 'boolean') throw schedulerError_('VALIDATION_ERROR', 'active must be a boolean.');
        if (operation === 'active' && typeof body.active !== 'boolean') throw schedulerError_('VALIDATION_ERROR', 'active is required.');
        if (body.rotateToken !== undefined && typeof body.rotateToken !== 'boolean') throw schedulerError_('VALIDATION_ERROR', 'rotateToken must be a boolean.');
        if (patch.displayName !== undefined && typeof patch.displayName !== 'string') throw schedulerError_('VALIDATION_ERROR', 'Display name must be a string.');
        const name = patch.displayName === undefined ? target.display_name : patch.displayName.trim();
        const role = patch.role === undefined ? target.role : patch.role;
        const active = patch.active === undefined ? isActive_(target.active) : patch.active;
        if (!name || name.length > 120) throw schedulerError_('VALIDATION_ERROR', 'Display name must contain 1–120 characters.');
        if (ALLOWED_ROLES.indexOf(role) === -1) throw schedulerError_('VALIDATION_ERROR', 'Invalid role.');
        assertRemainingAdmin_(database, target, role, active);
        const previous = adminSafeUserRow_(target);
        target.display_name = name;
        target.role = role;
        target.active = active ? 'yes' : 'no';
        const next = adminSafeUserRow_(target);
        if (JSON.stringify(previous) !== JSON.stringify(next)) {
          changes.push({ action: isActive_(previous.active) !== active ? (active ? 'ACTIVATE' : 'DEACTIVATE') : 'UPDATE', entityType: 'User', entityId: target.user_id, oldValue: previous, newValue: next });
          if (!isActive_(previous.active) && active && body.rotateToken !== false) {
            token = rotateUserTokenRecord_(target);
            changes.push({ action: 'ROTATE_TOKEN', entityType: 'User', entityId: target.user_id, oldValue: null, newValue: { slug: target.slug } });
          }
        }
      }
    }
    if (changes.length) {
      assertDatabaseIntegrity_(database);
      setRevisionInDb_(database, revision + 1);
      appendAuditChanges_(database, auditActor, changes, revision + 1);
      persistDatabase_(database, operation === 'create' ? ['Users', 'UserPreferences', 'Meta', 'AuditLog'] : ['Users', 'Meta', 'AuditLog']);
    }
    const response = { revision: getRevisionFromDb_(database), user: adminUserDto_(database, target) };
    if (token) response.editToken = token; // Only create/rotation returns plaintext, never stored in AuditLog.
    return response;
  } finally { lock.releaseLock(); }
}

function adminCreateUser_(body) { return adminMutateUser_(body, 'create'); }
function adminUpdateUser_(body) { return adminMutateUser_(body, 'update'); }
function adminSetUserActive_(body) { return adminMutateUser_(body, 'active'); }
function adminRotateUserToken_(body) { return adminMutateUser_(body, 'rotate'); }

function sanitizeAdminAuditValue_(value) {
  // Malformed historical JSON is not sent verbatim: it may contain old credentials.
  const parsed = parseAuditValue_(value);
  if (!parsed || typeof parsed !== 'object') return null;
  function clean(input) {
    if (Array.isArray(input)) return input.map(clean);
    if (!input || typeof input !== 'object') return input;
    const result = {};
    Object.keys(input).forEach(function (key) {
      if (/token|password|secret|credential|authorization|__proto__|constructor|prototype/i.test(key)) return;
      result[key] = clean(input[key]);
    });
    return result;
  }
  return clean(parsed);
}

function adminAuditRows_(database, filters) {
  const query = String(filters.search || '').trim().toLowerCase().slice(0, 200);
  const from = String(filters.from || '');
  const to = String(filters.to || '');
  if ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) || (from && to && from > to)) throw schedulerError_('VALIDATION_ERROR', 'Invalid audit date range.');
  return database.AuditLog.map(function (row, index) {
    const actor = database.Users.find(function (user) { return user.user_id === row.actor_user_id; });
    const oldValue = sanitizeAdminAuditValue_(row.old_value);
    const newValue = sanitizeAdminAuditValue_(row.new_value);
    const value = newValue || oldValue || {};
    const target = database.Users.find(function (user) { return user.user_id === (row.entity_type === 'User' ? row.entity_id : value.user_id); });
    const label = target ? target.display_name : (value.name || value.title || value.external_code || row.entity_id);
    return {
      id: String(index), timestamp: String(row.timestamp || ''), revision: Number(row.revision) || 0,
      actorId: String(row.actor_user_id || ''), actorName: actor ? actor.display_name : String(row.actor_slug || 'System'),
      action: String(row.action || ''), entityType: String(row.entity_type || ''), entityId: String(row.entity_id || ''),
      label: String(label || ''), oldValue: oldValue, newValue: newValue,
    };
  }).filter(function (row) {
    return (!filters.actorId || row.actorId === filters.actorId) && (!filters.action || row.action === filters.action) &&
      (!filters.entityType || row.entityType === filters.entityType) && (!from || row.timestamp.slice(0, 10) >= from) &&
      (!to || row.timestamp.slice(0, 10) <= to) && (!query || JSON.stringify(row).toLowerCase().indexOf(query) !== -1);
  }).sort(function (a, b) { return b.revision - a.revision || b.timestamp.localeCompare(a.timestamp) || Number(b.id) - Number(a.id); });
}

function adminAuditLog_(body) {
  const database = loadDatabase_();
  requireAdmin_(database, body);
  const filters = body.filters || {};
  const rows = adminAuditRows_(database, filters);
  const offset = Math.max(0, Math.floor(Number(filters.offset) || 0));
  const limit = Math.max(1, Math.min(100, Math.floor(Number(filters.limit) || 25)));
  return { revision: getRevisionFromDb_(database), total: rows.length, offset: offset, limit: limit, entries: rows.slice(offset, offset + limit) };
}

function buildAdminDiagnostics_(database) {
  const diagnostics = [];
  const schema = database.Meta.find(function (row) { return row.key === 'schema_version'; });
  diagnostics.push({ code: 'SCHEMA', level: schema && String(schema.value) === SCHEDULER_CONFIG.schemaVersion ? 'ok' : 'error', message: schema && String(schema.value) === SCHEDULER_CONFIG.schemaVersion ? 'Schema is current.' : 'Schema requires upgradeSchedulerSchema().' });
  try { assertDatabaseIntegrity_(database); diagnostics.push({ code: 'INTEGRITY', level: 'ok', message: 'Relational integrity checks passed.' }); }
  catch (error) { diagnostics.push({ code: 'INTEGRITY', level: 'error', message: error.code === 'INTEGRITY_ERROR' ? error.message : 'Integrity validation failed.' }); }
  const missingPreferences = database.Users.filter(function (user) { return isActive_(user.active) && !database.UserPreferences.some(function (row) { return row.user_id === user.user_id; }); }).length;
  diagnostics.push({ code: 'PREFERENCES', level: missingPreferences ? 'error' : 'ok', message: missingPreferences ? missingPreferences + ' active users have no preferences.' : 'All active users have preferences.' });
  const localCodes = database.Offerings.filter(function (row) { return isActive_(row.active) && String(row.external_code).indexOf('LOCAL-') === 0; }).length;
  if (localCodes) diagnostics.push({ code: 'LOCAL_CODES', level: 'warning', message: localCodes + ' offerings use temporary LOCAL-* codes.' });
  const noLessons = database.Offerings.filter(function (row) { return isActive_(row.active) && !database.Lessons.some(function (lesson) { return lesson.offering_id === row.offering_id && isActive_(lesson.active); }); }).length;
  if (noLessons) diagnostics.push({ code: 'NO_LESSONS', level: 'warning', message: noLessons + ' offerings have no active lessons (may be intentional).' });
  return diagnostics;
}

function adminOverview_(body) {
  const database = loadDatabase_();
  const actor = requireAdmin_(database, body);
  const schema = database.Meta.find(function (row) { return row.key === 'schema_version'; });
  let semesters = [];
  try { semesters = publicSemesters_(database); } catch (error) { /* The diagnostics screen remains available on broken schema. */ }
  const current = semesters.find(function (row) { return row.current; }) || null;
  return {
    actor: publicUser_(actor), revision: getRevisionFromDb_(database),
    schema: { current: schema ? String(schema.value) : null, expected: SCHEDULER_CONFIG.schemaVersion },
    semester: current, semesters: semesters,
    statistics: {
      usersTotal: database.Users.length, usersActive: database.Users.filter(function (row) { return isActive_(row.active); }).length,
      subjects: database.Subjects.length, offerings: database.Offerings.length, groups: database.Groups.length,
      lessons: database.Lessons.length, enrollments: database.Enrollments.length, auditEntries: database.AuditLog.length,
    },
    tables: Object.keys(SCHEDULER_SHEETS).map(function (name) { return { name: name, rows: database[name].length }; }),
    diagnostics: buildAdminDiagnostics_(database),
    users: database.Users.map(function (user) { return adminUserDto_(database, user, current && current.id); }).sort(function (a, b) { return a.displayName.localeCompare(b.displayName); }),
    recentAudit: adminAuditRows_(database, {}).slice(0, 8),
    auditOptions: {
      actions: Array.from(new Set(database.AuditLog.map(function (row) { return row.action; }))).sort(),
      entityTypes: Array.from(new Set(database.AuditLog.map(function (row) { return row.entity_type; }))).sort(),
    },
  };
}

function adminUserDetails_(body) {
  const database = loadDatabase_();
  requireAdmin_(database, body);
  const target = database.Users.find(function (row) { return row.user_id === body.targetUserId; });
  if (!target) throw schedulerError_('USER_NOT_FOUND', 'User was not found.');
  const semesterId = body.semesterId || getCurrentSemesterId_(database);
  const semester = publicSemesters_(database).find(function (row) { return row.id === semesterId; });
  if (!semester) throw schedulerError_('SEMESTER_NOT_FOUND', 'Semester was not found.');
  const offerings = database.Offerings.filter(function (row) { return row.semester_id === semesterId && isActive_(row.active); });
  const catalog = offerings.map(function (offering) {
    const subject = database.Subjects.find(function (row) { return row.subject_id === offering.subject_id; });
    return {
      offeringId: offering.offering_id, externalCode: offering.external_code,
      subject: { id: offering.subject_id, name: subject ? subject.name : '[Missing subject]', shortName: subject ? subject.short_name : '', color: subject ? subject.color : '' },
      availableGroups: database.Groups.filter(function (row) { return row.offering_id === offering.offering_id && isActive_(row.active); }).map(function (row) { return Number(row.group_number); }).sort(function (a, b) { return a - b; }),
    };
  }).sort(function (a, b) { return a.subject.name.localeCompare(b.subject.name); });
  const offeringIds = new Set(offerings.map(function (row) { return row.offering_id; }));
  const enrollments = database.Enrollments.filter(function (row) { return row.user_id === target.user_id && isActive_(row.active) && offeringIds.has(row.offering_id); }).map(function (row) {
    const group = database.Groups.find(function (item) { return item.group_id === row.group_id; });
    const offering = offerings.find(function (item) { return item.offering_id === row.offering_id; });
    return { offeringId: row.offering_id, externalCode: offering.external_code, selectedGroup: group ? Number(group.group_number) : null };
  });
  const preferences = database.UserPreferences.some(function (row) { return row.user_id === target.user_id; }) ? getUserPreferences_(database, target.user_id).preferences : null;
  return { revision: getRevisionFromDb_(database), user: adminUserDto_(database, target, semesterId), semester: semester, catalog: catalog, enrollments: enrollments, preferences: preferences, recentAudit: adminAuditRows_(database, { actorId: target.user_id }).slice(0, 8) };
}
