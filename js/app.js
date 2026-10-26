import {
  OZ, DAY, PRESETS, URG, KINDS, KINDS_SHORT, NAMES, BRISTOL,
  isSleep, pad, cap, labelOf, median, startOfDay, dayRange, fmtTime as fmtTimeIn, fmtHour, fmtDur as fmtDurIn, agoText as agoTextIn, toLocalInput,
  sortEntries, isoDate, between, sleepModel, sanitizeSettings, migrateLog, DEFAULT_SETTINGS, SCHEMA, isNightAt, isAsleepAt, computeGaps, periodStats as periodStatsOf, toCsv,
  fmtVol as fmtVolIn
  , fvSummary, drinkReminder, lastClockTime, APP_VERSION, clockFraction, clockSlot, dayOffsetOf, MAX_ML, dailySeries, rolling, trendEnds
} from './core.js';
import { toFhirBundle } from './fhir.js';
import { reportPdf } from './pdf.js';
import { encryptBackup, decryptBackup, isEncryptedBackup } from './crypto.js';
import { t, tn, k, setLang, detectLang, isLang, currentLang, currentLocale, translatePage } from './i18n.js';

var KEY = 'drink-pass-log-v1', SKEY = 'drink-pass-settings-v1', BKEY = 'drink-pass-backup-v1', TKEY = 'drink-pass-trash-v1', MKEY = 'drink-pass-schema';
var NS = 'http://www.w3.org/2000/svg';
var log = [], settings = sanitizeSettings(null), bk = { last: 0, snooze: 0, done: 0 }, trash = [], lastTap = {}, barRestore = null, barStash = null;
function isStandalone() { try { return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true; } catch (e) { return false; } }
var idb = null, recoveryPending = null, snapCache = [], mirrorTimer = null, lastSnapAt = 0, persistTried = false, pendingRestore = null;
var loadProblem = false, storageOk = true, whenMode = 'now', dayOffset = 0, reportDays = 1, rangeDays = 1;
var sheetId = null, barId = null, barTimer = null, sleep = { periods: [], markers: [], last: null };
var $ = function (id) { return document.getElementById(id); };
var each = function (sel, fn) { Array.prototype.forEach.call(document.querySelectorAll(sel), fn); };

function testStorage() { try { localStorage.setItem('dp-test', '1'); localStorage.removeItem('dp-test'); storageOk = true; } catch (e) { storageOk = false; } }
function readJson(key) {
  var raw = localStorage.getItem(key);
  if (raw === null) return { missing: true };
  try { return { value: JSON.parse(raw), raw: raw }; } catch (e) { return { bad: true, raw: raw }; }
}
// Keeps the unreadable original so a later save can't overwrite the only copy.
function quarantine(key, raw) {
  try { localStorage.setItem(key + '-unreadable-' + Date.now(), raw); } catch (e) {}
  loadProblem = true;
}
function loadLog() {
  touch();
  var r = readJson(KEY);
  if (r.bad) { quarantine(KEY, r.raw); log = []; return; }
  if (r.missing || !Array.isArray(r.value)) { log = []; return; }
  var m = migrateLog(r.value, +localStorage.getItem(MKEY) || 1);
  log = m.log;
  if (m.dropped) quarantine(KEY, r.raw);
  if (m.from !== SCHEMA) try { localStorage.setItem(MKEY, String(SCHEMA)); } catch (e) {}
}
function loadSettings() {
  var r = readJson(SKEY);
  if (r.bad) quarantine(SKEY, r.raw);
  settings = sanitizeSettings(r.value, DEFAULT_SETTINGS);
  rangeDays = settings.range; reportDays = !rangeDays || rangeDays > 7 ? 7 : rangeDays;
}
function load() {
  try { loadLog(); } catch (e) { log = []; }
  try { loadSettings(); } catch (e) {}
  try {
    var b = readJson(BKEY);
    if (b.value && typeof b.value === 'object') bk = { last: +b.value.last || 0, snooze: +b.value.snooze || 0, done: +b.value.done || 0 };
    else { bk.last = Date.now(); saveBk(); }
  } catch (e) {}
  try {
    var tr = readJson(TKEY);
    if (Array.isArray(tr.value)) trash = tr.value.filter(function (q) { return q && q.entry && Date.now() - q.at < 30 * DAY; });
  } catch (e) {}
}
function saveBk() { try { localStorage.setItem(BKEY, JSON.stringify(bk)); } catch (e) {} }
function save() {
  touch();
  try { localStorage.setItem(KEY, JSON.stringify(log)); localStorage.setItem(SKEY, JSON.stringify(settings)); localStorage.setItem(MKEY, String(SCHEMA)); storageOk = true; } catch (e) { storageOk = false; }
  $('storageWarn').hidden = storageOk;
  scheduleMirror();
}
function saveTrash() { try { localStorage.setItem(TKEY, JSON.stringify(trash)); } catch (e) {} }
function updateNudge() {
  var now = Date.now(), due;
  if (bk.done) due = now - bk.done > 3 * DAY; else due = now - bk.last > DAY;
  var show = storageOk && log.length > 0 && due && now > bk.snooze;
  $('nudge').hidden = !show;
  if (show) $('nudgeText').textContent = (bk.done ? tn(Math.floor((now - bk.done) / DAY), 'It’s been {n} day since your last backup.', 'It’s been {n} days since your last backup.') : t('You haven’t backed up yet.')) + ' ' + t('Entries only live in this browser.');
}
function backupStatus() {
  $('lastBackup').textContent = bk.done ? t('Last backed up {ago}.', { ago: agoText(bk.done) }) : t('Not backed up yet.');
}
function markBackup() { bk.last = Date.now(); bk.done = Date.now(); bk.snooze = 0; saveBk(); updateNudge(); backupStatus(); }

function fmtVol(ml) { return fmtVolIn(ml, settings.unit, currentLocale()); }
function fmtTime(ms) { return fmtTimeIn(ms, settings.clock); }
function fmtDur(ms) { return fmtDurIn(ms, t); }
function agoText(ms) { return agoTextIn(ms, undefined, t); }
function num(n) { return (Math.round(n * 10) / 10).toLocaleString(currentLocale()); }
function fmtDate(ms, opts) { return new Date(ms).toLocaleDateString(currentLocale(), opts); }
function name(type) { return t(NAMES[type]); }
// German capitalises nouns, so labels are only lower-cased mid-sentence in the other languages.
function low(s) { return currentLang() === 'de' ? s : s.toLowerCase(); }
function nightly(what, ms) { return isNight(ms) ? t('{what} (night)', { what: what }) : what; }
// Every change to `log` goes through save() or loadLog(), which clear these caches.
var sortedCache = null, gapsCache = null;
function touch() { sortedCache = null; gapsCache = null; }
function sorted() { if (!sortedCache) sortedCache = sortEntries(log); return sortedCache; }
function find(id) { for (var i = 0; i < log.length; i++) if (log[i].id === id) return log[i]; return null; }
function svgIcon(id, px, cls) {
  var s = document.createElementNS(NS, 'svg'); s.setAttribute('class', 'ic' + (cls ? ' ' + cls : '')); s.setAttribute('aria-hidden', 'true');
  if (px) { s.style.width = px + 'px'; s.style.height = px + 'px'; }
  var u = document.createElementNS(NS, 'use'); u.setAttribute('href', '#' + id); s.appendChild(u); return s;
}

function refreshSleep() { sleep = sleepModel(sorted(), settings.nightStart); }
function isNight(ms) { return isNightAt(ms, sleep, settings.nightStart, settings.nightEnd); }
function isAsleep() { return isAsleepAt(sleep, Date.now()); }
function syncSleepBtn() {
  var a = isAsleep();
  $('sleepUse').setAttribute('href', a ? '#i-sun' : '#i-moon');
  $('sleepBtn').setAttribute('aria-label', a ? t('Up for the day') : t('Going to bed'));
}

function getWhen() {
  var now = Date.now();
  if (whenMode === 'now') return now;
  if (whenMode === '5') return now - 5 * 60000;
  if (whenMode === '15') return now - 15 * 60000;
  var v = $('pickTime').value; if (!v) return now;
  return lastClockTime(v, now);
}
function whenLabel() {
  if (whenMode === 'now') return t('Now');
  if (whenMode === '5') return t('5 min ago');
  if (whenMode === '15') return t('15 min ago');
  return $('pickTime').value ? t('At {time}', { time: fmtWhen(getWhen()) }) : t('Pick a time');
}
function toggleWhen(open) { $('whenOpts').hidden = !open; $('whenPill').setAttribute('aria-expanded', open ? 'true' : 'false'); }
function setWhen(mode) {
  whenMode = mode;
  each('[data-when]', function (c) { c.setAttribute('aria-pressed', c.getAttribute('data-when') === mode ? 'true' : 'false'); });
  var pt = $('pickTime'); pt.hidden = mode !== 'pick';
  if (mode === 'pick' && !pt.value) { var n = new Date(); pt.value = pad(n.getHours()) + ':' + pad(n.getMinutes()); }
  $('whenText').textContent = whenLabel();
  if (mode !== 'pick') toggleWhen(false);
}

function ripple(btn, ev) {
  var r = btn.getBoundingClientRect(), size = Math.max(r.width, r.height) * 2;
  var x = (ev && ev.clientX) ? ev.clientX - r.left : r.width / 2, y = (ev && ev.clientY) ? ev.clientY - r.top : r.height / 2;
  var s = document.createElement('span'); s.className = 'ripple';
  s.style.width = s.style.height = size + 'px'; s.style.left = (x - size / 2) + 'px'; s.style.top = (y - size / 2) + 'px';
  btn.appendChild(s); setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 700);
}

function addEntry(type, ev) {
  // Bed and wake share one key: the moon turns into the sun after the first tap, so a double tap would log both.
  var tapNow = Date.now(), tapKey = isSleep({ type: type }) ? 'sleep' : type;
  if (lastTap[tapKey] && tapNow - lastTap[tapKey] < 1500) { if (barId) $('barMsg').textContent = t('Already logged. Tap Undo if that was a mistake.'); return; }
  lastTap[tapKey] = tapNow; barStash = null; tryPersist();
  var at = getWhen();
  var entry = { id: Date.now() + '-' + Math.random().toString(36).slice(2, 7), type: type, t: at };
  log.push(entry); save();
  dayOffset = Math.min(0, dayOffsetOf(at));
  setWhen('now');
  render();
  showBar(entry);
  if (type === 'drink' || type === 'pass') ripple($(type === 'drink' ? 'drinkBtn' : 'passBtn'), ev);
  if (navigator.vibrate) { try { navigator.vibrate(15); } catch (e) {} }
}
function remove(id, toTrash) {
  var gone = find(id), mate = partner(gone);
  if (toTrash && gone) { trash.unshift(mate ? { entry: gone, partner: mate, at: Date.now() } : { entry: gone, at: Date.now() }); trash = trash.slice(0, 20); saveTrash(); }
  log = log.filter(function (x) { return x.id !== id && !(mate && x.id === mate.id); });
  if (sheetId === id || (mate && sheetId === mate.id)) { sheetId = null; hideSheet(); }
  if (barId === id || (mate && barId === mate.id)) hideBar();
  save(); render();
}
function restoreEntry(entry, mate) {
  if (!find(entry.id)) log.push(entry);
  if (mate && !find(mate.id)) log.push(mate);
  trash = trash.filter(function (q) { return q.entry.id !== entry.id; }); saveTrash();
  save(); render(); renderTrash();
}
function renderTrash() {
  var box = $('trashList'); box.textContent = '';
  if (!trash.length) { box.appendChild(el('p', 'hint', t('Nothing removed recently. Removed entries stay here for 30 days.'))); return; }
  trash.slice(0, 10).forEach(function (q) {
    var r = el('div', 'trashrow'); r.appendChild(el('span', '', (q.partner ? t('Pass and solid') : name(q.entry.type)) + ' · ' + fmtWhen(q.entry.t)));
    var b = el('button', 'btn', t('Restore')); b.type = 'button'; b.addEventListener('click', function () { restoreEntry(q.entry, q.partner); }); r.appendChild(b); box.appendChild(r);
  });
}

function gaps() { if (!gapsCache) gapsCache = computeGaps(sorted()); return gapsCache; }
function gapLine(x, g) {
  if (x.type === 'solid') return (g.solid !== null && g.solid !== undefined && g.solid < 3 * DAY) ? t('{d} since last solid', { d: fmtDur(g.solid) }) : t('No solid in the previous 3 days');
  if (x.type === 'pass') return (g.pass !== null && g.pass < DAY) ? t('{d} after last pass', { d: fmtDur(g.pass) }) : t('No pass in the previous 24 h');
  return (g.drink !== null && g.drink < DAY) ? t('{d} since last drink', { d: fmtDur(g.drink) }) : t('No drink in the previous 24 h');
}
function sizeText(x) { return x.size ? (x.size.label === 'exact' ? t('Exact') : t(cap(x.size.label))) + ' · ' + fmtVol(x.size.ml) : ''; }
function lastSize(type, exceptId) {
  var s = sorted().slice().reverse();
  for (var i = 0; i < s.length; i++) if (s[i].type === type && s[i].size && s[i].id !== exceptId) return s[i].size.ml;
  return null;
}
function sleptText(x) {
  var periods = sleep.periods;
  for (var i = 0; i < periods.length; i++) if (periods[i][1] === x.t && !periods[i][2]) return t('Slept {d}', { d: fmtDur(periods[i][1] - periods[i][0]) });
  return '';
}
function detailParts(x, g) {
  var p = [];
  if (x.type === 'drink' && x.kind) p.push(t(labelOf(KINDS, x.kind)));
  if (x.size) p.push(sizeText(x));
  p.push(gapLine(x, g));
  if (x.type === 'solid' && x.bristol) p.push(t('Bristol {n}', { n: x.bristol }));
  if (x.urgency && x.urgency !== 'none') p.push(urgText(x.urgency));
  if (x.note) p.push('note');
  return p;
}

