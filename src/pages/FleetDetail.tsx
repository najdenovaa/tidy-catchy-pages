import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Camera, Send, MapPin } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Legend,
  ResponsiveContainer, Tooltip,
} from "recharts";

const EMPTY_DATA = Array.from({ length: 21 }, (_, i) => ({
  time: i * 5,
  pressure: null as number | null,
  rate: null as number | null,
  density: null as number | null,
  volume: null as number | null,
}));

export default function FleetDetail() {
  const navigate = useNavigate();
  const [message, setMessage] = useState("");
  const [chatMessages, setChatMessages] = useState<{ role: "user" | "operator"; text: string }[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const sendMessage = () => {
    if (!message.trim()) return;
    setChatMessages(prev => [...prev, { role: "user", text: message.trim() }]);
    setMessage("");
  };

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/admin")}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Назад
        </Button>
        <h1 className="text-lg font-bold text-foreground">5 флот</h1>
        <div className="flex items-center gap-1.5 ml-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75 animate-ping" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
          </span>
          <span className="text-xs text-green-500 font-medium">online</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-[1400px] mx-auto">
        {/* 1 — Empty cementing chart */}
        <Card className="aspect-square flex flex-col">
          <CardHeader className="py-2 px-3">
            <CardTitle className="text-xs">📊 График цементирования</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 p-2">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={EMPTY_DATA} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                <XAxis
                  dataKey="time"
                  type="number"
                  domain={[0, 100]}
                  tickFormatter={(v: number) => `${v}`}
                  label={{ value: "Время, мин", position: "insideBottom", offset: -2, style: { fontSize: 9, fill: "hsl(var(--muted-foreground))" } }}
                  tick={{ fontSize: 9 }}
                />
                <YAxis
                  yAxisId="left"
                  domain={[0, 50]}
                  label={{ value: "Давление, МПа", angle: -90, position: "insideLeft", style: { fontSize: 9, fill: "hsl(var(--muted-foreground))" } }}
                  tick={{ fontSize: 9 }}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  domain={[0, 30]}
                  label={{ value: "Расход, л/с", angle: 90, position: "insideRight", style: { fontSize: 9, fill: "hsl(var(--muted-foreground))" } }}
                  tick={{ fontSize: 9 }}
                />
                <Legend wrapperStyle={{ fontSize: 10 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* 2 — Camera offline */}
        <Card className="aspect-square flex flex-col overflow-hidden">
          <CardHeader className="py-2 px-3">
            <CardTitle className="text-xs flex items-center gap-1"><Camera className="w-3 h-3" /> Камера</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 p-0 bg-black flex items-center justify-center">
            <div className="text-center">
              <Camera className="w-12 h-12 text-neutral-600 mx-auto mb-2" />
              <p className="text-neutral-500 text-sm font-mono">CAMERA OFFLINE</p>
              <p className="text-neutral-700 text-[10px] font-mono mt-1">NO SIGNAL</p>
            </div>
          </CardContent>
        </Card>

        {/* 3 — Chat with operator */}
        <Card className="aspect-square flex flex-col">
          <CardHeader className="py-2 px-3">
            <CardTitle className="text-xs">💬 Чат с оператором</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 p-2 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto border border-border rounded-md p-2 mb-2 bg-muted/30">
              {chatMessages.length === 0 && (
                <p className="text-xs text-muted-foreground text-center mt-8">Нет сообщений</p>
              )}
              {chatMessages.map((m, i) => (
                <div key={i} className={`mb-1.5 flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`rounded-lg px-2.5 py-1.5 text-xs max-w-[80%] ${
                    m.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground"
                  }`}>
                    {m.text}
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <div className="flex gap-1.5">
              <input
                className="flex-1 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="Написать оператору..."
                value={message}
                onChange={e => setMessage(e.target.value)}
                onKeyDown={e => e.key === "Enter" && sendMessage()}
              />
              <Button size="sm" className="h-7 px-2" onClick={sendMessage}>
                <Send className="w-3 h-3" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* 4 — Map with location */}
        <Card className="aspect-square flex flex-col overflow-hidden">
          <CardHeader className="py-2 px-3">
            <CardTitle className="text-xs flex items-center gap-1"><MapPin className="w-3 h-3" /> Местоположение</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 p-0 relative">
            <iframe
              title="Местоположение флота"
              src="https://www.openstreetmap.org/export/embed.html?bbox=53.2%2C54.15%2C53.7%2C54.35&layer=mapnik&marker=54.21%2C53.47"
              className="w-full h-full border-0"
              style={{ minHeight: 0 }}
            />
            <div className="absolute bottom-0 left-0 right-0 bg-black/70 px-3 py-2">
              <p className="text-[11px] text-white font-medium">📍 Месторождение Ореховое, скв. 21</p>
              <p className="text-[10px] text-white/70">Цементирование экспл. колонны · ООО «Зарубежнефть Добыча Самара»</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
