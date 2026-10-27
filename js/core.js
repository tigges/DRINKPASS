// Matches package.json and sw.js; scripts/check-release.mjs enforces it.
export var APP_VERSION = '1.6.1';
export var OZ = 29.5735, H = 3600000, DAY = 86400000, MAX_ML = 5000;

export var VALID_TYPES = ['drink', 'pass', 'solid', 'leak', 'bed', 'wake', 'tablet', 'exercise'];
export var PRESETS = {
  drink: [['Small', 150], ['Medium', 250], ['Large', 400]],
  pass: [['Small', 100], ['Medium', 250], ['Large', 400]]
};
export var URG = [['none', 'None'], ['mild', 'Mild'], ['strong', 'Strong'], ['cantwait', 'Couldn’t wait']];
export var KINDS = [['water', 'Water'], ['teacoffee', 'Tea or coffee'], ['alcohol', 'Alcohol'], ['other', 'Other']];
export var KINDS_SHORT = [['water', 'Water'], ['teacoffee', 'Tea/coffee'], ['alcohol', 'Alcohol'], ['other', 'Other']];
export var NAMES = { drink: 'Drink', pass: 'Pass', solid: 'Solid', leak: 'Leak', bed: 'Going to bed', wake: 'Up for the day', tablet: 'Tablet', exercise: 'Pelvic floor exercises' };
export var LEAK_AMOUNT = [['drops', 'Drops'], ['small', 'Small'], ['large', 'Large']];
export var LEAK_CAUSE = [['cough', 'Cough or sneeze'], ['urge', 'Urge'], ['moving', 'Moving or lifting'], ['none', 'Nothing']];
export var BRISTOL = [[1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5'], [6, '6'], [7, '7']];

export function isSleep(x) { return x.type === 'bed' || x.type === 'wake'; }
/** Sleep, tablet and exercise entries mark a moment; they aren't drinks or output and aren't counted as such. */
export function isMark(x) { return isSleep(x) || x.type === 'tablet' || x.type === 'exercise'; }
export function pad(n) { return ('0' + n).slice(-2); }
export function mins(v) { var p = (v || '0:0').split(':'); return (+p[0]) * 60 + (+p[1]); }
export function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
export function labelOf(list, v) { for (var i = 0; i < list.length; i++) if (list[i][0] === v) return list[i][1]; return ''; }
export function median(a) { var b = a.slice().sort(function (x, y) { return x - y; }), m = Math.floor(b.length / 2); return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; }

export function startOfDay(ms) { var d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
/** The latest moment showing clock time "HH:MM" before `ms` (or at it, unless `strict`). Steps back by calendar day, so 23- and 25-hour days work. */
export function lastClockTime(hhmm, ms, strict) {
  var p = String(hhmm || '0:0').split(':'), d = new Date(ms);
  d.setHours(+p[0], +p[1], 0, 0);
  if (strict ? d.getTime() >= ms : d.getTime() > ms) { d.setDate(d.getDate() - 1); d.setHours(+p[0], +p[1], 0, 0); }
  return d.getTime();
}
/** Position of `ms` on a 00:00–24:00 clock face, 0 to 1. Charts use this so clock changes don't shift or hide entries. */
export function clockFraction(ms) { var d = new Date(ms); return (d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60) / 1440; }
/** Middle of the k-th `stepMin`-minute slot of the local day starting at `dayStart`, by clock time. */
export function clockSlot(dayStart, k, stepMin) { var d = new Date(dayStart); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, k * stepMin + stepMin / 2).getTime(); }
/** Number of days from today to the day of `ms` (0 today, -1 yesterday), by calendar date. */
export function dayOffsetOf(ms, now) {
  var a = new Date(startOfDay(ms)), b = new Date(startOfDay(now === undefined ? Date.now() : now));
  return Math.round((Date.UTC(a.getFullYear(), a.getMonth(), a.getDate()) - Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())) / DAY);
}
export function dayRange(offset, now) {
  var b = new Date(now === undefined ? Date.now() : now); b.setHours(0, 0, 0, 0); b.setDate(b.getDate() + offset);
  var e = new Date(b); e.setDate(e.getDate() + 1);
  return [b.getTime(), e.getTime()];
}
/** `clock` is '24' (14:05) or '12' (2:05 pm); formatted by hand so the phone's locale can't override the setting. */
export function fmtTime(ms, clock) {
  var d = new Date(ms), h = d.getHours(), m = pad(d.getMinutes());
  return clock === '12' ? ((h + 11) % 12 + 1) + ':' + m + ' ' + (h < 12 ? 'am' : 'pm') : pad(h) + ':' + m;
}
export function fmtHour(h, clock) { h %= 24; return clock === '12' ? ((h + 11) % 12 + 1) + ' ' + (h < 12 ? 'am' : 'pm') : pad(h) + ':00'; }
/** Fills {name} placeholders; the default translator for the formatters below. */
export function fill(s, vars) { return vars ? s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] !== undefined ? vars[k] : m; }) : s; }
export function fmtDur(ms, tr) {
  var t = tr || fill, m = Math.round(ms / 60000);
  if (m < 1) return t('under a minute');
  if (m < 60) return t('{m} min', { m: m });
  var h = Math.floor(m / 60), r = m % 60;
  return r ? t('{h} h {m} min', { h: h, m: r }) : t('{h} h', { h: h });
}
export function agoText(ms, now, tr) {
  var t = tr || fill, d = (now === undefined ? Date.now() : now) - ms;
  return d < 60000 ? t('just now') : t('{d} ago', { d: fmtDur(d, tr) });
}
export function fmtVol(ml, unit, locale) {
  var n = unit === 'oz' ? Math.round(ml / OZ * 10) / 10 : Math.round(ml);
  return n.toLocaleString(locale) + (unit === 'oz' ? ' fl oz' : ' ml');
}
export function toLocalInput(ms) { var d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
export function isoDate(ms) { var d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
export function sortEntries(log) { return log.slice().sort(function (a, b) { return a.t - b.t; }); }
/** Entries with a <= t < b from a time-sorted array, found by binary search. */
export function between(sorted, a, b) {
  return sorted.slice(firstAtOrAfter(sorted, a), firstAtOrAfter(sorted, b));
}
function firstAtOrAfter(sorted, v) {
  var lo = 0, hi = sorted.length;
  while (lo < hi) { var mid = (lo + hi) >> 1; if (sorted[mid].t < v) lo = mid + 1; else hi = mid; }
  return lo;
}

function inferBed(wakeT, lastWake, nightStart) {
  return Math.max(lastClockTime(nightStart || '22:00', wakeT, true), lastWake);
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
  out.sort(function (a, b) { return a[0] - b[0]; });
  // maxEnd[i] is the latest end among periods[0..i]; periods can overlap after a missed wake.
  var maxEnd = [], hi = -Infinity;
  out.forEach(function (p) { hi = Math.max(hi, p[1]); maxEnd.push(hi); });
  return { periods: out, maxEnd: maxEnd, markers: m.map(function (x) { return x.t; }), last: m[m.length - 1] || null };
}
/** Index of the last value whose key is <= v in an ascending array, or -1. */
function lastAtOrBefore(arr, v, key) {
  var lo = 0, hi = arr.length - 1, ans = -1;
  while (lo <= hi) { var mid = (lo + hi) >> 1; if (key(arr[mid]) <= v) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans;
}
export function clockNight(ms, nightStart, nightEnd) {
  var d = new Date(ms), m = d.getHours() * 60 + d.getMinutes();
  var s = mins(nightStart), e = mins(nightEnd);
  if (s === e) return false;
  return s > e ? (m >= s || m < e) : (m >= s && m < e);
}
export function isNightAt(ms, model, nightStart, nightEnd) {
  var periods = model.periods, markers = model.markers;
  var p = lastAtOrBefore(periods, ms, function (q) { return q[0]; });
  if (p > -1 && model.maxEnd[p] > ms) return true;
  var k = lastAtOrBefore(markers, ms, function (q) { return q; });
  if (k > -1 && ms - markers[k] < 12 * H) return false;
  if (k + 1 < markers.length && markers[k + 1] - ms < 12 * H) return false;
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
    if (isMark(x)) return;
    if (x.type === 'solid') { info[x.id] = { solid: lastS !== null ? x.t - lastS : null }; lastS = x.t; return; }
    if (x.type === 'leak') { info[x.id] = { pass: lastP !== null ? x.t - lastP : null }; return; }
    info[x.id] = { drink: lastD !== null ? x.t - lastD : null, pass: lastP !== null ? x.t - lastP : null };
    if (x.type === 'drink') lastD = x.t; else lastP = x.t;
  });
  return info;
}

export function periodStats(sorted, a, b, isNight) {
  var st = { outMl: 0, inMl: 0, outDays: {}, inDays: {}, night: 0, passes: [], solids: 0, med: null };
  between(sorted, a, b).forEach(function (x) {
    if (isSleep(x)) return;
    var dk = startOfDay(x.t);
    if (x.type === 'pass') { st.passes.push(x.t); if (isNight(x.t)) st.night++; if (x.size) { st.outMl += x.size.ml; st.outDays[dk] = 1; } }
    else if (x.type === 'drink') { if (x.size) { st.inMl += x.size.ml; st.inDays[dk] = 1; } }
    else if (x.type === 'solid') st.solids++;
  });
  var g = []; for (var k = 1; k < st.passes.length; k++) if (st.passes[k] - st.passes[k - 1] < DAY) g.push(st.passes[k] - st.passes[k - 1]);
  st.med = g.length ? median(g) : null; st.outN = Object.keys(st.outDays).length; st.inN = Object.keys(st.inDays).length;
  return st;
}

/**
 * Frequency-volume summary per day (the standard bladder diary layout).
 * `days` is [{ start, items }]; volumes only count entries that have a size.
 */
export function fvSummary(days, isNight) {
  var rows = days.map(function (d) {
    var r = { start: d.start, intakeMl: 0, drinks: 0, passes: 0, nightPasses: 0, outMl: 0, nightMl: 0, sized: 0, maxMl: 0, leaks: 0 };
    d.items.forEach(function (x) {
      if (x.type === 'drink') { r.drinks++; if (x.size) r.intakeMl += x.size.ml; }
      else if (x.type === 'leak') r.leaks++;
      else if (x.type === 'pass') {
        var n = isNight(x.t); r.passes++; if (n) r.nightPasses++;
        if (x.size) { r.sized++; r.outMl += x.size.ml; if (n) r.nightMl += x.size.ml; r.maxMl = Math.max(r.maxMl, x.size.ml); }
      }
    });
    r.meanMl = r.sized ? r.outMl / r.sized : 0;
    return r;
  });
  // Days with nothing logged are usually days the diary wasn't kept, so they don't dilute the average.
  var kept = rows.filter(function (r) { return r.drinks || r.passes || r.leaks; }), n = kept.length || 1;
  var tot = function (k) { return kept.reduce(function (a, r) { return a + r[k]; }, 0); };
  var sized = tot('sized');
  return {
    rows: rows,
    daysKept: kept.length,
    average: { intakeMl: tot('intakeMl') / n, passes: tot('passes') / n, leaks: tot('leaks') / n, nightPasses: tot('nightPasses') / n, outMl: tot('outMl') / n, nightMl: tot('nightMl') / n,
      maxMl: Math.max.apply(null, [0].concat(rows.map(function (r) { return r.maxMl; }))), meanMl: sized ? tot('outMl') / sized : 0 }
  };
}

/**
 * One row per calendar day for the Progress trends. `days` is [{ start, items }]. A value is null when the day has
 * nothing to measure it by; `logged` is false when nothing but sleep was entered, so the day is left out, not zero.
 */
export function dailySeries(days, isNight) {
  return days.map(function (d) {
    var passes = d.items.filter(function (x) { return x.type === 'pass'; }), sized = passes.filter(function (x) { return x.size; });
    var rated = passes.filter(function (x) { return x.urgency; }), drinks = d.items.filter(function (x) { return x.type === 'drink' && x.size; });
    var g = []; for (var k = 1; k < passes.length; k++) g.push(passes[k].t - passes[k - 1].t);
    return {
      start: d.start, logged: d.items.some(function (x) { return !isMark(x); }),
      gap: g.length ? median(g) : null,
      size: sized.length ? sized.reduce(function (a, x) { return a + x.size.ml; }, 0) / sized.length : null,
      night: passes.length ? passes.filter(function (x) { return isNight(x.t); }).length : null,
      urgent: rated.length ? rated.filter(function (x) { return x.urgency === 'strong' || x.urgency === 'cantwait'; }).length / rated.length * 100 : null,
      intake: drinks.length ? drinks.reduce(function (a, x) { return a + x.size.ml; }, 0) : null
    };
  });
}
function quartile(a, q) { var b = a.slice().sort(function (x, y) { return x - y; }); return b[Math.round(q * (b.length - 1))]; }
/** The median and middle half of the last 7 calendar days for each day, once at least 3 of them have a value. */
export function rolling(series, key) {
  return series.map(function (r, i) {
    if (r[key] === null) return null;
    var win = series.slice(Math.max(0, i - 6), i + 1).map(function (x) { return x[key]; }).filter(function (v) { return v !== null; });
    return win.length < 3 ? null : { med: median(win), lo: quartile(win, 0.25), hi: quartile(win, 0.75) };
  });
}
/** Median of the first and of the last few days that have a value: a week each, or half the days when there are fewer than 14. */
export function trendEnds(series, key) {
  var v = series.map(function (x) { return x[key]; }).filter(function (x) { return x !== null; }), n = Math.min(7, Math.floor(v.length / 2));
  return n ? { n: n, first: median(v.slice(0, n)), last: median(v.slice(-n)) } : null;
}

/**
 * Whether to suggest a drink: `hours` since the last drink (or since waking, if later),
 * only while awake, outside night hours, and only for someone actively logging today.
 */
export function drinkReminder(sorted, now, hours, isNight, asleep) {
  if (!hours || asleep || isNight(now)) return null;
  var lastDrink = null, lastWake = null, lastAny = null;
  for (var i = sorted.length - 1; i >= 0; i--) {
    var x = sorted[i]; if (x.t > now) continue;
    if (lastAny === null) lastAny = x.t;
    if (lastDrink === null && x.type === 'drink') lastDrink = x.t;
    if (lastWake === null && x.type === 'wake') lastWake = x.t;
    if (lastDrink !== null && lastWake !== null) break;
  }
  if (lastAny === null || now - lastAny > 16 * H) return null;
  var since = Math.max(lastDrink === null ? -Infinity : lastDrink, lastWake === null ? -Infinity : lastWake);
  if (since === -Infinity) since = lastAny;
  return now - since >= hours * H ? { since: since, drank: since === lastDrink } : null;
}

/**
 * The gap bladder training currently aims for, in minutes: the starting gap plus the weekly stretch for each full
 * week since training started, up to 4 hours. 0 when training is off.
 */
export function trainGap(s, now) {
  if (!s.trainEvery) return 0;
  var weeks = s.trainSince ? Math.max(0, Math.floor((now - s.trainSince) / (7 * DAY))) : 0;
  return Math.min(240, s.trainEvery + (s.trainStretch || 0) * weeks);
}
/** When the next planned pass is due: `gapMin` after the last pass, or after waking if that was later. Null when nothing recent to go by. */
export function nextPlannedPass(sorted, now, gapMin) {
  if (!gapMin) return null;
  var from = null, lastAny = null;
  for (var i = sorted.length - 1; i >= 0; i--) {
    var x = sorted[i]; if (x.t > now) continue;
    if (lastAny === null) lastAny = x.t;
    if (x.type === 'pass' || x.type === 'wake') { from = x.t; break; }
  }
  if (from === null || now - lastAny > 16 * H) return null;
  return from + gapMin * 60000;
}
/**
 * Night passes after evenings with and without tea, coffee or alcohol from 4 pm. Each evening runs from 16:00 to
 * noon the next day; only evenings that are over and have something logged count. `dayStarts` are local midnights.
 */
export function lateDrinkNights(sorted, dayStarts, isNight, now) {
  var out = { late: { nights: 0, passes: 0 }, other: { nights: 0, passes: 0 } };
  dayStarts.forEach(function (ds) {
    var d = new Date(ds), a = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 16).getTime(), b = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 12).getTime();
    if (b > now) return;
    var items = between(sorted, a, b).filter(function (x) { return !isMark(x); });
    if (!items.length) return;
    var late = items.some(function (x) { return x.type === 'drink' && (x.kind === 'teacoffee' || x.kind === 'alcohol') && x.t < a + 8 * H; });
    var g = late ? out.late : out.other;
    g.nights++; g.passes += items.filter(function (x) { return x.type === 'pass' && isNight(x.t); }).length;
  });
  return out;
}

