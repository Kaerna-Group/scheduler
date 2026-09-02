function getCurrentSemesterId_(database) {
  const configured = database.Meta.find(function (row) { return row.key === 'current_semester_id'; });
  const configuredSemester = configured && database.Semesters.find(function (row) {
    return row.semester_id === configured.value && isActive_(row.active);
  });
  if (configuredSemester) return configuredSemester.semester_id;
  const active = database.Semesters.filter(function (row) { return isActive_(row.active); }).sort(function (first, second) {
    return String(second.start_date).localeCompare(String(first.start_date));
  });
  if (active.length) return active[0].semester_id;
  throw schedulerError_('SEMESTER_NOT_FOUND', 'No active semester is configured.');
}

function setCurrentSemesterId_(database, semesterId) {
  const row = database.Meta.find(function (item) { return item.key === 'current_semester_id'; });
  if (row) row.value = semesterId;
  else database.Meta.push({ key: 'current_semester_id', value: semesterId });
}

function publicSemesters_(database) {
  const currentSemesterId = getCurrentSemesterId_(database);
  return database.Semesters.map(function (row) {
    return {
      id: row.semester_id,
      title: row.title,
      startDate: row.start_date,
      weeksCount: Number(row.weeks_count),
      archived: !isActive_(row.active),
      current: row.semester_id === currentSemesterId,
    };
  }).sort(function (first, second) { return second.startDate.localeCompare(first.startDate); });
}

function requireSemesterAdmin_(database, body) {
  const actor = authenticateEditToken_(database, body.editToken);
  requireRole_(actor, ['admin']);
  const currentRevision = getRevisionFromDb_(database);
  if (Number(body.baseRevision) !== currentRevision) {
    throw schedulerError_('STALE_DATA', 'Semester data changed. Refresh before saving.', {
      expectedRevision: currentRevision, receivedRevision: Number(body.baseRevision),
    });
  }
  return { actor: actor, currentRevision: currentRevision };
}

