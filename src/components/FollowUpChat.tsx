import { useState, useRef, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, Send, Paperclip, Loader2, X, FileText, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  costLabel?: string;
  attachmentName?: string;
}

interface FollowUpChatProps {
  reportContext: string;
  sessionId?: string;
  onSessionCreated?: (sessionId: string) => void;
}

function getMimeType(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    bmp: "image/bmp", tiff: "image/tiff", tif: "image/tiff", webp: "image/webp",
    txt: "text/plain",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    doc: "application/msword",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xls: "application/vnd.ms-excel",
  };
  return map[ext] || "application/octet-stream";
}

function ReportRenderer({ text }: { text: string }) {
  const lines = text.split("\n");
  const elements: JSX.Element[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("### ")) {
      elements.push(<h4 key={i} className="text-sm font-bold mt-3 mb-1 text-primary">{line.slice(4)}</h4>);
    } else if (line.startsWith("## ")) {
      elements.push(<h3 key={i} className="text-base font-bold mt-4 mb-1 text-foreground border-b pb-1">{line.slice(3)}</h3>);
    } else if (line.startsWith("# ")) {
      elements.push(<h2 key={i} className="text-lg font-bold mt-4 mb-1">{line.slice(2)}</h2>);
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      elements.push(
        <div key={i} className="flex gap-2 text-sm ml-2 my-0.5">
          <span className="text-primary mt-0.5">•</span>
          <span>{renderBold(line.slice(2))}</span>
        </div>
      );
    } else if (line.trim() === "") {
      elements.push(<div key={i} className="h-1.5" />);
    } else {
      elements.push(<p key={i} className="text-sm leading-relaxed my-0.5">{renderBold(line)}</p>);
    }
    i++;
  }
  return <>{elements}</>;
}

