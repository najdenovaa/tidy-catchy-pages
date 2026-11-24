import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PdfEngine } from '../../public/pdf-editor/pdf.js';
import { coreFonts, detectTables } from '../../public/pdf-editor/layout.js';
import { tableStyle } from '../../public/pdf-editor/table-style.js';

const root = new URL('../../public/pdf-editor/', import.meta.url);
const assets = await Promise.all([...coreFonts, 'Carlito'].flatMap(family => ['Regular', 'Bold', 'Italic', 'BoldItalic']
  .map(weight => readFile(new URL(`fonts/${family.replaceAll(' ', '')}-${weight}.ttf`, root)))));
const engine = await PdfEngine.initialize(await readFile(new URL('vendor/pdfium.wasm', root)), assets);
engine.open(await readFile(new URL('demo.pdf', root)));
const view = () => engine.render(0, 595, 842, true);
const original = view();
const [initial] = detectTables(original);
const style = tableStyle(null, initial.rows.length, initial.widths.length);
style.cells[0][1].fill = '#ff4fa5';
style.outer = { color: '#6e22b7', width: 3, pattern: 'double' };
style.inner = { color: '#248263', width: 1.75, pattern: 'dash' };
Object.assign(style.cells[1][1], { border: { color: '#2d1af8', width: 2.5, pattern: 'dot' }, order: 1 });
engine.writeTable(0, {
  ...initial, style, id: 'check-table-style', font: 'Carlito',
  after: initial.y + initial.h, delta: 0,
  lines: initial.rows.map(row => row.map(text => [text])),
});
engine.open(engine.save());
let page = view();
const [table] = detectTables(page);
assert.equal(table.font, 'Carlito');
assert.deepEqual(table.style.outer, style.outer);
assert.deepEqual(table.style.inner, style.inner);
assert.equal(table.style.cells[0][1].fill, '#ff4fa5');
assert.equal(table.style.cells[1][1].border.pattern, 'dot');
assert.ok(page.objects.some(object => object.tableId === table.id && object.text === '₽'), 'fallback typeface embeds the missing ruble symbol');

function anchor(text, fraction) {
  const shape = page.objects.find(object => object.text?.startsWith(text));
  return engine.wordAt(0, shape.x + shape.w * fraction, shape.y + shape.h * .55, shape.index);
}
const word = anchor('Коммерческое', .5);
const cellWord = anchor('Айдентика', .12);
assert.equal(cellWord.label, 'Айдентика');
engine.markWord(0, word, '#82df9e');
engine.markWord(0, cellWord, '#ffe36a');
engine.open(engine.save());
page = view();
let green = 0;
const [left, bottom, right, top] = word.raw;
for (let y = Math.ceil(842 - top); y <= Math.floor(842 - bottom); y++) {
  for (let x = Math.ceil(left); x <= Math.floor(right); x++) {
    const offset = (y * 595 + x) * 4;
    if (page.pixels[offset + 1] > page.pixels[offset] + 10) green++;
  }
}
assert.ok(green > 100);
assert.ok(engine.page(0, p => engine.markerIndex(p, cellWord.raw)) >= 0);
assert.ok(engine.markWord(0, word, null));
assert.equal(engine.page(0, p => engine.markerIndex(p, word.raw)), -1);
engine.clear();
console.log('Styled outlines, grid, cell fills, Cyrillic font fallback and both marker targets survive export.');
