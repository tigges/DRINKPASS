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

test('Progress shows how each measure moved, and All covers the whole diary', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-03-20T20:00:00Z'));
  await page.addInitScript(() => {
    const log = [], H = 3600e3, first = Date.parse('2026-03-01T00:00:00Z');
    for (let d = 0; d < 20; d++) {
      if (d >= 7 && d <= 9) continue;
      const day = first + d * 24 * H, gap = d < 10 ? 2 : 3;
      for (let h = 8; h < 20; h += gap) log.push({ id: `p${d}-${h}`, type: 'pass', t: day + h * H, size: { label: 'exact', ml: d < 10 ? 200 : 300 } });
      for (let i = 0; i < 6; i++) log.push({ id: `d${d}-${i}`, type: 'drink', t: day + (8.5 + 2 * i) * H, size: { label: 'medium', ml: 250 } });
    }
    if (!localStorage.getItem('drink-pass-log-v1')) localStorage.setItem('drink-pass-log-v1', JSON.stringify(log));
  });
  await page.goto('./');
  await page.locator('#openInsights').click();
  await page.locator('[data-range="7"]').click();
  await expect(page.locator('.prog')).toHaveCount(0);
  await page.locator('[data-range="14"]').click();
  await expect(page.locator('.insh').first()).toContainText('first vs last 5 logged days');

  await page.locator('[data-range="0"]').click();
  await expect(page.locator('#hero')).toBeHidden();
  await expect(page.locator('#tiles .pdays')).toHaveCount(0);
  const rows = page.locator('.prow');
  await expect(rows.locator('.plab')).toHaveText(['Typical gap', 'Average size', 'Night passes, per night', 'Drinks a day']);
  await expect(rows.locator('.pword')).toHaveText(['longer', 'larger', 'steady', 'steady']);
  await expect(rows.nth(0).locator('.pval')).toHaveText('2 h → 3 h');
  await expect(rows.nth(1).locator('.pval')).toHaveText('200 ml → 300 ml');
  await expect(page.locator('.insh').first()).toContainText('first vs last 7 logged days');
  await expect(page.locator('#tiles .insh span').nth(2)).toHaveText('82 in 20 days · 4.8 a day');

  await rows.nth(1).click();
  await expect(page.locator('.prow').nth(1)).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.prow').nth(1)).toBeFocused();
  await expect(page.locator('#pdet-size svg')).toHaveAccessibleName('Average size each day, with a 7-day median line');
  await expect(page.locator('#pdet-size .pun')).toHaveCount(3);
  await page.locator('.prow').nth(1).click();
  await expect(page.locator('#pdet-size')).toBeHidden();

  await page.reload();
  await page.locator('#openInsights').click();
  await expect(page.locator('[data-range="0"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#openReport').click();
  await expect(page.locator('[data-days="7"]')).toHaveAttribute('aria-pressed', 'true');
});

test('Progress says how many more days it needs', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-01-15T21:00:00Z'));
  await page.goto('./');
  await restoreSample(page);
  await page.locator('[data-close="settingsSheet"]').click();
  await page.locator('[data-range="14"]').click();
  await expect(page.locator('.prog')).toHaveText('Log on 9 more days to see how things change.');
});

test('today’s totals sit above the list and open Insights at 24 h', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-01-15T21:00:00Z'));
  await page.goto('./');
  await restoreSample(page);
  await page.locator('[data-close="settingsSheet"]').click();
  await page.locator('[data-range="7"]').click();
  await page.locator('[data-close="insightsSheet"]').click();
  const strip = page.locator('#todayStrip');
  await expect(strip.locator('b')).toHaveText(['650\u00a0ml', '500\u00a0ml', '3', '6 h']);
  await expect(strip).toHaveAccessibleName(/^Open Insights for the last 24 hours\. In today 650\s+ml/);
  await strip.click();
  await expect(page.locator('#insightsSheet')).toBeVisible();
  await expect(page.locator('[data-range="1"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('drink-pass-settings-v1') || '{}').range)).toBe(1);

  await page.locator('#openSettings').click();
  await page.locator('[data-toggle="showToday"]').click();
  await expect(page.locator('[data-toggle="showToday"]')).toHaveAttribute('aria-pressed', 'false');
  await page.reload();
  await expect(strip).toBeHidden();
});

test('today’s totals show dashes before anything is logged', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#todayStrip b')).toHaveText(['–', '–', '0', '–']);
});

for (const [w, h, stripShown] of [[412, 839, true], [320, 568, false]]) {
  test(`at ${w}×${h} the log buttons sit at the bottom with the after-log bar just above`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.goto('./');
    await expect(page.locator('#todayStrip')).toBeVisible({ visible: stripShown });
    const btn = await page.locator('#drinkBtn').boundingBox();
    expect(btn.y + btn.height).toBeGreaterThan(h - 40);
    expect(btn.y + btn.height).toBeLessThanOrEqual(h);
    expect(btn.height).toBeGreaterThanOrEqual(88);
    await page.locator('#passBtn').click();
    const bar = await page.locator('#bar').boundingBox(), btn2 = await page.locator('#passBtn').boundingBox();
    expect(bar.y + bar.height).toBeLessThanOrEqual(btn2.y);
    expect(btn2.y + btn2.height).toBeLessThanOrEqual(h);
    await expect(page.locator('#list .row').first()).toBeInViewport();
  });
}
