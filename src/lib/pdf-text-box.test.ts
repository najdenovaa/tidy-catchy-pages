// @vitest-environment node
import { expect, it } from 'vitest';
import { resizeTextBox, moveTextBox } from '../../public/pdf-editor/text-box.js';
const page = { pageWidth: 595, pageHeight: 842 };
const box = () => ({ mode: 'text', x: 100, y: 200, baseline: 213, width: 90, size: 12, lineHeight: 15, scanCover: { raw: [100, 620, 190, 640], color: '#ffffff', size: 12 } });
it('widens the field without changing its location, font or original scan erasure', () => {
  const draft = box(), cover = structuredClone(draft.scanCover);
  resizeTextBox(draft, 300, page);
  expect(draft.width).toBe(300); expect(draft.x).toBe(100); expect(draft.baseline).toBe(213);
  expect(draft.scanCover).toEqual(cover); expect(draft.size).toBe(12);
});
it('moves text and its baseline together while leaving the old scan mask fixed', () => {
  const draft = box(), cover = structuredClone(draft.scanCover);
  moveTextBox(draft, 200, 300, page);
  expect(draft.x).toBe(200); expect(draft.y).toBe(300); expect(draft.baseline).toBe(313);
  expect(draft.scanCover).toEqual(cover);
});
it('constrains width and horizontal movement to the page', () => {
  const draft = box(); resizeTextBox(draft, 9999, page); expect(draft.width).toBe(492);
  moveTextBox(draft, 9999, 200, page); expect(draft.x).toBe(100);
  resizeTextBox(draft, -5, page); expect(draft.width).toBe(24);
  moveTextBox(draft, -100, -100, page); expect(draft.x).toBe(3); expect(draft.y).toBe(3);
});
it('ignores invalid numeric input and remains serializable for session restoration', () => {
  const draft = box(), original = structuredClone(draft);
  resizeTextBox(draft, NaN, page); moveTextBox(draft, Infinity, 20, page);
  expect(draft).toEqual(original);
  resizeTextBox(draft, 200, page); moveTextBox(draft, 150, 240, page);
  expect(structuredClone(draft)).toEqual(draft);
});
