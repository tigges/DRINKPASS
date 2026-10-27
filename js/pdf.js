/**
 * The clinician summary as an A4 PDF file. Pages are drawn on a canvas with the system fonts, so every language
 * and anything typed in a note prints, then stored as JPEG images. No print window is involved: it does nothing
 * in apps added to the iPhone home screen.
 */

var PW = 595.28, PH = 841.89, ML = 34, MT = 40, MB = 46, CW = PW - 2 * ML, SCALE = 2.2;
var INK = '#0e2a3b', MUTED = '#555555', LINE = '#d9e3e8', BAND = '#d5e5ee', TRACK = '#eef4f7';
var COLORS = { drink: '#1572b5', pass: '#f6c800', solid: '#8a6a4f', leak: '#7d4fb8' }, RINGS = { drink: '#1572b5', pass: '#c79f00' };
var FONT = '"Bricolage Grotesque", system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Noto Sans CJK SC", sans-serif';

/** Splits text into lines no wider than max; words longer than a line (or text without spaces, like Chinese) break anywhere. */
export function wrapText(text, max, measure) {
  var out = [];
  String(text).split('\n').forEach(function (para) {
    var line = '';
    para.split(/(\s+)/).forEach(function (word) {
      if (!word) return;
      var next = line + word;
      if (measure(next) <= max) { line = next; return; }
      if (/^\s+$/.test(word)) { out.push(line); line = ''; return; }
      if (line.trim()) out.push(line.replace(/\s+$/, ''));
      line = '';
      for (var i = 0; i < word.length; i++) {
        if (line && measure(line + word[i]) > max) { out.push(line); line = ''; }
        line += word[i];
      }
    });
    out.push(line.replace(/\s+$/, ''));
  });
  return out;
}

function ascii(s) { var b = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; }
function utf16hex(s) { var h = 'FEFF'; for (var i = 0; i < s.length; i++) h += ('000' + s.charCodeAt(i).toString(16).toUpperCase()).slice(-4); return '<' + h + '>'; }
function pdfDate(ms) {
  var d = new Date(ms), p = function (n) { return ('0' + n).slice(-2); };
  return '(D:' + d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + 'Z)';
}

