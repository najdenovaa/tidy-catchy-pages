/**
 * Автономный движок анализа изображений и графиков
 * Использует Canvas API для пиксельного анализа без AI
 * 
 * Возможности:
 * - Цветовой гистограммный анализ (оценка качества сцепления по АКЦ)
 * - Профиль интенсивности по глубине (вертикальная ось)
 * - Детекция зон (однородные/неоднородные интервалы)
 * - Обнаружение кривых/линий (простой edge detection)
 * - Статистическая сводка
 */

export interface ImageAnalysisResult {
  fileName: string;
  width: number;
  height: number;
  colorProfile: ColorProfile;
  intensityProfile: IntensityBand[];
  zones: DetectedZone[];
  curveDetection: CurveInfo;
  chartType: ChartTypeGuess;
  summary: string;
}

export interface ColorProfile {
  dominantColors: { color: string; percentage: number; label: string }[];
  brightness: number; // 0-255 средняя яркость
  contrast: number; // 0-1
  saturation: number; // средняя насыщенность
  darkAreaPercent: number; // % тёмных зон (хорошее сцепление в АКЦ)
  lightAreaPercent: number; // % светлых зон
  midAreaPercent: number;
}

export interface IntensityBand {
  yPercent: number; // позиция по вертикали (0=верх, 100=низ) ≈ глубина
  avgBrightness: number;
  variance: number;
  dominantHue: string;
}

export interface DetectedZone {
  fromPercent: number;
  toPercent: number;
  type: "dark" | "light" | "mixed" | "gradient";
  avgBrightness: number;
  uniformity: number; // 0-1, 1=однородная
  label: string;
}

export interface CurveInfo {
  hasCurves: boolean;
  estimatedCurveCount: number;
  edgeDensity: number; // плотность контуров 0-1
  hasGrid: boolean;
  hasColorBands: boolean; // есть ли цветовые полосы (типично для VDL)
}

export interface ChartTypeGuess {
  type: "akc_cbl" | "vdl" | "pressure_chart" | "log_diagram" | "table" | "photo" | "unknown";
  confidence: number; // 0-1
  description: string;
}

// ─── Canvas helpers ──────────────────────────────────────────────

function loadImageToCanvas(file: File): Promise<{ canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      // Limit resolution for performance
      const maxDim = 800;
      let w = img.width;
      let h = img.height;
      if (w > maxDim || h > maxDim) {
        const scale = maxDim / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve({ canvas, ctx, width: w, height: h });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Не удалось загрузить изображение"));
    };
    img.src = url;
  });
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
}

function hueToLabel(hue: number): string {
  if (hue < 15 || hue >= 345) return "красный";
  if (hue < 45) return "оранжевый";
  if (hue < 75) return "жёлтый";
  if (hue < 150) return "зелёный";
  if (hue < 210) return "голубой";
  if (hue < 270) return "синий";
  if (hue < 345) return "фиолетовый";
  return "красный";
}

// ─── Color Analysis ──────────────────────────────────────────────

function analyzeColors(imageData: ImageData, width: number, height: number): ColorProfile {
  const data = imageData.data;
  const totalPixels = width * height;

  let totalBrightness = 0;
  let totalSaturation = 0;
  let darkCount = 0;
  let lightCount = 0;
  let midCount = 0;
  const brightnessValues: number[] = [];

  // Color buckets (simplified)
  const colorBuckets: Record<string, number> = {
    "чёрный/тёмно-серый": 0,
    "серый": 0,
    "светло-серый/белый": 0,
    "красный": 0,
    "оранжевый": 0,
    "жёлтый": 0,
    "зелёный": 0,
    "голубой/синий": 0,
    "фиолетовый": 0,
    "коричневый": 0,
  };

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
    const [hue, sat, lum] = rgbToHsl(r, g, b);

    totalBrightness += brightness;
    totalSaturation += sat;
    brightnessValues.push(brightness);

    if (brightness < 64) { darkCount++; colorBuckets["чёрный/тёмно-серый"]++; }
    else if (brightness > 192) { lightCount++; colorBuckets["светло-серый/белый"]++; }
    else { midCount++; }

    if (sat > 0.15 && lum > 0.1 && lum < 0.9) {
      if (brightness >= 64 && brightness <= 192) {
        // Saturated color pixel
        if (hue < 15 || hue >= 345) colorBuckets["красный"]++;
        else if (hue < 45) {
          if (lum < 0.4) colorBuckets["коричневый"]++;
          else colorBuckets["оранжевый"]++;
        }
        else if (hue < 75) colorBuckets["жёлтый"]++;
        else if (hue < 150) colorBuckets["зелёный"]++;
        else if (hue < 270) colorBuckets["голубой/синий"]++;
        else colorBuckets["фиолетовый"]++;
      }
    } else if (brightness >= 64 && brightness <= 192) {
      colorBuckets["серый"]++;
    }
  }

  // Calculate contrast
  const avgBrightness = totalBrightness / totalPixels;
  let varianceSum = 0;
  for (const b of brightnessValues) {
    varianceSum += (b - avgBrightness) ** 2;
  }
  const stdDev = Math.sqrt(varianceSum / totalPixels);
  const contrast = Math.min(1, stdDev / 128);

  // Top colors
  const dominantColors = Object.entries(colorBuckets)
    .map(([color, count]) => ({
      color,
      percentage: (count / totalPixels) * 100,
      label: color,
    }))
    .filter(c => c.percentage > 1)
    .sort((a, b) => b.percentage - a.percentage)
    .slice(0, 6);

  return {
    dominantColors,
    brightness: avgBrightness,
    contrast,
    saturation: totalSaturation / totalPixels,
    darkAreaPercent: (darkCount / totalPixels) * 100,
    lightAreaPercent: (lightCount / totalPixels) * 100,
    midAreaPercent: (midCount / totalPixels) * 100,
  };
}

