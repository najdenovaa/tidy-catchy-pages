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

const systemPrompt = `Ты — инженер по цементированию нефтяных и газовых скважин. Из предоставленных документов извлеки ВСЕ данные, необходимые для расчёта программы цементирования.

ТИПЫ ДОКУМЕНТОВ, которые могут быть загружены (изучай ВСЕ без исключения):
- Заявка на цементирование / наряд-заказ на цементирование
- ТЗ (техническое задание) / исходные данные
- Программа / план цементирования
- Конструкция скважины / схема обвязки / карточка скважины
- Инклинометрия / данные инклинометра / профиль ствола / таблицы MD-Angle-Azimuth-TVD
- Протоколы лабораторных испытаний / лабораторные тесты / рецептуры растворов
- План работ / план ГТМ
- Геолого-технический наряд (ГТН)
- Любые другие документы с данными о скважине

ВАЖНО: Каждый загруженный документ разделен маркером "=== имя_файла ===". 
Ты ОБЯЗАН внимательно изучить КАЖДЫЙ документ от начала до конца и извлечь ВСЕ полезные данные.
Также тебе могут быть приложены изображения документов — изучи их ВНИМАТЕЛЬНО, это могут быть сканы заявок, инклинометрия, протоколы лабораторий.

ЧТО ИСКАТЬ В КАЖДОМ ДОКУМЕНТЕ:
1. ПАРАМЕТРЫ СКВАЖИНЫ: глубина MD/TVD, диаметр долота/ствола, диаметр и толщина стенки ОК, предыдущая колонна (глубина, диаметры), глубина ЦКОД, интервал цементирования (высота подъёма цемента), коэфф. кавернозности, температуры BHST/BHCT
2. БУРОВОЙ РАСТВОР: название, плотность (кг/м³), PV (сПз), YP (Па), водоотдача
3. ЦЕМЕНТНЫЕ РАСТВОРЫ: название, плотность, В/Ц, выход (м³/т), время загустевания (30Bc, 50Bc), PV, YP, водоотдача, интервал подъёма (верх цемента), тип цемента, добавки с дозировками
4. БУФЕРНЫЕ ЖИДКОСТИ: название, плотность, объём, расход
5. ПРОДАВОЧНАЯ ЖИДКОСТЬ: название, плотность, расход
6. ИНКЛИНОМЕТРИЯ: таблица MD, угол (зенитный), азимут, TVD — ВСЕ строки без исключения, даже если их 100+
7. ОБЩИЕ СВЕДЕНИЯ: название скважины, месторождение, тип колонны

ПРИМЕРЫ ДАННЫХ В ЗАЯВКАХ И ДОКУМЕНТАХ:
- "Диаметр долота 215.9 мм" → holeDiameter: 215.9
- "Обсадная колонна 168×8.9 мм" → casingOD: 168, casingWall: 8.9
- "Обсадная колонна 168×7.3 мм" → casingOD: 168, casingWall: 7.3
- "Глубина спуска 2850 м" → casingDepthMD: 2850
- "Кондуктор 245×8.9 мм на глубине 350м" → prevCasingOD: 245, prevCasingDepth: 350
- "Предыдущая колонна 245мм, ID=227.2мм" → prevCasingOD: 245, prevCasingID: 227.2
- "Плотность БР 1180 кг/м³" → drillingFluid.density: 1180
- "Тампонажный р-р плотностью 1.85 г/см³" → slurries[].density: 1850 (переведено в кг/м³)
- "ЦКОД на 2830м" → ckodDepth: 2830
- "Цемент от забоя до 800м" → первый раствор topDepthMD: 800
- "Температура на забое 85°С" → bottomTempStatic: 85
- "Расход закачки 8 л/с" → flowRateLps: 8

ЛАБОРАТОРНЫЕ ПРОТОКОЛЫ — ИЗВЛЕКАЙ ВСЁ:
- Состав / рецептура / дизайн раствора: тип цемента (ПЦТ-I-50, ПЦТ-II-50, ПЦТ-III-Об5, Class G и т.д.)
- ВСЕ добавки с дозировками: замедлители (HR-25, СДБ, Lateite), ускорители (CaCl2, хлорид кальция), понизители водоотдачи (FL-62L, КМЦ, Halad), пеногасители (D-Air), микросфера, бентонит, диспергаторы (CFR-3, D-65), пластификаторы
- Плотность раствора (если 1.85 г/см³ → 1850 кг/м³)
- В/Ц (водоцементное отношение)
- Выход раствора (м³/т)
- Время загустевания: 30Bc и 50Bc (ВСЕГДА В МИНУТАХ!)
- Реология: PV, YP
- Водоотдача: мл/30мин
- Температура и давление испытаний
- Прочность на сжатие (если указана)

КОНВЕРТАЦИЯ ЕДИНИЦ — ОБЯЗАТЕЛЬНО:
- ВРЕМЯ ЗАГУСТЕВАНИЯ: всегда в МИНУТАХ! 
  - "3 часа" → 180 мин
  - "2ч 30мин" → 150 мин  
  - "4:00" → 240 мин
  - "3-00" → 180 мин
  - "3:30" → 210 мин
  - Если число < 15 и похоже на часы → умножь на 60
- ВСЕ ПЛОТНОСТИ — ВСЕГДА В кг/м³! Если 1.85 г/см³ → 1850. Если 1180 кг/м³ → 1180.
- Глубины в метрах, диаметры в мм

ИНКЛИНОМЕТРИЯ — КРИТИЧЕСКИ ВАЖНО:
- Извлеки ВСЕ строки таблицы инклинометрии без пропусков
- Форматы: MD | Зенитный угол | Азимут | TVD
- Если TVD не указан — рассчитай из MD и зенитного угла
- Данные могут быть в Excel, PDF-таблице или на скане — извлекай ВСЁ
- Даже если строк 50-100+ — извлекай все до единой

Ответь СТРОГО в формате JSON (без markdown, без \`\`\`):
{
  "wellData": {
    "wellDepthMD": null или число (м),
    "wellDepthTVD": null или число (м),
    "casingDepthMD": null или число (м),
    "holeDiameter": null или число (мм),
    "casingOD": null или число (мм),
    "casingWall": null или число (мм),
    "prevCasingDepth": null или число (м),
    "prevCasingID": null или число (мм),
    "prevCasingOD": null или число (мм),
    "ckodDepth": null или число (м),
    "cementRiseHeight": null или число (м),
    "cavernCoeff": null или число,
    "bottomTempStatic": null или число (°C),
    "bottomTempCirc": null или число (°C)
  },
  "trajectory": [
    {"md": число, "angle": число, "azimuth": число, "tvd": число}
  ],
  "drillingFluid": {
    "name": null или строка,
    "density": null или число (кг/м³),
    "pv": null или число (сПз),
    "yp": null или число (Па),
    "fluidLoss": null или число (мл/30мин)
  },
  "slurries": [
    {
      "name": null или строка,
      "density": null или число (кг/м³),
      "topDepthMD": null или число (м),
      "waterRatio": null или число (В/Ц),
      "yieldPerTon": null или число (м³/т),
      "thickeningTime30Bc": null или число (МИНУТЫ!),
      "thickeningTime50Bc": null или число (МИНУТЫ!),
      "flowRateLps": null или число (л/с),
      "pv": null или число (сПз),
      "yp": null или число (Па),
      "fluidLoss": null или число (мл/30мин),
      "cementType": null или строка,
      "additives": [
        {"name": "название добавки", "percentage": число (%), "percentageType": "bwoc" или "bwob"}
      ]
    }
  ],
  "buffers": [
    {
      "name": null или строка,
      "density": null или число (кг/м³),
      "volume": null или число (м³),
      "flowRateLps": null или число (л/с)
    }
  ],
  "displacementFluid": {
    "name": null или строка,
    "density": null или число (кг/м³),
    "flowRateLps": null или число (л/с)
  },
  "wellName": null или строка,
  "fieldName": null или строка,
  "casingType": null или строка,
  "recommendations": ["строка"]
}

КРИТИЧЕСКИЕ ПРАВИЛА:
- Если данных нет — ставь null. НЕ ВЫДУМЫВАЙ!
- Если ЦКОД не указан: ЦКОД = глубина спуска ОК - 20м (типовое значение)
- Если внутренний диаметр предыдущей колонны не указан, но есть наружный и стенка — рассчитай: ID = OD - 2×wall
- Если указан расход закачки (л/с) — подставляй его в flowRateLps
- Высота подъёма цемента: если "от забоя до 500м" → cementRiseHeight: 500

РЕКОМЕНДАЦИИ (массив recommendations):
- Если не указан BHCT/BHST → "Не указана температура на забое (BHST/BHCT). Рекомендуется указать для корректного подбора рецептуры."
- Если нет данных по реологии → "Нет данных по реологии цементного раствора (PV/YP). Используются стандартные значения."
- Если нет инклинометрии → "Инклинометрия не предоставлена. Расчет будет выполнен для вертикальной скважины."
- Если нет лабораторных данных → "Протоколы лабораторных испытаний не предоставлены. Рекомендуется провести лабораторные тесты."
- Если нет данных по буферу → "Параметры буферной жидкости не указаны. Рекомендуется подобрать буферную систему."
- Если нет коэфф. кавернозности → "Коэффициент кавернозности не указан. Используется значение по умолчанию (1.1)."`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    const { file, files, parsedText } = await req.json();

    // Build content parts — include ALL vision files
    const contentParts: any[] = [];

    // Support array of vision files (new) + single file (backwards compat)
    const visionFiles: { base64: string; mimeType: string; name?: string }[] = [];
    
    if (Array.isArray(files) && files.length > 0) {
      for (const f of files) {
        if (f && f.base64 && isVisionCompatible(f.mimeType)) {
          visionFiles.push(f);
        }
      }
    } else if (file && isVisionCompatible(file.mimeType)) {
      visionFiles.push(file);
    }

    // Add ALL vision files as image_url parts
    for (const vf of visionFiles) {
      contentParts.push({
        type: "image_url",
        image_url: {
          url: `data:${vf.mimeType};base64,${vf.base64}`,
        },
      });
    }

    const textContent = parsedText || "";
    
    let userMessage = "";
    if (textContent) {
      userMessage = `Вот тексты документов (каждый документ разделен маркером ===):\n\n${textContent.slice(0, 80000)}`;
    }
    if (visionFiles.length > 0) {
      const fileNames = visionFiles.map(f => f.name || "документ").join(", ");
      userMessage += `\n\nТакже приложены ${visionFiles.length} файл(ов) как изображения: ${fileNames}. Внимательно изучи КАЖДЫЙ приложенный файл — это могут быть сканы инклинометрии, лабораторных протоколов, заявок. Извлеки ВСЕ данные из каждого файла.`;
    }
    if (!userMessage) {
      userMessage = "Извлеки данные из прикрепленных документов.";
    }

    contentParts.push({ type: "text", text: userMessage });

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: contentParts },
        ],
        temperature: 0.1,
        max_tokens: 32000,
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("AI error:", errText);
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Слишком много запросов. Подождите минуту." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "Исчерпан лимит AI запросов." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI API error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    let rawContent = aiData.choices?.[0]?.message?.content || "";

    // Clean up markdown fences if present
    rawContent = rawContent.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

    let extracted;
    try {
      extracted = JSON.parse(rawContent);
    } catch {
      console.error("Failed to parse AI response:", rawContent.slice(0, 500));
      throw new Error("Не удалось распознать данные из документа");
    }

    // Post-process: ensure slurry densities are in kg/m³
    if (extracted.slurries && Array.isArray(extracted.slurries)) {
      extracted.slurries = extracted.slurries.map((s: any) => {
        if (s.density != null && s.density > 0 && s.density < 10) {
          s.density = Math.round(s.density * 1000);
        }
        // Ensure thickening times are in minutes (catch hours)
        if (s.thickeningTime30Bc != null && s.thickeningTime30Bc > 0 && s.thickeningTime30Bc < 15) {
          s.thickeningTime30Bc = Math.round(s.thickeningTime30Bc * 60);
        }
        if (s.thickeningTime50Bc != null && s.thickeningTime50Bc > 0 && s.thickeningTime50Bc < 15) {
          s.thickeningTime50Bc = Math.round(s.thickeningTime50Bc * 60);
        }
        return s;
      });
    }

    // Post-process: ensure drilling fluid density is in kg/m³
    if (extracted.drillingFluid?.density != null && extracted.drillingFluid.density > 0 && extracted.drillingFluid.density < 10) {
      extracted.drillingFluid.density = Math.round(extracted.drillingFluid.density * 1000);
    }

    // Post-process: buffer densities
    if (extracted.buffers && Array.isArray(extracted.buffers)) {
      extracted.buffers = extracted.buffers.map((b: any) => {
        if (b.density != null && b.density > 0 && b.density < 10) {
          b.density = Math.round(b.density * 1000);
        }
        return b;
      });
    }

    // Post-process: displacement fluid density
    if (extracted.displacementFluid?.density != null && extracted.displacementFluid.density > 0 && extracted.displacementFluid.density < 10) {
      extracted.displacementFluid.density = Math.round(extracted.displacementFluid.density * 1000);
    }

    return new Response(JSON.stringify({ success: true, data: extracted }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Extract error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Ошибка извлечения данных" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
