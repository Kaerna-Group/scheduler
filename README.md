# Scheduler

A responsive React/Vite schedule with a GitHub Pages frontend and a relational Google Sheets backend powered by Google Apps Script.

## Architecture

```text
React UI
  ├─ useSchedule → Schedule Repository
  ├─ Changes → cached AuditLog history
  ├─ Admin → useAdmin → authenticated POST API (memory-only data)
  └─ usePreferences
      ├─ useTheme (appearance application only)
      └─ Preferences Repository
          ├─ per-user localStorage cache
          └─ Google Apps Script Web App
              └─ Google Spreadsheet
                  ├─ Users
                  ├─ UserPreferences
                  ├─ Semesters
                  ├─ Subjects
                  ├─ Offerings
                  ├─ Groups
                  ├─ Enrollments
                  ├─ Lessons
                  ├─ LessonGroups
                  ├─ LessonWeeks
                  ├─ Meta
                  └─ AuditLog
```

The frontend receives a `UserSchedule` DTO together with the owner’s preferences. Preferences belong to `user_id`, are cached under `scheduler_preferences_v2:<slug>`, and use an independent `settings_revision` that does not change the schedule revision.

## Local development

```bash
npm install
npm run dev
```

Without `VITE_SCHEDULE_API_URL`, the site uses fallback data. To use the remote backend, copy `.env.example` to `.env.local` and add the Apps Script deployment URL.

## Checks

```bash
npm run check
```

The unified check runs type checking, linting, tests, the production build, and the Apps Script bundle in the same order used by CI. Tests cover conflicts, import behavior, preference migration, the server-wins rule, independent revisions, schema upgrades, and token protection for personal preferences.

DOM integration tests also connect the real frontend repositories to the actual Apps Script API/auth/validation code, with spreadsheet persistence isolated in memory. They exercise user administration, enrollment editing, semesters, per-course import decisions and import undo without Google credentials or production writes. See the [verification report](docs/verification-2026-09-02.md) for coverage and remaining deployment checks.

### Frontend ↔ Apps Script contract tests

```bash
npm run test:contracts
```

This focused suite is also included in `npm test`, `npm run check`, and CI. It runs the actual `buildUserSchedule_()`, GET/POST handlers, authentication, validation and import logic against an isolated in-memory database. Responses pass through JSON serialization and the real frontend API client/repositories; DTOs are checked at runtime against the current TypeScript declarations (including imported preferences/theme types), not a handwritten duplicate or a `fetch<UserSchedule>()` cast.

- Schedule DTOs: populated/empty schedules, numeric weeks/groups/revisions, optional field omission, saved/default preferences, current/archived semesters, cache and export/import round trips, and absence of credentials in public responses.
- Error contracts: `STALE_DATA` with both revisions, `COURSE_DATA_CONFLICT` with per-course subject/lesson details, invalid/inactive credentials (`UNAUTHORIZED`), inactive target users (`USER_NOT_FOUND`), and unknown or non-writable semesters (`SEMESTER_NOT_FOUND`). Failed operations must leave database tables, AuditLog, revisions and browser caches unchanged.
- Regression guards deliberately corrupt required fields, number types, enum values and nested preferences to verify that the checker catches drift. Additional fields remain compatible. The companion API-version suite covers version negotiation and malformed responses.

These tests do not contact Google or write production data. They validate source-level frontend/backend compatibility, not the deployed Apps Script version or Google's spreadsheet/runtime services; those still need deployment smoke checks. The TypeScript compiler-based checker is test-only and is not bundled into the frontend.

## Shareable schedule links

Choose a week, user, semester and course, then open **⋯ → Copy schedule link**. The URL opens the same selection on another device; it never includes a PIN or edit token. If the browser denies clipboard access, a dialog provides a selectable link for manual copying. The usual site PIN gate still applies.

- `#/week/5` opens week 5 for the device's selected user/semester (the backend's current semester on a fresh device).
- `#/week/6?user=ermolz&semester=SEM-2026-FALL&subject=565095` opens Scrum on week 6. Generated links always include user and semester, and prefer stable external course codes; subject IDs also work.
- `#/today?...` and `#/courses?...` preserve the view, with `week` in their query. Query parameters before the hash and `#/?week=5` are also accepted; hash values take precedence and `/week/6` takes precedence over a `week` query parameter.

