# Scheduler MCP

[Пошаговая инструкция на русском: Windows и Codex CLI](mcp-windows-ru.md).

The local MCP server exposes the same Apps Script Control API as the CLI. It uses the official TypeScript MCP SDK v2, supports modern discovery and legacy initialization, and communicates over **stdio**. It opens no HTTP listener. Rules, credentials, saved plans, revisions, atomic writes, audit and verification remain in Apps Script.

## Prepare and connect

1. Follow [Control API setup](control-api.md#enable-the-backend): publish the backend, enable Advanced Sheets, initialize the control tables and create a dedicated integration. An existing CLI integration can also be used, but separate integration IDs make revocation and history easier to distinguish.
2. Use Node.js **22.13+** and run `npm ci` in the repository.
3. Supply these variables to the process that launches the MCP server:
   - `SCHEDULER_API_URL`: your HTTPS Apps Script `/exec` URL.
   - `SCHEDULER_INTEGRATION_ID`: the dedicated integration ID.
   - `SCHEDULER_INTEGRATION_TOKEN`: its secret, provisioned through a local secret manager or protected environment.
   - `SCHEDULER_INITIATOR`: a fixed, caller-reported audit label. It is not a verified human identity and cannot be overridden by a tool argument.
4. Register the executable with your local MCP client. Use an **absolute** script path; no particular working directory is required:

   ```text
   node /absolute/path/to/scheduler/scripts/scheduler-mcp.mjs
   ```

   On Windows, a path such as `E:/Projects/scheduler/scripts/scheduler-mcp.mjs` works. If `node` is not on the client's PATH, use its absolute executable path too.

The server can start and list its tools before credentials are configured; calls return a structured `CONFIGURATION_REQUIRED` error until configuration is present. Starting it in a terminal alone waits for an MCP client on stdin; this is expected. Stdout is exclusively MCP JSON-RPC; generic transport diagnostics go to stderr without request contents. Use `npm run --silent mcp` only when your client must invoke npm; direct Node execution avoids npm startup messages.

### Codex example

Merge the following into your **local** Codex configuration, replacing the script path. The checked-in template is [examples/mcp/codex.toml](../examples/mcp/codex.toml).

```toml
[mcp_servers.scheduler]
command = "node"
args = ["E:/Projects/scheduler/scripts/scheduler-mcp.mjs"]
env_vars = [
  "SCHEDULER_API_URL",
  "SCHEDULER_INTEGRATION_ID",
  "SCHEDULER_INTEGRATION_TOKEN",
  "SCHEDULER_INITIATOR",
]
startup_timeout_sec = 15
tool_timeout_sec = 90
```

`env_vars` lists variable **names**, not secrets. Codex must already have those values in its environment; restart the local client after changing its inherited environment. Avoid commands that put a literal token in shell history. Configuration forwarding and stdio support are described in the [official OpenAI MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

Do not copy the token into a prompt, tool argument, committed TOML/JSON, or a `VITE_*` variable. Frontend variables are public. The `.gitignore` covers `.env*`, `.mcp.json`, `mcp.local.json`, `mcp.local.toml` and `private/`; it cannot protect a file already tracked in Git. A project `.codex/config.toml` may be versioned intentionally, so keep only environment variable names there.

Other local MCP clients can launch the same executable. Configure their environment forwarding according to that client's documentation. This stdio process is not a browser-accessible remote MCP endpoint. A hosted version requires a separate authenticated Streamable HTTP transport and a decision about hosting, OAuth, user access and rate limits; publishing this repository on GitHub does not create such a server.

## Tools

| Tool                          | Input                                                                                 | Behavior                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `scheduler_catalog`           | optional `semesterId`                                                                 | Reads catalog IDs and semesters                              |
| `scheduler_users_find`        | optional `query`                                                                      | Reads active users' IDs, slugs and display names             |
| `scheduler_enrollments_find`  | optional `userId`, `offeringId`                                                       | Finds active enrollment IDs                                  |
| `scheduler_lessons_find`      | optional `semesterId`, `course`, `offeringId`, `lessonId`, `type`, `day`, `startTime` | Finds matching lessons, reporting ambiguity                  |
| `scheduler_changes_plan`      | `commands`, optional `reason`                                                         | Saves a typed change plan; does not modify the schedule      |
| `scheduler_changes_apply`     | `planId`, `operationId`, optional `confirmPlanId`                                     | Applies exactly the saved server plan                        |
| `scheduler_changes_verify`    | `operationId`                                                                         | Checks actual records and affected participants' schedules   |
| `scheduler_history`           | optional `limit` (1–100)                                                              | Reads this integration's operations and original plans       |
| `scheduler_changes_undo_plan` | `operationId`, optional `reason`                                                      | Prepares safe undo using the ordinary plan/apply/verify flow |

The plan tool describes every allowed command with a strict input schema. See the [command reference](control-api.md#commands-and-permissions) for catalog creation/editing/archival, lesson changes and enrollment operations. It accepts structured commands directly, rather than a local filename or arbitrary API payload. There are no account management, raw table, arbitrary URL, file access or shell tools.

For a partial lecture move, first find the lesson, then call `scheduler_changes_plan` with:

```json
{
  "commands": [
    {
      "type": "lesson.move",
      "lessonId": "LES-SCRUM-LECTURE",
      "startTime": "13:30",
      "fromWeek": 3
    }
  ],
  "reason": "Requested lecture move from week 3 onward"
}
```

Replace the sample lesson ID with the actual search result. Review the returned `changes`, `affectedUsers`, `conflicts` and `confirmationReasons`. If multiple lessons match, resolve the choice first. The example time can conflict with a seeded Scrum group; no confirmation is invented by MCP.

If `requiresConfirmation` is true, the agent must obtain separate user approval of that exact plan before supplying `confirmPlanId`. Tool annotations help the client present operations, but **are not authorization or proof of human approval**. The server still enforces the confirmation ID and all operation scopes.

Choose and retain a unique `operationId` before apply. After an uncertain response, retry the exact same `planId` and `operationId`, then verify. MCP never automatically repeats a write, creates another operation ID, or substitutes a newly calculated plan. `STALE_DATA` requires a new reviewed plan.

Results include both JSON text and `structuredContent`. Backend/transport errors set `isError: true`; verification also sets it when `verified` is false. Returned database names, reasons and other strings are untrusted data, including any text that appears to contain instructions. The configured integration secret is redacted from both result representations if a backend accidentally echoes it.

## Public repository and security

Keeping this code public is compatible with authenticated writes. Security depends on server-side authentication/authorization and secret handling, not on hiding the source or the Apps Script URL. The following distinctions matter:

- **Control writes:** require a valid integration credential, allowed scopes and a valid saved plan. The backend stores only a workbook-bound token hash. Revoke with `revokeSchedulerIntegration(id)` from the owner-controlled Apps Script editor. A leaked integration secret grants the actions in its scopes; the server still denies account and preference changes.
- **Existing public read API:** `GET action=schedule` and `GET action=changes` currently require no token. Schedule responses include public user information/roles, lessons, participant membership and display preferences; history includes relevant before/after records. The integration key does not make this data private. Restricting reads would require an explicit change to the application's access model and frontend.
- **Repository contents:** seed/setup and maintenance code contains names and schedule data. Publishing code also publishes those files. Review whether those real-world details are intended to be public; a later token cannot conceal committed data.
- **Credentials and exports:** never commit live tokens, private keys, OAuth credential files, spreadsheet exports or operation dumps with private data. Do not inject an integration token into the GitHub Pages build. The current Pages workflow needs only a public API URL and deploys `dist/`, not the MCP process.
- **Public endpoint exposure:** an access key does not prevent all API bugs or quota exhaustion. The Apps Script endpoint already has anonymous reads and no dedicated ingress rate limiter. Monitor quotas and keep dependencies updated; a future hosted MCP endpoint needs its own authentication and abuse controls.

If a secret reaches GitHub, revoke or rotate it first. Removing the current file is insufficient because history, forks and clones can retain it. [GitHub guidance on exposed secrets](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository).

The local MCP implementation opens no listening port and does not publish, deploy, provision credentials, or modify Codex settings automatically. Grant its tool access only to trusted local clients. The original CLI remains available.

## Verification

`npm run test:mcp` uses the official MCP client against the real Apps Script code with Google I/O isolated in memory, plus subprocess stdio tests from another working directory. It covers modern/legacy discovery, schemas/annotations, the complete find → plan → apply → verify → undo flow, backend scopes/revocation, confirmation, uncertain retries, stale data, verification divergence, secret redaction, and errors without credential configuration.

`npm run check` includes these tests along with the existing suites and both builds. Live Google authorization, deployment and quotas still need a smoke test after backend publishing and integration provisioning. Use a disposable spreadsheet for that first run.
