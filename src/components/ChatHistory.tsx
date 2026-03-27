import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { History, MessageSquare, ChevronRight, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import FollowUpChat from "@/components/FollowUpChat";

interface ChatSession {
  id: string;
  title: string;
  report_context: string | null;
  created_at: string;
  updated_at: string;
  message_count?: number;
}

export default function ChatHistory() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState<ChatSession | null>(null);

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setLoading(false); return; }

    const { data } = await supabase
      .from("chat_sessions")
      .select("*")
      .eq("user_id", session.user.id)
      .order("updated_at", { ascending: false });

    if (data) {
      // Get message counts
      const sessionsWithCounts: ChatSession[] = [];
      for (const s of data) {
        const { count } = await supabase
          .from("chat_messages")
          .select("*", { count: "exact", head: true })
          .eq("session_id", s.id);
        sessionsWithCounts.push({ ...s, message_count: count || 0 });
      }
      setSessions(sessionsWithCounts);
    }
    setLoading(false);
  };

  if (selectedSession) {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" className="text-xs gap-1" onClick={() => { setSelectedSession(null); loadSessions(); }}>
          ← Назад к истории чатов
        </Button>
        <FollowUpChat
          reportContext={selectedSession.report_context || ""}
          sessionId={selectedSession.id}
        />
      </div>
    );
  }

  return (
    <Card className="border-muted">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="w-4 h-4 text-primary" />
          История чатов
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Ваши предыдущие чаты по анализам. Нажмите, чтобы продолжить.
        </p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Загрузка...
          </div>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            Чатов пока нет. Они появятся после первого уточняющего вопроса.
          </p>
        ) : (
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {sessions.map(s => (
              <button
                key={s.id}
                onClick={() => setSelectedSession(s)}
                className="w-full flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors text-left"
              >
                <MessageSquare className="w-4 h-4 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{s.title}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {new Date(s.updated_at).toLocaleDateString("ru-RU", {
                      day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
                    })}
                  </p>
                </div>
                <Badge variant="outline" className="text-[10px] shrink-0">
                  {s.message_count} сообщ.
                </Badge>
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
