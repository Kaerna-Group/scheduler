import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';

// Execute the actual backend together, with real SHA-256 authentication and integrity
// validation. Only Apps Script I/O is replaced; writes commit a fresh database snapshot.
const directory = new URL('../apps-script/', import.meta.url);
const source = readdirSync(directory)
  .filter((name) => /^\d+_.*\.gs$/.test(name))
  .sort()
  .map((name) => readFileSync(new URL(name, directory), 'utf8'))
  .join('\n');
let database;
let writes = 0;
let locks = 0;
const context = vm.createContext({
  console: { error() {} },
  Utilities: {
    getUuid: randomUUID,
    DigestAlgorithm: { SHA_256: 'sha256' },
    Charset: { UTF_8: 'utf8' },
    computeDigest: (algorithm, value) => [
      ...createHash(algorithm).update(value).digest(),
    ],
    base64EncodeWebSafe: (bytes) => Buffer.from(bytes).toString('base64url'),
  },
  LockService: {
    getScriptLock: () => ({
      waitLock() {
        locks += 1;
      },
      releaseLock() {
        locks -= 1;
      },
    }),
  },
  ContentService: {
    MimeType: { JSON: 'application/json' },
    createTextOutput: (text) => ({ setMimeType: () => JSON.parse(text) }),
  },
});
vm.runInContext(source, context);
context.loadDatabase_ = () => structuredClone(database);
context.persistDatabase_ = (next, tables) => {
  assert.equal(locks, 1, 'all writes run under a lock');
  tables.forEach((name) => {
    database[name] = structuredClone(next[name]);
  });
  writes += 1;
};
const adminToken = 'test-admin-token-at-least-24-characters';
const revision = () => context.getRevisionFromDb_(database);
const post = (action, body = {}, token = adminToken) =>
  context.doPost({
    postData: {
      contents: JSON.stringify({ action, editToken: token, ...body }),
    },
  });
const success = (action, body = {}, token = adminToken) => {
  const response = post(action, body, token);
  assert.equal(response.ok, true, JSON.stringify(response));
  assert.equal(locks, 0);
  return response.data;
};
const reject = (action, body, code, token = adminToken) => {
  const before = JSON.stringify(database);
  const count = writes;
  const response = post(action, body, token);
  assert.equal(response.ok, false, `${action} must fail`);
  assert.equal(response.error.code, code, JSON.stringify(response));
  assert.equal(writes, count);
  assert.equal(JSON.stringify(database), before);
  assert.equal(locks, 0);
};
const reset = () => {
  database = structuredClone(context.createSeedDatabase_(adminToken));
  writes = 0;
};
const create = (slug, role = 'user') =>
  success('adminCreateUser', {
    baseRevision: revision(),
    displayName: `User ${slug}`,
    slug,
    role,
  });
reset();
context.assertDatabaseIntegrity_(database);
const member = create('member');
const editor = create('editor', 'editor');

for (const action of [
  'adminOverview',
  'adminUserDetails',
  'adminAuditLog',
  'adminCreateUser',
  'adminUpdateUser',
  'adminSetUserActive',
  'adminRotateUserToken',
]) {
  for (const token of [
    '',
    'not-a-token',
    'random-invalid-but-long-enough-token',
  ])
    reject(action, {}, 'UNAUTHORIZED', token);
  for (const token of [member.editToken, editor.editToken])
    reject(action, { role: 'admin', userSlug: 'ermolz' }, 'FORBIDDEN', token);
  const get = context.doGet({ parameter: { action, editToken: adminToken } });
  assert.equal(
    get.error.code,
    'UNKNOWN_ACTION',
    'admin endpoints are POST-only',
  );
}
assert.equal(success('adminOverview').actor.id, 'U001');
assert.equal(success('adminOverview').users.length, 3);
assert.ok(
  database.UserPreferences.some((row) => row.user_id === member.user.id),
);
assert.equal(member.user.enrollmentCount, 0);
assert.equal(member.user.preferencesRevision, 0);
const detail = success('adminUserDetails', { targetUserId: member.user.id });
assert.equal(detail.enrollments.length, 0);
assert.equal(
  detail.catalog.length,
  database.Offerings.length,
  'user receives the global semester catalog, not just owned courses',
);
assert.ok(detail.preferences.appearance);
assert.equal(detail.semester.current, true);
reject('adminUserDetails', { targetUserId: 'missing' }, 'USER_NOT_FOUND');
reject(
  'adminUserDetails',
  { targetUserId: member.user.id, semesterId: 'missing' },
  'SEMESTER_NOT_FOUND',
);