Explicit links take priority over remembered week/filter/view preferences. With no viewing state in the URL, local defaults still apply. Selection changes update the address without a full page reload; browser Back/Forward restores the previous selection. Canonicalization replaces the current history entry, and changing only a view/week/filter does not refetch a resolved user/semester.

Week limits are validated against the loaded semester, not a temporary fallback. Malformed/out-of-range parameters show a notice; unknown subjects show an empty filtered result with a clear-filter action. Unavailable users/semesters retain their target URL without substituting another user's lessons. Cached links work offline, and uncached selections retry on reconnection. Links identify a **live view**, not an immutable snapshot of a revision.

URL parsing, navigation, clipboard fallback, PIN preservation, offline recovery and real frontend/Apps Script integration are covered by `tests/schedule-location.test.ts` and `tests/schedule-links-flow.test.tsx`, included in `npm test` and CI. No backend schema change is required for this feature.

## Offline and synchronization

The schedule distinguishes fresh, offline/cached, pending-change and backend-unavailable states. Online/offline events refresh its snapshot on reconnection. Preferences keep per-user pending patches locally and resume synchronization on reconnection, focus or token replacement. Transient failures retry with a bounded backoff (2–30 seconds); individual requests time out after 30 seconds. User changes and unmounts cancel obsolete retries and ignore late responses. Authentication and validation failures do not retry automatically.

Only idempotent preference patches use automatic write retries. Imports, undo, enrollment changes and administrative writes require online confirmation and a current revision; uncertain writes are never automatically replayed.

## Apps Script schedule cache

Schedule GETs use a best-effort script cache keyed by user, resolved semester, data revision and the owner's settings revision. The namespace includes the spreadsheet, API/schema/cache-format versions, a public metadata fingerprint and a recovery epoch. This prevents cross-user/workbook collisions and stale settings when only `settings_revision` changes. Default and explicit requests for the current semester share one entry.

A cold request reads all **12 tables once**. A hit reads only **4 small tables** (`Meta`, `Users`, `Semesters`, `UserPreferences`) to resolve the live revision, active user and current semester; it skips schedule tables and AuditLog entirely. The revision lookup itself is deliberately not cached. Import, undo, enrollments, admin and semester changes naturally select a new key. No tokens, token hashes, authentication results, errors, health responses or uncommitted drafts are cached.

Cached GETs share the writers' script lock; table writes flush before unlock. A persistent bypass marker protects against partial Sheets writes or flush failures. Reads remain uncached after such a failure; a subsequent successful write advances a separate cache recovery epoch before re-enabling caching, so old entries cannot reappear. This is a cache safety mechanism, not transaction rollback or automatic repair of a partially written spreadsheet.