function urgText(u) { return t('urgency: {u}', { u: low(t(labelOf(URG, u))) }); }
function buildOptions(box, list, current, onPick) {
  box.textContent = '';
  list.forEach(function (u) {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'opt'; b.textContent = t(u[1]);
    b.setAttribute('aria-pressed', current === u[0] ? 'true' : 'false');
    b.addEventListener('click', function () {
      var e = find(sheetId); if (!e) return;
      onPick(e, u[0]); save();
      Array.prototype.forEach.call(box.children, function (c, i) { c.setAttribute('aria-pressed', onPick.current(e) === list[i][0] ? 'true' : 'false'); });
      renderList();
    });
    box.appendChild(b);
  });
}
function toggler(field, linked) {
  var f = function (e, v) {
    var clear = e[field] === v, mate = linked ? partner(e) : null;
    [e, mate].forEach(function (x) { if (!x) return; if (clear) delete x[field]; else x[field] = v; });
  };
  f.current = function (e) { return e[field]; };
  return f;
}

function openSheet(entry, keepTime) {
  hideBar();
  sheetId = entry.id;
  var sl = isSleep(entry), solid = entry.type === 'solid', label = name(entry.type), g = (gaps()[entry.id]) || {};
  var tv = { what: label, time: fmtTime(entry.t) };
  $('sheetTitle').textContent = entry.type === 'pass' && isNight(entry.t) ? t('{what} at {time} (night)', tv) : t('{what} at {time}', tv);
  var info = [];
  if (sl) { var sp = entry.type === 'wake' ? sleptText(entry) : ''; if (sp) info.push(sp); }
  else {
    info = detailParts(entry, g).filter(function (q) { return q !== 'note'; });
    if (entry.type === 'pass' && g.drink !== null && g.drink < DAY) info.push(t('{d} after last drink', { d: fmtDur(g.drink) }));
  }
  $('sheetInfo').textContent = info.join(' · '); $('sheetInfo').hidden = !info.length;

  var hasUrg = entry.type === 'pass' || solid;
  $('sizeSec').hidden = sl || solid; $('kindSec').hidden = entry.type !== 'drink' || !settings.showKind;
  $('urgSec').hidden = !hasUrg || !settings.showUrgency; $('bristolSec').hidden = !solid || !settings.showBristol; $('noteSec').hidden = sl;
  $('timeRow').hidden = !keepTime; $('timeInput').value = toLocalInput(entry.t);
  if (!sl && !solid) {
    $('presets').hidden = false; $('exactToggle').hidden = false; $('exactRow').hidden = true;
    var box = $('presets'); box.textContent = '';
    PRESETS[entry.type].forEach(function (p) {
      var b = document.createElement('button'); b.type = 'button';
      b.setAttribute('aria-pressed', entry.size && entry.size.label === p[0].toLowerCase() ? 'true' : 'false');
      b.appendChild(document.createTextNode(t(p[0])));
      var sm = document.createElement('small'); sm.textContent = fmtVol(p[1]); b.appendChild(sm);
      b.addEventListener('click', function () { setSize(p[0].toLowerCase(), p[1]); });
      box.appendChild(b);
    });
    $('exactUnit').textContent = settings.unit === 'oz' ? 'fl oz' : 'ml'; $('exactInput').value = '';
    if (entry.type === 'drink' && settings.showKind) buildOptions($('kindBtns'), KINDS, entry.kind, toggler('kind'));
  }
  if (hasUrg && settings.showUrgency) buildOptions($('urgBtns'), URG, entry.urgency, toggler('urgency', true));
  if (solid && settings.showBristol) buildOptions($('bristolBtns'), BRISTOL, entry.bristol, toggler('bristol'));
  if (!sl) {
    $('noteInput').value = entry.note || '';
    $('noteRow').hidden = !entry.note; $('noteToggleText').textContent = entry.note ? t('Edit note') : t('Add a note');
  }
  $('sheetRemove').hidden = false;
  if ($('sheet').hidden) openDialog('sheet');
}
function hideSheet() { flushNote(); closeDialog('sheet'); }
function closeSheet() { settleInside('sheet'); sheetId = null; render(); hideSheet(); }
function setSize(label, ml) {
  var e = find(sheetId); if (!e) return;
  e.size = { label: label, ml: ml }; save(); render(); openSheet(e);
}

// slim confirmation bar
function hideBar() { clearTimeout(barTimer); barId = null; barRestore = null; $('barMore').hidden = false; $('bar').hidden = true; }
function armBar(ms) { clearTimeout(barTimer); barTimer = setTimeout(hideBar, ms); }
function lastKind(exceptId) {
  var q = sorted().slice().reverse();
  for (var i = 0; i < q.length; i++) if (q[i].type === 'drink' && q[i].kind && q[i].id !== exceptId) return q[i].kind;
  return null;
}
function partner(e) { if (!e) return null; if (e.withSolid) return find(e.withSolid); if (e.withPass) return find(e.withPass); return null; }
function whatMode(e) { if (e.type === 'solid') return 'solid'; return (e.withSolid && find(e.withSolid)) ? 'both' : 'water'; }
function rowsAsked(e) {
  var r = []; if (isSleep(e)) return r;
  var m = (e.type === 'pass' || e.type === 'solid') ? whatMode(e) : null;
  if (m === 'solid') { if (settings.showUrgency) r.push('urg'); if (settings.showBristol) r.push('bristol'); return r; }
  if (settings.askSize !== false) r.push('size');
  if (e.type === 'drink' && settings.showKind) r.push('kind');
  if (e.type === 'pass' && settings.showUrgency) r.push('urg');
  if (m === 'both' && settings.showBristol) r.push('bristol');
  return r;
}
function bristolOf(e) { var t = e.type === 'solid' ? e : partner(e); return t ? t.bristol : undefined; }
function answered(e, k) { return k === 'size' ? !!e.size : k === 'kind' ? !!e.kind : k === 'bristol' ? !!bristolOf(e) : !!e.urgency; }
function barSummary(e) {
  var p = [];
  if (e.size) p.push(sizeText(e));
  if (e.kind) p.push(t(labelOf(KINDS, e.kind)));
  if (bristolOf(e)) p.push(t('Bristol {n}', { n: bristolOf(e) }));
  if (e.urgency) p.push(t(labelOf(URG, e.urgency)));
  return p.join(' · ');
}
function checkBar(e, first) {
  var asked = rowsAsked(e);
  if (!asked.length) { armBar(4000); return; }
  var all = asked.every(function (k) { return answered(e, k); });
  if (all && !first) { $('barMsg').textContent = t('Saved') + ' · ' + barSummary(e); armBar(1500); }
  else armBar(all ? 3000 : 10000);
}
function barGrid(cls) { var g = document.createElement('div'); g.className = 'barchips' + (cls ? ' ' + cls : ''); return g; }
function sizeRow(entry) {
  var grid = barGrid(), lm = lastSize(entry.type, entry.id);
  var list = PRESETS[entry.type].map(function (p) { return { label: p[0].toLowerCase(), name: t(p[0]), ml: p[1], last: lm !== null && Math.round(lm) === p[1] }; });
  if (lm !== null && !list.some(function (x) { return x.last; })) list.push({ label: 'exact', name: t('Last'), ml: lm, last: true });
  grid.style.gridTemplateColumns = 'repeat(' + list.length + ', minmax(0, 1fr))';
  function paint() {
    var e = find(barId);
    Array.prototype.forEach.call(grid.children, function (b, i) {
      b.setAttribute('aria-pressed', e && e.size && Math.round(e.size.ml) === Math.round(list[i].ml) ? 'true' : 'false');
    });
  }
  list.forEach(function (c) {
    var b = document.createElement('button'); b.type = 'button';
    b.appendChild(document.createTextNode(c.name));
    var sm = document.createElement('small'); sm.appendChild(document.createTextNode(' '));
    if (c.last) sm.appendChild(svgIcon('i-repeat', 11));
    sm.appendChild(document.createTextNode(fmtVol(c.ml))); b.appendChild(sm);
    if (c.last) b.setAttribute('aria-label', t('{name}, {vol}, same as last time', { name: c.name, vol: fmtVol(c.ml) }));
    b.addEventListener('click', function () {
      var e = find(barId); if (!e) return;
      e.size = { label: c.label, ml: c.ml }; save(); render(); paint(); checkBar(e, false);
    });
    grid.appendChild(b);
  });
  paint(); return grid;
}
function optRow(label, list, field, entry, cols, targets) {
  var wrap = document.createElement('div'), l = document.createElement('div'); l.className = 'barl'; l.textContent = label;
  var grid = barGrid('opts'); grid.style.gridTemplateColumns = 'repeat(' + (cols || 4) + ', minmax(0, 1fr))';
  function tg() { if (targets) return targets().filter(Boolean); var e = find(barId); return e ? [e] : []; }
  function paint() { var t = tg()[0]; Array.prototype.forEach.call(grid.children, function (b, i) { b.setAttribute('aria-pressed', t && t[field] === list[i][0] ? 'true' : 'false'); }); }
  list.forEach(function (u) {
    var b = document.createElement('button'); b.type = 'button'; b.textContent = t(u[1]);
    b.addEventListener('click', function () {
      var es = tg(); if (!es.length) return;
      var clear = es[0][field] === u[0];
      es.forEach(function (x) { if (clear) delete x[field]; else x[field] = u[0]; });
      save(); renderList(); paint(); var e = find(barId); if (e) checkBar(e, false);
    });
    grid.appendChild(b);
  });
  paint(); wrap.appendChild(l); wrap.appendChild(grid); return wrap;
}
function setWhat(mode) {
  var e = find(barId); if (!e) return;
  var cur = whatMode(e); if (cur === mode) return;
  var br = e.bristol, pbr;
  if (cur === 'both') { var ps = find(e.withSolid); if (ps) { pbr = ps.bristol; log = log.filter(function (x) { return x.id !== ps.id; }); } delete e.withSolid; }
  if (mode === 'solid') { if (e.size) { barStash = e.size; delete e.size; } e.type = 'solid'; if (pbr) e.bristol = pbr; }
  else if (cur === 'solid') { e.type = 'pass'; if (barStash) e.size = barStash; delete e.bristol; }
  if (mode === 'both') {
    var ns = { id: e.id + '-s', type: 'solid', t: e.t, withPass: e.id };
    if (e.urgency) ns.urgency = e.urgency; if (cur === 'solid' && br) ns.bristol = br;
    log.push(ns); e.withSolid = ns.id;
  }
  save(); render(); showBar(e, true);
}
function whatRow() {
  var wrap = document.createElement('div'), l = document.createElement('div'); l.className = 'barl'; l.textContent = t('What passed');
  var grid = barGrid('opts'); grid.style.gridTemplateColumns = 'repeat(3, minmax(0, 1fr))';
  var modes = [['water', t('passed|Water')], ['solid', t('Solid')], ['both', t('Both')]];
  function paint() { var e = find(barId), m = e ? whatMode(e) : 'water'; Array.prototype.forEach.call(grid.children, function (b, i) { b.setAttribute('aria-pressed', modes[i][0] === m ? 'true' : 'false'); }); }
  modes.forEach(function (q) { var b = document.createElement('button'); b.type = 'button'; b.textContent = q[1]; b.addEventListener('click', function () { setWhat(q[0]); }); grid.appendChild(b); });
  paint(); wrap.appendChild(l); wrap.appendChild(grid); return wrap;
}
function showBar(entry, rebuilt) {
  barId = entry.id; barRestore = null; $('barMore').hidden = false;
  var asked = rowsAsked(entry), rows = $('barRows'); rows.textContent = '';
  if (!rebuilt && entry.type === 'drink' && settings.showKind && !entry.kind) { var lk = lastKind(entry.id); if (lk) { entry.kind = lk; save(); renderList(); } }
  var m = (entry.type === 'pass' || entry.type === 'solid') ? whatMode(entry) : null;
  $('barMsg').textContent = t('{what} logged · {time}', { what: m === 'both' ? t('Pass and solid') : name(entry.type), time: fmtTime(entry.t) });
  if (settings.trackSolid && m) rows.appendChild(whatRow());
  if (asked.indexOf('size') > -1) rows.appendChild(sizeRow(entry));
  if (asked.indexOf('kind') > -1) rows.appendChild(optRow(t('Type'), KINDS_SHORT, 'kind', entry));
  if (asked.indexOf('urg') > -1) rows.appendChild(optRow(t('Urgency'), URG, 'urgency', entry, 4, m === 'both' ? function () { return [find(barId), partner(find(barId))]; } : null));
  if (asked.indexOf('bristol') > -1) rows.appendChild(optRow(t('Stool type (Bristol 1 to 7)'), BRISTOL, 'bristol', entry, 7, m === 'both' ? function () { return [partner(find(barId))]; } : null));
  $('bar').hidden = false;
  checkBar(entry, true);
}

function showRemovedBar(e, mate) {
  barId = null; barRestore = { entry: e, partner: mate }; $('barRows').textContent = '';
  $('barMsg').textContent = t('Removed · {what} at {time}', { what: mate ? t('Pass and solid') : name(e.type), time: fmtTime(e.t) }); $('barMore').hidden = true;
  $('bar').hidden = false; armBar(6000);
}
function sum(a) { var t = 0, c = 0; a.forEach(function (x) { if (x.size) { t += x.size.ml; c++; } }); return [t, c]; }
function renderStats() {
  var s = sorted();
  var ld = s.filter(function (x) { return x.type === 'drink'; }).pop();
  var lp = s.filter(function (x) { return x.type === 'pass'; }).pop();
  $('drinkSub').textContent = ld ? cap(agoText(ld.t)) : t('Not yet');
  $('passSub').textContent = lp ? cap(agoText(lp.t)) : t('Not yet');
  $('todayStrip').hidden = settings.showToday === false;
  var today = startOfDay(Date.now()), td = s.filter(function (x) { return x.t >= today; });
  var tin = sum(td.filter(function (x) { return x.type === 'drink'; })), passes = td.filter(function (x) { return x.type === 'pass'; }), tout = sum(passes);
  $('tdIn').textContent = tin[1] ? fmtVol(tin[0]) : '–';
  $('tdOut').textContent = tout[1] ? fmtVol(tout[0]) : '–';
  $('tdPasses').textContent = passes.length.toLocaleString(currentLocale());
  $('tdSince').textContent = lp ? fmtDur(Math.max(0, Date.now() - lp.t)) : '–';
}