for (const baseRevision of [undefined, null, '3', revision() - 1, 1.5]) {
  reject(
    'adminCreateUser',
    { baseRevision, displayName: 'Bad', slug: 'bad' },
    'STALE_DATA',
  );
  reject(
    'adminUpdateUser',
    { baseRevision, targetUserId: member.user.id, patch: { role: 'admin' } },
    'STALE_DATA',
  );
  reject(
    'adminSetUserActive',
    { baseRevision, targetUserId: member.user.id, active: false },
    'STALE_DATA',
  );
  reject(
    'adminRotateUserToken',
    { baseRevision, targetUserId: member.user.id },
    'STALE_DATA',
  );
}
for (const slug of ['member', ' Member '])
  reject(
    'adminCreateUser',
    { baseRevision: revision(), displayName: 'Other', slug },
    'USER_EXISTS',
  );
for (const slug of ['', 'x', '-bad', 'bad name', 'a'.repeat(41)])
  reject(
    'adminCreateUser',
    { baseRevision: revision(), displayName: 'Other', slug },
    'VALIDATION_ERROR',
  );
reject(
  'adminCreateUser',
  { baseRevision: revision(), displayName: ' ', slug: 'valid' },
  'VALIDATION_ERROR',
);
reject(
  'adminCreateUser',
  {
    baseRevision: revision(),
    displayName: 'Other',
    slug: 'valid',
    role: 'owner',
  },
  'VALIDATION_ERROR',
);
for (const patch of [
  { slug: 'renamed' },
  { user_id: 'changed' },
  { edit_token_hash: 'evil' },
  { role: 'owner' },
  { active: 'no' },
  { displayName: '' },
])
  reject(
    'adminUpdateUser',
    { baseRevision: revision(), targetUserId: member.user.id, patch },
    'VALIDATION_ERROR',
  );
reject(
  'adminSetUserActive',
  { baseRevision: revision(), targetUserId: member.user.id },
  'VALIDATION_ERROR',
);
reject(
  'adminSetUserActive',
  {
    baseRevision: revision(),
    targetUserId: member.user.id,
    active: true,
    rotateToken: 'false',
  },
  'VALIDATION_ERROR',
);
reject(
  'adminRotateUserToken',
  { baseRevision: revision(), targetUserId: 'missing' },
  'USER_NOT_FOUND',
);

// Last-admin protection applies to both APIs, including combined patches.
for (const patch of [
  { role: 'editor' },
  { active: false },
  { role: 'user', active: false },
])
  reject(
    'adminUpdateUser',
    { baseRevision: revision(), targetUserId: 'U001', patch },
    'FORBIDDEN_LAST_ADMIN',
  );
reject(
  'adminSetUserActive',
  { baseRevision: revision(), targetUserId: 'U001', active: false },
  'FORBIDDEN_LAST_ADMIN',
);
let beforeRevision = revision();
const renamed = success('adminUpdateUser', {
  baseRevision: revision(),
  targetUserId: member.user.id,
  patch: { displayName: '  Alice  ', role: 'editor' },
});
assert.equal(renamed.user.displayName, 'Alice');
assert.equal(renamed.user.slug, 'member');
assert.equal(renamed.user.role, 'editor');
assert.equal(renamed.revision, beforeRevision + 1);
assert.equal(renamed.editToken, undefined);
beforeRevision = revision();
success('adminUpdateUser', {
  baseRevision: revision(),
  targetUserId: member.user.id,
  patch: { displayName: 'Alice', role: 'editor' },
});
assert.equal(revision(), beforeRevision, 'no-op edits do not advance revision');

// Enrollment API reuse: admin may change another user, user/editor may not.
const enrollment = {
  userSlug: member.user.slug,
  semesterId: detail.semester.id,
  enrollments: [{ externalCode: '565095', selectedGroup: 2 }],
};
reject(
  'updateEnrollments',
  { ...enrollment, baseRevision: revision() },
  'FORBIDDEN',
  editor.editToken,
);
success('updateEnrollments', { ...enrollment, baseRevision: revision() });
let updated = success('adminUserDetails', { targetUserId: member.user.id });
assert.equal(updated.enrollments.length, 1);
assert.equal(updated.enrollments[0].selectedGroup, 2);
assert.equal(updated.catalog.length, 8);
reject(
  'updateEnrollments',
  { ...enrollment, baseRevision: revision() - 1 },
  'STALE_DATA',
);
reject(
  'updateEnrollments',
  {
    ...enrollment,
    baseRevision: revision(),
    enrollments: [{ externalCode: '565095', selectedGroup: 999 }],
  },
  'GROUP_NOT_FOUND',
);
const lessonsBefore = JSON.stringify(database.Lessons);
success('updateEnrollments', {
  ...enrollment,
  baseRevision: revision(),
  enrollments: [],
});
assert.equal(
  JSON.stringify(database.Lessons),
  lessonsBefore,
  'removing enrollment never deletes shared lessons',
);
assert.equal(
  success('adminUserDetails', { targetUserId: member.user.id }).enrollments
    .length,
  0,
);

