import {
  OZ, H, DAY, PRESETS, URG, KINDS, KINDS_SHORT, NAMES, BRISTOL,
  isSleep, pad, cap, labelOf, median, startOfDay, dayRange, fmtTime, fmtDur, agoText, toLocalInput,
  sortEntries, between, sleepModel, sanitizeSettings, migrateLog, DEFAULT_SETTINGS, SCHEMA, isNightAt, isAsleepAt, computeGaps, periodStats as periodStatsOf, toCsv,
  fmtVol as fmtVolIn
} from './core.js';

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
  rangeDays = settings.range; reportDays = rangeDays > 7 ? 7 : rangeDays;
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
  if (show) $('nudgeText').textContent = (bk.done ? 'It’s been ' + Math.floor((now - bk.done) / DAY) + ' days since your last backup.' : 'You haven’t backed up yet.') + ' Entries only live in this browser.';
}
function backupStatus() {
  $('lastBackup').textContent = bk.done ? 'Last backed up ' + agoText(bk.done) + '.' : 'Not backed up yet.';
}
function markBackup() { bk.last = Date.now(); bk.done = Date.now(); bk.snooze = 0; saveBk(); updateNudge(); backupStatus(); }

function fmtVol(ml) { return fmtVolIn(ml, settings.unit); }
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
  $('sleepBtn').setAttribute('aria-label', a ? 'Up for the day' : 'Going to bed');
}

function getWhen() {
  var now = Date.now();
  if (whenMode === 'now') return now;
  if (whenMode === '5') return now - 5 * 60000;
  if (whenMode === '15') return now - 15 * 60000;
  var v = $('pickTime').value; if (!v) return now;
  var p = v.split(':'), d = new Date(); d.setHours(+p[0], +p[1], 0, 0);
  var t = d.getTime(); if (t > now) t -= DAY; return t;
}
function whenLabel() {
  if (whenMode === 'now') return 'Now';
  if (whenMode === '5') return '5 min ago';
  if (whenMode === '15') return '15 min ago';
  return $('pickTime').value ? 'At ' + $('pickTime').value : 'Pick a time';
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
  var tapNow = Date.now();
  if (lastTap[type] && tapNow - lastTap[type] < 1500) { if (barId) $('barMsg').textContent = 'Already logged. Tap Undo if that was a mistake.'; return; }
  lastTap[type] = tapNow; barStash = null; tryPersist();
  var t = getWhen();
  var entry = { id: Date.now() + '-' + Math.random().toString(36).slice(2, 7), type: type, t: t };
  log.push(entry); save();
  dayOffset = Math.min(0, Math.round((startOfDay(t) - startOfDay(Date.now())) / DAY));
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
  if (!trash.length) { box.appendChild(el('p', 'hint', 'Nothing removed recently. Removed entries stay here for 30 days.')); return; }
  trash.slice(0, 10).forEach(function (q) {
    var r = el('div', 'trashrow'); r.appendChild(el('span', '', (q.partner ? 'Pass and solid' : NAMES[q.entry.type]) + ' · ' + fmtWhen(q.entry.t)));
    var b = el('button', 'btn', 'Restore'); b.type = 'button'; b.addEventListener('click', function () { restoreEntry(q.entry, q.partner); }); r.appendChild(b); box.appendChild(r);
  });
}

function gaps() { if (!gapsCache) gapsCache = computeGaps(sorted()); return gapsCache; }
function gapLine(x, g) {
  if (x.type === 'solid') return (g.solid !== null && g.solid !== undefined && g.solid < 3 * DAY) ? fmtDur(g.solid) + ' since last solid' : 'No solid in the previous 3 days';
  if (x.type === 'pass') return (g.pass !== null && g.pass < DAY) ? fmtDur(g.pass) + ' after last pass' : 'No pass in the previous 24 h';
  return (g.drink !== null && g.drink < DAY) ? fmtDur(g.drink) + ' since last drink' : 'No drink in the previous 24 h';
}
function sizeText(x) { return x.size ? (x.size.label === 'exact' ? 'Exact' : cap(x.size.label)) + ' · ' + fmtVol(x.size.ml) : ''; }
function lastSize(type, exceptId) {
  var s = sorted().slice().reverse();
  for (var i = 0; i < s.length; i++) if (s[i].type === type && s[i].size && s[i].id !== exceptId) return s[i].size.ml;
  return null;
}
function sleptText(x) {
  var periods = sleep.periods;
  for (var i = 0; i < periods.length; i++) if (periods[i][1] === x.t && !periods[i][2]) return 'Slept ' + fmtDur(periods[i][1] - periods[i][0]);
  return '';
}
function detailParts(x, g) {
  var p = [];
  if (x.type === 'drink' && x.kind) p.push(labelOf(KINDS, x.kind));
  if (x.size) p.push(sizeText(x));
  p.push(gapLine(x, g));
  if (x.type === 'solid' && x.bristol) p.push('Bristol ' + x.bristol);
  if (x.urgency && x.urgency !== 'none') p.push('urgency: ' + labelOf(URG, x.urgency).toLowerCase());
  if (x.note) p.push('note');
  return p;
}

