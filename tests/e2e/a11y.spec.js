import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { restoreSample } from './helpers.js';

async function axe(page, view) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  const summary = violations.map((v) => `${view}: ${v.id} (${v.impact}) ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ')}`);
  expect(summary).toEqual([]);
}

for (const scheme of ['light', 'dark']) {
  test(`every view passes axe in ${scheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('./');
    await restoreSample(page);
    await axe(page, 'settings');
    await page.locator('[data-close="settingsSheet"]').click();
    for (const r of ['1', '7', '30']) { await page.locator(`[data-range="${r}"]`).click(); await axe(page, `insights ${r}d`); }
    await page.locator('#openReport').click();
    await axe(page, 'report');
    await page.locator('[data-close="reportSheet"]').click();
    await page.locator('[data-close="insightsSheet"]').click();
    await axe(page, 'main');
    await page.locator('#list .row').first().click();
    await axe(page, 'entry sheet');
    await page.locator('#sheetSkip').click();
    await page.locator('#list .more').click();
    await axe(page, 'all entries');
  });
}

test('big buttons say what they do and when it last happened', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'Log a Drink' })).toHaveAccessibleDescription('Not yet');
  await expect(page.getByRole('button', { name: 'Log a Pass' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'When: Now' })).toBeVisible();
});

test('the entry sheet is modal and returns focus to the row that opened it', async ({ page }) => {
  await page.goto('./');
  await restoreSample(page);
  await page.locator('[data-close="settingsSheet"]').click();
  await page.locator('[data-close="insightsSheet"]').click();
  const row = page.locator('#list .row').first();
  const id = await row.getAttribute('data-id');
  await row.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.evaluate(() => document.getElementById('app').inert)).toBe(true);
  await page.locator('#sheet').getByRole('button', { name: 'Large' }).first().click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#sheet')).toBeHidden();
  expect(await page.evaluate(() => document.getElementById('app').inert)).toBe(false);
  expect(await page.evaluate(() => document.activeElement.getAttribute('data-id'))).toBe(id);
});

test('tapping outside the entry sheet closes it', async ({ page }) => {
  await page.goto('./');
  await page.locator('#drinkBtn').click();
  await page.locator('#barMore').click();
  await expect(page.locator('#sheet')).toBeVisible();
  await page.locator('#scrim').click({ position: { x: 20, y: 20 } });
  await expect(page.locator('#sheet')).toBeHidden();
});

test('chart dots can be reached and opened from the keyboard', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-01-16T09:00:00Z'));
  await page.goto('./');
  await restoreSample(page);
  await page.locator('[data-close="settingsSheet"]').click();
  await page.locator('[data-range="7"]').click();
  const dots = page.getByRole('group', { name: /Chart of drinks and passes/ }).getByRole('button');
  expect(await dots.count()).toBeGreaterThan(0);
  await dots.first().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#sheet')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dots.first()).toBeFocused();
});