/** A PDF with one full-page JPEG per page. pages: [{ jpeg: Uint8Array, w, h }] in pixels; the page itself is A4. */
export function pdfFromJpegs(pages, meta) {
  var parts = [], len = 0, offsets = [];
  function put(x) { var b = typeof x === 'string' ? ascii(x) : x; parts.push(b); len += b.length; }
  function obj(n, body, stream) {
    offsets[n] = len;
    put(n + ' 0 obj\n' + body + '\n');
    if (stream) { put('stream\n'); put(stream); put('\nendstream\n'); }
    put('endobj\n');
  }
  var n = pages.length, info = 3 + 3 * n, kids = [];
  for (var i = 0; i < n; i++) kids.push((3 + 3 * i) + ' 0 R');
  put('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + n + ' >>');
  pages.forEach(function (p, i) {
    var pg = 3 + 3 * i, content = 'q ' + PW + ' 0 0 ' + PH + ' 0 0 cm /Im0 Do Q';
    obj(pg, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PW + ' ' + PH + '] /Resources << /XObject << /Im0 ' + (pg + 2) + ' 0 R >> >> /Contents ' + (pg + 1) + ' 0 R >>');
    obj(pg + 1, '<< /Length ' + content.length + ' >>', ascii(content));
    obj(pg + 2, '<< /Type /XObject /Subtype /Image /Width ' + p.w + ' /Height ' + p.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + p.jpeg.length + ' >>', p.jpeg);
  });
  obj(info, '<< /Title ' + utf16hex(meta.title || '') + ' /Producer (Drink & Pass Journal) /CreationDate ' + pdfDate(meta.created || Date.now()) + ' >>');
  var xref = len, rows = ['xref', '0 ' + (info + 1), '0000000000 65535 f '];
  for (var k = 1; k <= info; k++) rows.push(('000000000' + offsets[k]).slice(-10) + ' 00000 n ');
  put(rows.join('\n') + '\ntrailer\n<< /Size ' + (info + 1) + ' /Root 1 0 R /Info ' + info + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
  var out = new Uint8Array(len), at = 0;
  parts.forEach(function (b) { out.set(b, at); at += b.length; });
  return out;
}

/**
 * Lays the summary out on A4 pages. Drawing is recorded per page first, so the page count is known for the
 * "1 / 3" footers and only one canvas is needed however long the diary is.
 */
function layout(m, ctx) {
  var pages = [], ops = null, y = 0;
  function font(size, bold) { return (bold ? '600 ' : '400 ') + size + 'px ' + FONT; }
  function measurer(size, bold) { var f = font(size, bold); return function (s) { ctx.font = f; return ctx.measureText(s).width; }; }
  function page() { ops = []; pages.push(ops); y = MT; }
  function text(s, x, ty, size, opt) {
    opt = opt || {};
    var f = font(size, opt.bold), align = opt.align || 'left', color = opt.color || INK;
    ops.push(function (c) { c.font = f; c.fillStyle = color; c.textAlign = align; c.textBaseline = 'alphabetic'; c.fillText(s, x, ty); });
  }
  function rect(x, ry, w, h, color) { ops.push(function (c) { c.fillStyle = color; c.fillRect(x, ry, w, h); }); }
  function hline(x, ly, w, color) { rect(x, ly, w, 0.6, color || LINE); }
  function para(s, size, color, lead) {
    wrapText(s, CW, measurer(size)).forEach(function (l) { y += lead; text(l, ML, y, size, { color: color }); });
  }

  page();
  y += 16; text(m.title, ML, y, 16, { bold: true });
  y += 15; text(m.range, ML, y, 10, { color: MUTED });
  y += 24;
  var half = (CW - 24) / 2;
  m.who.forEach(function (label, i) {
    var x = ML + i * (half + 24), w = measurer(8.5)(label);
    text(label, x, y, 8.5); hline(x + w + 6, y + 1, half - w - 6, INK);
  });
  y += 6; para(m.note, 8, MUTED, 13);

  var ch = m.chart, labW = 52, px = ML + labW, pw = CW - labW, rowH = 17, top = y + 10, ph = ch.days.length * rowH;
  ops.push(function (c) {
    c.save(); c.beginPath();
    if (c.roundRect) c.roundRect(px, top, pw, ph, 6); else c.rect(px, top, pw, ph);
    c.clip(); c.fillStyle = TRACK; c.fillRect(px, top, pw, ph);
    ch.days.forEach(function (d, i) {
      c.fillStyle = BAND;
      d.night.forEach(function (s) { c.fillRect(px + s[0] / 96 * pw, top + i * rowH, (s[1] - s[0]) / 96 * pw, rowH); });
      if (i) { c.fillStyle = LINE; c.fillRect(px, top + i * rowH, pw, 0.6); }
    });
    var lanes = ch.solidLane ? { drink: 0.25, solid: 0.5, pass: 0.76, leak: 0.76 } : { drink: 0.3, pass: 0.7, leak: 0.7 }, r = ch.solidLane ? 2.4 : 2.7;
    ch.days.forEach(function (d, i) {
      d.dots.forEach(function (dot) {
        var cx = px + dot.x * pw, cy = top + i * rowH + lanes[dot.type] * rowH;
        c.beginPath(); c.arc(cx, cy, dot.ns ? r - 0.6 : r, 0, 2 * Math.PI);
        if (dot.ns) { c.lineWidth = 1.2; c.strokeStyle = RINGS[dot.type]; c.stroke(); } else { c.fillStyle = COLORS[dot.type]; c.fill(); }
      });
    });
    c.restore();
  });
  ch.days.forEach(function (d, i) { text(d.label, ML, top + i * rowH + rowH / 2 + 3, 8, { color: MUTED }); });
  y = top + ph + 10;
  ch.axis.forEach(function (a, i) { text(a, px + i / (ch.axis.length - 1) * pw, y, 7.5, { color: MUTED, align: i === 0 ? 'left' : i === ch.axis.length - 1 ? 'right' : 'center' }); });
  y += 14;
  var lx = ML, lm = measurer(8);
  ch.legend.forEach(function (it) {
    var cx = lx + 4, cy = y - 3;
    ops.push(function (c) {
      c.beginPath(); c.arc(cx, cy, 3, 0, 2 * Math.PI);
      if (it.key === 'night') { c.fillStyle = BAND; c.fillRect(cx - 5, cy - 3.5, 10, 7); return; }
      if (it.key === 'ns') { c.lineWidth = 1.2; c.strokeStyle = MUTED; c.stroke(); } else { c.fillStyle = COLORS[it.key]; c.fill(); }
    });
    text(it.label, lx + 11, y, 8, { color: MUTED });
    lx += 11 + lm(it.label) + 14;
  });

  var fv = m.fv, fmb = measurer(8, true), c0 = 92, cw = (CW - c0) / (fv.head.length - 1);
  y += 22; text(fv.caption, ML, y, 9.5, { bold: true });
  function fvRow(cells, bold, head) {
    var cols = cells.map(function (s, i) { return head ? wrapText(s, (i ? cw : c0) - 6, fmb) : [s]; });
    var lines = Math.max.apply(null, cols.map(function (l) { return l.length; })), h = 7 + lines * 10;
    cols.forEach(function (l, i) {
      l.forEach(function (s, j) {
        var ty = y + 11 + j * 10 + (head ? (lines - l.length) * 10 : 0);
        if (i) text(s, ML + c0 + i * cw - 3, ty, 8, { bold: bold || head, align: 'right' }); else text(s, ML + 3, ty, 8, { bold: true });
      });
    });
    y += h; hline(ML, y, CW);
  }
  y += 4; fvRow(fv.head, true, true);
  fv.rows.forEach(function (r) { fvRow(r, false); });
  if (fv.total) fvRow(fv.total, true);
  y += 2; para(fv.note, 7.5, MUTED, 10.5);

  var dm = m.diary, cols = dm.withNotes ? [46, 150, 175, CW - 371] : [46, 200, CW - 246], lh = 10.5, dmeas = measurer(8.5), dbold = measurer(8.5, true);
  var xs = [ML]; cols.forEach(function (w, i) { xs[i + 1] = xs[i] + w; });
  function cellsOf(row, bold) {
    var at = 0;
    return row.map(function (cell) {
      var span = cell.span || 1, w = xs[at + span] - xs[at], x = xs[at];
      at += span;
      return { x: x, lines: wrapText(cell.text, w - 8, bold || cell.bold ? dbold : dmeas), bold: bold || cell.bold, muted: cell.muted };
    });
  }
  function rowHeight(cells) { return 8 + lh * Math.max.apply(null, cells.map(function (c) { return c.lines.length || 1; })); }
  function drawRow(cells) {
    var h = rowHeight(cells);
    cells.forEach(function (c) { c.lines.forEach(function (l, j) { text(l, c.x + 4, y + 11 + j * lh, 8.5, { bold: c.bold, color: c.muted ? MUTED : INK }); }); });
    y += h; hline(ML, y, CW);
  }
  var headCells = cellsOf(dm.head.map(function (h) { return { text: h }; }), true);
  function room(h) { if (y + h > PH - MB) { page(); drawRow(headCells); } }
  y += 18; drawRow(headCells);
  dm.days.forEach(function (d) {
    var title = cellsOf([{ text: d.title, span: cols.length }], true), rows = d.rows.map(function (r) { return cellsOf(r); });
    room(rowHeight(title) + (rows.length ? rowHeight(rows[0]) : 0));
    drawRow(title);
    rows.forEach(function (r) { room(rowHeight(r)); drawRow(r); });
    var tot = cellsOf(d.total, true); room(rowHeight(tot)); drawRow(tot);
  });
  var foot = wrapText(m.foot, CW, measurer(7.5));
  if (y + 14 + foot.length * 10 > PH - MB) page();
  y += 4; para(m.foot, 7.5, MUTED, 10);
  return pages;
}

/** Draws the summary and returns the PDF file's bytes. */
export function reportPdf(m) {
  var canvas = document.createElement('canvas'), w = Math.round(PW * SCALE), h = Math.round(PH * SCALE);
  canvas.width = w; canvas.height = h;
  var ctx = canvas.getContext('2d'), pages = layout(m, ctx), out = [];
  pages.forEach(function (ops, i) {
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, PW, PH);
    ops.forEach(function (op) { op(ctx); });
    ctx.font = '400 7.5px ' + FONT; ctx.fillStyle = MUTED; ctx.textAlign = 'right';
    ctx.fillText((i + 1) + ' / ' + pages.length, PW - ML, PH - 22);
    var bin = atob(canvas.toDataURL('image/jpeg', 0.88).split(',')[1]), jpeg = new Uint8Array(bin.length);
    for (var k = 0; k < bin.length; k++) jpeg[k] = bin.charCodeAt(k);
    out.push({ jpeg: jpeg, w: w, h: h });
  });
  canvas.width = canvas.height = 0;
  return pdfFromJpegs(out, { title: m.title + ' ' + m.range });
}
