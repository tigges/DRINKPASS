process.env.TZ = 'Europe/London';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  H, DAY, fmtDur, fmtTime, fmtHour, fmtVol, mins, median, sleepModel, isNightAt, isAsleepAt, clockNight, computeGaps,
  periodStats, csvCell, toCsv, sortEntries, between, dayRange, startOfDay, sanitizeEntry, sanitizeSettings, migrateLog, DEFAULT_SETTINGS,
  trainGap, nextPlannedPass, lateDrinkNights, dailySeries
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

test('fmtTime and fmtHour use a 24-hour clock unless 12 is chosen', () => {
  assert.equal(fmtTime(at('2026-01-15T00:05'), undefined), '00:05');
  assert.equal(fmtTime(at('2026-01-15T14:30'), '24'), '14:30');
  assert.equal(fmtTime(at('2026-01-15T00:05'), '12'), '12:05 am');
  assert.equal(fmtTime(at('2026-01-15T09:07'), '12'), '9:07 am');
  assert.equal(fmtTime(at('2026-01-15T12:00'), '12'), '12:00 pm');
  assert.equal(fmtTime(at('2026-01-15T23:59'), '12'), '11:59 pm');
  assert.equal(fmtHour(6, '24'), '06:00');
  assert.equal(fmtHour(0, '12'), '12 am');
  assert.equal(fmtHour(18, '12'), '6 pm');
});

test('the clock setting defaults to 24-hour and accepts only 24 or 12', () => {
  assert.equal(DEFAULT_SETTINGS.clock, '24');
  assert.equal(sanitizeSettings({}).clock, '24');
  assert.equal(sanitizeSettings({ clock: '12' }).clock, '12');
  assert.equal(sanitizeSettings({ clock: 12 }).clock, '24');
});

test('today’s totals show by default, including for settings saved before the option existed', () => {
  assert.equal(sanitizeSettings({ unit: 'oz' }).showToday, true);
  assert.equal(sanitizeSettings({ showToday: false }).showToday, false);
  assert.equal(sanitizeSettings({ showToday: 'no' }).showToday, true);
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
  assert.equal(out[0], 'date,time,type,drink_type,size,ml,night,urgency,bristol,leak_amount,leak_cause,pad_changed,note');
  assert.equal(out[1], '2026-10-24,08:05,pass,,small,100,no,mild,,,,,"x, y"');
});

test('toCsv writes how much leaked, what set it off and a pad change', () => {
  const out = toCsv([{ id: '1', type: 'leak', t: at('2026-10-24T08:05'), amount: 'drops', cause: 'cough', pad: true }], () => false).split('\n');
  assert.equal(out[1], '2026-10-24,08:05,leak,,,,,,,drops,cough,yes,');
});

test('dayRange spans a calendar day across the October clock change', () => {
  const now = at('2026-10-25T12:00');
  const [a, b] = dayRange(0, now);
  assert.equal(a, startOfDay(now));
  assert.equal(b - a, 25 * H);
});

test('isNightAt matches a straightforward scan on random sleep logs', () => {
  const naive = (ms, m, s, e) => {
    for (const p of m.periods) if (ms >= p[0] && ms < p[1]) return true;
    for (const t of m.markers) if (Math.abs(ms - t) < 12 * H) return false;
    return clockNight(ms, s, e);
  };
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const start = at('2026-01-01T00:00');
  for (let run = 0; run < 20; run++) {
    const log = [];
    for (let i = 0; i < 40; i++) log.push({ id: 'm' + i, type: rand() < 0.5 ? 'bed' : 'wake', t: start + Math.floor(rand() * 30 * DAY) });
    const m = sleepModel(sortEntries(log), '22:00');
    for (let j = 0; j < 300; j++) {
      const ms = start - DAY + Math.floor(rand() * 32 * DAY);
      assert.equal(isNightAt(ms, m, '22:00', '06:00'), naive(ms, m, '22:00', '06:00'));
    }
  }
});

test('between returns the half-open time slice', () => {
  const s = [1, 2, 2, 3, 5].map((t, i) => ({ id: String(i), t }));
  assert.deepEqual(between(s, 2, 5).map((x) => x.t), [2, 2, 3]);
  assert.deepEqual(between(s, 0, 1), []);
  assert.deepEqual(between(s, 4, Infinity).map((x) => x.t), [5]);
});

test('leaks keep a known amount, cause and pad change; tablets and exercises keep a note', () => {
  const now = at('2026-10-24T12:00');
  assert.deepEqual(sanitizeEntry({ id: 'l', type: 'leak', t: now - H, amount: 'small', cause: 'urge', pad: true, size: { label: 'small', ml: 100 } }, now),
    { id: 'l', type: 'leak', t: now - H, amount: 'small', cause: 'urge', pad: true });
  assert.deepEqual(sanitizeEntry({ id: 'l', type: 'leak', t: now - H, amount: 'lots', cause: 'sport', pad: 'yes' }, now), { id: 'l', type: 'leak', t: now - H });
  assert.deepEqual(sanitizeEntry({ id: 'p', type: 'tablet', t: now - H, note: ' 5 mg ' }, now), { id: 'p', type: 'tablet', t: now - H, note: '5 mg' });
  assert.equal(sanitizeEntry({ id: 'e', type: 'exercise', t: now - H }, now).type, 'exercise');
});

