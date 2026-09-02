# Google Apps Script backend

## Implemented features

- a relational schema with 12 sheets, including `UserPreferences`;
- schema version 2 with an idempotent upgrade path for existing spreadsheets;
- `setupScheduler()` for schema creation and seed data;
- `upgradeSchedulerSchema()` for creating missing sheets, backfilling preference rows, and updating schema metadata;
- `GetUserSchedule` through `GET ?action=schedule&user=...&semester=...`;
- a single frontend DTO with no joins in React;
- personal edit tokens with only SHA-256 hashes stored in Sheets;
- `user`, `editor`, and `admin` roles;
- JSON import preview and execution;
- `merge` and `replace my enrollments` modes;
- `COURSE_DATA_CONFLICT` for conflicting shared lesson data;
- optimistic concurrency through `baseRevision` / `STALE_DATA`;
- independent `settings_revision` and `updatePreferences`, authorized only by the owner’s edit token;
- `LockService` around writes;
- batched table writes;
- `AuditLog`;
- multiple semesters with `Meta.current_semester_id`, read-only archives, and audited admin lifecycle operations;
- frontend export.

## Google editor deployment

1. Create an empty Google Spreadsheet.
2. Open **Extensions → Apps Script**.
3. Run `npm run apps-script:bundle` locally.
4. Copy `apps-script/dist/Code.gs` into the editor’s `Code.gs` file.
5. Replace the manifest with `apps-script/appsscript.json` in project settings.
6. Run `setupScheduler()` and grant the requested permissions.
7. Copy `editTokens.ermolz` from the result. The plaintext token is not stored anywhere else.
8. Select **Deploy → New deployment → Web app**:
   - Execute as: **Me**;
   - Who has access: **Anyone**.
9. Copy the URL ending in `/exec`.
10. Create the `SCHEDULE_API_URL` Actions variable in the `Kaerna-Group/scheduler` GitHub repository and rerun the workflow.

For an existing spreadsheet, deploy the latest code and run `upgradeSchedulerSchema()` once. The function is idempotent: it creates missing schema pieces, backfills preference rows and `Meta.current_semester_id`, preserves `data_revision`, schedule data, and edit tokens, and records the upgrade in `AuditLog`. Give at least one trusted user the `admin` role in `Users` to manage semesters; fresh installations seed `ermolz` as admin.

Verify a published deployment through:

```text
GET /exec?action=health
```

The response envelope and health data include `apiVersion: 1`. Health also includes `schemaVersion`, `expectedSchemaVersion`, and the complete `sheets` list. Both schema versions must be `2`, and `sheets` must include `UserPreferences`.

## clasp deployment

Enable Google Apps Script API at https://script.google.com/home/usersettings, then install and authorize clasp with the account that owns the project. In PowerShell:

```powershell
npm.cmd install -g @google/clasp
clasp.cmd login
```

Create `apps-script/.clasp.json` from `.clasp.json.example` only if no local config exists, and fill in the project Script ID (not the web-app deployment ID). Its `rootDir` must stay `dist`. Run `npm run apps-script:bundle` from the repository root before uploading. The `.claspignore` allow-list includes only `dist/Code.gs` and `dist/appsscript.json`, preventing duplicate source and bundle declarations.

Read-only checks from `apps-script`:

```powershell
clasp.cmd show-file-status
clasp.cmd list-deployments
```

Before the first push, back up remote source into a separate directory and check it for remote-only changes. Do not pull or clone into the local source/bundle directories. After pushing the reviewed bundle, update the existing web-app deployment using its ID and a new version; do not create a new deployment URL accidentally. Confirm command options against the installed clasp version.

Publishing code does not run schema migrations. Run `upgradeSchedulerSchema()` once in the editor, or separately configure Apps Script API execution with a standard Google Cloud project, custom OAuth client, and API-executable deployment as described in https://github.com/google/clasp/blob/master/docs/run.md.

