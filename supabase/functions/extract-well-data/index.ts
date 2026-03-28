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
    
    const systemPrompt = `Ты — инженер по цементированию нефтяных и газовых скважин. Из предоставленного документа (ТЗ, исходные данные, план, программа) извлеки ВСЕ данные по скважине и цементированию.

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
      "density": null или число (г/см³),
      "topDepthMD": null или число (м),
      "waterRatio": null или число,
      "yieldPerTon": null или число (м³/т),
      "thickeningTime30Bc": null или число (мин),
      "thickeningTime50Bc": null или число (мин),
      "flowRateLps": null или число (л/с),
      "pv": null или число,
      "yp": null или число
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
  "casingType": null или строка (напр. "Эксплуатационная 168мм")
}

ПРАВИЛА:
- Если данных нет в документе — ставь null
- Не выдумывай данные — только то, что ЯВНО указано в документе
- Плотность цементных растворов в г/см³
- Плотность буровых и буферных — в кг/м³
- Глубины в метрах
- Диаметры в мм
- Если есть несколько цементных растворов (тампонажных), верни их ВСЕ в массиве slurries
- Если ЦКОД не указан, но есть длина обсадной колонны — рассчитай (обычно ЦКОД = глубина спуска ОК - (10-30м))`;

    const userMessage = textContent
      ? `Вот текст документа:\n\n${textContent.slice(0, 50000)}`
      : "Извлеки данные из прикрепленного документа.";

    contentParts.push({ type: "text", text: userMessage });

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: contentParts },
        ],
        temperature: 0.1,
        max_tokens: 4000,
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
