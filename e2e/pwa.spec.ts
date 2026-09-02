import { test, expect, openSchedule, action } from './fixtures';

test('production service worker reloads the cached app offline including lazy admin', async ({
  page,
  context,
  network,
}) => {
  await openSchedule(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // First activation intentionally does not claim an already open page.
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    )
    .toBe(true);
  await expect(
    page.getByRole('status').filter({ hasText: 'Up to date' }),
  ).toBeVisible();
  network.offline = true;
  await context.setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  await expect(
    page.getByRole('status').filter({ hasText: 'Offline — data from' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Week 6', exact: true }).click();
  await action(page, 'Settings');
  await expect(
    page.getByRole('heading', { name: 'Settings', exact: true }),
  ).toBeVisible();
  await page.goto('./#/admin');
  await expect(
    page.getByRole('heading', { name: 'Verify admin access' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Verify token' }),
  ).toBeDisabled();
});

test('manifest and installed shell contain public assets but never API responses', async ({
  page,
  backend,
}) => {
  await openSchedule(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  const manifest = await page.evaluate(async () => {
    const link = document.querySelector<HTMLLinkElement>(
      'link[rel="manifest"]',
    )!;
    return (await fetch(link.href)).json();
  });
  expect(manifest).toMatchObject({
    scope: '/scheduler/',
    display: 'standalone',
    start_url: '/scheduler/#/',
  });
  expect(manifest.icons).toHaveLength(3);
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const requests = await Promise.all(
      keys.map(async (key) =>
        (await (await caches.open(key)).keys()).map((request) => request.url),
      ),
    );
    return requests.flat();
  });
  expect(cached.some((url) => url.includes('index.html'))).toBe(true);
  expect(cached.some((url) => url.includes('admin-page-'))).toBe(true);
  expect(
    cached.some(
      (url) => url.includes('scheduler.test') || url.includes(backend.token),
    ),
  ).toBe(false);
});
