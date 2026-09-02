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

The response includes `schemaVersion`, `expectedSchemaVersion`, and the complete `sheets` list. Both schema versions must be `2`, and `sheets` must include `UserPreferences`.

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

### Read

```text
GET /exec?action=schedule&user=ermolz&semester=SEM-2026-FALL
GET /exec?action=changes&user=ermolz&semester=SEM-2026-FALL&limit=150
```

`changes` returns a sanitized, newest-first schedule history. It includes shared lesson/course/group changes only for offerings that belong or previously belonged to the selected user, plus that user’s personal enrollment changes. Preference changes, system migrations, and other users’ personal enrollment changes are excluded.

### Preview import

```json
{
  "action": "previewImport",
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
  "userSlug": "ermolz",
  "editToken": "...",
  "baseSettingsRevision": 4,
  "patch": { "schedule": { "density": "compact" } }
}
```

`settings_revision` does not change `data_revision`. Even an administrator cannot change another user’s preferences without that user’s edit token.

## Seed data

The seed contains the current Ermolz schedule, including Scrum group 3 and the Qualification Project without lessons. Temporary `LOCAL-*` values are used where official university codes are unknown; replace them with real codes before importing schedules for other users.