function buildOptions(box, list, current, onPick) {
  box.textContent = '';
  list.forEach(function (u) {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'opt'; b.textContent = u[1];
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
function toggler(field) {
  var f = function (e, v) { if (e[field] === v) delete e[field]; else e[field] = v; };
  f.current = function (e) { return e[field]; };
  return f;
}

function openSheet(entry, keepTime) {
  hideBar();
  sheetId = entry.id;
  var sl = isSleep(entry), solid = entry.type === 'solid', label = NAMES[entry.type], g = (gaps()[entry.id]) || {};
  $('sheetTitle').textContent = label + ' at ' + fmtTime(entry.t) + (entry.type === 'pass' && isNight(entry.t) ? ' (night)' : '');
  var info = [];
  if (sl) { var sp = entry.type === 'wake' ? sleptText(entry) : ''; if (sp) info.push(sp); }
  else {
    info = detailParts(entry, g).filter(function (q) { return q !== 'note'; });
    if (entry.type === 'pass' && g.drink !== null && g.drink < DAY) info.push(fmtDur(g.drink) + ' after last drink');
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
      b.appendChild(document.createTextNode(p[0]));
      var sm = document.createElement('small'); sm.textContent = fmtVol(p[1]); b.appendChild(sm);
      b.addEventListener('click', function () { setSize(p[0].toLowerCase(), p[1]); });
      box.appendChild(b);
    });
    $('exactUnit').textContent = settings.unit === 'oz' ? 'fl oz' : 'ml'; $('exactInput').value = '';
    if (entry.type === 'drink' && settings.showKind) buildOptions($('kindBtns'), KINDS, entry.kind, toggler('kind'));
  }
  if (hasUrg && settings.showUrgency) buildOptions($('urgBtns'), URG, entry.urgency, toggler('urgency'));
  if (solid && settings.showBristol) buildOptions($('bristolBtns'), BRISTOL, entry.bristol, toggler('bristol'));
  if (!sl) {
    $('noteInput').value = entry.note || '';
    $('noteRow').hidden = !entry.note; $('noteToggleText').textContent = entry.note ? 'Edit note' : 'Add a note';
  }
  $('sheetRemove').hidden = false;
  $('sheet').hidden = false;
}
function hideSheet() { flushNote(); $('sheet').hidden = true; }
function closeSheet() { sheetId = null; hideSheet(); render(); }
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
  if (e.kind) p.push(labelOf(KINDS, e.kind));
  if (bristolOf(e)) p.push('Bristol ' + bristolOf(e));
  if (e.urgency) p.push(labelOf(URG, e.urgency));
  return p.join(' · ');
}
function checkBar(e, first) {
  var asked = rowsAsked(e);
  if (!asked.length) { armBar(4000); return; }
  var all = asked.every(function (k) { return answered(e, k); });
  if (all && !first) { $('barMsg').textContent = 'Saved · ' + barSummary(e); armBar(1500); }
  else armBar(all ? 3000 : 10000);
}
function barGrid(cls) { var g = document.createElement('div'); g.className = 'barchips' + (cls ? ' ' + cls : ''); return g; }
function sizeRow(entry) {
  var grid = barGrid(), lm = lastSize(entry.type, entry.id);
  var list = PRESETS[entry.type].map(function (p) { return { label: p[0].toLowerCase(), name: p[0], ml: p[1], last: lm !== null && Math.round(lm) === p[1] }; });
  if (lm !== null && !list.some(function (x) { return x.last; })) list.push({ label: 'exact', name: 'Last', ml: lm, last: true });
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
    var sm = document.createElement('small');
    if (c.last) sm.appendChild(svgIcon('i-repeat', 11));
    sm.appendChild(document.createTextNode(fmtVol(c.ml))); b.appendChild(sm);
    if (c.last) b.setAttribute('aria-label', c.name + ', ' + fmtVol(c.ml) + ', same as last time');
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
    var b = document.createElement('button'); b.type = 'button'; b.textContent = u[1];
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
  var wrap = document.createElement('div'), l = document.createElement('div'); l.className = 'barl'; l.textContent = 'What passed';
  var grid = barGrid('opts'); grid.style.gridTemplateColumns = 'repeat(3, minmax(0, 1fr))';
  var modes = [['water', 'Water'], ['solid', 'Solid'], ['both', 'Both']];
  function paint() { var e = find(barId), m = e ? whatMode(e) : 'water'; Array.prototype.forEach.call(grid.children, function (b, i) { b.setAttribute('aria-pressed', modes[i][0] === m ? 'true' : 'false'); }); }
  modes.forEach(function (q) { var b = document.createElement('button'); b.type = 'button'; b.textContent = q[1]; b.addEventListener('click', function () { setWhat(q[0]); }); grid.appendChild(b); });
  paint(); wrap.appendChild(l); wrap.appendChild(grid); return wrap;
}
function showBar(entry, rebuilt) {
  barId = entry.id; barRestore = null; $('barMore').hidden = false;
  var asked = rowsAsked(entry), rows = $('barRows'); rows.textContent = '';
  if (!rebuilt && entry.type === 'drink' && settings.showKind && !entry.kind) { var lk = lastKind(entry.id); if (lk) { entry.kind = lk; save(); renderList(); } }
  var m = (entry.type === 'pass' || entry.type === 'solid') ? whatMode(entry) : null;
  $('barMsg').textContent = (m === 'both' ? 'Pass and solid' : NAMES[entry.type]) + ' logged · ' + fmtTime(entry.t);
  if (settings.trackSolid && m) rows.appendChild(whatRow());
  if (asked.indexOf('size') > -1) rows.appendChild(sizeRow(entry));
  if (asked.indexOf('kind') > -1) rows.appendChild(optRow('Type', KINDS_SHORT, 'kind', entry));
  if (asked.indexOf('urg') > -1) rows.appendChild(optRow('Urgency', URG, 'urgency', entry, 4, m === 'both' ? function () { return [find(barId), partner(find(barId))]; } : null));
  if (asked.indexOf('bristol') > -1) rows.appendChild(optRow('Stool type (Bristol 1 to 7)', BRISTOL, 'bristol', entry, 7, m === 'both' ? function () { return [partner(find(barId))]; } : null));
  $('bar').hidden = false;
  checkBar(entry, true);
}

function showRemovedBar(e, mate) {
  barId = null; barRestore = { entry: e, partner: mate }; $('barRows').textContent = '';
  $('barMsg').textContent = 'Removed · ' + (mate ? 'Pass and solid' : NAMES[e.type]) + ' at ' + fmtTime(e.t); $('barMore').hidden = true;
  $('bar').hidden = false; armBar(6000);
}
function sum(a) { var t = 0, c = 0; a.forEach(function (x) { if (x.size) { t += x.size.ml; c++; } }); return [t, c]; }
function renderStats() {
  var s = sorted();
  var ld = s.filter(function (x) { return x.type === 'drink'; }).pop();
  var lp = s.filter(function (x) { return x.type === 'pass'; }).pop();
  $('drinkSub').textContent = ld ? cap(agoText(ld.t)) : 'Not yet';
  $('passSub').textContent = lp ? cap(agoText(lp.t)) : 'Not yet';
}

