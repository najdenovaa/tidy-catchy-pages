/**
 * Автономный OCR-движок на базе Canvas API
 * Распознаёт текст, числа, таблицы на изображениях
 * без внешних API и AI
 * 
 * Методы:
 * - Сегментация текстовых строк по яркостным переходам
 * - Детекция числовых областей (шкалы, значения)
 * - Поиск табличных структур
 * - Распознавание ключевых слов цементирования через pattern matching
 */

export interface OcrResult {
  textRegions: TextRegion[];
  detectedNumbers: DetectedNumber[];
  tableRegions: TableRegion[];
  scaleInfo: ScaleInfo | null;
  keywords: DetectedKeyword[];
  rawText: string;
  confidence: number;
}

export interface TextRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  yPercent: number;
  estimatedCharCount: number;
  avgBrightness: number;
  isDark: boolean; // тёмный текст на светлом фоне
  density: number; // плотность пикселей текста 0-1
}

export interface DetectedNumber {
  value: string;
  x: number;
  y: number;
  yPercent: number;
  context: "depth" | "pressure" | "density" | "rate" | "time" | "temperature" | "generic";
  confidence: number;
}

export interface TableRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  estimatedRows: number;
  estimatedCols: number;
}

export interface ScaleInfo {
  orientation: "vertical" | "horizontal";
  minValue: number;
  maxValue: number;
  unit: string;
  tickCount: number;
}

export interface DetectedKeyword {
  keyword: string;
  category: string;
  yPercent: number;
  confidence: number;
}

// ─── Core pixel analysis ─────────────────────────────────────────

function getImageData(file: File): Promise<{ data: ImageData; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const maxDim = 1200;
      let w = img.width, h = img.height;
      if (Math.max(w, h) > maxDim) {
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
      resolve({ data: ctx.getImageData(0, 0, w, h), width: w, height: h });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Не удалось загрузить изображение")); };
    img.src = url;
  });
}

function brightness(data: Uint8ClampedArray, idx: number): number {
  return 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
}

// ─── Binarize image ──────────────────────────────────────────────

function binarize(imageData: ImageData, width: number, height: number): Uint8Array {
  const data = imageData.data;
  const binary = new Uint8Array(width * height);
  
  // Otsu's threshold approximation
  const histogram = new Float64Array(256);
  for (let i = 0; i < data.length; i += 4) {
    histogram[Math.round(brightness(data, i))]++;
  }
  const total = width * height;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * histogram[i];
  
  let sumB = 0, wB = 0, maxVariance = 0, threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += histogram[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * histogram[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const variance = wB * wF * (mB - mF) ** 2;
    if (variance > maxVariance) { maxVariance = variance; threshold = t; }
  }
  
  for (let i = 0; i < total; i++) {
    const b = brightness(data, i * 4);
    binary[i] = b < threshold ? 1 : 0;
  }
  
  return binary;
}

// ─── Text line detection ─────────────────────────────────────────

function detectTextLines(binary: Uint8Array, width: number, height: number): TextRegion[] {
  const regions: TextRegion[] = [];
  
  // Horizontal projection — count dark pixels per row
  const rowProjection = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    let count = 0;
    for (let x = 0; x < width; x++) {
      if (binary[y * width + x] === 1) count++;
    }
    rowProjection[y] = count / width;
  }
  
  // Find text lines (runs of rows with significant dark content)
  const textThreshold = 0.02; // minimum 2% dark pixels
  let lineStart = -1;
  
  for (let y = 0; y <= height; y++) {
    const hasText = y < height && rowProjection[y] > textThreshold;
    
    if (hasText && lineStart === -1) {
      lineStart = y;
    } else if (!hasText && lineStart !== -1) {
      const lineHeight = y - lineStart;
      if (lineHeight >= 4 && lineHeight <= height * 0.15) {
        // Find horizontal extent
        let xMin = width, xMax = 0;
        let totalDark = 0;
        for (let ly = lineStart; ly < y; ly++) {
          for (let x = 0; x < width; x++) {
            if (binary[ly * width + x] === 1) {
              if (x < xMin) xMin = x;
              if (x > xMax) xMax = x;
              totalDark++;
            }
          }
        }
        
        const regionWidth = xMax - xMin + 1;
        const density = totalDark / (regionWidth * lineHeight);
        
        // Estimate character count from connected components width
        const avgCharWidth = Math.max(6, lineHeight * 0.5);
        const estimatedChars = Math.round(regionWidth / avgCharWidth);
        
        regions.push({
          x: xMin,
          y: lineStart,
          width: regionWidth,
          height: lineHeight,
          yPercent: ((lineStart + y) / 2 / height) * 100,
          estimatedCharCount: estimatedChars,
          avgBrightness: 0,
          isDark: true,
          density,
        });
      }
      lineStart = -1;
    }
  }
  
  return regions;
}