Never commit `.clasp.json` with a real script ID, `.clasprc.json`, or downloaded OAuth client secrets. Login credentials stay on this machine and must not be pasted into chat.

## Adding users

Run this in the Apps Script editor:

```js
createSchedulerUser('Zahar', 'zahar', 'user')
```

The function returns a one-time visible `editToken`. Give it only to that user. Rotate a compromised token with:

```js
rotateSchedulerEditToken('zahar')
```

Every user receives exactly one `UserPreferences` row keyed by `user_id`. Database integrity validation rejects missing, duplicate, or orphan preference rows.

## API

### Revision-keyed schedule caching

`GET action=schedule` calls `getCachedUserSchedule_()` from `13_Cache.gs`. Cache misses still use the original `buildUserSchedule_()` and its complete integrity validation; mutation responses always build from their own database snapshot and never populate this cache.

The conceptual key is `schedule:<scope>:<user>:<semester>:<data_revision>:settings:<settings_revision>`. The scope hashes the spreadsheet ID, API/schema/cache format versions, live public user/semester metadata, the owner's preference row and a recovery epoch. Token hashes are excluded. Long keys are hashed again to stay below 250 characters. Both cache identity and a SHA-256 payload checksum are verified before returning an entry.

Each GET holds the same script lock as writers and reads `Meta`, `Users`, `Semesters`, `UserPreferences` directly. On a hit, the other eight tables are not read. On a miss, the loader reuses these four tables and reads each remaining table once. An inactive user is denied even if an old entry is present; archived semesters remain readable. Cache exceptions/eviction cannot turn a successful schedule read into an error. Health, authentication, writes and history do not use this schedule cache.

`persistDatabase_()` sets `SCHEDULER_CACHE_WRITE_PENDING` in Script Properties before writing and calls `SpreadsheetApp.flush()` before the writer releases its lock. If a table write or flush fails, the marker remains and schedule GETs bypass the cache until a successful write. Recovery also changes `SCHEDULER_CACHE_RECOVERY_EPOCH` before clearing the marker, preventing same-revision entries from before the failure from becoming eligible again. This does not make Sheets writes atomic or repair partial data; inspect backend diagnostics after a storage failure. Setup/schema upgrades also use the lock and persistence coordinator.

