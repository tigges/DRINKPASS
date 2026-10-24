export var OZ = 29.5735, H = 3600000, DAY = 86400000;

export var VALID_TYPES = ['drink', 'pass', 'solid', 'bed', 'wake'];
export var PRESETS = {
  drink: [['Small', 150], ['Medium', 250], ['Large', 400]],
  pass: [['Small', 100], ['Medium', 250], ['Large', 400]]
};
export var URG = [['none', 'None'], ['mild', 'Mild'], ['strong', 'Strong'], ['cantwait', 'Couldn’t wait']];
export var KINDS = [['water', 'Water'], ['teacoffee', 'Tea or coffee'], ['alcohol', 'Alcohol'], ['other', 'Other']];
export var KINDS_SHORT = [['water', 'Water'], ['teacoffee', 'Tea/coffee'], ['alcohol', 'Alcohol'], ['other', 'Other']];
export var NAMES = { drink: 'Drink', pass: 'Pass', solid: 'Solid', bed: 'Going to bed', wake: 'Up for the day' };
export var BRISTOL = [[1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5'], [6, '6'], [7, '7']];

export function isSleep(x) { return x.type === 'bed' || x.type === 'wake'; }
export function pad(n) { return ('0' + n).slice(-2); }
export function mins(v) { var p = (v || '0:0').split(':'); return (+p[0]) * 60 + (+p[1]); }
export function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
export function labelOf(list, v) { for (var i = 0; i < list.length; i++) if (list[i][0] === v) return list[i][1]; return ''; }
export function median(a) { var b = a.slice().sort(function (x, y) { return x - y; }), m = Math.floor(b.length / 2); return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; }

export function startOfDay(ms) { var d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
export function dayRange(offset, now) {
  var b = new Date(now === undefined ? Date.now() : now); b.setHours(0, 0, 0, 0); b.setDate(b.getDate() + offset);
  var e = new Date(b); e.setDate(e.getDate() + 1);
  return [b.getTime(), e.getTime()];
}
export function fmtTime(ms) { return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
export function fmtDur(ms) {
  var m = Math.round(ms / 60000);
  if (m < 1) return 'under a minute';
  if (m < 60) return m + ' min';
  var h = Math.floor(m / 60), r = m % 60;
  return r ? h + ' h ' + r + ' min' : h + ' h';
}
export function agoText(ms, now) { var d = (now === undefined ? Date.now() : now) - ms; return d < 60000 ? 'just now' : fmtDur(d) + ' ago'; }
export function fmtVol(ml, unit) { return unit === 'oz' ? (Math.round(ml / OZ * 10) / 10) + ' fl oz' : Math.round(ml).toLocaleString() + ' ml'; }
export function toLocalInput(ms) { var d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
export function isoDate(ms) { var d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
export function sortEntries(log) { return log.slice().sort(function (a, b) { return a.t - b.t; }); }

function inferBed(wakeT, lastWake, nightStart) {
  var p = (nightStart || '22:00').split(':'), d = new Date(wakeT); d.setHours(+p[0], +p[1], 0, 0);
  var t = d.getTime(); if (t >= wakeT) t -= DAY;
  return Math.max(t, lastWake);
}
/** Sleep periods as [start, end, inferred] from bed/wake markers in time-sorted entries. */
export function sleepModel(sorted, nightStart) {
  var m = sorted.filter(isSleep), out = [], openBed = null, lastWake = -Infinity;
  m.forEach(function (x) {
    if (x.type === 'bed') { if (openBed !== null) out.push([openBed, openBed + 12 * H, false]); openBed = x.t; }
    else {
      if (openBed !== null) { out.push([openBed, x.t, false]); openBed = null; }
      else out.push([inferBed(x.t, lastWake, nightStart), x.t, true]);
      lastWake = x.t;
    }
  });
  if (openBed !== null) out.push([openBed, openBed + 12 * H, false]);
  return { periods: out, markers: m.map(function (x) { return x.t; }), last: m[m.length - 1] || null };
}
export function clockNight(ms, nightStart, nightEnd) {
  var d = new Date(ms), m = d.getHours() * 60 + d.getMinutes();
  var s = mins(nightStart), e = mins(nightEnd);
  if (s === e) return false;
  return s > e ? (m >= s || m < e) : (m >= s && m < e);
}
export function isNightAt(ms, model, nightStart, nightEnd) {
  var i, periods = model.periods, markers = model.markers;
  for (i = 0; i < periods.length; i++) if (ms >= periods[i][0] && ms < periods[i][1]) return true;
  for (i = 0; i < markers.length; i++) if (Math.abs(ms - markers[i]) < 12 * H) return false;
  return clockNight(ms, nightStart, nightEnd);
}
export function isAsleepAt(model, now) {
  var l = model.last;
  return !!(l && l.type === 'bed' && now - l.t < 16 * H);
}

/** Time since the previous drink, pass and solid for every non-sleep entry, keyed by id. */
export function computeGaps(sorted) {
  var info = {}, lastD = null, lastP = null, lastS = null;
  sorted.forEach(function (x) {
    if (isSleep(x)) return;
    if (x.type === 'solid') { info[x.id] = { solid: lastS !== null ? x.t - lastS : null }; lastS = x.t; return; }
    info[x.id] = { drink: lastD !== null ? x.t - lastD : null, pass: lastP !== null ? x.t - lastP : null };
    if (x.type === 'drink') lastD = x.t; else lastP = x.t;
  });
  return info;
}

export function periodStats(sorted, a, b, isNight) {
  var st = { outMl: 0, inMl: 0, outDays: {}, inDays: {}, night: 0, passes: [], solids: 0, med: null };
  sorted.forEach(function (x) {
    if (x.t < a || x.t >= b || isSleep(x)) return;
    var dk = startOfDay(x.t);
    if (x.type === 'pass') { st.passes.push(x.t); if (isNight(x.t)) st.night++; if (x.size) { st.outMl += x.size.ml; st.outDays[dk] = 1; } }
    else if (x.type === 'drink') { if (x.size) { st.inMl += x.size.ml; st.inDays[dk] = 1; } }
    else if (x.type === 'solid') st.solids++;
  });
  var g = []; for (var k = 1; k < st.passes.length; k++) if (st.passes[k] - st.passes[k - 1] < DAY) g.push(st.passes[k] - st.passes[k - 1]);
  st.med = g.length ? median(g) : null; st.outN = Object.keys(st.outDays).length; st.inN = Object.keys(st.inDays).length;
  return st;
}

export var SCHEMA = 2;
export var DEFAULT_SETTINGS = { unit: 'ml', nightStart: '22:00', nightEnd: '06:00', askSize: true, showUrgency: true, showKind: true, range: 1, dotScale: 'same', trackSolid: false, showBristol: false, compare: false };
var SIZE_LABELS = ['small', 'medium', 'large', 'exact'];
var TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
var EARLIEST = Date.UTC(2000, 0, 1);

function inList(list, v) { for (var i = 0; i < list.length; i++) if (list[i][0] === v) return true; return false; }
/** A clean copy of an entry with only known, well-typed fields, or null when it can't be used. */
export function sanitizeEntry(x, now) {
  if (!x || typeof x !== 'object') return null;
  var limit = (now === undefined ? Date.now() : now) + DAY;
  if (typeof x.id !== 'string' || !x.id || x.id.length > 64) return null;
  if (VALID_TYPES.indexOf(x.type) < 0) return null;
  if (typeof x.t !== 'number' || !isFinite(x.t) || x.t < EARLIEST || x.t > limit) return null;
  var e = { id: x.id, type: x.type, t: Math.round(x.t) };
  if ((x.type === 'drink' || x.type === 'pass') && x.size && typeof x.size === 'object') {
    var ml = +x.size.ml;
    if (isFinite(ml) && ml > 0 && ml <= 5000) e.size = { label: SIZE_LABELS.indexOf(x.size.label) > -1 ? x.size.label : 'exact', ml: ml };
  }
  if (x.type === 'drink' && inList(KINDS, x.kind)) e.kind = x.kind;
  if ((x.type === 'pass' || x.type === 'solid') && inList(URG, x.urgency)) e.urgency = x.urgency;
  if (x.type === 'solid' && Number.isInteger(x.bristol) && x.bristol >= 1 && x.bristol <= 7) e.bristol = x.bristol;
  if (typeof x.note === 'string' && x.note.trim() && x.type !== 'bed' && x.type !== 'wake') e.note = x.note.trim().slice(0, 200);
  if (x.type === 'pass' && typeof x.withSolid === 'string') e.withSolid = x.withSolid;
  if (x.type === 'solid' && typeof x.withPass === 'string') e.withPass = x.withPass;
  return e;
}
/** Known settings with the right types; anything missing or malformed falls back to `base`. */
export function sanitizeSettings(q, base) {
  var out = {}, b = base || DEFAULT_SETTINGS;
  Object.keys(DEFAULT_SETTINGS).forEach(function (k) { out[k] = b[k] !== undefined ? b[k] : DEFAULT_SETTINGS[k]; });
  if (!q || typeof q !== 'object') return out;
  if (q.unit === 'ml' || q.unit === 'oz') out.unit = q.unit;
  if (TIME_RE.test(q.nightStart)) out.nightStart = q.nightStart;
  if (TIME_RE.test(q.nightEnd)) out.nightEnd = q.nightEnd;
  ['askSize', 'showUrgency', 'showKind', 'trackSolid', 'showBristol', 'compare'].forEach(function (k) { if (typeof q[k] === 'boolean') out[k] = q[k]; });
  if ([1, 3, 7, 14, 30].indexOf(+q.range) > -1) out.range = +q.range;
  if (q.dotScale === 'same' || q.dotScale === 'amount') out.dotScale = q.dotScale;
  return out;
}
/**
 * Brings a stored or restored log up to the current schema.
 * Schema 1 had no stool tracking; schema 2 added `solid` entries and pass/solid links.
 * Returns the cleaned entries and how many had to be dropped.
 */
export function migrateLog(list, fromSchema, now) {
  var out = [], dropped = 0, seen = {};
  (Array.isArray(list) ? list : []).forEach(function (x) {
    var e = sanitizeEntry(x, now);
    if (!e || seen[e.id]) { dropped++; return; }
    seen[e.id] = 1; out.push(e);
  });
  var ids = {}; out.forEach(function (e) { ids[e.id] = e; });
  out.forEach(function (e) {
    if (e.withSolid && !(ids[e.withSolid] && ids[e.withSolid].type === 'solid')) delete e.withSolid;
    if (e.withPass && !(ids[e.withPass] && ids[e.withPass].type === 'pass')) delete e.withPass;
  });
  return { log: out, dropped: dropped, schema: SCHEMA, from: fromSchema || 1 };
}

/** Spreadsheet apps run cells starting with these characters as formulas. */
var FORMULA_RE = /^[=+\-@\t\r]/;
export function csvCell(v) {
  v = String(v == null ? '' : v);
  if (FORMULA_RE.test(v)) v = "'" + v;
  return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
export function toCsv(entries, isNight) {
  var lines = ['date,time,type,drink_type,size,ml,night,urgency,bristol,note'];
  entries.forEach(function (x) {
    var dt = new Date(x.t);
    var ts = pad(dt.getHours()) + ':' + pad(dt.getMinutes());
    lines.push([isoDate(x.t), ts, x.type, x.kind || '', x.size ? x.size.label : '', x.size ? Math.round(x.size.ml) : '', x.type === 'pass' ? (isNight(x.t) ? 'yes' : 'no') : '', x.urgency || '', x.bristol || '', csvCell(x.note)].join(','));
  });
  return lines.join('\n');
}