Entries expire after at most five minutes. Eviction, cache outages, malformed/checksum-mismatched entries and oversized UTF-8 payloads fall back to normal reads. The configured size ceiling is 90,000 bytes; entries are never truncated. See [Google's CacheService limits and eviction behavior](https://developers.google.com/apps-script/reference/cache/cache).

Run `npm run test:cache` for cache behavior, isolation, read-count and write-failure tests; these are also included in `npm test` and CI. After direct manual edits to schedule tables, increment `Meta.data_revision` once edits are complete or allow the cache TTL to expire. Prefer the API, which handles revisions and locking. Publishing this feature needs no Sheets migration; bump `scheduleCacheVersion` when changing cached DTO construction without an API/schema version change.

## API compatibility

The backend API contract is versioned separately as integer `apiVersion: 1`. Health and every success/error envelope include it; new frontend requests send it in GET parameters or the POST JSON body. This is independent of import `schemaVersion: 1`, Sheets schema version `2`, data revisions, and numbered Apps Script deployments.

The shared API client checks every response, distinguishes an old/unversioned backend from a newer unsupported API, and replaces malformed JSON/HTML errors with deployment instructions. It preserves schedule/history caches and pending preference patches; compatibility failures do not automatically replay writes. Admin sessions are cleared on incompatible responses, and System shows the backend API version.

Every mutating POST first checks uncached health, without sending tokens or drafts. Read-only POSTs validate their own response without this extra round trip. Requests remain cancellable and have a 30-second timeout. The server also rejects incompatible request versions before dispatching an operation.

Deploy the backend first, then the frontend. Original clients that omit `apiVersion` are treated as v1 during rollout; new clients deliberately reject deployments that do not report a version. This change does not require a Sheets migration. See the [API contract and version policy](apps-script/README.md#api-version-contract).

## Import and export

The standard transport format contains `schemaVersion: 1`, `semesterId`, and `subjects[]`. JSON is a transport format, not the Sheets storage model. See [docs/schedule-import.example.json](docs/schedule-import.example.json).

Import modes:

- `merge` adds or updates the provided enrollments;
- `replace` treats the JSON as the current user’s complete enrollment list without deleting global courses or lessons.

Before writing, the import page displays a backend-generated diff for new courses, new and changed lessons, removed enrollments, and shared conflicts. Each conflicting course must be resolved independently by keeping the stored shared data or applying the imported version.

Successful imports are transaction-marked in `AuditLog`. Editors can undo the latest import for their own schedule from the Changes page, while admins can undo the latest import for any user. Undo is disabled after a newer schedule revision exists and always creates a new audited revision instead of rewriting history.

## Semester lifecycle

`Meta.current_semester_id` is the single backend source of truth for the current semester. The UI can switch between every semester, including archived read-only semesters, and remembers the selected semester on the device.

Admins can create a semester in **Admin → System**, make any active semester current, and archive a non-current semester. Creating from a previous semester copies Subjects and Offerings as new relational records, while Lessons, Groups, and Enrollments intentionally start empty. The ordinary Settings page remains personal.

Writes are protected by personal edit tokens. The bundle contains only the public frontend; no shared secrets are included in Vite code.

## Administration

Open `#/admin` after the site PIN gate. The Admin link appears in Schedule, Import, and Settings only when the selected profile has role `admin` and an edit token is saved on this device. Direct navigation supports entering a token without saving it. Neither the PIN nor the selected profile authenticates an administrator: every admin read/write independently verifies an active user's token and server-side role.

- **Overview:** authenticated actor, revisions, current semester, table statistics, recent audit and diagnostics.
- **Users:** search/filter active and inactive users; create, rename, change roles, deactivate/reactivate and rotate tokens; view preferences and manage enrollments from the full semester catalog.
- **Audit:** actor/action/entity/date/search filters, pagination and readable changes with expandable sanitized raw data. Date filters use UTC.
- **System:** schema version, integrity checks, missing preference rows, temporary course codes, courses without lessons and semester administration.

Slugs and user IDs cannot be edited. Users are never deleted. Deactivation preserves schedule/preferences/history and revokes token access. Reactivation rotates the token by default, with an explicit option to retain it. The last active administrator cannot be demoted or deactivated. Role changes, token rotation, and activation changes require confirmation; self-demotion/deactivation closes the admin session.

Created/rotated tokens are displayed once and must be stored securely. Other users' tokens, admin responses and drafts are never written to local storage or an offline queue. Saving your own token is opt-in; ending a session does not remove a previously saved own token (use **Settings → Data and privacy**). A saved own token is replaced after self-rotation. Server-rejected credentials clear private admin state; late responses from an old session are discarded.

Writes use a base revision and the backend lock. On `STALE_DATA`, close the dialog, refresh/reload the affected profile, review the preserved draft against the new snapshot and submit again. Neither conflicts nor uncertain network failures trigger automatic write retries. Reconnection refreshes reads only. Offline admin writes are disabled.

The admin API requires the updated Apps Script bundle (`12_Admin.gs`); publishing just the frontend is not enough. There is no new schema table for this feature. Existing schema-v1 databases must first run `upgradeSchedulerSchema()`; existing users' roles/tokens are never silently changed. See [backend setup and recovery](apps-script/README.md).

`npm run check` also runs admin integration tests using the real backend auth/validation code with mocked Sheets I/O, and DOM tests for sessions, token lifetime, access revocation, write races and enrollment editing. Live Google Sheets writes and PIN-protected browser interaction are separate manual checks.

## GitHub Pages

The `.github/workflows/deploy.yml` workflow tests and builds the site. The Apps Script URL is supplied through the `SCHEDULE_API_URL` repository variable.

Backend setup is documented in [apps-script/README.md](apps-script/README.md).
