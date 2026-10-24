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

export function csvCell(v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
export function toCsv(entries, isNight) {
  var lines = ['date,time,type,drink_type,size,ml,night,urgency,bristol,note'];
  entries.forEach(function (x) {
    var dt = new Date(x.t);
    var ts = pad(dt.getHours()) + ':' + pad(dt.getMinutes());
    lines.push([isoDate(x.t), ts, x.type, x.kind || '', x.size ? x.size.label : '', x.size ? Math.round(x.size.ml) : '', x.type === 'pass' ? (isNight(x.t) ? 'yes' : 'no') : '', x.urgency || '', x.bristol || '', csvCell(x.note)].join(','));
  });
  return lines.join('\n');
}
