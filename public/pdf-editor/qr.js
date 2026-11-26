// QR Code Generator 2.0.4, bundled so QR data stays in the browser.
import { qrcode } from './vendor/qrcode-generator.js';

const utf8 = new TextEncoder();
qrcode.stringToBytes = value => Array.from(utf8.encode(value));

async function drawMosaic(context, files, start, size, scale) {
  const middle = Math.floor(size / scale / 2) * scale;
  const end = size - middle;
  const topLeft = [0, 0, middle, middle];
  const topRight = [middle, 0, end, middle];
  const bottomLeft = [0, middle, middle, end];
  const bottomRight = [middle, middle, end, end];
  const leftColumn = [0, 0, middle, size];
  const tiles = [
    [[0, 0, size, size]],
    [leftColumn, [middle, 0, end, size]],
    [leftColumn, topRight, bottomRight],
    [topLeft, topRight, bottomLeft, bottomRight],
  ][files.length - 1];
  for (const [index, file] of files.entries()) {
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      throw new Error('Не удалось открыть «' + file.name + '». Выберите PNG, JPEG или WebP.');
    }
    try {
      if (bitmap.width * bitmap.height > 24000000) throw new Error('Выберите изображения до 24 мегапикселей.');
      const [x, y, width, height] = tiles[index];
      const crop = Math.min(bitmap.width / width, bitmap.height / height);
      const sourceWidth = width * crop;
      const sourceHeight = height * crop;
      context.drawImage(bitmap,
        (bitmap.width - sourceWidth) / 2, (bitmap.height - sourceHeight) / 2, sourceWidth, sourceHeight,
        start + x, start + y, width, height);
    } finally {
      bitmap.close();
    }
  }
}

export async function makeQr(canvas, value, files = []) {
  if (!value.trim()) throw new Error('Введите ссылку или текст.');
  if (utf8.encode(value).length > 1000) throw new Error('Текст слишком длинный для QR-кода. Сократите его.');
  if (files.length > 4) throw new Error('Выберите до четырёх изображений.');
  for (const file of files) {
    if (file.type && !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      throw new Error('Поддерживаются изображения PNG, JPEG и WebP.');
    }
    if (file.size > 12 * 1024 * 1024) throw new Error('Каждое изображение должно быть не больше 12 МБ.');
  }

  const code = qrcode(0, 'M');
  code.addData(value);
  code.make();

  const modules = code.getModuleCount();
  const scale = 12;
  const border = 4 * scale;
  canvas.width = canvas.height = modules * scale + border * 2;
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const mosaic = files.length > 0;
  if (mosaic) await drawMosaic(context, files, border, modules * scale, scale);
  for (let row = 0; row < modules; row++) {
    for (let column = 0; column < modules; column++) {
      const dark = code.isDark(row, column);
      if (!mosaic && !dark) continue;
      // Keep locator patterns, their separators and timing lines at full contrast.
      const fixed = row < 8 && (column < 8 || column >= modules - 8)
        || column < 8 && row >= modules - 8 || row === 6 || column === 6;
      const tinted = mosaic && !fixed;
      context.fillStyle = tinted
        ? (dark ? 'rgba(0,0,0,.62)' : 'rgba(255,255,255,.82)')
        : (dark ? '#000' : '#fff');
      context.fillRect(border + column * scale, border + row * scale, scale, scale);
    }
  }
  const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!png) throw new Error('Не удалось подготовить QR-код.');
  return new Uint8Array(await png.arrayBuffer());
}
