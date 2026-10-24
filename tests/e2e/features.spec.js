import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { stored, openSettings, restoreSample } from './helpers.js';

async function download(page, button) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator(button).click()]);
  return { name: dl.suggestedFilename(), text: readFileSync(await dl.path(), 'utf8') };
}

test('a password-protected backup downloads encrypted and restores with the password', async ({ page, browser }) => {
  await page.goto('./');
  await restoreSample(page);
  await page.locator('#backupPass').fill('tea at four');
  const file = await download(page, '#dlBackup');
  expect(file.name).toMatch(/^drink-pass-backup-\d{4}-\d\d-\d\d-encrypted\.json$/);
  expect(file.text).not.toContain('sample-1');
  expect(JSON.parse(file.text)).toMatchObject({ encrypted: 1, cipher: 'AES-256-GCM' });

  const fresh = await (await browser.newContext()).newPage();
  await fresh.goto('./');
  await openSettings(fresh);
  await fresh.locator('#restoreBox').fill(file.text);
  await fresh.locator('#restoreBtn').click();
  await expect(fresh.locator('#unlockBox')).toBeVisible();
  await fresh.locator('#unlockPass').fill('wrong');
  await fresh.locator('#unlockGo').click();
  await expect(fresh.locator('#unlockMsg')).toHaveText('That password doesn’t match this backup.');
  await fresh.locator('#unlockPass').fill('tea at four');
  await fresh.locator('#unlockPass').press('Enter');
  await expect(fresh.locator('#restorePrevText')).toContainText('6 new');
  await fresh.locator('#restoreGo').click();
  await expect.poll(async () => (await stored(fresh)).length).toBe(6);
});

test('export everything as CSV and as a FHIR bundle', async ({ page }) => {
  await page.goto('./');
  await restoreSample(page);
  const csv = await download(page, '#exportCsv');
  expect(csv.name).toMatch(/^drink-pass-all-.*\.csv$/);
  expect(csv.text.split('\n')).toHaveLength(7);
  const fhir = await download(page, '#exportFhir');
  const bundle = JSON.parse(fhir.text);
  expect(bundle).toMatchObject({ resourceType: 'Bundle', type: 'collection' });
  expect(bundle.entry).toHaveLength(6);
  expect(bundle.entry.filter((e) => e.resource.code.coding[0].code === '9187-6')).toHaveLength(3);
});

test('the drink reminder appears after the chosen gap and can be snoozed', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-24T09:00:00+01:00') });
  await page.goto('./');
  await page.locator('#drinkBtn').click();
  await openSettings(page);
  await page.locator('[data-remind="2"]').click();
  await page.locator('[data-close="settingsSheet"]').click();
  await page.locator('[data-close="insightsSheet"]').click();
  await expect(page.locator('#remindBar')).toBeHidden();
  await page.clock.fastForward('02:01:00');
  await expect(page.locator('#remindBar')).toBeVisible();
  await expect(page.locator('#remindText')).toContainText('since your last drink');
  await page.locator('#remindLater').click();
  await expect(page.locator('#remindBar')).toBeHidden();
  await page.clock.fastForward('01:01:00');
  await expect(page.locator('#remindBar')).toBeVisible();
  await page.locator('#remindLog').click();
  await expect(page.locator('#remindBar')).toBeHidden();
  expect((await stored(page)).filter((x) => x.type === 'drink')).toHaveLength(2);
});

test('the clinician summary includes a frequency-volume table', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-01-15T21:00:00Z'));
  await page.goto('./');
  await restoreSample(page);
  await page.locator('[data-close="settingsSheet"]').click();
  await page.locator('#openReport').click();
  await page.locator('[data-days="1"]').click();
  const row = page.locator('#reportFv tbody tr').first();
  await expect(page.locator('#reportFv caption')).toHaveText('Frequency and volume');
  await expect(row.locator('td')).toHaveText(['650\u00a0ml', '3 (0)', '500\u00a0ml', '–', '400\u00a0ml', '250\u00a0ml']);
});

test('insights group drinks and output, passes and bowel', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-01-15T21:00:00Z'));
  await page.goto('./');
  await restoreSample(page);
  await page.locator('[data-close="settingsSheet"]').click();
  const tiles = page.locator('#tiles');
  await expect(tiles.locator('.insh h3')).toHaveText(['Drinks and output', 'Passes', 'Bowel']);
  await expect(tiles.locator('.insh span')).toHaveText(['last 24 h', '3 in 24 h', /^Last /]);

  await expect(tiles.locator('.io .v')).toHaveText(['650\u00a0ml', '500\u00a0ml']);
  await expect(tiles.locator('.io').first().locator('.fill i')).toHaveCount(2);
  await expect(tiles.locator('.kinds')).toHaveText(/Water\s*250\s*ml\s*Tea or coffee\s*400\s*ml/);
  await expect(tiles.locator('.insnote')).toHaveText('Tea, coffee and alcohol were 62% of what you drank. Caffeine and alcohol can irritate the bladder.');

  const [size, urgency] = [tiles.locator('.blist').nth(0), tiles.locator('.blist').nth(1)];
  await expect(size.locator('.blh b')).toHaveText('Largest 400\u00a0ml · average 250\u00a0ml');
  await expect(size.locator('.brow > b')).toHaveText(['1', '0', '1', '1']);
  await expect(urgency.locator('.blh b')).toHaveText('1 of 2 strong or couldn’t wait');
  await expect(urgency.locator('.brow .bl')).toHaveText(['None', 'Mild', 'Strong', 'Couldn’t wait', 'Not recorded']);
  await expect(urgency.locator('.brow > b')).toHaveText(['0', '1', '1', '0', '1']);
  await expect(tiles.locator('.bcol[aria-label="Type 4: 1"] .bstack b')).toHaveCount(1);
  await expect(tiles.locator('.pdays')).toHaveCount(0);

  await page.locator('[data-range="3"]').click();
  await expect(tiles.locator('.insh span').nth(1)).toHaveText('3 in 3 days · 3 a day');
  await expect(tiles.locator('.pday')).toHaveCount(3);
  await expect(tiles.locator('.pday').last()).toHaveAccessibleName('Thursday 15 January: 3 passes, 0 at night');
  await expect(tiles.locator('.bdays')).toHaveAccessibleName('on 1 of 3 days');
});

test('times use a 24-hour clock by default and can switch to 12-hour', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-01-15T21:00:00Z'));
  await page.goto('./');
  await restoreSample(page);
  await expect(page.locator('[data-clock="24"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-close="settingsSheet"]').click();
  await page.locator('[data-close="insightsSheet"]').click();
  const first = page.locator('#list .row .time').first();
  await expect(first).toHaveText('15:00');

  await openSettings(page);
  await page.locator('[data-clock="12"]').click();
  await page.locator('[data-close="settingsSheet"]').click();
  await page.locator('[data-close="insightsSheet"]').click();
  await expect(first).toHaveText('3:00 pm');

  await page.reload();
  await expect(first).toHaveText('3:00 pm');
  await page.locator('#openInsights').click();
  await page.locator('#openReport').click();
  await page.locator('[data-days="1"]').click();
  await expect(page.locator('#reportTable')).toContainText('8:00 am');
});
