import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Camera, Send, MapPin, Gauge } from "lucide-react";
import CementingUnitSchematic from "@/components/CementingUnitSchematic";
import { useState, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Legend,
  ResponsiveContainer, Tooltip,
} from "recharts";

interface FleetConfig {
  fleet_number: number;
  is_online: boolean;
  brigade: string;
  operation: string;
  field_name: string;
  well_number: string;
  customer: string;
  signal_type: string;
  pressure: number;
  rate: number;
  density: number;
  volume: number;
  temperature: number;
  tank1_capacity: number;
  tank1_level: number;
  tank2_capacity: number;
  tank2_level: number;
  engine1_rpm: number;
  engine2_rpm: number;
  casing_diameter: string;
}

function generateLiveData(cfg: FleetConfig) {
  if (!cfg.is_online || cfg.volume <= 0) return [];
  const totalTime = cfg.volume / (cfg.rate > 0 ? cfg.rate / 1000 : 6 / 1000);
  const totalMin = Math.min(totalTime / 60, 30);
  const steps = 20;
  const dt = totalMin / steps;
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = parseFloat((i * dt).toFixed(1));
    const frac = i / steps;
    points.push({
      time: t,
      pressure: i === 0 ? 0 : parseFloat((cfg.pressure * (0.3 + 0.7 * frac) + (Math.random() - 0.5) * 0.3).toFixed(1)),
      rate: i === 0 ? 0 : parseFloat((cfg.rate * (0.8 + 0.2 * Math.random())).toFixed(1)),
      density: i < 2 ? null : parseFloat((cfg.density + (Math.random() - 0.5) * 0.02).toFixed(2)),
      volume: parseFloat((cfg.volume * frac).toFixed(2)),
      temp: parseFloat((cfg.temperature - 3 + 3 * frac + (Math.random() - 0.5) * 0.3).toFixed(1)),
    });
  }
  return points;
}

