// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { IDBFactory } from 'fake-indexeddb';
import { inspectOfficeFont, installOfficeFonts, officeFace, fontLabel } from '../../public/pdf-editor/office-fonts.js';
const original = () => new Uint8Array(readFileSync(new URL('../../public/pdf-editor/fonts/LiberationSans-Regular.ttf', import.meta.url)));
function fixture() {
  const bytes = original(), view = new DataView(bytes.buffer);
  let name = 0;
  for (let i = 0; i < view.getUint16(4); i++) {
    const pos = 12 + 16 * i;
    if (new TextDecoder().decode(bytes.subarray(pos, pos + 4)) === 'name') name = view.getUint32(pos + 8);
  }
  const strings = name + view.getUint16(name + 4);
  for (let i = 0; i < view.getUint16(name + 2); i++) {
    const pos = name + 6 + 12 * i;
    if (![0, 3].includes(view.getUint16(pos)) || ![1, 4, 16].includes(view.getUint16(pos + 6))) continue;
    const length = view.getUint16(pos + 8), offset = strings + view.getUint16(pos + 10);
    const label = 'Arial'.padEnd(length / 2, ' ');
    for (let j = 0; j < length / 2; j++) view.setUint16(offset + j * 2, label.charCodeAt(j));
  }
  return bytes;
}
afterEach(() => vi.unstubAllGlobals());
it('parses and keeps a locally supplied original separate from the bundled analogue', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  expect(fontLabel('Arial')).toContain('аналог');
  const record = inspectOfficeFont(fixture());
  expect(record.family).toBe('Arial'); expect(record.face).toBe('Regular');
  const result = await installOfficeFonts([record.bytes]);
  expect(result.persisted).toBe(true);
  expect(officeFace('Arial', 'Regular')).toEqual(record.bytes);
  expect(fontLabel('Arial')).toContain('оригинал 1/4');
  expect(officeFace('Arial', 'Bold')).toBeUndefined();
});
it('rejects a font with restricted document embedding', () => {
  const bytes = fixture(), view = new DataView(bytes.buffer);
  for (let i = 0; i < view.getUint16(4); i++) {
    const pos = 12 + 16 * i;
    if (new TextDecoder().decode(bytes.subarray(pos, pos + 4)) === 'OS/2') view.setUint16(view.getUint32(pos + 8) + 8, 2);
  }
  expect(() => inspectOfficeFont(bytes)).toThrow('ограничивает');
});
it('rejects non-font data and unsupported font families', () => {
  expect(() => inspectOfficeFont(new Uint8Array([1, 2]))).toThrow();
  expect(() => inspectOfficeFont(original())).toThrow('Поддерживаются');
});
