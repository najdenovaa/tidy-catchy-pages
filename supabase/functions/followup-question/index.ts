import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAX_FREE_PER_SESSION = 3;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("LOVABLE_API_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "");

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Не авторизован" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const question = (body.question || "").trim();
    const reportContext = (body.reportContext || "").trim();
    const sessionId = (body.sessionId || "").trim();
    const conversationHistory: Array<{ role: string; content: string }> = Array.isArray(body.conversationHistory) ? body.conversationHistory : [];
    const hasAttachment = !!body.attachment;
    const attachmentName = body.attachment?.name || null;
    const attachmentBase64 = body.attachment?.base64 || null;
    const attachmentMime = body.attachment?.mimeType || null;

    if (!question) {
      return new Response(JSON.stringify({ error: "Вопрос не может быть пустым" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (question.length > 2000) {
      return new Response(JSON.stringify({ error: "Вопрос слишком длинный (макс. 2000 символов)" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceKey);

    // Get analysis credits
    const { data: credits, error: credErr } = await adminClient
      .from("user_credits")
      .select("ai_analyses_used, ai_analyses_limit")
      .eq("user_id", user.id)
      .single();

    if (credErr || !credits) {
      return new Response(JSON.stringify({ error: "Не найден баланс пользователя" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const analysesRemaining = credits.ai_analyses_limit - credits.ai_analyses_used;

    // Count free (no-attachment) user messages in this session
    let sessionFreeUsed = 0;
    if (sessionId) {
      const { count } = await adminClient
        .from("chat_messages")
        .select("id", { count: "exact", head: true })
        .eq("session_id", sessionId)
        .eq("role", "user")
        .is("attachment_name", null);
      sessionFreeUsed = count || 0;
    }
    const sessionFreeRemaining = MAX_FREE_PER_SESSION - sessionFreeUsed;

    if (hasAttachment) {
      if (analysesRemaining <= 0) {
        return new Response(JSON.stringify({
          error: "Вопрос с вложением расходует 1 анализ. Анализы исчерпаны. Обратитесь в Поддержку: https://t.me/deall_support",
          sessionFreeRemaining,
          analysesRemaining: 0,
        }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      if (sessionFreeRemaining <= 0) {
        return new Response(JSON.stringify({
          error: "В этом чате использованы все 3 бесплатных вопроса. Для продолжения — обратитесь в Поддержку: https://t.me/deall_support",
          sessionFreeRemaining: 0,
          analysesRemaining,
        }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Build AI messages
    const systemPrompt = `Ты — старший инженер по креплению скважин с 20-летним стажем. Отвечай СТРОГО техническим языком нефтегазовой отрасли. Используй ГОСТы, РД, СТО, отраслевую терминологию. Ответы должны быть конкретными, с числовыми значениями и ссылками на нормативы где применимо.

Правила:
- Никакой похвалы и оценочных суждений
- Только факты, расчёты, технические обоснования
- Если данных недостаточно — укажи какие именно данные нужны
- Формат: структурированный, с пунктами и подпунктами
- Единицы измерения: СИ (МПа, кг/м³, мПа·с, м/с)
- ВАЖНО: Если вопрос НЕ относится к нефтегазовой отрасли, цементированию скважин, бурению, креплению, или анализу скважинных данных — ответь ТОЛЬКО: "Извините, я не компетентен отвечать на вопросы, не касающиеся Анализа и текущего проекта." Не давай никаких других пояснений в таком случае.`;

    const userContent: any[] = [];

    if (reportContext) {
      userContent.push({
        type: "text",
        text: `КОНТЕКСТ — ранее проведённый анализ цементирования:\n\n${reportContext.slice(0, 15000)}`,
      });
    }

    if (hasAttachment && attachmentBase64 && attachmentMime) {
      const isVision = attachmentMime.startsWith("image/") || attachmentMime === "application/pdf";
      if (isVision) {
        userContent.push({
          type: "image_url",
          image_url: { url: `data:${attachmentMime};base64,${attachmentBase64}` },
        });
        userContent.push({
          type: "text",
          text: `Вложение: ${attachmentName}\n\nВопрос инженера: ${question}`,
        });
      } else {
        try {
          const bytes = Uint8Array.from(atob(attachmentBase64), (c) => c.charCodeAt(0));
          const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
          userContent.push({
            type: "text",
            text: `Вложение "${attachmentName}":\n${text.slice(0, 10000)}\n\nВопрос инженера: ${question}`,
          });
        } catch {
          userContent.push({
            type: "text",
            text: `[Вложение: ${attachmentName}, формат ${attachmentMime}]\n\nВопрос инженера: ${question}`,
          });
        }
      }
    } else {
      userContent.push({ type: "text", text: `Вопрос инженера: ${question}` });
    }

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        stream: false,
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text().catch(() => "");
      console.error("AI error:", aiResponse.status, errText);
      return new Response(JSON.stringify({ error: "Ошибка AI-сервиса" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResult = await aiResponse.json();
    const answer = aiResult.choices?.[0]?.message?.content || "Нет ответа";

    // Deduct analysis credit only for attachments
    if (hasAttachment) {
      await adminClient
        .from("user_credits")
        .update({ ai_analyses_used: credits.ai_analyses_used + 1 })
        .eq("user_id", user.id);
    }

    // Log
    const costLabel = hasAttachment ? "1 анализ" : "бесплатный вопрос";
    await adminClient.from("followup_questions").insert({
      user_id: user.id,
      question,
      has_attachment: hasAttachment,
      attachment_name: attachmentName,
      cost_rub: hasAttachment ? 399 : 0,
      answer,
      report_context: reportContext ? reportContext.slice(0, 5000) : null,
    });

    const newSessionFreeRemaining = hasAttachment ? sessionFreeRemaining : sessionFreeRemaining - 1;
    const newAnalysesRemaining = hasAttachment ? analysesRemaining - 1 : analysesRemaining;

    return new Response(JSON.stringify({
      answer,
      costLabel,
      sessionFreeRemaining: newSessionFreeRemaining,
      analysesRemaining: newAnalysesRemaining,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("followup-question error:", e);
    return new Response(JSON.stringify({ error: e.message || "Внутренняя ошибка" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
