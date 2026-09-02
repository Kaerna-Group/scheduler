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

## Offline and synchronization

The schedule distinguishes fresh, offline/cached, pending-change and backend-unavailable states. Online/offline events refresh its snapshot on reconnection. Preferences keep per-user pending patches locally and resume synchronization on reconnection, focus or token replacement. Transient failures retry with a bounded backoff (2–30 seconds); individual requests time out after 30 seconds. User changes and unmounts cancel obsolete retries and ignore late responses. Authentication and validation failures do not retry automatically.

Only idempotent preference patches use automatic write retries. Imports, undo, enrollment changes and administrative writes require online confirmation and a current revision; uncertain writes are never automatically replayed.

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
