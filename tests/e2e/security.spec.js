import { test, expect } from '@playwright/test';
import { restoreSample } from './helpers.js';

test('the app makes no third-party requests and breaks no CSP rule', async ({ page }) => {
  const foreign = [], violations = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (!['localhost', ''].includes(u.hostname) && !u.protocol.startsWith('blob') && !u.protocol.startsWith('data')) foreign.push(r.url()); });
  page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) violations.push(m.text()); });
  await page.goto('./');
  await restoreSample(page);
  await page.locator('[data-close="settingsSheet"]').click();
  for (const r of ['1', '7', '30']) await page.locator(`[data-range="${r}"]`).click();
  await page.locator('#openReport').click();
  await page.locator('[data-close="reportSheet"]').click();
  await page.locator('[data-close="insightsSheet"]').click();
  await page.locator('#drinkBtn').click();
  await page.locator('#list .row').first().click();
  expect(foreign).toEqual([]);
  expect(violations).toEqual([]);
  expect(await page.evaluate(() => document.fonts.check('600 16px "Bricolage Grotesque"'))).toBe(true);
});
