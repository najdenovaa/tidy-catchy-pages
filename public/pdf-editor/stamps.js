import { sniffImage } from './office.js';

export async function readArtwork(file, { removeWhite = false, opacity = 1, maxSide = Infinity } = {}) {
  if (file.size > 16 * 1024 * 1024) throw new Error('Выберите изображение размером до 16 МБ.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const format = sniffImage(bytes);
  if (!format) throw new Error('Поддерживаются изображения PNG и JPEG.');
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 24000000) throw new Error('Выберите изображение размером до 24 мегапикселей.');
    const ratio = bitmap.width / bitmap.height;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    if (format === 'png' && !removeWhite && opacity === 1 && scale === 1) return { bytes, format, ratio };
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: removeWhite });
    context.globalAlpha = opacity;
    context.drawImage(bitmap, 0, 0, width, height);
    if (removeWhite) {
      const image = context.getImageData(0, 0, width, height);
      const data = image.data;
      for (let offset = 0; offset < data.length; offset += 4) {
        const darkness = 255 - Math.min(data[offset], data[offset + 1], data[offset + 2]);
        if (darkness < 11) {
          data[offset + 3] = 0;
          continue;
        }
        const ink = darkness / 255;
        for (let channel = 0; channel < 3; channel++) {
          data[offset + channel] = 255 + (data[offset + channel] - 255) / ink;
        }
        data[offset + 3] *= ink;
      }
      context.putImageData(image, 0, 0);
    }
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Не удалось подготовить изображение.');
    return { bytes: new Uint8Array(await blob.arrayBuffer()), format: 'png', ratio };
  } finally {
    bitmap.close();
  }
}
