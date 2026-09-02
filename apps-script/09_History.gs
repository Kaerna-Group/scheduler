function parseAuditValue_(value) {
  if (value === '' || value === undefined || value === null) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(String(value)); } catch (error) { return String(value); }
}

function findLatestReversibleImport_(database) {
  const undoneRevisions = new Set(database.AuditLog.filter(function (row) {
    return row.entity_type === 'Import' && row.action === 'UNDO_IMPORT';
  }).map(function (row) {
    const value = parseAuditValue_(row.new_value) || {};
    return Number(value.undoneRevision);
  }));
  const marker = database.AuditLog.filter(function (row) {
    return row.entity_type === 'Import' && row.action === 'IMPORT' && !undoneRevisions.has(Number(row.revision));
  }).sort(function (first, second) { return Number(second.revision) - Number(first.revision); })[0];
  if (!marker) return { available: false, reason: 'No reversible import was found.' };

  const importRevision = Number(marker.revision);
  const currentRevision = getRevisionFromDb_(database);
  const metadata = parseAuditValue_(marker.new_value) || {};
  if (importRevision !== currentRevision) {
    return {
      available: false,
      reason: 'Newer schedule changes exist after the last import.',
      importRevision: importRevision,
      marker: marker,
      metadata: metadata,
    };
  }
  return {
    available: true,
    reason: '',
    importRevision: importRevision,
    marker: marker,
    metadata: metadata,
  };
}

