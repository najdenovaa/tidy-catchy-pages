// @vitest-environment node
import { expect, it } from 'vitest';
import { pdfToOffice } from '../../public/pdf-editor/convert.js';
import { writeDocx, wordFontName } from '../../public/pdf-editor/office.js';
import { unzipSync, strFromU8 } from '../../public/pdf-editor/vendor/fflate.js';
const xml = (bytes: Uint8Array) => Object.fromEntries(Object.entries(unzipSync(bytes)).map(([key, value]) => [key, strFromU8(value)]));
it('preserves Russian Unicode and explicitly declares Windows office fonts and language', () => {
  const text = 'АКТ ПРИЁМА-ПЕРЕДАЧИ. Мы, нижеподписавшиеся, № 123. Ёж. CaCl₂, 10 тонн.';
  const files = xml(writeDocx([[{ type: 'text', text, font: 'Noto Sans', size: 11 }]]));
  expect(files['word/document.xml']).toContain(text);
  expect(files['word/document.xml']).toContain('w:hAnsi="Arial"');
  expect(files['word/document.xml']).toContain('w:lang w:val="ru-RU"');
  expect(files['word/document.xml']).not.toContain('□');
  expect(files['word/styles.xml']).toContain('w:ascii="Arial"');
  expect(files['word/fontTable.xml']).toContain('Times New Roman');
  expect(files['word/_rels/document.xml.rels']).toContain('fontTable.xml');
});
it('uses the original OCR font height rather than stretched horizontal glyph size', async () => {
  const object = { index: 0, kind: 1, text: 'Подпись: Иванов', size: 11, visualSize: 44, verticalSize: 11,
    x: .1, y: .4, w: .5, h: .02, baseline: .42, origin: .1, bold: false, italic: false,
    fontName: 'NotoSans-Regular', color: [20,20,20,0], blockId: 'ocr-test',
    blockSpec: { text: 'Подпись: Иванов', font: 'Noto Sans', width: 300, lineHeight: 13.75, rows: 1, first: 0,
      scanCover: { size: 11, raw: [10,10,20,20], color: '#ffffff' } } };
  const engine = { count: 1, render: () => ({ pageWidth: 595, pageHeight: 842, objects: [object] }) };
  const files = xml(await pdfToOffice(engine, 'docx'));
  expect(files['word/document.xml']).toContain('<w:sz w:val="22"/>');
  expect(files['word/document.xml']).not.toContain('<w:sz w:val="88"/>');
});
it('uses vertical font size for ordinary horizontally stretched PDF text too', async () => {
  const object = { index: 0, kind: 1, text: 'Проверка', size: 10, visualSize: 40, verticalSize: 10, horizontal: true,
    x: .1, y: .2, w: .4, h: .015, baseline: .21, origin: .1, fontName: 'Arial', color: [0,0,0,255] };
  const files = xml(await pdfToOffice({ count: 1, render: () => ({ pageWidth: 595, pageHeight: 842, objects: [object] }) }, 'docx'));
  expect(files['word/document.xml']).toContain('<w:sz w:val="20"/>');
});
it('maps sans, serif, narrow and monospace families without losing their basic character', () => {
  expect(wordFontName('Noto Serif')).toBe('Times New Roman');
  expect(wordFontName('Roboto Condensed')).toBe('Arial Narrow');
  expect(wordFontName('Carlito')).toBe('Calibri');
  expect(wordFontName('Liberation Mono')).toBe('Courier New');
  expect(wordFontName('Open Sans')).toBe('Arial');
});
