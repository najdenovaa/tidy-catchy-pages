import type { D2Result } from "@/lib/displacement-2d";

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Цвет ячейки как смесь цветов жидкостей по долям. */
export function makeBlender(res: D2Result, colors: string[]) {
  const rgb = colors.map(hexToRgb);
  const N = res.nTheta * res.nZ, nF = res.fluids.length;
  return (frac: Uint8Array, k: number, out: Uint8ClampedArray, o: number) => {
    let r = 0, g = 0, b = 0, s = 0;
    for (let f = 0; f < nF; f++) {
      const w = frac[f * N + k];
      if (!w) continue;
      r += w * rgb[f][0]; g += w * rgb[f][1]; b += w * rgb[f][2]; s += w;
    }
    if (s > 0) { out[o] = r / s; out[o + 1] = g / s; out[o + 2] = b / s; } else { out[o] = out[o + 1] = out[o + 2] = 0; }
    out[o + 3] = 255;
  };
}

/** Индекс ячейки по окружности для угла a∈[0, 2π): 0 — верхняя (широкая) сторона, π — нижняя (узкая). */
export function thetaIndex(a: number, nTheta: number, full = false) {
  if (full) return Math.min(nTheta - 1, Math.max(0, Math.floor((a / (2 * Math.PI)) * nTheta)));
  const t = a <= Math.PI ? a : 2 * Math.PI - a;
  return Math.min(nTheta - 1, Math.max(0, Math.floor((t / Math.PI) * nTheta)));
}

/** Рисует развёртку (вся окружность) в ImageData: ширина = W (по окружности), высота = nZ. */
export function paintUnwrapped(res: D2Result, colors: string[], snap: number, W: number): ImageData {
  const blend = makeBlender(res, colors);
  const img = new ImageData(W, res.nZ);
  const fr = res.snapshots[snap].frac;
  for (let j = 0; j < res.nZ; j++) for (let x = 0; x < W; x++) {
    // x = 0 — верхняя сторона, центр — нижняя (узкая), края снова верх
    const a = ((x + 0.5) / W) * 2 * Math.PI;
    const k = j * res.nTheta + thetaIndex(a, res.nTheta, res.full);
    blend(fr, k, img.data, (j * W + x) * 4);
  }
  return img;
}
