import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

  console.log(`Extracting from ${file.name} (${file.mimeType})...`);

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
            {
              type: "text",
              text: `Извлеки ВСЕ данные из этого документа/изображения максимально точно. Сохраняй структуру: заголовки, таблицы, числовые данные.
Если это геофизический лог (АКЦ, СГДТ, CBL, VDL):
- Опиши интервалы глубин и амплитуды
- Качество сцепления по интервалам  
- Контакты цемент-колонна и цемент-порода
- Центрацию колонны если видна
Если это лабораторные данные / реология:
- Все числовые значения, плотности, вязкости, водоотдачу
- Результаты тестов, температуры
Если это протокол / план / рапорт:
- Все ключевые параметры и факты
- Давления, объёмы, режимы, время операций
Верни ТОЛЬКО извлечённые данные без комментариев.`,
            },
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
    console.error(`Vision API error for ${file.name}:`, response.status);
    return `[Не удалось распознать: ${file.name}]`;
  }

  const result = await response.json();
  return result.choices?.[0]?.message?.content || "";
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
  }
  if (calcData?.slurries?.length) {
    ctx += `\n## Тампонажные растворы:\n`;
    calcData.slurries.forEach((s: any, i: number) => {
      ctx += `- Раствор ${i + 1}: ${s.name || "Без названия"}, плотность ${s.density} кг/м³, объём ${s.volume?.toFixed(2) || "?"} м³\n`;
    });
  }
  if (calcData?.drillingFluid) {
    ctx += `\n## Буровой раствор: плотность ${calcData.drillingFluid.density} кг/м³\n`;
  }
  if (calcData?.centralizationResults?.length) {
    const avg = calcData.centralizationResults.reduce((s: number, r: any) => s + r.standoff, 0) / calcData.centralizationResults.length;
    ctx += `\n## Центрирование: средний стандофф ${avg.toFixed(1)}%\n`;
    const poor = calcData.centralizationResults.filter((r: any) => r.standoff < 67);
    if (poor.length) ctx += `- Зон с стандоффом < 67%: ${poor.length}\n`;
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

    if (documentFiles) {
      const labels: Record<string, string> = {
        akc: "АКЦ/СГДТ (геофизические данные)",
        program: "Программа цементирования",
        report: "Отчёт по цементированию",
      };

      for (const [docType, fileData] of Object.entries(documentFiles)) {
        if (docType === "other" && Array.isArray(fileData)) {
          for (const otherFile of fileData as any[]) {
            const text = await extractTextFromFile(otherFile, LOVABLE_API_KEY);
            docsContext += `\n## Документ: ${otherFile.name}:\n${text.substring(0, 15000)}\n`;
          }
        } else {
          const file = fileData as { base64: string; mimeType: string; name: string };
          const text = await extractTextFromFile(file, LOVABLE_API_KEY);
          docsContext += `\n## Документ ${labels[docType] || docType}:\n${text.substring(0, 15000)}\n`;
        }
      }
    }

    const systemPrompt = `Ты — виртуальный инженерный помощник DeAllsoft по анализу качества цементирования скважин.

Правила ответа:
- Минимум лишних слов, максимум фактов и цифр
- Используй таблицы (markdown) для сравнений и интервалов
- Конкретные глубины, значения, проценты
- Структурируй по разделам с заголовками ##

Анализируй и включи в отчёт:

## 1. Оценка качества сцепления (АКЦ/СГДТ)
Таблица интервалов: глубина от-до | амплитуда CBL | контакт цемент-колонна | контакт цемент-порода | оценка
Учитывай центрацию колонны и её влияние на качество сцепления.

## 2. Анализ центрирования
Стандофф по интервалам, влияние на каналообразование, корреляция с данными АКЦ.

## 3. Анализ траектории и углов
Если есть данные об отходах и зенитных углах — оцени влияние на качество цементирования в наклонных/горизонтальных участках.

## 4. Лабораторные данные и реология
Если предоставлены — проанализируй плотность, растекаемость, водоотдачу, реологию, время загустевания. Соответствие условиям скважины.

## 5. ПЛАН vs ФАКТ
Таблица: параметр | план | факт | отклонение
Объёмы, плотности, давления, режимы, время.

## 6. Корневые причины дефектов
Для каждого проблемного интервала — конкретная причина:
- Центрация < 67%, каверны, контаминация, скорость продавки, объём буфера, температура

## 7. Рекомендации
Конкретные инженерные решения для аналогичных скважин.

## 8. Итоговая оценка
Одна из: ОТЛИЧНО / ХОРОШО / УДОВЛЕТВОРИТЕЛЬНО / НЕУДОВЛЕТВОРИТЕЛЬНО — с кратким обоснованием.`;

    const userMessage = `Проанализируй качество цементирования:
${calcContext}
${docsContext}

Дай структурированный инженерный отчёт. Используй таблицы для числовых данных.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
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
