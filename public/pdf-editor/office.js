import { unzipSync, zipSync, strToU8, strFromU8 } from './vendor/fflate.js';

const xmlHeader = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const wns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const sns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const rns = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const pns = 'http://schemas.openxmlformats.org/package/2006/relationships';
const cns = 'http://schemas.openxmlformats.org/package/2006/content-types';
const imageNS = 'http://schemas.openxmlformats.org/drawingml/2006';
const parser = () => new DOMParser();
const legalXml = /[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu;
const escape = text => String(text ?? '').replace(legalXml, '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
const children = (node, name) => Array.from(node?.children ?? []).filter(child => !name || child.localName === name);
const child = (node, name) => children(node, name)[0];
const descendants = (node, name) => Array.from(node?.getElementsByTagNameNS('*', name) ?? []);
const attr = (node, name) => Array.from(node?.attributes ?? []).find(value => value.localName === name)?.value;
const number = (value, fallback) => value !== undefined && Number.isFinite(Number(value)) ? Number(value) : fallback;
const relations = entries => xmlHeader + `<Relationships xmlns="${pns}">` + entries.map(
  ([id, category, target]) => `<Relationship Id="${escape(id)}" Type="${rns}/${category}" Target="${escape(target)}"/>`).join('') + '</Relationships>';
const types = (defaults, overrides) => xmlHeader + `<Types xmlns="${cns}">` + defaults.map(
  ([ext, mime]) => `<Default Extension="${ext}" ContentType="${mime}"/>`).join('') + overrides.map(
  ([path, mime]) => `<Override PartName="/${path}" ContentType="${mime}"/>`).join('') + '</Types>';
const baseTypes = [['rels', 'application/vnd.openxmlformats-package.relationships+xml'], ['xml', 'application/xml']];
const openXml = 'application/vnd.openxmlformats-officedocument.';
const archive = files => zipSync(Object.fromEntries(Object.entries(files).map(([name, data]) =>
  [name, typeof data === 'string' ? strToU8(data) : data])), { level: 4 });

function openPackage(bytes, prefix) {
  let total = 0, entries = 0;
  try {
    return unzipSync(bytes, { filter(entry) {
      if (!entry.name.startsWith(prefix) || entry.name.includes('..')
        || !/\.(?:xml|rels|png|jpe?g)$/i.test(entry.name)) return false;
      total += entry.originalSize;
      if (++entries > 1500 || total > 80 * 1024 * 1024 || entry.originalSize > 20 * 1024 * 1024) {
        throw new Error('В файле слишком много вложенных данных.');
      }
      return true;
    } });
  } catch (error) {
    throw new Error(error.message === 'В файле слишком много вложенных данных.'
      ? error.message : 'Не удалось прочитать файл Office. Проверьте формат DOCX или XLSX.');
  }
}

function readXml(files, path, required = false) {
  const part = files[path];
  if (!part) {
    if (required) throw new Error('В файле Office отсутствует основное содержимое.');
    return null;
  }
  const text = strFromU8(part);
  if (/<!DOCTYPE/i.test(text)) throw new Error('Этот файл Office содержит неподдерживаемые определения XML.');
  const document = parser().parseFromString(text, 'application/xml');
  if (document.getElementsByTagName('parsererror').length) throw new Error('У файла Office повреждена разметка.');
  return document.documentElement;
}

function relationshipMap(files, folder, name) {
  const root = readXml(files, folder + '/_rels/' + name + '.rels');
  const map = new Map();
  for (const link of children(root, 'Relationship')) {
    if (attr(link, 'TargetMode') === 'External') continue;
    const target = attr(link, 'Target');
    if (!target || /\\|:/.test(target)) continue;
    const path = target.startsWith('/') ? [] : folder.split('/');
    for (const part of target.split('/').filter(Boolean)) {
      if (part === '..') path.pop();
      else if (part !== '.') path.push(part);
    }
    map.set(attr(link, 'Id'), path.join('/'));
  }
  return map;
}

export function sniffImage(bytes) {
  if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return 'png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpeg';
  return null;
}

function wordText(node) {
  return children(node).map(element => {
    if (element.localName === 't') return element.textContent;
    if (element.localName === 'tab') return '    ';
    if (element.localName === 'br' && attr(element, 'type') !== 'page') return '\n';
    if (element.localName === 'noBreakHyphen') return '‑';
    if (['r', 'hyperlink', 'sdt', 'sdtContent', 'smartTag', 'ins'].includes(element.localName)) return wordText(element);
    return '';
  }).join('');
}

function wordStyle(node) {
  const p = child(node, 'pPr'), r = child(node, 'rPr');
  const font = child(r, 'rFonts');
  const color = attr(child(r, 'color'), 'val');
  return {
    align: attr(child(p, 'jc'), 'val') ?? undefined,
    size: number(attr(child(r, 'sz'), 'val'), 0) / 2 || undefined,
    bold: child(r, 'b') ? !['0', 'false', 'off'].includes(attr(child(r, 'b'), 'val')) : undefined,
    font: (attr(font, 'ascii') ?? attr(font, 'hAnsi')) || undefined,
    color: /^[0-9A-Fa-f]{6}$/.test(color ?? '') ? color : undefined,
  };
}

function withStyle(base, update) {
  return Object.assign({}, base, Object.fromEntries(Object.entries(update).filter(([, value]) => value !== undefined)));
}

export function readDocx(bytes) {
  const files = openPackage(bytes, 'word/');
  const doc = readXml(files, 'word/document.xml', true);
  const body = child(doc, 'body');
  const styleRoot = readXml(files, 'word/styles.xml');
  const styles = new Map(children(styleRoot, 'style').map(style => [attr(style, 'styleId'), style]));
  const rels = relationshipMap(files, 'word', 'document.xml');
  const section = descendants(body, 'sectPr').at(-1);
  const size = child(section, 'pgSz');
  const margin = child(section, 'pgMar');
  const page = {
    width: number(attr(size, 'w'), 11906) / 20, height: number(attr(size, 'h'), 16838) / 20,
    marginX: Math.max(26, number(attr(margin, 'left'), 960) / 20),
    marginY: Math.max(27, number(attr(margin, 'top'), 960) / 20),
  };
  function resolveStyle(id, depth = 0) {
    const node = styles.get(id);
    return !node || depth > 12 ? {} : withStyle(resolveStyle(attr(child(node, 'basedOn'), 'val'), depth + 1), wordStyle(node));
  }
  const defaults = withStyle({ size: 11, bold: false }, wordStyle(child(child(styleRoot, 'docDefaults'), 'rPrDefault')));
  const blocks = [];
  for (const block of children(body)) {
    if (block.localName === 'tbl') {
      const widths = children(child(block, 'tblGrid'), 'gridCol').map(column => number(attr(column, 'w'), 0));
      const rows = children(block, 'tr').map(row => children(row, 'tc').flatMap(cell => {
        const value = children(cell, 'p').map(wordText).join('\n');
        return [value, ...Array(Math.max(0, Math.min(20, number(attr(child(child(cell, 'tcPr'), 'gridSpan'), 'val'), 1)) - 1)).fill('')];
      }));
      if (rows.length) blocks.push({ type: 'table', rows, widths, header: !!child(child(children(block, 'tr')[0], 'trPr'), 'tblHeader') });
      continue;
    }
    if (block.localName !== 'p') continue;
    const pPr = child(block, 'pPr');
    const styleId = attr(child(pPr, 'pStyle'), 'val');
    const title = /heading|title|заголовок/i.test(styleId ?? '');
    const styled = withStyle(withStyle(defaults, title ? { size: 18, bold: true } : {}), resolveStyle(styleId));
    let style = withStyle(styled, wordStyle(block));
    const first = descendants(block, 'r').find(run => wordText(run).trim());
    if (first) style = withStyle(style, wordStyle(first));
    if (child(pPr, 'pageBreakBefore')) blocks.push({ type: 'break' });
    let text = '';
    function flush(includeEmpty = false) {
      if (text.trim() || includeEmpty) blocks.push({ type: 'text', text, ...style });
      text = '';
    }
    const parts = descendants(block, 'r').flatMap(run => children(run));
    for (const part of parts) {
      if (part.localName === 't') text += part.textContent;
      if (part.localName === 'tab') text += '    ';
      if (part.localName === 'br') {
        if (attr(part, 'type') === 'page') {
          flush();
          blocks.push({ type: 'break' });
        } else text += '\n';
      }
      if (part.localName !== 'drawing') continue;
      const link = descendants(part, 'blip')[0];
      const data = files[rels.get(attr(link, 'embed'))];
      const format = data && sniffImage(data);
      if (!format) continue;
      flush();
      const bounds = descendants(part, 'extent')[0];
      blocks.push({
        type: 'image', bytes: data, format, width: number(attr(bounds, 'cx'), 3048000) / 12700,
        height: number(attr(bounds, 'cy'), 1524000) / 12700,
      });
    }
    flush(!parts.length);
  }
  if (!blocks.some(block => block.type !== 'break' && (block.type !== 'text' || block.text.trim()))) {
    throw new Error('В DOCX нет текста, таблиц или изображений PNG/JPEG.');
  }
  return { page, blocks };
}

function columnIndex(reference = '') {
  const letters = reference.match(/^[A-Z]+/i)?.[0].toUpperCase() ?? '';
  return Array.from(letters).reduce((column, letter) => column * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function columnName(col) {
  let name = '';
  for (let value = col + 1; value; value = Math.floor((value - 1) / 26)) {
    name = String.fromCharCode(65 + (value - 1) % 26) + name;
  }
  return name;
}

export function readXlsx(bytes) {
  const files = openPackage(bytes, 'xl/');
  const workbook = readXml(files, 'xl/workbook.xml', true);
  const rels = relationshipMap(files, 'xl', 'workbook.xml');
  const values = children(readXml(files, 'xl/sharedStrings.xml'), 'si')
    .map(item => descendants(item, 't').map(node => node.textContent).join(''));
  const root = readXml(files, 'xl/styles.xml');
  const formats = new Map(children(child(root, 'numFmts'), 'numFmt')
    .map(item => [number(attr(item, 'numFmtId'), 0), attr(item, 'formatCode')]));
  const styleIds = children(child(root, 'cellXfs'), 'xf').map(item => number(attr(item, 'numFmtId'), 0));
  const epoch = ['1', 'true'].includes(attr(child(workbook, 'workbookPr'), 'date1904'))
    ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  function display(cell) {
    const type = attr(cell, 't');
    const value = child(cell, 'v')?.textContent ?? '';
    if (type === 's') return values[Number(value)] ?? '';
    if (type === 'inlineStr') return descendants(child(cell, 'is'), 't').map(node => node.textContent).join('');
    if (type === 'b') return value === '1' ? 'ИСТИНА' : 'ЛОЖЬ';
    if (!value) return child(cell, 'f') ? '=' + child(cell, 'f').textContent : '';
    if ((type === 'n' || !type) && Number.isFinite(Number(value))) {
      const code = styleIds[number(attr(cell, 's'), 0)] ?? 0;
      const custom = formats.get(code)?.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '') ?? '';
      if ([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47].includes(code) || /[dy]/i.test(custom)) {
        const time = new Date(epoch + 86400000 * Number(value));
        if (Number.isFinite(time.getTime())) return time.toLocaleDateString('ru-RU', { timeZone: 'UTC' });
      }
      if (code === 9 || code === 10 || custom.includes('%')) {
        return new Intl.NumberFormat('ru', { maximumFractionDigits: 2 }).format(Number(value) * 100) + '%';
      }
    }
    return value;
  }
  const sheets = [];
  let cells = 0;
  for (const sheet of children(child(workbook, 'sheets'), 'sheet')) {
    const root = readXml(files, rels.get(attr(sheet, 'id')));
    if (!root) continue;
    const rows = [];
    let width = 0;
    for (const row of children(child(root, 'sheetData'), 'row')) {
      const values = [];
      for (const cell of children(row, 'c')) {
        if (++cells > 100000) throw new Error('Таблица слишком велика для одного преобразования.');
        const position = Math.max(0, attr(cell, 'r') ? columnIndex(attr(cell, 'r')) : values.length);
        if (position >= 100) throw new Error('Для преобразования выберите лист, в котором используются первые 100 столбцов.');
        values[position] = display(cell);
      }
      if (values.some(value => value !== '')) {
        width = Math.max(width, values.length);
        rows.push(values);
      }
    }
    if (rows.length) sheets.push({
      name: attr(sheet, 'name') || `Лист ${sheets.length + 1}`,
      rows: rows.map(row => Array.from({ length: width }, (_, index) => row[index] ?? '')),
    });
  }
  if (!sheets.length) throw new Error('В XLSX нет заполненных ячеек.');
  return sheets;
}

function wordRun(text, { size, bold, italic, underline, strike, font, color } = {}) {
  const points = Number.isFinite(size) ? Math.min(150, Math.max(6, Math.round(size * 2))) : 22;
  return `<w:r><w:rPr><w:sz w:val="${points}"/>${bold ? '<w:b/>' : ''}${italic ? '<w:i/>' : ''}${underline ? '<w:u w:val="single"/>' : ''}${strike ? '<w:strike/>' : ''}${font ? `<w:rFonts w:ascii="${escape(font)}" w:hAnsi="${escape(font)}" w:cs="${escape(font)}"/>` : ''}${color ? `<w:color w:val="${escape(color)}"/>` : ''}</w:rPr>` +
    String(text).split('\n').map(line => `<w:t xml:space="preserve">${escape(line)}</w:t>`).join('<w:br/>') + '</w:r>';
}

function wordParagraph(block) {
  const { text, align, left } = block;
  return `<w:p><w:pPr><w:spacing w:after="105"/>${['left', 'center', 'right', 'both'].includes(align) ? `<w:jc w:val="${align}"/>` : ''}${left > 4 ? `<w:ind w:left="${Math.round(left * 20)}"/>` : ''}</w:pPr>${wordRun(text, block)}</w:p>`;
}

function wordTable(block, sectionWidth) {
  const length = Math.max(...block.rows.map(row => row.length));
  const weights = block.widths?.length === length ? block.widths : Array(length).fill(1);
  const total = weights.reduce((sum, item) => sum + item, 0) || length;
  const widths = weights.map(weight => Math.max(100, Math.round(sectionWidth * weight / total)));
  const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(name =>
    `<w:${name} w:val="single" w:sz="5" w:color="C5CCD8"/>`).join('');
  return '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>' + borders +
    '</w:tblBorders></w:tblPr><w:tblGrid>' + widths.map(width => `<w:gridCol w:w="${width}"/>`).join('') +
    '</w:tblGrid>' + block.rows.map((row, rowIndex) => `<w:tr>${block.header && rowIndex === 0 ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}` +
      widths.map((width, column) => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>${wordParagraph({ text: row[column] ?? '', size: block.size, font: block.font, bold: block.header && !rowIndex })}</w:tc>`).join('') + '</w:tr>').join('') +
    '</w:tbl>';
}

function drawing(id, width, height) {
  const cx = Math.round(width * 12700), cy = Math.round(height * 12700);
  return `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Изображение ${id}"/><a:graphic><a:graphicData uri="${imageNS}/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="Image ${id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

export function writeDocx(pages) {
  const files = {}, media = [];
  const content = pages.map(blocks => blocks.map(block => {
    if (block.type === 'text') return wordParagraph(block);
    if (block.type === 'table') return wordTable(block, 9900);
    if (block.type !== 'image') return '';
    const id = media.length + 1;
    const filename = `media/image${id}.png`;
    media.push([`rId${id}`, 'image', filename]);
    files['word/' + filename] = block.bytes;
    const scale = Math.min(1, 494 / block.width, 670 / block.height);
    return drawing(id, block.width * scale, block.height * scale);
  }).join('')).join('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
  files['[Content_Types].xml'] = types([...baseTypes, ['png', 'image/png']],
    [['word/document.xml', openXml + 'wordprocessingml.document.main+xml']]);
  files['_rels/.rels'] = relations([['rId1', 'officeDocument', 'word/document.xml']]);
  if (media.length) files['word/_rels/document.xml.rels'] = relations(media);
  files['word/document.xml'] = xmlHeader + `<w:document xmlns:w="${wns}" xmlns:r="${rns}" xmlns:wp="${imageNS}/wordprocessingDrawing" xmlns:a="${imageNS}/main" xmlns:pic="${imageNS}/picture"><w:body>` +
    content + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="960" w:right="960" w:bottom="960" w:left="960"/></w:sectPr></w:body></w:document>';
  return archive(files);
}

function numericCell(value) {
  const candidate = value.trim().replace(/(?<=\d)[ \u00a0\u202f](?=\d{3}(?:[ \u00a0\u202f]|[,\.]|$))/g, '').replace(',', '.');
  return /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(candidate) && candidate.replace(/[-.]/g, '').length <= 15 ? Number(candidate) : null;
}

export function writeXlsx(sheets) {
  const overrides = [['xl/workbook.xml', openXml + 'spreadsheetml.sheet.main+xml']];
  const files = {}, links = [], names = [];
  sheets.forEach(({ name, rows }, index) => {
    const id = index + 1;
    names.push(`<sheet name="${escape(name.slice(0, 31))}" sheetId="${id}" r:id="rId${id}"/>`);
    links.push([`rId${id}`, 'worksheet', `worksheets/sheet${id}.xml`]);
    overrides.push([`xl/worksheets/sheet${id}.xml`, openXml + 'spreadsheetml.worksheet+xml']);
    const widths = [];
    const body = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">` + row.map((field, col) => {
      const value = String(field ?? '');
      widths[col] = Math.min(50, Math.max(widths[col] ?? 10, value.length + 2));
      if (!value) return '';
      const ref = columnName(col) + (rowIndex + 1);
      const numeric = numericCell(value);
      return numeric !== null ? `<c r="${ref}"><v>${numeric}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escape(value.slice(0, 32767))}</t></is></c>`;
    }).join('') + '</row>').join('');
    const columns = widths.map((width, i) => `<col min="${i+1}" max="${i+1}" width="${width}" customWidth="1"/>`).join('');
    files[`xl/worksheets/sheet${id}.xml`] = xmlHeader + `<worksheet xmlns="${sns}"><cols>${columns}</cols><sheetData>${body}</sheetData></worksheet>`;
  });
  files['[Content_Types].xml'] = types(baseTypes, overrides);
  files['_rels/.rels'] = relations([['rId1', 'officeDocument', 'xl/workbook.xml']]);
  files['xl/_rels/workbook.xml.rels'] = relations(links);
  files['xl/workbook.xml'] = xmlHeader + `<workbook xmlns="${sns}" xmlns:r="${rns}"><sheets>${names.join('')}</sheets></workbook>`;
  return archive(files);
}