var ROW_H = 56, MORE_H = 46;
function fmtWhen(ms) {
  var tm = fmtTime(ms);
  return startOfDay(ms) === startOfDay(Date.now()) ? tm : fmtDate(ms, { weekday: 'short' }) + ' ' + tm;
}
function buildRow(x, info, withDay) {
  var sl = isSleep(x);
  var b = document.createElement('button'); b.type = 'button'; b.className = 'row';
  var mk = document.createElement('span'); mk.className = 'mark';
  if (sl) mk.appendChild(svgIcon(x.type === 'bed' ? 'i-moon' : 'i-sun', 14));
  else { var dot = document.createElement('span'); dot.className = 'dot ' + x.type + (x.size || x.type === 'solid' ? '' : ' ns'); mk.appendChild(dot); }
  var tm = document.createElement('span'); tm.className = 'time'; tm.textContent = withDay ? fmtWhen(x.t) : fmtTime(x.t);
  var wh = document.createElement('span'); wh.className = 'what' + (sl ? ' soft' : '');
  wh.appendChild(document.createTextNode(x.type === 'pass' ? nightly(name(x.type), x.t) : name(x.type)));
  function tag(txt) { var sp = document.createElement('span'); sp.className = 'tag'; sp.textContent = txt; wh.appendChild(sp); }
  if (x.type === 'drink' && x.kind) tag(t(labelOf(KINDS, x.kind)));
  if ((x.type === 'pass' || x.type === 'solid') && x.urgency && x.urgency !== 'none') tag(t(labelOf(URG, x.urgency)));
  if (x.type === 'solid' && x.bristol) tag(t('Bristol {n}', { n: x.bristol }));
  if (x.note) tag(t('Note'));
  var sm = null;
  if (sl) { var st = x.type === 'wake' ? sleptText(x) : ''; if (st) { sm = document.createElement('small'); sm.textContent = st; } }
  else {
    sm = document.createElement('small');
    if (x.type === 'solid') sm.textContent = gapLine(x, info[x.id]);
    else if (x.size) sm.textContent = sizeText(x) + ' · ' + gapLine(x, info[x.id]);
    else { var a = document.createElement('span'); a.className = 'addsize'; a.textContent = t('Add size'); sm.appendChild(a); sm.appendChild(document.createTextNode(' · ' + gapLine(x, info[x.id]))); }
  }
  if (sm) wh.appendChild(sm);
  b.appendChild(mk); b.appendChild(tm); b.appendChild(wh);
  b.setAttribute('data-id', x.id);
  b.addEventListener('click', function () { openSheet(x); });
  return b;
}
function renderLatest() {
  var wrap = $('list'), s = sorted().slice().reverse(), info = gaps();
  var today = startOfDay(Date.now());
  $('todayCount').textContent = t('{n} today', { n: s.filter(function (x) { return x.t >= today; }).length });
  wrap.textContent = '';
  if (!s.length) {
    var e = document.createElement('div'); e.className = 'empty';
    e.textContent = t('Tap a button when it happens. We work out the time between drinks and passes for you.');
    wrap.appendChild(e); return;
  }
  var h = wrap.clientHeight, n = Math.max(2, Math.min(5, Math.floor((h - MORE_H) / ROW_H)));
  s.slice(0, n).forEach(function (x) { wrap.appendChild(buildRow(x, info, true)); });
  var m = document.createElement('button'); m.type = 'button'; m.className = 'more';
  m.appendChild(document.createTextNode(tn(s.length, '{n} entry', 'All {n} entries'))); m.appendChild(svgIcon('i-right', 16));
  m.addEventListener('click', function () { dayOffset = 0; renderLog(); showOverlay('logSheet'); });
  wrap.appendChild(m);
}
function renderLog() {
  var r = dayRange(dayOffset), s = sorted(), info = gaps();
  var day = between(s, r[0], r[1]);
  $('dayLabel').textContent = dayOffset === 0 ? t('Today') : dayOffset === -1 ? t('Yesterday')
    : fmtDate(r[0], { weekday: 'long', day: 'numeric', month: 'short' });
  $('next').disabled = dayOffset >= 0;
  var wrap = $('logList'); wrap.textContent = '';
  if (!day.length) { var e = document.createElement('div'); e.className = 'empty'; e.textContent = t('Nothing was logged on this day.'); wrap.appendChild(e); return; }
  day.slice().reverse().forEach(function (x) { wrap.appendChild(buildRow(x, info, false)); });
}
function renderList() { renderLatest(); if (!$('logSheet').hidden) renderLog(); }