var ROW_H = 56, MORE_H = 46;
function fmtWhen(ms) {
  var d = new Date(ms), t = fmtTime(ms);
  return startOfDay(ms) === startOfDay(Date.now()) ? t : d.toLocaleDateString([], { weekday: 'short' }) + ' ' + t;
}
function buildRow(x, info, withDay) {
  var sl = isSleep(x);
  var b = document.createElement('button'); b.type = 'button'; b.className = 'row';
  var mk = document.createElement('span'); mk.className = 'mark';
  if (sl) mk.appendChild(svgIcon(x.type === 'bed' ? 'i-moon' : 'i-sun', 14));
  else { var dot = document.createElement('span'); dot.className = 'dot ' + x.type + (x.size || x.type === 'solid' ? '' : ' ns'); mk.appendChild(dot); }
  var tm = document.createElement('span'); tm.className = 'time'; tm.textContent = withDay ? fmtWhen(x.t) : fmtTime(x.t);
  var wh = document.createElement('span'); wh.className = 'what' + (sl ? ' soft' : '');
  wh.appendChild(document.createTextNode(NAMES[x.type] + (x.type === 'pass' && isNight(x.t) ? ' (night)' : '')));
  function tag(t) { var sp = document.createElement('span'); sp.className = 'tag'; sp.textContent = t; wh.appendChild(sp); }
  if (x.type === 'drink' && x.kind) tag(labelOf(KINDS, x.kind));
  if ((x.type === 'pass' || x.type === 'solid') && x.urgency && x.urgency !== 'none') tag(labelOf(URG, x.urgency));
  if (x.type === 'solid' && x.bristol) tag('Bristol ' + x.bristol);
  if (x.note) tag('Note');
  var sm = null;
  if (sl) { var st = x.type === 'wake' ? sleptText(x) : ''; if (st) { sm = document.createElement('small'); sm.textContent = st; } }
  else {
    sm = document.createElement('small');
    if (x.type === 'solid') sm.textContent = gapLine(x, info[x.id]);
    else if (x.size) sm.textContent = sizeText(x) + ' · ' + gapLine(x, info[x.id]);
    else { var a = document.createElement('span'); a.className = 'addsize'; a.textContent = 'Add size'; sm.appendChild(a); sm.appendChild(document.createTextNode(' · ' + gapLine(x, info[x.id]))); }
  }
  if (sm) wh.appendChild(sm);
  b.appendChild(mk); b.appendChild(tm); b.appendChild(wh);
  b.setAttribute('aria-label', NAMES[x.type] + ' at ' + fmtTime(x.t) + (!sl && x.type !== 'solid' && !x.size ? ', no size' : '') + '. Open details');
  b.addEventListener('click', function () { openSheet(x); });
  return b;
}
function renderLatest() {
  var wrap = $('list'), s = sorted().slice().reverse(), info = gaps();
  var today = startOfDay(Date.now());
  $('todayCount').textContent = s.filter(function (x) { return x.t >= today; }).length + ' today';
  wrap.textContent = '';
  if (!s.length) {
    var e = document.createElement('div'); e.className = 'empty';
    e.textContent = 'Tap a button when it happens. We work out the time between drinks and passes for you.';
    wrap.appendChild(e); return;
  }
  var h = wrap.clientHeight, n = Math.max(2, Math.min(5, Math.floor((h - MORE_H) / ROW_H)));
  s.slice(0, n).forEach(function (x) { wrap.appendChild(buildRow(x, info, true)); });
  var m = document.createElement('button'); m.type = 'button'; m.className = 'more';
  m.appendChild(document.createTextNode('All ' + s.length + ' entries')); m.appendChild(svgIcon('i-right', 16));
  m.addEventListener('click', function () { dayOffset = 0; renderLog(); showOverlay('logSheet'); });
  wrap.appendChild(m);
}
function renderLog() {
  var r = dayRange(dayOffset), s = sorted(), info = gaps();
  var day = between(s, r[0], r[1]);
  $('dayLabel').textContent = dayOffset === 0 ? 'Today' : dayOffset === -1 ? 'Yesterday'
    : new Date(r[0]).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });
  $('next').disabled = dayOffset >= 0;
  var wrap = $('logList'); wrap.textContent = '';
  if (!day.length) { var e = document.createElement('div'); e.className = 'empty'; e.textContent = 'Nothing was logged on this day.'; wrap.appendChild(e); return; }
  day.slice().reverse().forEach(function (x) { wrap.appendChild(buildRow(x, info, false)); });
}
function renderList() { renderLatest(); if (!$('logSheet').hidden) renderLog(); }

