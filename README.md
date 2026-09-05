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

### Local E2E browser tests (not CI)

```bash
npm run test:e2e:install
npm run test:e2e
```

The opt-in Playwright suite checks the built app in desktop/mobile Chromium and a separate real-service-worker PWA project. It uses isolated in-memory Apps Script data, never the working Google Sheets backend. Browser tests are **not** included in `npm test`, `npm run check`, or GitHub Actions. See [commands, scenarios, reports and isolation](e2e/README.md). `npm run test:e2e:ui` opens the interactive runner; `npm run test:e2e:report` opens the last report.

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

## Course details

In **Courses**, click a course card or select a course in the filter to open its full semester schedule at `#/courses?...&subject=...`. Lectures and group classes appear separately in date/time order, with a row for each scheduled occurrence: academic week, date, time, teacher, room and format. Counts reflect actual classes across the semester, including sparse weeks and Saturdays, regardless of the previously selected week or hidden-day preferences. Dates use the same Monday-based academic weeks as the weekly view and calendar export; times remain university local time (Europe/Kyiv).

**Back to all courses** clears the subject while retaining the selected user, semester and previous week. **Copy schedule link** includes that selection so the detail view can be opened on another device. Details use the existing personal `UserSchedule` and cached offline data. Courses without classes and missing linked courses have explicit empty states.

When two or more users share a class, their initials appear at the bottom right of its card in Today, Week and course details. Hover, click or tap the avatars to see the names. Matches require the same course offering, semester dates, weekday, start/end times, lesson type and scheduled week; group classes also require the same group. The displayed schedule's owner is included. Matching a course name alone or merely overlapping times does not count.

Participants are calculated by the backend from active users, enrollments, offerings, `LessonGroups` and `LessonWeeks` in the same database snapshot as the personal schedule. Each occurrence is identified by `semesterId + lessonId + week`; simultaneous lessons remain separate, while one canonical lesson assigned to several groups includes every enrolled user whose group is allowed. The result is returned in the normal schedule response, so the client makes no per-user requests and cannot compare mismatched revisions. Cached lists are labeled as saved data, and older responses without the participant projection show an explicit unavailable status instead of looking like a completed empty check. No schema migration is needed.

System diagnostics warn about active duplicate enrollments, invalid enrollment/group relationships and normalized duplicate subject names with different IDs. These warnings never merge data automatically.

## Changes since the previous synchronization

After a successful schedule refresh, a compact notice such as **2 classes changed → View changes** appears below synchronization status when meaningful changes were found. Clicking opens a read-only diff with added, updated and removed lesson rules, exact before/after fields (weeks, time, day, room, teacher, format, type/group and course), revisions and synchronization timestamps. Course/enrollment and semester metadata changes are listed separately, including courses without lessons. The comparison covers the whole personal semester, not the selected week or course filter. One changed recurring rule counts as one class, not as fourteen calendar occurrences.

The repository captures the previous cached DTO **before** saving the new response. Each successful refresh advances this baseline, including automatic refresh on opening/reconnection. Comparisons are isolated by user ID/slug and semester ID; the initial fallback/first download is not presented as a mass change. Array order, duplicate week values, profile/settings/revision-only updates, colors and other groups' availability do not create notifications. Stable lesson IDs are used; recreated IDs are honestly reported as removal/addition rather than guessed to be the same rule. Invalid comparison snapshots are ignored without failing an otherwise successful refresh. If local storage is blocked, the mounted screen can compare with its last successfully synchronized in-memory snapshot.

The notice remains until dismissed, a selection change, or the next successful refresh (an unchanged refresh clears it). A failed or canceled request does not replace the last successful comparison; canceled responses cannot overwrite its cached baseline. Closing the dialog does not dismiss the notice. A newer comparison closes an open older dialog to avoid silently changing what is being read. This is an in-memory, net difference between consecutive syncs, **not** an unread inbox or a replacement for AuditLog; **Full change history** opens the existing history page for authors and intermediate operations. Viewing/dismissing the diff makes no backend writes or additional requests and does not clear the schedule cache.

