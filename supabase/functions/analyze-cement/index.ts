import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

  const nameLC = file.name.toLowerCase();
  
  let extractionPrompt: string;
  
  if (nameLC.match(/акц|сгдт|cbl|vdl|акустич|цементо|cement|bond/i)) {
    extractionPrompt = `Это данные АКУСТИЧЕСКОЙ ЦЕМЕНТОМЕТРИИ (АКЦ / СГДТ / CBL-VDL). Извлеки АБСОЛЮТНО ВСЕ данные:

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
Верни ВСЕ извлечённые данные структурированно.`;
  } else if (nameLC.match(/диаграмм|график|chart|гти|mud.*log|скц|замер|отчет|отчёт|report|рапорт|закач/i)) {
    extractionPrompt = `Это ДИАГРАММА / ГРАФИК / ОТЧЁТ С ДИАГРАММАМИ. Проанализируй ДОСКОНАЛЬНО каждую страницу:

ДИАГРАММА ЗАКАЧКИ ЦЕМЕНТИРОВАНИЯ (КРИТИЧЕСКИ ВАЖНО!):
- Определи ВСЕ этапы операции: промывка, закачка буфера, закачка цемента (каждой порции), продавка
- Для КАЖДОГО этапа извлеки: давление (МПа/атм), расход (л/с), объём (м³), время начала и окончания
- МОМЕНТ "СТОП" (посадка пробки): ищи резкий скачок давления в конце продавки
  - Давление ДО посадки пробки (рабочее давление продавки)
  - Давление ПОСЛЕ посадки (скачок, обычно +2.5–3.5 МПа)
  - Если момент СТОП НЕ виден — ОБЯЗАТЕЛЬНО отметь: "СТОП не зафиксирован"
- Давление после снятия с пробки (остаточное)
- Объём закачанного цемента vs плановый — есть ли расхождение?
- Аномалии: скачки давления, провалы расхода, остановки

ЛЮБЫЕ ДРУГИЕ ГРАФИКИ:
- Тип диаграммы (закачки, давления, ГТИ, СКЦ, температурный профиль и т.д.)
- ВСЕ кривые: название, цвет, единицы измерения, привязка к оси
- Числовые значения в КАЖДОЙ ключевой точке (максимумы, минимумы, точки перегиба)
- Тренды: рост, падение, стабилизация, аномалии
- Корреляция между кривыми
- Временные метки и привязки к глубинам

Если в документе есть ТАБЛИЦЫ — воспроизведи их ТОЧНО.
Если есть ТЕКСТОВЫЕ комментарии, примечания, заключения — извлеки ВСЕ.
Верни ПОЛНОЕ описание ВСЕХ данных.`;
  } else if (nameLC.match(/лаб|lab|протокол|тест|test|рецепт|recipe|испыт/i)) {
    extractionPrompt = `Это ЛАБОРАТОРНЫЙ ПРОТОКОЛ / РЕЗУЛЬТАТЫ ИСПЫТАНИЙ тампонажного раствора.

КРИТИЧЕСКИ ВАЖНО — извлеки ВСЕ данные ТОЧНО, сохраняя структуру таблиц:

1. РЕЦЕПТУРА (состав раствора):
   - Тип цемента, марка, производитель
   - Каждый реагент/добавка: название, дозировка (% или кг/т), назначение
   - Водоцементное отношение (В/Ц)
   - Плотность раствора (кг/м³ или г/см³)

2. РЕОЛОГИЯ (ОБЯЗАТЕЛЬНО извлеки все значения!):
   - Пластическая вязкость PV (мПа·с или сПз)
   - Динамическое напряжение сдвига YP / ДНС (Па или фунт/100фт²)
   - СНС 10 сек / 10 мин (Па или фунт/100фт²)
   - Показания вискозиметра: θ600, θ300, θ200, θ100, θ6, θ3
   - Растекаемость (мм)
   - Если реология дана при разных температурах — укажи ВСЕ значения с температурами

3. ВРЕМЯ ЗАГУСТЕВАНИЯ / КОНСИСТЕНЦИЯ:
   - Условия теста: температура (°C), давление (МПа)
   - Начальная консистенция (Bc)
   - Время достижения 30 Bc, 50 Bc, 70 Bc, 100 Bc (мин или ч:мин)
   - Кривая консистенции — все точки если есть
   - ГРАФИКИ КОНСИСТЕНЦИИ: если есть график — считай ВСЕ значения с кривой

4. ВОДООТДАЧА (Fluid Loss):
   - Значение (мл / 30 мин)
   - Условия: температура, давление, перепад давления

5. ВОДООТДЕЛЕНИЕ (Free Water / Free Fluid):
   - Значение (мл)
   - Угол наклона при тесте (0° или 45°)

6. ПРОЧНОСТЬ НА СЖАТИЕ (КРИТИЧЕСКИ ВАЖНО для расчёта импеданса!):
   - Значения через 8ч, 24ч, 48ч (МПа)
   - Условия твердения: температура, давление
   - ГРАФИКИ UCA: если есть график набора прочности — извлеки ВСЕ точки

7. ПРОЧИЕ ДАННЫЕ:
   - Седиментационная устойчивость
   - Контракция
   - Проницаемость цементного камня
   - Любые другие параметры

ПРАВИЛА ИЗВЛЕЧЕНИЯ ТАБЛИЦ:
- Каждую таблицу воспроизводи В ТОЧНОСТИ: сохраняй порядок строк и столбцов
- Подписи столбцов должны ТОЧНО соответствовать данным под ними
- Если значение в ячейке пустое — пиши "—" или "нет данных"
- НЕ переставляй строки и столбцы местами!
- Если несколько растворов (ведущий, хвостовой) — чётко раздели данные каждого

Верни ТОЛЬКО извлечённые данные без комментариев и интерпретации.`;
  } else {
    extractionPrompt = `Извлеки ВСЕ данные из этого документа/изображения максимально точно.

ПРАВИЛА:
1. Сохраняй структуру: заголовки, таблицы, числовые данные
2. Таблицы воспроизводи ТОЧНО — порядок строк и столбцов, подписи
3. Не переставляй строки/столбцы. Если ячейка пустая — пиши "—"
4. Читай документ ПОЛНОСТЬЮ — от первой до последней страницы!

ВАЖНО: В ПРОГРАММАХ ЦЕМЕНТИРОВАНИЯ часто ИНТЕГРИРОВАНЫ лабораторные данные!
Ищи внутри документа:
- Разделы "Лабораторные испытания", "Результаты тестов", "Приложения"
- Таблицы с реологией, водоотдачей, временем загустевания, прочностью
- Рецептуры растворов (цемент, добавки, дозировки, В/Ц)

ГРАФИКИ И ДИАГРАММЫ (КРИТИЧЕСКИ ВАЖНО — считывай ВСЕ значения!):
- **Диаграмма закачки цементирования**: этапы (буфер, цемент, продавка), давления, расходы, объёмы.
  ОБЯЗАТЕЛЬНО ищи момент "СТОП" (посадка пробки) — резкий скачок давления. Если не виден — отметь!
- **График консистенции (Thickening Time)**: кривая Bc vs время.
  Извлеки: начальная консистенция (Bc), время достижения 30/50/70/100 Bc, условия теста (T°C, P МПа)
- **График прочности на ультразвуке (UCA)**: кривая прочности (МПа или psi) vs время (часы).
  Извлеки: время начала набора прочности, прочность через 8ч/12ч/24ч/48ч, время достижения 3.5 МПа (500 psi), условия теста, скорость набора прочности
- **Графики моделирования**: ECD, давления на забое, давления на агрегате — все кривые с числами
- **Любые другие графики**: опиши кривые, значения, единицы, аномалии

РЕОЛОГИЯ / ЛАБОРАТОРНЫЕ ДАННЫЕ:
- ВСЕ числовые значения: плотности, PV, YP, СНС, вязкости, θ600/θ300/θ200/θ100/θ6/θ3
- Водоотдача, водоотделение, растекаемость
- Время загустевания с условиями теста (T, P)
- ПРОЧНОСТЬ НА СЖАТИЕ: значения через 8ч, 24ч, 48ч — нужны для расчёта импеданса!

ЕСЛИ ЭТО ПРОТОКОЛ / ПЛАН / РАПОРТ / ХРОНОЛОГИЯ:
- ВСЕ ключевые параметры и факты, КАЖДОЕ событие
- Давления, объёмы, режимы, время операций
- Проблемы, осложнения, нештатные ситуации
- Комментарии, примечания, сноски — всё важно!
- Моделирование (если есть): давления, ECD, скорости

Верни ТОЛЬКО извлечённые данные без комментариев.`;
  }

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