function nightSegments(from, step, count) {
  var segs = [], cur = null;
  for (var k = 0; k < count; k++) {
    var n = isNight(from + k * step + step / 2);
    if (n && cur === null) cur = k;
    if (!n && cur !== null) { segs.push([cur, k]); cur = null; }
  }
  if (cur !== null) segs.push([cur, count]);
  return segs;
}
function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; }
function segBar(parts) {
  var bar = el('div', 'seg');
  parts.forEach(function (p) { if (!p.n) return; var d = el('div', '', p.text || ''); d.style.flex = String(p.n); d.style.background = p.color; d.style.color = p.ink; bar.appendChild(d); });
  return bar;
}
function signed(n, f) { return n === 0 ? 'same' : (n > 0 ? '+' : '−') + f(Math.abs(n)); }
function periodStats(a, b) { return periodStatsOf(sorted(), a, b, isNight); }
function tile(label, wide) { var t = el('div', 'tile' + (wide ? ' wide' : '')); t.appendChild(el('div', 'l', label)); return t; }
function renderInsights() {
  each('[data-range]', function (c) { c.setAttribute('aria-pressed', +c.getAttribute('data-range') === rangeDays ? 'true' : 'false'); });
  var plot = $('plot'), lab = $('dayLabels'), tl = $('tlLab'), s = sorted();
  plot.textContent = ''; lab.textContent = ''; tl.textContent = '';
  var amount = settings.dotScale === 'amount' && rangeDays <= 7, anyNoSize = false;
  var solidLane = settings.trackSolid || s.some(function (x) { return x.type === 'solid'; });
  var rangeItems = [], passes = [], passFlags = [], vols = [], nightPasses = 0, withData = 0, inMl = 0, inC = 0, outMl = 0, outC = 0, dayIn = [], dayOut = [];
  function mk(x, cls, left, cy, base) {
    var size = (x.size && amount) ? Math.max(5, Math.min(solidLane ? 9 : 13, Math.round(5 + x.size.ml / 400 * 7))) : base;
    var noSize = !x.size && x.type !== 'solid';
    if (noSize) anyNoSize = true;
    var d = document.createElement('button'); d.type = 'button'; d.className = 'd ' + cls + (noSize ? ' ns' : '');
    d.setAttribute('aria-label', NAMES[x.type] + ' at ' + fmtTime(x.t) + (x.size ? ', ' + fmtVol(x.size.ml) : (x.type === 'solid' ? '' : ', no size')) + '. Open details');
    d.addEventListener('click', function () { openSheet(x); });
    d.style.width = d.style.height = size + 'px'; d.style.marginLeft = (-size / 2) + 'px'; d.style.left = left + '%'; d.style.top = (cy - size / 2) + 'px';
    plot.appendChild(d); return d;
  }
  if (rangeDays === 1) {
    var now = Date.now(), start = now - DAY, step = 10 * 60000, count = 144;
    lab.style.display = 'none'; $('axis').hidden = true; tl.hidden = false; plot.style.height = '84px';
    nightSegments(start, step, count).forEach(function (sg) {
      var d = document.createElement('div'); d.className = 'nb';
      d.style.left = (sg[0] / count * 100) + '%'; d.style.width = ((sg[1] - sg[0]) / count * 100) + '%'; d.style.top = '0'; d.style.height = '100%'; plot.appendChild(d);
    });
    var items = between(s, start, now + 1);
    rangeItems = items.filter(function (x) { return !isSleep(x); });
    items.forEach(function (x) {
      var pos = Math.max(1, Math.min(99, (x.t - start) / DAY * 100));
      if (isSleep(x)) { var t = document.createElement('div'); t.className = 'tick'; t.style.left = pos + '%'; plot.appendChild(t); return; }
      mk(x, x.type, pos, solidLane ? (x.type === 'drink' ? 16 : x.type === 'solid' ? 42 : 68) : (x.type === 'drink' ? 22 : 62), 10);
      if (x.type === 'pass') { passes.push(x.t); var nn = isNight(x.t); passFlags.push(nn); if (nn) nightPasses++; if (x.size) { vols.push(x.size.ml); outMl += x.size.ml; outC++; } }
      else if (x.type === 'drink' && x.size) { inMl += x.size.ml; inC++; }
    });
    function label(txt, pos) { var sp = document.createElement('span'); sp.textContent = txt; sp.style.left = pos + '%'; tl.appendChild(sp); }
    label('24 h ago', 7); label('Now', 95);
    for (var tt = Math.ceil(start / H) * H; tt < now; tt += H) {
      var dt = new Date(tt);
      if (dt.getHours() % 6 === 0) { var ps = (tt - start) / DAY * 100; if (ps > 20 && ps < 85) label(pad(dt.getHours()) + ':00', ps); }
    }
  } else {
    lab.style.display = ''; $('axis').hidden = false; tl.hidden = true;
    var rowH = rangeDays <= 7 ? 28 : rangeDays <= 14 ? 18 : 12;
    var base = rangeDays <= 7 ? (solidLane ? 7 : 8) : rangeDays <= 14 ? (solidLane ? 5 : 6) : (solidLane ? 3 : 4);
    var cD = solidLane ? (rangeDays <= 7 ? 6 : rangeDays <= 14 ? 3 : 2) : (rangeDays <= 7 ? 8 : rangeDays <= 14 ? 5 : 3.5);
    var cS = rangeDays <= 7 ? 14 : rangeDays <= 14 ? 9 : 6;
    var cP = solidLane ? (rangeDays <= 7 ? 22 : rangeDays <= 14 ? 15 : 10) : (rangeDays <= 7 ? 20 : rangeDays <= 14 ? 13 : 8.5);
    plot.style.height = (rangeDays * rowH) + 'px'; lab.style.height = (rangeDays * rowH) + 'px';
    var firstStart = null;
    for (var i = 0; i < rangeDays; i++) {
      (function (i) {
        var off = -(rangeDays - 1 - i), r = dayRange(off), ds = r[0];
        if (i === 0) firstStart = ds;
        var l = document.createElement('div'); l.style.height = rowH + 'px'; l.style.lineHeight = rowH + 'px';
        var showLab = rangeDays <= 14 || i % 5 === 0 || off === 0;
        l.textContent = !showLab ? '' : off === 0 ? 'Today' : rangeDays <= 7 ? new Date(ds).toLocaleDateString([], { weekday: 'short' }) : new Date(ds).toLocaleDateString([], { day: 'numeric', month: 'short' });
        lab.appendChild(l);
        if (i > 0) { var ln = document.createElement('div'); ln.className = 'ln'; ln.style.top = (i * rowH) + 'px'; plot.appendChild(ln); }
        nightSegments(ds, 15 * 60000, 96).forEach(function (sg) {
          var d = document.createElement('div'); d.className = 'nb';
          d.style.left = (sg[0] / 96 * 100) + '%'; d.style.width = ((sg[1] - sg[0]) / 96 * 100) + '%';
          d.style.top = (i * rowH) + 'px'; d.style.height = rowH + 'px'; plot.appendChild(d);
        });
        var items = between(s, r[0], r[1]).filter(function (x) { return !isSleep(x); });
        if (items.length) withData++;
        rangeItems = rangeItems.concat(items);
        items.forEach(function (x) { mk(x, x.type, (x.t - ds) / DAY * 100, i * rowH + (x.type === 'drink' ? cD : x.type === 'solid' ? cS : cP), base); });
        var si = sum(items.filter(function (x) { return x.type === 'drink'; })), so = sum(items.filter(function (x) { return x.type === 'pass'; }));
        dayIn.push(si[0]); dayOut.push(so[0]); if (si[1]) inC++; if (so[1]) outC++;
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
  li('', 'background:var(--drink)', 'Drink'); li('', 'background:var(--pass)', 'Pass'); if (solidLane) li('solidkey', '', 'Solid'); li('band', '', 'Night');
  if (anyNoSize) li('ring', '', 'No size');
  if (amount) { var sp2 = el('span'); [6, 9, 12].forEach(function (z) { var i = el('i'); i.style.cssText = 'background:var(--muted);width:' + z + 'px;height:' + z + 'px'; sp2.appendChild(i); }); sp2.appendChild(document.createTextNode('Bigger dot, bigger amount')); lg.appendChild(sp2); }

  // tiles
  var tiles = $('tiles'); tiles.textContent = ''; var multi = rangeDays > 1;
  var gp = [];
  for (var k = 1; k < passes.length; k++) if (passes[k] - passes[k - 1] < DAY) gp.push(passes[k] - passes[k - 1]);

  var cmp = null;
  if (settings.compare) {
    var nowT = Date.now(), curA = rangeDays === 1 ? nowT - DAY : dayRange(-(rangeDays - 1))[0];
    var prevA = rangeDays === 1 ? nowT - 2 * DAY : dayRange(-(2 * rangeDays - 1))[0], prevB = rangeDays === 1 ? nowT - DAY : curA;
    cmp = { cur: periodStats(curA, nowT + 1), prev: periodStats(prevA, prevB), label: 'vs previous ' + (rangeDays === 1 ? '24 h' : rangeDays + ' days') };
  }
  function avgOf(ml, n) { return multi ? (n ? ml / n : 0) : ml; }
  var io = tile(multi ? 'In and out, per day' : 'In and out', true);
  var iv = inC ? (multi ? inMl / inC : inMl) : 0, ov = outC ? (multi ? outMl / outC : outMl) : 0, mx = Math.max(iv, ov);
  if (!mx) io.appendChild(el('div', 'empty2', 'Add sizes to your entries to see volumes.'));
  else [['In', iv, 'var(--drink)'], ['Out', ov, 'var(--pass)']].forEach(function (q) {
    var row = el('div', 'io'); row.appendChild(el('span', 'k', q[0]));
    var tr = el('div', 'track'), f = el('div', 'fill'); f.style.width = (q[1] / mx * 100) + '%'; f.style.background = q[2]; tr.appendChild(f); row.appendChild(tr);
    row.appendChild(el('span', 'v', q[1] ? fmtVol(q[1]) : '–')); io.appendChild(row);
  });
  if (cmp) {
    if (cmp.prev.outN || cmp.prev.inN) io.appendChild(el('div', 'sub', 'Out ' + signed(avgOf(cmp.cur.outMl, cmp.cur.outN) - avgOf(cmp.prev.outMl, cmp.prev.outN), fmtVol) + ' · In ' + signed(avgOf(cmp.cur.inMl, cmp.cur.inN) - avgOf(cmp.prev.inMl, cmp.prev.inN), fmtVol) + ' ' + cmp.label));
    else io.appendChild(el('div', 'sub', 'No earlier data to compare.'));
  }
  tiles.appendChild(io);

  var gt = tile('Typical gap');
  gt.appendChild(el('div', 'n', gp.length ? fmtDur(median(gp)) : '–'));
  if (gp.length) {
    var rec = gp.slice(-12), gmax = Math.max.apply(null, rec), sp = el('div', 'spark');
    rec.forEach(function (g) { var b = el('span'); b.style.height = Math.max(8, g / gmax * 100) + '%'; sp.appendChild(b); });
    var ml = el('i'); ml.style.bottom = (median(gp) / gmax * 100) + '%'; sp.appendChild(ml); gt.appendChild(sp);
    gt.appendChild(el('div', 'sub', 'Longest ' + fmtDur(Math.max.apply(null, gp))));
  }
  if (cmp && cmp.cur.med !== null && cmp.prev.med !== null) gt.appendChild(el('div', 'sub', signed(cmp.cur.med - cmp.prev.med, fmtDur) + ' ' + cmp.label));
  tiles.appendChild(gt);

  var nt = tile(multi ? 'Night passes, per night' : 'Night passes');
  var nv = el('div', 'n');
  if (!passes.length) nv.textContent = '–';
  else if (multi) nv.textContent = (Math.round(nightPasses / Math.max(1, withData) * 10) / 10) + ' a night';
  else { nv.appendChild(document.createTextNode(String(nightPasses) + ' ')); nv.appendChild(el('small', '', 'of ' + passes.length)); }
  nt.appendChild(nv);
  if (passes.length && !multi && passes.length <= 12) {
    var ic = el('div', 'nicons'); passFlags.forEach(function (f) { ic.appendChild(svgIcon(f ? 'i-moon' : 'i-sun', 18, f ? '' : 'day')); }); nt.appendChild(ic);
  } else if (passes.length) {
    var nb = el('div', 'nbar'), nf = el('div'); nf.style.width = (nightPasses / passes.length * 100) + '%'; nb.appendChild(nf); nt.appendChild(nb);
    nt.appendChild(el('div', 'sub', nightPasses + ' of ' + passes.length + ' passes at night'));
  }
  if (cmp && cmp.prev.passes.length) nt.appendChild(el('div', 'sub', signed(cmp.cur.night - cmp.prev.night, String) + ' ' + cmp.label));
  tiles.appendChild(nt);

  var solidsR = rangeItems.filter(function (x) { return x.type === 'solid'; });
  if (settings.trackSolid || solidsR.length) {
    var sdt = tile(multi ? 'Solids, per day' : 'Solids', true), sdv = el('div', 'n');
    sdv.textContent = !solidsR.length ? '–' : multi ? (Math.round(solidsR.length / rangeDays * 10) / 10) + ' a day' : String(solidsR.length);
    sdt.appendChild(sdv);
    if (solidsR.length > 1) { var sgp = []; for (var q = 1; q < solidsR.length; q++) sgp.push(solidsR[q].t - solidsR[q - 1].t); sdt.appendChild(el('div', 'sub', 'Typical gap ' + fmtDur(median(sgp)))); }
    else if (solidsR.length) sdt.appendChild(el('div', 'sub', 'Last ' + agoText(solidsR[0].t)));
    var bc = [0, 0, 0, 0, 0, 0, 0, 0];
    solidsR.forEach(function (x) { if (x.bristol >= 1 && x.bristol <= 7) bc[x.bristol]++; else bc[0]++; });
    if (bc.reduce(function (a, b) { return a + b; }, 0) - bc[0] > 0) {
      var BR = ['#e8d9cc', '#d9bfa8', '#c5a283', '#a98160', '#8a6a4f', '#6e533d', '#4f3b2b'], parts = [], bl = [];
      for (var z = 1; z <= 7; z++) if (bc[z]) { parts.push({ n: bc[z], color: BR[z - 1], ink: z <= 4 ? '#2a1d12' : '#ffffff', text: String(z) }); bl.push('Type ' + z + ': ' + bc[z]); }
      if (bc[0]) { parts.push({ n: bc[0], color: '#e3edf2', ink: '#5f7a8a', text: '–' }); bl.push('Not recorded: ' + bc[0]); }
      sdt.appendChild(segBar(parts)); sdt.appendChild(el('div', 'sub', 'Bristol scale. ' + bl.join(' · ')));
    }
    if (cmp && cmp.prev.solids) sdt.appendChild(el('div', 'sub', signed(cmp.cur.solids - cmp.prev.solids, String) + ' ' + cmp.label));
    tiles.appendChild(sdt);
  }

  var st = tile('Pass sizes', true), sc = { small: 0, medium: 0, large: 0, exact: 0, none: 0 };
  rangeItems.forEach(function (x) { if (x.type !== 'pass') return; if (!x.size) sc.none++; else sc[sc[x.size.label] !== undefined ? x.size.label : 'exact']++; });
  if (!(sc.small + sc.medium + sc.large + sc.exact + sc.none)) st.appendChild(el('div', 'empty2', 'No passes in this range.'));
  else st.appendChild(segBar([
    { n: sc.small, color: '#ffeb99', ink: '#3d3000', text: 'Small ' + sc.small }, { n: sc.medium, color: '#f6c800', ink: '#3d3000', text: 'Medium ' + sc.medium },
    { n: sc.large, color: '#c79f00', ink: '#2a2100', text: 'Large ' + sc.large }, { n: sc.exact, color: '#8f6f00', ink: '#ffffff', text: 'Exact ' + sc.exact },
    { n: sc.none, color: '#e3edf2', ink: '#5f7a8a', text: 'No size ' + sc.none }]));
  tiles.appendChild(st);

  if (settings.showUrgency) {
    var ut = tile('Urgency of passes', true), uc = { none: 0, mild: 0, strong: 0, cantwait: 0, na: 0 };
    rangeItems.forEach(function (x) { if (x.type !== 'pass') return; uc[x.urgency && uc[x.urgency] !== undefined ? x.urgency : 'na']++; });
    var utot = uc.none + uc.mild + uc.strong + uc.cantwait + uc.na;
    if (!utot) ut.appendChild(el('div', 'empty2', 'No passes in this range.'));
    else {
      ut.appendChild(segBar([
        { n: uc.none, color: '#fff6cc', ink: '#3d3000', text: String(uc.none) }, { n: uc.mild, color: '#ffeb99', ink: '#3d3000', text: String(uc.mild) },
        { n: uc.strong, color: '#c79f00', ink: '#2a2100', text: String(uc.strong) }, { n: uc.cantwait, color: '#8f6f00', ink: '#ffffff', text: String(uc.cantwait) },
        { n: uc.na, color: '#e3edf2', ink: '#5f7a8a', text: String(uc.na) }]));
      var ul = []; if (uc.none) ul.push('None ' + uc.none); if (uc.mild) ul.push('Mild ' + uc.mild); if (uc.strong) ul.push('Strong ' + uc.strong); if (uc.cantwait) ul.push('Couldn’t wait ' + uc.cantwait); if (uc.na) ul.push('Not recorded ' + uc.na);
      ut.appendChild(el('div', 'sub', ul.join(' · ')));
    }
    tiles.appendChild(ut);
  }

  if (settings.showKind) {
    var kt = tile('Drink types', true), kn = {}, kv = {}, anyMl = false;
    rangeItems.forEach(function (x) { if (x.type !== 'drink') return; var key = x.kind || 'na'; kn[key] = (kn[key] || 0) + 1; if (x.size) { kv[key] = (kv[key] || 0) + x.size.ml; anyMl = true; } });
    var KC = { water: ['#187cc2', '#ffffff'], teacoffee: ['#7bb8e0', '#0e2a3b'], alcohol: ['#0e2a3b', '#ffffff'], other: ['#a9bcc7', '#0e2a3b'], na: ['#e3edf2', '#5f7a8a'] };
    var keys = ['water', 'teacoffee', 'alcohol', 'other', 'na'].filter(function (q) { return kn[q]; });
    if (!keys.length) kt.appendChild(el('div', 'empty2', 'No drinks in this range.'));
    else {
      kt.appendChild(segBar(keys.map(function (q) { return { n: anyMl ? (kv[q] || 0) : kn[q], color: KC[q][0], ink: KC[q][1], text: q === 'na' ? '' : labelOf(KINDS, q) }; })));
      kt.appendChild(el('div', 'sub', keys.map(function (q) { return (q === 'na' ? 'Not recorded' : labelOf(KINDS, q)) + ' ' + (kv[q] ? fmtVol(kv[q]) : kn[q] + '×'); }).join(' · ')));
    }
    tiles.appendChild(kt);
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
function buildDiaryChart(box, data) {
  box.textContent = '';
  var solidLane = settings.trackSolid || log.some(function (x) { return x.type === 'solid'; });
  var rowH = 28, wrap = el('div', 'plotwrap'), lab = el('div', 'daylabels'), mid = el('div'), plot = el('div', 'plot');
  mid.style.cssText = 'flex:1;min-width:0'; lab.style.height = plot.style.height = (data.length * rowH) + 'px'; lab.style.width = '56px';
  var cD = solidLane ? 6 : 8, cS = 14, cP = solidLane ? 22 : 20, base = solidLane ? 7 : 8;
  data.forEach(function (d, i) {
    var l = el('div', '', new Date(d.start).toLocaleDateString([], { weekday: 'short', day: 'numeric' })); l.style.cssText = 'height:' + rowH + 'px;line-height:' + rowH + 'px'; lab.appendChild(l);
    if (i > 0) { var ln = el('div', 'ln'); ln.style.top = (i * rowH) + 'px'; plot.appendChild(ln); }
    nightSegments(d.start, 15 * 60000, 96).forEach(function (sg) {
      var nb = el('div', 'nb'); nb.style.left = (sg[0] / 96 * 100) + '%'; nb.style.width = ((sg[1] - sg[0]) / 96 * 100) + '%'; nb.style.top = (i * rowH) + 'px'; nb.style.height = rowH + 'px'; plot.appendChild(nb);
    });
    d.items.forEach(function (x) {
      if (isSleep(x)) return;
      var dt = el('div', 'd ' + x.type + (!x.size && x.type !== 'solid' ? ' ns' : ''));
      dt.style.width = dt.style.height = base + 'px'; dt.style.marginLeft = (-base / 2) + 'px'; dt.style.left = ((x.t - d.start) / DAY * 100) + '%';
      dt.style.top = (i * rowH + (x.type === 'drink' ? cD : x.type === 'solid' ? cS : cP) - base / 2) + 'px'; dt.style.pointerEvents = 'none'; plot.appendChild(dt);
    });
  });
  mid.appendChild(plot);
  var ax = el('div', 'axis'); ['00', '06', '12', '18', '24'].forEach(function (t) { ax.appendChild(el('span', '', t)); }); mid.appendChild(ax);
  wrap.appendChild(lab); wrap.appendChild(mid); box.appendChild(wrap);
  var lg = el('div', 'legend');
  function li(cls, style, txt) { var sp = el('span'), i = el('i', cls); if (style) i.style.cssText = style; sp.appendChild(i); sp.appendChild(document.createTextNode(txt)); lg.appendChild(sp); }
  li('', 'background:var(--drink)', 'Drink'); li('', 'background:var(--pass)', 'Pass'); if (solidLane) li('solidkey', '', 'Solid'); li('band', '', 'Night'); li('ring', '', 'No size');
  box.appendChild(lg);
}
function renderReport() {
  each('[data-days]', function (c) { c.setAttribute('aria-pressed', +c.getAttribute('data-days') === reportDays ? 'true' : 'false'); });
  var data = reportData(), box = $('reportTable'); box.textContent = '';
  var fd = function (ms) { return new Date(ms).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); };
  var ttl = $('reportTitle'); ttl.textContent = '';
  var h = el('div', '', 'Drink & Pass diary'); h.style.cssText = 'font-size:1.3rem;font-weight:600'; ttl.appendChild(h);
  ttl.appendChild(el('div', 'hint', data.length === 1 ? fd(data[0].start) : fd(data[0].start) + ' to ' + fd(data[data.length - 1].start)));
  ttl.appendChild(el('div', 'hint', 'Times are local. Volumes in ' + (settings.unit === 'oz' ? 'fl oz' : 'ml') + '. Sizes are estimates unless measured.'));
  buildDiaryChart($('reportChart'), data);
  var t = document.createElement('table'); t.className = 'rep'; t.style.marginTop = '12px';
  var head = t.createTHead().insertRow();
  ['Time', 'Drink in', 'Pass out'].forEach(function (hh) { var th = document.createElement('th'); th.textContent = hh; head.appendChild(th); });
  var tb = t.createTBody();
  data.forEach(function (d) {
    var hr = tb.insertRow(); hr.className = 'dayhead';
    var c = hr.insertCell(); c.colSpan = 3;
    c.textContent = new Date(d.start).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
    var tin = 0, tout = 0, np = 0, nn = 0, ns = 0;
    d.items.forEach(function (x) {
      var r = tb.insertRow();
      r.insertCell().textContent = fmtTime(x.t);
      if (isSleep(x)) { var sc = r.insertCell(); sc.colSpan = 2; sc.className = 'sleep'; sc.textContent = NAMES[x.type]; return; }
      if (x.type === 'solid') {
        var sd = r.insertCell(); sd.colSpan = 2; ns++;
        sd.textContent = 'Solid' + (x.bristol ? ', Bristol ' + x.bristol : '') + (x.urgency && x.urgency !== 'none' ? ', urgency: ' + labelOf(URG, x.urgency).toLowerCase() : '');
        return;
      }
      var a = r.insertCell(), b = r.insertCell();
      var txt = x.size ? fmtVol(x.size.ml) : 'logged';
      if (x.type === 'drink') { a.textContent = txt + (x.kind ? ' (' + labelOf(KINDS, x.kind).toLowerCase() + ')' : ''); if (x.size) tin += x.size.ml; }
      else {
        b.textContent = txt + (isNight(x.t) ? ' (night)' : '') + (x.urgency && x.urgency !== 'none' ? ', urgency: ' + labelOf(URG, x.urgency).toLowerCase() : '');
        if (x.size) tout += x.size.ml; np++; if (isNight(x.t)) nn++;
      }
    });
    var tr = tb.insertRow(); tr.className = 'tot';
    tr.insertCell().textContent = 'Totals';
    tr.insertCell().textContent = tin ? fmtVol(tin) : '–';
    tr.insertCell().textContent = np + ' passes, ' + nn + ' at night' + (tout ? ', ' + fmtVol(tout) : '') + (ns ? ', ' + ns + ' solid' : '');
  });
  box.appendChild(t);
}
function csv() {
  var items = []; reportData().forEach(function (d) { items = items.concat(d.items); });
  return toCsv(items, isNight);
}
function copyText(text, msgEl, okMsg, onOk) {
  function done(ok) { msgEl.textContent = ok ? okMsg : 'Copy failed. Select and copy manually.'; if (ok && onOk) onOk(); setTimeout(function () { msgEl.textContent = ''; }, 2500); }
  function fallback() {
    try { var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); var ok = document.execCommand('copy'); document.body.removeChild(ta); done(ok); }
    catch (e) { done(false); }
  }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    else fallback();
  } catch (e) { fallback(); }
}
function saveFile(name, data, msgEl, onOk) {
  downloadFile({ filename: name, data: data }).then(function () { msgEl.textContent = 'Saved'; if (onOk) onOk(); setTimeout(function () { msgEl.textContent = ''; }, 2500); },
    function (e) { msgEl.textContent = (e && e.code === 'declined') ? 'Cancelled' : 'Couldn’t save. Use Copy instead.'; setTimeout(function () { msgEl.textContent = ''; }, 3000); });
}
function stamp() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

function render() {
  refreshSleep(); syncSleepBtn(); renderStats(); renderList(); updateNudge();
  if (!$('insightsSheet').hidden) renderInsights();
  if (!$('reportSheet').hidden) renderReport();
}
function showOverlay(id) { $(id).hidden = false; var c = $(id).querySelector('[data-close]'); if (c) c.focus(); }
function hideOverlay(id) { $(id).hidden = true; }

$('drinkBtn').addEventListener('click', function (e) { addEntry('drink', e); });
$('passBtn').addEventListener('click', function (e) { addEntry('pass', e); });
$('sleepBtn').addEventListener('click', function () { addEntry(isAsleep() ? 'wake' : 'bed'); });
$('whenPill').addEventListener('click', function () { toggleWhen($('whenOpts').hidden); });
each('[data-when]', function (b) { b.addEventListener('click', function () { setWhen(b.getAttribute('data-when')); }); });
$('pickTime').addEventListener('change', function () { $('whenText').textContent = whenLabel(); toggleWhen(false); });
$('prev').addEventListener('click', function () { dayOffset -= 1; renderList(); });
$('next').addEventListener('click', function () { if (dayOffset < 0) { dayOffset += 1; renderList(); } });
$('sheetSkip').addEventListener('click', closeSheet);
$('barUndo').addEventListener('click', function () { if (barRestore) { var re = barRestore; hideBar(); restoreEntry(re.entry, re.partner); } else if (barId) remove(barId); });
$('barMore').addEventListener('click', function () { var e = find(barId); if (e) openSheet(e); });
var swipeY = null;
$('bar').addEventListener('pointerdown', function (e) { swipeY = e.clientY; if (barId && rowsAsked(find(barId) || {}).length) armBar(10000); });
$('bar').addEventListener('pointerup', function (e) { if (swipeY !== null && swipeY - e.clientY > 30) hideBar(); swipeY = null; });
document.addEventListener('pointerdown', function (e) { if ((barId || barRestore) && !$('bar').contains(e.target)) hideBar(); });
$('sheetRemove').addEventListener('click', function () { if (!sheetId) return; var re = find(sheetId), rm = partner(re); remove(sheetId, true); if (re) showRemovedBar(re, rm); });
$('exactToggle').addEventListener('click', function () { $('exactRow').hidden = false; $('exactInput').focus(); });
$('exactSave').addEventListener('click', function () {
  var v = parseFloat($('exactInput').value);
  if (!(v > 0)) { $('exactInput').focus(); return; }
  setSize('exact', settings.unit === 'oz' ? v * OZ : v);
});
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
$('timeInput').addEventListener('change', function () {
  var e = find(sheetId); if (!e || !this.value) return;
  var t = new Date(this.value).getTime();
  if (isNaN(t)) return;
  if (t > Date.now() + 60000) { $('sheetInfo').textContent = 'The time can’t be in the future.'; $('sheetInfo').hidden = false; this.value = toLocalInput(e.t); return; }
  e.t = t; save();
  dayOffset = Math.min(0, Math.round((startOfDay(t) - startOfDay(Date.now())) / DAY));
  render(); openSheet(e, true);
});
function nudgeTime(dm) {
  var e = find(sheetId); if (!e) return;
  var t = e.t + dm * 60000;
  if (t > Date.now() + 60000) { $('sheetInfo').textContent = 'The time can’t be in the future.'; $('sheetInfo').hidden = false; return; }
  e.t = t; save(); dayOffset = Math.min(0, Math.round((startOfDay(t) - startOfDay(Date.now())) / DAY));
  render(); openSheet(e, true);
}
$('nudgeM').addEventListener('click', function () { nudgeTime(-5); });
$('nudgeP').addEventListener('click', function () { nudgeTime(5); });

$('nudgeNow').addEventListener('click', function () { syncSettings(); showOverlay('settingsSheet'); });
$('nudgeLater').addEventListener('click', function () { bk.snooze = Date.now() + DAY; saveBk(); updateNudge(); });
$('openInsights').addEventListener('click', function () { renderInsights(); showOverlay('insightsSheet'); });
$('openReport').addEventListener('click', function () { renderReport(); showOverlay('reportSheet'); });
$('openSettings').addEventListener('click', function () { syncSettings(); showOverlay('settingsSheet'); });
each('[data-close]', function (b) { b.addEventListener('click', function () { hideOverlay(b.getAttribute('data-close')); }); });
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    if (!$('sheet').hidden) closeSheet();
    else if (!$('reportSheet').hidden) hideOverlay('reportSheet');
    else if (!$('settingsSheet').hidden) hideOverlay('settingsSheet');
    else if (!$('logSheet').hidden) hideOverlay('logSheet');
    else hideOverlay('insightsSheet');
  }
});
each('[data-range]', function (b) { b.addEventListener('click', function () { rangeDays = +b.getAttribute('data-range'); settings.range = rangeDays; save(); reportDays = rangeDays > 7 ? 7 : rangeDays; renderInsights(); }); });
each('[data-days]', function (b) { b.addEventListener('click', function () { reportDays = +b.getAttribute('data-days'); renderReport(); }); });
$('copyCsv').addEventListener('click', function () { copyText(csv(), $('reportMsg'), 'CSV copied'); });
$('dlCsv').addEventListener('click', function () { saveFile('drink-pass-' + stamp() + '.csv', csv(), $('reportMsg')); });
$('printBtn').addEventListener('click', function () {
  try { document.body.classList.add('printing'); window.print(); }
  catch (e) { $('reportMsg').textContent = 'Printing isn’t available here. Use Download or Copy as CSV instead.'; }
  document.body.classList.remove('printing');
});
each('[data-unit]', function (b) {
  b.addEventListener('click', function () { settings.unit = b.getAttribute('data-unit'); save(); syncSettings(); if (sheetId) closeSheet(); render(); });
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
$('nightStart').addEventListener('change', function () { if (this.value) { settings.nightStart = this.value; save(); render(); } });
$('nightEnd').addEventListener('change', function () { if (this.value) { settings.nightEnd = this.value; save(); render(); } });
function backupText() { return JSON.stringify({ version: 1, schema: 2, app: 'drink-pass-journal', exportedAt: new Date().toISOString(), count: log.length, log: log, settings: settings }); }
$('copyBackup').addEventListener('click', function () { copyText(backupText(), $('backupMsg'), 'Backup copied', markBackup); });
$('dlBackup').addEventListener('click', function () { saveFile('drink-pass-backup-' + stamp() + '.json', backupText(), $('backupMsg'), markBackup); });

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
        $('recoverText').textContent = 'We found an automatic copy with ' + missing.length + ' ' + (missing.length === 1 ? 'entry' : 'entries') + ' that ' + (missing.length === 1 ? 'isn’t' : 'aren’t') + ' in your journal. Restore ' + (missing.length === 1 ? 'it' : 'them') + '?';
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
  maybeSnapshot(true, 'Before recovery').then(function () {
    var have = {}; log.forEach(function (x) { have[x.id] = 1; });
    rp.entries.forEach(function (x) { if (!have[x.id]) log.push(x); });
    save(); render(); $('recover').hidden = true; mirrorNow(); backupMsgFlash('Restored ' + rp.entries.length + ' entries');
  });
});
$('recoverLater').addEventListener('click', function () {
  if (!recoveryPending) return;
  var rp = recoveryPending; recoveryPending = null; $('recover').hidden = true;
  try { localStorage.setItem('dp-dismissed', String(rp.at)); } catch (e) {}
  if (rp.wasMirror) { idbOp('snaps', 'readwrite', function (os) { return os.put({ at: rp.at, n: rp.log.length, log: rp.log, settings: rp.settings, label: 'Earlier copy' }); }).then(pruneSnaps); }
  mirrorNow();
});
function backupMsgFlash(t) { var m = $('backupMsg'); m.textContent = t; setTimeout(function () { m.textContent = ''; }, 3000); }

