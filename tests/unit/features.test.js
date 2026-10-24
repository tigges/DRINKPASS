process.env.TZ = 'Europe/London';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { H, fvSummary, drinkReminder, clockNight } from '../../js/core.js';
import { toFhirBundle } from '../../js/fhir.js';
import { encryptBackup, decryptBackup, isEncryptedBackup } from '../../js/crypto.js';

const at = (s) => new Date(s).getTime();
const night = (t) => clockNight(t, '22:00', '06:00');

test('fvSummary reports per-day frequency and volume with a daily average', () => {
  const d1 = at('2026-10-20T00:00'), d2 = at('2026-10-21T00:00');
  const days = [
    { start: d1, items: [
      { type: 'pass', t: d1 + 3 * H, size: { ml: 300 } },
      { type: 'drink', t: d1 + 8 * H, size: { ml: 250 } },
      { type: 'pass', t: d1 + 9 * H, size: { ml: 200 } },
      { type: 'pass', t: d1 + 12 * H }
    ] },
    { start: d2, items: [{ type: 'pass', t: d2 + 10 * H, size: { ml: 100 } }] }
  ];
  const fv = fvSummary(days, night);
  assert.deepEqual(
    { ...fv.rows[0], start: undefined },
    { start: undefined, intakeMl: 250, drinks: 1, passes: 3, nightPasses: 1, outMl: 500, nightMl: 300, sized: 2, maxMl: 300, meanMl: 250 }
  );
  assert.equal(fv.average.passes, 2);
  assert.equal(fv.average.outMl, 300);
  assert.equal(fv.average.maxMl, 300);
  assert.equal(fv.average.meanMl, 200);
  assert.equal(fv.daysKept, 2);
});

test('fvSummary averages only over days with entries', () => {
  const d1 = at('2026-10-20T00:00'), d2 = at('2026-10-21T00:00');
  const fv = fvSummary([{ start: d1, items: [] }, { start: d2, items: [{ type: 'drink', t: d2 + 9 * H, size: { ml: 500 } }] }], night);
  assert.equal(fv.daysKept, 1);
  assert.equal(fv.average.intakeMl, 500);
});

test('drinkReminder fires after the chosen gap, by day only', () => {
  const day = at('2026-10-24T14:00');
  const log = [{ type: 'wake', t: at('2026-10-24T07:00') }, { type: 'drink', t: at('2026-10-24T10:30') }, { type: 'pass', t: at('2026-10-24T13:00') }];
  assert.deepEqual(drinkReminder(log, day, 3, night, false), { since: at('2026-10-24T10:30'), drank: true });
  assert.equal(drinkReminder(log, day, 4, night, false), null);
  assert.equal(drinkReminder(log, day, 0, night, false), null);
  assert.equal(drinkReminder(log, day, 3, night, true), null, 'not while asleep');
  assert.equal(drinkReminder(log, at('2026-10-24T23:00'), 3, night, false), null, 'not at night');
});

test('drinkReminder counts from waking and stays quiet for inactive journals', () => {
  const log = [{ type: 'drink', t: at('2026-10-23T20:00') }, { type: 'wake', t: at('2026-10-24T07:00') }];
  assert.deepEqual(drinkReminder(log, at('2026-10-24T09:30'), 2, night, false), { since: at('2026-10-24T07:00'), drank: false });
  assert.equal(drinkReminder(log, at('2026-10-24T08:30'), 2, night, false), null);
  assert.equal(drinkReminder([{ type: 'drink', t: at('2026-10-20T10:00') }], at('2026-10-24T12:00'), 2, night, false), null);
});

test('toFhirBundle maps entries to coded Observations', () => {
  let n = 0;
  const b = toFhirBundle([
    { id: 'd1', type: 'drink', t: at('2026-07-01T09:00'), size: { label: 'exact', ml: 330 }, kind: 'water' },
    { id: 'd2', type: 'drink', t: at('2026-07-01T10:00'), size: { label: 'medium', ml: 250 } },
    { id: 'p1', type: 'pass', t: at('2026-07-01T23:30'), urgency: 'strong', note: 'woke up' },
    { id: 's1', type: 'solid', t: at('2026-07-01T11:00'), bristol: 4 },
    { id: 'b1', type: 'bed', t: at('2026-07-01T22:00') }
  ], night, { uuid: () => 'u' + (n++), now: 0 });
  assert.equal(b.resourceType, 'Bundle');
  assert.equal(b.type, 'collection');
  assert.equal(b.entry.length, 4);
  const [d1, d2, p1, s1] = b.entry.map((e) => e.resource);
  assert.equal(b.entry[0].fullUrl, 'urn:uuid:u0');
  assert.equal(d1.code.coding[0].code, '9000-1');
  assert.deepEqual(d1.valueQuantity, { value: 330, unit: 'mL', system: 'http://unitsofmeasure.org', code: 'mL' });
  assert.equal(d1.effectiveDateTime, '2026-07-01T09:00:00+01:00');
  assert.equal(d1.component[0].valueCodeableConcept.text, 'Water');
  assert.ok(!d2.code.coding.some((c) => c.code === '9000-1'), 'estimated sizes are not labelled as measured');
  assert.equal(p1.code.coding[0].code, '9187-6');
  assert.equal(p1.dataAbsentReason.coding[0].code, 'unknown');
  assert.deepEqual(p1.component.map((c) => c.valueBoolean ?? c.valueCodeableConcept.text), [true, 'Strong']);
  assert.deepEqual(p1.note, [{ text: 'woke up' }]);
  assert.equal(s1.component[0].valueInteger, 4);
  assert.ok(b.entry.every((e) => e.resource.status === 'final'));
});

test('encrypted backups round-trip and reject a wrong password', async () => {
  const text = JSON.stringify({ log: [{ id: 'a', type: 'pass', t: 1 }] });
  const sealed = await encryptBackup(text, 'correct horse');
  const d = JSON.parse(sealed);
  assert.ok(isEncryptedBackup(d));
  assert.ok(!Buffer.from(d.data, 'base64').toString('latin1').includes('"type"'), 'no plaintext in the file');
  assert.equal(await decryptBackup(d, 'correct horse'), text);
  await assert.rejects(decryptBackup(d, 'wrong'), (e) => e.code === 'password');
  assert.notEqual(JSON.parse(await encryptBackup(text, 'correct horse')).iv, d.iv, 'fresh IV each time');
});
