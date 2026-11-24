import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PdfEngine } from '../../public/pdf-editor/pdf.js';
import { coreFonts, textBlock } from '../../public/pdf-editor/layout.js';
import { scanLines } from '../../public/pdf-editor/scan.js';

const root = new URL('../../public/pdf-editor/', import.meta.url);
const assets = await Promise.all(coreFonts.flatMap(family => ['Regular', 'Bold', 'Italic', 'BoldItalic']
  .map(weight => readFile(new URL(`fonts/${family.replaceAll(' ', '')}-${weight}.ttf`, root)))));
const engine = await PdfEngine.initialize(await readFile(new URL('vendor/pdfium.wasm', root)), assets);
const bytes = await readFile(new URL('demo.pdf', root));
engine.open(bytes);

const rendering = engine.render(2, 595, 842, true);
const source = rendering.objects.find(object => object.kind === 3);
const fragment = engine.copyPage(2, source);
const index = engine.pasteObject(1, { bytes: fragment, image: true }, { x: .15, y: .64 });
engine.open(engine.save());
const pasted = engine.render(1, 595, 842, true).objects.find(object => object.index === index);
assert.ok(pasted.clipboardImage);
assert.ok(Math.abs(pasted.w - source.w) < .001);
assert.ok(Math.abs(pasted.h - source.h) < .001);
assert.ok(Math.abs(pasted.x - .15) < .001);
assert.ok(Math.abs(pasted.y - .64) < .001);

const page = engine.temporary();
page.open(engine.copyPage(0));
engine.importPage(page, 0, 1);
assert.equal(engine.count, 4);
page.clear();

engine.open(bytes);
const box = { x0: 80, x1: 280, y0: 330, y1: 360 };
const result = scanLines({ blocks: [{ paragraphs: [{ lines: [{ bbox: box, words: [{
  text: 'Тест', confidence: 90, symbols: [...'Тест'].map((text, i) => ({ text, confidence: i === 2 ? 10 : 97 })),
}]}] }] }] }, rendering);
assert.equal(result.lines[0].text, 'Те*т');
assert.equal(result.doubtful, 1);
engine.addScanLayer(2, result.lines);
engine.open(engine.save());
const recognized = engine.render(2, 595, 842, true);
assert.deepEqual(recognized.pixels, rendering.pixels);
const text = recognized.objects.find(item => item.blockSpec?.scanCover);
const block = textBlock(text, recognized, new Set());
assert.equal(block.text, 'Те*т');
engine.writeBlock(2, { ...block, text: 'Тест', lines: ['Тест'], size: block.scanCover.size, delta: 0,
  color: [28, 31, 40, 255], bold: false, italic: false });
engine.open(engine.save());
const edited = engine.render(2, 595, 842, true);
assert.ok(edited.objects.some(item => item.text === 'Тест' && item.blockSpec?.scanCover));
assert.deepEqual(edited.objects.find(item => item.kind === 3).raw, source.raw);
engine.clear();
console.log('Native image and page clipboard, uncertain OCR symbols, pixel-identical scan layer and editable scan text verified.');
