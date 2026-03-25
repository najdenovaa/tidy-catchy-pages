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
- Привязывай качество к фактическим действиям: объясняй ПОЧЕМУ хорошо или плохо (конкретные причины)

ТОНАЛЬНОСТЬ:
- НИКОГДА не пиши "требуется", "необходимо", "обязательно", "нужно обеспечить" — это пугает клиентов
- Вместо этого используй мягкие формулировки: "рекомендуется", "целесообразно", "предлагается", "желательно", "стоит рассмотреть", "рекомендуем обратить внимание"
- Ты не требуешь — ты анализируешь данные и даёшь профессиональные рекомендации
- Тон — уверенный, но дружелюбный и конструктивный

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

## 2. Анализ центрирования
РАССЧИТАЙ стандофф по интервалам на основе данных:
| Интервал (м) | Зенитный угол (°) | Стандофф (%) | Оценка | Рекомендация |
- Зоны с низким стандоффом (<67%) — КОНКРЕТНЫЕ рекомендации: тип и количество центраторов
- Совпадение зон плохого стандоффа с плохим качеством сцепления по АКЦ
- Если стандофф < 50% — КРИТИЧЕСКАЯ рекомендация по дополнительным центраторам
- Влияние зенитного угла на прогиб колонны и качество замещения

## 3. Реология и совместимость жидкостей
| Жидкость | Плотность (кг/м³) | ПВ (мПа·с) | ДНС (Па) | СНС 10с/10мин | Оценка |
- Буровой раствор: реологические параметры, соответствие условиям
- Буферная жидкость: совместимость с буровым раствором и цементом, достаточность объёма
- Тампонажный раствор: соответствие температуре и давлению забоя
- Иерархия плотностей (буровой < буфер < цемент) — соблюдена ли?
- Иерархия реологии: для эффективного вытеснения ПВ и ДНС цемента должны быть ВЫШЕ бурового раствора
- Время загустевания vs время операции — есть ли запас?
- Водоотдача, растекаемость, контракция

## 4. Анализ расходов и режимов закачки
| Этап | Расход (л/с) | Давление (МПа) | Объём (м³) | Скорость в затрубье (м/с) | Режим потока |
- Расход на каждом этапе: достаточен ли для турбулентного режима?
- Скорость восходящего потока в затрубье — рассчитай для каждого интервала
- Режим потока: ламинарный (<2100 Re) / переходный / турбулентный (>3000 Re)
- Если ламинарный — рекомендация по увеличению расхода или применению пачки-разделителя
- Время контакта буфера со стенками — достаточно ли (мин. 10 мин)?

## 5. Анализ давлений и риск ГРП
| Точка контроля | Давление (МПа) | Градиент ГРП (МПа) | Запас (%) | Оценка |
- Максимальное давление на устье и забое на каждом этапе
- ECD (эквивалентная циркуляционная плотность) — рассчитай если есть данные
- Сопоставь давления с градиентом ГРП: башмак предыдущей колонны и слабые пласты
- Если давление > 80% от давления ГРП — ПРЕДУПРЕЖДЕНИЕ
- Давление «СТОП» — соответствует ли расчётному?
- Сопоставь с моделированием из программы (если есть)

## 6. Анализ диаграмм и графиков
Если есть диаграммы закачки, ГТИ, СКЦ:
- ДОСКОНАЛЬНО разбери КАЖДУЮ кривую: что показывает, единицы, значения
- Давления на каждом этапе закачки — ЧИСЛА
- Расходы и объёмы по этапам — ЧИСЛА
- Аномалии, скачки давления, провалы расхода — причины
- Сопоставь с моделированием из программы цементирования

## 7. Анализ траектории и углов
Если есть данные об отходах и зенитных углах:
| Глубина (м) | Зенитный угол (°) | Азимут (°) | DLS (°/30м) | Влияние на цементирование |
- Наклонные участки (>30°) — риск неполной замены, сегрегация
- Горизонтальные участки (>60°) — КРИТИЧЕСКИЙ риск каналообразования
- DLS > 3°/30м — риск износа центраторов и нарушения центрации
- Корреляция углов с данными АКЦ

## 8. ПЛАН vs ФАКТ
| Параметр | План | Факт | Отклонение | Оценка |
Объёмы растворов, плотности, давления, режимы закачки, расходы, время операций.
Сопоставь с моделированием (ECD, давления, скорости).
- Каждое отклонение >10% — объяснение причины и влияния на качество

## 9. Корневые причины дефектов
Для КАЖДОГО проблемного интервала — КОНКРЕТНАЯ причинно-следственная цепочка:
| Интервал (м) | Дефект | Причина | Подтверждение | Влияние |
- Низкая центрация → канал → плохой контакт Ц-К/Ц-П
- Недостаточный расход → ламинарный режим → неполное вытеснение
- Малый объём буфера → контаминация → ухудшение свойств цемента
- Несоответствие реологии → плохое вытеснение → каналы
- Давление > ГРП → поглощение → потеря цемента

## 10. Мероприятия по улучшению
КОНКРЕТНЫЕ инженерные мероприятия с обоснованием:
| № | Мероприятие | Обоснование | Ожидаемый эффект |
Категории:
- Центрирование: тип, количество, расстановка центраторов
- Реология: корректировка параметров буровых и тампонажных растворов
- Режимы закачки: оптимальные расходы для турбулентного режима
- Буферные жидкости: объёмы, составы, время контакта
- Подготовка ствола: промывка, проработка, кондиционирование
- Лабораторные тесты: какие дополнительные испытания провести
- Контроль: рекомендации по мониторингу процесса

## 11. Итоговая оценка
ОТЛИЧНО / ХОРОШО / УДОВЛЕТВОРИТЕЛЬНО / НЕУДОВЛЕТВОРИТЕЛЬНО — с ОБОСНОВАНИЕМ.
Привяжи оценку к конкретным фактам: какие факторы сработали хорошо, какие — плохо.
Процент интервала с хорошим/удовл./плохим качеством сцепления.`;

    const userMessage = `Проанализируй качество цементирования на основе всех предоставленных данных.
${calcContext}
${docsContext}

ВАЖНО: 
- Данные АКЦ/СГДТ — ГЛАВНЫЙ приоритет! Не пропускай!
- Графики и диаграммы анализируй ДОСКОНАЛЬНО — каждую кривую, каждое значение, каждый расход
- Сопоставляй: АКЦ ↔ центрация ↔ реология ↔ расходы ↔ давления ↔ программа ↔ факт
- РАССЧИТАЙ стандофф, режимы потока, ECD где возможно
- Сравни давления с градиентом ГРП
- Привязывай качество к ФАКТИЧЕСКИМ действиям: объясни ПОЧЕМУ хорошо или плохо
- В конце — КОНКРЕТНЫЕ мероприятия с обоснованием
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