export default function FleetDetail() {
  const navigate = useNavigate();
  const { id } = useParams();
  const fleetNum = parseInt(id || "5");
  const [config, setConfig] = useState<FleetConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [chatMessages, setChatMessages] = useState<{ role: "user" | "operator"; text: string }[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("fleet_configs")
        .select("*")
        .eq("fleet_number", fleetNum)
        .single();
      if (data) setConfig(data as unknown as FleetConfig);
      setLoading(false);
    };
    load();
  }, [fleetNum]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const sendMessage = () => {
    if (!message.trim()) return;
    setChatMessages(prev => [...prev, { role: "user", text: message.trim() }]);
    setMessage("");
  };

  if (loading) return <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">Загрузка...</div>;
  if (!config) return <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">Флот не найден</div>;

  const liveData = generateLiveData(config);
  const casingLabel = config.casing_diameter ? ` ЭК ${config.casing_diameter}мм` : "";

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="flex items-center gap-3 mb-1">
        <Button variant="ghost" size="sm" onClick={() => navigate("/admin")}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Назад
        </Button>
        <h1 className="text-lg font-bold text-foreground">{config.fleet_number} флот</h1>
        <div className="flex items-center gap-1.5 ml-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className={`absolute inline-flex h-full w-full rounded-full ${config.is_online ? "bg-green-500" : "bg-red-500"} opacity-75 animate-ping`} />
            <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${config.is_online ? "bg-green-500" : "bg-red-500"}`} />
          </span>
          <span className={`text-xs ${config.is_online ? "text-green-500" : "text-red-500"} font-medium`}>{config.is_online ? "online" : "offline"}</span>
        </div>
      </div>
      <div className="text-xs text-muted-foreground mb-4 ml-1 space-y-0.5">
        {config.brigade && (
          <p><span className="font-medium text-foreground">Бригада:</span> {config.brigade} · <span className="font-medium text-foreground">Работа:</span> {config.operation}{casingLabel}</p>
        )}
        {config.field_name && (
          <p><span className="font-medium text-foreground">Месторождение:</span> {config.field_name}, скв. {config.well_number} · <span className="font-medium text-foreground">Заказчик:</span> {config.customer}</p>
        )}
        <p className="flex items-center gap-3">
          <span className="font-medium text-foreground">Сигнал:</span>
          <span className="inline-flex items-center gap-1">
            {config.signal_type === "gprs" ? <span className="text-green-500">✔</span> : <span className="text-muted-foreground/50">○</span>} GPRS
          </span>
          <span className="inline-flex items-center gap-1">
            {config.signal_type === "satellite" ? <span className="text-green-500">✔</span> : <span className="text-muted-foreground/50">○</span>} Спутник ГП ЯМАЛ 401
          </span>
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-[1400px] mx-auto">
        {/* 1 — Chart */}
        <Card className="aspect-square flex flex-col">
          <CardHeader className="py-2 px-3">
            <CardTitle className="text-xs">📊 График цементирования</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 p-2 flex flex-col gap-1">
            <div className="grid grid-cols-5 gap-1 text-center">
              {[
                { label: "Давление", value: config.pressure.toFixed(1), unit: "МПа", color: "text-red-500" },
                { label: "Расход", value: config.rate.toFixed(2), unit: "л/с", color: "text-blue-500" },
                { label: "Плотность", value: config.density.toFixed(2), unit: "г/см³", color: "text-pink-700" },
                { label: "Объём", value: config.volume.toFixed(2), unit: "м³", color: "text-cyan-500" },
                { label: "Темп.", value: config.temperature.toFixed(1), unit: "°C", color: "text-orange-500" },
              ].map((item) => (
                <div key={item.label} className="rounded-md border border-border bg-muted/40 py-1 px-1">
                  <p className="text-[8px] text-muted-foreground leading-tight">{item.label}</p>
                  <p className={`text-sm font-bold leading-tight ${item.color}`}>{item.value}</p>
                  <p className="text-[7px] text-muted-foreground leading-tight">{item.unit}</p>
                </div>
              ))}
            </div>
            <div className="flex-1 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={liveData} margin={{ top: 5, right: 50, left: 0, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                  <XAxis
                    dataKey="time"
                    type="number"
                    domain={[0, "auto"]}
                    tickFormatter={(v: number) => `${v}`}
                    label={{ value: "Время, мин", position: "insideBottom", offset: -5, style: { fontSize: 9, fill: "hsl(var(--muted-foreground))" } }}
                    tick={{ fontSize: 9 }}
                  />
                  <YAxis yAxisId="pressure" domain={[0, 50]} label={{ value: "Давление, МПа", angle: -90, position: "insideLeft", style: { fontSize: 9, fill: "hsl(var(--muted-foreground))" } }} tick={{ fontSize: 9 }} />
                  <YAxis yAxisId="rate" orientation="right" domain={[0, 30]} label={{ value: "Q, л/с / ρ, г/см³", angle: 90, position: "insideRight", style: { fontSize: 9, fill: "hsl(var(--muted-foreground))" } }} tick={{ fontSize: 9 }} />
                  <YAxis yAxisId="volume" orientation="right" domain={[0, 50]} label={{ value: "V, м³", angle: 90, position: "outsideRight", offset: 20, style: { fontSize: 9, fill: "hsl(var(--muted-foreground))" } }} tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line yAxisId="pressure" type="monotone" dataKey="pressure" name="Давление" stroke="hsl(0, 80%, 55%)" strokeWidth={2} dot={false} connectNulls={false} />
                  <Line yAxisId="rate" type="stepAfter" dataKey="rate" name="Расход" stroke="hsl(210, 80%, 55%)" strokeWidth={1.5} dot={false} connectNulls={false} />
                  <Line yAxisId="rate" type="stepAfter" dataKey="density" name="Плотность" stroke="hsl(330, 60%, 45%)" strokeWidth={2} strokeDasharray="6 3" dot={false} connectNulls={false} />
                  <Bar yAxisId="volume" dataKey="volume" name="Объём" fill="hsl(195, 60%, 50%)" opacity={0.3} barSize={8} />
                  <Line yAxisId="rate" type="monotone" dataKey="temp" name="Темп. °C" stroke="hsl(30, 80%, 50%)" strokeWidth={1.5} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
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

        {/* 3 — Chat */}
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
                  <div className={`rounded-lg px-2.5 py-1.5 text-xs max-w-[80%] ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>
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

        {/* 4 — Map */}
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
              <p className="text-[11px] text-white font-medium">📍 Месторождение {config.field_name || "—"}, скв. {config.well_number || "—"}</p>
              <p className="text-[10px] text-white/70">{config.operation} · {config.customer}</p>
            </div>
          </CardContent>
        </Card>

        {/* 5 — Unit schematic */}
        <Card className="aspect-square flex flex-col md:col-span-2">
          <CardHeader className="py-2 px-3">
            <CardTitle className="text-xs flex items-center gap-1"><Gauge className="w-3 h-3" /> Блок-схема агрегата</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 p-2 min-h-0">
            <CementingUnitSchematic
              tank1Level={config.tank1_level}
              tank1Capacity={config.tank1_capacity}
              tank2Level={config.tank2_level}
              tank2Capacity={config.tank2_capacity}
              engine1Rpm={config.engine1_rpm}
              engine2Rpm={config.engine2_rpm}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
