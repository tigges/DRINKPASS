import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANGS, isLang, detectLang, setLang, t, tn, currentLang, currentLocale } from '../../js/i18n.js';
import { H, fill, fmtDur, agoText, fmtVol, sanitizeSettings, DEFAULT_SETTINGS } from '../../js/core.js';
import { htmlStrings } from '../../scripts/check-i18n.mjs';

test('detectLang picks the first supported browser language, else English', () => {
  assert.equal(detectLang(['de-CH', 'en-GB']), 'de');
  assert.equal(detectLang(['ja-JP', 'pt-BR', 'en']), 'pt');
  assert.equal(detectLang(['zh-Hans-CN']), 'zh');
  assert.equal(detectLang(['ja']), 'en');
  assert.equal(detectLang([]), 'en');
  assert.deepEqual(LANGS.map((l) => l.code), ['en', 'de', 'fr', 'it', 'nl', 'zh', 'es', 'pt']);
  assert.ok(isLang('nl') && !isLang('xx') && !isLang(''));
});

test('setLang loads a dictionary, keeps a matching regional locale and falls back to English text', async () => {
  await setLang('de', ['de-AT', 'en-GB']);
  assert.equal(currentLang(), 'de');
  assert.equal(currentLocale(), 'de-AT');
  assert.equal(t('Drink'), 'Trinken');
  assert.equal(t('passed|Water'), 'Urin');
  assert.equal(t('At {time}', { time: '14:05' }), 'Um 14:05');
  assert.equal(t('A string nobody translated'), 'A string nobody translated');
  assert.equal(tn(1, '{n} entry', '{n} entries'), '1 Eintrag');
  assert.equal(tn(4, '{n} entry', '{n} entries'), '4 Einträge');

  await setLang('pt', ['en-GB']);
  assert.equal(currentLocale(), 'pt-PT');
  assert.equal(t('passed|Water'), 'Urina');

  await setLang('xx', ['en-US']);
  assert.equal(currentLang(), 'en');
  assert.equal(currentLocale(), 'en-US');
  assert.equal(t('passed|Water'), 'Water');
  assert.equal(tn(1, '{n} entry', '{n} entries'), '1 entry');
});

test('fill replaces known placeholders and leaves unknown ones', () => {
  assert.equal(fill('{a} to {b}', { a: 1, b: 2 }), '1 to 2');
  assert.equal(fill('{a} to {c}', { a: 1 }), '1 to {c}');
  assert.equal(fill('plain'), 'plain');
});

test('durations, "ago" and volumes use the translator and locale they are given', async () => {
  await setLang('fr', []);
  assert.equal(fmtDur(2 * H + 5 * 60000, t), '2 h 5 min');
  assert.equal(fmtDur(10000, t), 'moins d’une minute');
  assert.equal(agoText(1000, 0, t), t('just now'));
  assert.equal(fmtVol(1250, 'ml', 'de-DE'), '1.250 ml');
  assert.equal(fmtVol(29.5735 * 8.5, 'oz', 'fr-FR'), '8,5 fl oz');
  await setLang('en', []);
});

test('the language setting is empty (follow the browser) or a two-letter code', () => {
  assert.equal(DEFAULT_SETTINGS.lang, '');
  assert.equal(sanitizeSettings({ lang: 'nl' }).lang, 'nl');
  assert.equal(sanitizeSettings({ lang: '' }).lang, '');
  assert.equal(sanitizeSettings({ lang: 'english' }).lang, '');
  assert.equal(sanitizeSettings({ lang: 4 }).lang, '');
});

test('htmlStrings finds visible text and labels but skips translate="no", svg and script', () => {
  const html = `<!DOCTYPE html><html><head><title>Skip</title></head><body>
    <h1 translate="no">Brand <b>Name</b></h1>
    <button aria-label="Close">Done</button><input placeholder="Type here" title="Hint">
    <svg><text>Chart</text></svg><script>var x = 1;</script><br><p>Hello &amp; welcome</p></body></html>`;
  assert.deepEqual(htmlStrings(html), ['Close', 'Done', 'Type here', 'Hint', 'Hello & welcome']);
});
