function migrateSchema002_(database) {
  return repairSchema002_(database);
}

// Repairs are separate from version transitions: a completed migration is never
// rerun just because a current-schema database needs missing default rows.
function repairSchema002_(database) {
  let preferenceRowsAdded = 0;
  const existing = new Set(database.UserPreferences.map(function (row) { return row.user_id; }));
  database.Users.forEach(function (user) {
    if (existing.has(user.user_id)) return;
    // Historical defaults, intentionally independent of future UI defaults.
    database.UserPreferences.push({
      user_id: user.user_id, preferences_version: '1', appearance_mode: 'light',
      theme_id: 'paper-current', system_light_theme_id: 'paper-current',
      system_dark_theme_id: 'graphite-current', reduced_motion: 'system',
      default_view: 'week', initial_week: 'last-opened', show_empty_days: 'yes',
      density: 'comfortable', highlight_conflicts: 'yes', show_saturday: 'yes',
      remember_subject_filter: 'no', refresh_on_open: 'yes', settings_revision: '0',
      updated_at: nowIso_(),
    });
    existing.add(user.user_id);
    preferenceRowsAdded += 1;
  });
  const currentSemesterAdded = database.Semesters.length > 0 &&
    !database.Meta.some(function (row) { return row.key === 'current_semester_id'; });
  if (currentSemesterAdded) {
    database.Meta.push({ key: 'current_semester_id', value: getCurrentSemesterId_(database) });
  }
  return { preferenceRowsAdded: preferenceRowsAdded, currentSemesterAdded: currentSemesterAdded };
}
