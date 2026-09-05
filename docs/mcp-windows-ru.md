# Scheduler MCP: настройка Windows и Codex CLI

Scheduler MCP позволяет находить занятия, готовить и применять изменения,
проверять результат и менять привязки существующих пользователей к курсам.
Создание и изменение аккаунтов, ролей, токенов и личных настроек через Control API запрещены.

Это локальный MCP-сервер. Его запускает Codex на компьютере; публичный HTTP-порт не открывается.
Адрес Apps Script `/exec` — адрес backend, а не адрес MCP для браузерного ChatGPT.

## 1. Обновить серверную часть

Если Уля уже подтвердила публикацию backend, переходи к следующему разделу.
Для самостоятельной публикации используй [инструкцию Apps Script](../apps-script/README.md#clasp-deployment).
Нужны актуальные `Code.gs` и `appsscript.json`: манифест включает сервис Sheets v4.
При использовании стандартного Google Cloud-проекта Google Sheets API нужно также
включить в этом проекте. Для автоматически созданного проекта Apps Script сервис
включается автоматически. [Инструкция Google](https://developers.google.com/apps-script/guides/services/advanced).

После обновления перезагрузи открытый редактор Apps Script, чтобы не сохранить поверх
нового кода старое содержимое вкладки. Основная схема должна иметь версию **2**.
Если `health` уже возвращает `schemaVersion: "2"`, запускать миграцию не нужно.

## 2. Создать служебные листы

1. Открой таблицу расписания и оставь её вкладку открытой.
2. Открой **Расширения → Apps Script**.
3. В списке функций рядом с кнопкой **Выполнить** выбери `setupSchedulerControl`.
4. Нажми **Выполнить**. Если Google запросит разрешения, проверь аккаунт владельца
   и разрешения этого проекта, затем предоставь доступ.
5. В таблице появятся `ControlPlans` и `ControlOperations`. Повторный запуск безопасен:
   функция не пересоздаёт аккаунты и не меняет расписание.

Не запускай первоначальное заполнение расписания для этой настройки.

## 3. Получить отдельный ключ интеграции

Функция `createSchedulerIntegration` принимает параметры, поэтому для запуска кнопкой
нужна небольшая обёртка. В редакторе создай отдельный файл **CodexSetup.gs**, вставь код
ниже и сохрани. Самого секрета в этом коде нет.

```js
function issueWindowsCodexKey() {
  // Выполнять из редактора проекта, привязанного к открытой таблице.
  const ui = SpreadsheetApp.getUi();
  const credentials = createSchedulerIntegration('windows-codex', [
    'catalog:read',
    'users:read',
    'lessons:write',
    'catalog:write',
    'enrollments:write',
    'history:read',
    'changes:undo',
  ]);
  ui.alert(
    'Ключ Scheduler для Codex',
    'ID: ' +
      credentials.integrationId +
      '\n\n' +
      'Токен (сохрани сейчас):\n' +
      credentials.integrationToken,
    ui.ButtonSet.OK,
  );
}
```

Выбери `issueWindowsCodexKey` и нажми **Выполнить**. Переключись на вкладку **Google Таблицы**:
там появится окно с ID и токеном. Скопируй токен в менеджер паролей, затем закрой окно.
Токен показывается только при создании и не записывается этим кодом в журнал или ячейки.
Диалог работает для проекта, привязанного к открытой таблице.
[Описание диалогов Google](https://developers.google.com/apps-script/reference/base/ui#alerttitle,-prompt,-buttons).

После получения ключа удали только временный файл **CodexSetup.gs**. Снова публиковать
веб-приложение для создания интеграции не требуется: ключ хранится в Script Properties
и сразу доступен уже опубликованному backend.

Если получишь `INTEGRATION_EXISTS`, ключ с таким ID уже создавался. Используй сохранённый
токен. Если токен потерян, выполни из отдельной временной функции
`revokeSchedulerIntegration('windows-codex')`, затем создай интеграцию с новым ID,
например `windows-codex-2`, изменив ID в обёртке и в переменной окружения ниже.
Это также порядок отзыва скомпрометированного ключа.

Токен интеграции — **не PIN сайта, не пользовательский editToken и не ключ OpenAI**.
Не присылай его в чат, не добавляй в GitHub, `VITE_*`, примеры или журналы.

## 4. Подключить MCP к Codex CLI

Нужны Node.js **22.13+**, установленный Codex CLI и зависимости проекта (`npm.cmd ci`).
Для текущего расположения проекта путь к серверу:

```text
E:/Anything/Projects/kaerna-group/react/scheduler/scripts/scheduler-mcp.mjs
```

Открой локальный конфигурационный файл:

```powershell
notepad "$env:USERPROFILE\.codex\config.toml"
```

Добавь блок ниже, сохранив существующие настройки. Если раздел `scheduler` уже есть,
измени его вместо добавления дубликата. При другом расположении проекта замени путь.

```toml
[mcp_servers.scheduler]
command = "node"
args = ["E:/Anything/Projects/kaerna-group/react/scheduler/scripts/scheduler-mcp.mjs"]
env_vars = [
  "SCHEDULER_API_URL",
  "SCHEDULER_INTEGRATION_ID",
  "SCHEDULER_INTEGRATION_TOKEN",
  "SCHEDULER_INITIATOR",
]
startup_timeout_sec = 15
tool_timeout_sec = 90
```

В `env_vars` нужны **названия** переменных; значения Codex получает из своего окружения.
Этот способ описан в [документации OpenAI](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

В PowerShell запусти:

```powershell
Set-Location E:\Anything\Projects\kaerna-group\react\scheduler
$env:SCHEDULER_API_URL = Read-Host "Адрес Apps Script с окончанием /exec"
$env:SCHEDULER_INTEGRATION_ID = "windows-codex"
$env:SCHEDULER_INITIATOR = "windows-codex"

$schedulerSecret = Read-Host "Токен интеграции" -AsSecureString
try {
  $env:SCHEDULER_INTEGRATION_TOKEN = [System.Net.NetworkCredential]::new("", $schedulerSecret).Password
} finally {
  $schedulerSecret.Dispose()
  Remove-Variable schedulerSecret
}

try {
  codex
} finally {
  Remove-Item Env:SCHEDULER_INTEGRATION_TOKEN -ErrorAction SilentlyContinue
}
```

Возьми существующий `/exec` из **Развернуть → Управление развертываниями → Веб-приложение**.
Не добавляй к нему `?action=...`. Ввод токена скрыт и не содержит его буквального значения
в истории команд. Секрет остаётся в окружении запущенных процессов на время работы;
после выхода из Codex последняя часть удаляет его из окружения этой оболочки.

Переменные действуют для этого окна PowerShell и его дочерних процессов.
Уже запущенное приложение Codex Desktop их автоматически не получает. Для этого
порядка настройки используй именно `codex`, запущенный из указанного окна.

## 5. Проверить подключение

В Codex CLI введи `/mcp`: должен появиться `scheduler`. Затем попроси:

```text
Прочитай каталог Scheduler через scheduler_catalog. Покажи текущий семестр
и доступные курсы. Пока ничего не меняй.
```

Успешное чтение каталога проверяет реальное подключение. Одного списка инструментов
недостаточно — сервер показывает их даже без ключа. Ошибка `CONFIGURATION_REQUIRED`
означает, что процесс не получил параметры; `UNAUTHORIZED` — неверный ID/токен или отзыв доступа;
`CONTROL_NOT_CONFIGURED` при подготовке плана — не выполнен `setupSchedulerControl`.

Первое изменение проверь на копии таблицы с отдельным backend и отдельной интеграцией.
Порядок: найти точную пару → подготовить план → проверить недели, участников и конфликты
→ применить → вызвать `scheduler_changes_verify`.
При `requiresConfirmation: true` нужно отдельно подтвердить конкретный план.
При потере ответа сохраняй те же `planId` и `operationId`; при `STALE_DATA` подготовь новый план.

Публикация исходников на GitHub не раскрывает отдельно хранящийся токен.
При этом существующие публичные чтения расписания и данные в репозитории остаются публичными:
интеграционный ключ их не скрывает. Подробнее: [границы доступа и безопасность](mcp.md#public-repository-and-security).
