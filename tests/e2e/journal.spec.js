import { test, expect } from '@playwright/test';
import { stored, openSettings, restoreSample, SAMPLE_BACKUP } from './helpers.js';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => { throw e; });
  await page.goto('./');
});

test('logging a drink saves it and shows it in Latest', async ({ page }) => {
  await page.locator('#drinkBtn').click();
  await expect(page.locator('#bar')).toBeVisible();
  await expect(page.locator('#barMsg')).toContainText('Drink logged');
  await page.locator('#barRows button', { hasText: 'Medium' }).click();
  const log = await stored(page);
  expect(log).toHaveLength(1);
  expect(log[0]).toMatchObject({ type: 'drink', size: { label: 'medium', ml: 250 } });
  await expect(page.locator('#todayCount')).toHaveText('1 today');
});

test('a quick double tap only logs once', async ({ page }) => {
  await page.locator('#passBtn').click();
  await page.locator('#passBtn').click();
  expect(await stored(page)).toHaveLength(1);
});

test('undo removes the entry just logged', async ({ page }) => {
  await page.locator('#passBtn').click();
  await page.locator('#barUndo').click();
  expect(await stored(page)).toHaveLength(0);
});

test('restore from a backup file previews and adds entries', async ({ page }) => {
  await openSettings(page);
  await page.locator('#restoreFile').setInputFiles(SAMPLE_BACKUP);
  await expect(page.locator('#restorePrevText')).toContainText('6 new, 0 already here');
  await page.locator('#restoreGo').click();
  await expect.poll(async () => (await stored(page)).length).toBe(6);
  await page.locator('#restoreFile').setInputFiles(SAMPLE_BACKUP);
  await expect(page.locator('#restorePrevText')).toContainText('0 new, 6 already here');
});

test('removing an entry puts it in Recently removed and it can be restored', async ({ page }) => {
  await restoreSample(page);
  await page.locator('[data-close="settingsSheet"]').click();
  await page.locator('[data-close="insightsSheet"]').click();
  await page.locator('#list .row').first().click();
  await page.locator('#sheetRemove').click();
  await expect(page.locator('#barMsg')).toContainText('Removed');
  expect(await stored(page)).toHaveLength(5);
  await page.locator('#barUndo').click();
  expect(await stored(page)).toHaveLength(6);
});

test('the clinician summary lists the restored days', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-01-15T21:00:00Z'));
  await page.reload();
  await restoreSample(page);
  await page.locator('[data-close="settingsSheet"]').click();
  await page.locator('#openReport').click();
  await page.locator('[data-days="1"]').click();
  await expect(page.locator('#reportTable')).toContainText(/Thursday,? 15 Jan 2026/);
  await expect(page.locator('#reportTable tr.tot')).toContainText('3 passes');
});
