const local = file => new URL('./vendor/ocr/' + file, import.meta.url).href;
let session;
let notify = () => {};

export async function prepareOCR(progress) {
  notify = progress;
  session ??= import('./vendor/ocr/tesseract.esm.min.js').then(({ default: { createWorker, OEM } }) =>
    createWorker(['rus', 'eng'], OEM.TESSERACT_ONLY, {
      corePath: local('tesseract-core.wasm.js'), workerPath: local('worker.min.js'),
      langPath: local(''), workerBlobURL: false, legacyCore: true, legacyLang: true,
      logger: value => notify(value),
    })
  ).catch(error => {
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

export function scanLines(data, view, confidence = 62) {
  const lines = [];
  let doubtful = 0;
  for (const block of data.blocks ?? []) for (const paragraph of block.paragraphs ?? []) for (const line of paragraph.lines ?? []) {
    const box = line.bbox;
    if (!box || box.x1 - box.x0 < 5 || box.y1 - box.y0 < 5) continue;
    const text = (line.words ?? []).map(word => {
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
  return { lines, doubtful };
}

export async function recognizePage(worker, view, confidence) {
  const canvas = document.createElement('canvas');
  canvas.width = view.width;
  canvas.height = view.height;
  canvas.getContext('2d').putImageData(new ImageData(view.pixels, view.width, view.height), 0, 0);
  const image = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  canvas.width = 0;
  canvas.height = 0;
  if (!image) throw new Error('Не удалось подготовить изображение страницы.');
  const { data } = await worker.recognize(image, {}, { blocks: true, text: false });
  return scanLines(data, view, confidence);
}
