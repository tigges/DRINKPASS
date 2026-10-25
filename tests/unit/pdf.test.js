import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wrapText, pdfFromJpegs } from '../../js/pdf.js';

const width = (s) => s.length;
const latin1 = (bytes) => Buffer.from(bytes).toString('latin1');

test('wrapText breaks at spaces and inside words or text without spaces', () => {
  assert.deepEqual(wrapText('one two three four', 9, width), ['one two', 'three', 'four']);
  assert.deepEqual(wrapText('abcdefghijkl', 5, width), ['abcde', 'fghij', 'kl']);
  assert.deepEqual(wrapText('排尿日记排尿日记', 3, width), ['排尿日', '记排尿', '日记']);
  assert.deepEqual(wrapText('first\nsecond', 20, width), ['first', 'second']);
  assert.deepEqual(wrapText('', 10, width), ['']);
});

test('pdfFromJpegs writes one image page each, with a cross-reference table that points at every object', () => {
  const fake = (n) => ({ jpeg: new Uint8Array(n).fill(0xff), w: 10, h: 14 });
  const out = latin1(pdfFromJpegs([fake(5), fake(9)], { title: 'Diary 2026-10-19 – 2026-10-25', created: Date.UTC(2026, 9, 25, 21, 0, 0) }));
  assert.match(out, /^%PDF-1\.4\n/);
  assert.match(out, /%%EOF\n$/);
  assert.match(out, /\/Type \/Pages \/Kids \[3 0 R 6 0 R\] \/Count 2/);
  assert.equal(out.match(/\/Type \/Page /g).length, 2);
  assert.match(out, /\/Width 10 \/Height 14 .*\/Filter \/DCTDecode \/Length 5 /);
  assert.match(out, /\/CreationDate \(D:20261025210000Z\)/);
  assert.match(out, /\/Title <FEFF0044006900610072007900200032.*20130020.*>/);
  const xref = +out.match(/startxref\n(\d+)\n/)[1];
  assert.equal(out.slice(xref, xref + 4), 'xref');
  const rows = out.slice(xref).split('\n').slice(3).filter((l) => / n $/.test(l));
  assert.equal(rows.length, 9);
  rows.forEach((row, i) => { const at = +row.slice(0, 10); assert.equal(out.slice(at, at + String(i + 1).length + 6), `${i + 1} 0 obj`); });
});