/** Runs of night slots as [first, end) indexes; `at(k)` gives the moment to test for slot k. */
function nightSegments(at, count) {
  var segs = [], cur = null;
  for (var k = 0; k < count; k++) {
    var n = isNight(at(k));
    if (n && cur === null) cur = k;
    if (!n && cur !== null) { segs.push([cur, k]); cur = null; }
  }
  if (cur !== null) segs.push([cur, count]);
  return segs;
}
function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; }
function signed(n, f) { return n === 0 ? t('same') : (n > 0 ? '+' : '−') + f(Math.abs(n)); }
function periodStats(a, b) { return periodStatsOf(sorted(), a, b, isNight); }
function tile(label, wide) { var t = el('div', 'tile' + (wide ? ' wide' : '')); t.appendChild(el('div', 'l', label)); return t; }
// Progress: how each measure moved from the first logged week to the last. Changes are named, never judged.
var progressOpen = null;
function pct(v) { return new Intl.NumberFormat(currentLocale(), { style: 'percent', maximumFractionDigits: 0 }).format(v / 100); }
var TRENDS = [
  { key: 'gap', label: k('Typical gap'), cls: 'c-pass', fmt: function (v) { return fmtDur(v); }, eps: 5 * 60000, up: k('gap|longer'), down: k('gap|shorter') },
  { key: 'size', label: k('Average size'), cls: 'c-pass', fmt: function (v) { return fmtVol(v); }, eps: 10, up: k('size|larger'), down: k('size|smaller') },
  { key: 'night', label: k('Night passes, per night'), cls: 'c-ink', fmt: function (v) { return num(v); }, eps: 0.25, zero: true, up: k('night|more'), down: k('night|fewer') },
  { key: 'urgent', label: k('Strong or couldn’t wait'), cls: 'c-urg', fmt: pct, eps: 5, zero: true, up: k('urgency|more often'), down: k('urgency|less often') },
  { key: 'intake', label: k('Drinks a day'), cls: 'c-drink', fmt: function (v) { return fmtVol(v); }, eps: 100, up: k('drinks|more'), down: k('drinks|less') }
];
function svgEl(tag, attrs, parent) {
  var e = document.createElementNS(NS, tag);
  Object.keys(attrs).forEach(function (a) { e.setAttribute(a, attrs[a]); });
  if (parent) parent.appendChild(e);
  return e;
}
/** Daily dots and the 7-day median line; `big` adds the middle-half band, value lines and dates. */
function trendSvg(series, m, w, h, big) {
  var roll = rolling(series, m.key), n = series.length, padX = big ? 6 : 3, top = big ? 14 : 3, bottom = big ? 18 : 3;
  var vals = [];
  series.forEach(function (r, i) { if (r[m.key] !== null) vals.push(r[m.key]); if (big && roll[i]) vals.push(roll[i].lo, roll[i].hi); });
  var lo = m.zero ? 0 : Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
  if (hi - lo < m.eps * 2) { hi += m.eps; lo = m.zero ? 0 : lo - m.eps; }
  var x = function (i) { return n > 1 ? padX + i / (n - 1) * (w - 2 * padX) : w / 2; }, y = function (v) { return top + (1 - (v - lo) / (hi - lo)) * (h - top - bottom); };
  var svg = svgEl('svg', { viewBox: '0 0 ' + w + ' ' + h, class: 'ptr ' + m.cls + (big ? ' big' : ''), 'aria-hidden': 'true' }), dx = n > 1 ? (w - 2 * padX) / (n - 1) : 6;
  series.forEach(function (r, i) { if (!r.logged) svgEl('rect', { class: 'pun', x: (x(i) - dx / 2).toFixed(1), y: top, width: Math.max(1, dx).toFixed(1), height: h - top - bottom }, svg); });
  if (big) [lo, (lo + hi) / 2, hi].forEach(function (v) { svgEl('line', { class: 'pgrid', x1: padX, x2: w - padX, y1: y(v).toFixed(1), y2: y(v).toFixed(1) }, svg); });
  // The line and band break after three days in a row without a value, so a gap in the diary isn't bridged.
  var segs = [], cur = null, miss = 0;
  roll.forEach(function (p, i) {
    if (!p) { miss++; return; }
    if (!cur || miss >= 3) { cur = []; segs.push(cur); }
    miss = 0; cur.push([x(i), p]);
  });
  segs.forEach(function (sg) {
    if (big && sg.length > 1) svgEl('path', { class: 'pb', d: 'M' + sg.map(function (q) { return q[0].toFixed(1) + ' ' + y(q[1].hi).toFixed(1); }).join(' L') + ' L' + sg.slice().reverse().map(function (q) { return q[0].toFixed(1) + ' ' + y(q[1].lo).toFixed(1); }).join(' L') + ' Z' }, svg);
  });
  series.forEach(function (r, i) { if (r[m.key] !== null) svgEl('circle', { class: 'pd', cx: x(i).toFixed(1), cy: y(r[m.key]).toFixed(1), r: big ? 2.4 : 1.8 }, svg); });
  segs.forEach(function (sg) { svgEl('path', { class: 'pl', d: 'M' + sg.map(function (q) { return q[0].toFixed(1) + ' ' + y(q[1].med).toFixed(1); }).join(' L') }, svg); });
  if (big) {
    [lo, (lo + hi) / 2, hi].forEach(function (v) { svgEl('text', { class: 'pax', x: padX, y: (y(v) - 3).toFixed(1) }, svg).textContent = m.fmt(v); });
    [0, 1, 2, 3].forEach(function (j) {
      var i = Math.round(j * (n - 1) / 3);
      svgEl('text', { class: 'pax', x: x(i).toFixed(1), y: h - 4, 'text-anchor': j === 0 ? 'start' : j === 3 ? 'end' : 'middle' }, svg).textContent = fmtDate(series[i].start, { day: 'numeric', month: 'short' });
    });
  }
  return svg;
}
function renderProgress(tiles, section, series) {
  var logged = series.filter(function (r) { return r.logged; }).length, rows = [];
  TRENDS.forEach(function (m) { var e = trendEnds(series, m.key); if (e) rows.push({ m: m, e: e }); });
  var box = el('div', 'tile wide prog');
  if (logged < 10) {
    section(t('Progress'), 'var(--ink)', '');
    box.appendChild(el('div', 'sub', tn(10 - logged, 'Log on {n} more day to see how things change.', 'Log on {n} more days to see how things change.')));
    tiles.appendChild(box); return;
  }
  if (!rows.length) return;
  section(t('Progress'), 'var(--ink)', t('first vs last {n} logged days', { n: Math.max.apply(null, rows.map(function (r) { return r.e.n; })) }));
  rows.forEach(function (row) {
    var m = row.m, e = row.e, open = progressOpen === m.key, id = 'pdet-' + m.key;
    var word = Math.abs(e.last - e.first) < m.eps ? t('steady') : t(e.last > e.first ? m.up : m.down);
    var b = el('button', 'prow'); b.type = 'button'; b.setAttribute('aria-expanded', open ? 'true' : 'false'); b.setAttribute('aria-controls', id);
    b.appendChild(el('span', 'plab', t(m.label))); b.appendChild(el('span', 'pword', word));
    var val = el('span', 'pval'); val.appendChild(el('span', '', m.fmt(e.first))); val.appendChild(document.createTextNode(' → ')); val.appendChild(el('span', '', m.fmt(e.last)));
    b.appendChild(val); b.appendChild(trendSvg(series, m, 104, 34, false));
    var det = el('div', 'pdet'); det.id = id; det.hidden = !open;
    if (open) {
      var big = trendSvg(series, m, 320, 140, true); big.setAttribute('role', 'img'); big.removeAttribute('aria-hidden');
      big.setAttribute('aria-label', t('{what} each day, with a 7-day median line', { what: t(m.label) }));
      det.appendChild(big);
      var lg = el('div', 'legend plg');
      [['pdk', t('Each day')], ['plk', t('7-day median')], ['pbk', t('Middle half of days')], ['puk', t('Not logged')]].forEach(function (q) { var sp = el('span'); sp.appendChild(el('i', q[0] + ' ' + m.cls)); sp.appendChild(document.createTextNode(q[1])); lg.appendChild(sp); });
      det.appendChild(lg);
    }
    b.addEventListener('click', function () { progressOpen = open ? null : m.key; renderInsights(); var again = document.querySelector('[aria-controls="' + id + '"]'); if (again) again.focus(); });
    box.appendChild(b); box.appendChild(det);
  });
  box.appendChild(el('div', 'sub', t('Dots: each logged day. Line: the median of the last 7 days. Shaded: not logged.')));
  tiles.appendChild(box);
}
function renderInsights() {
  each('[data-range]', function (c) { c.setAttribute('aria-pressed', +c.getAttribute('data-range') === rangeDays ? 'true' : 'false'); });
  var plot = $('plot'), lab = $('dayLabels'), tl = $('tlLab'), s = sorted();
  plot.textContent = ''; lab.textContent = ''; tl.textContent = '';
  // All runs from the first entry, up to a year. The day-by-day charts don't fit that many days, so they're left out.
  var all = rangeDays === 0, span = all ? Math.min(366, Math.max(1, 1 - (s.length ? dayOffsetOf(s[0].t) : 0))) : rangeDays;
  $('hero').hidden = all;
  var amount = settings.dotScale === 'amount' && rangeDays && rangeDays <= 7, anyNoSize = false, seriesDays = [];
  var solidLane = settings.trackSolid || s.some(function (x) { return x.type === 'solid'; });
  var rangeItems = [], passes = [], passFlags = [], vols = [], nightPasses = 0, withData = 0, inMl = 0, inC = 0, outMl = 0, outC = 0, dayIn = [], dayOut = [], dayPasses = [];
  function mk(x, cls, left, cy, base) {
    var size = (x.size && amount) ? Math.max(5, Math.min(solidLane ? 9 : 13, Math.round(5 + x.size.ml / 400 * 7))) : base;
    var noSize = !x.size && x.type !== 'solid';
    if (noSize) anyNoSize = true;
    var d = document.createElement('button'); d.type = 'button'; d.className = 'd ' + cls + (noSize ? ' ns' : '');
    d.setAttribute('data-id', x.id);
    d.setAttribute('aria-label', t('{what} at {time}', { what: name(x.type), time: fmtTime(x.t) }) + (x.size ? ', ' + fmtVol(x.size.ml) : (x.type === 'solid' ? '' : ', ' + t('no size'))) + '. ' + t('Open details'));
    d.addEventListener('click', function () { openSheet(x); });
    d.style.width = d.style.height = size + 'px'; d.style.marginLeft = (-size / 2) + 'px'; d.style.left = left + '%'; d.style.top = (cy - size / 2) + 'px';
    plot.appendChild(d); return d;
  }
  if (rangeDays === 1) {
    var now = Date.now(), start = now - DAY, step = 10 * 60000, count = 144;
    lab.style.display = 'none'; $('axis').hidden = true; tl.hidden = false; plot.style.height = '84px';
    nightSegments(function (k) { return start + k * step + step / 2; }, count).forEach(function (sg) {
      var d = document.createElement('div'); d.className = 'nb';
      d.style.left = (sg[0] / count * 100) + '%'; d.style.width = ((sg[1] - sg[0]) / count * 100) + '%'; d.style.top = '0'; d.style.height = '100%'; plot.appendChild(d);
    });
    var items = between(s, start, now + 1);
    rangeItems = items.filter(function (x) { return !isSleep(x); });
    items.forEach(function (x) {
      var pos = Math.max(1, Math.min(99, (x.t - start) / DAY * 100));
      if (isSleep(x)) { var tk = document.createElement('div'); tk.className = 'tick'; tk.style.left = pos + '%'; plot.appendChild(tk); return; }
      mk(x, x.type, pos, solidLane ? (x.type === 'drink' ? 16 : x.type === 'solid' ? 42 : 68) : (x.type === 'drink' ? 22 : 62), 10);
      if (x.type === 'pass') { passes.push(x.t); var nn = isNight(x.t); passFlags.push(nn); if (nn) nightPasses++; if (x.size) { vols.push(x.size.ml); outMl += x.size.ml; outC++; } }
      else if (x.type === 'drink' && x.size) { inMl += x.size.ml; inC++; }
    });
    function label(txt, pos) { var sp = document.createElement('span'); sp.textContent = txt; sp.style.left = pos + '%'; tl.appendChild(sp); }
    label(t('24 h ago'), 7); label(t('Now'), 95);
    // Step through local whole hours, which aren't whole UTC hours in zones like India or Newfoundland.
    for (var dt = new Date(start); dt.setMinutes(60, 0, 0) < now;) {
      if (dt.getHours() % 6 === 0) { var ps = (dt.getTime() - start) / DAY * 100; if (ps > 20 && ps < 85) label(fmtHour(dt.getHours(), settings.clock), ps); }
    }
  } else {
    lab.style.display = ''; $('axis').hidden = false; fillAxis($('axis')); tl.hidden = true;
    var rowH = rangeDays <= 7 ? 28 : rangeDays <= 14 ? 18 : 12;
    var base = rangeDays <= 7 ? (solidLane ? 7 : 8) : rangeDays <= 14 ? (solidLane ? 5 : 6) : (solidLane ? 3 : 4);
    var cD = solidLane ? (rangeDays <= 7 ? 6 : rangeDays <= 14 ? 3 : 2) : (rangeDays <= 7 ? 8 : rangeDays <= 14 ? 5 : 3.5);
    var cS = rangeDays <= 7 ? 14 : rangeDays <= 14 ? 9 : 6;
    var cP = solidLane ? (rangeDays <= 7 ? 22 : rangeDays <= 14 ? 15 : 10) : (rangeDays <= 7 ? 20 : rangeDays <= 14 ? 13 : 8.5);
    plot.style.height = (rangeDays * rowH) + 'px'; lab.style.height = (rangeDays * rowH) + 'px';
    var firstStart = null;
    for (var i = 0; i < span; i++) {
      (function (i) {
        var off = -(span - 1 - i), r = dayRange(off), ds = r[0];
        if (i === 0) firstStart = ds;
        var items = between(s, r[0], r[1]).filter(function (x) { return !isSleep(x); });
        seriesDays.push({ start: ds, items: items });
        if (items.length) withData++;
        Array.prototype.push.apply(rangeItems, items);
        var dp = items.filter(function (x) { return x.type === 'pass'; });
        var si = sum(items.filter(function (x) { return x.type === 'drink'; })), so = sum(dp);
        dayIn.push(si[0]); dayOut.push(so[0]); if (si[1]) inC++; if (so[1]) outC++;
        dayPasses.push({ start: ds, n: dp.length, night: dp.filter(function (x) { return isNight(x.t); }).length, solid: items.some(function (x) { return x.type === 'solid'; }) });
        if (all) return;
        var l = document.createElement('div'); l.style.height = rowH + 'px'; l.style.lineHeight = rowH + 'px';
        var showLab = rangeDays <= 14 || i % 5 === 0 || off === 0;
        l.textContent = !showLab ? '' : off === 0 ? t('Today') : rangeDays <= 7 ? fmtDate(ds, { weekday: 'short' }) : fmtDate(ds, { day: 'numeric', month: 'short' });
        lab.appendChild(l);
        if (i > 0) { var ln = document.createElement('div'); ln.className = 'ln'; ln.style.top = (i * rowH) + 'px'; plot.appendChild(ln); }
        nightSegments(function (k) { return clockSlot(ds, k, 15); }, 96).forEach(function (sg) {
          var d = document.createElement('div'); d.className = 'nb';
          d.style.left = (sg[0] / 96 * 100) + '%'; d.style.width = ((sg[1] - sg[0]) / 96 * 100) + '%';
          d.style.top = (i * rowH) + 'px'; d.style.height = rowH + 'px'; plot.appendChild(d);
        });
        items.forEach(function (x) { mk(x, x.type, clockFraction(x.t) * 100, i * rowH + (x.type === 'drink' ? cD : x.type === 'solid' ? cS : cP), base); });
      })(i);
    }
    between(s, firstStart, Infinity).forEach(function (x) {
      if (x.type !== 'pass') return;
      passes.push(x.t); var nn = isNight(x.t); passFlags.push(nn); if (nn) nightPasses++; if (x.size) vols.push(x.size.ml);
    });
    inMl = dayIn.reduce(function (a, b) { return a + b; }, 0); outMl = dayOut.reduce(function (a, b) { return a + b; }, 0);
  }

  // legend
  var lg = $('legend'); lg.textContent = '';
  function li(cls, style, txt) { var sp = el('span'); var i = el('i', cls); if (style) i.style.cssText = style; sp.appendChild(i); sp.appendChild(document.createTextNode(txt)); lg.appendChild(sp); }
  li('', 'background:var(--drink)', t('Drink')); li('', 'background:var(--pass)', t('Pass')); if (solidLane) li('solidkey', '', t('Solid')); li('band', '', t('Night'));
  if (anyNoSize) li('ring', '', t('No size'));
  if (amount) { var sp2 = el('span'); [6, 9, 12].forEach(function (z) { var i = el('i'); i.style.cssText = 'background:var(--muted);width:' + z + 'px;height:' + z + 'px'; sp2.appendChild(i); }); sp2.appendChild(document.createTextNode(t('Bigger dot, bigger amount'))); lg.appendChild(sp2); }

  // Cards below the chart: drinks and output, passes, bowel.
  var tiles = $('tiles'); tiles.textContent = ''; var multi = all || rangeDays > 1;
  var gp = [];
  for (var k = 1; k < passes.length; k++) if (passes[k] - passes[k - 1] < DAY) gp.push(passes[k] - passes[k - 1]);
  var cmp = null;
  if (settings.compare && !all) {
    var nowT = Date.now(), curA = rangeDays === 1 ? nowT - DAY : dayRange(-(rangeDays - 1))[0];
    var prevA = rangeDays === 1 ? nowT - 2 * DAY : dayRange(-(2 * rangeDays - 1))[0], prevB = rangeDays === 1 ? nowT - DAY : curA;
    cmp = { cur: periodStats(curA, nowT + 1), prev: periodStats(prevA, prevB), vs: function (d) { return rangeDays === 1 ? t('{d} vs previous 24 h', { d: d }) : t('{d} vs previous {n} days', { d: d, n: rangeDays }); } };
  }
  function section(title, color, note) {
    var h = el('div', 'insh'), h3 = el('h3'), dot = el('i');
    dot.style.background = color; h3.appendChild(dot); h3.appendChild(document.createTextNode(title)); h.appendChild(h3);
    if (note) h.appendChild(el('span', '', note));
    tiles.appendChild(h);
  }
  /** Labelled horizontal bars: rows of [label, detail, count, colour]. */
  function barList(box, title, note, rows) {
    var blk = el('div', 'blist'), hd = el('div', 'blh');
    hd.appendChild(el('span', '', title)); if (note) hd.appendChild(el('b', '', note)); blk.appendChild(hd);
    var top = Math.max.apply(null, rows.map(function (r) { return r[2]; })) || 1;
    rows.forEach(function (r) {
      var row = el('div', 'brow'), lb = el('span', 'bl', r[0]);
      if (r[1]) lb.appendChild(el('small', '', r[1]));
      var tr = el('div', 'track'), f = el('i'); f.style.width = (r[2] / top * 100) + '%'; f.style.background = r[3]; tr.appendChild(f);
      row.appendChild(lb); row.appendChild(tr); row.appendChild(el('b', '', String(r[2]))); blk.appendChild(row);
    });
    box.appendChild(blk);
  }

  if (all || rangeDays >= 14) renderProgress(tiles, section, dailySeries(seriesDays, isNight));

  // Drinks and output. Per day averages over the days that have sizes, as in the clinician summary.
  section(t('Drinks and output'), 'var(--drink)', multi ? t('per day') : t('last 24 h'));
  var io = el('div', 'tile wide');
  var iv = inC ? (multi ? inMl / inC : inMl) : 0, ov = outC ? (multi ? outMl / outC : outMl) : 0, mx = Math.max(iv, ov);
  var KC = { water: '#1572b5', teacoffee: '#6aa6d6', alcohol: '#0b3d63', other: '#b9d3e8', na: '#d5dee3' };
  var kv = {}, kindMl = 0;
  rangeItems.forEach(function (x) { if (x.type !== 'drink' || !x.size) return; var key = x.kind && KC[x.kind] ? x.kind : 'na'; kv[key] = (kv[key] || 0) + x.size.ml; kindMl += x.size.ml; });
  var kinds = ['water', 'teacoffee', 'alcohol', 'other', 'na'].filter(function (q) { return kv[q]; });
  var split = kinds.length > 1 || (kinds.length === 1 && kinds[0] !== 'na');
  if (!mx) io.appendChild(el('div', 'empty2', t('Add sizes to your entries to see volumes.')));
  else {
    [[t('In'), iv, 'var(--drink)'], [t('Out'), ov, 'var(--pass)']].forEach(function (q, qi) {
      var row = el('div', 'io'); row.appendChild(el('span', 'k', q[0]));
      var tr = el('div', 'track'), f = el('div', 'fill'); f.style.width = (q[1] / mx * 100) + '%';
      if (qi === 0 && split) kinds.forEach(function (key) { var part = el('i'); part.style.width = (kv[key] / kindMl * 100) + '%'; part.style.background = KC[key]; f.appendChild(part); });
      else f.style.background = q[2];
      tr.appendChild(f); row.appendChild(tr);
      row.appendChild(el('span', 'v', q[1] ? fmtVol(q[1]) : '–')); io.appendChild(row);
    });
    if (split) {
      var kl = el('div', 'kinds');
      kinds.forEach(function (key) {
        var it = el('div'), sw = el('i'); sw.style.background = KC[key]; it.appendChild(sw);
        it.appendChild(document.createTextNode(key === 'na' ? t('Not recorded') : t(labelOf(KINDS, key))));
        it.appendChild(el('b', '', fmtVol(kv[key] / kindMl * iv))); kl.appendChild(it);
      });
      io.appendChild(kl);
      var irritant = (kv.teacoffee || 0) + (kv.alcohol || 0);
      if (irritant) io.appendChild(el('div', 'insnote', t('Tea, coffee and alcohol were {p}% of what you drank. Caffeine and alcohol can irritate the bladder.', { p: Math.round(irritant / kindMl * 100) })));
    }
  }
  function avgOf(ml, n) { return multi ? (n ? ml / n : 0) : ml; }
  if (cmp) {
    if (cmp.prev.outN || cmp.prev.inN) {
      var dv = { a: signed(avgOf(cmp.cur.inMl, cmp.cur.inN) - avgOf(cmp.prev.inMl, cmp.prev.inN), fmtVol), b: signed(avgOf(cmp.cur.outMl, cmp.cur.outN) - avgOf(cmp.prev.outMl, cmp.prev.outN), fmtVol), n: rangeDays };
      io.appendChild(el('div', 'sub', rangeDays === 1 ? t('In {a} · Out {b} vs previous 24 h', dv) : t('In {a} · Out {b} vs previous {n} days', dv)));
    }
    else io.appendChild(el('div', 'sub', t('No earlier data to compare.')));
  }
  tiles.appendChild(io);

  // Passes
  var passNote = !passes.length ? '' : multi
    ? t('{n} in {d} days', { n: passes.length, d: span }) + ' · ' + t('{n} a day', { n: num(passes.length / Math.max(1, withData)) })
    : t('{n} in 24 h', { n: passes.length });
  section(t('Passes'), 'var(--pass)', passNote);
  var gt = tile(t('Typical gap'));
  gt.appendChild(el('div', 'n', gp.length ? fmtDur(median(gp)) : '–'));
  if (gp.length) {
    var rec = gp.slice(-12), gmax = Math.max.apply(null, rec), sp = el('div', 'spark');
    rec.forEach(function (g) { var b = el('span'); b.style.height = Math.max(8, g / gmax * 100) + '%'; sp.appendChild(b); });
    var ml = el('i'); ml.style.bottom = (median(gp) / gmax * 100) + '%'; sp.appendChild(ml); gt.appendChild(sp);
    gt.appendChild(el('div', 'sub', t('Longest {d}', { d: fmtDur(Math.max.apply(null, gp)) })));
  }
  if (cmp && cmp.cur.med !== null && cmp.prev.med !== null) gt.appendChild(el('div', 'sub', cmp.vs(signed(cmp.cur.med - cmp.prev.med, fmtDur))));
  tiles.appendChild(gt);

  var nt = tile(multi ? t('Night passes, per night') : t('Night passes'));
  var nv = el('div', 'n');
  if (!passes.length) nv.textContent = '–';
  else if (multi) nv.textContent = t('{n} a night', { n: num(nightPasses / Math.max(1, withData)) });
  else { nv.appendChild(document.createTextNode(String(nightPasses) + ' ')); nv.appendChild(el('small', '', t('of {n}', { n: passes.length }))); }
  nt.appendChild(nv);
  if (passes.length && !multi && passes.length <= 12) {
    var ic = el('div', 'nicons'); passFlags.forEach(function (f) { ic.appendChild(svgIcon(f ? 'i-moon' : 'i-sun', 18, f ? '' : 'day')); }); nt.appendChild(ic);
  } else if (passes.length) {
    var nb = el('div', 'nbar'), nf = el('div'); nf.style.width = (nightPasses / passes.length * 100) + '%'; nb.appendChild(nf); nt.appendChild(nb);
    nt.appendChild(el('div', 'sub', t('{a} of {b} passes at night', { a: nightPasses, b: passes.length })));
  }
  if (cmp && cmp.prev.passes.length) nt.appendChild(el('div', 'sub', cmp.vs(signed(cmp.cur.night - cmp.prev.night, String))));
  tiles.appendChild(nt);

  var rangePasses = rangeItems.filter(function (x) { return x.type === 'pass'; });
  if (multi && !all && rangePasses.length) {
    var pd = tile(t('Passes each day'), true), key = el('span', 'pdkey');
    [['var(--pass)', t('Day')], ['var(--ink)', t('Night')]].forEach(function (q) { var sw = el('i'); sw.style.background = q[0]; key.appendChild(sw); key.appendChild(document.createTextNode(q[1])); });
    pd.firstChild.appendChild(key);
    var cols = el('div', 'pdays'), labs = el('div', 'pdlabs'), most = Math.max.apply(null, dayPasses.map(function (d) { return d.n; })) || 1;
    cols.style.setProperty('--n', dayPasses.length); labs.style.setProperty('--n', dayPasses.length);
    dayPasses.forEach(function (d, i) {
      var c = el('div', 'pday'), last = i === dayPasses.length - 1;
      c.setAttribute('role', 'img');
      c.setAttribute('aria-label', fmtDate(d.start, { weekday: 'long', day: 'numeric', month: 'long' }) + ': ' + tn(d.n, '{n} pass, {m} at night', '{n} passes, {m} at night', { m: d.night }));
      if (rangeDays <= 14 && d.n) c.appendChild(el('span', 'pn', String(d.n)));
      var bar = el('div', 'pbar' + (d.n ? '' : ' none')); bar.style.height = (d.n / most * 100) + '%';
      var nn = el('div', 'pnight'); nn.style.height = d.n ? (d.night / d.n * 100) + '%' : '0'; bar.appendChild(nn); c.appendChild(bar); cols.appendChild(c);
      var showLab = rangeDays <= 7 || last || (rangeDays <= 14 ? i % 2 === (dayPasses.length - 1) % 2 : (dayPasses.length - 1 - i) % 7 === 0);
      labs.appendChild(el('span', last ? 'today' : '', !showLab ? '' : last ? t('Today') : rangeDays <= 7 ? fmtDate(d.start, { weekday: 'short' }) : fmtDate(d.start, { day: 'numeric' })));
    });
    pd.appendChild(cols); pd.appendChild(labs); tiles.appendChild(pd);
  }

  if (rangePasses.length) {
    var su = el('div', 'tile wide');
    // Exact amounts fall into the nearest preset: small 100, medium 250, large 400 ml.
    var sc = { small: 0, medium: 0, large: 0, none: 0 };
    rangePasses.forEach(function (x) {
      if (!x.size) sc.none++;
      else if (sc[x.size.label] !== undefined && x.size.label !== 'none') sc[x.size.label]++;
      else sc[x.size.ml < 175 ? 'small' : x.size.ml < 325 ? 'medium' : 'large']++;
    });
    var about = function (i) { return t('about {v}', { v: fmtVol(PRESETS.pass[i][1]) }); };
    var sizeNote = vols.length ? t('Largest {a} · average {b}', { a: fmtVol(Math.max.apply(null, vols)), b: fmtVol(vols.reduce(function (a, b) { return a + b; }, 0) / vols.length) }) : '';
    var sizeRows = [[t('Small'), about(0), sc.small, '#ffe486'], [t('Medium'), about(1), sc.medium, 'var(--pass)'], [t('Large'), about(2), sc.large, '#b38e00']];
    if (sc.none) sizeRows.push([t('No size'), '', sc.none, '#c9d8e0']);
    barList(su, t('Size'), sizeNote, sizeRows);
    var uc = { none: 0, mild: 0, strong: 0, cantwait: 0, na: 0 };
    rangePasses.forEach(function (x) { uc[x.urgency && uc[x.urgency] !== undefined ? x.urgency : 'na']++; });
    if (settings.showUrgency || uc.na < rangePasses.length) {
      var rated = rangePasses.length - uc.na, urgent = uc.strong + uc.cantwait;
      var urgRows = [[t('None'), '', uc.none, '#c9d8e0'], [t('Mild'), '', uc.mild, 'var(--pass)'], [t('Strong'), '', uc.strong, '#b38e00'], [t('Couldn’t wait'), '', uc.cantwait, 'var(--danger)']];
      if (uc.na) urgRows.push([t('Not recorded'), '', uc.na, '#e3edf2']);
      barList(su, t('Urgency'), rated ? t('{a} of {b} strong or couldn’t wait', { a: urgent, b: rated }) : '', urgRows);
    }
    tiles.appendChild(su);
  }

  // Bowel
  var solidsR = rangeItems.filter(function (x) { return x.type === 'solid'; });
  if (settings.trackSolid || solidsR.length) {
    var lastSolid = s.filter(function (x) { return x.type === 'solid'; }).pop();
    section(t('Bowel'), 'var(--solid)', lastSolid ? t('Last {ago}', { ago: agoText(lastSolid.t) }) : '');
    var bw = el('div', 'tile wide');
    var top = el('div', 'bowtop'); top.appendChild(el('span', 'n', String(solidsR.length)));
    var bits = [];
    if (multi) bits.push(t('on {a} of {b} days', { a: dayPasses.filter(function (d) { return d.solid; }).length, b: span }));
    if (solidsR.length > 1) { var sgp = []; for (var q = 1; q < solidsR.length; q++) sgp.push(solidsR[q].t - solidsR[q - 1].t); bits.push(t('Typical gap {d}', { d: fmtDur(median(sgp)) })); }
    if (bits.length) top.appendChild(el('span', 'sub', bits.join(' · ')));
    bw.appendChild(top);
    if (multi && !all) {
      var wk = el('div', 'bdays' + (rangeDays > 7 ? ' many' : ''));
      wk.setAttribute('role', 'img');
      wk.setAttribute('aria-label', t('on {a} of {b} days', { a: dayPasses.filter(function (d) { return d.solid; }).length, b: rangeDays }));
      dayPasses.forEach(function (d, i) {
        var c = el('div'), dot = el('i', d.solid ? 'y' : ''); c.appendChild(dot);
        if (rangeDays <= 7) c.appendChild(document.createTextNode(i === dayPasses.length - 1 ? t('Today') : fmtDate(d.start, { weekday: 'short' })));
        if (i === dayPasses.length - 1) c.className = 'today';
        wk.appendChild(c);
      });
      bw.appendChild(wk);
    }
    var bc = [0, 0, 0, 0, 0, 0, 0, 0];
    solidsR.forEach(function (x) { if (x.bristol >= 1 && x.bristol <= 7) bc[x.bristol]++; else bc[0]++; });
    if (solidsR.length - bc[0] > 0) {
      bw.appendChild(el('div', 'blh', t('Stool type (Bristol 1 to 7)')));
      var BR = ['#e8d9cc', '#d9bfa8', '#c5a283', '#a98160', '#8a6a4f', '#6e533d', '#4f3b2b'], peak = Math.max.apply(null, bc.slice(1));
      var scale = el('div', 'bristol'), zone = el('div', 'bzone'); zone.appendChild(el('span', '', t('typical'))); scale.appendChild(zone);
      for (var z = 1; z <= 7; z++) {
        var col = el('div', 'bcol'), stack = el('div', 'bstack');
        col.setAttribute('aria-label', t('Type {z}: {n}', { z: z, n: bc[z] })); col.setAttribute('role', 'img');
        if (peak <= 4) for (var j = 0; j < bc[z]; j++) stack.appendChild(el('b'));
        else if (bc[z]) { var tall = el('b', 'tall'); tall.style.height = 'max(4px, calc(' + (bc[z] / peak * 100) + '% - 18px))'; stack.appendChild(el('span', 'bn', String(bc[z]))); stack.appendChild(tall); }
        col.appendChild(stack);
        var cell = el('div', 'bcell'); cell.style.background = BR[z - 1]; col.appendChild(cell); col.appendChild(el('span', 'bz', String(z)));
        scale.appendChild(col);
      }
      bw.appendChild(scale);
      var ends = el('div', 'bends'); ends.appendChild(el('span', '', t('hard'))); ends.appendChild(el('span', '', t('liquid'))); bw.appendChild(ends);
      if (bc[0]) bw.appendChild(el('div', 'sub', t('Not recorded: {n}', { n: bc[0] })));
    }
    if (cmp && cmp.prev.solids) bw.appendChild(el('div', 'sub', cmp.vs(signed(cmp.cur.solids - cmp.prev.solids, String))));
    tiles.appendChild(bw);
  }
}