function buildScheduleHistory_(userSlug, semesterId, requestedLimit, providedDatabase) {
  const database = providedDatabase || loadDatabase_();
  const user = database.Users.find(function (row) { return row.slug === userSlug && isActive_(row.active); });
  if (!user) throw schedulerError_('USER_NOT_FOUND', 'Unknown or inactive user: ' + userSlug);

  const targetSemesterId = semesterId || getCurrentSemesterId_(database);
  const semester = database.Semesters.find(function (row) {
    return row.semester_id === targetSemesterId;
  });
  if (!semester) throw schedulerError_('SEMESTER_NOT_FOUND', 'Unknown or inactive semester: ' + targetSemesterId);

  const limit = Math.min(Math.max(Number(requestedLimit) || 100, 1), 200);
  const usersById = {};
  database.Users.forEach(function (row) { usersById[row.user_id] = row; });
  const subjectsById = {};
  database.Subjects.forEach(function (row) { subjectsById[row.subject_id] = row; });
  const offeringsById = {};
  database.Offerings.forEach(function (row) { offeringsById[row.offering_id] = row; });
  const lessonsById = {};
  database.Lessons.forEach(function (row) { lessonsById[row.lesson_id] = row; });
  const groupsById = {};
  database.Groups.forEach(function (row) { groupsById[row.group_id] = row; });
  const enrollmentsById = {};
  database.Enrollments.forEach(function (row) { enrollmentsById[row.enrollment_id] = row; });
  const userOfferingIds = new Set(database.Enrollments.filter(function (row) {
    const offering = offeringsById[row.offering_id];
    return row.user_id === user.user_id && offering && offering.semester_id === targetSemesterId;
  }).map(function (row) { return row.offering_id; }));
  const replacementKeys = new Set(database.AuditLog.filter(function (row) {
    return row.entity_type === 'Lesson' && row.action === 'REPLACE' && lessonsById[row.entity_id];
  }).map(function (row) {
    return String(row.revision) + ':' + lessonsById[row.entity_id].offering_id;
  }));

  function offeringForAudit(row, oldValue, newValue) {
    if (row.entity_type === 'Lesson') {
      const lesson = lessonsById[row.entity_id];
      return lesson ? offeringsById[lesson.offering_id] : null;
    }
    if (row.entity_type === 'Subject') {
      return database.Offerings.find(function (offering) {
        return offering.subject_id === row.entity_id && offering.semester_id === targetSemesterId;
      }) || null;
    }
    if (row.entity_type === 'Offering') {
      return offeringsById[row.entity_id] || null;
    }
    if (row.entity_type === 'Group') {
      const group = groupsById[row.entity_id];
      return group ? offeringsById[group.offering_id] : null;
    }
    if (row.entity_type === 'Enrollment') {
      const enrollment = enrollmentsById[row.entity_id] || newValue || oldValue;
      return enrollment && enrollment.offering_id ? offeringsById[enrollment.offering_id] : null;
    }
    return null;
  }

  const events = database.AuditLog.map(function (row, index) {
    const oldValue = parseAuditValue_(row.old_value);
    const newValue = parseAuditValue_(row.new_value);
    if (row.entity_type === 'Import') {
      const metadata = newValue || oldValue || {};
      if (metadata.targetUserSlug && metadata.targetUserSlug !== user.slug) return null;
      if (row.action !== 'IMPORT' && row.action !== 'UNDO_IMPORT') return null;
      const actor = usersById[row.actor_user_id];
      return {
        id: String(row.revision) + ':' + String(index) + ':' + row.entity_id,
        timestamp: String(row.timestamp || ''),
        revision: Number(row.revision) || 0,
        action: String(row.action || ''),
        entityType: 'Import',
        entityId: String(row.entity_id || ''),
        scope: 'shared',
        actor: {
          id: actor ? actor.user_id : String(row.actor_user_id || ''),
          slug: actor ? actor.slug : String(row.actor_slug || 'system'),
          displayName: actor ? actor.display_name : String(row.actor_slug || 'System'),
        },
        subject: null,
        oldValue: oldValue,
        newValue: newValue,
      };
    }
    if (['Lesson', 'Subject', 'Offering', 'Group', 'Enrollment'].indexOf(row.entity_type) === -1) return null;
    if (row.entity_type === 'Offering' && row.action === 'CREATE') return null;
    const offering = offeringForAudit(row, oldValue, newValue);
    if (!offering || offering.semester_id !== targetSemesterId) return null;
    if (row.entity_type !== 'Enrollment' && !userOfferingIds.has(offering.offering_id)) return null;
    if (row.entity_type === 'Lesson' && (row.action === 'UPDATE' || row.action === 'DEACTIVATE') &&
        replacementKeys.has(String(row.revision) + ':' + offering.offering_id)) return null;

    let scope = 'shared';
    if (row.entity_type === 'Enrollment') {
      const enrollment = enrollmentsById[row.entity_id] || newValue || oldValue;
      if (!enrollment || enrollment.user_id !== user.user_id) return null;
      scope = 'personal';
    }

    const subject = subjectsById[offering.subject_id];
    if (!subject) return null;
    const actor = usersById[row.actor_user_id];
    return {
      id: String(row.revision) + ':' + String(index) + ':' + row.entity_id,
      timestamp: String(row.timestamp || ''),
      revision: Number(row.revision) || 0,
      action: String(row.action || ''),
      entityType: String(row.entity_type || ''),
      entityId: String(row.entity_id || ''),
      scope: scope,
      actor: {
        id: actor ? actor.user_id : String(row.actor_user_id || ''),
        slug: actor ? actor.slug : String(row.actor_slug || 'system'),
        displayName: actor ? actor.display_name : (row.actor_slug === 'system' ? 'System' : String(row.actor_slug || 'Unknown user')),
      },
      subject: {
        id: subject.subject_id,
        offeringId: offering.offering_id,
        externalCode: offering.external_code,
        name: subject.name,
        shortName: subject.short_name || subject.name,
        color: subject.color,
      },
      oldValue: oldValue,
      newValue: newValue,
    };
  }).filter(Boolean).sort(function (first, second) {
    return second.timestamp.localeCompare(first.timestamp) || second.revision - first.revision;
  }).slice(0, limit);

  const reversible = findLatestReversibleImport_(database);
  const reversibleActor = reversible.marker ? usersById[reversible.marker.actor_user_id] : null;
  return {
    user: publicUser_(user),
    semesterId: targetSemesterId,
    revision: getRevisionFromDb_(database),
    events: events,
    undo: {
      available: reversible.available,
      reason: reversible.reason,
      importRevision: reversible.importRevision || null,
      timestamp: reversible.marker ? String(reversible.marker.timestamp || '') : null,
      targetUserSlug: reversible.metadata ? String(reversible.metadata.targetUserSlug || '') : null,
      actorDisplayName: reversible.marker ? (reversibleActor ? reversibleActor.display_name : String(reversible.marker.actor_slug || 'Unknown user')) : null,
    },
  };
}
