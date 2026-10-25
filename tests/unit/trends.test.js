process.env.TZ = 'Europe/London';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { H, dayRange, between, dailySeries, rolling, trendEnds, clockNight, sanitizeSettings } from '../../js/core.js';

const night = (t) => clockNight(t, '22:00', '06:00');
const now = new Date('2026-10-27T12:00:00').getTime();
const pass = (t, ml, urgency) => ({ type: 'pass', t, size: ml ? { ml } : undefined, urgency });
const days = (log, n) => Array.from({ length: n }, (_, i) => { const r = dayRange(-(n - 1 - i), now); return { start: r[0], items: between(log, r[0], r[1]) }; });

test('dailySeries measures each calendar day and leaves days without entries out', () => {
  const d0 = dayRange(-2, now)[0], d2 = dayRange(0, now)[0];
  const log = [
    pass(d0 + 2 * H, 300, 'mild'), { type: 'drink', t: d0 + 7 * H, size: { ml: 250 } }, pass(d0 + 8 * H, 200, 'strong'), pass(d0 + 11 * H),
    { type: 'drink', t: d0 + 12 * H }, { type: 'bed', t: d0 + 23 * H },
    pass(d2 + 9 * H, 250, 'cantwait')
  ];
  const [a, b, c] = dailySeries(days(log, 3), night);
  assert.deepEqual(a, { start: d0, logged: true, gap: 4.5 * H, size: 250, night: 1, urgent: 50, intake: 250 });
  assert.equal(b.logged, false);
  assert.deepEqual(c, { start: d2, logged: true, gap: null, size: 250, night: 0, urgent: 100, intake: null });
});

test('dailySeries counts the 25-hour day of the autumn clock change as one day', () => {
  const r = dayRange(-2, now);
  assert.equal(r[1] - r[0], 25 * H);
  const log = [pass(r[0] + 0.5 * H, 200), pass(r[0] + 24.5 * H, 200)];
  const [a] = dailySeries(days(log, 3), night);
  assert.equal(a.gap, 24 * H);
  assert.equal(a.night, 2);
});

test('rolling takes the median of the last 7 calendar days once 3 have a value', () => {
  const s = [1, 2, null, 3, 4, 100, 5, 6, 7].map((v) => ({ v }));
  const r = rolling(s, 'v');
  assert.equal(r[0], null);
  assert.equal(r[2], null);
  assert.deepEqual(r[3], { med: 2, lo: 2, hi: 3 });
  assert.equal(r[6].med, 3.5);
  assert.deepEqual(r[8], { med: 5.5, lo: 4, hi: 7 });
});

test('trendEnds compares the first and last week, or halves when there is less', () => {
  const s = (vals) => vals.map((v) => ({ v }));
  assert.deepEqual(trendEnds(s([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]), 'v'), { n: 7, first: 4, last: 13 });
  assert.deepEqual(trendEnds(s([1, null, 2, 3, 4, 5]), 'v'), { n: 2, first: 1.5, last: 4.5 });
  assert.equal(trendEnds(s([null, 1]), 'v'), null);
});

test('the All range is a valid setting', () => {
  assert.equal(sanitizeSettings({ range: 0 }).range, 0);
  assert.equal(sanitizeSettings({ range: 90 }).range, 1);
});
