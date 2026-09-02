import { test, expect, openSchedule, openImport, action } from './fixtures';

test('cached schedule stays usable offline and reconnect refreshes automatically', async ({
  page,
  context,
  network,
  backend,
}) => {
  await openSchedule(page);
  const count = () =>
    backend.calls.filter((call) => call.action === 'schedule').length;
  const before = count();
  network.offline = true;
  await context.setOffline(true);
  await expect(
    page.getByRole('status').filter({ hasText: 'Offline — data from' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Refresh', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Week 6', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Week 6', exact: true }),
  ).toHaveAttribute('aria-current', 'true');
  network.offline = false;
  await context.setOffline(false);
  await expect.poll(count).toBeGreaterThan(before);
  await expect(
    page.getByRole('status').filter({ hasText: 'Up to date' }),
  ).toBeVisible();
});

test('backend outage shows stale status without erasing cached lessons and can retry', async ({
  page,
  network,
}) => {
  await openSchedule(page);
  const heading = await page.getByRole('heading', { level: 1 }).innerText();
  network.unavailable = true;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Backend unavailable' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
  network.unavailable = false;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Up to date' }),
  ).toBeVisible();
});

test('offline preference edit is queued and synchronized after reconnection', async ({
  page,
  backend,
  context,
  network,
}) => {
  await openSchedule(page);
  await openImport(page, backend);
  await page.getByRole('link', { name: 'Back to schedule' }).click();
  await action(page, 'Settings');
  network.offline = true;
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Unsynchronized changes' }),
  ).toBeVisible();
  expect(backend.snapshot().UserPreferences[0].appearance_mode).toBe('light');
  network.offline = false;
  await context.setOffline(false);
  await expect
    .poll(() => backend.snapshot().UserPreferences[0].appearance_mode)
    .toBe('dark');
  await expect(
    page.getByRole('status').filter({ hasText: 'Unsynchronized changes' }),
  ).toBeHidden();
  await expect(page.locator('html')).toHaveClass(/dark/);
});

test('refresh shows a real lesson diff which can be dismissed', async ({
  page,
  backend,
}) => {
  await openSchedule(page);
  const updated = backend.snapshot();
  const lesson = updated.Lessons.find(
    (row) => row.lesson_id === 'LES-ELECTRONICS-G5',
  )!;
  const oldRoom = lesson.room;
  lesson.room = 'E2E-NEW-ROOM';
  updated.Meta.find((row) => row.key === 'data_revision')!.value = '2';
  backend.replaceDatabase(updated);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByRole('button', { name: /View changes/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Changes since last sync' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(oldRoom);
  await expect(dialog).toContainText('E2E-NEW-ROOM');
  await expect(dialog).toContainText('Revision 1 → 2');
  await dialog.getByRole('button', { name: 'Dismiss notice' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: /View changes/ })).toBeHidden();
});