function reportData() {
  var s = sorted(), out = [];
  for (var o = -(reportDays - 1); o <= 0; o++) {
    var r = dayRange(o);
    out.push({ start: r[0], items: between(s, r[0], r[1]) });
  }
  return out;
}
function fillAxis(ax) {
  ax.textContent = '';
  (settings.clock === '12' ? ['12a', '6a', '12p', '6p', '12a'] : ['00', '06', '12', '18', '24']).forEach(function (h) { ax.appendChild(el('span', '', h)); });
}
/** Everything the clinician summary shows, for the screen and for the PDF. */
function reportModel(data) {
  var solidLane = settings.trackSolid || log.some(function (x) { return x.type === 'solid'; });
  var legend = [{ key: 'drink', label: t('Drink') }, { key: 'pass', label: t('Pass') }];
  if (solidLane) legend.push({ key: 'solid', label: t('Solid') });
  legend.push({ key: 'night', label: t('Night') }, { key: 'ns', label: t('No size') });
  var chart = {
    solidLane: solidLane, legend: legend,
    axis: settings.clock === '12' ? ['12a', '6a', '12p', '6p', '12a'] : ['00', '06', '12', '18', '24'],
    days: data.map(function (d) {
      return {
        label: fmtDate(d.start, { weekday: 'short', day: 'numeric' }),
        night: nightSegments(function (k) { return clockSlot(d.start, k, 15); }, 96),
        dots: d.items.filter(function (x) { return !isSleep(x); }).map(function (x) { return { x: clockFraction(x.t), type: x.type, ns: !x.size && x.type !== 'solid' }; })
      };
    })
  };
  var f = fvSummary(data, isNight), v = function (ml) { return ml ? fmtVol(ml).replace(' ', '\u00a0') : '–'; };
  var fvRow = function (label, r) { return [label, v(r.intakeMl), num(r.passes) + ' (' + num(r.nightPasses) + ')', v(r.outMl), v(r.nightMl), v(r.maxMl), v(r.meanMl)]; };
  var fvNote = t('In is drinks, Out is passes. Night counts passes during your marked sleep or night hours. Volumes only include entries with a size; Average is per pass with a size.');
  if (f.rows.length > 1) fvNote += ' ' + (f.daysKept < f.rows.length ? t('Per day averages over the {a} of {b} days with entries.', { a: f.daysKept, b: f.rows.length }) : t('Per day averages over the days with entries.'));
  var fv = {
    caption: t('Frequency and volume'),
    head: [t('Day'), t('In'), t('Passes (night)'), t('Out'), t('Night out'), t('Largest'), t('Average')],
    rows: f.rows.map(function (r) { return fvRow(fmtDate(r.start, { weekday: 'short', day: 'numeric', month: 'short' }), r); }),
    total: f.rows.length > 1 && f.daysKept ? fvRow(t('Per day'), f.average) : null,
    note: fvNote
  };
  var withNotes = data.some(function (d) { return d.items.some(function (x) { return x.note; }); });
  var diary = {
    withNotes: withNotes,
    head: [t('Time'), t('Drink in'), t('Pass out')].concat(withNotes ? [t('Notes')] : []),
    days: data.map(function (d) {
      var tin = 0, tout = 0, np = 0, nn = 0, ns = 0;
      var rows = d.items.map(function (x) {
        var r = [{ text: fmtTime(x.t) }], note = withNotes ? [{ text: x.note || '' }] : [];
        if (isSleep(x)) return r.concat([{ text: name(x.type), span: 2, muted: true }], note);
        if (x.type === 'solid') {
          ns++;
          return r.concat([{ text: name('solid') + (x.bristol ? ', ' + t('Bristol {n}', { n: x.bristol }) : '') + (x.urgency && x.urgency !== 'none' ? ', ' + urgText(x.urgency) : ''), span: 2 }], note);
        }
        var txt = x.size ? fmtVol(x.size.ml) : t('logged');
        if (x.type === 'drink') {
          if (x.size) tin += x.size.ml;
          return r.concat([{ text: txt + (x.kind ? ' (' + low(t(labelOf(KINDS, x.kind))) + ')' : '') }, { text: '' }], note);
        }
        if (x.size) tout += x.size.ml; np++; if (isNight(x.t)) nn++;
        return r.concat([{ text: '' }, { text: nightly(txt, x.t) + (x.urgency && x.urgency !== 'none' ? ', ' + urgText(x.urgency) : '') }], note);
      });
      var total = [{ text: t('Totals') }, { text: tin ? fmtVol(tin) : '–' },
        { text: tn(np, '{n} pass, {m} at night', '{n} passes, {m} at night', { m: nn }) + (tout ? ', ' + fmtVol(tout) : '') + (ns ? ', ' + tn(ns, '{n} solid', '{n} solids') : ''), span: withNotes ? 2 : 1 }];
      return { title: fmtDate(d.start, { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' }), rows: rows, total: total };
    })
  };
  return {
    title: t('Bladder and drink diary'), range: reportRange(data), who: [t('Name'), t('Date of birth')],
    note: t('Times are local. Volumes in {unit}. Sizes are estimates unless measured.', { unit: settings.unit === 'oz' ? 'fl oz' : 'ml' }),
    chart: chart, fv: fv, diary: diary,
    foot: t('Created with Drink & Pass Journal on {date}. It records what was entered and isn’t medical advice.', { date: fmtDate(Date.now(), { day: 'numeric', month: 'long', year: 'numeric' }) })
  };
}
function buildDiaryChart(box, ch) {
  box.textContent = '';
  var rowH = 28, wrap = el('div', 'plotwrap'), lab = el('div', 'daylabels'), mid = el('div'), plot = el('div', 'plot');
  mid.style.cssText = 'flex:1;min-width:0'; lab.style.height = plot.style.height = (ch.days.length * rowH) + 'px'; lab.style.width = '56px';
  var lanes = ch.solidLane ? { drink: 6, solid: 14, pass: 22 } : { drink: 8, pass: 20 }, base = ch.solidLane ? 7 : 8;
  ch.days.forEach(function (d, i) {
    var l = el('div', '', d.label); l.style.cssText = 'height:' + rowH + 'px;line-height:' + rowH + 'px'; lab.appendChild(l);
    if (i > 0) { var ln = el('div', 'ln'); ln.style.top = (i * rowH) + 'px'; plot.appendChild(ln); }
    d.night.forEach(function (sg) {
      var nb = el('div', 'nb'); nb.style.left = (sg[0] / 96 * 100) + '%'; nb.style.width = ((sg[1] - sg[0]) / 96 * 100) + '%'; nb.style.top = (i * rowH) + 'px'; nb.style.height = rowH + 'px'; plot.appendChild(nb);
    });
    d.dots.forEach(function (x) {
      var dt = el('div', 'd ' + x.type + (x.ns ? ' ns' : ''));
      dt.style.width = dt.style.height = base + 'px'; dt.style.marginLeft = (-base / 2) + 'px'; dt.style.left = (x.x * 100) + '%';
      dt.style.top = (i * rowH + lanes[x.type] - base / 2) + 'px'; dt.style.pointerEvents = 'none'; plot.appendChild(dt);
    });
  });
  mid.appendChild(plot);
  var ax = el('div', 'axis'); ch.axis.forEach(function (h) { ax.appendChild(el('span', '', h)); }); mid.appendChild(ax);
  wrap.appendChild(lab); wrap.appendChild(mid); box.appendChild(wrap);
  var lg = el('div', 'legend'), keys = { drink: ['', 'background:var(--drink)'], pass: ['', 'background:var(--pass)'], solid: ['solidkey', ''], night: ['band', ''], ns: ['ring', ''] };
  ch.legend.forEach(function (it) { var sp = el('span'), i = el('i', keys[it.key][0]); if (keys[it.key][1]) i.style.cssText = keys[it.key][1]; sp.appendChild(i); sp.appendChild(document.createTextNode(it.label)); lg.appendChild(sp); });
  box.appendChild(lg);
}
function buildFvTable(box, fv) {
  box.textContent = '';
  var tbl = el('table', 'rep fv');
  tbl.appendChild(el('caption', '', fv.caption));
  var head = tbl.createTHead().insertRow();
  fv.head.forEach(function (h) { var th = document.createElement('th'); th.scope = 'col'; th.textContent = h; head.appendChild(th); });
  var tb = tbl.createTBody();
  function row(r, cls) {
    var tr = tb.insertRow(); if (cls) tr.className = cls;
    var th = document.createElement('th'); th.scope = 'row'; th.textContent = r[0]; tr.appendChild(th);
    r.slice(1).forEach(function (c) { tr.insertCell().textContent = c; });
  }
  fv.rows.forEach(function (r) { row(r); });
  if (fv.total) row(fv.total, 'tot');
  box.appendChild(tbl);
  box.appendChild(el('p', 'hint fvnote', fv.note));
}
function reportRange(data) {
  var fd = function (ms) { return fmtDate(ms, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); };
  return data.length === 1 ? fd(data[0].start) : t('{a} to {b}', { a: fd(data[0].start), b: fd(data[data.length - 1].start) });
}
function renderReport() {
  each('[data-days]', function (c) { c.setAttribute('aria-pressed', +c.getAttribute('data-days') === reportDays ? 'true' : 'false'); });
  var m = reportModel(reportData()), box = $('reportTable'); box.textContent = '';
  buildDiaryChart($('reportChart'), m.chart);
  buildFvTable($('reportFv'), m.fv);
  var tbl = el('table', 'rep diary'); tbl.style.marginTop = '12px';
  var head = tbl.createTHead().insertRow();
  m.diary.head.forEach(function (hh) { var th = document.createElement('th'); th.scope = 'col'; th.textContent = hh; head.appendChild(th); });
  function cells(tr, list) { list.forEach(function (x) { var c = tr.insertCell(); c.textContent = x.text; if (x.span > 1) c.colSpan = x.span; if (x.muted) c.className = 'sleep'; }); }
  m.diary.days.forEach(function (d) {
    var tb = tbl.createTBody(), hr = tb.insertRow(); hr.className = 'dayhead';
    var c = hr.insertCell(); c.colSpan = m.diary.head.length; c.textContent = d.title;
    d.rows.forEach(function (r) { cells(tb.insertRow(), r); });
    var tr = tb.insertRow(); tr.className = 'tot'; cells(tr, d.total);
  });
  box.appendChild(tbl);
}
function csv() {
  var items = []; reportData().forEach(function (d) { items = items.concat(d.items); });
  return toCsv(items, isNight);
}
/** Copies text, or the text a promise resolves to (e.g. an encrypted backup) without losing the tap that started it. */
function copyText(text, msgEl, okMsg, onOk) {
  function done(ok) { msgEl.textContent = ok ? okMsg : t('Copy failed. Select and copy manually.'); if (ok && onOk) onOk(); setTimeout(function () { msgEl.textContent = ''; }, 2500); }
  function fallback(t) {
    try { var ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); var ok = document.execCommand('copy'); document.body.removeChild(ta); done(ok); }
    catch (e) { done(false); }
  }
  var pending = Promise.resolve(text), cb = navigator.clipboard;
  try {
    if (typeof text !== 'string' && cb && cb.write && window.ClipboardItem) {
      var item = new ClipboardItem({ 'text/plain': pending.then(function (t) { return new Blob([t], { type: 'text/plain' }); }) });
      cb.write([item]).then(function () { done(true); }, function () { pending.then(fallback, function () { done(false); }); });
    } else if (cb && cb.writeText) pending.then(function (t) { return cb.writeText(t).then(function () { done(true); }, function () { fallback(t); }); }, function () { done(false); });
    else pending.then(fallback, function () { done(false); });
  } catch (e) { pending.then(fallback, function () { done(false); }); }
}
function saveFile(name, data, msgEl, onOk) {
  downloadFile({ filename: name, data: data }).then(function () { msgEl.textContent = t('Saved'); if (onOk) onOk(); setTimeout(function () { msgEl.textContent = ''; }, 2500); },
    function (e) { msgEl.textContent = (e && e.code === 'declined') ? t('Cancelled') : t('Couldn’t save. Use Copy instead.'); setTimeout(function () { msgEl.textContent = ''; }, 3000); });
}
function stamp() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

function render() {
  document.body.classList.toggle('clock12', settings.clock === '12');
  renderedDay = startOfDay(Date.now());
  refreshSleep(); syncSleepBtn(); renderStats(); renderList(); updateNudge(); checkReminder();
  renderRevealed();
}
// Insights and the report are only redrawn while on top; closing whatever covers them redraws them then.
function topDialog() { return dialogs.length ? dialogs[dialogs.length - 1].id : null; }
function renderRevealed() {
  var top = topDialog();
  if (top === 'insightsSheet') renderInsights();
  if (top === 'reportSheet') renderReport();
}
function refreshInsights() {
  var a = document.activeElement, id = a && $('insightsSheet').contains(a) ? a.getAttribute('data-id') : null;
  renderInsights();
  if (id) { var n = $('plot').querySelector('[data-id="' + CSS.escape(id) + '"]'); if (n) n.focus(); }
}
var renderedDay = 0;
function catchUpDay() { if (startOfDay(Date.now()) !== renderedDay) render(); }
// Open dialogs, top last. Everything outside the top one is made inert, and closing returns focus to what opened it.
var dialogs = [], LAYERS = ['app', 'logSheet', 'insightsSheet', 'reportSheet', 'settingsSheet', 'sheet'];
function syncInert() {
  var top = topDialog();
  LAYERS.forEach(function (id) { $(id).inert = top !== null && id !== top; });
  $('scrim').hidden = top !== 'sheet';
}
function openDialog(id) {
  var d = $(id), from = document.activeElement;
  dialogs = dialogs.filter(function (q) { return q.id !== id; });
  dialogs.push({ id: id, from: from, fromId: from && from.getAttribute && from.getAttribute('data-id') });
  d.hidden = false; syncInert();
  var first = d.querySelector('[data-close]') || d.querySelector('button, input, [tabindex]');
  if (first) first.focus();
}
function closeDialog(id) {
  settleInside(id);
  var d = $(id), rec = null, wasTop = topDialog() === id;
  dialogs = dialogs.filter(function (q) { if (q.id === id) rec = q; return q.id !== id; });
  d.hidden = true; syncInert();
  if (!rec) return;
  if (wasTop) renderRevealed();
  var back = rec.from;
  // Lists re-render while a dialog is open, so find the replacement for a row or dot that opened it.
  if ((!back || !back.isConnected) && rec.fromId) back = document.querySelector('[data-id="' + CSS.escape(rec.fromId) + '"]');
  if (back && back.isConnected && back.offsetParent !== null) back.focus();
}
function showOverlay(id) { openDialog(id); }
function hideOverlay(id) { closeDialog(id); }

$('drinkBtn').addEventListener('click', function (e) { addEntry('drink', e); });
$('passBtn').addEventListener('click', function (e) { addEntry('pass', e); });
$('sleepBtn').addEventListener('click', function () { addEntry(isAsleep() ? 'wake' : 'bed'); });
$('whenPill').addEventListener('click', function () { toggleWhen($('whenOpts').hidden); });
each('[data-when]', function (b) { b.addEventListener('click', function () { setWhen(b.getAttribute('data-when')); }); });
// iOS fires change on every wheel turn, so picking only updates the label; logging or tapping the pill closes the options.
['input', 'change'].forEach(function (ev) { $('pickTime').addEventListener(ev, function () { $('whenText').textContent = whenLabel(); }); });
$('prev').addEventListener('click', function () { dayOffset -= 1; renderList(); });
$('next').addEventListener('click', function () { if (dayOffset < 0) { dayOffset += 1; renderList(); } });
$('sheetSkip').addEventListener('click', closeSheet);
$('scrim').addEventListener('click', closeSheet);
$('barUndo').addEventListener('click', function () { if (barRestore) { var re = barRestore; hideBar(); restoreEntry(re.entry, re.partner); } else if (barId) remove(barId); });
$('barMore').addEventListener('click', function () { var e = find(barId); if (e) openSheet(e); });
var swipeY = null;
$('bar').addEventListener('pointerdown', function (e) { swipeY = e.clientY; if (barId && rowsAsked(find(barId) || {}).length) armBar(10000); });
$('bar').addEventListener('pointerup', function (e) { if (swipeY !== null && swipeY - e.clientY > 30) hideBar(); swipeY = null; });
// The log buttons replace the bar themselves; hiding it first would swallow the "Already logged" warning on a double tap.
// Entries open the sheet, which hides the bar; hiding it first moves the list up under the finger and the tap is lost.
document.addEventListener('pointerdown', function (e) { if ((barId || barRestore) && !$('bar').contains(e.target) && !(e.target.closest && e.target.closest('.big, #sleepBtn, [data-id]'))) hideBar(); });
$('sheetRemove').addEventListener('click', function () { if (!sheetId) return; var re = find(sheetId), rm = partner(re); remove(sheetId, true); if (re) showRemovedBar(re, rm); });
$('exactToggle').addEventListener('click', function () { $('exactRow').hidden = false; $('exactInput').focus(); });
function saveExact() {
  var v = parseFloat(String($('exactInput').value).replace(',', '.')), ml = settings.unit === 'oz' ? v * OZ : v;
  if (!(ml > 0 && ml <= MAX_ML)) {
    $('sheetInfo').textContent = t('Enter an amount up to {max}.', { max: fmtVol(MAX_ML) }); $('sheetInfo').hidden = false;
    $('exactInput').focus(); return;
  }
  setSize('exact', ml);
}
$('exactSave').addEventListener('click', saveExact);
$('exactInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); saveExact(); } });
$('noteToggle').addEventListener('click', function () { $('noteRow').hidden = false; $('noteInput').focus(); });
var noteTimer = null, pendingNote = null;
function flushNote() { if (!pendingNote) return; clearTimeout(noteTimer); pendingNote = null; save(); }
$('noteInput').addEventListener('input', function () {
  var e = find(sheetId); if (!e) return;
  var v = this.value.trim(); if (v) e.note = v; else delete e.note;
  pendingNote = { id: e.id, v: v };
  clearTimeout(noteTimer); noteTimer = setTimeout(flushNote, 500);
});
$('noteInput').addEventListener('blur', flushNote);
$('timeToggle').addEventListener('click', function () { $('timeRow').hidden = false; $('timeInput').focus(); });
// iOS fires change on every wheel turn while its picker is open, so a focused field waits until it loses focus.
var settlers = [];
function onSettled(input, fn) {
  var s = { input: input, pending: false, flush: function () { if (s.pending) { s.pending = false; fn.call(input); } } };
  input.addEventListener('change', function () { if (document.activeElement === input) s.pending = true; else fn.call(input); });
  input.addEventListener('blur', s.flush);
  settlers.push(s);
}
// Closing a dialog applies whatever is still being picked; Chromium's time fields don't fire blur when hidden or blurred by script.
function settleInside(id) { settlers.forEach(function (s) { if ($(id).contains(s.input)) s.flush(); }); }
function moveEntry(e, ms, reopen) {
  if (ms > Date.now() + 60000) { $('sheetInfo').textContent = t('The time can’t be in the future.'); $('sheetInfo').hidden = false; $('timeInput').value = toLocalInput(e.t); return; }
  var mate = partner(e);
  e.t = ms; if (mate) mate.t = ms;
  save(); dayOffset = Math.min(0, dayOffsetOf(ms));
  render(); if (reopen) openSheet(e, true);
}
onSettled($('timeInput'), function () {
  var e = find(sheetId); if (!e || !this.value) return;
  var ms = new Date(this.value).getTime();
  if (!isNaN(ms) && ms !== e.t - e.t % 60000) moveEntry(e, ms, !$('sheet').hidden);
});
function nudgeTime(dm) { var e = find(sheetId); if (e) moveEntry(e, e.t + dm * 60000, true); }
$('nudgeM').addEventListener('click', function () { nudgeTime(-5); });
$('nudgeP').addEventListener('click', function () { nudgeTime(5); });

$('nudgeNow').addEventListener('click', function () { syncSettings(); showOverlay('settingsSheet'); });
$('nudgeLater').addEventListener('click', function () { bk.snooze = Date.now() + DAY; saveBk(); updateNudge(); });
$('openInsights').addEventListener('click', function () { renderInsights(); showOverlay('insightsSheet'); });
$('todayStrip').addEventListener('click', function () {
  rangeDays = 1; settings.range = 1; reportDays = 1; save();
  renderInsights(); showOverlay('insightsSheet');
});
$('openReport').addEventListener('click', function () { renderReport(); showOverlay('reportSheet'); });
$('openSettings').addEventListener('click', function () { syncSettings(); showOverlay('settingsSheet'); });
each('[data-close]', function (b) { b.addEventListener('click', function () { hideOverlay(b.getAttribute('data-close')); }); });
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && dialogs.length) {
    var top = dialogs[dialogs.length - 1].id;
    if (top === 'sheet') closeSheet(); else hideOverlay(top);
  }
});
each('[data-range]', function (b) { b.addEventListener('click', function () { rangeDays = +b.getAttribute('data-range'); settings.range = rangeDays; save(); reportDays = !rangeDays || rangeDays > 7 ? 7 : rangeDays; renderInsights(); }); });
each('[data-days]', function (b) { b.addEventListener('click', function () { reportDays = +b.getAttribute('data-days'); renderReport(); }); });
$('copyCsv').addEventListener('click', function () { copyText(csv(), $('reportMsg'), t('CSV copied')); });
$('dlCsv').addEventListener('click', function () { saveFile('drink-pass-' + stamp() + '.csv', csv(), $('reportMsg')); });
$('pdfBtn').addEventListener('click', function () {
  var data = reportData(), m = reportModel(data), bytes;
  try { bytes = reportPdf(m); } catch (e) { $('reportMsg').textContent = t('Couldn’t make the PDF. Use Download CSV instead.'); return; }
  var dates = isoDate(data[0].start) + (data.length > 1 ? ' – ' + isoDate(data[data.length - 1].start) : '');
  saveFile((m.title + ' ' + dates).replace(/[\\/:*?"<>|]/g, '-') + '.pdf', bytes, $('reportMsg'));
});
each('[data-unit]', function (b) {
  b.addEventListener('click', function () { settings.unit = b.getAttribute('data-unit'); save(); syncSettings(); if (sheetId) closeSheet(); render(); });
});
each('[data-clock]', function (b) {
  b.addEventListener('click', function () { settings.clock = b.getAttribute('data-clock'); save(); syncSettings(); render(); });
});
each('[data-toggle]', function (b) {
  b.addEventListener('click', function () {
    var k = b.getAttribute('data-toggle'), cur = k === 'askSize' ? settings.askSize !== false : !!settings[k];
    settings[k] = !cur; save(); syncSettings(); render();
    if (sheetId) { var e = find(sheetId); if (e) openSheet(e); }
  });
});
each('[data-dots]', function (b) {
  b.addEventListener('click', function () { settings.dotScale = b.getAttribute('data-dots'); save(); syncSettings(); renderInsights(); });
});
function setNight(field) {
  return function () {
    if (!this.value) return;
    var other = field === 'nightStart' ? settings.nightEnd : settings.nightStart;
    if (this.value === other) { $('nightMsg').textContent = t('Night can’t start and end at the same time.'); this.value = settings[field]; return; }
    $('nightMsg').textContent = ''; settings[field] = this.value; save(); render();
  };
}
onSettled($('nightStart'), setNight('nightStart'));
onSettled($('nightEnd'), setNight('nightEnd'));
function backupText() { return JSON.stringify({ version: 1, schema: 2, app: 'drink-pass-journal', exportedAt: new Date().toISOString(), count: log.length, log: log, settings: settings }); }
function protectedBackup() {
  var pass = $('backupPass').value;
  return pass ? encryptBackup(backupText(), pass) : Promise.resolve(backupText());
}
function backupError() { backupMsgFlash(t('Couldn’t encrypt the backup in this browser.')); }
$('copyBackup').addEventListener('click', function () { copyText($('backupPass').value ? protectedBackup() : backupText(), $('backupMsg'), t('Backup copied'), markBackup); });
$('dlBackup').addEventListener('click', function () {
  var locked = !!$('backupPass').value;
  protectedBackup().then(function (t) { saveFile('drink-pass-backup-' + stamp() + (locked ? '-encrypted' : '') + '.json', t, $('backupMsg'), markBackup); }, backupError);
});
$('exportCsv').addEventListener('click', function () { saveFile('drink-pass-all-' + stamp() + '.csv', toCsv(sorted(), isNight), $('exportMsg')); });
$('exportFhir').addEventListener('click', function () { saveFile('drink-pass-fhir-' + stamp() + '.json', JSON.stringify(toFhirBundle(sorted(), isNight), null, 1), $('exportMsg')); });

// ---------- safer storage: automatic copies, recovery, checked restore ----------
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function idbOpen(cb) {
  try {
    var rq = indexedDB.open('drink-pass-v1', 1);
    rq.onupgradeneeded = function () { var db = rq.result; if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv'); if (!db.objectStoreNames.contains('snaps')) db.createObjectStore('snaps', { keyPath: 'at' }); };
    rq.onsuccess = function () { idb = rq.result; cb(true); };
    rq.onerror = rq.onblocked = function () { cb(false); };
  } catch (e) { cb(false); }
}
function idbOp(store, mode, fn) {
  return new Promise(function (res) {
    if (!idb) return res(null);
    try {
      var tx = idb.transaction(store, mode), rq = fn(tx.objectStore(store));
      tx.oncomplete = function () { res(rq && rq.result !== undefined ? rq.result : true); };
      tx.onerror = tx.onabort = function () { res(null); };
    } catch (e) { res(null); }
  });
}
function scheduleMirror() { if (!idb) return; clearTimeout(mirrorTimer); mirrorTimer = setTimeout(mirrorNow, 400); }
function mirrorNow() {
  clearTimeout(mirrorTimer);
  if (!idb || recoveryPending) return;
  idbOp('kv', 'readwrite', function (os) { return os.put({ log: clone(log), settings: clone(settings), at: Date.now(), n: log.length }, 'journal'); });
  maybeSnapshot(false);
}
function maybeSnapshot(force, label) {
  if (!idb || !log.length || (recoveryPending && !force)) return Promise.resolve();
  var now = Date.now();
  if (!force && now - lastSnapAt < 3600000) return Promise.resolve();
  lastSnapAt = now;
  var snap = { at: now, n: log.length, log: clone(log), settings: clone(settings) }; if (label) snap.label = label;
  return idbOp('snaps', 'readwrite', function (os) { return os.put(snap); }).then(pruneSnaps);
}
function pruneSnaps() {
  return idbOp('snaps', 'readonly', function (os) { return os.getAll(); }).then(function (all) {
    all = (all && all.length !== undefined ? all : []).sort(function (a, b) { return b.at - a.at; });
    snapCache = all.slice(0, 12);
    var old = all.slice(12);
    if (old.length) return idbOp('snaps', 'readwrite', function (os) { old.forEach(function (o) { os.delete(o.at); }); return os.count(); });
  }).then(function () { renderSnaps(); storeStatus(); });
}
function detectLoss() {
  Promise.all([idbOp('kv', 'readonly', function (os) { return os.get('journal'); }), idbOp('snaps', 'readonly', function (os) { return os.getAll(); })]).then(function (r) {
    var m = r[0] && r[0].log ? r[0] : null, snaps = (r[1] && r[1].length !== undefined ? r[1] : []).sort(function (a, b) { return b.at - a.at; });
    snapCache = snaps.slice(0, 12); if (snaps[0]) lastSnapAt = snaps[0].at;
    var best = (m && m.log.length) ? m : (snaps[0] || null);
    if (best && best.log && best.log.length) {
      var have = {}; log.forEach(function (x) { have[x.id] = 1; });
      var missing = best.log.filter(function (x) { return x && x.id && !have[x.id]; });
      var dismissed = 0; try { dismissed = +localStorage.getItem('dp-dismissed') || 0; } catch (e) {}
      if (missing.length && (log.length === 0 || missing.length >= 3) && best.at > dismissed) {
        recoveryPending = { entries: missing, at: best.at, settings: best.settings, wasMirror: best === m, log: best.log };
        $('recoverText').textContent = tn(missing.length, 'We found an automatic copy with {n} entry that isn’t in your journal. Restore it?', 'We found an automatic copy with {n} entries that aren’t in your journal. Restore them?');
        $('recover').hidden = false;
      }
    }
    if (!recoveryPending) mirrorNow();
    renderSnaps(); storeStatus();
  });
}
$('recoverNow').addEventListener('click', function () {
  if (!recoveryPending) return;
  var rp = recoveryPending; recoveryPending = null;
  maybeSnapshot(true, k('Before recovery')).then(function () {
    var have = {}; log.forEach(function (x) { have[x.id] = 1; });
    rp.entries.forEach(function (x) { if (!have[x.id]) log.push(x); });
    save(); render(); $('recover').hidden = true; mirrorNow(); backupMsgFlash(tn(rp.entries.length, 'Restored {n} entry', 'Restored {n} entries'));
  });
});
$('recoverLater').addEventListener('click', function () {
  if (!recoveryPending) return;
  var rp = recoveryPending; recoveryPending = null; $('recover').hidden = true;
  try { localStorage.setItem('dp-dismissed', String(rp.at)); } catch (e) {}
  if (rp.wasMirror) { idbOp('snaps', 'readwrite', function (os) { return os.put({ at: rp.at, n: rp.log.length, log: rp.log, settings: rp.settings, label: k('Earlier copy') }); }).then(pruneSnaps); }
  mirrorNow();
});
function backupMsgFlash(t) { var m = $('backupMsg'); m.textContent = t; setTimeout(function () { m.textContent = ''; }, 3000); }

function storeStatus() {
  var parts = [t('Entries: {n}.', { n: log.length })];
  parts.push(isStandalone() ? t('Installed as an app: yes.') : t('Installed as an app: no.'));
  parts.push(!idb ? t('Automatic copies aren’t available in this browser.') : snapCache.length ? t('Automatic copies: {n} (latest {ago}).', { n: snapCache.length, ago: agoText(snapCache[0].at) }) : t('Automatic copies: {n}.', { n: 0 }));
  var el0 = $('storeStatus'), btn = $('persistBtn');
  var sm = navigator.storage;
  if (sm && sm.persisted) {
    sm.persisted().then(function (ok) {
      parts.push(ok ? t('Browser protection: on.') : t('Browser protection: not on.')); el0.textContent = parts.join(' '); btn.hidden = !!ok || !sm.persist;
    }, function () { el0.textContent = parts.join(' '); });
  } else { parts.push(t('Browser protection isn’t available here.')); el0.textContent = parts.join(' '); btn.hidden = true; }
}
function tryPersist() { if (persistTried) return; persistTried = true; try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().then(storeStatus, function () {}); } catch (e) {} }
$('persistBtn').addEventListener('click', function () {
  try { navigator.storage.persist().then(function (ok) { $('persistMsg').textContent = ok ? t('Done') : t('The browser said no. A backup file is the safest option.'); storeStatus(); setTimeout(function () { $('persistMsg').textContent = ''; }, 4000); }); } catch (e) {}
});
function renderSnaps() {
  var box = $('snapList'); if (!box) return; box.textContent = '';
  if (!snapCache.length) { box.appendChild(el('p', 'hint', t('No automatic copies yet. One is saved about once an hour while you log.'))); return; }
  snapCache.slice(0, 8).forEach(function (sn) {
    var r = el('div', 'snaprow'); r.appendChild(el('span', '', fmtWhen(sn.at) + ' · ' + tn(sn.n, '{n} entry', '{n} entries') + (sn.label ? ' · ' + t(sn.label) : '')));
    var b = el('button', 'btn', t('Check')); b.type = 'button'; b.addEventListener('click', function () { startRestore(JSON.stringify({ log: sn.log, settings: sn.settings })); }); r.appendChild(b); box.appendChild(r);
  });
}

function startRestore(text) {
  var d, msg = $('backupMsg');
  try { d = JSON.parse(text); } catch (e) { d = null; }
  if (isEncryptedBackup(d)) { askUnlock(d); return; }
  if (!d || !Array.isArray(d.log)) { msg.textContent = t('That doesn’t look like a backup.'); setTimeout(function () { msg.textContent = ''; }, 3500); return; }
  $('unlockBox').hidden = true;
  var have = {}; log.forEach(function (x) { have[x.id] = 1; });
  var m = migrateLog(d.log, +d.schema || 1), fresh = [], dup = 0, bad = m.dropped;
  m.log.forEach(function (x) { if (have[x.id]) dup++; else fresh.push(x); });
  pendingRestore = { fresh: fresh, settings: (d.settings && typeof d.settings === 'object') ? d.settings : null };
  var line = tn(d.log.length, 'Found {n} entry', 'Found {n} entries') + (d.exportedAt ? ', ' + t('exported {date}', { date: fmtDate(d.exportedAt, { day: 'numeric', month: 'short', year: 'numeric' }) }) : '') + '. ' + t('{a} new, {b} already here', { a: fresh.length, b: dup }) + (bad ? ', ' + t('{n} skipped', { n: bad }) : '') + '.';
  $('restorePrevText').textContent = line;
  $('restoreSetRow').hidden = !pendingRestore.settings; $('restoreSettings').checked = !!pendingRestore.settings;
  $('restoreGo').textContent = fresh.length ? tn(fresh.length, 'Add {n} entry', 'Add {n} entries') : (pendingRestore.settings ? t('Restore settings') : t('Nothing to add'));
  $('restoreGo').disabled = !fresh.length && !pendingRestore.settings;
  $('restorePrev').hidden = false;
}
$('restoreBtn').addEventListener('click', function () { startRestore($('restoreBox').value); });
$('restoreFile').addEventListener('change', function () {
  var f = this.files && this.files[0]; if (!f) return;
  var rd = new FileReader(); rd.onload = function () { startRestore(String(rd.result || '')); }; rd.onerror = function () { $('backupMsg').textContent = t('Couldn’t read that file.'); };
  rd.readAsText(f); this.value = '';
});
$('restoreCancel').addEventListener('click', function () { pendingRestore = null; $('restorePrev').hidden = true; });
var lockedBackup = null;
function askUnlock(d) {
  lockedBackup = d; pendingRestore = null; $('restorePrev').hidden = true;
  $('unlockMsg').textContent = ''; $('unlockPass').value = ''; $('unlockBox').hidden = false; $('unlockPass').focus();
}
function unlock() {
  if (!lockedBackup) return;
  var d = lockedBackup;
  $('unlockGo').disabled = true; $('unlockMsg').textContent = t('Unlocking…');
  decryptBackup(d, $('unlockPass').value).then(function (text) {
    lockedBackup = null; $('unlockPass').value = ''; $('unlockBox').hidden = true; startRestore(text);
  }, function () { $('unlockMsg').textContent = t('That password doesn’t match this backup.'); $('unlockPass').select(); })
    .then(function () { $('unlockGo').disabled = false; });
}
$('unlockGo').addEventListener('click', unlock);
$('unlockPass').addEventListener('keydown', function (e) { if (e.key === 'Enter') unlock(); });
$('unlockCancel').addEventListener('click', function () { lockedBackup = null; $('unlockBox').hidden = true; });
$('restoreGo').addEventListener('click', function () {
  if (!pendingRestore) return;
  var pr = pendingRestore; pendingRestore = null;
  maybeSnapshot(true, k('Before restore')).then(function () {
    pr.fresh.forEach(function (x) { log.push(x); });
    if (pr.settings && $('restoreSettings').checked) settings = sanitizeSettings(pr.settings, settings);
    rangeDays = settings.range; reportDays = !rangeDays || rangeDays > 7 ? 7 : rangeDays;
    save(); render(); syncSettings(); $('restoreBox').value = ''; $('restorePrev').hidden = true;
    backupMsgFlash(tn(pr.fresh.length, '{n} entry added', '{n} entries added'));
  });
});
// Another tab saved: pick up its entries instead of overwriting them on our next save.
window.addEventListener('storage', function (e) {
  if (e.storageArea !== localStorage) return;
  var all = e.key === null, note = pendingNote;
  if (all || e.key === KEY) {
    loadLog();
    if (note) { var ne = find(note.id); if (ne) { if (note.v) ne.note = note.v; else delete ne.note; } flushNote(); }
  }
  if (all || e.key === SKEY) { loadSettings(); syncSettings(); }
  if (all || e.key === TKEY) { try { var tr = readJson(TKEY); trash = Array.isArray(tr.value) ? tr.value : []; } catch (er) {} renderTrash(); }
  if (all || e.key === BKEY) { try { var b = readJson(BKEY); if (b.value) bk = { last: +b.value.last || 0, snooze: +b.value.snooze || 0, done: +b.value.done || 0 }; } catch (er) {} backupStatus(); }
  if (sheetId && !find(sheetId)) { sheetId = null; hideSheet(); }
  if (barId && !find(barId)) hideBar();
  $('loadWarn').hidden = !loadProblem;
  render();
});
document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') { flushNote(); mirrorNow(); } else catchUpDay(); });
window.addEventListener('pagehide', flushNote);

function syncSettings() {
  $('appVersion').textContent = t('Version {v}', { v: APP_VERSION });
  each('[data-unit]', function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-unit') === settings.unit ? 'true' : 'false'); });
  each('[data-clock]', function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-clock') === settings.clock ? 'true' : 'false'); });
  each('[data-lang]', function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-lang') === currentLang() ? 'true' : 'false'); });
  each('[data-remind]', function (b) { b.setAttribute('aria-pressed', +b.getAttribute('data-remind') === settings.remindAfter ? 'true' : 'false'); });
  $('remindNotify').setAttribute('aria-pressed', settings.remindNotify ? 'true' : 'false');
  each('[data-toggle]', function (b) { var k = b.getAttribute('data-toggle'); b.setAttribute('aria-pressed', (k === 'askSize' ? settings.askSize !== false : !!settings[k]) ? 'true' : 'false'); });
  each('[data-dots]', function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-dots') === (settings.dotScale || 'same') ? 'true' : 'false'); });
  $('nightStart').value = settings.nightStart; $('nightEnd').value = settings.nightEnd;
  backupStatus(); renderTrash(); storeStatus(); renderSnaps();
}

var langPrefs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en'];
function langCode() { return isLang(settings.lang) ? settings.lang : detectLang(langPrefs); }
function applyLanguage() {
  translatePage(document.body);
  ['langMsg', 'reportMsg', 'notifyMsg', 'persistMsg', 'backupMsg', 'exportMsg', 'unlockMsg'].forEach(function (id) { $(id).textContent = ''; });
  $('whenText').textContent = whenLabel();
  syncSettings(); hideBar(); render();
  if (sheetId) { var se = find(sheetId); if (se) openSheet(se); }
}
each('[data-lang]', function (b) {
  b.addEventListener('click', function () {
    settings.lang = b.getAttribute('data-lang'); save();
    setLang(settings.lang, langPrefs).then(applyLanguage, function () { $('langMsg').textContent = t('That language couldn’t be loaded. Try again when you’re online.'); });
  });
});

testStorage(); load(); $('storageWarn').hidden = storageOk; $('loadWarn').hidden = !loadProblem;
try { await setLang(langCode(), langPrefs); } catch (e) { await setLang('en', langPrefs); }
translatePage(document.body); syncSettings(); render();
idbOpen(function (ok) { if (ok) detectLoss(); else storeStatus(); });
try {
  if (window.ResizeObserver) {
    var ro = new ResizeObserver(function () { window.requestAnimationFrame(renderLatest); });
    ro.observe($('list'));
  }
} catch (e) {}
setInterval(function () {
  if (startOfDay(Date.now()) !== renderedDay) { render(); return; }
  refreshSleep(); renderStats(); if (topDialog() === 'insightsSheet' && rangeDays === 1) refreshInsights(); updateNudge(); checkReminder();
}, 30000);

var remindSnooze = 0, notifiedFor = null;
function checkReminder() {
  var now = Date.now(), due = now < remindSnooze ? null : drinkReminder(sorted(), now, settings.remindAfter, isNight, isAsleep());
  $('remindBar').hidden = !due;
  if (!due) return;
  var text = (due.drank ? t('It’s been {d} since your last drink.', { d: fmtDur(now - due.since) }) : t('You haven’t logged a drink for {d}.', { d: fmtDur(now - due.since) })) + ' ' + t('Time for some water?');
  $('remindText').textContent = text;
  if (settings.remindNotify && notifiedFor !== due.since && document.visibilityState === 'hidden' && window.Notification && Notification.permission === 'granted') {
    notifiedFor = due.since;
    navigator.serviceWorker.getRegistration().then(function (reg) {
      if (reg) reg.showNotification('Drink & Pass', { body: text, tag: 'drink-reminder', icon: 'icons/icon-192.png' });
    }).catch(function () {});
  }
}
$('remindLog').addEventListener('click', function () { addEntry('drink'); });
$('remindLater').addEventListener('click', function () { remindSnooze = Date.now() + 3600000; checkReminder(); });
each('[data-remind]', function (b) {
  b.addEventListener('click', function () { settings.remindAfter = +b.getAttribute('data-remind'); save(); syncSettings(); checkReminder(); });
});
$('remindNotify').addEventListener('click', function () {
  var msg = $('notifyMsg');
  if (settings.remindNotify) { settings.remindNotify = false; save(); syncSettings(); return; }
  if (!window.Notification) { msg.textContent = t('This browser can’t show notifications. On iPhone, install the app to the home screen first.'); return; }
  Notification.requestPermission().then(function (p) {
    settings.remindNotify = p === 'granted'; save(); syncSettings();
    msg.textContent = p === 'granted' ? '' : t('Notifications are blocked for this app in your browser settings.');
  });
});

function downloadFile(opts) {
  var name = opts.filename, type = /\.json$/i.test(name) ? 'application/json' : /\.csv$/i.test(name) ? 'text/csv' : /\.pdf$/i.test(name) ? 'application/pdf' : 'text/plain';
  var blob = new Blob([opts.data], { type: type });
  function anchor() {
    var url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); if (a.parentNode) a.parentNode.removeChild(a); }, 1500);
    return Promise.resolve({ status: 'saved' });
  }
  try {
    var f = new File([blob], name, { type: type });
    if (navigator.canShare && navigator.canShare({ files: [f] })) {
      return navigator.share({ files: [f], title: name }).then(function () { return { status: 'saved' }; }, function (e) { return (e && e.name === 'AbortError') ? Promise.reject({ code: 'declined' }) : anchor(); });
    }
  } catch (e) {}
  return anchor();
}
// Home-screen shortcuts open ./?log=drink or ./?log=pass. Drop the parameter so a reload doesn't log again.
function handleShortcut() {
  var type = new URLSearchParams(location.search).get('log');
  if (!type) return;
  try { history.replaceState(null, '', location.pathname); } catch (e) {}
  if (type === 'drink' || type === 'pass') addEntry(type);
}
handleShortcut();

var swReg = null;
function updateReady() { $('updateBar').hidden = false; $('checkUpdate').textContent = t('Update'); $('updateMsg').textContent = t('A new version of the app is ready.'); }
function watchUpdates(reg) {
  swReg = reg;
  var offer = function (w) { if (w && navigator.serviceWorker.controller) { waitingWorker = w; updateReady(); } };
  offer(reg.waiting);
  reg.addEventListener('updatefound', function () {
    var w = reg.installing; if (!w) return;
    w.addEventListener('statechange', function () { if (w.state === 'installed') offer(w); });
  });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') reg.update().catch(function () {}); });
}
var waitingWorker = null, reloading = false;
$('checkUpdate').addEventListener('click', function () {
  var msg = $('updateMsg');
  if (waitingWorker) { $('updateNow').click(); return; }
  if (!swReg) { msg.textContent = t('Updates aren’t available in this browser.'); return; }
  msg.textContent = t('Checking…');
  swReg.update().then(function () {
    var w = swReg.installing;
    if (!w) { if (!waitingWorker) msg.textContent = t('You have the latest version.'); return; }
    w.addEventListener('statechange', function () { if (w.state === 'redundant' && msg.textContent === t('Checking…')) msg.textContent = t('The update couldn’t download. Try again later.'); });
  }, function () { msg.textContent = t('Couldn’t check for updates. Are you online?'); });
});
$('updateNow').addEventListener('click', function () {
  if (!waitingWorker) return;
  flushNote(); mirrorNow();
  $('updateNow').disabled = true;
  waitingWorker.postMessage({ type: 'skip-waiting' });
});
if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
  navigator.serviceWorker.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'install-failed') $('updateMsg').textContent = t('Version {v} couldn’t download: {why}', { v: e.data.version, why: e.data.reason });
  });
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (!waitingWorker || reloading) return;
    reloading = true; location.reload();
  });
  window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').then(watchUpdates).catch(function () {}); });
}
