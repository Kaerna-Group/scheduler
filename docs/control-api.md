# Scheduler Control API and CLI

The CLI and [local MCP server](mcp.md) call typed Apps Script actions through the same transport client. Apps Script owns authorization, validation, planning, changes, conflict detection, audit history and verification. MCP runs over stdio; a browser-accessible remote endpoint is a separate deployment.

## Enable the backend

1. Run `npm run apps-script:bundle`. Review and publish the bundle and `apps-script/appsscript.json` to the existing Apps Script web app. The manifest enables the Advanced Sheets v4 service. For a standard Google Cloud project, also enable Google Sheets API in that project. Reauthorize the deployment owner if Google requests it.
2. For an existing installation, run `upgradeSchedulerSchema()` if the core schema needs upgrading. The core schema remains **2**, API remains **1**.
3. Run `setupSchedulerControl()` in the Apps Script editor. This idempotent, additive setup creates `ControlPlans` and `ControlOperations` in the **same spreadsheet**, with control storage format **1**. It does not create accounts, change edit tokens or increment the schedule revision. Existing core schema migrations continue using their durable journal; they do not create these optional integration tables.
4. Create a dedicated integration from an owner-controlled editor helper, calling:

   ```js
   createSchedulerIntegration('local-agent', [
     'catalog:read',
     'users:read',
     'lessons:write',
     'catalog:write',
     'enrollments:write',
     'history:read',
     'changes:undo',
   ]);
   ```

   Save the returned `integrationToken` directly into a local secret manager or protected process environment. The backend stores only its domain-separated SHA-256 hash, integration ID, allowed scopes, active flag and spreadsheet binding in Script Properties. There is no integration user in `Users`. The editor helpers are not exposed through the HTTP router. Do not log the returned secret or copy it into a prompt, committed file or frontend environment variable.

   To capture the one-time token in the editor, assign the result to a local variable, place a breakpoint on the next executable line, then use **Debug** and inspect that variable before continuing. See the [complete Windows walkthrough](mcp-windows-ru.md#3-получить-отдельный-ключ-интеграции). This works without `SpreadsheetApp.getUi()`, which is unavailable in standalone scripts and some execution contexts.

   Provision narrower scopes when appropriate. Planning/applying requires `catalog:read`, `users:read`, and the scope for every command. Verification requires `history:read` and `users:read`; detailed operation history also requires `catalog:read`. Undo additionally requires `changes:undo` and the original command permissions.

5. Configure the CLI process with `SCHEDULER_API_URL` (the HTTPS `/exec` URL), `SCHEDULER_INTEGRATION_ID`, `SCHEDULER_INTEGRATION_TOKEN` and `SCHEDULER_INITIATOR`. The initiator is a **caller-reported audit label**, not an authenticated user identity. The backend separately records the authenticated integration as `integration:<id>`.

Call `revokeSchedulerIntegration('local-agent')` from the owner-controlled editor to revoke access immediately, including saved plans and retries. To rotate, create a new integration ID and revoke the old one. Never reuse or delete an integration ID while its history exists.

Before enabling integration writes on an installation with a previous partial-write failure, recover/inspect that state using the existing maintenance procedures. The new atomic writer cannot retroactively repair a partial write from an older deployment.

## Use the CLI

Requires Node.js **22.13+** and the repository installed with `npm ci`. No separate service or extra runtime package is needed. The `scheduler` package executable is `scripts/scheduler.mjs`; the portable checkout command is:

```text
node scripts/scheduler.mjs --help
```

`npm run --silent scheduler -- ...` is equivalent. The CLI always writes one JSON object to stdout. `--json` is accepted for agent scripts; it is not required. Exit codes: **0** success, **1** invalid arguments/configuration/transport/server error, **2** verification found a divergence. A transport failure after apply has an uncertain outcome: retain the original operation ID.

```text
node scripts/scheduler.mjs catalog --semester SEM-2026-FALL --json
node scripts/scheduler.mjs users find --query Ermolz --json
node scripts/scheduler.mjs enrollments find --user U001 --offering OFF-SCRUM-26 --json
node scripts/scheduler.mjs lessons find --semester SEM-2026-FALL --course 565095 --type lecture --json
node scripts/scheduler.mjs changes plan --file move-lesson.json --json
node scripts/scheduler.mjs changes apply --plan-id PLAN-... --operation-id OP-... --json
node scripts/scheduler.mjs changes verify --operation-id OP-... --json
node scripts/scheduler.mjs history --limit 25 --json
```

`lessons find` supports `--semester`, exact `--course` (external code), `--offering`, `--lesson`, `--type`, `--day`, `--start-time`. An omitted semester means the current semester. Multiple matches return `ambiguous: true`; the client must resolve them before preparing a command with one exact `lessonId`. The server does not accept a search query as a mutation target.

An example change file (also in `examples/control/move-lesson.json`):

```json
{
  "reason": "Move this lecture from week 3 onward; preserve duration",
  "commands": [
    {
      "type": "lesson.move",
      "lessonId": "LES-SCRUM-LECTURE",
      "startTime": "13:30",
      "fromWeek": 3
    }
  ]
}
```

Replace the sample ID with the result of the live search. `fromWeek: 3` selects existing occurrences from week 3 through the end of that lesson's schedule; it does not invent occurrences on other semester weeks. Alternatively pass an explicit `weeks` array. Omit both to move the entire series. The server preserves duration; optional `day` changes the weekday. A partial move keeps the original ID for the remaining weeks and stores a new ID for the moved rule **in the plan**. The original group restrictions are copied.

Inspect `changes` (`before` / `after`), `affectedUsers`, `conflicts`, and `confirmationReasons` in the returned plan. The example 13:30 move conflicts with a seeded Scrum group taught by the same teacher, so it may need explicit review. For a plan requiring confirmation, apply only after separate approval of that concrete plan:

```text
node scripts/scheduler.mjs changes apply --plan-id PLAN-... --operation-id OP-... --confirm-plan-id PLAN-... --json
```

The server requires the exact saved plan ID for semester archival, multiple removal commands, undo deleting multiple created records, course archival hiding multiple lessons/enrollments, and newly detected conflicts. It rejects a missing or different ID with `CONFIRMATION_REQUIRED`. This protocol forces an explicit confirmation step; it cannot establish that a human approved a flag supplied by a client. Agents must obtain that approval through their host UI and must not automatically echo `planId` into the confirmation flag. Ordinary unambiguous changes can use the user's original request as authorization.

Choose and save a unique `operationId` **before** apply (for example `OP-` plus a UUID). The CLI never generates or retries one implicitly. If the response is lost, retry **the same planId and operationId**, then verify. The successful result is retained even after plan expiry. Another plan with the same operation ID returns `OPERATION_ID_CONFLICT`; another operation ID for the same plan returns `PLAN_ALREADY_APPLIED`.

## Commands and permissions

Change files contain only `commands` and an optional `reason`. Each command has an explicit schema; extra fields, raw table writes, account operations, preferences and arbitrary scripts are refused by the backend even when HTTP is called directly.

| Command                          | Input beyond `type`                                                   | Scope                            |
| -------------------------------- | --------------------------------------------------------------------- | -------------------------------- |
| `lesson.create`                  | `offeringId`, `fields`                                                | `lessons:write`                  |
| `lesson.update`                  | `lessonId`, `fields`                                                  | `lessons:write`                  |
| `lesson.move`                    | `lessonId`, `startTime`, optional `day`, either `weeks` or `fromWeek` | `lessons:write`                  |
| `lesson.cancel`                  | `lessonId`, optional `weeks` or `fromWeek`                            | `lessons:write`                  |
| `subject.create/update/archive`  | `id` and/or `fields` as described below                               | `catalog:write`                  |
| `offering.create/update/archive` | `id` and/or `fields`                                                  | `catalog:write`                  |
| `group.create/update/archive`    | `id` and/or `fields`                                                  | `catalog:write`                  |
| `semester.create/update/archive` | `id` and/or `fields`                                                  | `catalog:write`                  |
| `semester.setCurrent`            | `id`                                                                  | `catalog:write`                  |
| `enrollment.add`                 | existing active `userId`, `offeringId`, optional `groupId`            | `enrollments:write`              |
| `enrollment.changeGroup`         | `enrollmentId`, `groupId` (or `null` to clear)                        | `enrollments:write`              |
| `enrollment.remove`              | `enrollmentId`                                                        | `enrollments:write`              |
| `changes.undo`                   | `operationId`, as the only command in a plan                          | `changes:undo` + original scopes |

Catalog creates accept optional explicit `id` (required for semesters); otherwise the server allocates IDs while planning. Updates require `id` and `fields`. Archives require `id` only. Parent IDs are immutable after creation. Commands in a file run in order, so explicit IDs allow linked records to be created together.

| Entity                          | Allowed `fields`                                                                                                     |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Subject                         | `name`, `shortName`, `color` (`#RRGGBB`); all required on create                                                     |
| Offering (course in a semester) | `semesterId`, `subjectId`, `externalCode`; all required on create; only `externalCode` can be updated                |
| Group                           | `offeringId`, `groupNumber` (1–999), `label`; all required on create; parent is immutable                            |
| Semester                        | `title`, `startDate` (`YYYY-MM-DD`), `weeksCount` (1–30); all required on create                                     |
| Lesson                          | `type`, `day`, `startTime`, `endTime`, `format`, `teacher`, `weeks`; required on create. Optional `room`, `groupIds` |

Lesson days: `monday`–`saturday`; formats: `online`, `offline`, `hybrid`; types: `lecture`, `group`. Group lessons require active `groupIds` from their own offering; lectures have no group restriction. `lesson.update` changes the full rule, including replacing its `weeks`/`groupIds` when supplied. Use `lesson.move` for partial-week time changes. Full cancellation and enrollment removal deactivate the record; partial cancellation removes only the selected weeks.

Archived semesters and their records are read-only. A subject referenced by an archived semester is also read-only. The current semester cannot be archived until another is selected. Subjects with active offerings and groups with active enrollments/lesson links cannot be archived. Course archival hides its lessons from participants while retaining relational records. Reducing a semester's week count cannot leave existing lesson weeks outside its range. Enrollment changes never write `Users` or `UserPreferences`; they assign existing users through their course/group membership. Individual assignment to one shared lesson is not represented by this schema.

The user directory contains only `id`, `slug`, `displayName` for active users. History exposes only the calling integration's operations, with their original plans and initiator labels. Undo is conservative: it requires that operation to remain the newest schedule revision and that the schedule/participant fingerprint still matches. It reverses only the saved permitted row changes, creates a new revision and records `CONTROL_UNDO`; it never restores account or preference rows.

## Server protocol and guarantees

All control actions use POST JSON with `apiVersion: 1`, `integrationId`, `integrationToken`, and an `action`: `control.catalog`, `control.users`, `control.enrollments.find`, `control.lessons.find`, `control.changes.plan`, `control.changes.apply`, `control.changes.verify`, `control.history`. Request fields map directly from the CLI: `semesterId`, `query`, `filters`, `commands/initiator/reason`, `planId/operationId/confirmPlanId`, `operationId`, and `limit`, respectively. Integration credentials are never accepted by the normal admin/import/preferences endpoints, including when accompanied by a valid admin edit token.

The existing versioned `{ apiVersion, ok, data }` / `{ apiVersion, ok: false, error, revision? }` envelope is preserved. Important errors include `UNAUTHORIZED`, `FORBIDDEN`, `STALE_DATA`, `PLAN_EXPIRED`, `PLAN_INVALID`, `PLAN_ALREADY_APPLIED`, `OPERATION_ID_CONFLICT`, `CONFIRMATION_REQUIRED`, `UNDO_NOT_AVAILABLE`, `PLAN_TOO_LARGE`, `WRITE_TOO_LARGE`, and `SHEETS_SERVICE_REQUIRED`.

Plans expire after **15 minutes**, contain a checksum and exact row changes, and are tied to one integration, revision and fingerprint. Fingerprinting includes schedule tables, current semester and participant identity/activity, detecting manual changes even when `data_revision` was not incremented. No plan is recalculated during apply. A changed base returns `STALE_DATA`; prepare a new plan. Storage limits are **30 commands**, **40 KB per stored plan**, **200 unexpired plans**. Expired plans are pruned when planning; operation records remain durable for retry/undo. Provision storage and reviewed history archival as usage grows.

Ordinary writes from **all existing backend mutation paths** now use one Advanced Sheets `spreadsheets.batchUpdate` for changed tables, revision and AuditLog; control apply includes `ControlOperations` in that same call. There is no sequential fallback. Header checks and the **1.8 MB application request limit** happen before the API call; table growth and trailing-row clearing are part of the batch. Values use `stringValue`, so leading `=` remains literal. Google documents that batch requests are validated together and applied atomically. [Google Sheets batchUpdate](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate), [Advanced Sheets service setup](https://developers.google.com/apps-script/advanced/sheets).

Script locks serialize this deployment's readers/writers, and the existing cache bypass marker remains on uncertain write/flush failures. A later successful write clears bypass and changes its recovery epoch. Atomicity does not exclude concurrent manual edits, unrelated scripts or old deployments that do not share the lock/revision protocol. Avoid such writers during apply; verify afterward. Core schema setup/migrations retain their separate durable journal and recovery procedure.

Verification reloads actual Sheets data without the schedule cache. It checks the entire expected schedule/participant state (including unchanged weeks and enrollment links), every changed row, and each affected user's materialized schedule. It therefore detects missing new occurrences, retained old occurrences and unexpected duplicates. `verified: false` after later changes is a current-state divergence, not proof that the original commit failed. A true result means the backend would serve the expected schedule for each participant; it does not prove that an already-open browser refreshed its local display.

Conflict checking reports new overlaps on the same semester weekday and week by enrolled participant, identical teacher name, or identical physical room (online rooms are excluded). Existing overlaps are not silently removed. Resource matching is based on the stored names/room labels; there is no separate teacher/room identity catalog or cross-semester calendar conflict engine.

The CLI accepts secrets only through environment variables, reports sanitized transport failures and does not print request bodies. Apps Script's one-time ContentService redirect is followed only to `script.googleusercontent.com` with a GET containing no integration credential; arbitrary redirects cannot resend the POST secret.

## Validation and rollout

Run `npm run test:control` for the real Apps Script source under isolated Google-service fixtures plus CLI end-to-end protocol tests. Run `npm run check` for type checks, lint, the full existing suite, frontend production build and Apps Script bundle. Tests include permissions/direct API bypass attempts, partial and whole-series moves, participant propagation, conflict confirmation, plan expiry/corruption, stale/manual changes, atomic rejection, lost acknowledgements, replay, scoped history, safe undo, catalog references and CLI errors/redirects.

Local tests cannot verify Google authorization, quotas, deployment configuration or real network failure timing. After owner-approved publishing, smoke-test on a disposable spreadsheet: setup core/control storage, provision a temporary integration, search, plan one move, apply with a saved operation ID, repeat that same apply, verify, plan undo, apply undo and revoke the integration. Production publishing and integration provisioning are separate from the local implementation.