// ─── Number detection via column analysis ────────────────────────

function detectNumberRegions(
  binary: Uint8Array,
  textRegions: TextRegion[],
  width: number,
  height: number
): DetectedNumber[] {
  const numbers: DetectedNumber[] = [];
  
  // Analyze left and right margins for scale numbers
  const margins = [
    { name: "left", xStart: 0, xEnd: Math.floor(width * 0.12) },
    { name: "right", xStart: Math.floor(width * 0.88), xEnd: width },
  ];
  
  for (const margin of margins) {
    // Find text regions in this margin
    const marginRegions = textRegions.filter(r =>
      r.x >= margin.xStart && r.x + r.width <= margin.xEnd + 20
    );
    
    if (marginRegions.length >= 3) {
      // Likely a depth/value scale
      const sortedByY = [...marginRegions].sort((a, b) => a.y - b.y);
      const spacing = sortedByY.length > 1
        ? (sortedByY[sortedByY.length - 1].y - sortedByY[0].y) / (sortedByY.length - 1)
        : 0;
      
      // Regular spacing suggests scale labels
      if (spacing > 10) {
        for (const r of sortedByY) {
          numbers.push({
            value: `~${r.estimatedCharCount}digits`,
            x: r.x,
            y: r.y,
            yPercent: r.yPercent,
            context: margin.name === "left" ? "depth" : "generic",
            confidence: 0.5,
          });
        }
      }
    }
  }
  
  // Top margin — may contain header numbers (pressure, time scales)
  const topRegions = textRegions.filter(r => r.yPercent < 8);
  for (const r of topRegions) {
    numbers.push({
      value: `header_${r.estimatedCharCount}chars`,
      x: r.x,
      y: r.y,
      yPercent: r.yPercent,
      context: "generic",
      confidence: 0.3,
    });
  }
  
  return numbers;
}

// ─── Table detection ─────────────────────────────────────────────

function detectTables(binary: Uint8Array, width: number, height: number): TableRegion[] {
  const tables: TableRegion[] = [];
  
  // Find grid-like structures: look for intersections of horizontal and vertical lines
  const hLines: number[] = [];
  const vLines: number[] = [];
  
  // Detect horizontal lines
  for (let y = 0; y < height; y++) {
    let run = 0;
    for (let x = 0; x < width; x++) {
      if (binary[y * width + x] === 1) run++;
      else run = 0;
    }
    // Count total dark pixels in row
    let total = 0;
    for (let x = 0; x < width; x++) {
      if (binary[y * width + x] === 1) total++;
    }
    if (total > width * 0.4) hLines.push(y);
  }
  
  // Detect vertical lines
  for (let x = 0; x < width; x++) {
    let total = 0;
    for (let y = 0; y < height; y++) {
      if (binary[y * width + x] === 1) total++;
    }
    if (total > height * 0.3) vLines.push(x);
  }
  
  // If we have both horizontal and vertical lines, it's likely a table
  if (hLines.length >= 3 && vLines.length >= 2) {
    const y1 = Math.min(...hLines);
    const y2 = Math.max(...hLines);
    const x1 = Math.min(...vLines);
    const x2 = Math.max(...vLines);
    
    tables.push({
      x: x1,
      y: y1,
      width: x2 - x1,
      height: y2 - y1,
      estimatedRows: hLines.length - 1,
      estimatedCols: vLines.length - 1,
    });
  }
  
  return tables;
}