function createSemester_(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(SCHEDULER_CONFIG.lockTimeoutMs);
  try {
    const database = loadDatabase_();
    const authorization = requireSemesterAdmin_(database, body);
    const input = body.semester || {};
    const semesterId = String(input.id || '').trim().toUpperCase();
    const title = String(input.title || '').trim();
    const startDate = String(input.startDate || '').trim();
    const weeksCount = Number(input.weeksCount);
    if (!/^[A-Z0-9-]{4,48}$/.test(semesterId)) throw schedulerError_('VALIDATION_ERROR', 'Semester id must contain 4–48 uppercase letters, digits, or hyphens.');
    if (!title) throw schedulerError_('VALIDATION_ERROR', 'Semester title is required.');
    const parsedDate = new Date(startDate + 'T00:00:00.000Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== startDate) throw schedulerError_('VALIDATION_ERROR', 'startDate must be a valid YYYY-MM-DD date.');
    if (!Number.isInteger(weeksCount) || weeksCount < 1 || weeksCount > 30) throw schedulerError_('VALIDATION_ERROR', 'weeksCount must be an integer from 1 to 30.');
    if (database.Semesters.some(function (row) { return row.semester_id === semesterId; })) throw schedulerError_('SEMESTER_EXISTS', 'Semester id already exists: ' + semesterId);

    const sourceSemesterId = String(body.sourceSemesterId || '').trim();
    const source = sourceSemesterId ? database.Semesters.find(function (row) { return row.semester_id === sourceSemesterId; }) : null;
    if (sourceSemesterId && !source) throw schedulerError_('SEMESTER_NOT_FOUND', 'Source semester was not found: ' + sourceSemesterId);
    const semester = { semester_id: semesterId, title: title, start_date: startDate, weeks_count: String(weeksCount), active: 'yes' };
    database.Semesters.push(semester);
    const changes = [{ action: 'CREATE', entityType: 'Semester', entityId: semesterId, oldValue: null, newValue: semester }];

    let copiedSubjects = 0;
    if (source && body.copySubjects !== false) {
      database.Offerings.filter(function (offering) { return offering.semester_id === source.semester_id && isActive_(offering.active); }).forEach(function (offering) {
        const sourceSubject = database.Subjects.find(function (subject) { return subject.subject_id === offering.subject_id; });
        if (!sourceSubject) return;
        const subject = Object.assign({}, sourceSubject, { subject_id: newId_('SUB') });
        const copiedOffering = Object.assign({}, offering, {
          offering_id: newId_('OFF'), semester_id: semesterId, subject_id: subject.subject_id,
        });
        database.Subjects.push(subject);
        database.Offerings.push(copiedOffering);
        changes.push({ action: 'CREATE', entityType: 'Subject', entityId: subject.subject_id, oldValue: null, newValue: subject });
        changes.push({ action: 'CREATE', entityType: 'Offering', entityId: copiedOffering.offering_id, oldValue: null, newValue: copiedOffering });
        copiedSubjects += 1;
      });
    }
    if (body.makeCurrent !== false) setCurrentSemesterId_(database, semesterId);
    const nextRevision = authorization.currentRevision + 1;
    setRevisionInDb_(database, nextRevision);
    appendAuditChanges_(database, authorization.actor, changes, nextRevision);
    assertDatabaseIntegrity_(database);
    persistDatabase_(database, ['Semesters', 'Subjects', 'Offerings', 'Meta', 'AuditLog']);
    return { revision: nextRevision, semester: publicSemesters_(database).find(function (item) { return item.id === semesterId; }), semesters: publicSemesters_(database), copiedSubjects: copiedSubjects };
  } finally { lock.releaseLock(); }
}

function setCurrentSemester_(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(SCHEDULER_CONFIG.lockTimeoutMs);
  try {
    const database = loadDatabase_();
    const authorization = requireSemesterAdmin_(database, body);
    const semester = database.Semesters.find(function (row) { return row.semester_id === body.semesterId && isActive_(row.active); });
    if (!semester) throw schedulerError_('SEMESTER_NOT_FOUND', 'Current semester must be active.');
    const previous = getCurrentSemesterId_(database);
    if (previous === semester.semester_id) return { revision: authorization.currentRevision, semesters: publicSemesters_(database) };
    setCurrentSemesterId_(database, semester.semester_id);
    const nextRevision = authorization.currentRevision + 1;
    setRevisionInDb_(database, nextRevision);
    appendAuditChanges_(database, authorization.actor, [{ action: 'SET_CURRENT', entityType: 'Semester', entityId: semester.semester_id, oldValue: { currentSemesterId: previous }, newValue: { currentSemesterId: semester.semester_id } }], nextRevision);
    assertDatabaseIntegrity_(database);
    persistDatabase_(database, ['Meta', 'AuditLog']);
    return { revision: nextRevision, semesters: publicSemesters_(database) };
  } finally { lock.releaseLock(); }
}

function archiveSemester_(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(SCHEDULER_CONFIG.lockTimeoutMs);
  try {
    const database = loadDatabase_();
    const authorization = requireSemesterAdmin_(database, body);
    const semester = database.Semesters.find(function (row) { return row.semester_id === body.semesterId; });
    if (!semester) throw schedulerError_('SEMESTER_NOT_FOUND', 'Semester was not found.');
    if (semester.semester_id === getCurrentSemesterId_(database)) throw schedulerError_('CURRENT_SEMESTER', 'Select another current semester before archiving this one.');
    if (!isActive_(semester.active)) return { revision: authorization.currentRevision, semesters: publicSemesters_(database) };
    const previous = Object.assign({}, semester);
    semester.active = 'no';
    const nextRevision = authorization.currentRevision + 1;
    setRevisionInDb_(database, nextRevision);
    appendAuditChanges_(database, authorization.actor, [{ action: 'ARCHIVE', entityType: 'Semester', entityId: semester.semester_id, oldValue: previous, newValue: semester }], nextRevision);
    assertDatabaseIntegrity_(database);
    persistDatabase_(database, ['Semesters', 'Meta', 'AuditLog']);
    return { revision: nextRevision, semesters: publicSemesters_(database) };
  } finally { lock.releaseLock(); }
}
