import { readFile } from 'node:fs/promises';
import {
  test,
  expect,
  openSchedule,
  action,
  choose,
  schedule,
} from './fixtures';

test('ICS download exports the personal semester and exact weeks, not the visible filter', async ({
  page,
  backend,
}) => {
  await openSchedule(page);
  await choose(page, 'Course filter', 'Electronics');
  await action(page, 'Export semester (.ics)');
  const dialog = page.getByRole('dialog', {
    name: 'Export semester to calendar',
  });
  await expect(dialog).toContainText('Ermolz');
  const pending = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download .ics' }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/\.ics$/);
  const content = await readFile((await download.path())!, 'utf8');
  expect(content).toContain('BEGIN:VCALENDAR');
  expect(content).not.toContain('RRULE');
  const expected = schedule(backend).lessons.reduce(
    (sum, lesson) => sum + lesson.weeks.length,
    0,
  );
  expect(content.match(/BEGIN:VEVENT/g)).toHaveLength(expected);
  expect(content).toContain('Scrum');
  expect(content).not.toContain(backend.token);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('next-class banner follows real Kyiv time rather than the selected week', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-09-23T08:03:00Z'));
  await openSchedule(page);
  const banner = page.getByRole('region', { name: 'Найближча пара' });
  await expect(banner).toContainText('Electronics');
  await expect(banner).toContainText('11:40');
  await expect(banner).toContainText('37');
  await page.getByRole('button', { name: 'Week 14', exact: true }).click();
  await expect(banner).toContainText('Electronics');
  await page.clock.setFixedTime(new Date('2026-09-23T20:00:00Z'));
  await page.reload();
  await expect(banner).toContainText('На сьогодні все');
});
