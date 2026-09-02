# Local browser tests

These Playwright tests run the **production build** in real Chromium, with desktop and mobile viewport projects. They are deliberately **not** part of `npm test`, `npm run check`, or GitHub Actions. `vitest.config.ts` explicitly limits the existing test runner to `tests/**/*.test.{ts,tsx}`.

## Run

From the project root, with Node 22.13+:

```sh
npm ci
npm run test:e2e:install
npm run test:e2e
```

The browser download is needed once, and again after a Playwright version upgrade. Running the tests starts and stops a dedicated server automatically. Keep port **4179** free; the runner refuses to reuse an existing server, avoiding accidental tests against a developer session. The normal dev server on 5173 is unaffected.

```sh
npm run test:e2e -- --project=desktop
npm run test:e2e -- --project=mobile
npm run test:e2e -- --project=pwa
npm run test:e2e -- --grep "shared conflicts"
npm run test:e2e -- --repeat-each=2
npm run test:e2e:headed
npm run test:e2e:ui
npm run test:e2e:report
```

Use `test:e2e:ui` to inspect and rerun individual steps. The HTML report is saved in `playwright-report/`. Failed cases include a screenshot, video, trace (DOM/network/action timeline), and a token-free list of backend actions. Reports, recordings and the isolated `.e2e-dist/` build are ignored by Git. Traces can include **synthetic** tokens entered during the test; they never use production credentials.

## Coverage

25 scenarios run once on desktop and once on a Pixel-sized mobile viewport; 2 additional PWA scenarios use real service workers: **52 browser cases** in a full run.

| Area                 | Checked behavior                                                                                                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Navigation           | Wrong/incomplete PIN, correct unlock, reload; full user → week → course → settings → import path; week boundaries, Back/Forward, direct links, missing course recovery, view tabs, keyboard dismissal/focus, archived semester, viewport overflow |
| Settings and privacy | Theme persistence, tab-only tokens and tab closure, explicit device persistence, withdrawing consent, confirmed/canceled token removal, locking without changing backend data                                                                     |
| Import and history   | Invalid JSON, real file chooser, read-only diff, new course/lesson import, audit history, canceled/confirmed undo, per-course shared conflicts, replace enrollment diff, stale revision rejection and retry                                       |
| Synchronization      | Cached data offline, automatic reconnect, backend failure and recovery, pending preference synchronization, changed lesson diff and dismissal                                                                                                     |
| Calendar and time    | Actual ICS file download, number of events equals scheduled LessonWeeks, no full-semester recurrence, full-personal-semester export despite filters, next-class banner and end-of-day state                                                       |
| Administration       | PIN is not admin authentication, invalid-token rejection, verified user/detail/audit/system pages, logout clears token and private access                                                                                                         |
| PWA                  | Real offline shell reload, offline navigation including lazy admin code, manifest, public precache without API responses                                                                                                                          |

The mobile project emulates Chromium's viewport/touch behavior, not a real Android device or iOS/Safari. Native OS installation prompts, live Google permissions/quotas, production deployment and visual pixel comparisons are outside this suite.

Playwright is pinned to **1.61.1**: 1.62 has a [reported offline-state regression](https://github.com/microsoft/playwright/issues/42174) where a reloaded/new offline document reports `navigator.onLine === true`. Keep the real PWA offline assertions when upgrading; do not replace the browser's network state with a JavaScript stub to hide the regression. Tests request reduced motion for stable interaction timing.

## Isolation and maintenance

- Each test gets a fresh browser context and a fresh in-memory database. There are no shared test accounts, disk-persisted browser profiles, credentials or cross-test mutations.
- The frontend API URL is forcibly set to `https://scheduler.test/exec` before the separate build, overriding real `.env` values. A context-level network allowlist accepts only that intercepted API and `127.0.0.1:4179`; unexpected external requests fail the test.
- API requests execute the project's actual Apps Script GET/POST/auth/import code through `tests/support/apps-script-backend.ts`. Only Google storage/services are simulated. This is browser-to-backend-logic coverage, **not** a live Google Sheets integration test.
- Ordinary cases block service workers so old shell caches cannot hide interface regressions. The dedicated PWA project allows them in fresh contexts and checks actual offline navigation.
- Prefer semantic labels/roles, automatic expectations and awaited requests. Do not add arbitrary sleeps, test-order dependencies, production URLs, real tokens, or retries to hide intermittent failures. Uncaught page errors fail every scenario.
- Keep this suite opt-in. Do not add browser downloads or E2E commands to CI or the normal `check` chain unless explicitly requested.

Playwright's official [web server documentation](https://playwright.dev/docs/test-webserver) and [fixtures guide](https://playwright.dev/docs/test-fixtures) describe the runner configuration and test isolation used here.
