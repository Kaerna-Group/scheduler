import { test, expect, openSchedule, tokenKey } from './fixtures';

test('PIN does not grant admin rights; invalid token leaves private pages locked', async ({
  page,
  backend,
}) => {
  await openSchedule(page);
  await page.goto('./#/admin');
  await expect(
    page.getByRole('heading', { name: 'Verify admin access' }),
  ).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Admin sections' }),
  ).toBeHidden();
  await page
    .getByLabel('Admin edit token', { exact: true })
    .fill('definitely-not-valid');
  await page.getByRole('button', { name: 'Verify token' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Admin sections' }),
  ).toBeHidden();
  expect(backend.storage.writes).toEqual([]);
});

test('verified admin can browse users, audit and system; logout clears access', async ({
  page,
  backend,
}) => {
  await openSchedule(page);
  await page.goto('./#/admin');
  await page
    .getByLabel('Admin edit token', { exact: true })
    .fill(backend.token);
  await page.getByRole('button', { name: 'Verify token' }).click();
  await expect(
    page.getByRole('heading', { name: 'Overview', exact: true }),
  ).toBeVisible();
  const navigation = page.getByRole('navigation', { name: 'Admin sections' });
  await navigation.getByRole('button', { name: 'Users', exact: true }).click();
  await page.getByLabel('Search users').fill('Zahar');
  await expect(
    page.getByRole('button', { name: 'Manage Zahar', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Manage Zahar', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Preferences (read-only)' }),
  ).toBeVisible();
  await navigation.getByRole('button', { name: 'Audit', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Audit log', exact: true }),
  ).toBeVisible();
  await navigation.getByRole('button', { name: 'System', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Health and schema' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'End session and forget token' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Verify admin access' }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      (key) => [localStorage.getItem(key), sessionStorage.getItem(key)],
      tokenKey,
    ),
  ).toEqual([null, null]);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Verify admin access' }),
  ).toBeVisible();
});