function renderBold(text: string): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = [];
  const regex = /\*\*(.+?)\*\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let k = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(<strong key={k++} className="font-semibold">{match[1]}</strong>);
    last = regex.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export default function FollowUpChat({ reportContext, sessionId: initialSessionId, onSessionCreated }: FollowUpChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [freeFollowups, setFreeFollowups] = useState<number | null>(null);
  const [analysesRemaining, setAnalysesRemaining] = useState<number | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(initialSessionId || null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  // Load credits
  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { data } = await supabase
        .from("user_credits")
        .select("free_followups_remaining, ai_analyses_used, ai_analyses_limit")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (data) {
        setFreeFollowups((data as any).free_followups_remaining ?? 0);
        setAnalysesRemaining(data.ai_analyses_limit - data.ai_analyses_used);
      }
    };
    load();
  }, []);

  // Load existing messages if sessionId provided
  useEffect(() => {
    if (!initialSessionId) return;
    const loadMessages = async () => {
      setLoadingHistory(true);
      const { data } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("session_id", initialSessionId)
        .order("created_at", { ascending: true });
      if (data) {
        setMessages(data.map((m: any) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content,
          costLabel: m.cost_label || undefined,
          attachmentName: m.attachment_name || undefined,
        })));
      }
      setLoadingHistory(false);
    };
    loadMessages();
  }, [initialSessionId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const hasFile = !!attachment;
  const canSend = question.trim().length > 0 && !sending && (
    hasFile ? (analysesRemaining !== null && analysesRemaining > 0) : (freeFollowups !== null && freeFollowups > 0)
  );

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const getOrCreateSession = useCallback(async (userId: string): Promise<string> => {
    if (currentSessionId) return currentSessionId;

    // Create a new session
    const title = reportContext.slice(0, 100).replace(/\n/g, " ").trim() || "Чат по анализу";
    const { data, error } = await supabase
      .from("chat_sessions")
      .insert({ user_id: userId, title, report_context: reportContext.slice(0, 15000) })
      .select("id")
      .single();

    if (error || !data) throw new Error("Не удалось создать сессию чата");

    setCurrentSessionId(data.id);
    onSessionCreated?.(data.id);
    return data.id;
  }, [currentSessionId, reportContext, onSessionCreated]);

  const saveMessage = async (sessionId: string, userId: string, msg: Message) => {
    await supabase.from("chat_messages").insert({
      session_id: sessionId,
      user_id: userId,
      role: msg.role,
      content: msg.content,
      cost_label: msg.costLabel || null,
      attachment_name: msg.attachmentName || null,
    });
  };

  const handleSend = async () => {
    if (!canSend) return;
    const q = question.trim();
    setSending(true);

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: q,
      attachmentName: attachment?.name,
    };
    setMessages(prev => [...prev, userMsg]);
    setQuestion("");

    try {
      let attachmentPayload: any = null;
      if (attachment) {
        const base64 = await fileToBase64(attachment);
        attachmentPayload = { base64, mimeType: getMimeType(attachment.name), name: attachment.name };
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Не авторизован");

      // Ensure session exists
      const sessId = await getOrCreateSession(session.user.id);

      // Save user message
      await saveMessage(sessId, session.user.id, userMsg);

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/followup-question`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ question: q, reportContext, attachment: attachmentPayload }),
        }
      );

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Ошибка ${response.status}`);

      const assistantMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: result.answer,
        costLabel: result.costLabel,
      };
      setMessages(prev => [...prev, assistantMsg]);
      setFreeFollowups(result.freeFollowups);
      setAnalysesRemaining(result.analysesRemaining);
      setAttachment(null);

      // Save assistant message
      await saveMessage(sessId, session.user.id, assistantMsg);

      // Update session timestamp
      await supabase.from("chat_sessions").update({ updated_at: new Date().toISOString() }).eq("id", sessId);
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
      setMessages(prev => prev.filter(m => m.id !== userMsg.id));
      setQuestion(q);
    } finally {
      setSending(false);
    }
  };

  return (
    <Card className="border-muted">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="w-4 h-4 text-primary" />
            Уточняющие вопросы по отчёту
          </CardTitle>
          <div className="flex items-center gap-2">
            {freeFollowups !== null && (
              <Badge variant="outline" className="text-[10px]">
                Вопросов: {freeFollowups}
              </Badge>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Текстовый вопрос — бесплатно (осталось {freeFollowups ?? "…"}).
          Вопрос с вложением — расходует 1 анализ (осталось {analysesRemaining ?? "…"}).
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {loadingHistory && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Загрузка истории...
          </div>
        )}

        {messages.length > 0 && (
          <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
            {messages.map(msg => (
              <div
                key={msg.id}
                className={`rounded-lg p-3 text-sm ${
                  msg.role === "user"
                    ? "bg-primary/5 border border-primary/10 ml-8"
                    : "bg-muted/50 border border-border mr-4"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium text-muted-foreground">
                    {msg.role === "user" ? "Вы" : "Инженерный ассистент"}
                  </span>
                  {msg.costLabel && (
                    <Badge variant="secondary" className="text-[10px] h-4">{msg.costLabel}</Badge>
                  )}
                </div>
                {msg.attachmentName && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                    <FileText className="w-3 h-3" /> {msg.attachmentName}
                  </div>
                )}
                {msg.role === "assistant" ? <ReportRenderer text={msg.content} /> : <p className="whitespace-pre-wrap">{msg.content}</p>}
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
        )}

        <div className="space-y-2">
          {attachment && (
            <div className="flex items-center gap-2 text-xs bg-muted rounded-md px-2 py-1.5">
              <FileText className="w-3 h-3 text-primary" />
              <span className="truncate flex-1">{attachment.name}</span>
              <div className="flex items-center gap-1">
                <Badge variant="destructive" className="text-[10px] h-4">−1 анализ</Badge>
                <button onClick={() => setAttachment(null)} className="text-muted-foreground hover:text-destructive">
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <Textarea
              placeholder="Задайте уточняющий вопрос..."
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              className="min-h-[60px] max-h-[120px] resize-none text-sm"
              disabled={sending}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
              }}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => fileRef.current?.click()} disabled={sending}>
                <Paperclip className="w-3 h-3" /> Вложение
              </Button>
              <input ref={fileRef} type="file" className="hidden" accept=".pdf,.docx,.doc,.txt,.xlsx,.xls,.jpg,.jpeg,.png,.bmp,.tiff,.tif,.webp" onChange={(e) => { const f = e.target.files?.[0]; if (f) setAttachment(f); e.target.value = ""; }} />
              <span className="text-[10px] text-muted-foreground">
                {hasFile ? "Списывается 1 анализ" : "Бесплатный вопрос"}
              </span>
            </div>
            <Button size="sm" className="h-7 text-xs gap-1" onClick={handleSend} disabled={!canSend}>
              {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />} Отправить
            </Button>
          </div>

          {freeFollowups !== null && freeFollowups <= 0 && !hasFile && (
            <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-500/10 rounded-md p-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              Бесплатные вопросы исчерпаны. Для продолжения — обратитесь в{" "}
              <a href="https://t.me/deall_support" target="_blank" rel="noopener noreferrer" className="underline font-semibold">Поддержку</a>.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
