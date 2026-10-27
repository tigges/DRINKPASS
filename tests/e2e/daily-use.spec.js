import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { stored, restoreSample, openSection } from './helpers.js';

const at = (s) => Date.parse(s);
const DAY = 864e5, H = 36e5;
async function seed(page, entries, settings) {
  await page.addInitScript(([log, set]) => {
    if (!localStorage.getItem('drink-pass-log-v1')) localStorage.setItem('drink-pass-log-v1', JSON.stringify(log));
    if (set && !localStorage.getItem('drink-pass-settings-v1')) localStorage.setItem('drink-pass-settings-v1', JSON.stringify(set));
  }, [entries, settings || null]);
}

test.beforeEach(async ({ page }) => { page.on('pageerror', (e) => { throw e; }); });

test('a new drink or pass gets the size used last time, or Medium at first', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-15T09:00:00Z') });
  await page.goto('./');
  await page.locator('#drinkBtn').click();
  expect((await stored(page))[0].size).toEqual({ label: 'medium', ml: 250 });
  await expect(page.locator('#barRows button[aria-pressed="true"]')).toHaveText(/Medium/);
  await page.locator('#barRows button', { hasText: 'Large' }).click();
  await page.clock.fastForward('00:10:00');
  await page.locator('#drinkBtn').click();
  expect((await stored(page)).map((x) => x.size.ml)).toEqual([400, 400]);
  await page.locator('#passBtn').click();
  expect((await stored(page))[2].size).toEqual({ label: 'medium', ml: 250 });
});

test('holding Drink logs it straight away, without the questions', async ({ page }) => {
  await page.goto('./');
  const box = await page.locator('#drinkBtn').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await expect(page.locator('#bar')).toBeVisible();
  await expect(page.locator('#barMsg')).toHaveText(/^Drink logged · \d\d:\d\d · 250\s+ml$/);
  await expect(page.locator('#barRows')).toBeEmpty();
  expect(await stored(page)).toHaveLength(1);
});

test('a leak is logged with how much and what set it off, and shows in insights, the summary and exports', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-01-15T21:00:00Z'));
  await page.goto('./');
  await restoreSample(page);
  await page.locator('[data-close="settingsSheet"]').click();
  await page.locator('[data-close="insightsSheet"]').click();
  await page.locator('#leakBtn').click();
  await page.locator('#barRows button', { hasText: 'Small' }).click();
  await page.locator('#barRows button', { hasText: 'Cough or sneeze' }).click();
  await page.locator('#barRows button', { hasText: 'Pad changed' }).click();
  const leak = (await stored(page)).find((x) => x.type === 'leak');
  expect(leak).toMatchObject({ amount: 'small', cause: 'cough', pad: true });
  expect(leak.size).toBeUndefined();
  const row = page.locator('#list .row').first();
  await expect(row.locator('.dot')).toHaveClass('dot leak');
  await expect(row.locator('.tag')).toHaveText(['Small', 'Cough or sneeze', 'Pad changed']);

  await page.locator('#openInsights').click();
  await page.locator('[data-range="1"]').click();
  await expect(page.locator('.insh', { hasText: 'Leaks' })).toContainText('1 in 24 h');
  await expect(page.locator('.plot .d.leak')).toHaveCount(1);
  await expect(page.locator('#legend')).toContainText('Leak');
  await expect(page.locator('#tiles .blh', { hasText: 'What set it off' })).toContainText('Pad changed 1 time');

  await page.locator('#openReport').click();
  await page.locator('[data-days="1"]').click();
  await expect(page.locator('#reportFv thead th').last()).toHaveText('Leaks');
  await expect(page.locator('#reportTable')).toContainText('Leak, small, cough or sneeze, pad changed');
  await expect(page.locator('#reportTable tr.tot')).toContainText('1 leak');
  await page.locator('#copyCsv').click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#dlCsv').click()]);
  expect(readFileSync(await dl.path(), 'utf8')).toContain(',leak,,,,,,,small,cough,yes,');
});

