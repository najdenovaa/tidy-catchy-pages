// QR Code Generator 2.0.4, bundled so QR data stays in the browser.
import { qrcode } from './vendor/qrcode-generator.js';

const utf8 = new TextEncoder();
qrcode.stringToBytes = value => Array.from(utf8.encode(value));

export async function makeQr(canvas, value) {
  if (!value.trim()) throw new Error('Введите ссылку или текст.');
  if (utf8.encode(value).length > 1000) throw new Error('Текст слишком длинный для QR-кода. Сократите его.');

  const code = qrcode(0, 'M');
  code.addData(value);
  code.make();

  const modules = code.getModuleCount();
  const border = 4;
  const scale = 12;
  canvas.width = canvas.height = (modules + border * 2) * scale;
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#000';
  for (let row = 0; row < modules; row++) {
    for (let column = 0; column < modules; column++) {
      if (code.isDark(row, column)) context.fillRect((column + border) * scale, (row + border) * scale, scale, scale);
    }
  }
  const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!png) throw new Error('Не удалось подготовить QR-код.');
  return new Uint8Array(await png.arrayBuffer());
}
