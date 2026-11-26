const tileSize = 64;
const luma = (pixels, offset) => (pixels[offset] * 54 + pixels[offset + 1] * 183 + pixels[offset + 2] * 19) >> 8;

function paperLevels({ width, height, pixels }) {
  const columns = Math.ceil(width / tileSize);
  const rows = Math.ceil(height / tileSize);
  const levels = new Uint8Array(columns * rows);
  const histogram = new Uint16Array(256);
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < columns; tx++) {
      histogram.fill(0);
      let samples = 0;
      const left = tx * tileSize, top = ty * tileSize;
      for (let y = top; y < Math.min(height, top + tileSize); y += 3) {
        for (let x = left; x < Math.min(width, left + tileSize); x += 3) {
          histogram[luma(pixels, (y * width + x) * 4)]++;
          samples++;
        }
      }
      let remaining = Math.ceil(samples * .18);
      let level = 255;
      while (level > 0 && (remaining -= histogram[level]) > 0) level--;
      levels[ty * columns + tx] = level;
    }
  }
  return { columns, rows, levels };
}

function sampleAxis(size, tiles) {
  const first = new Uint16Array(size), next = new Uint16Array(size), fraction = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const position = Math.max(0, Math.min(tiles - 1, (i + .5) / tileSize - .5));
    first[i] = Math.floor(position);
    next[i] = Math.min(tiles - 1, first[i] + 1);
    fraction[i] = position - first[i];
  }
  return { first, next, fraction };
}

function estimateSlope(image) {
  const { width, height, data } = image;
  const points = [];
  const step = Math.max(2, Math.floor(Math.min(width, height) / 400));
  for (let y = Math.floor(height * .025); y < height * .975; y += step) {
    for (let x = Math.floor(width * .025); x < width * .975; x += step) {
      if (data[(y * width + x) * 4] < 105) points.push(x - width / 2, y);
    }
  }
  if (points.length < 500 || points.length > width * height / (step * step) * .45) return 0;

  const bins = new Uint32Array(height + Math.ceil(width * .22) + 2);
  const shift = Math.ceil(width * .11);
  const sharpness = degrees => {
    bins.fill(0);
    const slope = Math.tan(degrees * Math.PI / 180);
    for (let i = 0; i < points.length; i += 2) {
      bins[Math.round((points[i + 1] - points[i] * slope + shift) / 2)]++;
    }
    let energy = 0;
    for (const count of bins) energy += count * count;
    return energy;
  };

  let best = 0;
  let energy = sharpness(0);
  const baseline = energy;
  for (let angle = -7; angle <= 7; angle++) {
    const value = sharpness(angle);
    if (value > energy) { best = angle; energy = value; }
  }
  const coarse = best;
  for (const offset of [-.6, -.4, -.2, .2, .4, .6]) {
    const angle = coarse + offset;
    const value = sharpness(angle);
    if (value > energy) { best = angle; energy = value; }
  }
  return Math.abs(best) >= .4 && energy > baseline * 1.1 ? best * Math.PI / 180 : 0;
}

export function preparePhoto(view) {
  const { width, height, pixels } = view;
  const { columns, rows, levels } = paperLevels(view);
  const x = sampleAxis(width, columns), y = sampleAxis(height, rows);
  const image = new ImageData(width, height);
  for (let py = 0; py < height; py++) {
    const row = y.first[py] * columns, next = y.next[py] * columns;
    const fy = y.fraction[py];
    for (let px = 0; px < width; px++) {
      const fx = x.fraction[px];
      const upper = levels[row + x.first[px]] * (1 - fx) + levels[row + x.next[px]] * fx;
      const lower = levels[next + x.first[px]] * (1 - fx) + levels[next + x.next[px]] * fx;
      const paper = upper * (1 - fy) + lower * fy;
      const offset = (py * width + px) * 4;
      const ink = Math.max(0, paper - luma(pixels, offset) - 5);
      const gray = 255 - ink * 285 / Math.max(42, paper - 14);
      image.data[offset] = image.data[offset + 1] = image.data[offset + 2] = gray;
      image.data[offset + 3] = 255;
    }
  }
  const sorted = levels.slice().sort();
  const uneven = sorted[Math.floor(sorted.length * .85)] - sorted[Math.floor(sorted.length * .15)] >= 28;
  return { image, angle: estimateSlope(image), uneven };
}

export function mapPhotoBox(box, width, height, angle) {
  if (!angle) return box;
  const cx = width / 2, cy = height / 2;
  const sine = Math.sin(angle), cosine = Math.cos(angle);
  const points = [[box.x0, box.y0], [box.x1, box.y0], [box.x0, box.y1], [box.x1, box.y1]].map(([x, y]) => [
    cx + (x - cx) * cosine - (y - cy) * sine,
    cy + (x - cx) * sine + (y - cy) * cosine,
  ]);
  return {
    x0: Math.max(0, Math.min(...points.map(([x]) => x))),
    x1: Math.min(width, Math.max(...points.map(([x]) => x))),
    y0: Math.max(0, Math.min(...points.map(([, y]) => y))),
    y1: Math.min(height, Math.max(...points.map(([, y]) => y))),
  };
}
