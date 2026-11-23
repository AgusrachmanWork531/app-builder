import { expect, type Page, test } from '@playwright/test';

const EMAIL = 'dev@example.com';
const PASSWORD = process.env.DEV_SEED_PASSWORD ?? '';

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL('/');
}

test.beforeAll(() => {
  if (!PASSWORD) throw new Error('DEV_SEED_PASSWORD must be set (see .env) and the DB seeded');
});

test('user creates a project, runs a mock build and inspects the result', async ({ page }) => {
  // 1–2. Open the application and authenticate.
  await login(page);
  await expect(page.getByTestId('project-count')).toBeVisible();

  // 3–4. Create a project and submit a prompt.
  const name = `E2E ${Date.now()}`;
  await page.getByRole('link', { name: 'New project' }).first().click();
  await page.getByLabel('Project name').fill(name);
  await page.getByLabel('What should the app do?').fill('A todo app to track household chores');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(page.getByText('template: task-manager')).toBeVisible();

  // 5. Start a mock build.
  await page.getByRole('button', { name: 'Start mock build' }).click();
  await expect(page).toHaveURL(/\/builds\/[0-9a-f-]{36}$/);

  // 6. Observe live progress (SSE) through intermediate states.
  await expect(page.getByTestId('live-state')).toContainText(/live|closed/);
  await expect(page.getByTestId('build-status').first()).toHaveText(
    /PLANNING|GENERATING|TESTING|COMPLETED/,
  );

  // 7. Receive the completed status.
  await expect(page.getByTestId('build-status').first()).toHaveText('COMPLETED', {
    timeout: 30_000,
  });

  // 8. Inspect execution history, plan and artifacts.
  const events = page.getByRole('list', { name: 'Build events' });
  await expect(events).toContainText('PLAN_CREATED');
  await expect(events).toContainText('→ COMPLETED');
  await expect(page.getByRole('list', { name: 'Artifacts' })).toContainText('app-spec.json');
  await expect(page.getByRole('list', { name: 'Artifacts' })).toContainText('MOCK');

  // The project dashboard reflects the finished build.
  await page.getByRole('link', { name: 'AI App Builder Engine' }).click();
  await expect(page.getByRole('cell', { name })).toBeVisible();
});

test('repair loop: a build that fails validation once is repaired and completes', async ({
  page,
}) => {
  await login(page);
  await page.getByRole('link', { name: 'New project' }).first().click();
  await page.getByLabel('Project name').fill(`E2E repair ${Date.now()}`);
  await page.getByLabel('What should the app do?').fill('A blog with posts and comments');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByLabel('Mock scenario').selectOption('validation-once');
  await page.getByRole('button', { name: 'Start mock build' }).click();
  await expect(page.getByTestId('build-status').first()).toHaveText('COMPLETED', {
    timeout: 30_000,
  });
  await expect(page.getByRole('list', { name: 'Build events' })).toContainText('→ REPAIRING');
});

test.describe('negative cases', () => {
  test('unauthenticated users are sent to the login page', async ({ page }) => {
    await page.goto('/projects/new');
    await page.getByLabel('Project name').fill('nope');
    await page.getByLabel('What should the app do?').fill('A todo app that should not exist');
    await page.getByRole('button', { name: 'Create project' }).click();
    await expect(page).toHaveURL('/login');
    await page.goto('/');
    await expect(page).toHaveURL('/login');
  });

  test('wrong credentials show an error', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password').fill('definitely-wrong-password');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Invalid email or password' }),
    ).toBeVisible();
    await expect(page).toHaveURL('/login');
  });

  test('an invalid prompt is rejected by the API', async ({ page }) => {
    await login(page);
    await page.goto('/projects/new');
    await page.getByLabel('Project name').fill(`E2E invalid ${Date.now()}`);
    // Bypass the browser's minLength so the server-side validation is exercised.
    await page
      .getByLabel('What should the app do?')
      .evaluate((el) => el.removeAttribute('minlength'));
    await page.getByLabel('What should the app do?').fill('too short');
    await page.getByRole('button', { name: 'Create project' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Request validation failed' }),
    ).toBeVisible();
  });
});
