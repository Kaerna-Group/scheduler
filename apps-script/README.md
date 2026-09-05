# Google Apps Script backend

## Implemented features

- a relational schema with 12 sheets, including `UserPreferences`;
- schema version 2 with ordered, journaled migrations and safe retry after interrupted writes;
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
- atomic ordinary writes through the Advanced Sheets v4 service;
- optional scoped [Control API and CLI](../docs/control-api.md), with durable plans, idempotent operations and verification;
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

## Schema migrations and recovery

`14_Migrations.gs` owns the runner and the immutable, consecutive registry. Step implementations live in `migrations/`, separate from setup, API handlers and manual content corrections:

| Version | Migration | Effect |
| --- | --- | --- |
| 0 | Unversioned legacy database | A missing `Meta.schema_version` is treated as 0; this is not a reason to reseed. |
| 1 | `001-relational-baseline` | Records the baseline version and initializes a missing data revision to 0. Existing rows remain unchanged. |
| 2 | `002-user-preferences-and-current-semester` | Adds missing personal preference rows and current-semester metadata; preserves existing preferences and their revisions. |

The current Sheets schema remains **2**, independent of API v1 and browser storage v3. No artificial schema-v3 migration was added. Fresh empty installations seed the current schema directly. A spreadsheet with any existing scheduler rows is never reseeded just because `Users` is empty.

### Running and retrying

1. Back up the spreadsheet before a schema change. Publish the reviewed backend to the existing deployment first, so API requests use the migration guard. Pause other writers/old deployments that do not implement the guard.
2. Run `upgradeSchedulerSchema()` in Apps Script. It holds the script lock, checks the registry and stored version, then runs only missing versions in order. It never downgrades a newer schema or silently accepts malformed/duplicate version metadata.
3. Inspect `appliedMigrations`, `resumedMigrations`, `repairs`, `schemaVersion` and `changedTables` in the result. A successful repeat is a no-op. Current-schema repairs are separately audited as `REPAIR_SCHEMA`, not another execution of migration 2.
4. If execution fails or times out, correct the external failure and rerun the **same function**. Do not manually clear the journal, reset `schema_version`, edit affected Sheets rows, or run a second writer while recovery is pending.

Before touching Sheets, each step stores its complete target rows and checksum in a private, workbook-bound Script Properties journal. This is a durable write-ahead plan, not `CacheService`: recovery rewrites exactly that target, even if a previous `writeTable_()` cleared a table before failing. The runner flushes data and AuditLog first, then writes and flushes Meta last. The manifest is removed only after successful writes and cache invalidation. Failed acknowledgements/cleanup can safely replay the same audit rows without appending duplicates. Completed earlier steps are not replayed.

API reads/writes return `SCHEMA_MIGRATION_PENDING` while the manifest exists. The schedule cache cannot hide an incomplete migration; recovery changes its epoch even though these schema migrations preserve `data_revision`. The guard protects this backend, not direct human edits or unrelated scripts.

The recovery plan is capped at **200,000 UTF-8 bytes**, split into Unicode-safe properties smaller than 9 KB. This leaves headroom within [Apps Script property quotas](https://developers.google.com/apps-script/guides/services/quotas). A larger plan fails with `MIGRATION_TOO_LARGE` **before any Sheets changes**; split the operation or implement a reviewed larger durable journal first. The plan includes changed tables' audit history, so a large AuditLog can also reach this cap. Incomplete staging can leave inactive chunks, cleaned on the next invocation; it does not block the API or change Sheets.

`MIGRATION_JOURNAL_INVALID` means missing/corrupt chunks, an incompatible migration, or a different spreadsheet ID. Preserve the journal and backup; restore the matching backend/workbook before retrying. Never remove it merely to make the API available. A higher stored schema is refused without touching data. Unexpected headers in populated tables require an explicit reviewed column migration; the runner will not guess, rename or overwrite them.

Initial seeding also uses the journal. If seeding was interrupted, retrying setup recovers the staged rows without generating another account/token. The original plaintext token is not stored in the journal; if it was never returned, recover first and explicitly run `rotateSchedulerEditToken('ermolz')` to obtain a replacement.

### Adding a future version

- Add the next numbered `.gs` implementation under `migrations/`, register its unique ID and next consecutive integer in `SCHEDULER_MIGRATIONS`, and raise `SCHEDULER_CONFIG.schemaVersion` together.
- Never edit/reorder released steps or reuse their IDs. Migration code transforms the supplied in-memory database only; external I/O belongs to the runner. Versioned defaults must not depend on future frontend defaults.
- Add version-aware integrity checks and, where needed, explicit safe header transformations. Destructive/renamed columns are intentionally not automatically supported by the ordinary row-write path.
- Register narrowly scoped current-version repairs separately. Test upgrading from each supported older version, no-op repeats, partial writes, lost acknowledgements, quota failures, cache bypass, and recovery with the same audit result.

`npm run test:migrations` exercises the actual runner and real backend code with isolated Sheets/Properties I/O. It includes a test-only third migration; the shipped registry still ends at 2. `npm run check` runs these tests too. The shared source loader includes `migrations/` and `maintenance/` in both tests and the generated bundle, never `dist/` or credential files. The historical `maintenance/01_Scrum2026.gs` helper is manual and is never invoked by the schema runner.

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

Publishing code does not run schema migrations. Run `upgradeSchedulerSchema()` in the editor, retrying the same function if recovery is needed, or separately configure Apps Script API execution with a standard Google Cloud project, custom OAuth client, and API-executable deployment as described in https://github.com/google/clasp/blob/master/docs/run.md.

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

`persistDatabase_()` now writes all changed tables, revision and audit rows through a single Advanced Sheets `spreadsheets.batchUpdate`; integration applies include their operation record in the same transaction. The manifest must enable the Sheets v4 service; there is no sequential fallback. It sets `SCHEDULER_CACHE_WRITE_PENDING` before writing and calls `SpreadsheetApp.flush()` before releasing the lock. An uncertain write/flush failure retains the marker, so schedule GETs bypass the cache. A later successful write clears it and changes `SCHEDULER_CACHE_RECOVERY_EPOCH`. Core setup/schema upgrades retain their separate durable migration journal and recovery procedure. See [Control API storage and rollout](../docs/control-api.md#server-protocol-and-guarantees).

Configuration in `00_Config.gs`: 300-second TTL, a conservative 90,000-byte UTF-8 entry limit, and `scheduleCacheVersion: 2`. Google may evict entries early; values over the size ceiling are served normally but not cached. See [Cache limits](https://developers.google.com/apps-script/reference/cache/cache) and [flush-before-unlock guidance](https://developers.google.com/apps-script/reference/lock/lock#releaseLock()). Caching itself needs no Sheets migration; the atomic writer requires the Advanced Sheets service described above. If DTO construction changes within an existing API/schema version, increment `scheduleCacheVersion` before publishing. Manual changes to schedule tables must increment `Meta.data_revision` (or wait for the five-minute TTL); API writes already handle revision changes.

Run `npm run test:cache` from the repository root. The isolated real-backend tests measure 12 → 4 table reads and cover user/semester/spreadsheet isolation, settings revisions, import/undo/admin changes, TTL/eviction, corrupt or oversized entries, cache outages, and rejected atomic writes/uncertain flush recovery. Google services are mocked; live performance/quota checks remain a separate deployment smoke test.

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
