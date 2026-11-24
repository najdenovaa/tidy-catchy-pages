export const officeAliases = {
  'Times New Roman': 'Liberation Serif', Arial: 'Liberation Sans',
  'Arial Narrow': 'Roboto Condensed', Calibri: 'Carlito', 'Courier New': 'Liberation Mono',
};
export const faceNames = ['Regular', 'Bold', 'Italic', 'BoldItalic'];
const originals = new Map();
export const officeFace = (family, face) => originals.get(`${family}/${face}`)?.bytes;
export function fontLabel(family) {
  if (!officeAliases[family]) return family;
  const count = faceNames.filter(face => officeFace(family, face)).length;
  return count === 4 ? `${family} — оригинал` : count ? `${family} — оригинал ${count}/4` : `${family} — аналог ${officeAliases[family]}`;
}

export function inspectOfficeFont(input) {
  const bytes = new Uint8Array(input);
  if (bytes.length < 12 || bytes.length > 12 * 1024 * 1024) throw new Error('Выберите файл шрифта TTF до 12 МБ.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) !== 0x00010000) throw new Error('Нужен шрифт TrueType (.ttf), не коллекция TTC или OpenType CFF.');
  const tables = {};
  for (let i = 0; i < view.getUint16(4); i++) {
    const pos = 12 + i * 16;
    const tag = new TextDecoder().decode(bytes.subarray(pos, pos + 4));
    const offset = view.getUint32(pos + 8), length = view.getUint32(pos + 12);
    if (offset + length > bytes.length) throw new Error('Повреждённый файл шрифта.');
    tables[tag] = offset;
  }
  if (!tables.name || !tables.glyf || !tables['OS/2']) throw new Error('Неполный шрифт TrueType.');
  const permissions = view.getUint16(tables['OS/2'] + 8);
  if (permissions & (2 | 4 | 256 | 512)) throw new Error('Этот шрифт ограничивает встраивание в редактируемый PDF.');
  const names = {};
  const table = tables.name, count = view.getUint16(table + 2), strings = table + view.getUint16(table + 4);
  for (let i = 0; i < count; i++) {
    const pos = table + 6 + i * 12;
    const platform = view.getUint16(pos), language = view.getUint16(pos + 4), id = view.getUint16(pos + 6);
    if (![1, 2, 4, 16, 17].includes(id) || ![0, 3].includes(platform)) continue;
    const length = view.getUint16(pos + 8), offset = strings + view.getUint16(pos + 10);
    const text = new TextDecoder('utf-16be').decode(bytes.subarray(offset, offset + length));
    if (!names[id] || language === 0x409) names[id] = text;
  }
  const clean = text => (text ?? '').replace(/[^a-z]/gi, '').toLowerCase();
  const title = clean(names[4]);
  const family = Object.keys(officeAliases).sort((a, b) => b.length - a.length)
    .find(name => title.startsWith(clean(name)) || clean(names[16] ?? names[1]) === clean(name));
  if (!family) throw new Error('Поддерживаются Times New Roman, Arial, Arial Narrow, Calibri и Courier New.');
  const style = `${names[17] ?? names[2]} ${names[4]}`;
  const face = faceNames[Number(/bold/i.test(style)) + 2 * Number(/italic|oblique/i.test(style))];
  return { family, face, bytes };
}

function fontDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('deallsoft-pdf-local-fonts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('fonts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function remember(records) {
  const db = await fontDatabase();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction('fonts', 'readwrite');
      for (const record of records) tx.objectStore('fonts').put(record, `${record.family}/${record.face}`);
      tx.oncomplete = resolve;
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}
async function prepareFace(record) {
  const index = faceNames.indexOf(record.face);
  if (typeof FontFace !== 'undefined') {
    const face = new FontFace(record.family, record.bytes, { weight: index % 2 ? '700' : '400', style: index >= 2 ? 'italic' : 'normal' });
    return face.load();
  }
}
function activate(record, face) {
  if (face) document.fonts.add(face);
  originals.set(`${record.family}/${record.face}`, record);
}
export async function installOfficeFonts(buffers) {
  const records = buffers.map(inspectOfficeFont);
  const faces = await Promise.all(records.map(prepareFace));
  records.forEach((record, index) => activate(record, faces[index]));
  let persisted = true;
  try { await remember(records); } catch { persisted = false; }
  return { records, persisted };
}
export async function restoreOfficeFonts() {
  try {
    const db = await fontDatabase();
    const records = await new Promise((resolve, reject) => {
      const request = db.transaction('fonts').objectStore('fonts').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).finally(() => db.close());
    for (const record of records) { try { const valid = inspectOfficeFont(record.bytes); activate(valid, await prepareFace(valid)); } catch { /* Ignore invalid cached font. */ } }
  } catch { /* Compatible bundled fonts remain available without local storage. */ }
}