// Deactivation preserves foreign-key data and invalidates authentication immediately.
const preferencesBefore = JSON.stringify(database.UserPreferences);
success('adminSetUserActive', {
  baseRevision: revision(),
  targetUserId: member.user.id,
  active: false,
});
reject('adminOverview', {}, 'UNAUTHORIZED', member.editToken);
assert.equal(
  success('adminUserDetails', { targetUserId: member.user.id }).user.active,
  false,
);
assert.equal(
  success('adminOverview').users.find((user) => user.id === member.user.id)
    .active,
  false,
);
assert.equal(
  context
    .buildUserSchedule_('ermolz')
    .users.some((user) => user.id === member.user.id),
  false,
);
assert.equal(JSON.stringify(database.UserPreferences), preferencesBefore);
reject(
  'adminCreateUser',
  { baseRevision: revision(), displayName: 'Reused', slug: 'member' },
  'USER_EXISTS',
);
reject(
  'updateEnrollments',
  { ...enrollment, baseRevision: revision() },
  'USER_NOT_FOUND',
);
const activated = success('adminSetUserActive', {
  baseRevision: revision(),
  targetUserId: member.user.id,
  active: true,
});
assert.ok(activated.editToken);
assert.notEqual(activated.editToken, member.editToken);
assert.throws(
  () => context.authenticateEditToken_(database, member.editToken),
  (error) => error.code === 'UNAUTHORIZED',
);
assert.equal(
  context.authenticateEditToken_(database, activated.editToken).user_id,
  member.user.id,
);
success('adminSetUserActive', {
  baseRevision: revision(),
  targetUserId: member.user.id,
  active: false,
});
const retained = success('adminSetUserActive', {
  baseRevision: revision(),
  targetUserId: member.user.id,
  active: true,
  rotateToken: false,
});
assert.equal(retained.editToken, undefined);
assert.equal(
  context.authenticateEditToken_(database, activated.editToken).user_id,
  member.user.id,
);
const rotated = success('adminRotateUserToken', {
  baseRevision: revision(),
  targetUserId: member.user.id,
});
assert.notEqual(rotated.editToken, activated.editToken);
assert.throws(
  () => context.authenticateEditToken_(database, activated.editToken),
  (error) => error.code === 'UNAUTHORIZED',
);
assert.equal(
  context.authenticateEditToken_(database, rotated.editToken).user_id,
  member.user.id,
);

// Audit filtering/paging, readable metadata and sanitization, including legacy rows.
database.AuditLog.push({
  timestamp: '2020-01-02T12:00:00.000Z',
  actor_user_id: member.user.id,
  actor_slug: 'member',
  action: 'LEGACY',
  entity_type: 'User',
  entity_id: member.user.id,
  revision: '0',
  old_value: JSON.stringify({
    edit_token_hash: 'hidden-hash',
    nested: {
      accessToken: 'hidden-token',
      password: 'hidden-password',
      safe: 'safe text',
    },
  }),
  new_value: 'malformed SECRET token',
});
const audit = success('adminAuditLog', {
  filters: {
    actorId: member.user.id,
    action: 'LEGACY',
    entityType: 'User',
    from: '2020-01-02',
    to: '2020-01-02',
    search: 'safe text',
    limit: 1,
  },
});
assert.equal(audit.total, 1);
assert.equal(audit.entries[0].actorName, 'Alice');
assert.equal(audit.entries[0].label, 'Alice');
assert.equal(audit.entries[0].newValue, null);
assert.deepEqual(audit.entries[0].oldValue, { nested: { safe: 'safe text' } });
assert.equal(
  success('adminAuditLog', { filters: { search: 'hidden-token' } }).total,
  0,
);
const page1 = success('adminAuditLog', { filters: { limit: 2 } });
const page2 = success('adminAuditLog', { filters: { offset: 2, limit: 2 } });
assert.equal(page1.entries.length, 2);
assert.equal(page2.offset, 2);
assert.notEqual(page1.entries[1].id, page2.entries[0].id);
assert.ok(page1.entries[0].revision >= page1.entries[1].revision);
reject(
  'adminAuditLog',
  { filters: { from: '2021-01-01', to: '2020-01-01' } },
  'VALIDATION_ERROR',
);
const exposed = JSON.stringify([
  success('adminOverview'),
  success('adminUserDetails', { targetUserId: member.user.id }),
  success('adminAuditLog'),
]);
for (const secret of [
  adminToken,
  member.editToken,
  rotated.editToken,
  'hidden-hash',
  'hidden-token',
  'hidden-password',
  'malformed SECRET',
  'edit_token_hash',
  ...database.Users.map((user) => user.edit_token_hash),
])
  assert.ok(!exposed.includes(secret), `response leaked ${secret.slice(0, 8)}`);