test('tablets and exercises are markers: listed, but not counted as drinks or passes', async ({ page }) => {
  await page.goto('./');
  await page.locator('#markPill').click();
  await expect(page.locator('#markOpts')).toBeVisible();
  await page.locator('[data-mark="tablet"]').click();
  await expect(page.locator('#markOpts')).toBeHidden();
  await expect(page.locator('#barMsg')).toContainText('Tablet logged');
  await expect(page.locator('#barRows')).toBeEmpty();
  await page.locator('#markPill').click();
  await page.locator('[data-mark="exercise"]').click();
  expect((await stored(page)).map((x) => x.type)).toEqual(['tablet', 'exercise']);
  await expect(page.locator('#list .row .mark svg')).toHaveCount(2);
  await expect(page.locator('#tdPasses')).toHaveText('0');
  await page.locator('#openSettingsMain').click();
  await openSection(page, 'secLogging');
  await page.locator('[data-toggle="showMarks"]').click();
  await page.locator('[data-toggle="showLeak"]').click();
  await page.locator('[data-close="settingsSheet"]').click();
  await expect(page.locator('#markPill')).toBeHidden();
  await expect(page.locator('#leakBtn')).toBeHidden();
});

test('Progress charts mark the first tablet and the first exercises', async ({ page }) => {
  const now = at('2026-01-15T21:00:00Z'), log = [];
  for (let d = 13; d >= 0; d--) for (let h of [8, 12, 16, 20]) log.push({ id: `p${d}-${h}`, type: 'pass', t: now - d * DAY - (21 - h) * H, size: { label: 'medium', ml: 200 + d * 5 } });
  log.push({ id: 'tab', type: 'tablet', t: now - 8 * DAY }, { id: 'ex', type: 'exercise', t: now - 4 * DAY });
  await seed(page, log, { range: 14 });
  await page.clock.setFixedTime(new Date(now));
  await page.goto('./');
  await page.locator('#openInsights').click();
  await page.locator('.prow', { hasText: 'Average size' }).click();
  const det = page.locator('.pdet:not([hidden])');
  await expect(det.locator('line.pmk.tablet')).toHaveCount(1);
  await expect(det.locator('line.pmk.exercise')).toHaveCount(1);
  await expect(det.locator('.plg')).toContainText('First tablet · 7 Jan');
  await expect(det.locator('.plg')).toContainText('First pelvic floor exercises · 11 Jan');
});

test('the header has a Settings button, and Settings opens in groups', async ({ page }) => {
  await page.goto('./');
  await page.locator('#openSettingsMain').click();
  await expect(page.locator('#settingsSheet')).toBeVisible();
  await expect(page.locator('details.sec > summary')).toHaveText(['Backup and data', 'Logging', 'Insights and summary', 'Reminders and targets', 'Language, units and display', 'About']);
  await expect(page.locator('#secBackup')).toHaveAttribute('open', '');
  await expect(page.locator('#dlBackup')).toBeVisible();
  await expect(page.locator('[data-remind="2"]')).toBeHidden();
  await openSection(page, 'secRemind');
  await expect(page.locator('[data-remind="2"]')).toBeVisible();
});

test('text size makes everything larger and stays after reload', async ({ page }) => {
  await page.goto('./');
  const before = await page.locator('.lathead h2').evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  await page.locator('#openSettingsMain').click();
  await openSection(page, 'secDisplay');
  await page.locator('[data-textsize="xl"]').click();
  await expect(page.locator('html')).toHaveClass(/ts-xl/);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/ts-xl/);
  const after = await page.locator('.lathead h2').evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  expect(after / before).toBeCloseTo(1.25, 2);
});

test('the clinician summary can end yesterday', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-01-16T10:00:00Z'));
  await page.goto('./');
  await restoreSample(page);
  await page.locator('[data-close="settingsSheet"]').click();
  await page.locator('#openReport').click();
  await page.locator('[data-days="1"]').click();
  await expect(page.locator('#reportRange')).toHaveText('Fri, 16 Jan 2026');
  await page.locator('[data-end="1"]').click();
  await expect(page.locator('[data-end="1"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#reportRange')).toHaveText('Thu, 15 Jan 2026');
  await expect(page.locator('#reportTable tr.tot')).toContainText('3 passes');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#dlCsv').click()]);
  expect(readFileSync(await dl.path(), 'utf8').split('\n')).toHaveLength(7);
});

test('short ranges link to Progress, which opens the whole diary', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-01-15T21:00:00Z'));
  await page.goto('./');
  await restoreSample(page);
  await page.locator('[data-close="settingsSheet"]').click();
  await page.locator('[data-range="3"]').click();
  const link = page.locator('#progressLink');
  await expect(link).toContainText('How things are changing');
  await expect(link).toContainText('Log on 9 more days to see it.');
  await link.click();
  await expect(page.locator('[data-range="0"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.prog')).toBeVisible();
  await expect(page.locator('#progressLink')).toHaveCount(0);
});

