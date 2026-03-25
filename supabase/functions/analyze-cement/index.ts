import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { documentTexts, calcData } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // Build context from calculation data
    let calcContext = "";
    if (calcData) {
      const wd = calcData.wellData;
      if (wd) {
        calcContext += `\n## Данные скважины:\n`;
        calcContext += `- Глубина MD: ${wd.wellDepthMD} м, TVD: ${wd.wellDepthTVD} м\n`;
        calcContext += `- Глубина спуска колонны MD: ${wd.casingDepthMD} м\n`;
        calcContext += `- Диаметр долота: ${wd.holeDiameter} мм\n`;
        calcContext += `- Обсадная колонна OD: ${wd.casingOD} мм, стенка: ${wd.casingWall} мм\n`;
        calcContext += `- Высота подъёма цемента: ${wd.cementRiseHeight} м\n`;
        calcContext += `- Коэффициент кавернозности: ${wd.cavernCoeff}\n`;
      }
      if (calcData.slurries?.length) {
        calcContext += `\n## Тампонажные растворы:\n`;
        calcData.slurries.forEach((s: any, i: number) => {
          calcContext += `- Раствор ${i + 1}: ${s.name || "Без названия"}, плотность ${s.density} кг/м³, объём ${s.volume?.toFixed(2) || "?"} м³\n`;
        });
      }
      if (calcData.drillingFluid) {
        calcContext += `\n## Буровой раствор: плотность ${calcData.drillingFluid.density} кг/м³\n`;
      }
      if (calcData.centralizationResults?.length) {
        const avgStandoff = calcData.centralizationResults.reduce((s: number, r: any) => s + r.standoff, 0) / calcData.centralizationResults.length;
        calcContext += `\n## Центрирование: средний стандофф ${avgStandoff.toFixed(1)}%\n`;
        const poorZones = calcData.centralizationResults.filter((r: any) => r.standoff < 67);
        if (poorZones.length) {
          calcContext += `- Зон с стандоффом < 67%: ${poorZones.length}\n`;
        }
      }
    }

    // Build document context
    let docsContext = "";
    if (documentTexts) {
      if (documentTexts.akc) {
        docsContext += `\n## Документ АКЦ/СГДТ (геофизические данные):\n${documentTexts.akc.substring(0, 15000)}\n`;
      }
      if (documentTexts.program) {
        docsContext += `\n## Программа цементирования:\n${documentTexts.program.substring(0, 10000)}\n`;
      }
      if (documentTexts.report) {
        docsContext += `\n## Отчёт по цементированию:\n${documentTexts.report.substring(0, 10000)}\n`;
      }
    }

    const systemPrompt = `Ты — опытный инженер по цементированию скважин с 20-летним стажем. Ты анализируешь качество цементирования на основе данных АКЦ (акустической цементометрии), СГДТ (сканирующей гамма-дефектометрии), CBL/VDL логов, программы и отчёта по цементированию.

Твоя задача — дать ПОЛНЫЙ инженерный анализ:

1. **Оценка качества сцепления** — проанализируй данные АКЦ/СГДТ, определи интервалы хорошего, частичного и плохого сцепления цемента с колонной и породой.

2. **Корневые причины дефектов** — для каждого интервала с плохим сцеплением определи возможные причины:
   - Недостаточная центрация (стандофф < 67%)
   - Каверны и вымывы (кавернозность)
   - Неправильная плотность раствора
   - Недостаточная скорость продавки (плохое вытеснение)
   - Контаминация раствора буровым раствором
   - Недостаточный объём буферной жидкости
   - Температурные проблемы (преждевременное схватывание или наоборот)

3. **Сравнение ПЛАН vs ФАКТ** — если есть программа и отчёт, сравни:
   - Плановые и фактические объёмы
   - Плотности растворов
   - Давления
   - Режимы продавки
   - Время операции

4. **Рекомендации** — конкретные инженерные рекомендации для улучшения качества цементирования на аналогичных скважинах.

5. **Общее заключение** — итоговая оценка качества цементирования (отлично / хорошо / удовлетворительно / неудовлетворительно) с обоснованием.

Используй профессиональную терминологию. Давай конкретные числа и интервалы. Структурируй ответ с заголовками и списками.`;

    const userMessage = `Проанализируй качество цементирования скважины на основе следующих данных:
${calcContext}
${docsContext}

Дай полный инженерный отчёт по качеству цементирования.`;

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
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Необходимо пополнить баланс AI." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "Ошибка AI сервиса" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
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
