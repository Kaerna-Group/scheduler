import {
  test,
  expect,
  openSchedule,
  enterPin,
  action,
  choose,
  view,
  schedule,
} from './fixtures';

test('PIN rejects incomplete/wrong input, accepts the real PIN and survives reload', async ({
  page,
}) => {
  await page.goto('./');
  const submit = page.getByRole('button', {
    name: 'Open schedule',
    exact: true,
  });
  await expect(submit).toBeDisabled();
  await page.getByLabel('Four-digit PIN').fill('12');
  await expect(submit).toBeDisabled();
  await page.getByLabel('Four-digit PIN').fill('0000');
  await submit.click();
  await expect(page.getByText('Incorrect PIN. Try again.')).toBeVisible();
  await enterPin(page);
  await expect(
    page.getByRole('combobox', { name: 'Schedule user' }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('combobox', { name: 'Schedule user' }),
  ).toBeVisible();
  await expect(page.getByLabel('Four-digit PIN')).toBeHidden();
});

test('complete path: PIN → user → week → course → settings → import', async ({
  page,
}) => {
  await openSchedule(page);
  await choose(page, 'Schedule user', 'Zahar');
  await expect(
    page.getByRole('combobox', { name: 'Schedule user' }),
  ).toContainText('Zahar');
  await expect(page).toHaveURL(/user=zahar/);
  await page.getByRole('button', { name: 'Week 6', exact: true }).click();
  await expect(page).toHaveURL(/week\/6/);
  await choose(page, 'Course filter', 'Electronics');
  await view(page, 'Courses');
  await expect(
    page.getByRole('heading', { name: '1 course', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', {
      name: 'Electronics and Digital Electronics',
      exact: true,
    }),
  ).toBeVisible();
  await action(page, 'Settings');
  await expect(
    page.getByRole('heading', { name: 'Settings', exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Import guide' }).click();
  await expect(
    page.getByRole('heading', { name: 'Schedule import', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('combobox', { name: 'Import user' }),
  ).toContainText('Zahar');
});

test('week controls enforce semester boundaries and support browser back/forward', async ({
  page,
}) => {
  await openSchedule(page, '#/week/1?user=ermolz');
  await expect(
    page.getByRole('button', { name: 'Previous week' }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Next week' }).click();
  await expect(
    page.getByRole('button', { name: 'Week 2', exact: true }),
  ).toHaveAttribute('aria-current', 'true');
  await page.getByRole('button', { name: 'Week 14', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Next week' })).toBeDisabled();
  await page.goBack();
  await expect(
    page.getByRole('button', { name: 'Week 2', exact: true }),
  ).toHaveAttribute('aria-current', 'true');
  await page.goForward();
  await expect(
    page.getByRole('button', { name: 'Week 14', exact: true }),
  ).toHaveAttribute('aria-current', 'true');
});

test('deep link restores user, week and course after reload; filter can be cleared', async ({
  page,
}) => {
  await openSchedule(page, '#/week/6?user=zahar&subject=SUB-ELECTRONICS');
  await expect(
    page.getByRole('combobox', { name: 'Schedule user' }),
  ).toContainText('Zahar');
  await expect(
    page.getByRole('combobox', { name: 'Course filter' }),
  ).toContainText('Electronics');
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Week 6', exact: true }),
  ).toHaveAttribute('aria-current', 'true');
  await expect(
    page.getByRole('combobox', { name: 'Course filter' }),
  ).toContainText('Electronics');
  await choose(page, 'Course filter', 'All courses');
  await expect(page).not.toHaveURL(/subject=/);
});

test('missing linked course offers recovery instead of silently showing another course', async ({
  page,
}) => {
  await openSchedule(page, '#/week/5?user=ermolz&subject=DOES-NOT-EXIST');
  await expect(
    page.getByText(
      'The linked course is not in this user’s schedule for this semester.',
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Show all courses' }).click();
  await expect(
    page.getByRole('combobox', { name: 'Course filter' }),
  ).toContainText('All courses');
  await expect(page).not.toHaveURL(/DOES-NOT-EXIST/);
});

test('all three views are reachable and menu closes with Escape and returns focus', async ({
  page,
  backend,
}) => {
  await openSchedule(page);
  await view(page, 'Courses');
  await expect(
    page.getByRole('heading', {
      name: `${schedule(backend).subjects.length} courses`,
      exact: true,
    }),
  ).toBeVisible();
  await view(page, 'Today');
  await expect(
    page
      .getByRole('button', { name: 'Today', exact: true })
      .filter({ visible: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await view(page, 'Week');
  const menu = page.getByRole('button', { name: 'More actions' });
  await menu.click();
  await expect(page.getByRole('menu', { name: 'More actions' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: 'More actions' })).toBeHidden();
  await expect(menu).toBeFocused();
});

test('archived semester can be opened and refuses imports', async ({
  page,
}) => {
  await openSchedule(page);
  await page.getByRole('combobox', { name: 'Semester', exact: true }).click();
  await page.getByRole('option', { name: /Spring 2026 \(archive\)/ }).click();
  await expect(page).toHaveURL(/SEM-2026-SPRING/);
  await action(page, 'Import schedule');
  await expect(
    page.getByRole('button', { name: 'Preview diff' }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Apply reviewed import' }),
  ).toBeDisabled();
});

test('layout stays within the viewport on schedule, settings and import', async ({
  page,
}) => {
  await openSchedule(page);
  async function fits() {
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth + 1,
      ),
    ).toBe(true);
  }
  await fits();
  await action(page, 'Settings');
  await expect(
    page.getByRole('heading', { name: 'Settings', exact: true }),
  ).toBeVisible();
  await fits();
  await page.getByRole('link', { name: 'Import guide' }).click();
  await expect(page.getByLabel('Schedule JSON')).toBeVisible();
  await fits();
});
