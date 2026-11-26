import { officeAliases, officeFace } from './office-fonts.js';
import { init } from './vendor/index.browser.js';
import { coreFonts, fonts as fontFamilies } from './layout.js';
import { edgeStyle, rgb, sameBorder, tableStyle } from './table-style.js';
import { readFontMetrics } from './font-metrics.js';

export const kinds = { text: 1, path: 2, image: 3, shading: 4, group: 5 };
const pointGrid = 1000000;
const trueType = 2;

const weights = ['Regular', 'Bold', 'Italic', 'BoldItalic'];

async function asset(path) {
  const response = await fetch(new URL(path, import.meta.url));
  if (!response.ok) throw new Error('Не удалось загрузить компоненты редактора.');
  return response.arrayBuffer();
}

function fontAssets(family, cached = []) {
  const source = officeAliases[family] ?? family;
  const offset = fontFamilies.indexOf(source) * weights.length;
  return Promise.all(weights.map((weight, index) => officeFace(family, weight)
    ?? cached[offset + index] ?? asset(`fonts/${source.replaceAll(' ', '')}-${weight}.ttf`)));
}

function check(value, message) {
  if (!value) throw new Error(message);
  return value;
}

export class PdfEngine {
  static async create() {
    const [wasmBinary, ...fonts] = await Promise.all([asset('vendor/pdfium.wasm'), ...coreFonts.map(fontAssets)]);
    return PdfEngine.initialize(wasmBinary, fonts.flat());
  }

  static async initialize(wasmBinary, fonts) {
    const api = await init({ wasmBinary });
    api.PDFiumExt_Init();
    return new PdfEngine(api, fonts.map(font => new Uint8Array(font)));
  }

  constructor(api, fonts, fontLoads = new Map()) {
    this.api = api;
    this.fonts = fonts;
    this.fontLoads = fontLoads;
    this.fontHandles = new Map();
    this.metrics = new Map();
    this.document = 0;
    this.source = 0;
  }

  memory(size, run) {
    const pointer = check(this.api.pdfium.wasmExports.malloc(size), 'Недостаточно памяти для PDF.');
    try {
      return run(pointer);
    } finally {
      this.api.pdfium.wasmExports.free(pointer);
    }
  }

  bytes(bytes, run) {
    return this.memory(bytes.length, pointer => {
      this.api.pdfium.HEAPU8.set(bytes, pointer);
      return run(pointer);
    });
  }

  clear() {
    const a = this.api;
    for (const font of this.fontHandles.values()) a.FPDFFont_Close(font);
    this.fontHandles.clear();
    if (this.document) a.FPDF_CloseDocument(this.document);
    if (this.source) a.pdfium.wasmExports.free(this.source);
    this.document = 0;
    this.source = 0;
  }

  open(bytes, password = null) {
    if (!bytes.length) throw new Error('Файл пуст.');
    const a = this.api;
    const source = check(a.pdfium.wasmExports.malloc(bytes.length), 'Недостаточно памяти для PDF.');
    a.pdfium.HEAPU8.set(bytes, source);
    const document = a.FPDF_LoadMemDocument(source, bytes.length, password);
    if (!document || !a.FPDF_GetPageCount(document)) {
      const error = a.FPDF_GetLastError();
      if (document) a.FPDF_CloseDocument(document);
      a.pdfium.wasmExports.free(source);
      throw new Error(error === 4
        ? 'Этот PDF защищён паролем. Откройте копию без пароля.'
        : 'Не удалось открыть PDF. Проверьте, что файл читается и содержит страницы.');
    }
    this.clear();
    this.document = document;
    this.source = source;
  }

  get count() {
    return this.document ? this.api.FPDF_GetPageCount(this.document) : 0;
  }

  page(index, run) {
    const page = check(this.api.FPDF_LoadPage(this.document, index), 'Не удалось открыть страницу.');
    try {
      return run(page);
    } finally {
      this.api.FPDF_ClosePage(page);
    }
  }

  dimensions(page) {
    return {
      width: this.api.FPDF_GetPageWidthF(page),
      height: this.api.FPDF_GetPageHeightF(page),
      rotation: this.api.FPDFPage_GetRotation(page),
    };
  }

