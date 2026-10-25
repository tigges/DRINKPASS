import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { restoreSample, openSettings } from './helpers.js';
import { collectKeys } from '../../scripts/check-i18n.mjs';

const LANGS = ['de', 'fr', 'it', 'nl', 'zh', 'es', 'pt'];
const dictionary = async (code) => (await import(`../../js/i18n/${code}.js`)).default;
const plain = (key) => key.replace(/^[^|]*\|/, '');

/** Every visible text and every label in the page, outside translate="no". */
function pageStrings(page) {
  return page.evaluate(() => {
    const out = new Set(), walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.nodeValue.trim(), el = n.parentElement;
      if (text && el && !el.closest('[translate="no"], svg') && el.checkVisibility()) out.add(text);
    }
    for (const el of document.querySelectorAll('[aria-label], [placeholder], [title]')) {
      if (el.closest('[translate="no"], svg')) continue;
      for (const a of ['aria-label', 'placeholder', 'title']) if (el.hasAttribute(a)) out.add(el.getAttribute(a));
    }
    return [...out];
  });
}

/** Walks the main view, insights, the clinician summary and settings, collecting what each shows. */
async function everyView(page) {
  const seen = new Set(await pageStrings(page));
  const add = async () => (await pageStrings(page)).forEach((s) => seen.add(s));
  await page.locator('#openInsights').click(); await add();
  await page.locator('#openReport').click(); await page.locator('[data-days="7"]').click(); await add();
  await page.locator('[data-close="reportSheet"]').click();
  await page.locator('#openSettings').click(); await add();
  await page.locator('[data-close="settingsSheet"]').click();
  await page.locator('[data-close="insightsSheet"]').click();
  return seen;
}

test('a flag switches the language straight away and it stays after reload', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#drinkBtn .word')).toHaveText('Drink');
  await openSettings(page);
  await expect(page.locator('[data-lang="en"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-lang="de"]').click();
  await expect(page.locator('[data-lang="de"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#settingsSheet h2')).toHaveText('Einstellungen und Sicherung');
  await expect(page.locator('html')).toHaveAttribute('lang', 'de-DE');

  await page.reload();
  await expect(page.locator('#drinkBtn .word')).toHaveText('Trinken');
  await expect(page.locator('#passBtn .word')).toHaveText('Wasserlassen');
  await expect(page.locator('#drinkBtn')).toHaveAccessibleName(/^Getränk erfassen/);
});

test.describe('the browser language is used until a flag is chosen', () => {
  test.use({ locale: 'nl-BE' });
  test('Dutch with Belgian date formats', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('#drinkBtn .word')).toHaveText('Drinken');
    await expect(page.locator('html')).toHaveAttribute('lang', 'nl-BE');
  });
});

for (const code of LANGS) {
  test.describe(`${code}: no English is left on screen`, () => {
    test.use({ locale: code });
    test(code, async ({ page }) => {
      const dict = await dictionary(code), values = new Set(Object.values(dict));
      const english = new Set([...await collectKeys()].filter((k) => dict[k] !== plain(k) && !values.has(plain(k))).map(plain));
      await page.clock.setFixedTime(new Date('2026-01-15T21:00:00Z'));
      await page.goto('./');
      await restoreSample(page);
      await page.locator('[data-close="settingsSheet"]').click();
      await page.locator('[data-close="insightsSheet"]').click();
      const left = [...await everyView(page)].filter((s) => english.has(s));
      expect(left).toEqual([]);
    });
  });
}

test('switching languages shows exactly what a fresh start in that language shows', async ({ page, browser }) => {
  const fresh = await (await browser.newContext({ locale: 'fr', timezoneId: 'Europe/London' })).newPage();
  for (const p of [page, fresh]) {
    await p.clock.setFixedTime(new Date('2026-01-15T21:00:00Z'));
    await p.goto('./');
    await restoreSample(p);
  }
  await expect(fresh.locator('#backupMsg')).toBeEmpty({ timeout: 5000 });
  await fresh.locator('[data-close="settingsSheet"]').click();
  await fresh.locator('[data-close="insightsSheet"]').click();
  // The storage status counts automatic copies, which are saved on a timer.
  const shown = async (p) => [...await everyView(p)].filter((s) => !s.startsWith('Entrées :')).sort();
  const expected = await shown(fresh);

  await page.locator('[data-lang="de"]').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'de-DE');
  await page.locator('[data-close="settingsSheet"]').click();
  await page.locator('#openReport').click();
  await page.locator('[data-close="reportSheet"]').click();
  await page.locator('#openSettings').click();
  await page.locator('[data-lang="fr"]').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr-FR');
  await page.locator('[data-close="settingsSheet"]').click();
  await page.locator('[data-close="insightsSheet"]').click();
  expect(await shown(page)).toEqual(expected);
});

