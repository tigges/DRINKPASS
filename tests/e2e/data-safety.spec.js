import { test, expect } from '@playwright/test';
import { stored, restoreSample, openSection } from './helpers.js';

test('an unreadable saved journal is kept, not overwritten', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.setItem('drink-pass-log-v1', '[{"id":"a","type":"pass"'));
  await page.reload();
  await expect(page.locator('#loadWarn')).toBeVisible();
  await page.locator('#drinkBtn').click();
  const kept = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('drink-pass-log-v1-unreadable-')).map((k) => localStorage.getItem(k)));
  expect(kept).toEqual(['[{"id":"a","type":"pass"']);
  expect(await stored(page)).toHaveLength(1);
});

test('entries logged in another tab are not lost', async ({ context }) => {
  const a = await context.newPage(), b = await context.newPage();
  await a.goto('./'); await b.goto('./');
  await a.locator('#drinkBtn').click();
  await expect(b.locator('#todayCount')).toHaveText('1 today');
  await b.locator('#passBtn').click();
  await expect(a.locator('#todayCount')).toHaveText('2 today');
  expect((await stored(a)).map((x) => x.type).sort()).toEqual(['drink', 'pass']);
});

test('restore skips malformed entries and bad settings', async ({ page }) => {
  await page.goto('./');
  await page.locator('#openInsights').click();
  await page.locator('#openSettings').click();
  await openSection(page, 'secBackup');
  const now = Date.now();
  const backup = { log: [
    { id: 'ok', type: 'pass', t: now - 60000, size: { label: 'small', ml: 'NaN' } },
    { id: 'bad', type: 'pass', t: 'soon' }
  ], settings: { unit: 'litres', nightStart: 'late' } };
  await page.locator('#restoreBox').fill(JSON.stringify(backup));
  await page.locator('#restoreBtn').click();
  await expect(page.locator('#restorePrevText')).toContainText('1 new, 0 already here, 1 skipped');
  await page.locator('#restoreGo').click();
  await expect.poll(async () => (await stored(page)).length).toBe(1);
  expect((await stored(page))[0].size).toBeUndefined();
  const settings = await page.evaluate(() => JSON.parse(localStorage.getItem('drink-pass-settings-v1')));
  expect(settings.unit).toBe('ml');
  expect(settings.nightStart).toBe('22:00');
});

test('removing a pass logged with a solid removes and restores both', async ({ page }) => {
  await page.goto('./');
  await page.locator('#openInsights').click();
  await page.locator('#openSettings').click();
  await openSection(page, 'secLogging');
  await page.locator('[data-toggle="trackSolid"]').click();
  await page.locator('[data-close="settingsSheet"]').click();
  await page.locator('[data-close="insightsSheet"]').click();
  await page.locator('#passBtn').click();
  await page.locator('#barRows button', { hasText: 'Both' }).click();
  expect(await stored(page)).toHaveLength(2);
  await page.locator('#bar').getByRole('button', { name: 'More' }).click();
  await page.locator('#sheetRemove').click();
  expect(await stored(page)).toHaveLength(0);
  await expect(page.locator('#barMsg')).toContainText('Pass and solid');
  await page.locator('#barUndo').click();
  expect(await stored(page)).toHaveLength(2);
});

test('the 24 hour chart shows only its own time labels', async ({ page }) => {
  await page.goto('./');
  await restoreSample(page);
  await page.locator('[data-close="settingsSheet"]').click();
  await page.locator('[data-range="1"]').click();
  await expect(page.locator('#axis')).toBeHidden();
  await expect(page.locator('#tlLab')).toBeVisible();
});