  render(index, maxWidth, maxHeight, withObjects = false, preview = null) {
    return this.page(index, page => {
      const a = this.api;
      const dimensions = this.dimensions(page);
      const scale = Math.min(maxWidth / dimensions.width, maxHeight / dimensions.height);
      const width = Math.max(1, Math.round(dimensions.width * scale));
      const height = Math.max(1, Math.round(dimensions.height * scale));
      const bitmap = check(a.FPDFBitmap_CreateEx(width, height, 4, 0, 0), 'Не удалось создать изображение страницы.');
      try {
        const objects = withObjects ? this.objects(page) : [];
        const restore = this.preview(page, dimensions, objects, preview);
        try {
          a.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xffffffff);
          a.FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, 0, 0x01 | 0x10);
        } finally {
          restore?.();
        }
        const buffer = a.FPDFBitmap_GetBuffer(bitmap);
        const pixels = new Uint8ClampedArray(a.pdfium.HEAPU8.slice(buffer, buffer + width * height * 4));
        return {
          width, height, pixels, rotation: dimensions.rotation,
          pageWidth: dimensions.width, pageHeight: dimensions.height,
          objects, notes: withObjects ? this.notes(page) : [],
        };
      } finally {
        a.FPDFBitmap_Destroy(bitmap);
      }
    });
  }

  screenPoint(page, x, y) {
    const a = this.api;
    return this.memory(8, ptr => {
      check(a.FPDF_PageToDevice(page, 0, 0, pointGrid, pointGrid, 0, x, y, ptr, ptr + 4), 'Не удалось определить положение объекта.');
      return [a.pdfium.getValue(ptr, 'i32') / pointGrid, a.pdfium.getValue(ptr + 4, 'i32') / pointGrid];
    });
  }

  documentPoint(page, x, y) {
    const a = this.api;
    return this.memory(16, ptr => {
      check(a.FPDF_DeviceToPage(page, 0, 0, pointGrid, pointGrid, 0, Math.round(x * pointGrid), Math.round(y * pointGrid), ptr, ptr + 8), 'Не удалось определить координаты.');
      return [a.pdfium.getValue(ptr, 'double'), a.pdfium.getValue(ptr + 8, 'double')];
    });
  }

  bounds(object, page) {
    const a = this.api;
    return this.memory(16, ptr => {
      if (!a.FPDFPageObj_GetBounds(object, ptr, ptr + 4, ptr + 8, ptr + 12)) return null;
      const raw = [0, 4, 8, 12].map(offset => a.pdfium.getValue(ptr + offset, 'float'));
      const [x1, y1] = this.screenPoint(page, raw[0], raw[1]);
      const [x2, y2] = this.screenPoint(page, raw[2], raw[3]);
      return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1), raw };
    });
  }

  getMatrix(object) {
    const a = this.api;
    return this.memory(24, ptr => {
      check(a.FPDFPageObj_GetMatrix(object, ptr), 'Не удалось прочитать положение объекта.');
      return [0, 4, 8, 12, 16, 20].map(offset => a.pdfium.getValue(ptr + offset, 'float'));
    });
  }

  setMatrix(object, matrix) {
    const a = this.api;
    this.memory(24, ptr => {
      matrix.forEach((value, index) => a.pdfium.setValue(ptr + index * 4, value, 'float'));
      check(a.FPDFPageObj_SetMatrix(object, ptr), 'Не удалось установить положение объекта.');
    });
  }

  getColor(object, stroke = false) {
    const a = this.api;
    return this.memory(16, ptr => {
      const get = stroke ? a.FPDFPageObj_GetStrokeColor : a.FPDFPageObj_GetFillColor;
      if (!get(object, ptr, ptr + 4, ptr + 8, ptr + 12)) return [32, 37, 56, 255];
      return [0, 4, 8, 12].map(offset => a.pdfium.getValue(ptr + offset, 'i32'));
    });
  }

  textProperties(object, textPage, page) {
    const a = this.api;
    const length = a.FPDFTextObj_GetText(object, textPage, 0, 0);
    const text = length > 2 && length < 500000 ? this.memory(length, ptr => {
      a.FPDFTextObj_GetText(object, textPage, ptr, length);
      return a.pdfium.UTF16ToString(ptr, length);
    }) : '';
    const size = this.memory(4, ptr => a.FPDFTextObj_GetFontSize(object, ptr) ? a.pdfium.getValue(ptr, 'float') : 14);
    const font = a.FPDFTextObj_GetFont(object);
    const fontName = font ? this.memory(256, ptr => {
      const length = a.FPDFFont_GetBaseFontName(font, ptr, 256);
      return length && length <= 256 ? a.pdfium.UTF8ToString(ptr) : '';
    }) : '';
    const bold = font && (a.FPDFFont_GetWeight(font) >= 600 || /bold|black|heavy/i.test(fontName));
    const matrix = this.getMatrix(object);
    const [x, baseline] = this.screenPoint(page, matrix[4], matrix[5]);
    const [right, down] = this.screenPoint(page, matrix[4] + matrix[0] * size, matrix[5] + matrix[1] * size);
    const { width, height } = this.dimensions(page);
    const [verticalX, verticalY] = this.screenPoint(page, matrix[4] + matrix[2] * size, matrix[5] + matrix[3] * size);
    return {
      verticalSize: Math.hypot((verticalX - x) * width, (verticalY - baseline) * height),
      text, size, bold: Boolean(bold), italic: Boolean(font && (/italic|oblique/i.test(fontName) || this.memory(4, ptr =>
        a.FPDFFont_GetItalicAngle(font, ptr) && a.pdfium.getValue(ptr, 'i32') !== 0))), fontName, color: this.getColor(object), baseline, origin: x,
      visualSize: Math.hypot((right - x) * width, (down - baseline) * height),
      horizontal: (right - x) * width > .5 && Math.abs(down - baseline) * height < .5,
    };
  }

  objects(page) {
    const a = this.api;
    const textPage = a.FPDFText_LoadPage(page);
    const objects = [];
    try {
      const count = a.FPDFPage_CountObjects(page);
      for (let index = 0; index < count; index++) {
        const object = a.FPDFPage_GetObject(page, index);
        const kind = a.FPDFPageObj_GetType(object);
        if (kind < 1 || kind > 5) continue;
        const box = this.bounds(object, page);
        if (!box || box.x > 1 || box.y > 1 || box.x + box.w < 0 || box.y + box.h < 0) continue;
        const data = { index, kind, ...box };
        if (kind === kinds.text && textPage) {
          Object.assign(data, this.textProperties(object, textPage, page));
        }
        if (kind === kinds.path) {
          const stroke = this.memory(8, ptr => {
            a.pdfium.setValue(ptr, 0, 'i32');
            a.pdfium.setValue(ptr + 4, 0, 'i32');
            a.FPDFPath_GetDrawMode(object, ptr, ptr + 4);
            return !a.pdfium.getValue(ptr, 'i32') && !!a.pdfium.getValue(ptr + 4, 'i32');
          });
          Object.assign(data, { stroke, color: this.getColor(object, stroke), lines: this.pathLines(page, object) });
        }
        if (a.FPDFPageObj_CountMarks(object) > 0) {
          const mark = this.layoutMark(object);
          if (mark) Object.assign(data, mark);
        }
        objects.push(data);
      }
      return objects;
    } finally {
      if (textPage) a.FPDFText_ClosePage(textPage);
    }
  }

  invalidateFont(family) {
    const offset = fontFamilies.indexOf(family) * weights.length;
    if (offset < 0) return;
    for (let i = 0; i < 4; i++) {
      const index = offset + i;
      if (this.fontHandles.has(index)) this.api.FPDFFont_Close(this.fontHandles.get(index));
      this.fontHandles.delete(index);
      this.metrics.delete(index);
      this.fonts[index] = undefined;
    }
  }

  async ensureFont(family) {
    const offset = fontFamilies.indexOf(family) * weights.length;
    if (offset < 0) throw new Error('Неизвестный шрифт.');
    if (weights.every((_, index) => this.fonts[offset + index])) return;
    if (!this.fontLoads.has(family)) {
      const promise = fontAssets(family, this.fonts).then(faces => {
        faces.forEach((face, index) => { this.fonts[offset + index] = new Uint8Array(face); });
      }).finally(() => this.fontLoads.delete(family));
      this.fontLoads.set(family, promise);
    }
    await this.fontLoads.get(family);
  }

  faceIndex(family, bold, italic) {
    return Math.max(0, fontFamilies.indexOf(family)) * 4 + Number(!!bold) + 2 * Number(!!italic);
  }

  font(bold, family = fontFamilies[0], italic = false) {
    const a = this.api;
    const index = this.faceIndex(family, bold, italic);
    if (!this.fontHandles.has(index)) {
      const bytes = check(this.fonts[index], 'Дождитесь загрузки выбранного шрифта.');
      const font = this.bytes(bytes, ptr => a.FPDFText_LoadFont(this.document, ptr, bytes.length, trueType, true));
      this.fontHandles.set(index, check(font, 'Не удалось загрузить шрифт.'));
    }
    return this.fontHandles.get(index);
  }

  createText({ text, color, size, bold, font, italic = false }, matrix) {
    const a = this.api;
    const value = text.replace(/\0/g, '');
    if (!value.trim()) throw new Error('Введите текст.');
    if (/[^\p{L}\p{N}\p{P}\p{M}\p{Sc}\p{Sm}\p{Zs}\u20A0-\u20BF+<=>×÷±°№©®™•\n]/u.test(value)) {
      throw new Error('Для новых надписей доступны кириллица, латиница, греческий алфавит и основные знаки.');
    }
    const object = check(a.FPDFPageObj_CreateTextObj(this.document, this.font(bold, font, italic), size), 'Не удалось создать текстовый объект.');
    try {
      const length = (value.length + 1) * 2;
      this.memory(length, ptr => {
        a.pdfium.stringToUTF16(value, ptr, length);
        check(a.FPDFText_SetText(object, ptr), 'Не удалось записать текст.');
      });
      check(a.FPDFPageObj_SetFillColor(object, ...color), 'Не удалось изменить цвет текста.');
      this.setMatrix(object, matrix);
      return object;
    } catch (error) {
      a.FPDFPageObj_Destroy(object);
      throw error;
    }
  }

  fontMetrics(family, bold, italic) {
    const face = this.faceIndex(family, bold, italic);
    if (!this.metrics.has(face)) {
      const bytes = check(this.fonts[face], 'Дождитесь загрузки выбранного шрифта.');
      this.metrics.set(face, readFontMetrics(bytes));
    }
    return this.metrics.get(face);
  }

  textParts(line, matrix) {
    const family = line.font ?? fontFamilies[0];
    const value = line.text.trim();
    const main = this.fontMetrics(family, line.bold, line.italic);
    const fallbackFont = fontFamilies[0];
    if (family === fallbackFont || ![...value].some(char => !main.glyph(char))) {
      return [this.createText({ ...line, text: value }, matrix)];
    }
    const fallback = this.fontMetrics(fallbackFont, line.bold, line.italic);
    const chunks = [];
    for (const char of value) {
      const useFallback = !main.glyph(char) && !!fallback.glyph(char);
      if (chunks.at(-1)?.useFallback === useFallback) chunks.at(-1).text += char;
      else chunks.push({ useFallback, text: char });
    }
    let advance = 0;
    const objects = [];
    try {
      for (const { text, useFallback } of chunks) {
        const metrics = useFallback ? fallback : main;
        const location = [...matrix];
        location[4] += advance * matrix[0];
        location[5] += advance * matrix[1];
        if (text.trim()) objects.push(this.createText({ ...line, text, font: useFallback ? fallbackFont : family }, location));
        for (const char of text) advance += metrics.advance(char) * line.size;
      }
      return objects;
    } catch (error) {
      for (const object of objects) this.api.FPDFPageObj_Destroy(object);
      throw error;
    }
  }

  createImage(bytes, format, matrix) {
    const a = this.api;
    const image = check(a.FPDFPageObj_NewImageObj(this.document), 'Не удалось создать изображение.');
    try {
      const load = format === 'png' ? a.EPDFImageObj_SetPng : a.EPDFImageObj_SetJpeg;
      this.bytes(bytes, ptr => check(load(0, 0, image, ptr, bytes.length), 'Не удалось прочитать изображение.'));
      this.setMatrix(image, matrix);
      return image;
    } catch (error) {
      a.FPDFPageObj_Destroy(image);
      throw error;
    }
  }

  insert(page, object, index = this.api.FPDFPage_CountObjects(page)) {
    const a = this.api;
    if (a.FPDFPage_InsertObjectAtIndex(page, object, index)) return index;
    a.FPDFPageObj_Destroy(object);
    throw new Error('Не удалось вставить объект в страницу.');
  }

  remove(page, object) {
    const a = this.api;
    check(a.FPDFPage_RemoveObject(page, object), 'Не удалось удалить объект.');
    a.FPDFPageObj_Destroy(object);
  }

  transform(object, matrix) {
    const a = this.api;
    a.FPDFPageObj_Transform(object, ...matrix);
    // PDFium changes an image's placement matrix without moving its page-space clip.
    if (a.FPDFPageObj_GetType(object) === kinds.image) {
      a.FPDFPageObj_TransformClipPath(object, ...matrix);
    }
  }

  placeObject(page, object, original, { dx = 0, dy = 0, widthRatio = 1, heightRatio = 1 }) {
    if (!dx && !dy && widthRatio === 1 && heightRatio === 1) return null;
    check(object, 'Объект недоступен.');
    const sideways = this.api.FPDFPage_GetRotation(page) % 2;
    const [sx, sy] = sideways ? [heightRatio, widthRatio] : [widthRatio, heightRatio];
    const [x0, y0] = this.documentPoint(page, 0, 0);
    const [x1, y1] = this.documentPoint(page, dx, dy);
    const [anchorX, anchorY] = original ? this.documentPoint(page, original.x, original.y) : [0, 0];
    const x = (1 - sx) * anchorX + x1 - x0;
    const y = (1 - sy) * anchorY + y1 - y0;
    this.transform(object, [sx, 0, 0, sy, x, y]);
    return [1 / sx, 0, 0, 1 / sy, -x / sx, -y / sy];
  }

  move(page, object, dx, dy) {
    this.placeObject(page, object, null, { dx, dy });
  }

  edit(index, change) {
    return this.page(index, page => {
      const result = change(page);
      check(this.api.FPDFPage_GenerateContent(page), 'Не удалось сохранить изменения страницы.');
      return result;
    });
  }

  addShape(index, x, y, fill) {
    return this.edit(index, page => {
      const { width, height } = this.dimensions(page);
      const left = Math.min(Math.max(0, x), Math.max(0, 1 - 112 / width));
      const top = Math.min(Math.max(0, y), Math.max(0, 1 - 62 / height));
      const [x1, y1] = this.documentPoint(page, left, top);
      const [x2, y2] = this.documentPoint(page, left + 110 / width, top + 60 / height);
      const a = this.api;
      const shape = check(a.FPDFPageObj_CreateNewRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)), 'Не удалось создать фигуру.');
      a.FPDFPath_SetDrawMode(shape, 1, false);
      a.FPDFPageObj_SetFillColor(shape, ...fill);
      return this.insert(page, shape);
    });
  }

  addImage(index, x, y, bytes, format, ratio, maxWidth = 220) {
    return this.edit(index, page => {
      const { width, height } = this.dimensions(page);
      const w = Math.min(width * 0.43, maxWidth, height * 0.38 * ratio) / width;
      const h = w * width / (ratio * height);
      const left = Math.min(Math.max(0, x), 1 - w);
      const top = Math.min(Math.max(0, y), 1 - h);
      const [x0, y0] = this.documentPoint(page, left, top + h);
      const [x1, y1] = this.documentPoint(page, left + w, top + h);
      const [x2, y2] = this.documentPoint(page, left, top);
      const image = this.createImage(bytes, format, [x1 - x0, y1 - y0, x2 - x0, y2 - y0, x0, y0]);
      return this.insert(page, image);
    });
  }

  update(index, data, values) {
    return this.edit(index, page => {
      const a = this.api;
      const object = check(a.FPDFPage_GetObject(page, data.index), 'Объект отсутствует на странице.');
      if (values.color && data.color && values.color.slice(0, 3).some((v, i) => v !== data.color[i])) {
        const set = data.stroke ? a.FPDFPageObj_SetStrokeColor : a.FPDFPageObj_SetFillColor;
        check(set(object, ...values.color), 'Не удалось изменить цвет объекта.');
      }
      this.placeObject(page, object, data, values);
      return data.index;
    });
  }

  replaceImage(index, objectIndex, bytes, format) {
    return this.edit(index, page => {
      const object = this.api.FPDFPage_GetObject(page, objectIndex);
      const image = this.createImage(bytes, format, this.getMatrix(object));
      this.remove(page, object);
      return this.insert(page, image, objectIndex);
    });
  }

  removeObject(index, objectIndex) {
    this.edit(index, page => this.remove(page, this.api.FPDFPage_GetObject(page, objectIndex)));
  }

  addPage(index, width = 595.28, height = 841.89) {
    const a = this.api;
    const page = check(a.FPDFPage_New(this.document, index, width, height), 'Не удалось добавить страницу.');
    a.FPDF_ClosePage(page);
  }

  rotate(index) {
    this.page(index, page => {
      const a = this.api;
      a.FPDFPage_SetRotation(page, (a.FPDFPage_GetRotation(page) + 1) % 4);
    });
  }

  duplicate(index) {
    const a = this.api;
    this.memory(4, ptr => {
      a.pdfium.setValue(ptr, index, 'i32');
      check(a.FPDF_ImportPagesByIndex(this.document, this.document, ptr, 1, index + 1), 'Не удалось дублировать страницу.');
    });
  }

  movePage(from, to) {
    const a = this.api;
    this.memory(4, ptr => {
      a.pdfium.setValue(ptr, from, 'i32');
      check(a.FPDF_MovePages(this.document, ptr, 1, to), 'Не удалось изменить порядок страниц.');
    });
  }

  deletePage(index) {
    if (this.count < 2) throw new Error('В PDF должна остаться хотя бы одна страница.');
    this.api.FPDFPage_Delete(this.document, index);
  }

  preview(page, { height }, objects, preview) {
    if (!preview) return null;
    const changed = [];
    const hidden = new Set(preview.indices);
    const a = this.api;
    for (const item of objects) {
      const pointer = a.FPDFPage_GetObject(page, item.index);
      if (hidden.has(item.index)) {
        if (a.FPDFPageObj_SetIsActive(pointer, false)) changed.push([pointer, null]);
      } else {
        const motion = preview.motion?.index === item.index ? preview.motion
          : preview.delta && item.y * height >= preview.after - .45 ? { dx: 0, dy: preview.delta / height }
          : null;
        if (motion) {
          const inverse = this.placeObject(page, pointer, item, motion);
          if (inverse) changed.push([pointer, inverse]);
        }
      }
    }
    return () => {
      for (const [pointer, motion] of changed) {
        if (motion) this.transform(pointer, motion);
        else a.FPDFPageObj_SetIsActive(pointer, true);
      }
    };
  }

  pathLines(page, object) {
    const a = this.api;
    const count = a.FPDFPath_CountSegments(object);
    if (count < 2 || count > 96) return undefined;
    const matrix = this.getMatrix(object);
    const lines = [];
    let previous;
    let start;
    return this.memory(8, ptr => {
      function segment([x, y], [right, bottom]) {
        return { x: Math.min(x, right), y: Math.min(y, bottom), w: Math.abs(x - right), h: Math.abs(y - bottom) };
      }
      for (let i = 0; i < count; i++) {
        const handle = a.FPDFPath_GetPathSegment(object, i);
        const type = a.FPDFPathSegment_GetType(handle);
        if (type !== 0 && type !== 2) return undefined;
        if (!a.FPDFPathSegment_GetPoint(handle, ptr, ptr + 4)) return undefined;
        const x = a.pdfium.getValue(ptr, 'float');
        const y = a.pdfium.getValue(ptr + 4, 'float');
        const point = this.screenPoint(page, x * matrix[0] + y * matrix[2] + matrix[4], x * matrix[1] + y * matrix[3] + matrix[5]);
        if (type === 2) start = point;
        else if (previous) lines.push(segment(previous, point));
        if (start && a.FPDFPathSegment_GetClose(handle)) lines.push(segment(point, start));
        previous = point;
      }
      return lines.length ? lines : undefined;
    });
  }

  layoutMark(object) {
    const a = this.api;
    return this.memory(4, lengthPtr => {
      for (let i = 0; i < a.FPDFPageObj_CountMarks(object); i++) {
        const mark = a.FPDFPageObj_GetMark(object, i);
        const name = this.memory(56, ptr => a.FPDFPageObjMark_GetName(mark, ptr, 56, lengthPtr)
          && a.pdfium.getValue(lengthPtr, 'i32') <= 56 ? a.pdfium.UTF16ToString(ptr) : '');
        if (name === 'ListPDFWatermark') return { watermark: true };
        if (name === 'ListPDFCopiedImage') return { clipboardImage: true };
        if (name !== 'ListPDFTable' && name !== 'ListPDFText') continue;
        const get = key => {
          if (!a.FPDFPageObjMark_GetParamBlobValue(mark, key, 0, 0, lengthPtr)) return '';
          const length = a.pdfium.getValue(lengthPtr, 'i32');
          if (length < 1 || length > 260000) return '';
          return this.memory(length, ptr => {
            if (!a.FPDFPageObjMark_GetParamBlobValue(mark, key, ptr, length, lengthPtr)) return '';
            return new TextDecoder().decode(a.pdfium.HEAPU8.slice(ptr, ptr + length));
          });
        };
        const id = get('Id');
        if (!/^[a-z0-9-]{4,64}$/.test(id)) continue;
        const result = name === 'ListPDFText' ? { blockId: id } : { tableId: id };
        const raw = get('Data');
        if (!raw) return result;
        try {
          const data = JSON.parse(raw);
          if (name === 'ListPDFText') {
            const { text, width, lineHeight, rows, first, font } = data;
            if (typeof text === 'string' && text.length <= 12000 && width > 0 && width < 18000
              && lineHeight > 0 && lineHeight < 800 && Number.isInteger(rows) && rows > 0 && rows < 3000
              && Number.isInteger(first) && first >= 0 && first < rows && fontFamilies.includes(font)) {
              result.blockSpec = { text, width, lineHeight, rows, first, font, underline: data.underline === true, strike: data.strike === true };
              const cover = data.scanCover;
              if (Array.isArray(cover?.raw) && cover.raw.length === 4 && cover.raw.every(Number.isFinite)
                && /^#[a-f\d]{6}$/i.test(cover.color) && Number.isFinite(cover.size) && cover.size >= 2 && cover.size <= 120) {
                result.blockSpec.scanCover = cover;
              }
            }
          } else {
            const { rows, widths, heights, font, size, boldHeader } = data;
            const dimensions = (values, count) => Array.isArray(values) && values.length === count
              && values.every(value => typeof value === 'number' && value > 0 && value < 18000);
            if (!Array.isArray(rows) || !rows.length || rows.length > 65 || !Array.isArray(rows[0])) return result;
            const columns = rows[0].length;
            if (columns && columns <= 12 && dimensions(widths, columns) && dimensions(heights, rows.length)
              && rows.every(row => Array.isArray(row) && row.length === columns && row.every(value => typeof value === 'string' && value.length <= 3000))
              && fontFamilies.includes(font) && Number.isFinite(size) && size >= 1 && size <= 120) {
              result.tableSpec = { id, rows, widths, heights, font, size, boldHeader: !!boldHeader, style: tableStyle(data.style, rows.length, columns) };
            }
          }
        } catch {
          return result;
        }
        return result;
      }
      return null;
    });
  }

  markLayout(object, name, id, spec) {
    const a = this.api;
    const mark = check(a.FPDFPageObj_AddMark(object, name), 'Не удалось сохранить структуру документа.');
    const set = (key, value) => {
      const bytes = new TextEncoder().encode(value);
      this.bytes(bytes, ptr => check(a.FPDFPageObjMark_SetBlobParam(this.document, object, mark, key, ptr, bytes.length),
        'Не удалось сохранить структуру документа.'));
    };
    set('Id', id);
    if (spec) set('Data', JSON.stringify(spec));
  }

  setPageHeight(page, height, extra) {
    if (extra <= .3) return;
    const a = this.api;
    const box = method => this.memory(16, ptr => {
      if (!method(page, ptr, ptr + 4, ptr + 8, ptr + 12)) return null;
      return [0, 4, 8, 12].map(offset => a.pdfium.getValue(ptr + offset, 'float'));
    });
    const media = box(a.FPDFPage_GetMediaBox);
    const crop = box(a.FPDFPage_GetCropBox) ?? media;
    if (!media || extra + height > 14000) throw new Error('Для этой вставки нужна отдельная страница.');
    const side = [1, 2, 3, 0][a.FPDFPage_GetRotation(page)];
    const sign = side < 2 ? -1 : 1;
    crop[side] += sign * extra;
    media[side] = sign < 0 ? Math.min(crop[side], media[side]) : Math.max(crop[side], media[side]);
    a.FPDFPage_SetMediaBox(page, ...media);
    a.FPDFPage_SetCropBox(page, ...crop);
  }

  flow(index, { indices, after, delta }, draw) {
    return this.edit(index, page => {
      const a = this.api;
      const { width, height } = this.dimensions(page);
      const replaced = new Set(indices);
      const objects = this.objects(page);
      let bottom = 0;
      for (const item of objects) {
        const object = a.FPDFPage_GetObject(page, item.index);
        if (replaced.has(item.index)) {
          continue;
        }
        const moves = delta && item.y * height >= after - .45;
        if (moves) this.move(page, object, 0, delta / height);
        if (item.h < .96) bottom = Math.max(bottom, (item.y + item.h) * height + (moves ? delta : 0));
      }
      const insertAt = indices.length ? Math.min(...indices) : a.FPDFPage_CountObjects(page);
      const pointers = indices.map(index => a.FPDFPage_GetObject(page, index)).filter(Boolean);
      pointers.forEach(object => this.remove(page, object));
      const drawnBottom = draw(page, { width, height }, insertAt);
      this.setPageHeight(page, height, Math.max(0, drawnBottom + 16 - height, bottom > height - 10 && delta > 0 ? bottom + 12 - height : 0));
    });
  }

  lineMatrix(page, { width, height }, x, y) {
    const [left, baseline] = this.documentPoint(page, x / width, y / height);
    const rotation = this.api.FPDFPage_GetRotation(page);
    return [...[[1, 0, 0, 1], [0, 1, -1, 0], [-1, 0, 0, -1], [0, -1, 1, 0]][rotation], left, baseline];
  }

  writeBlock(index, plan) {
    this.flow(index, plan, (page, size, insertAt) => {
      let position = insertAt;
      let metadataWritten = false;
      if (plan.scanCover) {
        const box = this.displayRect(page, plan.scanCover.raw);
        const mask = this.tableFill(page, size, box.x * size.width - 1, box.y * size.height - .65,
          box.w * size.width + 2, box.h * size.height + 1.3, plan.scanCover.color);
        this.insert(page, mask, position++);
        this.markLayout(mask, 'ListPDFText', plan.id);
      }
      for (const [row, text] of plan.lines.entries()) {
        if (!text.trim()) continue;
        const line = { ...plan, text, y: plan.baseline + row * plan.lineHeight };
        const matrix = this.lineMatrix(page, size, line.x, line.y);
        const objects = this.textParts(line, matrix);
        for (const object of objects) {
          this.insert(page, object, position);
          const spec = !metadataWritten
            ? { text: plan.text, width: plan.width, lineHeight: plan.lineHeight, rows: plan.lines.length, first: row,
              font: plan.font, underline: !!plan.underline, strike: !!plan.strike, scanCover: plan.scanCover }
            : null;
          metadataWritten = true;
          this.markLayout(object, 'ListPDFText', plan.id, spec);
          position++;
        }
        for (const decoration of this.textDecorations(page, size, line, objects)) {
          this.insert(page, decoration, position++);
          this.markLayout(decoration, 'ListPDFText', plan.id);
        }
      }
      return plan.lines.length ? plan.baseline + (plan.lines.length - 1) * plan.lineHeight + plan.size * .34 : 0;
    });
  }

  tablePath(page, dimensions, points, color, lineWidth) {
    const a = this.api;
    const pdfPoints = points.map(([x, y]) => this.documentPoint(page, x / dimensions.width, y / dimensions.height));
    const shape = check(a.FPDFPageObj_CreateNewPath(...pdfPoints[0]), 'Не удалось создать границы таблицы.');
    for (const point of pdfPoints.slice(1)) a.FPDFPath_LineTo(shape, ...point);
    a.FPDFPath_SetDrawMode(shape, 0, true);
    a.FPDFPageObj_SetStrokeColor(shape, ...color);
    a.FPDFPageObj_SetStrokeWidth(shape, lineWidth);
    return shape;
  }

  tableFill(page, dimensions, x, y, width, height, color) {
    const a = this.api;
    const [x0, y0] = this.documentPoint(page, x / dimensions.width, y / dimensions.height);
    const [x1, y1] = this.documentPoint(page, (x + width) / dimensions.width, (y + height) / dimensions.height);
    const object = check(a.FPDFPageObj_CreateNewRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)),
      'Не удалось создать заливку ячейки.');
    a.FPDFPath_SetDrawMode(object, 1, false);
    a.FPDFPageObj_SetFillColor(object, ...rgb(color), 255);
    return object;
  }

  tableEdge(page, dimensions, axis, from, to, at, border, add) {
    if (border.pattern === 'none') return;
    const offsets = border.pattern === 'double' ? [-.36, .36] : [0];
    const a = this.api;
    for (const fraction of offsets) {
      const coord = at + fraction * border.width;
      const points = axis === 'h' ? [[from, coord], [to, coord]] : [[coord, from], [coord, to]];
      const edge = this.tablePath(page, dimensions, points, [...rgb(border.color), 255],
        border.pattern === 'double' ? border.width * .28 : border.width);
      if (border.pattern === 'dash' || border.pattern === 'dot') {
        const length = border.width;
        const values = border.pattern === 'dash' ? [length * 4, length * 2.75] : [length * .25, length * 2.2];
        if (border.pattern === 'dot') a.FPDFPageObj_SetLineCap(edge, 1);
        this.memory(8, ptr => {
          values.forEach((value, i) => a.pdfium.setValue(ptr + i * 4, value, 'float'));
          a.FPDFPageObj_SetDashArray(edge, ptr, values.length, 0);
        });
      }
      add(edge);
    }
  }

  writeTable(index, plan) {
    this.flow(index, plan, (page, dimensions, initial) => {
      const { id, x, y, rows, widths, heights, lines, font, size, boldHeader } = plan;
      const style = plan.style ?? tableStyle(null, rows.length, widths.length);
      const positions = (start, lengths) => lengths.reduce((points, value) => (points.push(points.at(-1) + value), points), [start]);
      const xs = positions(x, widths), ys = positions(y, heights);
      let position = initial;
      const add = (object, spec) => {
        this.insert(page, object, position++);
        this.markLayout(object, 'ListPDFTable', id, spec);
      };
      const right = xs.at(-1), bottom = ys.at(-1);
      const bounds = [[x, y], [right, y], [right, bottom], [x, bottom], [x, y]];
      add(this.tablePath(page, dimensions, bounds, [0, 0, 0, 0], .001),
        { rows, widths, heights, font, size, boldHeader, style });
      rows.forEach((row, r) => row.forEach((_, c) => {
        const color = style.cells[r][c].fill;
        if (color) add(this.tableFill(page, dimensions, xs[c], ys[r], widths[c], heights[r], color));
      }));

      const drawEdges = (axis, primary, cross) => {
        primary.forEach((at, i) => {
          const segments = cross.length - 1;
          let from = 0;
          while (from < segments) {
            const get = offset => axis === 'h' ? edgeStyle(style, axis, i, offset) : edgeStyle(style, axis, offset, i);
            const border = get(from);
            let end = from + 1;
            while (end < segments && sameBorder(border, get(end))) end++;
            this.tableEdge(page, dimensions, axis, cross[from], cross[end], at, border, add);
            from = end;
          }
        });
      };
      drawEdges('h', ys, xs);
      drawEdges('v', xs, ys);

      rows.forEach((row, r) => row.forEach((_, c) => {
        for (const [line, text] of lines[r][c].entries()) {
          if (!text.trim()) continue;
          const matrix = this.lineMatrix(page, dimensions, xs[c] + 6, ys[r] + 5 + size + line * size * 1.24);
          for (const object of this.textParts({ text, size, font, bold: boldHeader && !r, color: [32, 37, 56, 255] }, matrix)) add(object);
        }
      }));
      return bottom;
    });
  }

  temporary() {
    return new PdfEngine(this.api, this.fonts, this.fontLoads);
  }

  createDocument() {
    this.clear();
    this.document = check(this.api.FPDF_CreateNewDocument(), 'Не удалось создать PDF.');
  }

  appendDocument(source) {
    check(this.api.FPDF_ImportPages(this.document, source.document, null, this.count), 'Не удалось добавить страницы.');
  }

  placeImage(page, { x, y, width, height, bytes, format }) {
    const dimensions = this.dimensions(page);
    const point = (left, top) => this.documentPoint(page, left / dimensions.width, top / dimensions.height);
    const [x0, y0] = point(x, y + height);
    const [x1, y1] = point(x + width, y + height);
    const [x2, y2] = point(x, y);
    return this.insert(page, this.createImage(bytes, format, [x1 - x0, y1 - y0, x2 - x0, y2 - y0, x0, y0]));
  }

  imagePixels(page, index) {
    const a = this.api;
    const object = a.FPDFPage_GetObject(page, index);
    const bitmap = a.FPDFImageObj_GetBitmap(object);
    if (!bitmap) return null;
    try {
      const width = a.FPDFBitmap_GetWidth(bitmap), height = a.FPDFBitmap_GetHeight(bitmap);
      const format = a.FPDFBitmap_GetFormat(bitmap), stride = a.FPDFBitmap_GetStride(bitmap);
      const buffer = a.FPDFBitmap_GetBuffer(bitmap);
      if (width * height > 24000000 || format < 1 || format > 4) return null;
      const source = a.pdfium.HEAPU8;
      const pixels = new Uint8ClampedArray(width * height * 4);
      const bytesPerPixel = [0, 1, 3, 4, 4][format];
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const from = buffer + y * stride + x * bytesPerPixel, to = (y * width + x) * 4;
          pixels[to] = source[from + (format === 1 ? 0 : 2)];
          pixels[to + 1] = source[from + (format === 1 ? 0 : 1)];
          pixels[to + 2] = source[from];
          pixels[to + 3] = format === 4 ? source[from + 3] : 255;
        }
      }
      return { width, height, pixels };
    } finally {
      a.FPDFBitmap_Destroy(bitmap);
    }
  }

  textDecorations(page, dimensions, line, objects) {
    const decorations = [];
    if (!line.underline && !line.strike) return decorations;
    const bounds = objects.map(object => this.bounds(object, page)).filter(box => box?.w);
    if (!bounds.length) return decorations;
    const left = Math.min(line.x, ...bounds.map(box => box.x * dimensions.width));
    const right = Math.max(...bounds.map(box => (box.x + box.w) * dimensions.width));
    const stroke = Math.max(.45, line.size * .058);
    for (const delta of [line.underline && .13, line.strike && -.29].filter(Boolean)) {
      const y = line.y + delta * line.size;
      decorations.push(this.tablePath(page, dimensions, [[left, y], [right, y]], line.color, stroke));
    }
    return decorations;
  }

  drawLineText(page, dimensions, line) {
    const text = line.text.trim();
    if (!text) return;
    const objects = this.textParts({ ...line, text }, this.lineMatrix(page, dimensions, line.x, line.y));
    for (const object of objects) this.insert(page, object);
    for (const decoration of this.textDecorations(page, dimensions, line, objects)) this.insert(page, decoration);
  }

  watermark(index, spec) {
    return this.edit(index, page => {
      const a = this.api;
      const { width, height } = this.dimensions(page);
      const angle = spec.angle * Math.PI / 180;
      const center = this.documentPoint(page, .5, .5);
      const size = Math.min(spec.size, Math.min(width, height) * 1.65 / Math.max(1, [...spec.text].length));
      const object = this.createText({
        text: spec.text, font: fontFamilies[0], size, bold: true, color: spec.color,
      }, [1, 0, 0, 1, 0, 0]);
      const bounds = this.bounds(object, page);
      this.insert(page, object);
      a.FPDFPageObj_AddMark(object, 'ListPDFWatermark');
      if (bounds) {
        const [left, bottom, right, top] = bounds.raw;
        a.FPDFPageObj_Transform(object, 1, 0, 0, 1, -(left + right) / 2, -(bottom + top) / 2);
      }
      const rotation = angle + a.FPDFPage_GetRotation(page) * Math.PI / 2;
      a.FPDFPageObj_Transform(object, Math.cos(rotation), Math.sin(rotation), -Math.sin(rotation), Math.cos(rotation), ...center);
    });
  }

  imageWatermark(index, { bytes, format, ratio, width: targetWidth, angle }) {
    return this.edit(index, page => {
      const { width, height, rotation } = this.dimensions(page);
      const radians = angle * Math.PI / 180;
      const cos = Math.abs(Math.cos(radians));
      const sin = Math.abs(Math.sin(radians));
      const w = Math.min(targetWidth, width * .92 / (cos + sin / ratio), height * .92 / (sin + cos / ratio));
      const h = w / ratio;
      const rotated = radians + rotation * Math.PI / 2;
      const [cx, cy] = this.documentPoint(page, .5, .5);
      const a = w * Math.cos(rotated), b = w * Math.sin(rotated);
      const c = -h * Math.sin(rotated), d = h * Math.cos(rotated);
      const image = this.createImage(bytes, format, [a, b, c, d, cx - (a + c) / 2, cy - (b + d) / 2]);
      const position = this.insert(page, image);
      this.api.FPDFPageObj_AddMark(image, 'ListPDFWatermark');
      return position;
    });
  }

  textInArea(index, { x, y, w, h }) {
    return this.page(index, page => {
      const a = this.api;
      const textPage = a.FPDFText_LoadPage(page);
      if (!textPage) return '';
      try {
        const [x0, y0] = this.documentPoint(page, x, y);
        const [x1, y1] = this.documentPoint(page, x + w, y + h);
        const bounds = [Math.min(x0, x1), Math.max(y0, y1), Math.max(x0, x1), Math.min(y0, y1)];
        const length = a.FPDFText_GetBoundedText(textPage, ...bounds, 0, 0);
        if (!length) return '';
        return this.memory((length + 1) * 2, ptr => {
          const written = a.FPDFText_GetBoundedText(textPage, ...bounds, ptr, length + 1);
          const units = a.pdfium.HEAPU16.subarray(ptr / 2, ptr / 2 + written);
          return new TextDecoder('utf-16le').decode(units).replace(/\x00+$/, '').trim();
        });
      } finally {
        a.FPDFText_ClosePage(textPage);
      }
    });
  }

  wordAt(index, x, y, objectIndex) {
    return this.page(index, page => {
      const a = this.api;
      const object = a.FPDFPage_GetObject(page, objectIndex);
      const textPage = a.FPDFText_LoadPage(page);
      if (!object || !textPage) {
        if (textPage) a.FPDFText_ClosePage(textPage);
        return null;
      }
      try {
        const [left, top] = this.documentPoint(page, x, y);
        const point = a.FPDFText_GetCharIndexAtPos(textPage, left, top, 3, 3);
        const count = a.FPDFText_CountChars(textPage);
        const read = index => {
          if (index < 0 || index >= count || a.FPDFText_GetTextObject(textPage, index) !== object) return '';
          const unicode = a.FPDFText_GetUnicode(textPage, index);
          if (!unicode || unicode > 0x10ffff) return '';
          const char = String.fromCodePoint(unicode);
          return /[\p{L}\p{M}\p{N}]/u.test(char) ? char : '';
        };
        if (!read(point)) return null;
        let start = point, end = point + 1;
        while (point - start < 80 && read(start - 1)) start--;
        while (end - start < 160 && read(end)) end++;
        return this.memory(32, ptr => {
          const raw = [Infinity, Infinity, -Infinity, -Infinity];
          let text = '';
          for (let i = start; i < end; i++) {
            text += read(i);
            if (!a.FPDFText_GetCharBox(textPage, i, ptr, ptr + 8, ptr + 16, ptr + 24)) continue;
            const [x0, x1, y0, y1] = [0, 8, 16, 24].map(offset => a.pdfium.getValue(ptr + offset, 'double'));
            raw[0] = Math.min(raw[0], x0); raw[1] = Math.min(raw[1], y0);
            raw[2] = Math.max(raw[2], x1); raw[3] = Math.max(raw[3], y1);
          }
          return raw.every(Number.isFinite) ? { raw, label: text } : null;
        });
      } finally {
        a.FPDFText_ClosePage(textPage);
      }
    });
  }

  noteString(annotation, key) {
    const a = this.api;
    const length = a.FPDFAnnot_GetStringValue(annotation, key, 0, 0);
    if (length <= 2 || length > 65536) return '';
    return this.memory(length, ptr => {
      if (a.FPDFAnnot_GetStringValue(annotation, key, ptr, length) !== length) return '';
      return a.pdfium.UTF16ToString(ptr);
    });
  }

  setNoteString(annotation, key, text) {
    const a = this.api;
    const length = (text.length + 1) * 2;
    this.memory(length, ptr => {
      a.pdfium.stringToUTF16(text, ptr, length);
      check(a.FPDFAnnot_SetStringValue(annotation, key, ptr), 'Не удалось сохранить комментарий.');
    });
  }

  noteRect(annotation) {
    const a = this.api;
    return this.memory(16, ptr => {
      if (!a.FPDFAnnot_GetRect(annotation, ptr)) return null;
      return [0, 12, 8, 4].map(offset => a.pdfium.getValue(ptr + offset, 'float'));
    });
  }

  displayRect(page, raw) {
    const [x1, y1] = this.screenPoint(page, raw[0], raw[1]);
    const [x2, y2] = this.screenPoint(page, raw[2], raw[3]);
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x1 - x2), h: Math.abs(y1 - y2) };
  }

  notes(page) {
    const a = this.api;
    const notes = [];
    const count = a.FPDFPage_GetAnnotCount(page);
    for (let index = 0; index < count; index++) {
      const annotation = a.FPDFPage_GetAnnot(page, index);
      if (!annotation) continue;
      try {
        if (a.FPDFAnnot_GetSubtype(annotation) !== 1) continue;
        const text = this.noteString(annotation, 'Contents');
        const rect = this.noteRect(annotation);
        if (!text || !rect) continue;
        let anchor;
        try {
          const data = JSON.parse(this.noteString(annotation, 'ListPDFAnchor'));
          if (Array.isArray(data.raw) && data.raw.length === 4 && data.raw.every(Number.isFinite)) {
            anchor = { raw: data.raw, label: typeof data.label === 'string' ? data.label.slice(0, 180) : '' };
          }
        } catch { /* Standard PDF notes do not need an editor anchor. */ }
        notes.push({ index, text, label: anchor?.label ?? '', box: this.displayRect(page, anchor?.raw ?? rect),
          pin: this.displayRect(page, rect), attached: !!anchor });
      } finally {
        a.FPDFPage_CloseAnnot(annotation);
      }
    }
    return notes;
  }

  addNote(index, anchor, text) {
    return this.page(index, page => {
      const a = this.api;
      const { width, height } = this.dimensions(page);
      const target = this.displayRect(page, anchor.raw);
      const iconWidth = 18 / width, iconHeight = 18 / height;
      const x = Math.max(.5, 1 - 27 / width);
      const minY = 4 / height, maxY = 1 - iconHeight - minY;
      let y = Math.max(minY, Math.min(maxY, target.y));
      const existing = this.notes(page).filter(note => note.pin.x > .8);
      const preferred = y;
      const gap = 31 / height;
      for (let step = 0; step < 100; step++) {
        const distance = Math.ceil(step / 2) * gap * (step % 2 ? 1 : -1);
        const candidate = preferred + distance;
        if (candidate < minY || candidate > maxY) continue;
        if (existing.every(note => Math.abs(note.pin.y - candidate) > gap * .85)) {
          y = candidate;
          break;
        }
      }
      const [x1, y1] = this.documentPoint(page, x, y);
      const [x2, y2] = this.documentPoint(page, x + iconWidth, y + iconHeight);
      const annotation = check(a.EPDFPage_CreateAnnot(page, 1), 'Не удалось создать комментарий.');
      try {
        this.memory(16, ptr => {
          [Math.min(x1, x2), Math.max(y1, y2), Math.max(x1, x2), Math.min(y1, y2)].forEach((value, i) =>
            a.pdfium.setValue(ptr + i * 4, value, 'float'));
          check(a.FPDFAnnot_SetRect(annotation, ptr), 'Не удалось разместить комментарий.');
        });
        a.FPDFAnnot_SetColor(annotation, 0, 108, 89, 231, 255);
        this.setNoteString(annotation, 'Contents', text);
        this.setNoteString(annotation, 'ListPDFAnchor', JSON.stringify({ raw: anchor.raw, label: anchor.label.slice(0, 180) }));
        return a.FPDFPage_GetAnnotIndex(page, annotation);
      } finally {
        a.FPDFPage_CloseAnnot(annotation);
      }
    });
  }

  editNote(pageIndex, index, text) {
    this.page(pageIndex, page => {
      const a = this.api;
      const annotation = check(a.FPDFPage_GetAnnot(page, index), 'Комментарий не найден.');
      try {
        this.setNoteString(annotation, 'Contents', text);
      } finally {
        a.FPDFPage_CloseAnnot(annotation);
      }
    });
  }

  removeNote(pageIndex, index) {
    this.page(pageIndex, page => check(this.api.FPDFPage_RemoveAnnot(page, index), 'Не удалось удалить комментарий.'));
  }

  markerIndex(page, raw) {
    const a = this.api;
    for (let index = a.FPDFPage_GetAnnotCount(page) - 1; index >= 0; index--) {
      const annotation = a.FPDFPage_GetAnnot(page, index);
      if (!annotation) continue;
      try {
        if (a.FPDFAnnot_GetSubtype(annotation) !== 9) continue;
        const stored = this.noteString(annotation, 'ListPDFMarker');
        if (!stored) continue;
        const coordinates = stored.split(',').map(Number);
        if (coordinates.length === 4 && raw.every((value, i) => Math.abs(value - coordinates[i]) <= .25)) return index;
      } finally {
        a.FPDFPage_CloseAnnot(annotation);
      }
    }
    return -1;
  }

  markWord(pageIndex, anchor, color) {
    return this.page(pageIndex, page => {
      const a = this.api;
      const [left, bottom, right, top] = anchor.raw;
      const existing = this.markerIndex(page, anchor.raw);
      if (existing >= 0) check(a.FPDFPage_RemoveAnnot(page, existing), 'Не удалось снять выделение.');
      if (!color) return existing >= 0;
      const annotation = check(a.EPDFPage_CreateAnnot(page, 9), 'Не удалось выделить слово.');
      try {
        this.memory(32, ptr => {
          [left, top, right, top, left, bottom, right, bottom].forEach((value, i) =>
            a.pdfium.setValue(ptr + i * 4, value, 'float'));
          check(a.FPDFAnnot_AppendAttachmentPoints(annotation, ptr), 'Не удалось сохранить выделение.');
          [left, top, right, bottom].forEach((value, i) => a.pdfium.setValue(ptr + i * 4, value, 'float'));
          check(a.FPDFAnnot_SetRect(annotation, ptr), 'Не удалось разместить выделение.');
        });
        check(a.FPDFAnnot_SetColor(annotation, 0, ...rgb(color), 130), 'Не удалось сохранить цвет маркера.');
        this.setNoteString(annotation, 'ListPDFMarker', anchor.raw.map(value => value.toFixed(5)).join(','));
      } finally {
        a.FPDFPage_CloseAnnot(annotation);
      }
      return true;
    });
  }

  addScanLayer(pageIndex, lines) {
    this.edit(pageIndex, page => {
      const a = this.api;
      const dimensions = this.dimensions(page);
      const { width, height } = dimensions;
      for (const line of lines) {
        const [left, top, right, bottom] = line.box;
        const nominal = Math.min(120, Math.max(2, (bottom - top) * height * .9));
        const text = line.text.replace(/[^\p{L}\p{N}\p{P}\p{M}\p{Sc}\p{Sm}\p{Zs}№©®™•]/gu, '*');
        if (!text.trim()) continue;
        const x = left * width;
        const baseline = (bottom - (bottom - top) * .15) * height;
        const glyphs = this.fontMetrics('Noto Sans', false, false);
        const advance = [...text].reduce((total, char) => total + glyphs.advance(char), 0) * nominal;
        const stretch = Math.max(.25, Math.min(4, (right - left) * width / Math.max(1, advance)));
        const matrix = this.lineMatrix(page, dimensions, x, baseline);
        matrix[0] *= stretch;
        matrix[1] *= stretch;
        const box = this.documentPoint(page, left, top);
        const far = this.documentPoint(page, right, bottom);
        const raw = [Math.min(box[0], far[0]), Math.min(box[1], far[1]), Math.max(box[0], far[0]), Math.max(box[1], far[1])];
        const shade = '#' + line.background.map(value => value.toString(16).padStart(2, '0')).join('');
        const id = crypto.randomUUID();
        const object = this.createText({ text, color: [28, 31, 40, 255], font: 'Noto Sans', size: nominal, bold: false }, matrix);
        this.insert(page, object);
        check(a.FPDFTextObj_SetTextRenderMode(object, 3), 'Не удалось создать поисковый слой.');
        this.markLayout(object, 'ListPDFText', id, {
          text, width: Math.max(12, (right - left) * width + 4), lineHeight: nominal * 1.25, rows: 1, first: 0, font: 'Noto Sans',
          scanCover: { raw, color: shade, size: nominal },
        });
      }
    });
  }

  importPage(source, index, at) {
    const a = this.api;
    this.memory(4, ptr => {
      a.pdfium.setValue(ptr, index, 'i32');
      check(a.FPDF_ImportPagesByIndex(this.document, source.document, ptr, 1, at), 'Не удалось скопировать страницу.');
    });
  }

  copyPage(index, object = null) {
    const fragment = this.temporary();
    try {
      fragment.createDocument();
      fragment.importPage(this, index, 0);
      if (object) fragment.edit(0, page => {
        const a = fragment.api;
        const count = a.FPDFPage_CountObjects(page);
        check(object.index < count, 'Не удалось найти объект при копировании.');
        for (let i = count - 1; i >= 0; i--) {
          if (i !== object.index) fragment.remove(page, a.FPDFPage_GetObject(page, i));
        }
        for (let i = a.FPDFPage_GetAnnotCount(page) - 1; i >= 0; i--) a.FPDFPage_RemoveAnnot(page, i);
        const rect = object.raw;
        a.FPDFPage_SetMediaBox(page, ...rect);
        a.FPDFPage_SetCropBox(page, ...rect);
      });
      return fragment.save();
    } finally {
      fragment.clear();
    }
  }

  pasteObject(index, data, point) {
    const source = this.temporary();
    try {
      source.open(data.bytes);
      const a = this.api;
      return this.edit(index, page => {
        const xobject = check(a.FPDF_NewXObjectFromPage(this.document, source.document, 0), 'Не удалось вставить объект.');
        let object;
        try {
          object = check(a.FPDF_NewFormObjectFromXObject(xobject), 'Не удалось вставить объект.');
        } finally {
          a.FPDF_CloseXObject(xobject);
        }
        const { width, height } = this.dimensions(page);
        const bounds = this.bounds(object, page)?.raw;
        if (!bounds) {
          a.FPDFPageObj_Destroy(object);
          throw new Error('В буфере обмена пустой объект.');
        }
        const [x0, y0, x1, y1] = bounds;
        const w = Math.max(.01, Math.abs(x1 - x0));
        const h = Math.max(.01, Math.abs(y1 - y0));
        const scale = Math.min(1, width / w, height / h);
        const left = Math.max(0, Math.min(point.x * width, width - w * scale));
        const top = Math.max(0, Math.min(point.y * height, height - h * scale));
        const rotation = a.FPDFPage_GetRotation(page);
        const [aa, b, c, d] = [[1, 0, 0, 1], [0, 1, -1, 0], [-1, 0, 0, -1], [0, -1, 1, 0]][rotation].map(n => n * scale);
        this.setMatrix(object, [aa, b, c, d, 0, 0]);
        const unplaced = this.bounds(object, page);
        if (!unplaced) {
          a.FPDFPageObj_Destroy(object);
          throw new Error('В буфере обмена пустой объект.');
        }
        this.move(page, object, left / width - unplaced.x, top / height - unplaced.y);
        const position = this.insert(page, object);
        if (data.image) a.FPDFPageObj_AddMark(object, 'ListPDFCopiedImage');
        return position;
      });
    } finally {
      source.clear();
    }
  }

  save() {
    const a = this.api;
    const writer = check(a.PDFiumExt_OpenFileWriter(), 'Не удалось подготовить PDF к сохранению.');
    try {
      check(a.PDFiumExt_SaveAsCopy(this.document, writer), 'Не удалось сохранить PDF.');
      const size = check(a.PDFiumExt_GetFileWriterSize(writer), 'Сформирован пустой PDF.');
      return this.memory(size, ptr => {
        a.PDFiumExt_GetFileWriterData(writer, ptr, size);
        return a.pdfium.HEAPU8.slice(ptr, ptr + size);
      });
    } finally {
      a.PDFiumExt_CloseFileWriter(writer);
    }
  }
}