test.describe('translated sentences keep their own word order', () => {
  test.use({ locale: 'de' });
  test('night passes and comparisons read as whole German sentences', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-01-16T23:30:00Z'));
    await page.goto('./');
    await restoreSample(page);
    await page.locator('[data-toggle="compare"]').click();
    await page.locator('[data-close="settingsSheet"]').click();
    await expect(page.locator('#tiles .sub').first()).toHaveText(/^Ein −650\s*ml · Aus −500\s*ml ggü\. den 24 Std\. davor$/);
    await page.locator('[data-close="insightsSheet"]').click();

    await page.locator('#passBtn').click();
    await page.getByRole('button', { name: /^23:30 Wasserlassen \(nachts\) / }).click();
    await expect(page.locator('#sheetTitle')).toHaveText('Wasserlassen um 23:30 (nachts)');
    await page.keyboard.press('Escape');

    await page.locator('#openInsights').click();
    await expect(page.locator('#tiles .sub', { hasText: /^\+1 ggü\. den 24 Std\. davor$/ })).toHaveCount(1);
    await page.clock.setFixedTime(new Date('2026-01-18T12:00:00Z'));
    await page.locator('[data-range="3"]').click();
    await expect(page.locator('#tiles .sub').first()).toHaveText(/^Ein −650\s*ml · Aus −500\s*ml ggü\. den 3 Tagen davor$/);
    await expect(page.locator('#tiles .sub', { hasText: /^\+1 ggü\. den 3 Tagen davor$/ })).toHaveCount(1);
  });
});

const pages = (pdf) => (pdf.toString('latin1').match(/\/Type \/Page /g) || []).length;

test('Save as PDF makes the file itself, without the print window', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-01-15T21:00:00Z'));
  await page.goto('./');
  await restoreSample(page);
  await page.locator('[data-close="settingsSheet"]').click();
  await page.locator('#openReport').click();
  await page.locator('[data-days="3"]').click();
  await page.evaluate(() => { window.printed = 0; window.print = () => window.printed++; });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#pdfBtn').click()]);
  expect(dl.suggestedFilename()).toBe('Bladder and drink diary 2026-01-13 – 2026-01-15.pdf');
  const pdf = readFileSync(await dl.path());
  expect(pdf.subarray(0, 8).toString()).toBe('%PDF-1.4');
  expect(pdf.toString('latin1').trimEnd().endsWith('%%EOF')).toBe(true);
  expect(pages(pdf)).toBe(1);
  expect(pdf.toString('latin1')).toContain('/Filter /DCTDecode');
  await expect(page.locator('#reportMsg')).toHaveText('Saved');
  expect(await page.evaluate(() => window.printed)).toBe(0);
});

test.describe('on a phone the PDF goes to the share sheet', () => {
  test.use({ locale: 'zh' });
  test('in Chinese, over several pages', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-01-15T21:00:00Z'));
    await page.addInitScript(() => {
      const base = Date.parse('2026-01-09T07:00:00Z'), log = [];
      for (let d = 0; d < 7; d++) for (let i = 0; i < 14; i++) log.push({ id: `x${d}-${i}`, type: i % 2 ? 'drink' : 'pass', t: base + d * 864e5 + i * 3600e3, size: { label: 'medium', ml: 250 } });
      localStorage.setItem('drink-pass-log-v1', JSON.stringify(log));
    });
    await page.goto('./');
    await page.locator('#openInsights').click();
    await page.evaluate(() => {
      navigator.canShare = (d) => !!(d && d.files);
      navigator.share = async (d) => { const f = d.files[0]; window.shared = { name: f.name, type: f.type, bytes: Array.from(new Uint8Array(await f.arrayBuffer())) }; };
    });
    await page.locator('#openReport').click();
    await page.locator('[data-days="7"]').click();
    await page.locator('#pdfBtn').click();
    await expect.poll(() => page.evaluate(() => !!window.shared)).toBe(true);
    const shared = await page.evaluate(() => window.shared);
    expect(shared.name).toBe('排尿日记 2026-01-09 – 2026-01-15.pdf');
    expect(shared.type).toBe('application/pdf');
    expect(pages(Buffer.from(shared.bytes))).toBeGreaterThan(1);
  });
});
