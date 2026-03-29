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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    const { file, parsedText } = await req.json();

    // Build content parts
    const contentParts: any[] = [];

    if (file && isVisionCompatible(file.mimeType)) {
      contentParts.push({
        type: "image_url",
        image_url: {
          url: `data:${file.mimeType};base64,${file.base64}`,
        },
      });
    }

    const textContent = parsedText || "";
    
    const systemPrompt = `Ты — инженер по цементированию нефтяных и газовых скважин. Из предоставленных документов извлеки ВСЕ данные, необходимые для расчёта программы цементирования.

ТИПЫ ДОКУМЕНТОВ, которые могут быть загружены (изучай ВСЕ без исключения):
- Заявка на цементирование / наряд-заказ на цементирование
- ТЗ (техническое задание) / исходные данные
- Программа / план цементирования
- Конструкция скважины / схема обвязки / карточка скважины
- Инклинометрия / данные инклинометра / профиль ствола
- Протоколы лабораторных испытаний / лабораторные тесты
- План работ / план ГТМ
- Геолого-технический наряд (ГТН)
- Любые другие документы с данными о скважине

Каждый документ разделен маркером "=== имя_файла ===". Ты ОБЯЗАН внимательно изучить КАЖДЫЙ документ и извлечь ВСЕ полезные данные для заполнения программы цементирования.

ЧТО ИСКАТЬ В КАЖДОМ ДОКУМЕНТЕ:
1. ПАРАМЕТРЫ СКВАЖИНЫ: глубина MD/TVD, диаметр долота/ствола, диаметр и толщина стенки ОК, предыдущая колонна (глубина, диаметры), глубина ЦКОД, интервал цементирования (высота подъёма цемента), коэфф. кавернозности, температуры BHST/BHCT
2. БУРОВОЙ РАСТВОР: название, плотность (кг/м³), PV (сПз), YP (Па), водоотдача
3. ЦЕМЕНТНЫЕ РАСТВОРЫ: название, плотность, В/Ц, выход (м³/т), время загустевания (30Bc, 50Bc), PV, YP, водоотдача, интервал подъёма (верх цемента)
4. БУФЕРНЫЕ ЖИДКОСТИ: название, плотность, объём, расход
5. ПРОДАВОЧНАЯ ЖИДКОСТЬ: название, плотность, расход
6. ИНКЛИНОМЕТРИЯ: таблица MD, угол (зенитный), азимут, TVD — ВСЕ строки
7. ОБЩИЕ СВЕДЕНИЯ: название скважины, месторождение, тип колонны

ПРИМЕРЫ ДАННЫХ В ЗАЯВКАХ:
- "Диаметр долота 215.9 мм" → holeDiameter: 215.9
- "Обсадная колонна 168×8.9 мм" → casingOD: 168, casingWall: 8.9
- "Обсадная колонна 168×7.3 мм" → casingOD: 168, casingWall: 7.3
- "Глубина спуска 2850 м" → casingDepthMD: 2850
- "Кондуктор 245×8.9 мм на глубине 350м" → prevCasingOD: 245, prevCasingDepth: 350
- "Предыдущая колонна 245мм, ID=227.2мм" → prevCasingOD: 245, prevCasingID: 227.2
- "Плотность БР 1180 кг/м³" → drillingFluid.density: 1180
- "Тампонажный р-р плотностью 1.85 г/см³" → slurries[].density: 1850 (переведено в кг/м³)
- "ЦКОД на 2830м" → ckodDepth: 2830
- "Цемент от забоя до 800м" → первый раствор topDepthMD: 800 (или cementRiseHeight: 800)
- "Температура на забое 85°С" → bottomTempStatic: 85

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
      "thickeningTime30Bc": null или число (МИНУТЫ! если в документе часы — переведи: 3ч = 180мин, 4ч30мин = 270мин),
      "thickeningTime50Bc": null или число (МИНУТЫ!),
      "flowRateLps": null или число (л/с),
      "pv": null или число (сПз),
      "yp": null или число (Па),
      "fluidLoss": null или число (мл/30мин),
      "cementType": null или строка (напр. "ПЦТ-I-50", "ПЦТ-II-50", "ПЦТ-III-Об5"),
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
  "casingType": null или строка (напр. "Эксплуатационная 168мм"),
  "recommendations": ["строка"] — список рекомендаций о недостающих данных для качественной программы
}

КРИТИЧЕСКИЕ ПРАВИЛА:
- Если данных нет — ставь null. НЕ ВЫДУМЫВАЙ!
- ВСЕ ПЛОТНОСТИ — ВСЕГДА В кг/м³! Если 1.85 г/см³ → 1850. Если 1180 кг/м³ → 1180.
- Глубины в метрах, диаметры в мм
- "168×8.9" означает наружный диаметр 168мм, толщина стенки 8.9мм
- Если внутренний диаметр предыдущей колонны не указан, но есть наружный и стенка — рассчитай: ID = OD - 2×wall
- Если ЦКОД не указан: ЦКОД = глубина спуска ОК - 20м (типовое значение)
- ИНКЛИНОМЕТРИЯ: извлеки ВСЕ строки таблицы. TVD рассчитай если не указан.
- ЛАБОРАТОРНЫЕ ДАННЫЕ: сопоставляй растворы по названию/плотности с данными из заявки/ТЗ — объединяй в один объект.
- Если в заявке указан расход закачки (л/с) — подставляй его в соответствующие растворы.
- Если указан объём буфера — подставляй.
- Высота подъёма цемента: если указано "от забоя до 500м" — cementRiseHeight: 500. Если "подъём на 1500м выше башмака" — рассчитай.`;

    const userMessage = textContent
      ? `Вот тексты документов (каждый документ разделен маркером ===):\n\n${textContent.slice(0, 60000)}`
      : "Извлеки данные из прикрепленного документа.";

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
        max_tokens: 12000,
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("AI error:", errText);
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
      console.error("Failed to parse AI response:", rawContent);
      throw new Error("Не удалось распознать данные из документа");
    }

    // Post-process: ensure slurry densities are in kg/m³
    if (extracted.slurries && Array.isArray(extracted.slurries)) {
      extracted.slurries = extracted.slurries.map((s: any) => {
        if (s.density != null && s.density > 0 && s.density < 10) {
          // Likely in g/cm³, convert to kg/m³
          s.density = Math.round(s.density * 1000);
        }
        return s;
      });
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
