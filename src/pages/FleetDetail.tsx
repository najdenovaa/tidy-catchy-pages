import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Camera, Send, MapPin } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Legend,
  ResponsiveContainer, Tooltip,
} from "recharts";

// Simulated "live" data: buffer → cement, jagged real-time style (pressure in MPa, 65 atm ≈ 6.5 MPa)
const LIVE_DATA: { time: number; pressure: number | null; rate: number | null; density: number | null; volume: number | null }[] = [
  { time: 0, pressure: 0, rate: 0, density: null, volume: 0 },
  { time: 1, pressure: 0.2, rate: 0, density: null, volume: 0 },
  // Buffer start
  { time: 2, pressure: 1.8, rate: 4.2, density: 1.02, volume: 0.05 },
  { time: 3, pressure: 2.5, rate: 5.8, density: 1.02, volume: 0.12 },
  { time: 4, pressure: 3.2, rate: 6.1, density: 1.03, volume: 0.21 },
  { time: 5, pressure: 3.8, rate: 5.5, density: 1.02, volume: 0.30 },
  { time: 6, pressure: 4.1, rate: 6.3, density: 1.03, volume: 0.40 },
  { time: 7, pressure: 4.4, rate: 5.9, density: 1.02, volume: 0.48 },
  { time: 8, pressure: 4.2, rate: 6.0, density: 1.02, volume: 0.55 },
  { time: 9, pressure: 4.5, rate: 5.7, density: 1.03, volume: 0.62 },
  // Transition buffer → cement
  { time: 10, pressure: 4.8, rate: 5.2, density: 1.05, volume: 0.68 },
  { time: 11, pressure: 5.2, rate: 4.8, density: 1.08, volume: 0.73 },
  // Cement start
  { time: 12, pressure: 5.6, rate: 5.5, density: 1.14, volume: 0.80 },
  { time: 13, pressure: 6.0, rate: 5.8, density: 1.18, volume: 0.88 },
  { time: 14, pressure: 6.3, rate: 6.2, density: 1.20, volume: 0.97 },
  { time: 15, pressure: 6.5, rate: 5.9, density: 1.20, volume: 1.05 },
  { time: 16, pressure: 6.7, rate: 6.4, density: 1.21, volume: 1.14 },
  { time: 17, pressure: 6.4, rate: 5.7, density: 1.20, volume: 1.22 },
  { time: 18, pressure: 6.6, rate: 6.1, density: 1.20, volume: 1.31 },
  { time: 19, pressure: 6.8, rate: 5.8, density: 1.19, volume: 1.40 },
  { time: 20, pressure: 6.5, rate: 6.0, density: 1.20, volume: 1.48 },
  { time: 21, pressure: 6.7, rate: 6.3, density: 1.21, volume: 1.56 },
  { time: 22, pressure: 6.4, rate: 5.6, density: 1.20, volume: 1.63 },
  { time: 23, pressure: 6.6, rate: 5.9, density: 1.20, volume: 1.70 },
  { time: 24, pressure: 6.5, rate: 6.1, density: 1.20, volume: 1.75 },
  { time: 25, pressure: 6.5, rate: 6.1, density: 1.20, volume: 1.75 },
];

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
      <div className="flex items-center gap-3 mb-1">
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
      <div className="text-xs text-muted-foreground mb-4 ml-1 space-y-0.5">
        <p><span className="font-medium text-foreground">Бригада:</span> Портнова А.В. · <span className="font-medium text-foreground">Работа:</span> Цементирование ЭК 146мм</p>
        <p><span className="font-medium text-foreground">Месторождение:</span> Ореховое, скв. 21 · <span className="font-medium text-foreground">Заказчик:</span> ООО «Зарубежнефть Добыча Самара»</p>
        <p className="flex items-center gap-3">
          <span className="font-medium text-foreground">Сигнал:</span>
          <span className="inline-flex items-center gap-1"><span className="text-green-500">✔</span> GPRS</span>
          <span className="inline-flex items-center gap-1 text-muted-foreground/50">○ Спутник ГП ЯМАЛ 401</span>
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-[1400px] mx-auto">
        {/* 1 — Empty cementing chart */}
        <Card className="aspect-square flex flex-col">
          <CardHeader className="py-2 px-3">
            <CardTitle className="text-xs">📊 График цементирования</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 p-2">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={LIVE_DATA} margin={{ top: 5, right: 50, left: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                <XAxis
                  dataKey="time"
                  type="number"
                  domain={[0, 100]}
                  tickFormatter={(v: number) => `${v}`}
                  label={{ value: "Время, мин", position: "insideBottom", offset: -5, style: { fontSize: 9, fill: "hsl(var(--muted-foreground))" } }}
                  tick={{ fontSize: 9 }}
                />
                {/* Left Y — Pressure */}
                <YAxis
                  yAxisId="pressure"
                  domain={[0, 50]}
                  label={{ value: "Давление, МПа", angle: -90, position: "insideLeft", style: { fontSize: 9, fill: "hsl(var(--muted-foreground))" } }}
                  tick={{ fontSize: 9 }}
                />
                {/* Right Y1 — Rate + Density */}
                <YAxis
                  yAxisId="rate"
                  orientation="right"
                  domain={[0, 30]}
                  label={{ value: "Q, л/с / ρ, г/см³", angle: 90, position: "insideRight", style: { fontSize: 9, fill: "hsl(var(--muted-foreground))" } }}
                  tick={{ fontSize: 9 }}
                />
                {/* Right Y2 — Volume */}
                <YAxis
                  yAxisId="volume"
                  orientation="right"
                  domain={[0, 50]}
                  label={{ value: "V, м³", angle: 90, position: "outsideRight", offset: 20, style: { fontSize: 9, fill: "hsl(var(--muted-foreground))" } }}
                  tick={{ fontSize: 9 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Line yAxisId="pressure" type="monotone" dataKey="pressure" name="Давление" stroke="hsl(0, 80%, 55%)" strokeWidth={2} dot={false} connectNulls={false} />
                <Line yAxisId="rate" type="stepAfter" dataKey="rate" name="Расход" stroke="hsl(210, 80%, 55%)" strokeWidth={1.5} dot={false} connectNulls={false} />
                <Line yAxisId="rate" type="stepAfter" dataKey="density" name="Плотность" stroke="hsl(330, 60%, 45%)" strokeWidth={2} strokeDasharray="6 3" dot={false} connectNulls={false} />
                <Bar yAxisId="volume" dataKey="volume" name="Объём" fill="hsl(195, 60%, 50%)" opacity={0.3} barSize={8} />
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
