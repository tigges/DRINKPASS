import { test, expect } from '@playwright/test';
import { stored, restoreSample } from './helpers.js';

const DAY = 864e5, H = 36e5;

test.beforeEach(async ({ page }) => { page.on('pageerror', (e) => { throw e; }); });

test('a pass in the morning while still asleep offers to end the night', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-15T22:30:00Z') });
  await page.goto('./');
  await page.locator('#sleepBtn').click();
  await page.locator('#bedGo').click();
  await expect(page.locator('#sleepLabel')).toHaveText('Up');
  await page.clock.fastForward('04:00:00');
  await page.locator('#passBtn').click();
  await expect(page.locator('#barRows')).not.toContainText('Up for the day?');
  await page.clock.fastForward('04:30:00');
  await page.locator('#passBtn').click();
  const offer = page.locator('#barRows .wake');
  await expect(offer).toContainText('Up for the day?');
  await offer.getByRole('button', { name: 'I’m up' }).click();
  await expect(offer).toHaveCount(0);
  await expect(page.locator('#sleepCard')).toBeHidden();
  await expect(page.locator('#sleepLabel')).toHaveText('Bed');
  const log = await stored(page);
  expect(log.map((x) => x.type)).toEqual(['bed', 'pass', 'pass', 'wake']);
  expect(log[3].t).toBe(log[2].t);
  await expect(page.locator('#list .row').nth(2)).toContainText('Pass (night)');
  await expect(page.locator('#list .row').nth(1)).not.toContainText('(night)');
});

test('a tip about holding shows on the first three logs, and never after a hold', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-15T09:00:00Z') });
  await page.goto('./');
  for (let i = 0; i < 4; i++) {
    await page.locator(i % 2 ? '#passBtn' : '#drinkBtn').click();
    await expect(page.locator('#barRows .bartip')).toHaveCount(i < 3 ? 1 : 0);
    await page.clock.fastForward('00:00:02');
  }
  await page.evaluate(() => localStorage.removeItem('dp-holdtips'));
  const box = await page.locator('#drinkBtn').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.clock.fastForward(700);
  await page.mouse.up();
  await expect(page.locator('#barMsg')).toContainText('Drink logged');
  await page.clock.fastForward('00:00:02');
  await page.locator('#passBtn').click();
  await expect(page.locator('#barRows button').first()).toBeVisible();
  await expect(page.locator('#barRows .bartip')).toHaveCount(0);
});

test('Insights for 24 h also shows today since midnight, matching the totals on the main screen', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-01-16T07:00:00Z'));
  await page.goto('./');
  await restoreSample(page);
  await page.locator('[data-close="settingsSheet"]').click();
  await page.locator('[data-close="insightsSheet"]').click();
  await expect(page.locator('#tdIn')).toHaveText('–');
  await page.locator('#todayStrip').click();
  await expect(page.locator('#tiles .tile.wide').first()).toContainText('Today since midnight: in – · out –');
  await page.locator('[data-range="3"]').click();
  await expect(page.locator('#tiles')).not.toContainText('since midnight');
});

test('Progress leaves out today until it’s over', async ({ page }) => {
  const now = Date.parse('2026-01-15T21:00:00Z'), log = [];
  for (let d = 13; d >= 0; d--) for (const h of [8, 12, 16, 20]) log.push({ id: `p${d}-${h}`, type: 'pass', t: now - d * DAY - (21 - h) * H, size: { label: 'exact', ml: d ? 200 + d * 5 : 900 } });
  await page.addInitScript((l) => {
    if (!localStorage.getItem('drink-pass-log-v1')) localStorage.setItem('drink-pass-log-v1', JSON.stringify(l));
    localStorage.setItem('drink-pass-settings-v1', JSON.stringify({ range: 14 }));
  }, log);
  await page.clock.setFixedTime(new Date(now));
  await page.goto('./');
  await page.locator('#openInsights').click();
  await expect(page.locator('.prow', { hasText: 'Average size' }).locator('.pval')).toHaveText('253 ml → 218 ml');
  await expect(page.locator('.insh').first()).toContainText('first vs last 6 logged days');
  await expect(page.locator('.prog > .sub')).toContainText('Today is added once it’s over.');
});

test('the main screen lists more entries when there is room and links to all entries by day', async ({ page }) => {
  const now = Date.parse('2026-01-15T21:00:00Z'), log = [];
  for (let i = 1; i <= 10; i++) log.push({ id: `d${i}`, type: 'drink', t: now - i * H, size: { label: 'medium', ml: 250 } });
  await page.addInitScript((l) => { if (!localStorage.getItem('drink-pass-log-v1')) localStorage.setItem('drink-pass-log-v1', JSON.stringify(l)); }, log);
  await page.clock.setFixedTime(new Date(now));
  await page.goto('./');
  expect(await page.locator('#list .row').count()).toBeGreaterThan(5);
  await page.locator('#list .more').click();
  await expect(page.locator('#logSheet')).toBeVisible();
  await expect(page.locator('#dayLabel')).toHaveText('Today');
});

test('the backup card at the top of Settings downloads a backup', async ({ page }) => {
  await page.goto('./');
  await page.locator('#drinkBtn').click();
  await page.locator('#openSettingsMain').click();
  await expect(page.locator('#lastBackup')).toHaveText('Not backed up yet.');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#dlBackupTop').click()]);
  expect(dl.suggestedFilename()).toMatch(/^drink-pass-backup-\d{4}-\d\d-\d\d\.json$/);
  await expect(page.locator('#lastBackup')).toHaveText('Last backed up just now.');
});

for (const lang of ['en', 'de', 'fr', 'it', 'nl', 'zh', 'es', 'pt']) {
  for (const width of [412, 360]) {
    test(`${lang}: the header labels fit next to the title at ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.addInitScript((l) => localStorage.setItem('drink-pass-settings-v1', JSON.stringify({ lang: l })), lang);
      await page.goto('./');
      await expect(page.locator('html')).toHaveAttribute('lang', new RegExp('^' + lang));
      const title = await page.locator('.head h1').boundingBox(), acts = await page.locator('.hacts').boundingBox();
      expect(title.x + title.width).toBeLessThanOrEqual(acts.x);
      expect(await page.locator('.head h1').evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
      expect(acts.x + acts.width).toBeLessThanOrEqual(width);
      for (const b of await page.locator('.hbtn').all()) {
        const fits = await b.evaluate((e) => e.scrollWidth <= e.clientWidth);
        expect(fits).toBe(true);
      }
    });
  }
}
