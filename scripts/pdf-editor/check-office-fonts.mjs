import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PdfEngine } from '../../public/pdf-editor/pdf.js';
import { coreFonts, matchingFont } from '../../public/pdf-editor/layout.js';
import { officeAliases, faceNames, fontLabel } from '../../public/pdf-editor/office-fonts.js';
const root = new URL('../../public/pdf-editor/', import.meta.url);
const data = await Promise.all(coreFonts.flatMap(family => faceNames.map(face => readFile(new URL(`fonts/${family.replaceAll(' ', '')}-${face}.ttf`, root)))));
const engine = await PdfEngine.initialize(await readFile(new URL('vendor/pdfium.wasm', root)), data);
const oldFetch = globalThis.fetch;
globalThis.fetch = async url => ({ ok: true, arrayBuffer: async () => new Uint8Array(await readFile(url)).buffer });
try {
  engine.createDocument(); engine.addPage(0, 595, 842);
  let row = 0;
  for (const family of Object.keys(officeAliases)) {
    await engine.ensureFont(family);
    assert.equal(matchingFont(family.replaceAll(' ', '') + '-BoldItalic'), family);
    assert.ok(fontLabel(family).includes('аналог'));
    for (let i = 0; i < 4; i++) {
      const text = `Проверка шрифта ${family} ${i}`;
      engine.writeBlock(0, { id: `office-${row}`, indices: [], after: 800, delta: 0, font: family, size: 12,
        width: 520, x: 25, baseline: 35 + row++ * 30, lineHeight: 16, text, lines: [text],
        bold: Boolean(i % 2), italic: i >= 2, color: [20, 20, 20, 255] });
    }
  }
  engine.open(engine.save());
  const page = engine.render(0, 595, 842, true);
  for (const family of Object.keys(officeAliases)) {
    assert.equal(page.objects.filter(object => object.blockSpec?.font === family).length, 4, family);
    assert.equal(page.objects.filter(object => Array.from({ length: 4 }, (_, i) => `Проверка шрифта ${family} ${i}`).includes(object.text)).length, 4, family);
  }
  engine.clear();
  console.log('Five office families, all 20 styles and Cyrillic survive PDF save/reopen with explicit analogue labels.');
} finally { globalThis.fetch = oldFetch; }
