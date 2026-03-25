import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const IMAGE_MIMES = new Set([
  "image/png", "image/jpeg", "image/webp", "image/gif",
  "image/bmp", "image/tiff",
]);

function isVisionCompatible(mimeType: string): boolean {
  return IMAGE_MIMES.has(mimeType) || mimeType === "application/pdf";
}

async function extractTextFromFile(
  file: { base64: string; mimeType: string; name: string },
  apiKey: string
): Promise<string> {
  if (file.mimeType === "text/plain") {
    try {
      const bytes = Uint8Array.from(atob(file.base64), c => c.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    } catch {
      return "";
    }
  }

  // For DOC/DOCX/XLS/XLSX — vision API doesn't support these directly.
  // Try to decode as text (some .doc files are actually RTF or contain readable text).
  if (!isVisionCompatible(file.mimeType)) {
    console.log(`Non-vision format: ${file.name} (${file.mimeType}), attempting text extraction...`);
    try {
      const bytes = Uint8Array.from(atob(file.base64), c => c.charCodeAt(0));
      const rawText = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      
      // Extract readable text fragments (filter binary garbage)
      const lines = rawText.split(/\r?\n/);
      const readable: string[] = [];
      for (const line of lines) {
        // Keep lines that have mostly printable characters (Cyrillic + Latin + digits + punctuation)
        const clean = line.replace(/[^\x20-\x7E\u0400-\u04FF\u00A0-\u00FF\t.,;:!?()[\]{}<>@#$%^&*+=\-_/\\|~`"'№°±²³µ·½¼¾×÷]/g, " ");
        const trimmed = clean.replace(/\s{3,}/g, "  ").trim();
        if (trimmed.length > 5) {
          readable.push(trimmed);
        }
      }

      const extracted = readable.join("\n");
      if (extracted.length > 100) {
        console.log(`Extracted ${extracted.length} chars of text from ${file.name}`);
        return extracted;
      }
      
      // If text extraction yielded little, try sending to AI as a last resort with description
      console.log(`Little text found in ${file.name}, sending binary hint to AI`);
      return `[Файл ${file.name} в формате ${file.mimeType}. Текстовые фрагменты:\n${extracted || "(не удалось извлечь)"}]\nПримечание: для полного анализа рекомендуется конвертировать файл в PDF.`;
    } catch (e) {
      console.error(`Text extraction failed for ${file.name}:`, e);
      return `[Не удалось прочитать ${file.name} — формат ${file.mimeType}. Рекомендуется конвертировать в PDF.]`;
    }
  }

  console.log(`Extracting via vision from ${file.name} (${file.mimeType})...`);

  const extractionPrompt = file.name.toLowerCase().match(/акц|сгдт|cbl|vdl|акустич|цементо|cement|bond/i)
    ? `Это данные АКУСТИЧЕСКОЙ ЦЕМЕНТОМЕТРИИ (АКЦ / СГДТ / CBL-VDL). Извлеки АБСОЛЮТНО ВСЕ данные:

ГРАФИКИ И ДИАГРАММЫ (КРИТИЧЕСКИ ВАЖНО!):
- Опиши КАЖДУЮ кривую: что она показывает, единицы измерения, масштаб
- Значения амплитуд CBL по интервалам глубин (мВ или дБ)
- Характер кривых VDL — наличие/отсутствие сигнала от пласта
- Контакт цемент-колонна: где хороший, где плохой (конкретные глубины)
- Контакт цемент-порода: где есть, где нет (конкретные глубины)
- Оценку качества сцепления по интервалам: отличное/хорошее/удовлетворительное/неудовлетворительное
- Центрацию колонны если видна на диаграмме
- Эксцентриситет, толщину цементного камня
- Зоны каналообразования, микрозазоров

ТАБЛИЦЫ: воспроизведи все таблицы с данными точно.
ЗАКЛЮЧЕНИЯ: текстовые выводы и рекомендации.
Верни ВСЕ извлечённые данные структурированно.`

    : file.name.toLowerCase().match(/диаграмм|график|chart|гти|mud.*log|скц|замер/i)
    ? `Это ДИАГРАММА / ГРАФИК. Проанализируй ДОСКОНАЛЬНО:

- Тип диаграммы (закачки, давления, ГТИ, СКЦ и т.д.)
- ВСЕ кривые: название, цвет, единицы измерения, привязка к оси
- Числовые значения в ключевых точках
- Тренды: рост, падение, стабилизация, аномалии
- Корреляция между кривыми
- Если диаграмма закачки: объёмы, расходы, давления на каждом этапе
- Если ГТИ: параметры бурения, давления, газопоказания
- Если СКЦ: температурный профиль, аномалии
- Временные метки и привязки к глубинам
Верни ПОЛНОЕ описание всех данных на графике.`

    : `Извлеки ВСЕ данные из этого документа/изображения максимально точно. Сохраняй структуру: заголовки, таблицы, числовые данные.
Если есть графики или диаграммы — опиши КАЖДУЮ кривую, значения, тренды, привязки к осям.
Если это лабораторные данные / реология:
- Все числовые значения, плотности, вязкости, водоотдачу
- Результаты тестов, температуры, время загустевания
Если это протокол / план / рапорт:
- Все ключевые параметры и факты
- Давления, объёмы, режимы, время операций
- Моделирование (если есть): давления, ECD, скорости
Верни ТОЛЬКО извлечённые данные без комментариев.`;

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: extractionPrompt },
            {
              type: "image_url",
              image_url: {
                url: `data:${file.mimeType};base64,${file.base64}`,
              },
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    console.error(`Vision API error for ${file.name}: ${response.status}`, errText);
    return `[Не удалось распознать: ${file.name} (статус ${response.status})]`;
  }

  const result = await response.json();
  const content = result.choices?.[0]?.message?.content || "";
  console.log(`Extracted ${content.length} chars from ${file.name}`);
  return content;
}

function calcReynolds(density: number, velocity: number, dHyd: number, pv: number, yp: number): { re: number; regime: string } {
  // Bingham plastic Reynolds number: Re = ρ·v·Dh / (PV + YP·Dh/(6·v))
  if (!velocity || velocity <= 0 || !dHyd || dHyd <= 0) return { re: 0, regime: "нет данных" };
  const pvPas = (pv || 25) / 1000; // mPa·s → Pa·s
  const ypPa = yp || 25;
  const denominator = pvPas + (ypPa * dHyd) / (6 * velocity);
  if (denominator <= 0) return { re: 0, regime: "нет данных" };
  const re = (density * velocity * dHyd) / denominator;
  const regime = re < 2100 ? "ламинарный" : re < 3000 ? "переходный" : "турбулентный";
  return { re: Math.round(re), regime };
}

function buildCalcContext(calcData: any): string {
  let ctx = "";
  const wd = calcData?.wellData;
  if (wd) {
    ctx += `\n## Данные скважины:\n`;
    ctx += `- Глубина MD: ${wd.wellDepthMD} м, TVD: ${wd.wellDepthTVD} м\n`;
    ctx += `- Глубина спуска колонны MD: ${wd.casingDepthMD} м\n`;
    ctx += `- Диаметр долота: ${wd.holeDiameter} мм\n`;
    ctx += `- Обсадная колонна OD: ${wd.casingOD} мм, стенка: ${wd.casingWall} мм\n`;
    ctx += `- Высота подъёма цемента: ${wd.cementRiseHeight} м\n`;
    ctx += `- Коэффициент кавернозности: ${wd.cavernCoeff}\n`;
    if (wd.previousCasingDepth) ctx += `- Башмак предыдущей колонны: ${wd.previousCasingDepth} м\n`;
    if (wd.previousCasingOD) ctx += `- Предыдущая колонна OD: ${wd.previousCasingOD} мм\n`;

    // Calculate annular hydraulic diameter and flow regimes
    const holeDia = wd.holeDiameter / 1000; // mm → m
    const casingOD = wd.casingOD / 1000;
    const dHydAnnulus = (holeDia * (wd.cavernCoeff || 1)) - casingOD;
    const annArea = (Math.PI / 4) * ((holeDia * (wd.cavernCoeff || 1)) ** 2 - casingOD ** 2);

    if (dHydAnnulus > 0 && annArea > 0) {
      ctx += `\n## Расчёт режимов течения в затрубье:\n`;
      ctx += `- Гидравлический диаметр затрубья: ${(dHydAnnulus * 1000).toFixed(1)} мм\n`;
      ctx += `- Площадь затрубного сечения: ${(annArea * 10000).toFixed(2)} см²\n`;

      const allFluids: { name: string; density: number; pv: number; yp: number; flowRate?: number }[] = [];

      if (calcData?.drillingFluid) {
        allFluids.push({
          name: "Буровой раствор",
          density: calcData.drillingFluid.density,
          pv: calcData.drillingFluid.plasticViscosity || 25,
          yp: calcData.drillingFluid.yieldPoint || 25,
          flowRate: calcData.drillingFluid.flowRate,
        });
      }
      if (calcData?.buffers?.length) {
        calcData.buffers.forEach((b: any, i: number) => {
          allFluids.push({
            name: `Буфер ${i + 1}`,
            density: b.density,
            pv: b.plasticViscosity || 25,
            yp: b.yieldPoint || 25,
            flowRate: b.flowRate,
          });
        });
      }
      if (calcData?.slurries?.length) {
        calcData.slurries.forEach((s: any, i: number) => {
          allFluids.push({
            name: s.name || `Раствор ${i + 1}`,
            density: s.density,
            pv: s.plasticViscosity || (s.density >= 1650 ? 80 : 65),
            yp: s.yieldPoint || (s.density >= 1650 ? 8 : 6),
            flowRate: s.flowRate,
          });
        });
      }

      // Try typical flow rates if not provided: 8, 12, 16, 20 л/с
      const defaultRates = [8, 12, 16, 20];

      ctx += `\n| Жидкость | Плотность (кг/м³) | ПВ (мПа·с) | ДНС (Па) | Расход (л/с) | Скорость (м/с) | Re | Режим |\n`;
      ctx += `|---|---|---|---|---|---|---|---|\n`;

      for (const f of allFluids) {
        const rates = f.flowRate ? [f.flowRate] : defaultRates;
        for (const rate of rates) {
          const qM3s = rate / 1000;
          const velocity = qM3s / annArea;
          const { re, regime } = calcReynolds(f.density, velocity, dHydAnnulus, f.pv, f.yp);
          ctx += `| ${f.name} | ${f.density} | ${f.pv} | ${f.yp} | ${rate} | ${velocity.toFixed(2)} | ${re} | ${regime} |\n`;
        }
      }

      // Recommendation
      ctx += `\nПримечание: для качественного вытеснения рекомендуется турбулентный режим (Re > 3000). `;
      ctx += `При невозможности — переходный (Re 2100–3000) с увеличением времени контакта буфера.\n`;
    }
  }
  if (calcData?.slurries?.length) {
    ctx += `\n## Тампонажные растворы:\n`;
    calcData.slurries.forEach((s: any, i: number) => {
      ctx += `- Раствор ${i + 1}: ${s.name || "Без названия"}, плотность ${s.density} кг/м³, объём ${s.volume?.toFixed(2) || "?"} м³\n`;
      if (s.yieldPoint) ctx += `  ДНС: ${s.yieldPoint} Па, ПВ: ${s.plasticViscosity || "?"} мПа·с\n`;
    });
  }
  if (calcData?.buffers?.length) {
    ctx += `\n## Буферные жидкости:\n`;
    calcData.buffers.forEach((b: any, i: number) => {
      ctx += `- Буфер ${i + 1}: плотность ${b.density} кг/м³, объём ${b.volume?.toFixed(2) || "?"} м³\n`;
      if (b.yieldPoint) ctx += `  ДНС: ${b.yieldPoint} Па, ПВ: ${b.plasticViscosity || "?"} мПа·с\n`;
    });
  }
  if (calcData?.drillingFluid) {
    ctx += `\n## Буровой раствор: плотность ${calcData.drillingFluid.density} кг/м³\n`;
    if (calcData.drillingFluid.yieldPoint) ctx += `  ДНС: ${calcData.drillingFluid.yieldPoint} Па, ПВ: ${calcData.drillingFluid.plasticViscosity || "?"} мПа·с\n`;
  }
  // Inclination / trajectory data
  if (calcData?.inclination?.length) {
    ctx += `\n## Инклинометрия (траектория скважины):\n`;
    ctx += `| Глубина MD (м) | Зенитный угол (°) | Азимут (°) | DLS (°/30м) | Влияние на заполнение |\n`;
    ctx += `|---|---|---|---|---|\n`;
    const incl = calcData.inclination;
    for (let i = 0; i < incl.length; i++) {
      const p = incl[i];
      const dls = i > 0 && incl[i - 1]
        ? (Math.abs((p.inclination || 0) - (incl[i - 1].inclination || 0)) / Math.max(1, (p.md || 0) - (incl[i - 1].md || 0)) * 30).toFixed(1)
        : "—";
      const angle = p.inclination || p.zenith || 0;
      let impact = "нормальное";
      if (angle > 60) impact = "⚠ горизонтальный — высокий риск каналообразования, сегрегация цемента";
      else if (angle > 30) impact = "⚠ наклонный — риск неполного вытеснения с нижней стороны";
      else if (angle > 15) impact = "умеренно наклонный — рекомендуется контроль центрации";
      ctx += `| ${p.md || "?"} | ${angle.toFixed(1)} | ${(p.azimuth || 0).toFixed(1)} | ${dls} | ${impact} |\n`;
    }
  }

  // Centralization with correlation to angles
  if (calcData?.centralizationResults?.length) {
    const results = calcData.centralizationResults;
    const avg = results.reduce((s: number, r: any) => s + r.standoff, 0) / results.length;
    const min = Math.min(...results.map((r: any) => r.standoff));
    const max = Math.max(...results.map((r: any) => r.standoff));
    ctx += `\n## Центрирование:\n`;
    ctx += `- Средний стандофф: ${avg.toFixed(1)}%\n`;
    ctx += `- Мин / Макс: ${min.toFixed(1)}% / ${max.toFixed(1)}%\n`;

    // Detailed table
    ctx += `\n| Глубина (м) | Стандофф (%) | Зенитный угол (°) | Оценка заполнения |\n`;
    ctx += `|---|---|---|---|\n`;
    for (const r of results) {
      const angle = r.inclination || r.zenith || 0;
      let fillAssessment = "хорошее";
      if (r.standoff < 50) {
        fillAssessment = angle > 30 ? "⚠ КРИТИЧЕСКОЕ — канал на нижней стенке" : "⚠ плохое — вероятны каналы";
      } else if (r.standoff < 67) {
        fillAssessment = angle > 30 ? "⚠ неудовлетворительное — риск неполного заполнения" : "удовлетворительное";
      }
      ctx += `| ${r.depth} | ${r.standoff.toFixed(1)} | ${angle.toFixed?.(1) || "—"} | ${fillAssessment} |\n`;
    }

    const poor = results.filter((r: any) => r.standoff < 67);
    if (poor.length) {
      ctx += `\n⚠ Зон с стандоффом < 67%: ${poor.length} — рекомендуется увеличить количество центраторов\n`;
      const critical = results.filter((r: any) => r.standoff < 50);
      if (critical.length) {
        ctx += `⚠ КРИТИЧЕСКИХ зон (стандофф < 50%): ${critical.length} — высокий риск каналообразования\n`;
      }
    }

    // Displacement efficiency estimate based on standoff
    ctx += `\n## Оценка эффективности вытеснения:\n`;
    ctx += `| Стандофф (%) | Ожидаемая эффективность вытеснения | Качество заполнения |\n`;
    ctx += `|---|---|---|\n`;
    ctx += `| > 80% | 90–98% | Отличное |\n`;
    ctx += `| 67–80% | 80–90% | Хорошее |\n`;
    ctx += `| 50–67% | 60–80% | Удовлетворительное |\n`;
    ctx += `| < 50% | < 60% | Неудовлетворительное — каналы |\n`;
    ctx += `\nПо данным центрирования средний стандофф ${avg.toFixed(1)}% → ожидаемая эффективность вытеснения ~${avg > 80 ? "90–98" : avg > 67 ? "80–90" : avg > 50 ? "60–80" : "<60"}%\n`;
  }
  return ctx;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { documentFiles, calcData } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const calcContext = buildCalcContext(calcData);

    let docsContext = "";
    const usesOwnProgram = calcData?.useOwnProgram !== false;

    if (usesOwnProgram && calcData) {
      docsContext += `\n## Программа цементирования (данные расчёта):\n${calcContext}\n`;
    }

    const extractionErrors: string[] = [];

    if (documentFiles) {
      const labels: Record<string, string> = {
        akc: "АКЦ/СГДТ (геофизические данные качества цементирования)",
        program: "Программа цементирования",
        report: "Отчёт/рапорт по цементированию",
      };

      for (const [docType, fileData] of Object.entries(documentFiles)) {
        if (docType === "other" && Array.isArray(fileData)) {
          for (const otherFile of fileData as any[]) {
            const text = await extractTextFromFile(otherFile, LOVABLE_API_KEY);
            docsContext += `\n## Документ: ${otherFile.name}:\n${text.substring(0, 20000)}\n`;
          }
        } else if (Array.isArray(fileData)) {
          // Multiple files for same type (e.g. multiple AKC files)
          for (const singleFile of fileData as any[]) {
            const text = await extractTextFromFile(singleFile, LOVABLE_API_KEY);
            if (text.startsWith("[Не удалось")) {
              extractionErrors.push(singleFile.name);
            }
            docsContext += `\n## ${labels[docType] || docType} — ${singleFile.name}:\n${text.substring(0, 20000)}\n`;
          }
        } else {
          const file = fileData as { base64: string; mimeType: string; name: string };
          const text = await extractTextFromFile(file, LOVABLE_API_KEY);
          if (text.startsWith("[Не удалось")) {
            extractionErrors.push(file.name);
          }
          docsContext += `\n## ${labels[docType] || docType} — ${file.name}:\n${text.substring(0, 20000)}\n`;
        }
      }
    }

    if (extractionErrors.length > 0) {
      docsContext += `\n## ВНИМАНИЕ: Не удалось полностью распознать файлы: ${extractionErrors.join(", ")}. Рекомендуется конвертировать в PDF.\n`;
    }

    const systemPrompt = `Ты — виртуальный инженерный помощник DeAllsoft по анализу качества цементирования скважин.

ГЛАВНЫЕ ПРАВИЛА:
- Минимум лишних слов, МАКСИМУМ фактов, цифр и конкретики
- Используй таблицы (markdown) для сравнений, интервалов, План vs Факт
- Конкретные глубины, значения амплитуд, проценты, давления
- Структурируй по разделам с заголовками ##
- НЕ ПРОПУСКАЙ данные АКЦ/СГДТ — это ГЛАВНЫЙ источник оценки качества!
- Привязывай качество к фактическим действиям: объясняй ПОЧЕМУ хорошо или плохо (конкретные причины)
- ДОПОЛНИТЕЛЬНЫЕ ДОКУМЕНТЫ — изучай их ДОСКОНАЛЬНО, каждый факт, каждую цифру. Они могут содержать критически важную информацию (ГТИ, лабораторные протоколы, рапорта, моделирование и т.д.)

ТОНАЛЬНОСТЬ:
- Сухой, фактический, инженерный стиль. Без эмоций, без комплиментов, без сглаживания.
- НИКОГДА не хвали и не используй слова: "отлично", "прекрасно", "грамотно подобрано", "профессионально", "молодцы". Это НЕ оценочный отчёт — это ТЕХНИЧЕСКИЙ анализ.
- Если параметр в норме — пиши: "соответствует плану", "в пределах допуска", "отклонений нет".
- Если параметр НЕ в норме — пиши: "отклонение X% от плана. Причина: ... Следствие: ..."
- Формулировки: "рекомендуется", "целесообразно рассмотреть" — без директив "требуется", "необходимо".
- Каждый факт — причина и следствие. Никаких общих фраз.
- Тон — нейтральный, объективный, строго по данным.

ОБЯЗАТЕЛЬНЫЕ РАЗДЕЛЫ ОТЧЁТА:

## 1. Оценка качества сцепления (АКЦ/СГДТ/CBL-VDL)
КРИТИЧЕСКИ ВАЖНЫЙ РАЗДЕЛ! Если предоставлены данные АКЦ/СГДТ:
| Интервал (м) | Амплитуда CBL (мВ) | Контакт Ц-К | Контакт Ц-П | Качество | Причина оценки |
Обязательно анализируй:
- Кривые CBL: амплитуды по глубинам, пороговые значения
- VDL: наличие сигнала от пласта, характер волновой картины
- Зоны хорошего, удовлетворительного и плохого сцепления с конкретными глубинами
- Микрозазоры, каналы, эксцентриситет
- Корреляцию с центрацией колонны и кавернозностью
- ДЛЯ КАЖДОГО ИНТЕРВАЛА — объясни ПОЧЕМУ такое качество (низкая центрация? каверна? контаминация? недостаточный расход?)
- Интервалы с хорошим качеством — констатируй факт: "соответствует плану"

## 2. Анализ центрирования
РАССЧИТАЙ стандофф по интервалам на основе данных:
| Интервал (м) | Зенитный угол (°) | Стандофф (%) | Оценка | Рекомендация |
- Зоны с низким стандоффом (<67%) — КОНКРЕТНЫЕ рекомендации: тип и количество центраторов
- Совпадение зон плохого стандоффа с плохим качеством сцепления по АКЦ
- Если стандофф < 50% — КРИТИЧЕСКАЯ рекомендация по дополнительным центраторам
- Влияние зенитного угла на прогиб колонны и качество замещения
- Если центрация >80% — констатируй: "в пределах допуска, отклонений нет"

## 3. Лабораторные испытания тампонажных растворов
КРИТИЧЕСКИ ВАЖНЫЙ РАЗДЕЛ! Досконально анализируй все лабораторные данные:

### 3.1 Водоотдача (Fluid Loss)
| Раствор | Водоотдача (мл/30мин) | Норматив | Оценка |
- Допустимая водоотдача для данных условий (обычно <100 мл/30мин для хвостовиков, <200 для кондукторов)
- Влияние высокой водоотдачи на формирование фильтрационной корки, потерю текучести и закупорку каналов
- Если водоотдача в норме — "в пределах допуска"

### 3.2 Водоотделение (Free Water / Free Fluid)
| Раствор | Водоотделение (мл) | Норматив | Оценка |
- Для наклонных скважин (>30°) водоотделение КРИТИЧНО — допуск обычно 0 мл
- Для вертикальных — до 3.5 мл допустимо (по ГОСТ)
- Водоотделение приводит к образованию водяных каналов в наклонных и горизонтальных участках
- Если водоотделение = 0 — "соответствует требованиям для данного типа скважины"

### 3.3 Реология лабораторная
| Раствор | PV (мПа·с) | YP (Па) | СНС 10с/10мин (Па) | Растекаемость (мм) | Температура теста (°C) | Давление теста (МПа) |
- Соответствие реологии условиям скважины (температура, давление)
- Изменение реологии при забойных условиях vs при поверхностных
- Растекаемость: >180 мм — хорошая прокачиваемость
- Если реология соответствует условиям — "в допуске"

### 3.4 Время загустевания / консистенция (Thickening Time)
| Раствор | Время загустевания (ч:мин) | Время операции (ч:мин) | Запас (%) | Оценка |
- Как изменяется консистенция раствора во времени (кривая консистенции)
- Начальная консистенция (Bc): должна быть <30 Bc для прокачиваемости
- Момент резкого нарастания консистенции (>70 Bc) — это время загустевания
- Запас времени = (время загустевания - время операции) / время операции × 100%
- Рекомендуемый запас: мин. 25% (безопасное время = 0.75 × время загустевания)
- ПРОВЕРЬ: соответствуют ли условия теста (температура, давление) фактическим забойным условиям!
  Если в лаб. тесте температура 60°C, а забойная 90°C — результат НЕ ПРИМЕНИМ!

### 3.5 Плотность лабораторная
| Раствор | Плотность в рецептуре (кг/м³) | Плотность в лаб. тесте (кг/м³) | Плотность в программе (кг/м³) | Отклонение | Оценка |
- Сопоставь плотность из лаб. протокола с плотностью в программе цементирования
- Допустимое отклонение: ±20 кг/м³
- Если совпадает — "плотности согласованы"

### 3.6 Соответствие условий тестирования
| Параметр | Скважинные условия | Условия лаб. теста | Соответствие |
- Температура: забойная vs температура теста загустевания
- Давление: забойное vs давление теста
- Если условия теста НЕ соответствуют скважинным — это серьёзное замечание
- Если соответствуют — "условия теста соответствуют скважинным"

### 3.7 Рецептура и добавки
| Компонент | Рецептура в лаб. тесте | Рецептура в программе | Совпадение |
- Сверь состав (цемент, реагенты, добавки) между лабораторным протоколом и программой цементирования
- Проверь дозировки реагентов
- Проверь водоцементное отношение (В/Ц)
- Несовпадение рецептуры лаб. теста и программы — КРИТИЧЕСКОЕ замечание!
- Если рецептура согласована — "рецептура согласована между лабораторией и программой"

## 4. Реология и совместимость жидкостей
| Жидкость | Плотность (кг/м³) | ПВ (мПа·с) | ДНС (Па) | СНС 10с/10мин | Оценка |
- Буровой раствор: реологические параметры, соответствие условиям
- Буферная жидкость: совместимость с буровым раствором и цементом, достаточность объёма
- Тампонажный раствор: соответствие температуре и давлению забоя
- КРИТИЧНО — иерархия плотностей в затрубном пространстве: буровой раствор < буфер < цемент. Нарушение иерархии ведёт к прошиванию (гравитационному проникновению лёгкой жидкости через тяжёлую)
- Иерархия реологии: для эффективного вытеснения рекомендуется ПВ и ДНС цемента ВЫШЕ бурового раствора
- ВАЖНО: продавочная жидкость НЕ контактирует с цементом напрямую (разделена продавочной пробкой), поэтому её плотность влияет только на давление на агрегате, а НЕ на иерархию вытеснения в затрубье
- Время загустевания vs время операции — есть ли запас?
- Водоотдача, растекаемость, контракция
- Если иерархия плотностей и реологии соблюдена — ПОХВАЛИ проектировщика

## 5. Анализ расходов и режимов закачки
| Этап | Расход (л/с) | Давление на агрегате (МПа) | Объём (м³) | Скорость в затрубье (м/с) | Re | Режим потока |
- Расход на каждом этапе: достаточен ли для турбулентного режима?
- Скорость восходящего потока в затрубье — рассчитай для каждого интервала
- Режим потока: ламинарный (<2100 Re) / переходный / турбулентный (>3000 Re)
- Если ламинарный — рекомендация по увеличению расхода или применению пачки-разделителя
- Время контакта буфера со стенками — достаточно ли (рекомендуется мин. 10 мин)?
- Давление на агрегате (ЦА) — оценка нагрузки на оборудование по этапам
- Если расходы обеспечивают турбулентный режим — ОТМЕТЬ как положительный фактор

## 6. Анализ давлений и риск ГРП
| Точка контроля | Забойное давление (МПа) | Градиент ГРП (МПа) | Запас (%) | Оценка |
- Забойное давление (гидростатика + потери на трение) на каждом этапе
- ECD (эквивалентная циркуляционная плотность) — рассчитай если есть данные
- Сопоставь забойные давления с градиентом ГРП: башмак предыдущей колонны и слабые пласты
- Если забойное давление > 80% от давления ГРП — рекомендуется обратить внимание
- Давление «СТОП» на агрегате — соответствует ли расчётному?
- Сопоставь с моделированием из программы (если есть)

## 7. Анализ диаграмм и графиков
Если есть диаграммы закачки, ГТИ, СКЦ:
- ДОСКОНАЛЬНО разбери КАЖДУЮ кривую: что показывает, единицы, значения
- Давления на каждом этапе закачки — ЧИСЛА
- Расходы и объёмы по этапам — ЧИСЛА
- Аномалии, скачки давления, провалы расхода — причины
- Сопоставь с моделированием из программы цементирования

## 8. Анализ траектории и углов
Если есть данные об отходах и зенитных углах:
| Глубина (м) | Зенитный угол (°) | Азимут (°) | DLS (°/30м) | Влияние на цементирование |
- Наклонные участки (>30°) — риск неполной замены, сегрегация
- Горизонтальные участки (>60°) — КРИТИЧЕСКИЙ риск каналообразования
- DLS > 3°/30м — риск износа центраторов и нарушения центрации
- Корреляция углов с данными АКЦ

## 9. Верификация программы цементирования
СВЕРЬ программу цементирования с планами на спуск и крепление:
| Параметр | Программа цементирования | План на спуск/крепление | Совпадение | Комментарий |
- Глубина спуска, тип колонны, диаметры
- Интервалы цементирования, высота подъёма цемента
- Рецептура растворов — СРАВНИ с лабораторными тестами
- Объёмы растворов и буферов
- Режимы закачки (расходы, давления)
- Оснастка (центраторы, скребки, башмаки)
- Если программа согласована с планами — ПОХВАЛИ за системный подход
- Несовпадения — отметь конкретно что отличается

## 10. ПЛАН vs ФАКТ
| Параметр | План | Факт | Отклонение | Оценка |
Объёмы растворов, плотности, давления, режимы закачки, расходы, время операций.
Сопоставь с моделированием (ECD, давления, скорости).
- Каждое отклонение >10% — объяснение причины и влияния на качество
- Если факт совпадает с планом — ОТЛИЧНО, отметь хорошую реализацию

## 11. Корневые причины дефектов
Для КАЖДОГО проблемного интервала — КОНКРЕТНАЯ причинно-следственная цепочка:
| Интервал (м) | Дефект | Причина | Подтверждение | Влияние |
- Низкая центрация → канал → плохой контакт Ц-К/Ц-П
- Недостаточный расход → ламинарный режим → неполное вытеснение
- Малый объём буфера → контаминация → ухудшение свойств цемента
- Несоответствие реологии → плохое вытеснение → каналы
- Давление > ГРП → поглощение → потеря цемента
- Несоответствие рецептуры лаб. теста и программы → непредсказуемое поведение раствора

## 12. Положительные аспекты
ОБЯЗАТЕЛЬНЫЙ РАЗДЕЛ! Отметь ВСЕ что было сделано хорошо:
| № | Положительный аспект | Обоснование | Влияние на качество |
- Грамотный подбор рецептуры (если лаб. тесты подтверждают)
- Хорошая центрация (если стандофф > 80%)
- Турбулентный режим (если расходы обеспечивают Re > 3000)
- Соблюдение иерархии плотностей
- Адекватный запас времени загустевания
- Водоотделение = 0 для наклонной скважины
- Согласованность рецептуры между лабораторией и программой
- Соответствие условий тестирования забойным условиям
- Любые другие профессиональные решения

## 13. Мероприятия по улучшению
КОНКРЕТНЫЕ инженерные мероприятия с обоснованием:
| № | Мероприятие | Обоснование | Ожидаемый эффект |
Категории:
- Центрирование: тип, количество, расстановка центраторов
- Реология: корректировка параметров буровых и тампонажных растворов
- Режимы закачки: оптимальные расходы для турбулентного режима
- Буферные жидкости: объёмы, составы, время контакта
- Подготовка ствола: промывка, проработка, кондиционирование
- Лабораторные тесты: какие дополнительные испытания провести, при каких условиях
- Контроль: рекомендации по мониторингу процесса
- Верификация рецептуры: рекомендации по согласованию лаб. данных и программы

## 14. Итоговая оценка
ОТЛИЧНО / ХОРОШО / УДОВЛЕТВОРИТЕЛЬНО / НЕУДОВЛЕТВОРИТЕЛЬНО — с ОБОСНОВАНИЕМ.
Привяжи оценку к конкретным фактам: какие факторы сработали хорошо, какие — плохо.
Процент интервала с хорошим/удовл./плохим качеством сцепления.
БАЛАНС: обязательно укажи и сильные стороны, и зоны для улучшения.`;

    const userMessage = `Проанализируй качество цементирования на основе всех предоставленных данных.
${calcContext}
${docsContext}

ВАЖНО: 
- Данные АКЦ/СГДТ — ГЛАВНЫЙ приоритет! Не пропускай!
- ЛАБОРАТОРНЫЕ ТЕСТЫ — анализируй ДОСКОНАЛЬНО: водоотдачу, водоотделение, реологию, плотность, консистенцию (время загустевания), растекаемость
- ПРОВЕРЬ соответствие условий лаб. тестов (температура, давление) забойным условиям скважины!
- СВЕРЬ рецептуру лаб. теста с рецептурой в программе цементирования — любое расхождение КРИТИЧНО!
- СВЕРЬ программу цементирования с планами на спуск и крепление обсадной колонны
- Графики и диаграммы анализируй ДОСКОНАЛЬНО — каждую кривую, каждое значение, каждый расход
- Дополнительные документы изучай ДОСКОНАЛЬНО — каждый факт, каждую цифру, каждый протокол
- Сопоставляй: АКЦ ↔ центрация ↔ реология ↔ расходы ↔ давления ↔ программа ↔ факт ↔ лаб.тесты
- РАССЧИТАЙ стандофф, режимы потока (Re), ECD где возможно
- Сравни давления с градиентом ГРП
- Привязывай качество к ФАКТИЧЕСКИМ действиям: объясни ПОЧЕМУ хорошо или плохо
- ОБЯЗАТЕЛЬНО отмечай ПОЛОЖИТЕЛЬНЫЕ аспекты — хвали грамотные решения!
- В конце — КОНКРЕТНЫЕ мероприятия с обоснованием
- Дай структурированный инженерный отчёт с таблицами (14 разделов).`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Превышен лимит запросов. Подождите минуту." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Необходимо пополнить баланс." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "Ошибка сервиса анализа" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("analyze-cement error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