`tests/sync-diff.test.ts`, `tests/sync-changes-notice.test.tsx` and `tests/sync-changes-flow.test.tsx` cover semantic comparison, dialog accessibility and real frontend/isolated Apps Script synchronization, including repeated refresh, offline recovery, cache-disabled operation, target isolation and late canceled responses. They run with the normal `npm test` / `npm run check` workflow. No backend or storage schema migration is required.

## Next class

A compact **Сьогодні · Київ** block above the schedule shows the selected user's next class today: course, start time, room/online format and a live countdown. During a class it shows **Зараз** with time remaining, plus the nearest upcoming class when there is one. Simultaneous classes are shown together instead of picking one arbitrarily. After the final class ends it says **На сьогодні все**; a day without classes says **Сьогодні пар немає**.

This block always uses the actual day in **Europe/Kyiv** and the **whole selected personal schedule**, independently of the displayed week, course filter, view or Saturday visibility. It respects exact `LessonWeeks` and personal groups. Dates before/after the selected semester are reported explicitly, never clamped into its first/last week. Academic weeks start on Monday, consistently with the calendar export. Archived semesters use their own date range, not the current semester's lessons.

The countdown refreshes on minute boundaries and immediately on focus, visibility changes and page restoration. It pauses its timer while hidden and makes no additional backend requests. Cached/offline and example data are labeled; unavailable/loading selections never show another user's lessons. Calendar export and this block share the same university clock conversion, including daylight-saving changes. Unit, timer/UI and real isolated Apps Script integration tests cover these behaviors in `tests/next-lesson*.test.*`, included in `npm test` and CI.

## Calendar export (.ics)

Choose a user and semester, then open **⋯ → Export semester (.ics)**. The dialog previews the owner, semester, event count, university time zone and data revision before **Download .ics**. It exports the **whole selected personal semester**: the current week, course filter, Today/Courses view and hidden Saturdays do not restrict the file. Archived semesters are supported. No backend mutation or calendar-account connection is needed.

Each distinct entry in a lesson's `weeks` (`LessonWeeks` in Sheets) produces its own dated `VEVENT`; there is no semester-wide `RRULE`. Sparse weeks stay sparse, duplicate week numbers are deduplicated, and courses without lessons do not create fake events. Week 1 starts on the Monday of the week containing `semester.startDate`, matching the schedule UI.

Lesson times are interpreted in **Europe/Kyiv**, matching the Apps Script project time zone, and each occurrence is converted separately to UTC using the browser's IANA time-zone data. This includes daylight-saving transitions and is independent of the exporting device's time zone. Calendar apps can display those instants in their own configured zone. If a clock time cannot be resolved, export fails rather than guessing. The current schema has no per-semester time zone; update the shared assumption if the university time zone changes.

