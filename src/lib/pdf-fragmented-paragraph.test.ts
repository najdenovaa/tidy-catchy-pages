// @vitest-environment node
import { expect, it } from 'vitest';
import { textBlock, fontIdentity } from '../../public/pdf-editor/layout.js';
const page = { pageWidth: 600, pageHeight: 800, objects: [] };
function words() {
  return Array.from({ length: 9 }, (_, index) => {
    const row = Math.floor(index / 3), col = index % 3;
    return { index, kind: 1, text: `слово${index}`, fontName: index % 2 ? 'ABCDEF+TimesNewRomanPSMT' : 'TimesNewRomanPSMT',
      bold: false, italic: false, size: 12, visualSize: 12, horizontal: true,
      x: (60 + col * 53) / 600, y: (200 + row * 15) / 800, w: 50 / 600, h: 12 / 800, baseline: (210 + row * 15) / 800 };
  });
}
it('replaces all words of a paragraph despite different PDF subset prefixes', () => {
  const objects = words(); const block = textBlock(objects[0], { ...page, objects }, new Set());
  expect(block.indices).toHaveLength(9); expect(block.rows).toBe(3);
  expect(block.text).toBe(objects.map(o => o.text).join(' '));
  expect(fontIdentity('ABCDEF+TimesNewRomanPSMT')).toBe(fontIdentity('TimesNewRomanPSMT'));
});
it('does not merge a different face or italic style into the selected paragraph', () => {
  const objects = words(); objects[8].fontName = 'Arial'; objects[7].italic = true;
  const block = textBlock(objects[0], { ...page, objects }, new Set());
  expect(block.indices).not.toContain(8); expect(block.indices).not.toContain(7);
});
