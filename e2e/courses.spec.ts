import { test, expect, openSchedule, choose, view } from './fixtures';

test('shared Scrum classes show avatars and a list on hover or touch', async ({
  page,
  backend,
}, testInfo) => {
  const data = backend.snapshot();
  const scrum = data.Enrollments.find(
    (row) => row.offering_id === 'OFF-SCRUM-26',
  )!;
  data.Enrollments.push({
    ...scrum,
    enrollment_id: 'ENR-ZAHAR-SCRUM',
    user_id: 'U002',
  });
  backend.replaceDatabase(data);
  await openSchedule(
    page,
    '#/week/3?user=ermolz&semester=SEM-2026-FALL&subject=565095',
  );
  const avatars = page.getByRole('button', {
    name: '2 people attending; participant check complete',
  });
  await expect(avatars).toHaveCount(2);
  if (testInfo.project.name === 'mobile') await avatars.first().tap();
  else await avatars.first().hover();
  const popup = page.getByRole('dialog', { name: 'Attending this class' });
  await expect(popup).toBeVisible();
  await expect(popup.getByText('Ermolz', { exact: true })).toBeVisible();
  await expect(popup.getByText('Zahar', { exact: true })).toBeVisible();
  await popup.hover();
  await expect(popup).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('participants.png') });
  await page.keyboard.press('Escape');
  await expect(popup).toBeHidden();
  await avatars.first().focus();
  await page.keyboard.press('Enter');
  await expect(popup).toBeVisible();
  await page.keyboard.press('Escape');
  const reads = backend.calls.filter(
    (call) => call.action === 'schedule',
  ).length;
  await view(page, 'Courses');
  await expect(
    page
      .getByRole('region', { name: 'Lectures' })
      .getByRole('button', {
        name: '2 people attending; participant check complete',
      }),
  ).toHaveCount(7);
  await expect(
    page
      .getByRole('region', { name: 'Group classes' })
      .getByRole('button', {
        name: '2 people attending; participant check complete',
      }),
  ).toHaveCount(7);
  expect(
    backend.calls.filter((call) => call.action === 'schedule'),
  ).toHaveLength(reads);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
  expect(backend.calls.every((call) => call.method === 'GET')).toBe(true);
});

test('course links show the whole semester, preserve history and survive reload', async ({
  page,
}, testInfo) => {
  await openSchedule(page, '#/week/14?user=ermolz&semester=SEM-2026-FALL');
  await view(page, 'Courses');
  const catalog = page.url();
  const course = page.getByRole('link', {
    name: 'View Electronics and Digital Electronics',
  });
  await expect(course).toContainText('18 classes this semester');
  await course.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/courses\?.*subject=564966/);
  const detail = page.url();
  await expect(
    page.getByRole('heading', {
      name: 'Electronics and Digital Electronics',
      level: 1,
    }),
  ).toBeVisible();
  const lectures = page.getByRole('region', { name: 'Lectures' });
  const groups = page.getByRole('region', { name: 'Group classes' });
  await expect(lectures.getByRole('listitem')).toHaveCount(9);
  await expect(groups.getByRole('listitem')).toHaveCount(9);
  await expect(lectures.getByRole('listitem').first()).toContainText(
    '19 Sept 2026',
  );
  await expect(lectures.getByRole('listitem').last()).toContainText(
    '14 Nov 2026',
  );
  await expect(groups.getByRole('listitem').last()).toContainText(
    '18 Nov 2026',
  );
  await expect(page.getByRole('button', { name: 'Next week' })).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('course-detail.png'),
    fullPage: true,
  });
  await page.reload();
  await expect(lectures.getByRole('listitem')).toHaveCount(9);
  await page.getByRole('link', { name: 'Back to all courses' }).click();
  await expect(page).toHaveURL(catalog);
  await page.goBack();
  await expect(page).toHaveURL(detail);
  await expect(lectures.getByRole('listitem')).toHaveCount(9);
  await page.goForward();
  await expect(course).toBeVisible();
  await choose(page, 'Course filter', 'Qualification Project');
  await expect(
    page.getByText('No classes scheduled for this course this semester.'),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Back to all courses' }).click();
  await view(page, 'Week');
  await expect(
    page.getByRole('button', { name: 'Week 14', exact: true }),
  ).toHaveAttribute('aria-current', 'true');
});