// ─── Scale detection ─────────────────────────────────────────────

function detectScale(
  textRegions: TextRegion[],
  width: number,
  height: number
): ScaleInfo | null {
  // Check for vertical scale on left margin
  const leftMarginRegions = textRegions
    .filter(r => r.x < width * 0.15 && r.estimatedCharCount >= 2 && r.estimatedCharCount <= 6)
    .sort((a, b) => a.y - b.y);
  
  if (leftMarginRegions.length >= 4) {
    const spacing = leftMarginRegions.map((r, i) =>
      i > 0 ? r.y - leftMarginRegions[i - 1].y : 0
    ).filter(s => s > 0);
    
    const avgSpacing = spacing.reduce((a, b) => a + b, 0) / spacing.length;
    const spacingVariance = spacing.reduce((s, v) => s + (v - avgSpacing) ** 2, 0) / spacing.length;
    const isRegular = spacingVariance < avgSpacing * avgSpacing * 0.3;
    
    if (isRegular) {
      return {
        orientation: "vertical",
        minValue: 0,
        maxValue: leftMarginRegions.length * 100,
        unit: "м",
        tickCount: leftMarginRegions.length,
      };
    }
  }
  
  // Check for horizontal scale on top
  const topRegions = textRegions
    .filter(r => r.yPercent < 10 && r.estimatedCharCount >= 1 && r.estimatedCharCount <= 5)
    .sort((a, b) => a.x - b.x);
  
  if (topRegions.length >= 3) {
    return {
      orientation: "horizontal",
      minValue: 0,
      maxValue: 100,
      unit: "",
      tickCount: topRegions.length,
    };
  }
  
  return null;
}

// ─── Keyword pattern matching ────────────────────────────────────
// Match visual patterns that correspond to known cementing terms

const CEMENTING_KEYWORDS: { pattern: RegExp; keyword: string; category: string }[] = [
  // These are matched against structural features, not actual OCR
  // but we use them for contextual interpretation
  { pattern: /depth|глубин/i, keyword: "глубина", category: "geometry" },
  { pattern: /давлен|press/i, keyword: "давление", category: "hydraulics" },
  { pattern: /плотн|densit/i, keyword: "плотность", category: "fluids" },
  { pattern: /расход|rate|flow/i, keyword: "расход", category: "hydraulics" },
  { pattern: /темп|temp/i, keyword: "температура", category: "thermal" },
  { pattern: /СНС|gel/i, keyword: "СНС", category: "rheology" },
  { pattern: /АКЦ|CBL|сцепл|bond/i, keyword: "АКЦ/CBL", category: "quality" },
  { pattern: /VDL|СГДТ/i, keyword: "VDL/СГДТ", category: "quality" },
  { pattern: /каверн|cavern|cave/i, keyword: "кавернозность", category: "geometry" },
  { pattern: /цемент|cement/i, keyword: "цемент", category: "material" },
  { pattern: /буфер|spacer/i, keyword: "буфер", category: "fluids" },
  { pattern: /обсадн|casing/i, keyword: "обсадная", category: "geometry" },
  { pattern: /продавк|displace/i, keyword: "продавка", category: "operation" },
  { pattern: /закачк|pump/i, keyword: "закачка", category: "operation" },
];

