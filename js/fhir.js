import { labelOf, KINDS, URG, LEAK_AMOUNT, LEAK_CAUSE } from './core.js';

var LOINC = 'http://loinc.org';
var UCUM = 'http://unitsofmeasure.org';
var APP = 'https://github.com/tigges/drinkpass/fhir/CodeSystem/journal';
var ABSENT = 'http://terminology.hl7.org/CodeSystem/data-absent-reason';

function appCode(code, display) { return { system: APP, code: code, display: display }; }
function isoLocal(ms) {
  var d = new Date(ms), off = -d.getTimezoneOffset(), sign = off >= 0 ? '+' : '-', a = Math.abs(off);
  var p = function (n) { return ('0' + n).slice(-2); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) +
    sign + p(Math.floor(a / 60)) + ':' + p(a % 60);
}
function volume(x) {
  return x.size ? { valueQuantity: { value: Math.round(x.size.ml), unit: 'mL', system: UCUM, code: 'mL' } }
    : { dataAbsentReason: { coding: [{ system: ABSENT, code: 'unknown', display: 'Unknown' }], text: 'Volume not recorded' } };
}
function observation(x, isNight) {
  var o = { resourceType: 'Observation', status: 'final', identifier: [{ system: APP + '/entry', value: x.id }], effectiveDateTime: isoLocal(x.t) };
  var comps = [];
  if (x.type === 'drink') {
    // 9000-1 is defined for measured intake, so only exact amounts carry it; preset sizes are estimates.
    var measured = x.size && x.size.label === 'exact';
    o.code = { coding: measured ? [{ system: LOINC, code: '9000-1', display: 'Fluid intake oral Measured' }, appCode('drink', 'Drink')] : [appCode('drink', 'Drink')],
      text: measured ? 'Fluid intake oral (measured)' : 'Fluid intake oral' + (x.size ? ' (estimated from size)' : '') };
    Object.assign(o, volume(x));
    if (x.kind) comps.push({ code: { coding: [appCode('drink-type', 'Drink type')] }, valueCodeableConcept: { coding: [appCode(x.kind, labelOf(KINDS, x.kind))], text: labelOf(KINDS, x.kind) } });
  } else if (x.type === 'pass') {
    o.code = { coding: [{ system: LOINC, code: '9187-6', display: 'Urine output' }, appCode('pass', 'Pass urine')], text: 'Urine output' + (x.size && x.size.label !== 'exact' ? ' (estimated from size)' : '') };
    Object.assign(o, volume(x));
    comps.push({ code: { coding: [appCode('night', 'During night hours')] }, valueBoolean: !!isNight(x.t) });
  } else if (x.type === 'leak') {
    o.code = { coding: [appCode('leak', 'Urine leakage')], text: 'Urine leakage' };
    if (x.amount) comps.push({ code: { coding: [appCode('leak-amount', 'Leak amount')] }, valueCodeableConcept: { coding: [appCode(x.amount, labelOf(LEAK_AMOUNT, x.amount))], text: labelOf(LEAK_AMOUNT, x.amount) } });
    if (x.cause) comps.push({ code: { coding: [appCode('leak-cause', 'What set it off')] }, valueCodeableConcept: { coding: [appCode(x.cause, labelOf(LEAK_CAUSE, x.cause))], text: labelOf(LEAK_CAUSE, x.cause) } });
    comps.push({ code: { coding: [appCode('pad-changed', 'Pad changed')] }, valueBoolean: !!x.pad });
  } else {
    o.code = { coding: [appCode('solid', 'Bowel movement')], text: 'Bowel movement' };
    if (x.bristol) comps.push({ code: { coding: [appCode('bristol', 'Bristol stool form score')], text: 'Bristol stool form score' }, valueInteger: x.bristol });
  }
  if (x.urgency) comps.push({ code: { coding: [appCode('urgency', 'Urgency')] }, valueCodeableConcept: { coding: [appCode(x.urgency, labelOf(URG, x.urgency))], text: labelOf(URG, x.urgency) } });
  if (comps.length) o.component = comps;
  if (x.note) o.note = [{ text: x.note }];
  return o;
}

/** A FHIR R4 collection Bundle with one Observation per drink, pass, solid and leak. Sleep, tablet and exercise markers are left out. */
export function toFhirBundle(entries, isNight, opts) {
  var o = opts || {}, uuid = o.uuid || function () { return crypto.randomUUID(); };
  var list = entries.filter(function (x) { return x.type === 'drink' || x.type === 'pass' || x.type === 'solid' || x.type === 'leak'; });
  return {
    resourceType: 'Bundle',
    type: 'collection',
    timestamp: new Date(o.now === undefined ? Date.now() : o.now).toISOString(),
    meta: { tag: [{ system: APP, code: 'patient-reported', display: 'Recorded by the patient in Drink & Pass Journal' }] },
    entry: list.map(function (x) { return { fullUrl: 'urn:uuid:' + uuid(), resource: observation(x, isNight) }; })
  };
}