function storeStatus() {
  var parts = ['Entries: ' + log.length + '.'];
  parts.push('Installed as an app: ' + (isStandalone() ? 'yes.' : 'no.'));
  parts.push(idb ? 'Automatic copies: ' + snapCache.length + (snapCache.length ? ' (latest ' + agoText(snapCache[0].at) + ').' : '.') : 'Automatic copies aren’t available in this browser.');
  var el0 = $('storeStatus'), btn = $('persistBtn');
  var sm = navigator.storage;
  if (sm && sm.persisted) {
    sm.persisted().then(function (ok) {
      parts.push('Browser protection: ' + (ok ? 'on.' : 'not on.')); el0.textContent = parts.join(' '); btn.hidden = !!ok || !sm.persist;
    }, function () { el0.textContent = parts.join(' '); });
  } else { parts.push('Browser protection isn’t available here.'); el0.textContent = parts.join(' '); btn.hidden = true; }
}
function tryPersist() { if (persistTried) return; persistTried = true; try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().then(storeStatus, function () {}); } catch (e) {} }
$('persistBtn').addEventListener('click', function () {
  try { navigator.storage.persist().then(function (ok) { $('persistMsg').textContent = ok ? 'Done' : 'The browser said no. A backup file is the safest option.'; storeStatus(); setTimeout(function () { $('persistMsg').textContent = ''; }, 4000); }); } catch (e) {}
});
function renderSnaps() {
  var box = $('snapList'); if (!box) return; box.textContent = '';
  if (!snapCache.length) { box.appendChild(el('p', 'hint', 'No automatic copies yet. One is saved about once an hour while you log.')); return; }
  snapCache.slice(0, 8).forEach(function (sn) {
    var r = el('div', 'snaprow'); r.appendChild(el('span', '', fmtWhen(sn.at) + ' · ' + sn.n + ' entries' + (sn.label ? ' · ' + sn.label : '')));
    var b = el('button', 'btn', 'Check'); b.type = 'button'; b.addEventListener('click', function () { startRestore(JSON.stringify({ log: sn.log, settings: sn.settings })); }); r.appendChild(b); box.appendChild(r);
  });
}