// ─── Vertical Intensity Profile ──────────────────────────────────

function analyzeIntensityProfile(imageData: ImageData, width: number, height: number): IntensityBand[] {
  const data = imageData.data;
  const bands: IntensityBand[] = [];
  const bandCount = Math.min(50, height); // Max 50 bands
  const bandHeight = Math.floor(height / bandCount);

  for (let band = 0; band < bandCount; band++) {
    const yStart = band * bandHeight;
    const yEnd = Math.min(yStart + bandHeight, height);
    let totalB = 0;
    let count = 0;
    const brightnesses: number[] = [];
    const hueAccum: number[] = [];

    for (let y = yStart; y < yEnd; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const r = data[idx], g = data[idx + 1], b = data[idx + 2];
        const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
        totalB += brightness;
        brightnesses.push(brightness);
        const [hue, sat] = rgbToHsl(r, g, b);
        if (sat > 0.15) hueAccum.push(hue);
        count++;
      }
    }

    const avg = totalB / count;
    let variance = 0;
    for (const b of brightnesses) variance += (b - avg) ** 2;
    variance /= count;

    // Dominant hue
    let dominantHue = "серый";
    if (hueAccum.length > count * 0.2) {
      const avgHue = hueAccum.reduce((a, b) => a + b, 0) / hueAccum.length;
      dominantHue = hueToLabel(avgHue);
    }

    bands.push({
      yPercent: ((yStart + yEnd) / 2 / height) * 100,
      avgBrightness: avg,
      variance,
      dominantHue,
    });
  }

  return bands;
}

// ─── Zone Detection ──────────────────────────────────────────────

function detectZones(intensityProfile: IntensityBand[]): DetectedZone[] {
  if (intensityProfile.length === 0) return [];

  const zones: DetectedZone[] = [];
  let zoneStart = 0;
  let currentType: "dark" | "light" | "mixed" = intensityProfile[0].avgBrightness < 100 ? "dark" : intensityProfile[0].avgBrightness > 180 ? "light" : "mixed";

  for (let i = 1; i <= intensityProfile.length; i++) {
    const band = i < intensityProfile.length ? intensityProfile[i] : null;
    const newType: "dark" | "light" | "mixed" = band
      ? (band.avgBrightness < 100 ? "dark" : band.avgBrightness > 180 ? "light" : "mixed")
      : currentType;

    if (newType !== currentType || i === intensityProfile.length) {
      // Close zone
      const zoneBands = intensityProfile.slice(zoneStart, i);
      const avgBr = zoneBands.reduce((s, b) => s + b.avgBrightness, 0) / zoneBands.length;
      const avgVar = zoneBands.reduce((s, b) => s + b.variance, 0) / zoneBands.length;
      const uniformity = Math.max(0, 1 - avgVar / 5000);

      // Check for gradient
      let isGradient = false;
      if (zoneBands.length >= 3) {
        const first = zoneBands[0].avgBrightness;
        const last = zoneBands[zoneBands.length - 1].avgBrightness;
        if (Math.abs(last - first) > 40) isGradient = true;
      }

      const zoneType = isGradient ? "gradient" : currentType;
      const label = zoneType === "dark"
        ? "Тёмная зона (возм. хорошее сцепление)"
        : zoneType === "light"
        ? "Светлая зона (возм. дефект сцепления)"
        : zoneType === "gradient"
        ? "Градиентная зона (переходный интервал)"
        : "Смешанная зона";

      zones.push({
        fromPercent: intensityProfile[zoneStart].yPercent,
        toPercent: intensityProfile[Math.min(i - 1, intensityProfile.length - 1)].yPercent,
        type: zoneType,
        avgBrightness: avgBr,
        uniformity,
        label,
      });

      zoneStart = i;
      currentType = newType;
    }
  }

  return zones;
}

