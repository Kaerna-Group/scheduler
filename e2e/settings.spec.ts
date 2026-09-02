import {
  test,
  expect,
  openSchedule,
  action,
  openImport,
  enterPin,
  tokenKey,
  rememberLabel,
} from './fixtures';

test('theme changes immediately and survives navigation/reload', async ({
  page,
}) => {
  await openSchedule(page);
  await action(page, 'Settings');
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.getByRole('link', { name: 'Back to schedule' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await action(page, 'Settings');
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
});

test('default token survives reload but not tab closure or another tab', async ({
  page,
  context,
  backend,
}) => {
  await openSchedule(page);
  await openImport(page, backend);
  await expect(
    page.getByRole('checkbox', { name: rememberLabel }),
  ).not.toBeChecked();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), tokenKey),
  ).toBeNull();
  await page.reload();
  await expect(
    page.getByLabel('Personal edit token', { exact: true }),
  ).toHaveValue(backend.token);
  const other = await context.newPage();
  await other.goto('./#/import');
  await expect(
    other.getByLabel('Personal edit token', { exact: true }),
  ).toHaveValue('');
  await page.close();
  await other.reload();
  await expect(
    other.getByLabel('Personal edit token', { exact: true }),
  ).toHaveValue('');
});

test('remember opt-in persists across tabs; withdrawing it removes the device copy', async ({
  page,
  context,
  backend,
}) => {
  await openSchedule(page);
  await openImport(page, backend);
  await page.getByRole('checkbox', { name: rememberLabel }).check();
  const other = await context.newPage();
  await other.goto('./#/import');
  await expect(
    other.getByLabel('Personal edit token', { exact: true }),
  ).toHaveValue(backend.token);
  await page.getByRole('link', { name: 'Back to schedule' }).click();
  await action(page, 'Settings');
  await expect(
    page.getByText('Saved on device', { exact: true }),
  ).toBeVisible();
  await page.getByRole('checkbox', { name: rememberLabel }).uncheck();
  await expect(
    page.getByText('Until this tab closes', { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), tokenKey),
  ).toBeNull();
  const fresh = await context.newPage();
  await fresh.goto('./#/import');
  await expect(
    fresh.getByLabel('Personal edit token', { exact: true }),
  ).toHaveValue('');
});

test('remove token confirmation supports Cancel and removes both storage copies', async ({
  page,
  backend,
}) => {
  await openSchedule(page);
  await openImport(page, backend);
  await page.getByRole('checkbox', { name: rememberLabel }).check();
  await page.getByRole('link', { name: 'Back to schedule' }).click();
  await action(page, 'Settings');
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    page.getByText('Saved on device', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Confirm', exact: true })
    .click();
  await expect(page.getByText('Not saved', { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      (key) => [localStorage.getItem(key), sessionStorage.getItem(key)],
      tokenKey,
    ),
  ).toEqual([null, null]);
});

test('Lock now restores the PIN gate and preserves the timetable', async ({
  page,
  backend,
}) => {
  const before = backend.snapshot();
  await openSchedule(page);
  await action(page, 'Settings');
  await page.getByRole('button', { name: 'Lock', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Enter your PIN' }),
  ).toBeVisible();
  await enterPin(page);
  await expect(
    page.getByRole('combobox', { name: 'Schedule user' }),
  ).toBeVisible();
  expect(backend.snapshot()).toEqual(before);
});
