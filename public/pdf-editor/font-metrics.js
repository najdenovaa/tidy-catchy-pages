function glyph12(view, cmap, code) {
  let low = 0, high = view.getUint32(cmap + 12) - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const group = cmap + 16 + mid * 12;
    const start = view.getUint32(group), end = view.getUint32(group + 4);
    if (code < start) high = mid - 1;
    else if (code > end) low = mid + 1;
    else return view.getUint32(group + 8) + code - start;
  }
  return 0;
}

function glyph4(view, cmap, code) {
  if (code > 0xffff) return 0;
  const count = view.getUint16(cmap + 6) / 2;
  const ends = cmap + 14;
  const starts = ends + count * 2 + 2;
  const deltas = starts + count * 2;
  const offsets = deltas + count * 2;
  let low = 0, high = count;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (view.getUint16(ends + mid * 2) < code) low = mid + 1;
    else high = mid;
  }
  if (low >= count) return 0;
  const index = low * 2;
  const start = view.getUint16(starts + index);
  if (code < start) return 0;
  const delta = view.getInt16(deltas + index);
  const address = offsets + index;
  const offset = view.getUint16(address);
  if (!offset) return (code + delta) & 0xffff;
  const raw = view.getUint16(address + offset + (code - start) * 2);
  return raw ? (raw + delta) & 0xffff : 0;
}

export function readFontMetrics(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(4);
  const tables = new Map();
  for (let i = 0; i < count; i++) {
    const entry = 12 + i * 16;
    const name = String.fromCharCode(...bytes.subarray(entry, entry + 4));
    tables.set(name, view.getUint32(entry + 8));
  }
  const cmap = tables.get('cmap'), head = tables.get('head'), hhea = tables.get('hhea'), hmtx = tables.get('hmtx');
  const units = view.getUint16(head + 18);
  const metrics = view.getUint16(hhea + 34);
  const unicodeTables = [];
  for (let i = 0; i < view.getUint16(cmap + 2); i++) {
    const entry = cmap + 4 + i * 8;
    const platform = view.getUint16(entry);
    const encoding = view.getUint16(entry + 2);
    if (platform !== 0 && !(platform === 3 && [1, 10].includes(encoding))) continue;
    const offset = cmap + view.getUint32(entry + 4);
    const format = view.getUint16(offset);
    if (format === 4 || format === 12) unicodeTables.push({ offset, format });
  }
  unicodeTables.sort((a, b) => b.format - a.format);
  const cache = new Map();
  function glyph(char) {
    if (!cache.has(char)) {
      const code = char.codePointAt(0);
      let value = 0;
      for (const { offset, format } of unicodeTables) {
        value = format === 12 ? glyph12(view, offset, code) : glyph4(view, offset, code);
        if (value) break;
      }
      cache.set(char, value);
    }
    return cache.get(char);
  }
  return { glyph, advance: char => view.getUint16(hmtx + Math.min(glyph(char), metrics - 1) * 4) / units };
}
