# Scheduler

A responsive React/Vite schedule with a GitHub Pages frontend and a relational Google Sheets backend powered by Google Apps Script.

## Architecture

```text
React UI
  ├─ useSchedule → Schedule Repository
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
npm test
npm run build
npm run apps-script:bundle
```

Tests cover conflicts, import behavior, preference migration, the server-wins rule, independent revisions, schema upgrades, and token protection for personal preferences.

## Import and export

The standard transport format contains `schemaVersion: 1`, `semesterId`, and `subjects[]`. JSON is a transport format, not the Sheets storage model. See [docs/schedule-import.example.json](docs/schedule-import.example.json).

Import modes:

- `merge` adds or updates the provided enrollments;
- `replace` treats the JSON as the current user’s complete enrollment list without deleting global courses or lessons.

Writes are protected by personal edit tokens. The bundle contains only the public frontend; no shared secrets are included in Vite code.

## GitHub Pages

The `.github/workflows/deploy.yml` workflow tests and builds the site. The Apps Script URL is supplied through the `SCHEDULE_API_URL` repository variable.

Backend setup is documented in [apps-script/README.md](apps-script/README.md).