test('a daily target shows progress under In today and in the drink reminder', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-15T09:00:00Z') });
  await page.goto('./');
  await page.locator('#drinkBtn').click();
  await page.locator('#openSettingsMain').click();
  await openSection(page, 'secRemind');
  await expect(page.locator('[data-target="2000"]')).toHaveText('2,000\u00a0ml');
  await page.locator('[data-target="2000"]').click();
  await page.locator('[data-remind="2"]').click();
  await page.locator('[data-close="settingsSheet"]').click();
  await expect(page.locator('#tdInBar')).toBeVisible();
  expect(await page.locator('#tdInFill').evaluate((e) => e.style.width)).toBe('12.5%');
  await page.clock.fastForward('02:01:00');
  await expect(page.locator('#remindText')).toContainText('1,750\u00a0ml to go today.');
});

test('bladder training shows the next planned pass and prompts when it’s due', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-15T09:00:00Z') });
  await page.goto('./');
  await page.locator('#passBtn').click();
  await page.locator('#openSettingsMain').click();
  await openSection(page, 'secRemind');
  await expect(page.locator('[data-stretch="15"]')).toBeDisabled();
  await page.locator('[data-train="120"]').click();
  await page.locator('[data-stretch="15"]').click();
  await expect(page.locator('#trainMsg')).toHaveText('Planned gap now: 2 h.');
  await page.locator('[data-close="settingsSheet"]').click();
  await expect(page.locator('#tdNextL')).toBeVisible();
  await expect(page.locator('#tdSince')).toHaveText('11:00');
  await expect(page.locator('#trainBar')).toBeHidden();
  await page.clock.fastForward('02:01:00');
  await expect(page.locator('#trainBar')).toBeVisible();
  await page.locator('#trainLog').click();
  await expect(page.locator('#trainBar')).toBeHidden();
  expect((await stored(page)).filter((x) => x.type === 'pass')).toHaveLength(2);
  await expect(page.locator('#tdSince')).toHaveText('13:01');
});

test('waking up from the sleeping card ends the night', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-15T22:30:00Z') });
  await page.goto('./');
  await page.locator('#sleepBtn').click();
  await page.locator('#bedGo').click();
  await expect(page.locator('#todayStrip')).toBeHidden();
  await expect(page.locator('#sleepSince')).toHaveText('Sleeping since 22:30');
  await page.clock.fastForward('03:00:00');
  await page.locator('#passBtn').click();
  await expect(page.locator('#sleepPasses')).toHaveText('1 night pass so far');
  await page.clock.fastForward('04:00:00');
  await page.locator('#wakeBtn').click();
  await expect(page.locator('#sleepCard')).toBeHidden();
  await expect(page.locator('#todayStrip')).toBeVisible();
  expect((await stored(page)).map((x) => x.type)).toEqual(['bed', 'pass', 'wake']);
});

test('Insights compares night passes after evening tea, coffee or alcohol with other nights', async ({ page }) => {
  const now = at('2026-01-15T21:00:00Z'), day0 = at('2026-01-15T00:00:00Z'), log = [];
  for (let d = 1; d <= 6; d++) {
    const eve = day0 - d * DAY;
    const late = d % 2 === 0;
    log.push({ id: `d${d}`, type: 'drink', t: eve + 19 * H, kind: late ? 'teacoffee' : 'water', size: { label: 'medium', ml: 250 } });
    log.push({ id: `p${d}a`, type: 'pass', t: eve + 26 * H, size: { label: 'medium', ml: 250 } });
    if (late) log.push({ id: `p${d}b`, type: 'pass', t: eve + 28 * H, size: { label: 'medium', ml: 250 } });
  }
  await seed(page, log, { range: 7 });
  await page.clock.setFixedTime(new Date(now));
  await page.goto('./');
  await page.locator('#openInsights').click();
  await expect(page.locator('.insnote.wide')).toHaveText('After tea, coffee or alcohol from 4 pm, you passed 2 times a night. On other nights, 1.');
});

test('the first-run guide explains the basics and offers to install', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('.guide h3')).toHaveText('Getting started');
  await expect(page.locator('.guide li')).toHaveCount(3);
  await page.locator('#installBtn').click();
  await expect(page.locator('.guide .hint')).toContainText('To install: in Safari tap Share');
  await page.locator('#drinkBtn').click();
  await expect(page.locator('.guide')).toHaveCount(0);
});