Files follow [iCalendar/RFC 5545](https://www.rfc-editor.org/rfc/rfc5545): CRLF endings, UTF-8-safe 75-octet line folding, escaped text, UTC date-times, stable owner/semester/lesson/week UIDs and revision-based `SEQUENCE`. Events include course, lecture/group, teacher, location, format and academic week. No PINs, tokens, invitations or alarms are exported.

This is a **one-time snapshot, not a subscribed calendar**. Later changes/deletions are not synchronized; stable UIDs help identify occurrences but do not guarantee that a calendar application's repeated file imports will update or remove old events. Re-imports may duplicate or retain obsolete events. Prefer a separate calendar when importing snapshots repeatedly.

Cached schedules can be exported offline with an explicit saved-data warning; bundled fallback data is labeled as an example. Export is disabled while an unknown selection is loading or unavailable. Empty semesters and invalid data show an explanation instead of downloading an empty/partial file. If a browser blocks downloading, the dialog supports retry.

`npm run test:calendar` runs the calendar unit and real-frontend/isolated-Apps-Script download tests, also included in the normal check/CI. The independent `ical.js` parser is a **test-only** dependency and is not shipped to the browser. Tests cover exact weeks, both clock transitions, host-time-zone independence, Unicode/injection safety, personal groups, archives, filters, offline data, empty/invalid schedules, download failures and blob cleanup. Importing into a real Google/Apple/Outlook calendar is a separate manual check.

## Offline and synchronization

### Installable app (PWA)

Open **⋯ → Add to home screen** (also available below the PIN form). When the browser provides its native install prompt, **Install app** opens it after your click. Otherwise the dialog explains manual installation: in Safari on iPhone/iPad, **Share → Add to Home Screen** (enable **Open as Web App** if offered); in supporting Android/desktop browsers, use the browser's install menu. Cancellation never triggers repeated prompts. Installed/standalone windows show **App information** instead. See [Apple's installation instructions](https://support.apple.com/en-euro/guide/iphone/iphea86e5236/ios).

The production build includes a web manifest with a stable `/scheduler/` identity/scope, standalone display, 192/512 px icons, a dedicated maskable entry and an Apple touch icon. The launch URL contains no selected user, token or other private state. PIN protection and server-side authorization are unchanged. Some platforms use separate storage for the installed app, so first launch may require unlocking, entering an own edit token and synchronizing again.

The service worker precaches **only the public app shell**: the entry HTML, build-versioned JS/CSS (including the lazy admin page), theme/storage bootstrap scripts, manifest and icons. It never caches Apps Script responses, tokens, administrative data, POST requests or arbitrary runtime URLs. Hash links such as `#/week/5?user=ermolz` open through the cached entry document; other site paths are not navigation fallbacks. It does not implement background writes or change existing retry rules.

First open the app online and wait for **App ready offline**. Also open each required personal semester online once: schedule data still uses the existing per-user/per-semester local cache, independently of the shell. Without a saved personal schedule, the existing example/unavailable state is shown, never invented fresh data. Imports, administration and synchronization require internet. Browser/app data clearing, eviction or device storage restrictions can remove offline copies; this is not a permanent backup.

Updates are checked on startup, reconnection, returning to the app (throttled), and hourly while visible. A new shell downloads in the background and waits for **Review update → Update and reload**. No automatic reload interrupts a form. **Later** or dismissing the notice keeps the update available in **⋯ → Update app**. Before accepting, finish drafts and close other app windows after saving; only the confirming window reloads. Existing local schedules and pending preferences remain intact. Failed downloads never replace the active shell, registration failures retry on reconnection, and unavailable/private-browser installation falls back to instructions.

PWA registration is **disabled in `npm run dev`**, so it cannot cache hot-reload assets. Test a production build with `npm run build` and `npm run preview -- --host 127.0.0.1`; installation needs HTTPS or localhost. The GitHub Pages workflow already runs this same build. Publishing PWA only needs the frontend deployment, not an Apps Script update or Sheets migration.

`npm run test:pwa` covers install/update lifecycle, user confirmation, failure/retry, cleanup, standalone detection and PIN-preserving UI. Every `npm run build` also verifies the **generated** service worker in an isolated browser-boundary harness: exact precache assets and revisions, PNG sizes, offline hash navigation and lazy chunks, API/POST bypass, activation cleanup, explicit update messages and failed downloads. These checks are included in `npm run check` and CI. Icons are generated reproducibly from `public/icons/app-icon.svg` with `npm run icons:generate`; `icons:check` rejects outdated PNGs. Actual device installation remains a manual platform check.

### Data synchronization

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

### Edit token lifetime

Import, preferences synchronization, history undo and administration share one per-user token store. By default, a token lives in **sessionStorage for this tab**: it survives navigation and reloads, but not the end of the tab session. **Remember this edit token on this device** explicitly opts in to localStorage. Settings shows the actual lifetime and lets you change it or remove tokens. Unchecking removes the persistent copy while retaining access in the current tab. If browser storage is blocked, a memory-only fallback works until reload and the UI reports the limitation.

Storage migration v3 moves previously auto-saved v1 tokens to this tab without treating their presence as consent. It never overwrites a newer token and removes the old persistent copy only after a successful transfer. New opt-in persistent tokens use v2 keys. Browser session restoration/duplicated tabs may restore or copy sessionStorage; on shared devices explicitly remove tokens or clear site data instead of relying on closing a window. This does not revoke the server token; rotation does. The PIN remains a local UI lock, not server authentication.

## Administration

Open `#/admin` after the site PIN gate. The Admin link appears in Schedule, Import, and Settings only when the selected profile has role `admin` and an edit token is available in this tab or remembered on this device. Direct navigation supports entering a token without remembering it. Neither the PIN nor the selected profile authenticates an administrator: every admin read/write independently verifies an active user's token and server-side role.

- **Overview:** authenticated actor, revisions, current semester, table statistics, recent audit and diagnostics.
- **Users:** search/filter active and inactive users; create, rename, change roles, deactivate/reactivate and rotate tokens; view preferences and manage enrollments from the full semester catalog.
- **Audit:** actor/action/entity/date/search filters, pagination and readable changes with expandable sanitized raw data. Date filters use UTC.
- **System:** schema version, integrity checks, missing preference rows, temporary course codes, courses without lessons and semester administration.

Slugs and user IDs cannot be edited. Users are never deleted. Deactivation preserves schedule/preferences/history and revokes token access. Reactivation rotates the token by default, with an explicit option to retain it. The last active administrator cannot be demoted or deactivated. Role changes, token rotation, and activation changes require confirmation; self-demotion/deactivation closes the admin session.

Created/rotated tokens are displayed once and must be stored securely. Other users' tokens, admin responses and drafts are never written to browser storage or an offline queue. Remembering your own token is opt-in; **End session and forget token** clears private admin data and removes your own token from this tab and device. Navigating away retains your own token for its chosen lifetime, but discards private admin responses. Self-rotation preserves that lifetime. Removing or replacing the shared token clears an open admin session; invalid credentials clear its own token as well. Late responses from an old session are discarded.

Writes use a base revision and the backend lock. On `STALE_DATA`, close the dialog, refresh/reload the affected profile, review the preserved draft against the new snapshot and submit again. Neither conflicts nor uncertain network failures trigger automatic write retries. Reconnection refreshes reads only. Offline admin writes are disabled.

The admin API requires the updated Apps Script bundle (`12_Admin.gs`); publishing just the frontend is not enough. There is no new schema table for this feature. Existing schema-v1 databases must first run `upgradeSchedulerSchema()`; existing users' roles/tokens are never silently changed. See [backend setup and recovery](apps-script/README.md).

`npm run check` also runs admin integration tests using the real backend auth/validation code with mocked Sheets I/O, and DOM tests for sessions, token lifetime, access revocation, write races and enrollment editing. Live Google Sheets writes and PIN-protected browser interaction are separate manual checks.

## GitHub Pages

The `.github/workflows/deploy.yml` workflow tests and builds the site. The Apps Script URL is supplied through the `SCHEDULE_API_URL` repository variable.

Backend setup is documented in [apps-script/README.md](apps-script/README.md).

Backend schema updates use a consecutive migration registry with a durable recovery journal. `upgradeSchedulerSchema()` resumes interrupted steps without duplicating audit rows, refuses downgrades, and keeps API operations blocked until recovery completes. The current schema remains v2; manual course corrections do not run as schema migrations. See [migration steps, recovery and adding a version](apps-script/README.md#schema-migrations-and-recovery). Run `npm run test:migrations` for the isolated failure/retry tests; they also run in the unified CI check.
