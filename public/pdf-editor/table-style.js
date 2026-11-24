export const borderPatterns = [
  ['solid', 'Сплошная'], ['dash', 'Штриховая'], ['dot', 'Точечная'],
  ['double', 'Двойная'], ['none', 'Без линии'],
];

const defaultOuter = { color: '#7a859f', width: .75, pattern: 'solid' };
const defaultInner = { ...defaultOuter, width: .6 };
const validColor = value => typeof value === 'string' && /^#[a-f\d]{6}$/i.test(value);
export const rgb = hex => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));

function cleanBorder(value, defaults) {
  if (!value || typeof value !== 'object') return { ...defaults };
  return {
    color: validColor(value.color) ? value.color : defaults.color,
    width: Number.isFinite(value.width) ? Math.min(8, Math.max(.25, value.width)) : defaults.width,
    pattern: borderPatterns.some(([pattern]) => pattern === value.pattern) ? value.pattern : defaults.pattern,
  };
}

export function tableStyle(data, rows, columns) {
  const outer = cleanBorder(data?.outer, defaultOuter);
  const inner = cleanBorder(data?.inner, defaultInner);
  let serial = 0;
  const cells = Array.from({ length: rows }, (_, row) => Array.from({ length: columns }, (_, column) => {
    const source = data?.cells?.[row]?.[column];
    const cell = {};
    if (validColor(source?.fill)) cell.fill = source.fill;
    if (source?.border) {
      const order = Number.isSafeInteger(source.order) && source.order >= 0 ? Math.min(source.order, 1000000) : 0;
      cell.border = cleanBorder(source.border, outer);
      cell.order = order;
      serial = Math.max(serial, order);
    }
    return cell;
  }));
  return { outer, inner, cells, serial };
}

export function edgeStyle(style, axis, row, col) {
  const rows = style.cells.length, columns = style.cells[0].length;
  const horizontal = axis === 'h';
  const outer = horizontal ? row === 0 || row === rows : col === 0 || col === columns;
  const a = horizontal ? style.cells[row - 1]?.[col] : style.cells[row][col - 1];
  const b = horizontal ? style.cells[row]?.[col] : style.cells[row][col];
  if (a?.border && (!b?.border || a.order > b.order)) return a.border;
  return b?.border ?? (outer ? style.outer : style.inner);
}

export function borderCSS(border, scale) {
  const types = { solid: 'solid', none: 'none', dash: 'dashed', dot: 'dotted', double: 'double' };
  const thickness = Math.max(border.pattern === 'double' ? 3 : .5, border.width * scale);
  return border.pattern === 'none' ? 'none' : `${thickness}px ${types[border.pattern]} ${border.color}`;
}

export function sameBorder(a, b) {
  return a.color === b.color && a.width === b.width && a.pattern === b.pattern;
}
