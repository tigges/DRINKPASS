/** Translations. English text is the key and the fallback; other languages live in js/i18n/<code>.js. */
import { fill } from './core.js';

export var LANGS = [
  { code: 'en', name: 'English', locale: 'en-GB' },
  { code: 'de', name: 'Deutsch', locale: 'de-DE' },
  { code: 'fr', name: 'Français', locale: 'fr-FR' },
  { code: 'it', name: 'Italiano', locale: 'it-IT' },
  { code: 'nl', name: 'Nederlands', locale: 'nl-NL' },
  { code: 'zh', name: '中文', locale: 'zh-CN' },
  { code: 'es', name: 'Español', locale: 'es-ES' },
  { code: 'pt', name: 'Português', locale: 'pt-PT' }
];
var CODES = LANGS.map(function (l) { return l.code; });
var dict = {}, lang = 'en', loc = 'en-GB', plural = null;

export function isLang(code) { return CODES.indexOf(code) > -1; }
/** First supported language in the browser's preferences, else English. */
export function detectLang(prefs) {
  for (var i = 0; i < (prefs || []).length; i++) { var c = String(prefs[i]).toLowerCase().split('-')[0]; if (isLang(c)) return c; }
  return 'en';
}
export function currentLang() { return lang; }
export function currentLocale() { return loc; }

/** A key may carry a context before "|" (e.g. "passed|Water") when one English word needs two translations. */
export function t(key, vars) {
  var s = dict[key];
  if (s === undefined) { var bar = key.indexOf('|'); s = bar > -1 ? key.slice(bar + 1) : key; }
  return fill(s, vars);
}
export function tn(n, one, other, vars) {
  var v = Object.assign({ n: n }, vars);
  return t(plural && plural.select(n) === 'one' ? one : other, v);
}
/** Marks a string as a translation key without translating it yet, so scripts/check-i18n.mjs finds it. */
export function k(key) { return key; }

export function useDictionary(code, table, prefs) {
  var meta = LANGS.filter(function (l) { return l.code === code; })[0] || LANGS[0];
  lang = meta.code; dict = table || {};
  // Keep the visitor's regional variant (en-US, pt-BR, de-CH) for dates and numbers when it matches.
  var regional = (prefs || []).filter(function (p) { return String(p).toLowerCase().split('-')[0] === lang && String(p).indexOf('-') > -1; })[0];
  loc = regional || meta.locale;
  try { plural = new Intl.PluralRules(loc); } catch (e) { plural = null; }
}
export function setLang(code, prefs) {
  if (!isLang(code)) code = 'en';
  if (code === 'en') { useDictionary('en', {}, prefs); return Promise.resolve(); }
  return import('./i18n/' + code + '.js').then(function (m) { useDictionary(code, m.default, prefs); });
}

var statics = null, ATTRS = ['aria-label', 'placeholder', 'title'];
function skip(node) {
  for (var e = node.nodeType === 1 ? node : node.parentElement; e; e = e.parentElement) {
    if (e.getAttribute('translate') === 'no' || e.tagName === 'SCRIPT' || e.tagName === 'STYLE' || e.namespaceURI === 'http://www.w3.org/2000/svg') return true;
  }
  return false;
}
function collect(root) {
  var found = { text: [], attrs: [] }, walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), n;
  while ((n = walker.nextNode())) {
    var key = n.nodeValue.trim();
    if (key && !skip(n)) found.text.push({ node: n, src: n.nodeValue, key: key });
  }
  Array.prototype.forEach.call(root.querySelectorAll('[aria-label], [placeholder], [title]'), function (el) {
    if (!skip(el)) ATTRS.forEach(function (a) { if (el.hasAttribute(a)) found.attrs.push({ el: el, attr: a, src: el.getAttribute(a) }); });
  });
  return found;
}
/**
 * Translates the page's static text and labels, as captured on the first call (before scripts add anything).
 * Text that scripts set goes through t() and is redrawn on a language change instead.
 */
export function translatePage(root) {
  if (!statics) statics = collect(root);
  statics.text.forEach(function (s) { s.node.nodeValue = s.src.replace(s.key, t(s.key)); });
  statics.attrs.forEach(function (s) { s.el.setAttribute(s.attr, t(s.src)); });
  document.documentElement.lang = loc;
}
