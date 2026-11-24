import { officeAliases } from '../../public/pdf-editor/office-fonts.js';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PdfEngine } from '../../public/pdf-editor/pdf.js';
import { fonts, textBlock } from '../../public/pdf-editor/layout.js';

const root = new URL('../../public/pdf-editor/', import.meta.url);
const assets = await Promise.all(fonts.flatMap(family => ['Regular', 'Bold', 'Italic', 'BoldItalic']
  .map(weight => readFile(new URL(`fonts/${(officeAliases[family] ?? family).replaceAll(' ', '')}-${weight}.ttf`, root)))));
const engine = await PdfEngine.initialize(await readFile(new URL('vendor/pdfium.wasm', root)), assets);
engine.open(await readFile(new URL('demo.pdf', root)));
const view = () => engine.render(0, 100, 145, true);
const original = view();
const wordObject = original.objects.find(object => object.text === 'Коммерческое');
const anchor = engine.wordAt(0, wordObject.x + wordObject.w * .5, wordObject.y + wordObject.h * .55, wordObject.index);
assert.equal(anchor.label, 'Коммерческое');

const noteText = 'Замечание к слову\nВторая строка';
const annotation = engine.addNote(0, anchor, noteText);
const annotatedPdf = engine.save();
assert.match(new TextDecoder().decode(annotatedPdf), /\/Annots\s*\[\s*\d+\s+\d+\s+R/);
engine.open(annotatedPdf);
let page = view();
assert.equal(page.notes[0].text, noteText);
assert.equal(page.notes[0].label, anchor.label);
assert.ok(page.notes[0].pin.x > .9);
assert.deepEqual(page.objects.map(({ kind, raw }) => [kind, raw]), original.objects.map(({ kind, raw }) => [kind, raw]));
engine.editNote(0, annotation, 'Исправлено');
assert.equal(view().notes[0].text, 'Исправлено');
engine.removeNote(0, annotation);
assert.equal(view().notes.length, 0);

const text = 'Курсив, подчёркивание и зачёркивание';
const plan = {
  id: 'check-style', indices: [], after: 615, delta: 0, font: 'Noto Sans', size: 19, width: 500,
  x: 49, baseline: 693, lineHeight: 24, text, lines: [text], bold: true, italic: true,
  underline: true, strike: true, color: [20, 20, 20, 255],
};
engine.writeBlock(0, plan);
engine.open(engine.save());
page = view();
const styled = page.objects.find(object => object.text === text);
assert.equal(styled.fontName, 'NotoSans-BoldItalic');
assert.equal(styled.blockSpec.underline, true);
assert.equal(styled.blockSpec.strike, true);
const block = textBlock(styled, page, new Set());
assert.equal(block.indices.length, 3);

engine.writeBlock(0, { ...plan, indices: block.indices, underline: false, strike: false });
engine.open(engine.save());
assert.equal(view().objects.filter(object => object.blockId === 'check-style').length, 1);
engine.clear();
console.log('Native PDF notes leave all object positions unchanged. Italic and both decorations survive export and are editable after reopening.');
