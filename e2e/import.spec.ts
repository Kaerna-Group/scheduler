import { test, expect, openSchedule, openImport, schedule } from './fixtures';
import { exportSchedule } from '../lib/schedule/import';

test('invalid JSON is rejected before preview or writes', async ({
  page,
  backend,
}) => {
  await openSchedule(page);
  await openImport(page, backend);
  const before = backend.snapshot();
  await page.getByLabel('Schedule JSON').fill('{not json');
  await page.getByRole('button', { name: 'Preview diff' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Apply reviewed import' }),
  ).toBeDisabled();
  expect(backend.calls.some((call) => call.action === 'previewImport')).toBe(
    false,
  );
  expect(backend.snapshot()).toEqual(before);
});

test('file upload → read-only preview → import → history → undo', async ({
  page,
  backend,
}) => {
  await openSchedule(page);
  await openImport(page, backend);
  const before = backend.snapshot();
  const payload = {
    schemaVersion: 1,
    semesterId: schedule(backend).semester.id,
    subjects: [
      {
        externalCode: 'E2E-NEW-COURSE',
        name: 'E2E Browser Testing',
        shortName: 'E2E Testing',
        color: '#4c9d8b',
        lessons: [
          {
            type: 'lecture',
            day: 'monday',
            startTime: '18:00',
            endTime: '19:20',
            weeks: [1, 3, 7],
            format: 'offline',
            room: 'E2E-101',
            teacher: 'Test Teacher',
          },
        ],
      },
    ],
  };
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open file', exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: 'local-test.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(payload)),
  });
  await page.getByRole('button', { name: 'Preview diff' }).click();
  await expect(
    page.getByRole('region', { name: 'Import change plan' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'New courses', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'New lessons', exact: true }),
  ).toBeVisible();
  expect(backend.snapshot()).toEqual(before);
  await page.getByRole('button', { name: 'Apply reviewed import' }).click();
  await expect(page.getByText(/Import completed. Revision/)).toBeVisible();
  expect(backend.snapshot().Lessons.some((row) => row.room === 'E2E-101')).toBe(
    true,
  );
  await page.goto('./#/changes');
  await expect(
    page.getByRole('heading', { name: 'Changes', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'E2E Testing', exact: true }).first(),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Undo last import' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Cancel' })
    .click();
  expect(backend.snapshot().Lessons.some((row) => row.room === 'E2E-101')).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Undo last import' }).click();
  await page.getByRole('button', { name: 'Undo import', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Undo last import' }),
  ).toBeDisabled();
  expect(backend.snapshot().Lessons).toEqual(before.Lessons);
  expect(backend.snapshot().Enrollments).toEqual(before.Enrollments);
  expect(
    backend.snapshot().AuditLog.some((row) => row.action === 'UNDO_IMPORT'),
  ).toBe(true);
});

test('shared conflicts require an independent decision for each course', async ({
  page,
  backend,
}) => {
  await openSchedule(page);
  await openImport(page, backend);
  const payload = exportSchedule(schedule(backend));
  payload.subjects = payload.subjects
    .filter((subject) => subject.lessons?.length)
    .slice(0, 2);
  payload.subjects[0].lessons![0].room = 'E2E-APPLY';
  payload.subjects[1].lessons![0].room = 'E2E-KEEP-OUT';
  await page.getByLabel('Schedule JSON').fill(JSON.stringify(payload));
  await page.getByRole('button', { name: 'Preview diff' }).click();
  await expect(
    page.getByText(/Resolve 2 shared course conflicts/),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Apply reviewed import' }),
  ).toBeDisabled();
  const course = (name: string) =>
    page.locator('article').filter({
      has: page.getByRole('heading', { name, exact: true, level: 5 }),
    });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
  await course(payload.subjects[0].name)
    .getByRole('button', { name: 'Apply imported' })
    .click();
  await expect(
    page.getByText(/Resolve 1 shared course conflict/),
  ).toBeVisible();
  await course(payload.subjects[1].name)
    .getByRole('button', { name: 'Keep stored' })
    .click();
  await page.getByRole('button', { name: 'Apply reviewed import' }).click();
  await expect(page.getByText(/Import completed. Revision/)).toBeVisible();
  expect(
    backend
      .snapshot()
      .Lessons.some((row) => row.room === 'E2E-APPLY' && row.active === 'yes'),
  ).toBe(true);
  expect(
    backend
      .snapshot()
      .Lessons.some(
        (row) => row.room === 'E2E-KEEP-OUT' && row.active === 'yes',
      ),
  ).toBe(false);
});

test('replace previews removed enrollments and stale revision prevents application', async ({
  page,
  backend,
}) => {
  await openSchedule(page);
  await openImport(page, backend);
  const payload = exportSchedule(schedule(backend));
  payload.subjects = payload.subjects.slice(0, 1);
  await page.getByLabel('Schedule JSON').fill(JSON.stringify(payload));
  await page.getByRole('button', { name: /^Replace my enrollments/ }).click();
  await page.getByRole('button', { name: 'Preview diff' }).click();
  await expect(
    page.getByRole('heading', { name: 'Enrollments removed by replace' }),
  ).toBeVisible();
  const changed = backend.snapshot();
  changed.Meta.find((row) => row.key === 'data_revision')!.value = '2';
  backend.replaceDatabase(changed);
  await page.getByRole('button', { name: 'Apply reviewed import' }).click();
  await expect(page.getByRole('alert')).toContainText(/changed|refresh|stale/i);
  expect(backend.snapshot()).toEqual(changed);
  await page
    .getByRole('button', { name: 'Refresh data before import' })
    .click();
  await expect(
    page.getByRole('button', { name: 'Refresh data before import' }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Preview diff' }).click();
  await expect(
    page.getByRole('button', { name: 'Apply reviewed import' }),
  ).toBeEnabled();
});