// ─── Edge / Curve Detection ──────────────────────────────────────

function detectCurves(imageData: ImageData, width: number, height: number): CurveInfo {
  const data = imageData.data;
  let edgeCount = 0;
  const totalChecked = (width - 2) * (height - 2);

  // Simple Sobel-like edge detection
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      const c = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];

      const idxR = (y * width + (x + 1)) * 4;
      const r = 0.299 * data[idxR] + 0.587 * data[idxR + 1] + 0.114 * data[idxR + 2];

      const idxD = ((y + 1) * width + x) * 4;
      const d = 0.299 * data[idxD] + 0.587 * data[idxD + 1] + 0.114 * data[idxD + 2];

      const gx = Math.abs(r - c);
      const gy = Math.abs(d - c);
      if (gx > 25 || gy > 25) edgeCount++;
    }
  }

  const edgeDensity = edgeCount / totalChecked;

  // Detect grid: check for regular horizontal/vertical lines
  let horizontalLineCount = 0;
  const sampleRows = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
  for (const rowFrac of sampleRows) {
    const y = Math.floor(rowFrac * height);
    let linePixels = 0;
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const brightness = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      if (brightness < 50) linePixels++;
    }
    if (linePixels > width * 0.5) horizontalLineCount++;
  }

  // Detect color bands (VDL pattern — horizontal color streaks)
  let colorBandRows = 0;
  for (let y = 0; y < height; y += Math.max(1, Math.floor(height / 100))) {
    const rowColors = new Set<string>();
    for (let x = 0; x < width; x += 5) {
      const idx = (y * width + x) * 4;
      const [hue, sat] = rgbToHsl(data[idx], data[idx + 1], data[idx + 2]);
      if (sat > 0.2) {
        rowColors.add(hueToLabel(hue));
      }
    }
    if (rowColors.size >= 2) colorBandRows++;
  }
  const hasColorBands = colorBandRows > 20;

  // Estimate curve count by counting distinct vertical transitions
  const estimatedCurveCount = Math.min(10, Math.round(edgeDensity * 30));

  return {
    hasCurves: edgeDensity > 0.02,
    estimatedCurveCount,
    edgeDensity,
    hasGrid: horizontalLineCount >= 3,
    hasColorBands,
  };
}

// ─── Chart Type Guessing ─────────────────────────────────────────

function guessChartType(
  colorProfile: ColorProfile,
  curveInfo: CurveInfo,
  fileName: string,
  aspectRatio: number
): ChartTypeGuess {
  const name = fileName.toLowerCase();

  // Keyword-based detection
  if (name.match(/акц|cbl|cbvl|bond|сцеп|cement.*log/)) {
    return { type: "akc_cbl", confidence: 0.9, description: "АКЦ / CBL — диаграмма акустической цементометрии" };
  }
  if (name.match(/vdl|variable.*density|сгдт|переменн/)) {
    return { type: "vdl", confidence: 0.9, description: "VDL / СГДТ — диаграмма переменной плотности" };
  }
  if (name.match(/давлен|pressure|закач|pump|скц|темп/)) {
    return { type: "pressure_chart", confidence: 0.8, description: "График давлений / закачки" };
  }
  if (name.match(/каротаж|log|гис|инкл|профиль/)) {
    return { type: "log_diagram", confidence: 0.7, description: "Каротажная диаграмма / ГИС" };
  }

  // Visual pattern detection
  if (curveInfo.hasColorBands && aspectRatio > 1.5) {
    return { type: "vdl", confidence: 0.6, description: "Возможно VDL — обнаружены горизонтальные цветовые полосы" };
  }

  if (curveInfo.hasGrid && curveInfo.hasCurves && colorProfile.saturation < 0.15) {
    return { type: "akc_cbl", confidence: 0.5, description: "Возможно АКЦ/CBL — обнаружены кривые на сетке" };
  }

  if (curveInfo.hasCurves && curveInfo.estimatedCurveCount >= 2 && colorProfile.saturation > 0.1) {
    return { type: "pressure_chart", confidence: 0.5, description: "Возможно график давлений — обнаружены цветные кривые" };
  }

  if (aspectRatio > 2 && curveInfo.hasCurves) {
    return { type: "log_diagram", confidence: 0.4, description: "Возможно каротажная диаграмма (вытянутый формат)" };
  }

  if (colorProfile.lightAreaPercent > 60 && curveInfo.hasGrid) {
    return { type: "table", confidence: 0.4, description: "Возможно таблица или документ" };
  }

  if (colorProfile.saturation > 0.3 && !curveInfo.hasGrid) {
    return { type: "photo", confidence: 0.5, description: "Фотография (не диаграмма)" };
  }

  return { type: "unknown", confidence: 0.2, description: "Тип изображения не определён автоматически" };
}