function startRestore(text) {
  var d, msg = $('backupMsg');
  try { d = JSON.parse(text); if (!d || !Array.isArray(d.log)) throw new Error('bad'); } catch (e) { msg.textContent = 'That doesn’t look like a backup.'; setTimeout(function () { msg.textContent = ''; }, 3500); return; }
  var have = {}; log.forEach(function (x) { have[x.id] = 1; });
  var m = migrateLog(d.log, +d.schema || 1), fresh = [], dup = 0, bad = m.dropped;
  m.log.forEach(function (x) { if (have[x.id]) dup++; else fresh.push(x); });
  pendingRestore = { fresh: fresh, settings: (d.settings && typeof d.settings === 'object') ? d.settings : null };
  var line = 'Found ' + d.log.length + ' entries' + (d.exportedAt ? ', exported ' + new Date(d.exportedAt).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '') + '. ' + fresh.length + ' new, ' + dup + ' already here' + (bad ? ', ' + bad + ' skipped' : '') + '.';
  $('restorePrevText').textContent = line;
  $('restoreSetRow').hidden = !pendingRestore.settings; $('restoreSettings').checked = !!pendingRestore.settings;
  $('restoreGo').textContent = fresh.length ? 'Add ' + fresh.length + (fresh.length === 1 ? ' entry' : ' entries') : (pendingRestore.settings ? 'Restore settings' : 'Nothing to add');
  $('restoreGo').disabled = !fresh.length && !pendingRestore.settings;
  $('restorePrev').hidden = false;
}
$('restoreBtn').addEventListener('click', function () { startRestore($('restoreBox').value); });
$('restoreFile').addEventListener('change', function () {
  var f = this.files && this.files[0]; if (!f) return;
  var rd = new FileReader(); rd.onload = function () { startRestore(String(rd.result || '')); }; rd.onerror = function () { $('backupMsg').textContent = 'Couldn’t read that file.'; };
  rd.readAsText(f); this.value = '';
});
$('restoreCancel').addEventListener('click', function () { pendingRestore = null; $('restorePrev').hidden = true; });
$('restoreGo').addEventListener('click', function () {
  if (!pendingRestore) return;
  var pr = pendingRestore; pendingRestore = null;
  maybeSnapshot(true, 'Before restore').then(function () {
    pr.fresh.forEach(function (x) { log.push(x); });
    if (pr.settings && $('restoreSettings').checked) settings = sanitizeSettings(pr.settings, settings);
    rangeDays = settings.range; reportDays = rangeDays > 7 ? 7 : rangeDays;
    save(); render(); syncSettings(); $('restoreBox').value = ''; $('restorePrev').hidden = true;
    backupMsgFlash(pr.fresh.length + ' ' + (pr.fresh.length === 1 ? 'entry' : 'entries') + ' added');
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
document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') { flushNote(); mirrorNow(); } });
window.addEventListener('pagehide', flushNote);

function syncSettings() {
  each('[data-unit]', function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-unit') === settings.unit ? 'true' : 'false'); });
  each('[data-toggle]', function (b) { var k = b.getAttribute('data-toggle'); b.setAttribute('aria-pressed', (k === 'askSize' ? settings.askSize !== false : !!settings[k]) ? 'true' : 'false'); });
  each('[data-dots]', function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-dots') === (settings.dotScale || 'same') ? 'true' : 'false'); });
  $('nightStart').value = settings.nightStart; $('nightEnd').value = settings.nightEnd;
  backupStatus(); renderTrash(); storeStatus(); renderSnaps();
}

testStorage(); load(); $('storageWarn').hidden = storageOk; $('loadWarn').hidden = !loadProblem; syncSettings(); render();
idbOpen(function (ok) { if (ok) detectLoss(); else storeStatus(); });
try {
  if (window.ResizeObserver) {
    var ro = new ResizeObserver(function () { window.requestAnimationFrame(renderLatest); });
    ro.observe($('list'));
  }
} catch (e) {}
setInterval(function () { refreshSleep(); renderStats(); if (!$('insightsSheet').hidden && rangeDays === 1) renderInsights(); updateNudge(); }, 30000);

function downloadFile(opts) {
  var name = opts.filename, type = /\.json$/i.test(name) ? 'application/json' : /\.csv$/i.test(name) ? 'text/csv' : 'text/plain';
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
if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
  window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
}
