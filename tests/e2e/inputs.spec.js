import { test, expect } from '@playwright/test';
import { stored, openSettings } from './helpers.js';

const at = (s) => Date.parse(s);
// iOS Safari fires input and change on every wheel turn while its time picker is open.
async function turnWheel(locator, value) {
  await locator.evaluate((el, v) => {
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}
async function seed(page, entries) {
  await page.addInitScript((log) => {
    if (!localStorage.getItem('drink-pass-log-v1')) localStorage.setItem('drink-pass-log-v1', JSON.stringify(log));
  }, entries);
}

test.beforeEach(async ({ page }) => { page.on('pageerror', (e) => { throw e; }); });

test('picking a time keeps the options open while hours and minutes are turned', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-25T09:00:00Z') });
  await page.goto('./');
  await page.locator('#whenPill').click();
  await page.locator('[data-when="pick"]').click();
  const pick = page.locator('#pickTime');
  await turnWheel(pick, '22:00');
  await expect(page.locator('#whenOpts')).toBeVisible();
  await turnWheel(pick, '22:30');
  await expect(pick).toBeVisible();
  // 22:30 is later than now, so it means last night: the label says which day.
  await expect(page.locator('#whenText')).toHaveText('At Sat 22:30');
  await page.locator('#drinkBtn').click();
  // The clocks went back at 02:00, so 22:30 yesterday was 21:30 UTC.
  expect((await stored(page))[0].t).toBe(at('2026-10-24T21:30:00Z'));
  await expect(page.locator('#whenOpts')).toBeHidden();
  await expect(page.locator('#whenText')).toHaveText('Now');
});

test('a double tap on the moon logs bed only', async ({ page }) => {
  await page.goto('./');
  await page.locator('#sleepBtn').click();
  await page.locator('#sleepBtn').click();
  const log = await stored(page);
  expect(log.map((x) => x.type)).toEqual(['bed']);
});

test('a double tap on Drink keeps the bar and says it was already logged', async ({ page }) => {
  await page.goto('./');
  await page.locator('#drinkBtn').click();
  await page.locator('#drinkBtn').click();
  await expect(page.locator('#bar')).toBeVisible();
  await expect(page.locator('#barMsg')).toHaveText('Already logged. Tap Undo if that was a mistake.');
  expect(await stored(page)).toHaveLength(1);
});

test('editing a time waits for the picker to close and moves a linked solid too', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-20T12:00:00Z') });
  const t0 = at('2026-10-20T09:00:00Z');
  await seed(page, [{ id: 'p1', type: 'pass', t: t0, withSolid: 'p1-s' }, { id: 'p1-s', type: 'solid', t: t0, withPass: 'p1' }]);
  await page.goto('./');
  await page.locator('#list [data-id="p1"]').click();
  await page.locator('#timeToggle').click();
  const input = page.locator('#timeInput');
  await expect(input).toBeFocused();
  await turnWheel(input, '2026-10-20T08:00');
  await turnWheel(input, '2026-10-20T08:15');
  await expect(page.locator('#sheetTitle')).toHaveText('Pass at 10:00');
  expect((await stored(page))[0].t).toBe(t0);
  await page.locator('#sheetTitle').click();
  await expect(page.locator('#sheetTitle')).toHaveText('Pass at 08:15');
  const log = await stored(page);
  expect(log.map((x) => x.t)).toEqual([at('2026-10-20T07:15:00Z'), at('2026-10-20T07:15:00Z')]);
});

test('closing the sheet keeps a time that was still being picked', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-20T12:00:00Z') });
  await seed(page, [{ id: 'd1', type: 'drink', t: at('2026-10-20T09:00:00Z') }]);
  await page.goto('./');
  await page.locator('#list [data-id="d1"]').click();
  await page.locator('#timeToggle').click();
  await turnWheel(page.locator('#timeInput'), '2026-10-20T09:45');
  await page.keyboard.press('Escape');
  await expect(page.locator('#sheet')).toBeHidden();
  expect((await stored(page))[0].t).toBe(at('2026-10-20T08:45:00Z'));
});

test('urgency set in the details sheet applies to the linked solid', async ({ page }) => {
  const t0 = Date.now() - 3600000;
  await seed(page, [{ id: 'p1', type: 'pass', t: t0, withSolid: 'p1-s' }, { id: 'p1-s', type: 'solid', t: t0, withPass: 'p1' }]);
  await page.goto('./');
  await page.locator('#list [data-id="p1"]').click();
  await page.locator('#urgBtns button', { hasText: 'Strong' }).click();
  expect((await stored(page)).map((x) => x.urgency)).toEqual(['strong', 'strong']);
});

test('exact amounts accept a decimal comma and refuse impossible sizes', async ({ page }) => {
  await seed(page, [{ id: 'd1', type: 'drink', t: Date.now() - 600000 }]);
  await page.goto('./');
  await page.locator('#list [data-id="d1"]').click();
  await page.locator('#exactToggle').click();
  await page.locator('#exactInput').fill('7000');
  await page.locator('#exactSave').click();
  await expect(page.locator('#sheetInfo')).toHaveText('Enter an amount up to 5,000 ml.');
  expect((await stored(page))[0].size).toBeUndefined();
  await page.locator('#exactInput').fill('250,5');
  await page.locator('#exactInput').press('Enter');
  expect((await stored(page))[0].size).toEqual({ label: 'exact', ml: 250.5 });
});

test('night hours save once the picker closes and cannot start and end together', async ({ page }) => {
  await page.goto('./');
  await openSettings(page);
  const end = page.locator('#nightEnd');
  await end.focus();
  await turnWheel(end, '22:00');
  await page.locator('#settingsSheet .sech', { hasText: 'Night hours' }).click();
  await expect(page.locator('#nightMsg')).toHaveText('Night can’t start and end at the same time.');
  await expect(end).toHaveValue('06:00');
  await end.focus();
  await turnWheel(end, '07:00');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('drink-pass-settings-v1') || '{}').nightEnd)).not.toBe('07:00');
  await page.locator('#settingsSheet .sech', { hasText: 'Night hours' }).click();
  await expect(page.locator('#nightMsg')).toBeHidden();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('drink-pass-settings-v1')).nightEnd)).toBe('07:00');
});

test('the chart places entries by clock time on the 25-hour day', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-26T12:00:00Z') });
  await seed(page, [{ id: 'late', type: 'drink', t: at('2026-10-25T23:30:00Z') }]);
  await page.goto('./');
  await page.locator('#openInsights').click();
  await page.locator('[data-range="3"]').click();
  const left = await page.locator('#plot [data-id="late"]').evaluate((d) => parseFloat(d.style.left));
  expect(left).toBeCloseTo(23.5 / 24 * 100, 1);
});

test('the main screen moves on to the new day by itself', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-20T22:58:00Z') });
  await page.goto('./');
  await page.locator('#drinkBtn').click();
  await expect(page.locator('#todayCount')).toHaveText('1 today');
  await page.clock.fastForward('00:03:00');
  await expect(page.locator('#todayCount')).toHaveText('0 today');
});
