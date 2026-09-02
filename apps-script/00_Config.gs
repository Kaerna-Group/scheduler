const SCHEDULER_CONFIG = Object.freeze({
  apiVersion: 1,
  scheduleCacheVersion: 1,
  scheduleCacheTtlSeconds: 300,
  scheduleCacheMaxBytes: 90000,
  cacheWritePendingProperty: 'SCHEDULER_CACHE_WRITE_PENDING',
  cacheRecoveryEpochProperty: 'SCHEDULER_CACHE_RECOVERY_EPOCH',
  spreadsheetProperty: 'SCHEDULER_SPREADSHEET_ID',
  schemaVersion: '2',
  migrationJournalProperty: 'SCHEDULER_SCHEMA_MIGRATION',
  migrationChunkPrefix: 'SCHEDULER_SCHEMA_MIGRATION_CHUNK_',
  migrationMaxBytes: 200000,
  revisionKey: 'data_revision',
  tokenBytes: 32,
  lockTimeoutMs: 30000,
});

const SCHEDULER_SHEETS = Object.freeze({
  Users: ['user_id', 'slug', 'display_name', 'role', 'edit_token_hash', 'active'],
  UserPreferences: ['user_id', 'preferences_version', 'appearance_mode', 'theme_id', 'system_light_theme_id', 'system_dark_theme_id', 'reduced_motion', 'default_view', 'initial_week', 'show_empty_days', 'density', 'highlight_conflicts', 'show_saturday', 'remember_subject_filter', 'refresh_on_open', 'settings_revision', 'updated_at'],
  Semesters: ['semester_id', 'title', 'start_date', 'weeks_count', 'active'],
  Subjects: ['subject_id', 'name', 'short_name', 'color', 'active'],
  Offerings: ['offering_id', 'semester_id', 'subject_id', 'external_code', 'active'],
  Groups: ['group_id', 'offering_id', 'group_number', 'label', 'active'],
  Enrollments: ['enrollment_id', 'user_id', 'offering_id', 'group_id', 'active'],
  Lessons: ['lesson_id', 'offering_id', 'type', 'day', 'start_time', 'end_time', 'format', 'room', 'teacher', 'active'],
  LessonGroups: ['lesson_id', 'group_id'],
  LessonWeeks: ['lesson_id', 'week'],
  Meta: ['key', 'value'],
  AuditLog: ['timestamp', 'actor_user_id', 'actor_slug', 'action', 'entity_type', 'entity_id', 'old_value', 'new_value', 'revision'],
});

const ALLOWED_DAYS = Object.freeze(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']);
const ALLOWED_FORMATS = Object.freeze(['online', 'offline', 'hybrid']);
const ALLOWED_LESSON_TYPES = Object.freeze(['lecture', 'group']);
const ALLOWED_ROLES = Object.freeze(['user', 'editor', 'admin']);
const ALLOWED_THEME_MODES = Object.freeze(['light', 'dark', 'system']);
const ALLOWED_THEME_IDS = Object.freeze(['air-light', 'paper-current', 'stone-light', 'azure-notebook', 'sage-morning', 'midnight-black', 'graphite-current', 'dusk-gray', 'navy-electric', 'plum-night']);
const ALLOWED_LIGHT_THEME_IDS = Object.freeze(['air-light', 'paper-current', 'stone-light', 'azure-notebook', 'sage-morning']);
const ALLOWED_DARK_THEME_IDS = Object.freeze(['midnight-black', 'graphite-current', 'dusk-gray', 'navy-electric', 'plum-night']);
const ALLOWED_REDUCED_MOTION = Object.freeze(['system', 'reduce', 'allow']);
const ALLOWED_DEFAULT_VIEWS = Object.freeze(['today', 'week', 'subjects']);
const ALLOWED_INITIAL_WEEKS = Object.freeze(['current', 'last-opened']);
const ALLOWED_DENSITIES = Object.freeze(['comfortable', 'compact']);

function schedulerError_(code, message, details) {
  const error = new Error(message);
  error.code = code;
  error.details = details || null;
  return error;
}

function isActive_(value) {
  return String(value).toLowerCase() === 'yes' || value === true || String(value) === '1';
}

function newId_(prefix) {
  return prefix + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 16).toUpperCase();
}

function nowIso_() {
  return new Date().toISOString();
}