test('the new settings fall back to their defaults when out of range', () => {
  const s = sanitizeSettings({ textSize: 'huge', target: 1800, trainEvery: 100, trainStretch: 20, trainSince: -5, showLeak: 'no' });
  assert.equal(s.textSize, 'normal'); assert.equal(s.target, 0); assert.equal(s.trainEvery, 0); assert.equal(s.trainStretch, 0);
  assert.equal(s.trainSince, 0); assert.equal(s.showLeak, true);
  const ok = sanitizeSettings({ textSize: 'xl', target: 2000, trainEvery: 120, trainStretch: 15, trainSince: 1000, showMarks: false });
  assert.deepEqual([ok.textSize, ok.target, ok.trainEvery, ok.trainStretch, ok.trainSince, ok.showMarks], ['xl', 2000, 120, 15, 1000, false]);
});

test('markers and leaks leave the gaps between drinks and passes alone', () => {
  const t0 = at('2026-10-24T08:00');
  const g = computeGaps(sortEntries([
    { id: 'p1', type: 'pass', t: t0 }, { id: 'tab', type: 'tablet', t: t0 + H }, { id: 'l', type: 'leak', t: t0 + 2 * H },
    { id: 'ex', type: 'exercise', t: t0 + 3 * H }, { id: 'p2', type: 'pass', t: t0 + 4 * H }
  ]));
  assert.equal(g.l.pass, 2 * H);
  assert.equal(g.p2.pass, 4 * H);
  assert.equal(g.tab, undefined);
  const days = dailySeries([{ start: startOfDay(t0), items: [{ id: 'tab', type: 'tablet', t: t0 }] }], () => false);
  assert.equal(days[0].logged, false);
});

test('trainGap grows by the weekly stretch up to 4 hours', () => {
  const since = at('2026-10-01T09:00');
  assert.equal(trainGap({ trainEvery: 0, trainStretch: 15, trainSince: since }, since + 30 * DAY), 0);
  assert.equal(trainGap({ trainEvery: 120, trainStretch: 0, trainSince: since }, since + 30 * DAY), 120);
  assert.equal(trainGap({ trainEvery: 120, trainStretch: 15, trainSince: since }, since + 6 * DAY), 120);
  assert.equal(trainGap({ trainEvery: 120, trainStretch: 15, trainSince: since }, since + 15 * DAY), 150);
  assert.equal(trainGap({ trainEvery: 180, trainStretch: 30, trainSince: since }, since + 70 * DAY), 240);
});

test('nextPlannedPass counts from the last pass or waking, and stops after a long quiet spell', () => {
  const t0 = at('2026-10-24T07:00');
  const log = sortEntries([{ id: 'w', type: 'wake', t: t0 }, { id: 'd', type: 'drink', t: t0 + H }]);
  assert.equal(nextPlannedPass(log, t0 + H, 120), t0 + 2 * H);
  const withPass = sortEntries([...log, { id: 'p', type: 'pass', t: t0 + 90 * 60000 }]);
  assert.equal(nextPlannedPass(withPass, t0 + 2 * H, 120), t0 + 90 * 60000 + 2 * H);
  assert.equal(nextPlannedPass(withPass, t0 + 2 * H, 0), null);
  assert.equal(nextPlannedPass(withPass, t0 + 20 * H, 120), null);
  assert.equal(nextPlannedPass([{ id: 'd', type: 'drink', t: t0 }], t0 + H, 120), null);
});

test('lateDrinkNights splits finished evenings by tea, coffee or alcohol after 4 pm', () => {
  const day = (d) => at(`2026-10-${d}T00:00`), night = (t) => new Date(t).getHours() >= 22 || new Date(t).getHours() < 6;
  const log = sortEntries([
    { id: 'a1', type: 'drink', kind: 'teacoffee', t: at('2026-10-20T19:00') }, { id: 'a2', type: 'pass', t: at('2026-10-21T02:00') }, { id: 'a3', type: 'pass', t: at('2026-10-21T04:00') },
    { id: 'b0', type: 'drink', kind: 'teacoffee', t: at('2026-10-21T10:00') }, { id: 'b1', type: 'drink', kind: 'water', t: at('2026-10-21T19:00') }, { id: 'b2', type: 'pass', t: at('2026-10-22T03:00') },
    { id: 'c1', type: 'tablet', t: at('2026-10-22T20:00') },
    { id: 'd1', type: 'drink', kind: 'alcohol', t: at('2026-10-23T21:00') }
  ]);
  const r = lateDrinkNights(log, [day(20), day(21), day(22), day(23)], night, at('2026-10-24T10:00'));
  assert.deepEqual(r, { late: { nights: 1, passes: 2 }, other: { nights: 1, passes: 1 } });
  const later = lateDrinkNights(log, [day(23)], night, at('2026-10-24T13:00'));
  assert.deepEqual(later.late, { nights: 1, passes: 0 });
});
