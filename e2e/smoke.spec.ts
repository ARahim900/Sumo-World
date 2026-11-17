import { expect, test, type Locator, type Page } from '@playwright/test';

/** A black or blank 1280×720 canvas compresses to a few kilobytes; the lit city is far larger. */
const MIN_RENDERED_PNG_BYTES = 30_000;

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', error => errors.push(error.message));
  return errors;
}

async function numberAttribute(locator: Locator, name: string): Promise<number> {
  return Number(await locator.getAttribute(name));
}

test('serves the page with security headers', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  const headers = response?.headers() ?? {};
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['content-security-policy']).toContain("'wasm-unsafe-eval'");
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-powered-by']).toBeUndefined();
});

test('loads the city, enters, responds to keys and keeps settings', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?debug');

  const enter = page.getByRole('button', { name: 'Enter Sumo World' });
  await expect(enter).toBeEnabled({ timeout: 120_000 });

  const game = page.locator('main.game');
  const titleZ = await numberAttribute(game, 'data-z');
  await page.keyboard.press('Escape');
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1_000);
  await page.keyboard.up('KeyW');
  expect(await numberAttribute(game, 'data-z')).toBe(titleZ);
  await expect(enter).toBeVisible();

  await enter.click();

  await expect(game).toHaveAttribute('data-ready', 'true');
  await expect(page.getByText('Your night starts here.')).toBeVisible();

  const canvas = page.locator('.viewport canvas');
  await expect(canvas).toBeVisible();
  await expect.poll(() => numberAttribute(game, 'data-fps')).toBeGreaterThan(0);

  const startZ = await numberAttribute(game, 'data-z');
  await page.keyboard.down('KeyW');
  await expect.poll(() => numberAttribute(game, 'data-z')).not.toBeCloseTo(startZ, 1);
  await page.keyboard.up('KeyW');

  const debug = page.getByLabel('Debug information');
  await expect(debug).toContainText('Draw calls');
  const drawCalls = debug.locator('dd').nth(1);
  await expect(drawCalls).not.toHaveText('—');

  const frame = await canvas.screenshot();
  expect(frame.byteLength).toBeGreaterThan(MIN_RENDERED_PNG_BYTES);

  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Resume drive' })).toBeVisible();
  await page.getByRole('radio', { name: 'Fog' }).check();
  await page.getByRole('radio', { name: 'Low' }).check();
  await expect(page.locator('.weather')).toContainText('FOG');

  const stored = await page.evaluate(() => window.localStorage.getItem('sumo-world:settings:v1'));
  expect(stored).not.toBeNull();
  expect(JSON.parse(stored ?? '{}')).toMatchObject({ weather: 'fog', quality: 'low' });

  await page.reload();
  await expect(page.getByRole('button', { name: 'Enter Sumo World' })).toBeEnabled({ timeout: 120_000 });
  await expect(page.getByRole('radio', { name: 'Fog' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Low' })).toBeChecked();

  expect(errors).toEqual([]);
});
