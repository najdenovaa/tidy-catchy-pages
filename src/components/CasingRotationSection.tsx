import { useMemo, useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Legend,
  BarChart, Bar,
} from "recharts";
import {
  calculateRotationTorque,
  getConnectionsForOD,
  getBondGrade,
  type ConnectionType,
  type RotationAnalysisResult,
  type FluidRheology,
} from "@/lib/casing-rotation-calculations";
import type { WellData, SlurryInput } from "@/lib/cementing-calculations";
import type { CentralizerInterval } from "@/lib/centralization-calculations";

interface Props {
  wellData: WellData;
  drillingFluid: { density: number; rheology?: { pv: number; yp: number } };
  slurries?: SlurryInput[];
  centralizerIntervals?: CentralizerInterval[];
  baseDisplacementEff?: number;
  avgEccentricity?: number;
}

export default function CasingRotationSection({
  wellData, drillingFluid, slurries = [], centralizerIntervals = [], baseDisplacementEff = 65, avgEccentricity = 0.4,
}: Props) {
  const connOptions = useMemo(() => getConnectionsForOD(wellData.casingOD), [wellData.casingOD]);
  const [connId, setConnId] = useState<string>(connOptions[0]?.id || "");
  useEffect(() => { if (!connOptions.find(c => c.id === connId)) setConnId(connOptions[0]?.id || ""); }, [connOptions, connId]);
  const connection: ConnectionType | undefined = connOptions.find(c => c.id === connId) || connOptions[0];

  const [rpm, setRpm] = useState(25);
  const [frictionCoeff, setFrictionCoeff] = useState(0.25);
  const [useCementRheology, setUseCementRheology] = useState(false);
  const [stopRings, setStopRings] = useState<{ depthMD: number; od_mm: number }[]>([]);
  const [crossovers, setCrossovers] = useState<{ depthMD: number; od_mm: number; torqueAdd_Nm: number }[]>([]);

  // Превращаем интервалы центраторов в точечный массив
  const centralizers = useMemo(() => {
    const arr: { depthMD: number; type: 'rigid' | 'spring' | 'solid'; od_mm: number; dragTorque_Nm?: number }[] = [];
    for (const iv of centralizerIntervals) {
      const length = iv.toMD - iv.fromMD;
      const joints = Math.max(1, Math.floor(length / Math.max(1, iv.jointLength)));
      const count = Math.max(0, Math.round(joints * (iv.centralizersPerJoint || 0)));
      if (count <= 0) continue;
      const step = length / count;
      const t = iv.spec?.type as string | undefined;
      const type = (t === 'solid' || t === 'rigid' || t === 'spring' ? t : 'rigid') as 'rigid' | 'spring' | 'solid';
      for (let i = 0; i < count; i++) {
        arr.push({ depthMD: iv.fromMD + step * (i + 0.5), type, od_mm: wellData.holeDiameter * 0.95 });
      }
    }
    return arr;
  }, [centralizerIntervals, wellData.holeDiameter]);

  const cementFluid: FluidRheology | null = useMemo(() => {
    const s = slurries[0];
    if (!s) return null;
    return {
      density: (s.density || 1.85) * 1000,
      pv: s.rheology?.pv ?? 50,
      yp: s.rheology?.yp ?? 18,
      name: s.name || 'цемент',
    };
  }, [slurries]);

  const annulusFluid: FluidRheology = useCementRheology && cementFluid
    ? cementFluid
    : {
        density: drillingFluid.density,
        pv: drillingFluid.rheology?.pv ?? 25,
        yp: drillingFluid.rheology?.yp ?? 12,
        name: 'буровой раствор',
      };

  const result: RotationAnalysisResult | null = useMemo(() => {
    if (!connection) return null;
    try {
      return calculateRotationTorque({
        wellData,
        connection,
        rpm,
        frictionCoeff,
        annulusFluid,
        centralizers,
        stopRings,
        crossovers,
        baseDisplacementEff,
        avgEccentricity,
      });
    } catch (e) { console.error(e); return null; }
  }, [wellData, connection, rpm, frictionCoeff, annulusFluid.density, annulusFluid.pv, annulusFluid.yp, centralizers, stopRings, crossovers, baseDisplacementEff, avgEccentricity]);

  if (!connection) {
    return (
      <Card className="p-6">
        <p className="text-muted-foreground">База резьбовых соединений для ОК Ø{wellData.casingOD}мм не найдена.</p>
      </Card>
    );
  }

  const chartData = result?.points.map(p => ({
    depth: p.depthMD,
    total: +(p.totalTorque / 1000).toFixed(2),
    friction: +(p.frictionTorque / 1000).toFixed(2),
    viscous: +(p.viscousTorque / 1000).toFixed(2),
    central: +(p.centralizerTorque / 1000).toFixed(2),
    maxRPM: +p.maxSafeRPM.toFixed(1),
    util: +p.utilizationPct.toFixed(1),
  })) || [];

  const limitKNm = connection.rotationTorqueLimit / 1000;
  const maxTorqueKNm = (result?.maxTorque || 0) / 1000;
  const utilTotal = (result?.maxTorque || 0) / connection.rotationTorqueLimit * 100;
  const baseGrade = getBondGrade(baseDisplacementEff);
  const boostedCqi = baseDisplacementEff + (result?.displacementImprovementPct || 0);
  const boostedGrade = getBondGrade(boostedCqi);

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h2 className="text-lg font-semibold mb-3">Вращение обсадной колонны при цементировании</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Вращение ОК срывает застойные зоны бурового на low side и повышает эффективность замещения на 15–40%.
          Модуль контролирует крутящий момент относительно предела резьбового соединения.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label>Резьбовое соединение</Label>
            <Select value={connId} onValueChange={setConnId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {connOptions.map(c => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nameRu} — {c.manufacturer} (предел {(c.rotationTorqueLimit / 1000).toFixed(1)} кН·м)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {connection.notes && <p className="text-xs text-muted-foreground mt-1">{connection.notes}</p>}
          </div>

          <div>
            <Label>Обороты вращения: {rpm} об/мин</Label>
            <Slider value={[rpm]} min={0} max={60} step={1} onValueChange={v => setRpm(v[0])} />
            <p className="text-xs text-muted-foreground mt-1">Рекомендуется 20–30 об/мин</p>
          </div>

          <div>
            <Label>Коэфф. трения: {frictionCoeff.toFixed(2)}</Label>
            <Slider value={[frictionCoeff]} min={0.15} max={0.45} step={0.01} onValueChange={v => setFrictionCoeff(v[0])} />
            <p className="text-xs text-muted-foreground mt-1">0.20 обсаженный, 0.30 открытый, 0.40 глинистый</p>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3 p-2 rounded-md bg-muted/40 border">
          <Switch id="cem-rheo" checked={useCementRheology} onCheckedChange={setUseCementRheology} disabled={!cementFluid} />
          <Label htmlFor="cem-rheo" className="text-sm cursor-pointer">
            Учитывать реологию при закачке цемента
            {cementFluid && useCementRheology && (
              <span className="text-xs text-muted-foreground ml-2">
                (PV={cementFluid.pv}, YP={cementFluid.yp}, ρ={(cementFluid.density / 1000).toFixed(2)} г/см³)
              </span>
            )}
          </Label>
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="font-semibold mb-3">КНБК: упорные кольца и переводники</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Упорные кольца ({stopRings.length})</Label>
              <Button size="sm" variant="outline" onClick={() => setStopRings([...stopRings, { depthMD: 1000, od_mm: wellData.holeDiameter - 5 }])}>
                <Plus className="h-3 w-3 mr-1" />Добавить
              </Button>
            </div>
            {stopRings.map((s, i) => (
              <div key={i} className="flex gap-2 mb-1 items-center">
                <Input type="number" value={s.depthMD} onChange={e => { const v = +e.target.value; setStopRings(stopRings.map((x, j) => j === i ? { ...x, depthMD: v } : x)); }} placeholder="Глубина, м" className="h-8" />
                <Input type="number" value={s.od_mm} onChange={e => { const v = +e.target.value; setStopRings(stopRings.map((x, j) => j === i ? { ...x, od_mm: v } : x)); }} placeholder="OD, мм" className="h-8" />
                <Button size="icon" variant="ghost" onClick={() => setStopRings(stopRings.filter((_, j) => j !== i))}><Trash2 className="h-3 w-3" /></Button>
              </div>
            ))}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Переводники ({crossovers.length})</Label>
              <Button size="sm" variant="outline" onClick={() => setCrossovers([...crossovers, { depthMD: 500, od_mm: wellData.casingOD + 10, torqueAdd_Nm: 50 }])}>
                <Plus className="h-3 w-3 mr-1" />Добавить
              </Button>
            </div>
            {crossovers.map((c, i) => (
              <div key={i} className="flex gap-2 mb-1 items-center">
                <Input type="number" value={c.depthMD} onChange={e => { const v = +e.target.value; setCrossovers(crossovers.map((x, j) => j === i ? { ...x, depthMD: v } : x)); }} placeholder="Глубина, м" className="h-8" />
                <Input type="number" value={c.od_mm} onChange={e => { const v = +e.target.value; setCrossovers(crossovers.map((x, j) => j === i ? { ...x, od_mm: v } : x)); }} placeholder="OD, мм" className="h-8" />
                <Input type="number" value={c.torqueAdd_Nm} onChange={e => { const v = +e.target.value; setCrossovers(crossovers.map((x, j) => j === i ? { ...x, torqueAdd_Nm: v } : x)); }} placeholder="ΔM, Нм" className="h-8" />
                <Button size="icon" variant="ghost" onClick={() => setCrossovers(crossovers.filter((_, j) => j !== i))}><Trash2 className="h-3 w-3" /></Button>
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-2">Башмак и ЦКОД учтены автоматически как граничные элементы колонны. Центраторы подгружены из вкладки «Центрирование».</p>
      </Card>

      {result && (
        <>
          <Card className="p-4">
            <h3 className="font-semibold mb-3">Сводка</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <Metric label="Предел резьбы" value={`${limitKNm.toFixed(1)} кН·м`} />
              <Metric label={`Макс. момент при ${rpm} об/мин`} value={`${maxTorqueKNm.toFixed(1)} кН·м (${utilTotal.toFixed(0)}%)`}
                tone={utilTotal > 100 ? 'red' : utilTotal > 80 ? 'amber' : 'green'} />
              <Metric label="Макс. безопасные обороты" value={`${result.maxSafeRPM.toFixed(0)} об/мин`} />
              <Metric label="Критическая глубина"
                value={result.criticalDepth ? `${result.criticalDepth.toFixed(0)} м` : 'нет'}
                tone={result.criticalDepth ? 'red' : 'green'} />
              <Metric label="CQI без вращения" value={`${baseDisplacementEff.toFixed(0)}% (${baseGrade.grade})`} />
              <Metric label={`CQI с вращением ${rpm}`} value={`${boostedCqi.toFixed(0)}% (${boostedGrade.grade})`} tone="green" />
              <Metric label="Прирост замещения" value={`+${result.displacementImprovementPct.toFixed(1)}%`} tone="green" />
              <Metric label="Эксцентриситет (ср.)" value={avgEccentricity.toFixed(2)} />
            </div>

            {result.warnings.length > 0 && (
              <div className="mt-3 space-y-1">
                {result.warnings.map((w, i) => (
                  <div key={i} className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">⚠ {w}</div>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-4">
            <h3 className="font-semibold mb-3">Крутящий момент по глубине</h3>
            <ResponsiveContainer width="100%" height={400}>
              <LineChart data={chartData} layout="vertical" margin={{ top: 10, right: 20, left: 20, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" label={{ value: 'Момент, кН·м', position: 'insideBottom', offset: -5 }} />
                <YAxis type="number" dataKey="depth" reversed label={{ value: 'Глубина, м', angle: -90, position: 'insideLeft' }} domain={[0, 'dataMax']} />
                <Tooltip />
                <Legend />
                <ReferenceLine x={limitKNm} stroke="#dc2626" strokeWidth={2} label={{ value: 'Предел резьбы', fill: '#dc2626', position: 'top' }} />
                <ReferenceLine x={limitKNm * 0.8} stroke="#ca8a04" strokeDasharray="4 4" label={{ value: '80%', fill: '#ca8a04' }} />
                <Line type="monotone" dataKey="total" name="Суммарный" stroke="#1e40af" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="friction" name="Трение+муфты" stroke="#65a30d" dot={false} />
                <Line type="monotone" dataKey="viscous" name="Вязкостный" stroke="#0891b2" dot={false} />
                <Line type="monotone" dataKey="central" name="Центраторы" stroke="#a855f7" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </Card>

          <Card className="p-4">
            <h3 className="font-semibold mb-3">Момент по фазам цементирования</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={result.torqueByPhase.map(p => ({
                phase: p.phase,
                max: +(p.maxTorque / 1000).toFixed(2),
                avg: +(p.avgTorque / 1000).toFixed(2),
                fluid: p.fluidInAnnulus,
              }))}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="phase" />
                <YAxis label={{ value: 'Момент, кН·м', angle: -90, position: 'insideLeft' }} />
                <Tooltip formatter={(v: any, n: any) => [`${v} кН·м`, n === 'max' ? 'Макс.' : 'Сред.']} />
                <Legend />
                <ReferenceLine y={limitKNm} stroke="#dc2626" strokeWidth={2} label={{ value: 'Предел', fill: '#dc2626' }} />
                <Bar dataKey="avg" name="Средний" fill="#0891b2" />
                <Bar dataKey="max" name="Макс." fill="#1e40af" />
              </BarChart>
            </ResponsiveContainer>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2 text-xs">
              {result.torqueByPhase.map(p => (
                <div key={p.phase} className="border rounded px-2 py-1">
                  <div className="font-medium">{p.phase}</div>
                  <div className="text-muted-foreground">флюид: {p.fluidInAnnulus}</div>
                  <div>макс. RPM: {p.maxRPM.toFixed(0)}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <h3 className="font-semibold mb-3">Макс. безопасные обороты по глубине</h3>
            <ResponsiveContainer width="100%" height={350}>
              <LineChart data={chartData} layout="vertical" margin={{ top: 10, right: 20, left: 20, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" label={{ value: 'RPM', position: 'insideBottom', offset: -5 }} domain={[0, 60]} />
                <YAxis type="number" dataKey="depth" reversed label={{ value: 'Глубина, м', angle: -90, position: 'insideLeft' }} />
                <Tooltip />
                <ReferenceLine x={20} stroke="#16a34a" strokeDasharray="4 4" label={{ value: 'Реком. мин', fill: '#16a34a' }} />
                <ReferenceLine x={30} stroke="#16a34a" strokeDasharray="4 4" label={{ value: 'Реком. макс', fill: '#16a34a' }} />
                <Line type="monotone" dataKey="maxRPM" name="Макс. безопасные обороты" stroke="#1e40af" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </Card>

          <Card className="p-4">
            <h3 className="font-semibold mb-3">Улучшение замещения от вращения</h3>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={[
                { mode: 'Без вращения', cqi: +baseDisplacementEff.toFixed(1) },
                { mode: `С вращением ${rpm} об/мин`, cqi: +boostedCqi.toFixed(1) },
              ]}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="mode" />
                <YAxis label={{ value: 'CQI, %', angle: -90, position: 'insideLeft' }} domain={[0, 100]} />
                <Tooltip formatter={(v: any) => [`${v}%`, 'CQI']} />
                <Bar dataKey="cqi" fill="#1e40af" />
              </BarChart>
            </ResponsiveContainer>
            <div className="flex gap-2 items-center mt-2 text-sm">
              <Badge style={{ background: baseGrade.color }}>{baseGrade.grade}</Badge>
              <span className="text-muted-foreground">→</span>
              <Badge style={{ background: boostedGrade.color }}>{boostedGrade.grade}</Badge>
              <span className="text-muted-foreground">— грейд качества контакта</span>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'green' | 'amber' | 'red' }) {
  const color = tone === 'red' ? 'text-red-600' : tone === 'amber' ? 'text-amber-600' : tone === 'green' ? 'text-emerald-600' : 'text-foreground';
  return (
    <div className="border rounded-md p-2 bg-card">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`font-semibold ${color}`}>{value}</div>
    </div>
  );
}
