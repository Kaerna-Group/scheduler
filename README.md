# Scheduler

Адаптивний React/Vite-розклад із GitHub Pages frontend та реляційним Google Sheets backend через Google Apps Script.

## Архітектура

```text
React UI
  ├─ useSchedule → Schedule Repository
  └─ usePreferences
      ├─ useTheme (лише застосування appearance)
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

Frontend отримує `UserSchedule` DTO разом із налаштуваннями власника. Налаштування належать `user_id`, кешуються ключем `scheduler_preferences_v2:<slug>` і мають власний `settings_revision`, незалежний від revision розкладу.

## Локальний запуск

```bash
npm install
npm run dev
```

Без `VITE_SCHEDULE_API_URL` сайт працює на fallback-даних. Для remote backend скопіюйте `.env.example` у `.env.local` і додайте URL Apps Script deployment.

## Перевірки

```bash
npm test
npm run build
npm run apps-script:bundle
```

Тести охоплюють конфлікти, імпорт, міграцію preferences, правило server-wins, незалежні revision та token-захист персональних налаштувань.

## Import / Export

Стандартний формат має `schemaVersion: 1`, `semesterId` та `subjects[]`. JSON є транспортним форматом, але не способом зберігання в Sheets. Приклад: [docs/schedule-import.example.json](docs/schedule-import.example.json).

Режими імпорту:

- `merge` — додає або оновлює передані enrollment-и;
- `replace` — робить JSON повним списком enrollment-ів поточного користувача, не видаляючи глобальні дисципліни або заняття.

Запис захищений персональним edit token. У bundle зберігається лише публічний frontend; спільних секретів у Vite-коді немає.

## GitHub Pages

Workflow `.github/workflows/deploy.yml` збирає та тестує сайт. URL Apps Script передається через repository variable `SCHEDULE_API_URL`.

Налаштування backend описане в [apps-script/README.md](apps-script/README.md).
