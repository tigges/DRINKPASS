process.env.TZ = 'Europe/London';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  H, DAY, fmtDur, fmtVol, mins, median, sleepModel, isNightAt, isAsleepAt, clockNight, computeGaps,
  periodStats, csvCell, toCsv, sortEntries, dayRange, startOfDay, sanitizeEntry, sanitizeSettings, migrateLog, DEFAULT_SETTINGS
} from '../../js/core.js';

const at = (s) => new Date(s).getTime();

test('fmtDur formats minutes and hours', () => {
  assert.equal(fmtDur(20 * 1000), 'under a minute');
  assert.equal(fmtDur(45 * 60000), '45 min');
  assert.equal(fmtDur(2 * H), '2 h');
  assert.equal(fmtDur(2 * H + 5 * 60000), '2 h 5 min');
});

test('fmtVol converts to fluid ounces', () => {
  assert.equal(fmtVol(250, 'ml'), '250 ml');
  assert.equal(fmtVol(29.5735 * 8, 'oz'), '8 fl oz');
});

test('mins and median', () => {
  assert.equal(mins('22:30'), 1350);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
});

test('clockNight handles windows that cross midnight', () => {
  assert.equal(clockNight(at('2026-10-24T23:00'), '22:00', '06:00'), true);
  assert.equal(clockNight(at('2026-10-24T05:59'), '22:00', '06:00'), true);
  assert.equal(clockNight(at('2026-10-24T06:00'), '22:00', '06:00'), false);
  assert.equal(clockNight(at('2026-10-24T13:00'), '12:00', '14:00'), true);
  assert.equal(clockNight(at('2026-10-24T13:00'), '12:00', '12:00'), false);
});

test('sleepModel pairs bed and wake and infers a missing bed', () => {
  const log = sortEntries([
    { id: 'b1', type: 'bed', t: at('2026-10-20T23:00') },
    { id: 'w1', type: 'wake', t: at('2026-10-21T07:00') },
    { id: 'w2', type: 'wake', t: at('2026-10-22T07:30') }
  ]);
  const m = sleepModel(log, '22:00');
  assert.deepEqual(m.periods[0], [at('2026-10-20T23:00'), at('2026-10-21T07:00'), false]);
  assert.deepEqual(m.periods[1], [at('2026-10-21T22:00'), at('2026-10-22T07:30'), true]);
  assert.equal(isNightAt(at('2026-10-21T03:00'), m, '22:00', '06:00'), true);
  assert.equal(isNightAt(at('2026-10-21T07:30'), m, '22:00', '06:00'), false);
  // Within 12 h of a marker but outside any sleep period counts as day, even inside clock night hours.
  assert.equal(isNightAt(at('2026-10-22T08:00'), m, '22:00', '06:00'), false);
});

test('sleepModel caps an open bed at 12 hours and isAsleepAt honours 16 hours', () => {
  const bed = at('2026-10-24T22:00');
  const m = sleepModel([{ id: 'b', type: 'bed', t: bed }], '22:00');
  assert.deepEqual(m.periods, [[bed, bed + 12 * H, false]]);
  assert.equal(isAsleepAt(m, bed + 8 * H), true);
  assert.equal(isAsleepAt(m, bed + 17 * H), false);
});

test('isNightAt falls back to clock hours without sleep markers', () => {
  const m = sleepModel([], '22:00');
  assert.equal(isNightAt(at('2026-10-24T02:00'), m, '22:00', '06:00'), true);
  assert.equal(isNightAt(at('2026-10-24T12:00'), m, '22:00', '06:00'), false);
});

test('computeGaps tracks drinks, passes and solids separately', () => {
  const log = [
    { id: 'd1', type: 'drink', t: 0 },
    { id: 'p1', type: 'pass', t: 30 * 60000 },
    { id: 's1', type: 'solid', t: 40 * 60000 },
    { id: 'd2', type: 'drink', t: 60 * 60000 },
    { id: 'p2', type: 'pass', t: 90 * 60000 }
  ];
  const g = computeGaps(log);
  assert.deepEqual(g.d1, { drink: null, pass: null });
  assert.deepEqual(g.p1, { drink: 30 * 60000, pass: null });
  assert.deepEqual(g.s1, { solid: null });
  assert.deepEqual(g.p2, { drink: 30 * 60000, pass: 60 * 60000 });
});

