import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const configSource = readFileSync(new URL('../apps-script/00_Config.gs', import.meta.url), 'utf8');
const preferencesSource = readFileSync(new URL('../apps-script/08_Preferences.gs', import.meta.url), 'utf8');
const persistedTables = [];
const database = {
  Users: [{ user_id: 'USR-1', slug: 'ermolz', display_name: 'Ermolz', role: 'editor', active: 'yes' }],
  UserPreferences: [],
  Meta: [{ key: 'data_revision', value: '17' }],
  AuditLog: [],
};
const context = {
  console, Set, Map, Date, JSON, Object, Array, Number, String, Error,
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  loadDatabase_: () => database,
  authenticateEditToken_: () => database.Users[0],
  getRevisionFromDb_: (value) => Number(value.Meta[0].value),
  appendAuditChanges_: (value, actor, changes, revision) => value.AuditLog.push({ actor, changes, revision }),
  persistDatabase_: (value, tables) => persistedTables.push(...tables),
};

vm.runInNewContext(`${configSource}\n${preferencesSource}\nglobalThis.preferencesTestApi = { updatePreferences_, normalizePreferencesPatch_, getUserPreferences_, createDefaultPreferenceRow_ };`, context);
const { updatePreferences_, normalizePreferencesPatch_, getUserPreferences_, createDefaultPreferenceRow_ } = context.preferencesTestApi;

assert.equal(getUserPreferences_(database, 'USR-1').preferencesExists, false);
database.UserPreferences.push(createDefaultPreferenceRow_('USR-1'));
assert.equal(getUserPreferences_(database, 'USR-1').preferencesExists, false, 'revision 0 is an uninitialized migration row');

const first = updatePreferences_({
  userSlug: 'ermolz', editToken: 'secret', baseSettingsRevision: 0,
  patch: { appearance: { themeId: 'graphite-current', mode: 'dark' } },
});
assert.equal(first.preferences.appearance.themeId, 'graphite-current');
assert.equal(first.preferences.schedule.density, 'comfortable', 'an appearance patch must preserve schedule settings');
assert.equal(first.preferencesRevision, 1);
assert.equal(getUserPreferences_(database, 'USR-1').preferencesExists, true);
assert.equal(database.Meta[0].value, '17', 'preference updates must not increment schedule revision');
assert.deepEqual(persistedTables, ['UserPreferences', 'AuditLog']);
assert.equal(database.AuditLog[0].revision, 17);

assert.throws(
  () => updatePreferences_({ userSlug: 'ermolz', editToken: 'secret', baseSettingsRevision: 0, patch: { schedule: { density: 'compact' } } }),
  (error) => error.code === 'SETTINGS_STALE' && error.details.preferencesRevision === 1,
);
assert.throws(() => normalizePreferencesPatch_({ schedule: { density: 'tiny' } }), (error) => error.code === 'VALIDATION_ERROR');
assert.throws(() => normalizePreferencesPatch_({ secret: true }), (error) => error.code === 'VALIDATION_ERROR');
assert.throws(
  () => updatePreferences_({ userSlug: 'another-user', editToken: 'secret', baseSettingsRevision: 1, patch: { schedule: { density: 'compact' } } }),
  (error) => error.code === 'FORBIDDEN',
);

console.log('Apps Script preferences tests passed');