Configuration in `00_Config.gs`: 300-second TTL, a conservative 90,000-byte UTF-8 entry limit, and `scheduleCacheVersion: 1`. Google may evict entries early; values over the size ceiling are served normally but not cached. See [Cache limits](https://developers.google.com/apps-script/reference/cache/cache) and [flush-before-unlock guidance](https://developers.google.com/apps-script/reference/lock/lock#releaseLock()). No Sheets migration or new deployment permissions are required. If DTO construction changes within an existing API/schema version, increment `scheduleCacheVersion` before publishing. Manual changes to schedule tables must increment `Meta.data_revision` (or wait for the five-minute TTL); API writes already handle revision changes.

Run `npm run test:cache` from the repository root. The isolated real-backend tests measure 12 → 4 table reads and cover user/semester/spreadsheet isolation, settings revisions, import/undo/admin changes, TTL/eviction, corrupt or oversized entries, cache outages, and partial-write/flush recovery. Google services are mocked; live performance/quota checks remain a separate deployment smoke test.

### API version contract

`SCHEDULER_CONFIG.apiVersion` is the integer API contract version, currently **1**. It is not the Apps Script deployment number, import `schemaVersion`, Sheets `schema_version`, or data/settings revision. Keep the matching frontend `API_VERSION` in `lib/api/client.ts` in sync.

All responses, including validation/authentication errors, contain the version at the envelope level:

```json
{ "apiVersion": 1, "ok": true, "data": { "apiVersion": 1, "status": "ok", "revision": 8, "schemaVersion": "2", "expectedSchemaVersion": "2", "sheets": ["Users", "UserPreferences"] } }
```

The example shortens the health table list. Ordinary data payloads need not repeat `apiVersion`; health and admin overview do, for diagnostics. Errors retain the existing `{ ok: false, error: { code, message, details }, revision? }` structure with the added envelope `apiVersion`.

New clients send `apiVersion=1` in GET query parameters and `"apiVersion": 1` in POST JSON bodies. `health` remains readable regardless of the requested version so that clients can negotiate compatibility. Other actions reject incompatible versions with `API_VERSION_MISMATCH` before dispatch; the error details identify `serverApiVersion` and `clientApiVersion`. An omitted version means the original **v1**, not the latest version.

For backward-compatible additions (optional fields or new actions), keep the API version unchanged. Breaking request/response semantics require a new integer version, matching frontend changes, tests and a rollout plan. A future version must not silently treat unversioned clients as its new contract.

For the initial rollout, publish the versioned backend before the frontend. The previous frontend ignores added envelope fields and still works with v1. The new frontend rejects an unversioned backend, a malformed envelope, HTML instead of JSON, or an unsupported newer API with actionable messages. No spreadsheet migration or data revision change is needed just to publish this contract.

Run `npm run test:contracts` from the repository root after changing a DTO or error response. This suite executes the actual Apps Script source with Google persistence isolated in memory, then checks JSON responses against the frontend TypeScript declarations and the real API client. It covers schedule/export/import DTOs, preferences, semester variants, `STALE_DATA`, shared course conflicts, invalid tokens, inactive users and invalid semesters. It is included in the normal CI check; production deployment smoke checks remain separate. See [contract test coverage](../README.md#frontend--apps-script-contract-tests).

Before mutating POSTs, the frontend performs a fresh `health` GET; a failed compatibility check prevents sending the mutation or its token/draft. Every subsequent response is still checked, and the server independently verifies the requested version. Read-only `previewImport` and the three admin read actions skip the extra health request. There is no persistent compatibility cache and no automatic retry of imports, undo or admin writes.

### Read

```text
GET /exec?action=schedule&apiVersion=1&user=ermolz&semester=SEM-2026-FALL
GET /exec?action=changes&apiVersion=1&user=ermolz&semester=SEM-2026-FALL&limit=150
```

`changes` returns a sanitized, newest-first schedule history. It includes shared lesson/course/group changes only for offerings that belong or previously belonged to the selected user, plus that user’s personal enrollment changes. Preference changes, system migrations, and other users’ personal enrollment changes are excluded.

### Preview import

```json
{
  "action": "previewImport",
  "apiVersion": 1,
  "userSlug": "ermolz",
  "editToken": "...",
  "baseRevision": 1,
  "importMode": "merge",
  "sharedConflictResolutions": {
    "COURSE-101": "keep",
    "COURSE-202": "apply"
  },
  "payload": { "schemaVersion": 1, "semesterId": "SEM-2026-FALL", "subjects": [] }
}
```

POST uses `text/plain;charset=utf-8` so that an Apps Script web app can accept the request without a CORS preflight. The body remains JSON.

Preview returns the complete audit-style `plan` together with all shared `conflicts`. A conflict resolution is selected independently for each course `externalCode`: `keep` preserves the stored conflicting shared data, while `apply` replaces it with the imported rule. `importSchedule` rejects unresolved conflicts and rechecks `baseRevision` under the write lock.

Every successful import records an `Import` transaction marker in `AuditLog`. The latest marked import can be restored with:

```json
{
  "action": "undoLastImport",
  "apiVersion": 1,
  "editToken": "...",
  "baseRevision": 12
}
```

Undo is restricted to `editor` and `admin`. Editors may undo only an import targeting their own schedule; admins may undo any latest import. The import must still be the newest schedule revision, otherwise the API returns `UNDO_NOT_AVAILABLE` to avoid overwriting later work. Undo runs under `LockService`, restores the previous relational rows, creates a new revision, and appends `UNDO_IMPORT` to `AuditLog`.

### Semester lifecycle

Omit `semester` from a schedule/history GET request to use `Meta.current_semester_id`. Archived semesters remain readable, but imports and enrollment writes require an active semester.

Admin-only POST actions are `createSemester`, `setCurrentSemester`, and `archiveSemester`. `createSemester` accepts `semester: { id, title, startDate, weeksCount }`, optional `sourceSemesterId`, `copySubjects`, `makeCurrent`, `baseRevision`, and `editToken`. Copying creates new Subject and Offering rows only—Lessons, Groups, LessonGroups, LessonWeeks, and Enrollments are never copied.

### Administration

All seven endpoints below are **POST-only**, with `editToken` in the JSON request body, never a URL parameter. They require an active `admin` on every call. The actor comes from the token, not a client-supplied role or selected user.

| Action | Additional fields |
| --- | --- |
| `adminOverview` | none |
| `adminUserDetails` | `targetUserId`, optional `semesterId` (defaults to current) |
| `adminAuditLog` | optional `filters: { actorId, action, entityType, from, to, search, offset, limit }` |
| `adminCreateUser` | `baseRevision`, `displayName`, `slug`, `role` |
| `adminUpdateUser` | `baseRevision`, `targetUserId`, `patch: { displayName?, role?, active? }` |
| `adminSetUserActive` | `baseRevision`, `targetUserId`, `active`, optional `rotateToken` (defaults to true on reactivation) |
| `adminRotateUserToken` | `baseRevision`, `targetUserId` |

Admin user mutations require an exact integer `baseRevision`, run under `LockService`, enforce relational integrity, increment `data_revision` once per changed operation and append safe user changes to `AuditLog`. A no-op does not create a revision. `FORBIDDEN_LAST_ADMIN` prevents removing the last active admin through either mutation endpoint. Slug/user ID are immutable. `STALE_DATA` includes `expectedRevision` and `receivedRevision`; callers must refresh and review, not blindly replay.

Creation initializes the relational `UserPreferences` row. Activation is soft; existing related records stay intact. Create/rotate/reactivate-with-rotation return `{ revision, user, editToken }`; other writes omit `editToken`. No DTO or audit entry contains `edit_token_hash`. Audit raw data is recursively sanitized, and malformed historical payloads are omitted. Pagination defaults to 25 and is capped at 100; dates filter inclusive UTC calendar dates.

`adminUserDetails` includes the complete active offering/group catalog for the requested semester, including courses not enrolled by the target user, their enrollments and read-only preferences. Enrollment writes reuse `updateEnrollments` with `userSlug`, `semesterId`, `baseRevision`, `editToken`, and the complete desired enrollment array. Inactive users and archived semesters are read-only. Admins may edit another active user's enrollments, but user/editor tokens remain limited to their own.

Admin System shows schema/integrity warnings; it never repairs or migrates data automatically. `12_Admin.gs` adds no schema columns. Bundle and update the existing web-app deployment together with the frontend; old deployments report `UNKNOWN_ACTION` for admin calls.

#### Emergency owner access

`createSchedulerUser(displayName, slug, role)` and `rotateSchedulerEditToken(slug)` remain Apps Script editor-only recovery tools and share the admin creation/token logic. They are not API actions. If no administrator can authenticate, the project owner can run a temporary editor wrapper calling `createSchedulerUser('Recovery Admin', 'recovery-admin', 'admin')`, securely capture its one-time result, and remove the wrapper afterward. Do not embed or commit real tokens in source. This does not promote an existing user or overwrite their token automatically.

### Preferences patch

```json
{
  "action": "updatePreferences",
  "apiVersion": 1,
  "userSlug": "ermolz",
  "editToken": "...",
  "baseSettingsRevision": 4,
  "patch": { "schedule": { "density": "compact" } }
}
```

`settings_revision` does not change `data_revision`. Even an administrator cannot change another user’s preferences without that user’s edit token.

## Seed data

The seed contains the current Ermolz schedule, including Scrum group 3 and the Qualification Project without lessons. Temporary `LOCAL-*` values are used where official university codes are unknown; replace them with real codes before importing schedules for other users.
