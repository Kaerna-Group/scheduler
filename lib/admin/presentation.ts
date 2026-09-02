import type { AdminAuditEntry, AdminUserDetails } from './types';

const actions: Record<string, string> = {
  CREATE: 'Created',
  UPDATE: 'Updated',
  DELETE: 'Removed',
  ACTIVATE: 'Reactivated',
  DEACTIVATE: 'Deactivated',
  ROTATE_TOKEN: 'Rotated edit token',
  IMPORT: 'Imported',
  UNDO_IMPORT: 'Undid import',
  ARCHIVE: 'Archived',
};
const fields: Record<string, string> = {
  display_name: 'Name',
  role: 'Role',
  active: 'Active',
  group_id: 'Group',
  room: 'Room',
  weeks: 'Weeks',
  start_time: 'Start',
  end_time: 'End',
  day: 'Day',
  title: 'Title',
  name: 'Name',
  location: 'Location',
};

export function auditSummary(entry: AdminAuditEntry) {
  const old =
    entry.oldValue && typeof entry.oldValue === 'object'
      ? (entry.oldValue as Record<string, unknown>)
      : {};
  const next =
    entry.newValue && typeof entry.newValue === 'object'
      ? (entry.newValue as Record<string, unknown>)
      : {};
  const changes = Object.entries(fields)
    .filter(
      ([key]) =>
        key in old &&
        key in next &&
        JSON.stringify(old[key]) !== JSON.stringify(next[key]),
    )
    .map(
      ([key, label]) => `${label}: ${String(old[key])} → ${String(next[key])}`,
    );
  return `${actions[entry.action] ?? entry.action} ${entry.entityType}: ${entry.label}${changes.length ? ` · ${changes.join('; ')}` : ''}`;
}

export function enrollmentDraft(
  details: AdminUserDetails,
): Record<string, number | null> {
  return Object.fromEntries(
    details.enrollments.map((item) => [item.externalCode, item.selectedGroup]),
  );
}

export function enrollmentPayload(draft: Record<string, number | null>) {
  return Object.entries(draft).map(([externalCode, selectedGroup]) => ({
    externalCode,
    selectedGroup: selectedGroup ?? undefined,
  }));
}
