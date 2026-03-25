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
    });
  }
  if (calcData?.drillingFluid) {
    ctx += `\n## Буровой раствор: плотность ${calcData.drillingFluid.density} кг/м³\n`;
    if (calcData.drillingFluid.yieldPoint) ctx += `  ДНС: ${calcData.drillingFluid.yieldPoint} Па, ПВ: ${calcData.drillingFluid.plasticViscosity || "?"} мПа·с\n`;
  }
  if (calcData?.centralizationResults?.length) {
    const results = calcData.centralizationResults;
    const avg = results.reduce((s: number, r: any) => s + r.standoff, 0) / results.length;
    const min = Math.min(...results.map((r: any) => r.standoff));
    const max = Math.max(...results.map((r: any) => r.standoff));
    ctx += `\n## Центрирование:\n`;
    ctx += `- Средний стандофф: ${avg.toFixed(1)}%\n`;
    ctx += `- Мин / Макс: ${min.toFixed(1)}% / ${max.toFixed(1)}%\n`;
    const poor = results.filter((r: any) => r.standoff < 67);
    if (poor.length) {
      ctx += `- Зон с стандоффом < 67%: ${poor.length}\n`;
      poor.forEach((r: any) => ctx += `  · Глубина ${r.depth}м — стандофф ${r.standoff.toFixed(1)}%\n`);
    }
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

ОБЯЗАТЕЛЬНЫЕ РАЗДЕЛЫ ОТЧЁТА:

## 1. Оценка качества сцепления (АКЦ/СГДТ/CBL-VDL)
КРИТИЧЕСКИ ВАЖНЫЙ РАЗДЕЛ! Если предоставлены данные АКЦ/СГДТ:
| Интервал (м) | Амплитуда CBL (мВ) | Контакт Ц-К | Контакт Ц-П | Качество |
Обязательно анализируй:
- Кривые CBL: амплитуды по глубинам, пороговые значения
- VDL: наличие сигнала от пласта, характер волновой картины
- Зоны хорошего, удовлетворительного и плохого сцепления с конкретными глубинами
- Микрозазоры, каналы, эксцентриситет
- Корреляцию с центрацией колонны и кавернозностью

## 2. Анализ диаграмм и графиков
Если есть диаграммы закачки, ГТИ, СКЦ:
- ДОСКОНАЛЬНО разбери КАЖДУЮ кривую: что показывает, единицы, значения
- Давления на каждом этапе закачки
- Расходы и объёмы по этапам
- Аномалии, отклонения от плана
- Сопоставь с моделированием из программы цементирования (если есть)

## 3. Анализ центрирования
Стандофф по интервалам, влияние на каналообразование, корреляция с данными АКЦ.
Зоны с низким стандоффом (<67%) и их совпадение с плохим качеством сцепления.

## 4. Анализ траектории и углов
Если есть данные об отходах и зенитных углах — оцени влияние на качество цементирования.
В наклонных/горизонтальных участках — риск неполной замены бурового раствора.

## 5. Лабораторные данные и реология
Если предоставлены — проанализируй: плотность, растекаемость, водоотдачу, реологию (ПВ, ДНС), время загустевания.
Соответствие условиям скважины (температура, давление).

## 6. ПЛАН vs ФАКТ
| Параметр | План | Факт | Отклонение | Оценка |
Объёмы растворов, плотности, давления, режимы закачки, время операций.
Сопоставь с моделированием (ECD, давления, скорости) если данные доступны.

## 7. Корневые причины дефектов
Для КАЖДОГО проблемного интервала — конкретная причина:
- Низкая центрация (<67%), каверны, контаминация
- Недостаточная скорость продавки, малый объём буфера
- Температурный режим, несоответствие рецептуры

## 8. Рекомендации
Конкретные инженерные решения для улучшения качества на аналогичных скважинах.

## 9. Итоговая оценка
ОТЛИЧНО / ХОРОШО / УДОВЛЕТВОРИТЕЛЬНО / НЕУДОВЛЕТВОРИТЕЛЬНО — с обоснованием.`;

    const userMessage = `Проанализируй качество цементирования на основе всех предоставленных данных.
${calcContext}
${docsContext}

ВАЖНО: 
- Если есть данные АКЦ/СГДТ — это ГЛАВНЫЙ приоритет анализа! Не пропускай их!
- Графики и диаграммы анализируй ДОСКОНАЛЬНО — каждую кривую, каждое значение
- Сопоставляй данные между собой: АКЦ ↔ центрация ↔ программа ↔ факт
- Дай структурированный инженерный отчёт с таблицами.`;

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