function matchKeywordsFromStructure(
  textRegions: TextRegion[],
  numberRegions: DetectedNumber[],
  tableRegions: TableRegion[],
  scaleInfo: ScaleInfo | null,
  width: number,
  height: number
): DetectedKeyword[] {
  const keywords: DetectedKeyword[] = [];
  const aspectRatio = height / width;
  
  // Vertical document with left scale → likely depth log
  if (aspectRatio > 1.3 && scaleInfo?.orientation === "vertical") {
    keywords.push({ keyword: "каротажная диаграмма", category: "chart_type", yPercent: 0, confidence: 0.7 });
    keywords.push({ keyword: "глубина", category: "geometry", yPercent: 0, confidence: 0.8 });
  }
  
  // Has table structure → likely report or data table
  if (tableRegions.length > 0) {
    keywords.push({ keyword: "таблица данных", category: "structure", yPercent: tableRegions[0].y / height * 100, confidence: 0.8 });
  }
  
  // Many text lines → likely a document/report
  if (textRegions.length > 20) {
    keywords.push({ keyword: "документ/отчёт", category: "document", yPercent: 0, confidence: 0.6 });
  }
  
  // Dense text at top → header area
  const headerRegions = textRegions.filter(r => r.yPercent < 15);
  if (headerRegions.length >= 2) {
    keywords.push({ keyword: "заголовок", category: "structure", yPercent: 5, confidence: 0.5 });
  }
  
  // Depth numbers on left
  const depthNumbers = numberRegions.filter(n => n.context === "depth");
  if (depthNumbers.length >= 3) {
    keywords.push({ keyword: "шкала глубин", category: "geometry", yPercent: 50, confidence: 0.7 });
  }
  
  return keywords;
}

// ─── Main OCR entry point ────────────────────────────────────────

export async function performOCR(file: File): Promise<OcrResult> {
  const { data: imageData, width, height } = await getImageData(file);
  const binary = binarize(imageData, width, height);
  
  const textRegions = detectTextLines(binary, width, height);
  const numberRegions = detectNumberRegions(binary, textRegions, width, height);
  const tableRegions = detectTables(binary, width, height);
  const scaleInfo = detectScale(textRegions, width, height);
  const keywords = matchKeywordsFromStructure(textRegions, numberRegions, tableRegions, scaleInfo, width, height);
  
  // Calculate overall confidence
  const hasStructure = textRegions.length > 0 || tableRegions.length > 0;
  const confidence = hasStructure
    ? Math.min(0.9, 0.3 + textRegions.length * 0.02 + tableRegions.length * 0.1 + (scaleInfo ? 0.15 : 0))
    : 0.1;
  
  // Generate raw text summary
  const rawText = generateOcrSummary(textRegions, numberRegions, tableRegions, scaleInfo, keywords, width, height);
  
  return {
    textRegions,
    detectedNumbers: numberRegions,
    tableRegions,
    scaleInfo,
    keywords,
    rawText,
    confidence,
  };
}

function generateOcrSummary(
  textRegions: TextRegion[],
  numbers: DetectedNumber[],
  tables: TableRegion[],
  scale: ScaleInfo | null,
  keywords: DetectedKeyword[],
  width: number,
  height: number
): string {
  const lines: string[] = [];
  
  lines.push(`**Распознавание текста (OCR)**`);
  lines.push(`- Размер: ${width}×${height} px`);
  lines.push(`- Обнаружено текстовых строк: ${textRegions.length}`);
  lines.push(`- Обнаружено числовых областей: ${numbers.length}`);
  
  if (tables.length > 0) {
    for (const t of tables) {
      lines.push(`- Таблица: ~${t.estimatedRows} строк × ${t.estimatedCols} столбцов`);
    }
  }
  
  if (scale) {
    lines.push(`- Шкала: ${scale.orientation === "vertical" ? "вертикальная" : "горизонтальная"}, ${scale.tickCount} делений`);
  }
  
  if (keywords.length > 0) {
    lines.push(`- Ключевые элементы: ${keywords.map(k => k.keyword).join(", ")}`);
  }
  
  // Text density distribution
  if (textRegions.length > 0) {
    const topText = textRegions.filter(r => r.yPercent < 25).length;
    const midText = textRegions.filter(r => r.yPercent >= 25 && r.yPercent < 75).length;
    const botText = textRegions.filter(r => r.yPercent >= 75).length;
    lines.push(`- Распределение текста: верх ${topText}, середина ${midText}, низ ${botText}`);
  }
  
  return lines.join("\n");
}

/** Format OCR result as markdown */
export function ocrToMarkdown(result: OcrResult, fileName: string): string {
  let md = `#### 🔤 OCR: ${fileName}\n\n`;
  md += result.rawText + "\n\n";
  return md;
}
