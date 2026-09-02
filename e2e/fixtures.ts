import { test as base, expect, type Page } from '@playwright/test';
import { createTestBackend } from '../tests/support/apps-script-backend';
import type { UserSchedule } from '../lib/schedule/types';

type Backend = ReturnType<typeof createTestBackend>;
type Network = { unavailable: boolean; offline: boolean };
export const tokenKey = 'scheduler_edit_token_v2:ermolz';
export const rememberLabel = 'Remember this edit token on this device';

export const test = base.extend<{
  backend: Backend;
  network: Network;
  isolation: void;
}>({
  // Playwright requires an object dependency pattern even without dependencies.
  // eslint-disable-next-line no-empty-pattern
  backend: async ({}, provide) => {
    const backend = createTestBackend();
    const data = backend.snapshot();
    data.Users.push({
      ...data.Users[0],
      user_id: 'U002',
      slug: 'zahar',
      display_name: 'Zahar',
      role: 'user',
      edit_token_hash: '',
    });
    data.UserPreferences.push({ ...data.UserPreferences[0], user_id: 'U002' });
    const enrollment = data.Enrollments.find(
      (row) => row.offering_id === 'OFF-ELECTRONICS-26',
    )!;
    data.Enrollments.push({
      ...enrollment,
      enrollment_id: 'ENR-E2E-ZAHAR',
      user_id: 'U002',
    });
    data.Semesters.push({
      semester_id: 'SEM-2026-SPRING',
      title: 'Spring 2026 (archive)',
      start_date: '2026-02-02',
      weeks_count: '14',
      active: 'no',
    });
    backend.replaceDatabase(data);
    await provide(backend);
  },
  // eslint-disable-next-line no-empty-pattern
  network: async ({}, provide) => {
    await provide({ unavailable: false, offline: false });
  },
  isolation: [
    async ({ context, backend, network }, provide, testInfo) => {
      const unexpected: string[] = [];
      const errors: string[] = [];
      context.on('page', (page) =>
        page.on('pageerror', (error) => errors.push(error.message)),
      );
      // All browser traffic is either local public assets or our in-memory API.
      // Even an accidentally inherited production URL cannot contact Google.
      await context.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (
          url.origin === 'https://scheduler.test' &&
          url.pathname === '/exec'
        ) {
          if (network.offline) return route.abort('internetdisconnected');
          if (network.unavailable)
            return route.fulfill({
              status: 503,
              body: 'Test backend unavailable',
            });
          if (request.method() === 'OPTIONS')
            return route.fulfill({
              status: 204,
              headers: {
                'access-control-allow-origin': '*',
                'access-control-allow-headers': '*',
                'access-control-allow-methods': 'GET, POST, OPTIONS',
              },
            });
          const response = await backend.fetch(request.url(), {
            method: request.method(),
            body: request.postData() ?? undefined,
          });
          return route.fulfill({
            status: response.status,
            contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' },
            body: await response.text(),
          });
        }
        if (url.origin === 'http://127.0.0.1:4179') return route.continue();
        unexpected.push(url.origin + url.pathname);
        return route.abort('blockedbyclient');
      });
      try {
        await provide();
      } finally {
        if (testInfo.status !== testInfo.expectedStatus) {
          await testInfo.attach('backend-actions', {
            contentType: 'application/json',
            body: Buffer.from(
              JSON.stringify(
                backend.calls.map(({ method, action, response }) => ({
                  method,
                  action,
                  ok: (response as { ok?: boolean }).ok,
                })),
                null,
                2,
              ),
            ),
          });
        }
        expect(
          unexpected,
          'No requests may reach an external/production server',
        ).toEqual([]);
        expect(errors, 'No uncaught browser errors').toEqual([]);
      }
    },
    { auto: true },
  ],
});
export { expect };

export async function enterPin(page: Page) {
  await page.getByRole('textbox', { name: 'Four-digit PIN' }).fill('2026');
  await page
    .getByRole('button', { name: 'Open schedule', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Enter your PIN' }),
  ).toBeHidden();
}
export async function openSchedule(page: Page, hash = '#/week/5?user=ermolz') {
  await page.goto('./' + hash);
  await enterPin(page);
  await expect(
    page.getByRole('status').filter({ hasText: 'Up to date' }),
  ).toBeVisible();
}
export async function action(page: Page, name: string) {
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}
export async function choose(page: Page, name: string, option: string) {
  await page.getByRole('combobox', { name, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
export async function view(page: Page, name: string) {
  // Desktop header and mobile bottom navigation contain the same controls.
  await page
    .getByRole('button', { name, exact: true })
    .filter({ visible: true })
    .click();
}
export async function openImport(page: Page, backend?: Backend) {
  await action(page, 'Import schedule');
  await expect(
    page.getByRole('heading', { name: 'Schedule import', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Refresh data before import' }),
  ).toBeEnabled();
  if (backend)
    await page
      .getByLabel('Personal edit token', { exact: true })
      .fill(backend.token);
}
export function schedule(backend: Backend, user = 'ermolz') {
  return backend.buildSchedule(user) as UserSchedule;
}
