import { officeAliases } from './office-fonts.js';
export const coreFonts = ['Noto Sans', 'Noto Serif', 'Liberation Sans', 'Liberation Serif', 'Liberation Mono'];
export const fonts = [...coreFonts,
  'Carlito', 'PT Sans', 'PT Serif', 'Roboto', 'Open Sans', 'Fira Sans', 'IBM Plex Sans',
  'Source Sans 3', 'Ubuntu', 'Rubik', 'Montserrat', 'Noto Sans Display', 'Noto Serif Display',
  'Cormorant Garamond', 'Literata', 'Lora', 'Merriweather', 'Playfair Display', 'Spectral', 'Roboto Condensed', ...Object.keys(officeAliases),
];

export function matchingFont(name = '') {
  const clean = name.replace(/^[A-Z]{6}\+/, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  const exact = fonts.toSorted((a, b) => b.length - a.length)
    .find(family => clean.startsWith(family.replaceAll(' ', '').toLowerCase()));
  if (exact) return exact;
  if (/calibri/i.test(name)) return 'Carlito';
  if (/noto.?serif/i.test(name)) return 'Noto Serif';
  if (/times|liberation.?serif|serif|minion/i.test(name)) return 'Liberation Serif';
  if (/courier|liberation.?mono|monospace|consolas/i.test(name)) return 'Liberation Mono';
  if (/arial|helvetica|liberation.?sans/i.test(name)) return 'Liberation Sans';
  return 'Noto Sans';
}

export function wrapText(value, width, measure) {
  return value.replace(/\r\n?/g, '\n').split('\n').flatMap(paragraph => {
    const lines = [];
    let current = '';
    for (const word of paragraph.trim().split(/[^\S\u00a0]+/u)) {
      const candidate = current ? current + ' ' + word : word;
      if (current && measure(candidate) > width) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
      if (measure(current) > width) {
        let chunk = '';
        for (const char of current) {
          if (chunk && measure(chunk + char) > width) {
            lines.push(chunk);
            chunk = '';
          }
          chunk += char;
        }
        current = chunk;
      }
    }
    lines.push(current);
    return lines;
  });
}

export function rect(object, page) {
  const { pageWidth: w, pageHeight: h } = page;
  return { x: object.x * w, y: object.y * h, w: object.w * w, h: object.h * h };
}

export function textBlock(selected, page, excluded) {
  const size = selected.visualSize || selected.size || 14;
  const base = rect(selected, page);
  if (selected.blockId && selected.horizontal) {
    const members = page.objects.filter(object => object.blockId === selected.blockId);
    const first = members.find(object => object.blockSpec);
    if (first) {
      const spec = first.blockSpec;
      const bounds = members.filter(object => object.kind === 1).map(object => rect(object, page));
      const baseline = first.baseline * page.pageHeight - spec.first * spec.lineHeight;
      return {
        ...spec, id: selected.blockId, x: first.origin * page.pageWidth, y: Math.min(...bounds.map(box => box.y)),
        baseline, after: Math.max(...bounds.map(box => box.y + box.h), baseline + (spec.rows - 1) * spec.lineHeight),
        indices: members.map(object => object.index),
      };
    }
  }
  const same = page.objects
    .filter(object => object.kind === 1 && object.text?.trim() && !excluded.has(object.index)
      && object.bold === selected.bold && Math.abs((object.visualSize || object.size) - size) < 0.45
      && object.fontName === selected.fontName && object.horizontal && !object.blockId)
    .map(object => ({ ...rect(object, page), object, baseline: object.baseline * page.pageHeight }))
    .sort((a, b) => a.baseline - b.baseline || a.x - b.x);
  const rows = [];
  for (const item of same) {
    const last = rows.at(-1);
    if (last && Math.abs(last.baseline - item.baseline) <= 0.9) {
      last.items.push(item);
    } else {
      rows.push({ baseline: item.baseline, items: [item] });
    }
  }
  for (const row of rows) {
    row.items.sort((a, b) => a.x - b.x);
    row.groups = [];
    for (const item of row.items) {
      const group = row.groups.at(-1);
      if (group && item.x - group.right < size * 0.75) {
        const gap = item.x - group.right;
        group.right = Math.max(group.right, item.x + item.w);
        group.items.push(item);
        group.text += (gap > size * 0.15 && !/\s$/.test(group.text) && !/^\s/.test(item.object.text) ? ' ' : '') + item.object.text;
      } else {
        row.groups.push({ x: item.x, right: item.x + item.w, text: item.object.text, items: [item] });
      }
    }
  }
  const originIndex = rows.findIndex(row => row.items.some(item => item.object.index === selected.index));
  if (originIndex < 0) {
    return {
      x: base.x, y: base.y, width: Math.max(base.w, page.pageWidth - base.x - 23),
      baseline: (selected.baseline ?? selected.y + selected.h) * page.pageHeight,
      after: base.y + base.h, lineHeight: size * 1.25, rows: 1, indices: [selected.index], text: selected.text ?? '',
    };
  }
  const origin = rows[originIndex].groups.find(group => group.items.some(item => item.object.index === selected.index));
  const groups = [{ ...origin, baseline: rows[originIndex].baseline }];
  for (const direction of [-1, 1]) {
    let previous = rows[originIndex];
    for (let i = originIndex + direction; rows[i]; i += direction) {
      const row = rows[i];
      const gap = Math.abs(row.baseline - previous.baseline);
      if (gap < size * 0.88 || gap > size * 1.75) break;
      const next = row.groups.find(group => Math.abs(group.x - origin.x) <= Math.max(3, size * 0.55));
      if (!next || Math.abs(next.right - next.x - (origin.right - origin.x)) > (page.pageWidth - origin.x) * 0.57) break;
      groups.push({ ...next, baseline: row.baseline });
      previous = row;
    }
  }
  groups.sort((a, b) => a.baseline - b.baseline);
  const items = groups.flatMap(group => group.items);
  const x = Math.min(...groups.map(group => group.x));
  const y = Math.min(...items.map(item => item.y));
  const after = Math.max(...items.map(item => item.y + item.h));
  const indices = items.map(item => item.object.index);
  const end = Math.max(...groups.map(group => group.right));
  const neighbors = page.objects.filter(object => !indices.includes(object.index) && object.kind === 1)
    .map(object => rect(object, page))
    .filter(item => item.x >= end + 3 && item.y <= after && item.y + item.h >= y);
  const pageRight = page.pageWidth - Math.min(39, Math.max(12, x));
  const right = Math.min(pageRight, ...neighbors.map(item => item.x - 5),
    groups.length > 1 ? end + Math.max(9, (end - x) * .12) : Number.POSITIVE_INFINITY);
  const lineHeight = groups.length > 1 ? (groups.at(-1).baseline - groups[0].baseline) / (groups.length - 1) : size * 1.25;
  return {
    x, y, width: Math.max(end - x + 2, right - x), baseline: groups[0].baseline, after, lineHeight,
    rows: groups.length, indices, text: groups.map(group => group.text.trim()).join(' '),
  };
}

function cluster(values, distance) {
  const groups = [];
  for (const value of values.toSorted((a, b) => a - b)) {
    const last = groups.at(-1);
    if (last && value - last[0] <= distance) last.push(value);
    else groups.push([value]);
  }
  return groups.map(group => ({ value: group.reduce((sum, value) => sum + value, 0) / group.length, count: group.length }));
}

function inside(rect, box, tolerance = 1.5) {
  return rect.x >= box.x - tolerance && rect.x + rect.w <= box.x + box.w + tolerance
    && rect.y >= box.y - tolerance && rect.y + rect.h <= box.y + box.h + tolerance;
}

export function tableFromRegion(page, box, rowBounds, columnBounds) {
  const members = page.objects.filter(object => inside(rect(object, page), box, 2));
  const text = members.filter(object => object.kind === 1 && object.text?.trim())
    .map(object => ({ ...rect(object, page), object }));
  if (!text.length && !rowBounds) return null;
  if (!rowBounds) {
    const estimated = cluster(text.map(item => item.y + item.h * 0.6), 6);
    if (estimated.length < 2 || estimated.length > 65) return null;
    rowBounds = [box.y, ...estimated.slice(1).map(({ value }, index) => (value + estimated[index].value) / 2), box.y + box.h];
  }
  if (!columnBounds) {
    const recurring = cluster(text.map(item => item.x), Math.max(4, box.w * .02))
      .filter(({ count }) => count >= 2);
    const boundaries = recurring.slice(1).map(({ value }) => value - 4)
      .filter(value => value > box.x + 12 && value < box.x + box.w - 14);
    columnBounds = [box.x, ...boundaries, box.x + box.w];
  }
  if (rowBounds.length < 3 || rowBounds.length > 66 || columnBounds.length < 3 || columnBounds.length > 13) return null;
  const cells = rowBounds.slice(1).map(() => columnBounds.slice(1).map(() => []));
  for (const item of text) {
    const row = rowBounds.findIndex((bound, i) => i && bound >= item.y + item.h * .5) - 1;
    const col = columnBounds.findIndex((bound, i) => i && bound > item.x + Math.min(4, item.w * .1)) - 1;
    if (row >= 0 && col >= 0) cells[row][col].push(item);
  }
  const rows = cells.map(row => row.map(items => items.toSorted((a, b) => a.y - b.y || a.x - b.x)
    .map(item => item.object.text.trim()).join(' ')));
  const sizes = text.map(item => item.object.visualSize || item.object.size).filter(Number.isFinite).sort((a, b) => a - b);
  return {
    ...box, rows, widths: columnBounds.slice(1).map((bound, index) => bound - columnBounds[index]),
    heights: rowBounds.slice(1).map((bound, index) => bound - rowBounds[index]),
    indices: members.map(object => object.index), size: sizes[Math.floor(sizes.length / 2)] ?? 11,
    font: matchingFont(text[0]?.object.fontName), boldHeader: false,
  };
}

export function detectTables(page) {
  const tagged = new Map();
  for (const object of page.objects) {
    if (!object.tableId) continue;
    if (!tagged.has(object.tableId)) tagged.set(object.tableId, { indices: [] });
    const table = tagged.get(object.tableId);
    table.indices.push(object.index);
    if (object.tableSpec) {
      const frame = rect(object, page);
      const width = object.tableSpec.widths.reduce((sum, value) => sum + value, 0);
      const height = object.tableSpec.heights.reduce((sum, value) => sum + value, 0);
      if (Math.abs(width - frame.w) < 2 && Math.abs(height - frame.h) < 2) {
        Object.assign(table, object.tableSpec, {
          x: frame.x + (frame.w - width) / 2, y: frame.y + (frame.h - height) / 2, w: width, h: height,
        });
      }
    }
  }
  const tables = [...tagged.values()].filter(table => table.rows);
  const excluded = new Set(tables.flatMap(table => table.indices));
  const horizontals = [];
  const verticals = [];
  for (const object of page.objects) {
    if (object.kind !== 2 || object.blockId || excluded.has(object.index)) continue;
    const geometry = object.stroke && object.lines?.length ? object.lines.map(line => rect(line, page)) : [rect(object, page)];
    for (const line of geometry) {
      if (line.h <= 1.6 && line.w >= 54) horizontals.push(line);
      if (line.w <= 1.6 && line.h >= 9) verticals.push(line);
    }
  }
  horizontals.sort((a, b) => a.y - b.y);
  for (let i = 0; i < horizontals.length; i++) {
    const first = horizontals[i];
    const same = horizontals.slice(i).filter(line => Math.abs(line.x - first.x) < 2 && Math.abs(line.w - first.w) < 3);
    const rows = [first.y];
    for (const line of same.slice(1)) {
      const gap = line.y - rows.at(-1);
      if (gap > 125) break;
      if (gap >= 8) rows.push(line.y);
    }
    if (rows.length < 3) continue;
    const box = { x: first.x, y: first.y, w: first.w, h: rows.at(-1) - first.y };
    if (tables.some(table => inside(box, table) || inside(table, box))) continue;
    const columns = cluster(verticals.filter(line => line.x > box.x + 7 && line.x < box.x + box.w - 7
      && line.y < box.y + box.h - 9 && line.y + line.h > box.y + 9).map(line => line.x), 2)
      .map(item => item.value);
    if (!columns.length && box.h / (rows.length - 1) > 67) continue;
    const result = tableFromRegion(page, box, rows, columns.length ? [box.x, ...columns, box.x + box.w] : undefined);
    if (!result || !columns.length && result.rows.filter(row => row.filter(Boolean).length >= 2).length < 2) continue;
    tables.push(result);
  }
  return tables;
}
