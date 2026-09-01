# Google Apps Script backend

## Що вже реалізовано

- реляційна схема з 12 листів, включно з `UserPreferences`;
- `setupScheduler()` для створення схеми та початкових даних;
- `GetUserSchedule` через `GET ?action=schedule&user=...&semester=...`;
- один DTO для frontend, без join-ів у React;
- персональні edit token-и, у таблиці зберігається тільки SHA-256 hash;
- ролі `user`, `editor`, `admin`;
- preview та виконання JSON import;
- `merge` і `replace my enrollments`;
- `COURSE_DATA_CONFLICT` для розбіжностей у спільних Lessons;
- optimistic concurrency через `baseRevision` / `STALE_DATA`;
- окремий `settings_revision` та `updatePreferences`, який приймає лише edit token власника;
- `LockService` на час запису;
- пакетні записи таблиць;
- `AuditLog`;
- експорт через frontend.

## Розгортання через редактор Google

1. Створіть порожній Google Spreadsheet.
2. Відкрийте **Extensions → Apps Script**.
3. Локально виконайте `npm run apps-script:bundle`.
4. Скопіюйте вміст `apps-script/dist/Code.gs` у файл `Code.gs` редактора.
5. Замініть manifest на `apps-script/appsscript.json` у налаштуваннях проєкту.
6. Запустіть функцію `setupScheduler()` і надайте дозволи.
7. Скопіюйте `editTokens.ermolz` з результату виконання — відкритий токен більше ніде не зберігається.
8. Оберіть **Deploy → New deployment → Web app**:
   - Execute as: **Me**;
   - Who has access: **Anyone**.
9. Скопіюйте URL, що закінчується на `/exec`.
10. У GitHub репозиторії `Kaerna-Group/scheduler` створіть Actions variable `SCHEDULE_API_URL` із цим URL та перезапустіть workflow.

## Розгортання через clasp

Якщо `clasp` авторизований:

```bash
cd apps-script
cp .clasp.json.example .clasp.json
# вставте scriptId
npx @google/clasp push
npx @google/clasp deploy --description "Scheduler API"
```

`.clasp.json` із реальним script ID не слід комітити.

## Додавання користувачів

У редакторі Apps Script запустіть:

```js
createSchedulerUser('Zahar', 'zahar', 'user')
```

Функція поверне одноразово видимий `editToken`. Передайте його тільки цьому користувачу. Для заміни скомпрометованого токена:

```js
rotateSchedulerEditToken('zahar')
```

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

POST надсилається як `text/plain;charset=utf-8`, щоб Apps Script web app приймав запит без CORS preflight. Вміст залишається JSON.

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

`settings_revision` не змінює `data_revision`. Навіть admin не може змінити preferences іншого користувача без edit token цього користувача.

## Початкові дані

Seed містить поточний розклад Ermolz, включно зі Scrum group 3 та Кваліфікаційною роботою без Lessons. Для невідомих університетських кодів використані тимчасові значення `LOCAL-*`; їх потрібно замінити реальними кодами до імпорту розкладів інших користувачів.

Для вже створеної таблиці після оновлення коду один раз запустіть `migrateTymofiiUserToErmolz()`. Функція змінює лише slug користувача `U001`, зберігає його token та enrollments і записує зміну в AuditLog.
