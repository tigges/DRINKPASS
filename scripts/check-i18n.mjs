// Checks that every language has a translation for every string the app shows, with the same {placeholders}.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(join(root, f), 'utf8');

export async function collectKeys() {
  const keys = new Set();
  const str = String.raw`'((?:[^'\\]|\\.)*)'`;
  for (const f of ['js/app.js', 'js/core.js']) {
    const src = read(f);
    for (const m of src.matchAll(new RegExp(String.raw`\b[tk]\(\s*` + str, 'g'))) keys.add(m[1]);
    for (const m of src.matchAll(new RegExp(String.raw`\btn\([^']*?,\s*` + str + String.raw`,\s*` + str, 'g'))) { keys.add(m[1]); keys.add(m[2]); }
  }
  const core = await import(pathToFileURL(join(root, 'js/core.js')));
  for (const list of [core.URG, core.KINDS, core.KINDS_SHORT]) for (const [, label] of list) keys.add(label);
  for (const [label] of [...core.PRESETS.drink, ...core.PRESETS.pass]) keys.add(label);
  for (const label of Object.values(core.NAMES)) keys.add(label);
  for (const key of htmlStrings(read('index.html'))) keys.add(key);
  return keys;
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const SKIP = new Set(['head', 'script', 'style', 'svg', 'title']);
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
/** Visible text and labels in the page, mirroring what translatePage() in js/i18n.js translates. */
export function htmlStrings(html) {
  const out = [], stack = [];
  const body = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<!DOCTYPE[^>]*>/i, '');
  for (const m of body.matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/g)) {
    const skipping = stack.some((e) => e.skip);
    if (m[4] !== undefined) { const text = decode(m[4]).trim(); if (text && !skipping) out.push(text); continue; }
    const [, close, tag, attrs] = m, name = tag.toLowerCase();
    if (close) { const i = stack.map((e) => e.tag).lastIndexOf(name); if (i > -1) stack.length = i; continue; }
    const skip = SKIP.has(name) || /\btranslate="no"/.test(attrs);
    if (!skipping && !skip) for (const a of attrs.matchAll(/\b(aria-label|placeholder|title)="([^"]*)"/g)) out.push(decode(a[2]));
    if (!VOID.has(name) && !attrs.trim().endsWith('/')) stack.push({ tag: name, skip });
  }
  return out;
}

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const keys = await collectKeys(), problems = [];
  const files = readdirSync(join(root, 'js/i18n')).filter((f) => f.endsWith('.js')).sort();
  const { LANGS } = await import(pathToFileURL(join(root, 'js/i18n.js')));
  const sw = read('sw.js');
  for (const { code } of LANGS) {
    if (code === 'en') continue;
    if (!files.includes(code + '.js')) problems.push(`js/i18n/${code}.js: missing`);
    if (!sw.includes(`'js/i18n/${code}.js': `)) problems.push(`sw.js: js/i18n/${code}.js is not precached (run npm run stamp)`);
  }
  for (const f of files) if (!LANGS.some((l) => l.code + '.js' === f)) problems.push(`js/i18n/${f}: not listed in LANGS`);
  for (const f of files) {
    const dict = (await import(pathToFileURL(join(root, 'js/i18n', f)))).default;
    for (const key of keys) {
      if (!(key in dict)) problems.push(`${f}: missing "${key}"`);
      else if (placeholders(dict[key]) !== placeholders(key.replace(/^[^|]*\|/, ''))) problems.push(`${f}: placeholders differ for "${key}"`);
    }
    for (const key of Object.keys(dict)) if (!keys.has(key)) problems.push(`${f}: unused "${key}"`);
  }
  if (problems.length) { console.error(problems.slice(0, 60).map((p) => '- ' + p).join('\n') + (problems.length > 60 ? `\n… ${problems.length - 60} more` : '')); process.exit(1); }
  console.log(`${files.length} languages translate all ${keys.size} strings.`);
}