export var SCHEMA = 3;
export var TEXT_SIZES = ['normal', 'large', 'xl'];
export var TARGETS = [0, 1500, 2000, 2500];
export var TRAIN_EVERY = [0, 90, 120, 150, 180];
export var TRAIN_STRETCH = [0, 15, 30];
export var DEFAULT_SETTINGS = { unit: 'ml', nightStart: '22:00', nightEnd: '06:00', askSize: true, showUrgency: true, showKind: true, range: 1, dotScale: 'same', trackSolid: false, showBristol: false, compare: false, showToday: true, showLeak: true, showMarks: true, remindAfter: 0, remindNotify: false, clock: '24', lang: '', textSize: 'normal', target: 0, trainEvery: 0, trainStretch: 0, trainSince: 0 };
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
    if (isFinite(ml) && ml > 0 && ml <= MAX_ML) e.size = { label: SIZE_LABELS.indexOf(x.size.label) > -1 ? x.size.label : 'exact', ml: ml };
  }
  if (x.type === 'drink' && inList(KINDS, x.kind)) e.kind = x.kind;
  if ((x.type === 'pass' || x.type === 'solid') && inList(URG, x.urgency)) e.urgency = x.urgency;
  if (x.type === 'solid' && Number.isInteger(x.bristol) && x.bristol >= 1 && x.bristol <= 7) e.bristol = x.bristol;
  if (x.type === 'leak') {
    if (inList(LEAK_AMOUNT, x.amount)) e.amount = x.amount;
    if (inList(LEAK_CAUSE, x.cause)) e.cause = x.cause;
    if (x.pad === true) e.pad = true;
  }
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
  ['askSize', 'showUrgency', 'showKind', 'trackSolid', 'showBristol', 'compare', 'showToday', 'showLeak', 'showMarks'].forEach(function (k) { if (typeof q[k] === 'boolean') out[k] = q[k]; });
  if ([0, 1, 3, 7, 14, 30].indexOf(+q.range) > -1) out.range = +q.range;
  if (q.dotScale === 'same' || q.dotScale === 'amount') out.dotScale = q.dotScale;
  if ([0, 2, 3, 4].indexOf(+q.remindAfter) > -1) out.remindAfter = +q.remindAfter;
  if (typeof q.remindNotify === 'boolean') out.remindNotify = q.remindNotify;
  if (q.clock === '24' || q.clock === '12') out.clock = q.clock;
  if (typeof q.lang === 'string' && /^([a-z]{2})?$/.test(q.lang)) out.lang = q.lang;
  if (TEXT_SIZES.indexOf(q.textSize) > -1) out.textSize = q.textSize;
  if (TARGETS.indexOf(+q.target) > -1) out.target = +q.target;
  if (TRAIN_EVERY.indexOf(+q.trainEvery) > -1) out.trainEvery = +q.trainEvery;
  if (TRAIN_STRETCH.indexOf(+q.trainStretch) > -1) out.trainStretch = +q.trainStretch;
  if (typeof q.trainSince === 'number' && isFinite(q.trainSince) && q.trainSince >= 0) out.trainSince = q.trainSince;
  return out;
}
/**
 * Brings a stored or restored log up to the current schema.
 * Schema 1 had no stool tracking; schema 2 added `solid` entries and pass/solid links; schema 3 added leaks, tablets and exercises.
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
  var lines = ['date,time,type,drink_type,size,ml,night,urgency,bristol,leak_amount,leak_cause,pad_changed,note'];
  entries.forEach(function (x) {
    var dt = new Date(x.t);
    var ts = pad(dt.getHours()) + ':' + pad(dt.getMinutes());
    lines.push([isoDate(x.t), ts, x.type, x.kind || '', x.size ? x.size.label : '', x.size ? Math.round(x.size.ml) : '', x.type === 'pass' ? (isNight(x.t) ? 'yes' : 'no') : '', x.urgency || '', x.bristol || '', x.amount || '', x.cause || '', x.pad ? 'yes' : '', csvCell(x.note)].join(','));
  });
  return lines.join('\n');
}
