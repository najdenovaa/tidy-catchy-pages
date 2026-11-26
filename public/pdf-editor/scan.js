import { mapPhotoBox, preparePhoto } from './scan-photo.js';

const local = file => new URL('./vendor/ocr/' + file, import.meta.url).href;
let session;
let notify = () => {};

async function startWorker() {
  const { default: { createWorker, OEM } } = await import('./vendor/ocr/tesseract.esm.min.js');
  const models = await fetch(local('lstm/models.json'))
    .then(response => response.ok ? response.json() : null)
    .catch(() => null);
  const lstm = models?.version === 1;
  return createWorker(['rus', 'eng'], lstm ? OEM.LSTM_ONLY : OEM.TESSERACT_ONLY, {
    corePath: local('tesseract-core.wasm.js'), workerPath: local('worker.min.js'),
    langPath: local(lstm ? 'lstm' : ''), workerBlobURL: false, legacyCore: !lstm, legacyLang: !lstm,
    ...(lstm ? { cachePath: 'list-pdf-lstm-1' } : {}),
    logger: value => notify(value),
  });
}

export async function prepareOCR(progress) {
  notify = progress;
  session ??= startWorker().catch(error => {
    session = null;
    throw error;
  });
  return session;
}

function background(view, box) {
  const values = [[], [], []];
  const sample = (x, y) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= view.width || y >= view.height) return;
    const index = (y * view.width + x) * 4;
    values.forEach((value, i) => value.push(view.pixels[index + i]));
  };
  for (let i = 0; i <= 14; i++) {
    const x = box.x0 + (box.x1 - box.x0) * i / 14;
    for (const distance of [2, 4, 6]) {
      sample(x, box.y0 - distance);
      sample(x, box.y1 + distance);
    }
  }
  return values.map(list => {
    list.sort((a, b) => a - b);
    return list[Math.floor(list.length * .65)] ?? 255;
  });
}

function lineGroups(line) {
  const words = (line.words ?? []).filter(word => word.text?.trim());
  const gaps = words.slice(1).map((word, i) => (word.bbox?.x0 ?? 0) - (words[i].bbox?.x1 ?? 0))
    .filter(gap => gap > 0).sort((a, b) => a - b);
  const typicalGap = gaps[Math.floor(gaps.length / 2)] ?? 0;
  const maxGap = Math.max(12, (line.bbox.y1 - line.bbox.y0) * 1.15, typicalGap * 3);
  const groups = [];
  for (const word of words) {
    const group = groups.at(-1);
    const previous = group?.at(-1)?.bbox;
    if (!group || (word.bbox && previous && word.bbox.x0 - previous.x1 > maxGap)) {
      groups.push([word]);
    } else group.push(word);
  }
  return groups;
}

export function scanLines(data, view, confidence = 62, angle = 0) {
  const lines = [];
  let doubtful = 0;
  for (const block of data.blocks ?? []) for (const paragraph of block.paragraphs ?? []) for (const line of paragraph.lines ?? []) {
    if (!line.bbox) continue;
    const groups = lineGroups(line);
    for (const group of groups) {
      const first = group[0].bbox;
      const last = group.at(-1).bbox;
      const groupedBox = groups.length > 1 && first && last
        ? { ...line.bbox, x0: first.x0, x1: last.x1 }
        : line.bbox;
      const box = mapPhotoBox(groupedBox, view.width, view.height, angle);
      if (box.x1 - box.x0 < 5 || box.y1 - box.y0 < 5) continue;
      const text = group.map(word => {
        if (!word.symbols?.length) {
          if (word.confidence < confidence) {
            const count = Math.max(1, [...word.text].length);
            doubtful += count;
            return '*'.repeat(count);
          }
          return word.text;
        }
        const characters = word.symbols;
        const widths = characters.map(symbol => (symbol.bbox?.x1 ?? 0) - (symbol.bbox?.x0 ?? 0))
          .filter(value => value > 1).sort((a, b) => a - b);
        const typical = widths[Math.floor(widths.length / 2)] ?? 0;
        return characters.map((symbol, index) => {
          const previous = characters[index - 1];
          const gap = previous?.bbox && symbol.bbox ? symbol.bbox.x0 - previous.bbox.x1 : 0;
          const space = gap > Math.max(3, typical * .61) && /\p{L}$/u.test(previous?.text ?? '') && /^\p{L}/u.test(symbol.text) ? ' ' : '';
          if (/^[\p{L}\p{M}\p{N}\p{P}\p{Sc}\p{Sm}№©®™•]+$/u.test(symbol.text) && symbol.confidence >= confidence) return space + symbol.text;
          doubtful++;
          return space + '*';
        }).join('');
      }).join(' ').trim();
      if (text) lines.push({
        text, box: [box.x0 / view.width, box.y0 / view.height, box.x1 / view.width, box.y1 / view.height],
        background: background(view, box),
      });
    }
  }
  return { lines, doubtful };
}

async function imageBlob(image, angle = 0) {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext('2d').putImageData(image, 0, 0);
  let target = canvas;
  if (angle) {
    target = document.createElement('canvas');
    target.width = image.width;
    target.height = image.height;
    const context = target.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, target.width, target.height);
    context.translate(target.width / 2, target.height / 2);
    context.rotate(-angle);
    context.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  }
  const blob = await new Promise(resolve => target.toBlob(resolve, 'image/png'));
  canvas.width = target.width = 0;
  if (!blob) throw new Error('Не удалось подготовить изображение страницы.');
  return blob;
}

function resultScore(result) {
  let letters = 0;
  for (const { text } of result.lines) letters += text.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  return letters - result.doubtful * .45;
}

export async function recognizePage(worker, view, confidence) {
  const original = new ImageData(view.pixels, view.width, view.height);
  const photo = preparePhoto(view);
  const recognize = async (image, angle) => {
    const { data } = await worker.recognize(await imageBlob(image, angle), {}, { blocks: true, text: false });
    return scanLines(data, view, confidence, angle);
  };

  const first = photo.uneven || photo.angle ? photo.image : original;
  const angle = first === original ? 0 : photo.angle;
  const primary = await recognize(first, angle);
  if (first === original && primary.lines.length &&
      primary.doubtful <= resultScore(primary) * .035) return primary;

  const secondary = await recognize(first === original ? photo.image : original, 0);
  return resultScore(secondary) > resultScore(primary) ? secondary : primary;
}