test('periodStats sums volumes and counts night passes', () => {
  const base = at('2026-10-24T00:00');
  const log = [
    { id: 'a', type: 'pass', t: base + 2 * H, size: { label: 'small', ml: 100 } },
    { id: 'b', type: 'drink', t: base + 9 * H, size: { label: 'large', ml: 400 } },
    { id: 'c', type: 'pass', t: base + 10 * H, size: { label: 'medium', ml: 250 } },
    { id: 'd', type: 'solid', t: base + 11 * H }
  ];
  const night = (t) => clockNight(t, '22:00', '06:00');
  const st = periodStats(log, base, base + DAY, night);
  assert.equal(st.outMl, 350);
  assert.equal(st.inMl, 400);
  assert.equal(st.night, 1);
  assert.equal(st.solids, 1);
  assert.equal(st.med, 8 * H);
});

test('csvCell quotes commas, quotes and newlines', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell(null), '');
});

test('csvCell defuses spreadsheet formulas', () => {
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell('+1'), "'+1");
  assert.equal(csvCell('-2'), "'-2");
  assert.equal(csvCell('@sum'), "'@sum");
});

test('sanitizeEntry keeps known fields and rejects unusable entries', () => {
  const now = at('2026-10-24T12:00');
  assert.equal(sanitizeEntry(null, now), null);
  assert.equal(sanitizeEntry({ id: 'a', type: 'nap', t: now }, now), null);
  assert.equal(sanitizeEntry({ id: 'a', type: 'pass', t: 'yesterday' }, now), null);
  assert.equal(sanitizeEntry({ id: 'a', type: 'pass', t: now + 2 * DAY }, now), null);
  assert.deepEqual(
    sanitizeEntry({ id: 'a', type: 'pass', t: now, size: { label: 'huge', ml: '300' }, urgency: 'mild', bristol: 3, evil: '<img>' }, now),
    { id: 'a', type: 'pass', t: now, size: { label: 'exact', ml: 300 }, urgency: 'mild' }
  );
  assert.deepEqual(sanitizeEntry({ id: 'b', type: 'drink', t: now, size: { ml: 'lots' }, kind: 'water' }, now), { id: 'b', type: 'drink', t: now, kind: 'water' });
  assert.equal(sanitizeEntry({ id: 'c', type: 'pass', t: now, note: 'x'.repeat(500) }, now).note.length, 200);
});

test('sanitizeSettings ignores malformed values', () => {
  const s = sanitizeSettings({ unit: 'gallons', nightStart: '25:00', nightEnd: '07:00', compare: 'yes', range: 7, dotScale: 'amount' });
  assert.equal(s.unit, DEFAULT_SETTINGS.unit);
  assert.equal(s.nightStart, DEFAULT_SETTINGS.nightStart);
  assert.equal(s.nightEnd, '07:00');
  assert.equal(s.compare, false);
  assert.equal(s.range, 7);
  assert.equal(s.dotScale, 'amount');
});

test('migrateLog drops invalid and duplicate entries and broken links', () => {
  const now = at('2026-10-24T12:00');
  const m = migrateLog([
    { id: 'p', type: 'pass', t: now, withSolid: 'gone' },
    { id: 'p', type: 'pass', t: now },
    { id: 'x', type: 'unknown', t: now },
    { id: 'q', type: 'pass', t: now, withSolid: 'q-s' },
    { id: 'q-s', type: 'solid', t: now, withPass: 'q' }
  ], 1, now);
  assert.equal(m.dropped, 2);
  assert.equal(m.log.length, 3);
  assert.equal(m.log[0].withSolid, undefined);
  assert.equal(m.log[1].withSolid, 'q-s');
  assert.equal(m.log[2].withPass, 'q');
});

test('toCsv writes one row per entry', () => {
  const t = at('2026-10-24T08:05');
  const out = toCsv([{ id: '1', type: 'pass', t, size: { label: 'small', ml: 100 }, urgency: 'mild', note: 'x, y' }], () => false).split('\n');
  assert.equal(out[0], 'date,time,type,drink_type,size,ml,night,urgency,bristol,note');
  assert.equal(out[1], '2026-10-24,08:05,pass,,small,100,no,mild,,"x, y"');
});

test('dayRange spans a calendar day across the October clock change', () => {
  const now = at('2026-10-25T12:00');
  const [a, b] = dayRange(0, now);
  assert.equal(a, startOfDay(now));
  assert.equal(b - a, 25 * H);
});