// ─── Summary Generation ──────────────────────────────────────────

function generateSummary(
  result: Omit<ImageAnalysisResult, "summary">
): string {
  const lines: string[] = [];
  const { colorProfile, zones, curveDetection, chartType } = result;

  lines.push(`**Тип**: ${chartType.description} (уверенность: ${(chartType.confidence * 100).toFixed(0)}%)`);
  lines.push(`**Размер**: ${result.width}×${result.height} px`);
  lines.push("");

  // Color summary
  lines.push(`**Яркость**: ${colorProfile.brightness.toFixed(0)}/255 | **Контраст**: ${(colorProfile.contrast * 100).toFixed(0)}%`);
  lines.push(`**Тёмные зоны**: ${colorProfile.darkAreaPercent.toFixed(1)}% | **Светлые**: ${colorProfile.lightAreaPercent.toFixed(1)}% | **Средние**: ${colorProfile.midAreaPercent.toFixed(1)}%`);

  if (colorProfile.dominantColors.length > 0) {
    const topColors = colorProfile.dominantColors.slice(0, 4).map(c => `${c.label} (${c.percentage.toFixed(1)}%)`).join(", ");
    lines.push(`**Преобладающие цвета**: ${topColors}`);
  }

  // AKC/CBL specific interpretation
  if (chartType.type === "akc_cbl" || chartType.type === "vdl") {
    lines.push("");
    lines.push("**Интерпретация АКЦ/СГДТ:**");
    if (colorProfile.darkAreaPercent > 50) {
      lines.push("- ✅ Преобладают тёмные зоны — предположительно хорошее сцепление на большей части интервала");
    } else if (colorProfile.darkAreaPercent > 25) {
      lines.push("- ⚠️ Смешанная картина — зоны хорошего и неудовлетворительного сцепления");
    } else {
      lines.push("- 🔴 Преобладают светлые зоны — предположительно неудовлетворительное сцепление");
    }
  }

  // Zones
  if (zones.length > 0) {
    lines.push("");
    lines.push("**Обнаруженные зоны по глубине:**");
    for (const zone of zones) {
      lines.push(`- ${zone.fromPercent.toFixed(0)}%–${zone.toPercent.toFixed(0)}%: ${zone.label} (однородность: ${(zone.uniformity * 100).toFixed(0)}%)`);
    }
  }

  // Curves
  if (curveDetection.hasCurves) {
    lines.push("");
    lines.push(`**Кривые**: обнаружено ~${curveDetection.estimatedCurveCount} кривых/линий`);
    if (curveDetection.hasGrid) lines.push("- Обнаружена координатная сетка");
    if (curveDetection.hasColorBands) lines.push("- Обнаружены цветовые полосы (характерно для VDL)");
  }

  return lines.join("\n");
}

// ─── Main entry point ────────────────────────────────────────────

export async function analyzeImage(file: File): Promise<ImageAnalysisResult> {
  const { canvas, ctx, width, height } = await loadImageToCanvas(file);
  const imageData = ctx.getImageData(0, 0, width, height);

  const colorProfile = analyzeColors(imageData, width, height);
  const intensityProfile = analyzeIntensityProfile(imageData, width, height);
  const zones = detectZones(intensityProfile);
  const curveDetection = detectCurves(imageData, width, height);
  const chartType = guessChartType(colorProfile, curveDetection, file.name, height / width);

  const partial = {
    fileName: file.name,
    width,
    height,
    colorProfile,
    intensityProfile,
    zones,
    curveDetection,
    chartType,
  };

  return {
    ...partial,
    summary: generateSummary(partial),
  };
}

/** Format analysis result as markdown for inclusion in report */
export function imageAnalysisToMarkdown(result: ImageAnalysisResult): string {
  let md = `### 🖼 ${result.fileName}\n\n`;
  md += result.summary + "\n\n";

  // Color distribution table
  if (result.colorProfile.dominantColors.length > 0) {
    md += `| Цвет | Доля |\n|---|---|\n`;
    for (const c of result.colorProfile.dominantColors.slice(0, 6)) {
      md += `| ${c.label} | ${c.percentage.toFixed(1)}% |\n`;
    }
    md += "\n";
  }

  return md;
}
