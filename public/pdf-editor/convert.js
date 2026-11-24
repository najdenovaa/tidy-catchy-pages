import { readDocx, readXlsx, writeDocx, writeXlsx } from './office.js';
import { detectTables, matchingFont, rect, textBlock, wrapText } from './layout.js';
import { kinds } from './pdf.js';

const sum = numbers => numbers.reduce((a, b) => a + b, 0);
const clamp = (n, low, high) => Math.min(high, Math.max(low, n));
const defaultColor = [32, 37, 56, 255];
const plain = value => String(value ?? '').replace(/\t/g, '    ').replace(/[^\p{L}\p{N}\p{P}\p{M}\p{Sc}\p{Sm}\p{Zs}\u20A0-\u20BF×÷±°№©®™•\r\n]/gu, '?');

export function inputFormat(name) {
  return name.match(/\.(pdf|docx|xlsx)$/i)?.[1].toLowerCase() ?? null;
}

export const fileMimes = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export async function officeToPdf(engine, bytes, type) {
  const office = type === 'docx' ? readDocx(bytes) : {
    page: { width: 841.89, height: 595.28, marginX: 34, marginY: 36 },
    blocks: readXlsx(bytes).flatMap((sheet, index) => {
      const across = sheet.rows[0].length;
      const blocks = [];
      for (let column = 0; column < across; column += 10) {
        if (index || column) blocks.push({ type: 'break' });
        blocks.push({ type: 'text', text: across > 10
          ? `${sheet.name} · столбцы ${column + 1}–${Math.min(across, column + 10)}` : sheet.name,
        size: 19, bold: true, font: 'Noto Sans' });
        blocks.push({ type: 'table', rows: sheet.rows.map(row => row.slice(column, column + 10)), size: 9 });
      }
      return blocks;
    }),
  };
  const families = new Set(office.blocks.filter(block => block.type === 'text').map(block => matchingFont(block.font)));
  await Promise.all([...families].flatMap(family => [
    engine.ensureFont(family), document.fonts.load(`400 14px "${family}"`), document.fonts.load(`700 14px "${family}"`),
  ]));
  const working = engine.temporary();
  try {
    working.createDocument();
    renderOffice(working, office);
    return working.save();
  } finally {
    working.clear();
  }
}

function renderOffice(engine, office) {
  const width = clamp(office.page.width, 290, 1450);
  const height = clamp(office.page.height, 290, 1750);
  const left = Math.min(office.page.marginX, width * .27);
  const top = Math.min(office.page.marginY, height * .27);
  const available = width - 2 * left;
  const bottom = height - top;
  let index = -1;
  let cursor = top;
  let queued = [];
  let started = false;
  const measure = document.createElement('canvas').getContext('2d');
  function measureText(text, { size, font, bold }) {
    measure.font = `${bold ? 700 : 400} ${size}px "${font}"`;
    return measure.measureText(text).width;
  }
  function flush() {
    if (!queued.length) return;
    const elements = queued;
    queued = [];
    engine.edit(index, page => {
      const dimensions = engine.dimensions(page);
      for (const element of elements) {
        if (element.type === 'image') engine.placeImage(page, element);
        else engine.drawLineText(page, dimensions, element);
      }
    });
  }
  function next() {
    flush();
    if (engine.count >= 250) throw new Error('В одном преобразовании поддерживается до 250 страниц.');
    engine.addPage(++index, width, height);
    cursor = top;
    started = false;
  }
  function ensure(space) {
    if (cursor + space > bottom && started) next();
  }

  next();
  for (const block of office.blocks) {
    if (block.type === 'break') {
      if (started) next();
      continue;
    }
    if (block.type === 'text') {
      const style = {
        size: clamp(block.size || 11, 6, 90), bold: block.bold ?? false,
        color: /^[0-9a-f]{6}$/i.test(block.color ?? '') ? [...block.color.match(/../g).map(channel => parseInt(channel, 16)), 255] : defaultColor,
        font: matchingFont(block.font), type: 'text',
      };
      const spacing = style.size * 1.35;
      for (const text of wrapText(plain(block.text), available - 1, text => measureText(text, style))) {
        ensure(spacing);
        const length = measureText(text, style);
        const x = block.align === 'center' ? (width - length) / 2
          : ['right', 'end'].includes(block.align) ? width - left - length : left;
        queued.push({ ...style, text, x, y: cursor + style.size });
        cursor += spacing;
        started = true;
      }
      cursor += Math.max(3, style.size * .26);
    } else if (block.type === 'image') {
      const scale = Math.min(1, available / block.width, (bottom - top - 8) / block.height);
      const w = block.width * scale, h = block.height * scale;
      if (!(w > 0 && h > 0)) continue;
      ensure(h + 4);
      queued.push({ ...block, width: w, height: h, x: left, y: cursor });
      cursor += h + 8;
      started = true;
    } else if (block.type === 'table') {
      const columns = Math.max(...block.rows.slice(0, 100000).map(row => row.length));
      if (!columns || columns > 40 || block.rows.length > 20000) throw new Error('Таблица слишком велика для одного PDF.');
      const size = block.size || (columns > 6 ? 9 : 11);
      const font = 'Noto Sans';
      const weights = block.widths?.length === columns && block.widths.every(weight => weight > 0) ? block.widths : Array(columns).fill(1);
      const widths = weights.map(weight => 16 + (available - columns * 16) * weight / sum(weights));
      const rows = block.rows.map(row => Array.from({ length: columns }, (_, col) => plain(row[col]).slice(0, 3000)));
      const allLines = rows.map((row, i) => row.map((field, col) => wrapText(field, widths[col] - 12,
        text => measureText(text, { size, font, bold: block.header && !i }))));
      const rowHeights = allLines.map(row => 13 + size * 1.24 * Math.max(...row.map(lines => lines.length)));
      if (rowHeights.some(h => h > bottom - top)) throw new Error('Одна из ячеек не помещается на странице.');
      flush();
      let first = 0;
      while (first < rows.length) {
        ensure(rowHeights[first]);
        let last = first;
        let space = 0;
        while (last < rows.length && last - first < 65 && cursor + space + rowHeights[last] <= bottom + .01) {
          space += rowHeights[last++];
        }
        if (last === first) {
          next();
          continue;
        }
        engine.writeTable(index, {
          id: crypto.randomUUID(), indices: [], after: cursor, delta: 0, x: left, y: cursor,
          rows: rows.slice(first, last), widths, heights: rowHeights.slice(first, last),
          lines: allLines.slice(first, last), size, font, boldHeader: Boolean(block.header && first === 0),
        });
        cursor += space + 10;
        started = true;
        first = last;
        if (first < rows.length) next();
      }
    }
  }
  flush();
}