assert.ok(
  !JSON.stringify(database.AuditLog.slice(0, -1)).includes('edit_token_hash'),
  'new audit entries never write hashes',
);

// Global catalog respects semesters; archives are visible but never writable.
success('createSemester', {
  baseRevision: revision(),
  semester: {
    id: 'SEM-2027-SPRING',
    title: 'Spring 2027',
    startDate: '2027-02-01',
    weeksCount: 14,
  },
  sourceSemesterId: detail.semester.id,
  copySubjects: true,
  makeCurrent: true,
});
updated = success('adminUserDetails', { targetUserId: member.user.id });
assert.equal(updated.semester.id, 'SEM-2027-SPRING');
assert.equal(updated.catalog.length, 8);
assert.equal(updated.enrollments.length, 0);
success('archiveSemester', {
  baseRevision: revision(),
  semesterId: detail.semester.id,
});
assert.equal(
  success('adminUserDetails', {
    targetUserId: member.user.id,
    semesterId: detail.semester.id,
  }).semester.archived,
  true,
);
reject(
  'updateEnrollments',
  { ...enrollment, baseRevision: revision() },
  'SEMESTER_NOT_FOUND',
);
assert.ok(
  success('adminOverview').diagnostics.some(
    (item) => item.code === 'LOCAL_CODES',
  ),
);
assert.ok(
  success('adminOverview').diagnostics.some(
    (item) => item.code === 'NO_LESSONS',
  ),
);
const healthy = structuredClone(database);
database.Meta.find((row) => row.key === 'schema_version').value = '0';
database.UserPreferences = database.UserPreferences.filter(
  (row) => row.user_id !== member.user.id,
);
const unhealthy = success('adminOverview');
assert.equal(
  unhealthy.diagnostics.find((item) => item.code === 'SCHEMA').level,
  'error',
);
assert.equal(
  unhealthy.diagnostics.find((item) => item.code === 'PREFERENCES').level,
  'error',
);
assert.equal(
  unhealthy.diagnostics.find((item) => item.code === 'INTEGRITY').level,
  'error',
);
database = healthy;

// Multiple admins permit self changes, recorded under the original actor identity.
const secondAdmin = create('second-admin', 'admin');
success('adminUpdateUser', {
  baseRevision: revision(),
  targetUserId: 'U001',
  patch: { role: 'editor' },
});
reject('adminOverview', {}, 'FORBIDDEN');
assert.equal(database.AuditLog.at(-1).actor_user_id, 'U001');
success(
  'adminUpdateUser',
  { baseRevision: revision(), targetUserId: 'U001', patch: { role: 'admin' } },
  secondAdmin.editToken,
);
success('adminSetUserActive', {
  baseRevision: revision(),
  targetUserId: 'U001',
  active: false,
});
reject('adminOverview', {}, 'UNAUTHORIZED');
success(
  'adminSetUserActive',
  {
    baseRevision: revision(),
    targetUserId: 'U001',
    active: true,
    rotateToken: false,
  },
  secondAdmin.editToken,
);
const selfRotation = success('adminRotateUserToken', {
  baseRevision: revision(),
  targetUserId: 'U001',
});
reject('adminOverview', {}, 'UNAUTHORIZED');
assert.equal(
  success('adminOverview', {}, selfRotation.editToken).actor.id,
  'U001',
);

// Emergency editor entry points use the same creation/rotation business rules.
const manual = context.createSchedulerUser('Manual', 'manual', 'user');
assert.ok(
  database.UserPreferences.some((row) => row.user_id === manual.user.id),
);
assert.throws(
  () => context.createSchedulerUser('Manual', 'manual', 'user'),
  (error) => error.code === 'USER_EXISTS',
);
const manualRotation = context.rotateSchedulerEditToken('manual');
assert.notEqual(manual.editToken, manualRotation.editToken);
assert.equal(
  context.authenticateEditToken_(database, manualRotation.editToken).user_id,
  manual.user.id,
);
assert.equal(locks, 0);
console.log(
  'Apps Script admin integration tests passed (real auth, RBAC, revisions, last-admin protection, tokens, enrollments, audit, diagnostics, semesters, manual recovery).',
);