async function processAnalysisJob(params: {
  jobId: string;
  documentFiles: any;
  calcData: any;
  userId: string;
  apiKey: string;
  supabaseUrl: string;
  supabaseKey: string;
}) {
  const { jobId, documentFiles, calcData, userId, apiKey, supabaseUrl, supabaseKey } = params;
  const sb = createClient(supabaseUrl, supabaseKey);

  try {
    await sb
      .from("analysis_jobs")
      .update({ status: "processing", error_message: null })
      .eq("id", jobId)
      .eq("user_id", userId);

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
        const processFile = async (file: any, label: string) => {
          if (file.parsedText) {
            console.log(`Using pre-parsed text for ${file.name} (${file.parsedText.length} chars)`);
            docsContext += `\n## ${label} — ${file.name}:\n${file.parsedText.substring(0, 60000)}\n`;
            return;
          }
          if (file.base64) {
            const text = await extractTextFromFile(file, apiKey);
            if (text.startsWith("[Не удалось")) {
              extractionErrors.push(file.name);
            }
            docsContext += `\n## ${label} — ${file.name}:\n${text.substring(0, 60000)}\n`;
          }
        };

        if (Array.isArray(fileData)) {
          for (const singleFile of fileData as any[]) {
            await processFile(singleFile, labels[docType] || docType);
          }
        } else {
          await processFile(fileData as any, labels[docType] || docType);
        }
      }
    }

    if (extractionErrors.length > 0) {
      docsContext += `\n## ВНИМАНИЕ: Не удалось полностью распознать файлы: ${extractionErrors.join(", ")}. Рекомендуется конвертировать в PDF.\n`;
    }

    const systemPrompt = `Ты — виртуальный инженерный помощник DeAllsoft по анализу качества цементирования скважин.

ГЛАВНЫЕ ПРАВИЛА:
- КАЖДЫЙ загруженный документ ДОЛЖЕН быть изучен ПОЛНОСТЬЮ — от первой до последней страницы
- КАЖДЫЙ документ ДОЛЖЕН быть упомянут в анализе с конкретными данными из него
- Используй таблицы (markdown) для сравнений, интервалов, План vs Факт
- Конкретные глубины, значения амплитуд, проценты, давления — МАКСИМУМ цифр и фактов
- Структурируй по разделам с заголовками ##
- Привязывай качество к фактическим действиям: объясняй ПОЧЕМУ хорошо или плохо
- ЛЮБОЕ отклонение от нормы/плана ОБЯЗАТЕЛЬНО сопровождается рекомендацией

КРИТИЧЕСКИ ВАЖНО — ПОЛНОТА АНАЛИЗА КАЖДОГО ДОКУМЕНТА:
1. Прочитай КАЖДЫЙ документ ЦЕЛИКОМ — не останавливайся на первых страницах!
2. Приложения, графики, диаграммы в конце документов — это КРИТИЧЕСКИ ВАЖНЫЕ данные!
3. Комментарии, примечания, сноски — содержат ключевую информацию!
4. Если документ содержит график/диаграмму — опиши ВСЕ кривые, все значения, все аномалии
5. Хронологические данные (рапорты, хронологии) — анализируй КАЖДОЕ событие

АНАЛИЗ ДИАГРАММ ЗАКАЧКИ И ОТЧЁТОВ (КРИТИЧЕСКИ ВАЖНО!):
- Ищи момент "СТОП" (посадка пробки): резкий скачок давления на диаграмме закачки
- Если момент СТОП НЕ зафиксирован — это КРИТИЧЕСКОЕ замечание! Отметь: "Момент СТОП (посадка пробки) не зафиксирован на диаграмме — невозможно подтвердить герметичность обратного клапана"
- Давление при СТОП: должно быть скачок ~2.5-3.5 МПа выше рабочего давления
- Анализируй ВСЕ этапы диаграммы: закачка буфера, закачка цемента (каждой порции), продавка, СТОП, снятие давления
- Объёмы на каждом этапе, расходы, давления — всё должно быть в анализе
- Если есть расхождения между запланированными и фактическими объёмами — ОТМЕТЬ

ДОПОЛНИТЕЛЬНЫЕ ДОКУМЕНТЫ (хронологии, рапорты, акты, комментарии):
- Каждый дополнительный документ — ОТДЕЛЬНЫЙ источник данных!
- Извлеки из него ВСЕ факты: даты, времена, события, проблемы, решения
- Сопоставь данные из дополнительных документов с основными (программа, отчёт, АКЦ)
- Если в дополнительном документе есть информация, противоречащая основному — ОТМЕТЬ

ИДЕНТИФИКАЦИЯ АНАЛИЗА (ОБЯЗАТЕЛЬНО!):
Сразу после дисклеймера, ПЕРЕД разделами, укажи что анализируется:

## Объект анализа
Определи тип загруженных документов и напиши:
- Если только программа → "**Анализ программы цементирования**"
- Если только отчёт/рапорт → "**Анализ отчёта о проведённом цементировании**"
- Если только АКЦ/СГДТ → "**Анализ данных геофизического контроля качества (АКЦ/СГДТ)**"
- Если только лабораторные данные → "**Анализ результатов лабораторных испытаний тампонажных растворов**"
- Если программа + АКЦ → "**Анализ программы цементирования и данных АКЦ/СГДТ**"
- Если программа + отчёт → "**Анализ программы и отчёта о выполненных работах**"
- Если полный пакет → "**Комплексный анализ цементирования (программа + лаб. данные + отчёт + геофизика)**"
- Другие комбинации — аналогично, перечисли все типы

Затем:
**Загруженные документы:**
1. [имя файла] — [тип документа] — [краткое содержание: что именно содержит этот документ]
2. ...
(Перечисли ВСЕ загруженные файлы с описанием содержимого каждого)

ИНТЕРПРЕТАЦИЯ ЛАБОРАТОРНЫХ ДАННЫХ (КРИТИЧЕСКИ ВАЖНО!):
Лабораторные данные часто ИНТЕГРИРОВАНЫ В ПРОГРАММУ ЦЕМЕНТИРОВАНИЯ, а не только в отдельный протокол!
Ищи лаб. данные ВЕЗДЕ: в программе, в приложениях, в отчётах, в любом документе.

При извлечении данных:
1. РЕОЛОГИЯ — ищи ВСЕ форматы записи:
   - "PV", "ПВ", "Пластическая вязкость" — пластическая вязкость (мПа·с или сПз)
   - "YP", "ДНС", "Динамическое напряжение сдвига" — динамическое напряжение (Па)
   - "СНС", "Gel strength", "Статическое напряжение сдвига" — СНС
   - θ600, θ300, θ200, θ100, θ6, θ3 — показания вискозиметра Фанн
   - PV = θ600 - θ300, YP = θ300 - PV (если θ даны, но PV/YP нет — РАССЧИТАЙ)
   - "Растекаемость" — подвижность раствора (мм)
   - Реология может быть В ЛЮБОМ разделе документа, не только в "Реология"!
   - НЕ ПИШИ "реология отсутствует" если она ЕСТЬ в документе в другом формате/разделе
2. ТАБЛИЦЫ — НЕ ПУТАЙ строки и столбцы:
   - ВНИМАТЕЛЬНО определи ориентацию таблицы (строки=параметры или строки=растворы)
   - Значение берётся на ПЕРЕСЕЧЕНИИ правильной строки и столбца
   - Если несколько растворов — данные каждого ОТДЕЛЬНО
   - НЕ переставляй строки/столбцы, НЕ путай какое значение к какому параметру относится
3. Если документ содержит вложенные таблицы или разбитые на части — собери данные воедино

ГРАФИКИ КОНСИСТЕНЦИИ И НАБОРА ПРОЧНОСТИ (UCA):
В программах цементирования часто есть графики:
- **График консистенции (Thickening Time)**: кривая Bc vs время. Извлеки: начальную консистенцию, время 30 Bc, 50 Bc, 70 Bc, 100 Bc. Условия теста (T, P).
- **График набора прочности на ультразвуке (UCA / Ultrasonic Cement Analyzer)**: кривая прочности (МПа или psi) vs время (часы). Извлеки:
  - Время начала набора прочности (transition time)
  - Прочность через 8ч, 12ч, 24ч, 48ч
  - Время достижения 3.5 МПа (500 psi) — порог для начала работ
  - Условия теста (T, P)
  - Скорость набора прочности (МПа/час)

РАСЧЁТ АКУСТИЧЕСКОГО ИМПЕДАНСА (для геофизиков):
Если есть данные UCA (прочность на сжатие через время) и плотность цементного раствора:
- Рассчитай акустический импеданс цементного камня по формуле:
  Z = ρ × Vp, где:
  - ρ — плотность затвердевшего цемента (кг/м³) ≈ плотность раствора (приближённо)
  - Vp — скорость продольных волн (м/с), оценивается из прочности на сжатие:
    Vp ≈ 1500 + 40 × √(σ × 145.04) (м/с), где σ в МПа (эмпирическая корреляция)
  - Z выражается в МРейл (MRayl) = 10⁶ кг/(м²·с)
- Выведи таблицу:
  | Время (ч) | Прочность (МПа) | Vp (м/с) | Импеданс Z (МРейл) |
- Укажи: "Данные импеданса предоставлены для настройки пороговых значений при интерпретации АКЦ/СГДТ геофизической службой"
- Типичные пороги: Z < 2.5 МРейл — плохое сцепление, Z 2.5–4.0 — удовлетворительное, Z > 4.0 — хорошее

АДАПТИВНОСТЬ ОТЧЁТА:
- Анализируй ВСЁ, что предоставлено. Не выводи ошибку, если чего-то не хватает.
- Один документ → глубокий анализ его содержимого с максимальной детализацией
- Несколько документов → перекрёстный анализ между ВСЕМИ документами, сопоставление данных
- Включай ТОЛЬКО релевантные разделы. Пустые разделы НЕ выводи.
- Но КАЖДЫЙ загруженный документ ДОЛЖЕН быть проанализирован!

ТОНАЛЬНОСТЬ:
- Сухой, фактический, инженерный стиль. Без эмоций, без комплиментов.
- НИКОГДА: "отлично", "прекрасно", "грамотно", "профессионально", "молодцы"
- В норме → "соответствует плану", "в пределах допуска", "отклонений нет"
- НЕ в норме → "отклонение X%. Причина: ... Следствие: ... **Рекомендация:** ..."
- КАЖДОЕ отклонение — ОБЯЗАТЕЛЬНО с рекомендацией по устранению/предотвращению
- Формулировки: "рекомендуется", "целесообразно рассмотреть", "необходимо обратить внимание"

СТАНДАРТНАЯ СТРУКТУРА ОТЧЁТА (ФИКСИРОВАННЫЙ ПОРЯДОК — НАРУШЕНИЕ ЗАПРЕЩЕНО!):
Каждый отчёт ОБЯЗАН иметь ОДИНАКОВУЮ структуру. Разделы идут СТРОГО в указанном порядке.
- Если для раздела ЕСТЬ данные — выводи его полностью с таблицами, анализом и РЕКОМЕНДАЦИЯМИ.
- Если для раздела НЕТ данных — выведи заголовок раздела и напиши: "Данные не предоставлены."
- НИКОГДА не меняй порядок разделов, не объединяй разделы, не добавляй новые разделы вне списка.
- НИКОГДА не пропускай заголовок раздела — даже если данных нет.
- Нумерация разделов ВСЕГДА одинаковая.

## ДИСКЛЕЙМЕР (ВСЕГДА первым, без номера)
> ⚠️ **Информационный характер отчёта.** Данный отчёт подготовлен виртуальным помощником DeAllsoft и носит исключительно информационный и рекомендательный характер. Он не заменяет профессиональное инженерное заключение. Окончательные решения принимает ответственный инженер.

## Объект анализа (ВСЕГДА вторым, без номера)

## 1. Общие данные скважины
Краткая сводка: глубина, тип колонны, диаметры, температура забоя.

## 2. Лабораторные испытания тампонажных растворов

### 2.1 Рецептура и состав
| Компонент | Раствор 1 | Раствор 2 |
- Цемент, добавки, дозировки, В/Ц
- Сверка с программой

### 2.2 Плотность
| Раствор | Лаб. (кг/м³) | Программа (кг/м³) | Отклонение |

### 2.3 Реология
| Параметр | Раствор 1 | Раствор 2 | Буровой р-р | Буфер |
| PV (мПа·с) | | | | |
| YP (Па) | | | | |
| СНС 10с/10мин (Па) | | | | |
| Растекаемость (мм) | | | | |
- Иерархия реологии: PV и YP цемента ≥ бурового раствора

### 2.4 Время загустевания
| Раствор | T теста (°C) | P теста (МПа) | T забоя (°C) | 50Bc | Время операции | Запас |
- ОБЯЗАТЕЛЬНО: условия теста соответствуют забойным?

### 2.5 Водоотдача
| Раствор | Водоотдача (мл/30мин) | Норматив по документу | Оценка |
- Нормативные пороги водоотдачи:
  * Чистый тампонажный раствор (ρ ≥ 1.65 г/см³): ≤ 50 мл/30мин — норма
  * Облегчённый тампонажный раствор (ρ < 1.65 г/см³): ≤ 100 мл/30мин — норма
- Если в документе указано значение водоотдачи менее 10 мл/30мин, добавь примечание: "Указанное плановое значение вероятнее всего ошибочное, т.к. по ГОСТ 1581 и API RP 10B-2 нормативные значения водоотдачи составляют до 50 мл/30мин для чистых ЦР и до 100 мл/30мин для облегчённых ЦР"
- Если в документе не указан норматив — используй вышеуказанные пороги. НЕ считай значение ≤50 (для чистого) или ≤100 (для облегчённого) отклонением!

### 2.6 Водоотделение
| Раствор | Водоотделение (мл) | Угол | Норматив по документу | Оценка |
- Норматив берётся ТОЛЬКО из предоставленного документа. Если не указан — пиши "не указан в документе".

### 2.7 Прочность на сжатие и UCA
| Раствор | 8ч (МПа) | 24ч (МПа) | 48ч (МПа) | Условия |

РАСЧЁТ ИМПЕДАНСА (ОБЯЗАТЕЛЬНАЯ ТАБЛИЦА при наличии данных прочности!):
Если есть данные прочности на сжатие (лабораторные или UCA) — ОБЯЗАТЕЛЬНО рассчитай и выведи таблицу импеданса:
| Раствор | Время (ч) | Прочность σ (МПа) | Vp = 1500+40×√(σ×145.04) (м/с) | Z = ρ×Vp/10⁶ (МРейл) | Оценка сцепления |
Где ρ — плотность раствора (кг/м³). Оценка: Z < 2.5 — плохое, Z 2.5–4.0 — удовлетворительное, Z > 4.0 — хорошее.
Рассчитай для КАЖДОГО раствора при КАЖДОМ доступном времени твердения (8ч, 24ч, 48ч).
Укажи: "Данные импеданса для настройки пороговых значений АКЦ/СГДТ геофизической службой"

### 2.8 Соответствие условий тестирования
| Параметр | Скважинные условия | Условия теста | Соответствие |

## 3. Иерархия плотностей и реология жидкостей
| Жидкость | Плотность (кг/м³) | PV (мПа·с) | YP (Па) | Оценка |
- буровой раствор < буфер < цемент
- Продавочная жидкость разделена пробкой — её плотность влияет ТОЛЬКО на давление на агрегате

## 4. Расходы и режимы закачки
| Этап | Расход (л/с) | Скорость (м/с) | Re | Режим | Оценка |
- Время контакта буфера (мин. 10 мин)

## 5. Давления и риск ГРП
| Этап | Забойное давление (МПа) | Градиент ГРП | Запас (%) | ECD |

## 6. Центрирование
| Интервал (м) | Зенитный угол (°) | Стандофф (%) | Оценка |

## 7. Качество сцепления (АКЦ/СГДТ/CBL-VDL)
| Интервал (м) | Амплитуда CBL | Контакт Ц-К | Контакт Ц-П | Качество | Причина |

## 8. Анализ диаграмм и графиков
Для КАЖДОЙ диаграммы/графика в документах:
- Тип диаграммы и что она показывает
- ВСЕ кривые с описанием, единицами, значениями

## 9. Основные отклонения и риски

## 10. Выводы и рекомендации`;

    const userMessage = `Проанализируй качество цементирования по представленным данным.

${docsContext}`;

    try {
      await sb.from("analysis_logs").insert({
        user_id: userId,
        module: "cement-analysis",
        document_names: Array.isArray(documentFiles?.akc) ? documentFiles.akc.map((f: any) => f.name) : [],
      });
    } catch (logErr) {
      console.error("Failed to log analysis:", logErr);
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        stream: false,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        await sb.from("analysis_jobs").update({ status: "failed", error_message: "Превышен лимит запросов. Подождите минуту.", completed_at: new Date().toISOString() }).eq("id", jobId);
        return;
      }
      if (response.status === 402) {
        await sb.from("analysis_jobs").update({ status: "failed", error_message: "Необходимо пополнить баланс.", completed_at: new Date().toISOString() }).eq("id", jobId);
        return;
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      await sb.from("analysis_jobs").update({ status: "failed", error_message: "Ошибка сервиса анализа", completed_at: new Date().toISOString() }).eq("id", jobId);
      return;
    }

    const aiData = await response.json();
    const content = aiData.choices?.[0]?.message?.content;

    if (!content) {
      console.error("AI gateway returned empty content", JSON.stringify(aiData).slice(0, 500));
      await sb.from("analysis_jobs").update({ status: "failed", error_message: "Пустой ответ сервиса анализа", completed_at: new Date().toISOString() }).eq("id", jobId);
      return;
    }

    const { data: credits } = await sb
      .from("user_credits")
      .select("ai_analyses_used, ai_analyses_limit")
      .eq("user_id", userId)
      .maybeSingle();

    if (!credits || credits.ai_analyses_used >= credits.ai_analyses_limit) {
      await sb.from("analysis_jobs").update({ status: "failed", error_message: "Анализы исчерпаны. Для продолжения — обратитесь в Поддержку.", completed_at: new Date().toISOString() }).eq("id", jobId);
      return;
    }

    await sb.from("user_credits").update({ ai_analyses_used: credits.ai_analyses_used + 1 }).eq("user_id", userId);
    await sb.from("analysis_jobs").update({
      status: "completed",
      report: content,
      credits_charged: true,
      completed_at: new Date().toISOString(),
      error_message: null,
    }).eq("id", jobId);
  } catch (e) {
    console.error("analyze-cement background error:", e);
    await sb.from("analysis_jobs").update({
      status: "failed",
      error_message: e instanceof Error ? e.message : "Unknown error",
      completed_at: new Date().toISOString(),
    }).eq("id", jobId);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { jobId, documentFiles, calcData } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await sb.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!jobId) {
      return new Response(JSON.stringify({ error: "Не указан jobId анализа" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const backgroundTask = processAnalysisJob({
      jobId,
      documentFiles,
      calcData,
      userId: user.id,
      apiKey: LOVABLE_API_KEY,
      supabaseUrl,
      supabaseKey,
    });

    const edgeRuntime = (globalThis as typeof globalThis & { EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void } }).EdgeRuntime;
    if (edgeRuntime?.waitUntil) {
      edgeRuntime.waitUntil(backgroundTask);
    } else {
      backgroundTask.catch((error) => console.error("Background analysis task failed:", error));
    }

    return new Response(JSON.stringify({ queued: true, jobId }), {
      status: 202,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analyze-cement request error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