function rowGeometry(objects, page) {
  const groups = [];
  for (const item of objects.map(object => ({ object, ...rect(object, page) })).sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = groups.at(-1);
    if (row && item.y - row.y < 5) row.items.push(item);
    else groups.push({ y: item.y, items: [item] });
  }
  return groups;
}

async function encodePng(image) {
  const target = document.createElement('canvas');
  target.width = image.width;
  target.height = image.height;
  target.getContext('2d').putImageData(new ImageData(image.pixels, image.width, image.height), 0, 0);
  const blob = await new Promise(resolve => target.toBlob(resolve, 'image/png'));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

export async function pdfToOffice(engine, type) {
  if (engine.count > 250) throw new Error('В одном преобразовании поддерживается до 250 страниц.');
  const result = [];
  let mediaSize = 0;
  for (let index = 0; index < engine.count; index++) {
    const page = engine.render(index, 20, 20, true);
    const tables = detectTables(page);
    const excluded = new Set(tables.flatMap(table => table.indices));
    const text = page.objects.filter(object => object.kind === kinds.text && object.text?.trim() && !excluded.has(object.index));
    if (type === 'xlsx') {
      for (const [tableIndex, table] of tables.entries()) {
        result.push({ name: `Стр ${index + 1} Таблица ${tableIndex + 1}`, rows: table.rows });
      }
      if (!tables.length && text.length) {
        const rows = rowGeometry(text, page).map(row => row.items.sort((a, b) => a.x - b.x)
          .reduce((fields, field, i, items) => {
            const previous = items[i - 1];
            if (previous && field.x - previous.x - previous.w < 10) {
              fields[fields.length - 1] += ' ' + field.object.text.trim();
            } else fields.push(field.object.text.trim());
            return fields;
          }, []));
        result.push({ name: `Страница ${index + 1}`, rows });
      }
      continue;
    }

    const remaining = new Set(text.map(object => object.index));
    const blocks = tables.map(table => ({
      type: 'table', y: table.y, rows: table.rows, size: table.size, font: table.font,
      widths: table.widths, header: table.boldHeader,
    }));
    for (const object of text.sort((a, b) => a.y - b.y || a.x - b.x)) {
      if (!remaining.has(object.index)) continue;
      const block = textBlock(object, page, excluded);
      block.indices.forEach(index => remaining.delete(index));
      const color = object.color?.slice(0, 3).map(channel => channel.toString(16).padStart(2, '0')).join('');
      blocks.push({
        type: 'text', text: block.text, y: block.y, left: clamp(block.x - 47, 0, 170),
        size: block.scanCover?.size || object.verticalSize || object.visualSize || object.size, bold: object.bold, italic: object.italic, underline: block.underline, strike: block.strike, font: block.font ?? matchingFont(object.fontName), color,
      });
    }
    for (const object of page.objects.filter(object => object.kind === kinds.image)) {
      const bitmap = engine.page(index, pointer => engine.imagePixels(pointer, object.index));
      if (!bitmap) continue;
      const bytes = await encodePng(bitmap);
      if (!bytes) continue;
      mediaSize += bytes.length;
      if (mediaSize > 80 * 1024 * 1024) throw new Error('Изображения слишком велики для одного DOCX.');
      const bounds = rect(object, page);
      blocks.push({ type: 'image', bytes, y: bounds.y, width: bounds.w, height: bounds.h });
    }
    if (!blocks.length && page.objects.length) {
      const rendered = engine.render(index, 1080, 1200);
      const bytes = await encodePng(rendered);
      if (bytes) {
        mediaSize += bytes.length;
        if (mediaSize > 80 * 1024 * 1024) throw new Error('Изображения слишком велики для одного DOCX.');
        blocks.push({ type: 'image', bytes, y: 0, width: page.pageWidth, height: page.pageHeight });
      }
    }
    result.push(blocks.sort((a, b) => a.y - b.y));
  }
  if (type === 'xlsx' && !result.length) throw new Error('В этом PDF нет текста или таблиц для переноса в Excel.');
  return type === 'xlsx' ? writeXlsx(result) : writeDocx(result);
}
