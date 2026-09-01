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

For an existing spreadsheet created with schema version 1, deploy the latest code and run `upgradeSchedulerSchema()` once. The function is idempotent: it creates the `UserPreferences` sheet when missing, adds one row for every user, updates `Meta.schema_version` to `2`, preserves `data_revision`, schedule data, and edit tokens, and records the upgrade in `AuditLog`.

Verify a published deployment through:

```text
GET /exec?action=health
```

The response includes `schemaVersion`, `expectedSchemaVersion`, and the complete `sheets` list. Both schema versions must be `2`, and `sheets` must include `UserPreferences`.

## clasp deployment

When `clasp` is authorized:

```bash
cd apps-script
cp .clasp.json.example .clasp.json
# insert scriptId
npx @google/clasp push
npx @google/clasp deploy --description "Scheduler API"
```

Do not commit `.clasp.json` with a real script ID.

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
```

### Preview import

```json
{
  "action": "previewImport",
  "userSlug": "ermolz",
  "editToken": "...",
  "baseRevision": 1,
  "importMode": "merge",
  "allowSharedUpdates": false,
  "payload": { "schemaVersion": 1, "semesterId": "SEM-2026-FALL", "subjects": [] }
}
```

POST uses `text/plain;charset=utf-8` so that an Apps Script web app can accept the request without a CORS preflight. The body remains JSON.

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

For a spreadsheet that still uses the previous user slug, run `migrateTymofiiUserToErmolz()` once. It changes only the `U001` slug, preserves the token and enrollments, and records the change in `AuditLog`.
