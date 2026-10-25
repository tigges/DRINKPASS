// Runs in its own process, so pinning the zone here covers the UK clock changes without affecting other tests.
process.env.TZ = 'Europe/London';

const { test } = await import('node:test');
const { default: assert } = await import('node:assert/strict');
const { lastClockTime, clockFraction, clockSlot, dayOffsetOf, sleepModel, startOfDay } = await import('../../js/core.js');

const at = (s) => new Date(s).getTime();
const hm = (ms) => { const d = new Date(ms); return [d.getHours(), d.getMinutes()]; };

test('a picked time later than now is yesterday at that clock time, even across the autumn clock change', () => {
  // 25 Oct 2026: clocks went back at 02:00 BST, so the day is 25 hours long.
  const now = at('2026-10-25T09:00:00Z');
  const t = lastClockTime('22:30', now);
  assert.deepEqual(hm(t), [22, 30]);
  assert.equal(new Date(t).getDate(), 24);
  assert.equal(t, at('2026-10-24T21:30:00Z'));
});

test('a picked time earlier than now stays today', () => {
  const now = at('2026-10-25T09:00:00Z');
  assert.equal(lastClockTime('08:15', now), at('2026-10-25T08:15:00Z'));
  assert.equal(lastClockTime('09:00', now), now);
  assert.equal(lastClockTime('09:00', now, true), at('2026-10-24T08:00:00Z'));
});

test('spring clock change: yesterday at 23:00 is 23 real hours before today at 23:00', () => {
  const now = at('2026-03-29T12:00:00Z');
  assert.equal(lastClockTime('23:00', now), at('2026-03-28T23:00:00Z'));
});

test('an inferred bedtime keeps the night start clock time across the clock change', () => {
  const wake = { id: 'w', type: 'wake', t: at('2026-10-25T07:00:00Z') };
  const m = sleepModel([wake], '22:00');
  assert.deepEqual(hm(m.periods[0][0]), [22, 0]);
  assert.equal(m.periods[0][0], at('2026-10-24T21:00:00Z'));
});

test('chart positions follow the clock face on a 25-hour day', () => {
  assert.equal(clockFraction(at('2026-10-25T23:30:00Z')), 23.5 / 24);
  assert.equal(clockFraction(at('2026-10-25T18:00:00Z')), 18 / 24);
  const ds = startOfDay(at('2026-10-25T12:00:00Z'));
  assert.deepEqual(hm(clockSlot(ds, 95, 15)), [23, 52]);
  assert.equal(new Date(clockSlot(ds, 95, 15)).getDate(), 25);
});

test('day offsets count calendar days, not 24-hour blocks', () => {
  const now = at('2026-10-26T00:30:00Z');
  assert.equal(dayOffsetOf(at('2026-10-25T00:30:00Z'), now), -1);
  assert.equal(dayOffsetOf(at('2026-10-24T23:30:00Z'), now), -1);
  assert.equal(dayOffsetOf(now, now), 0);
});
