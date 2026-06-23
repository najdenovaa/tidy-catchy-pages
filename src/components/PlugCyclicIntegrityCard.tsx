import { useMemo, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { BlurInput } from "@/components/BlurInput";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Plus, Trash2, Activity } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, Cell,
} from "recharts";
import { calculatePlugCyclicIntegrity, type CycleBlock } from "@/lib/cement-plug-cyclic";

interface Props {
  plugLengthM: number;
  boreDiameterMm: number;
  /** Inner pipe OD if pipe stays inside, else 0 */
  innerPipeODmm?: number;
  /** UCS at WOC end (MPa) — taken from load-capacity context */
  defaultUcsMPa?: number;
}

function num(v: string): number {
  const n = parseFloat(v.replace(",", "."));
  return isNaN(n) ? 0 : n;
}

function NumField({ label, unit, value, onChange, step = "1", className = "" }: {
  label: string; unit?: string; value: number;
  onChange: (v: number) => void; step?: string; className?: string;
}) {
  return (
    <div className={`space-y-1 ${className}`}>
      <Label className="text-xs">{label}{unit ? ` (${unit})` : ""}</Label>
      <BlurInput type="number" step={step} value={String(value)}
        onValueCommit={(v) => onChange(num(v))} className="h-8 text-sm" />
    </div>
  );
}

export default function PlugCyclicIntegrityCard(props: Props) {
  const [ucs, setUcs] = useState(props.defaultUcsMPa ?? 20);
  const [E, setE] = useState(10);          // GPa
  const [nu, setNu] = useState(0.20);
  const [alpha, setAlpha] = useState(10);  // ×10⁻⁶ 1/°C
  const [blocks, setBlocks] = useState<CycleBlock[]>([
    { label: "Опрессовка", cycles: 5, deltaT_C: 0, deltaP_MPa: 15, R: 0 },
    { label: "Термоцикл закачка/останов", cycles: 100, deltaT_C: 40, deltaP_MPa: 3, R: 0.1 },
  ]);

  const res = useMemo(() => calculatePlugCyclicIntegrity({
    ucsMPa: ucs,
    youngModulusGPa: E,
    poisson: nu,
    thermalExpansion_perC: alpha * 1e-6,
    plugLengthM: props.plugLengthM,
    boreRadiusM: (props.boreDiameterMm / 1000) / 2,
    innerRadiusM: (props.innerPipeODmm ?? 0) / 1000 / 2,
    blocks,
  }), [ucs, E, nu, alpha, blocks, props.plugLengthM, props.boreDiameterMm, props.innerPipeODmm]);

  const updateBlock = (i: number, key: keyof CycleBlock, val: string | number) => {
    setBlocks(bs => bs.map((b, idx) => idx === i ? { ...b, [key]: typeof val === "string" && key === "label" ? val : num(String(val)) } : b));
  };

  const statusColor =
    res.status === "safe" ? "default" :
    res.status === "warn" ? "secondary" : "destructive";
  const statusText =
    res.status === "safe" ? "Ресурс есть" :
    res.status === "warn" ? "Сниженный ресурс" : "Не проходит";

  const chartData = res.blocks.map(b => ({ name: b.label, D: b.damage }));

  return (
    <Card>
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm flex items-center gap-2">
          <Activity className="w-4 h-4 text-purple-600" />
          Целостность при циклических нагрузках (Aas-Jakobsen, Miner)
          <Badge variant={statusColor} className="ml-auto">{statusText}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Material props */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <NumField label="UCS" unit="МПа" value={ucs} onChange={setUcs} step="0.5" />
          <NumField label="E цемента" unit="ГПа" value={E} onChange={setE} step="0.5" />
          <NumField label="ν Пуассона" value={nu} onChange={setNu} step="0.01" />
          <NumField label="α ×10⁻⁶" unit="1/°C" value={alpha} onChange={setAlpha} step="0.5" />
        </div>

        {/* Cycle blocks */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Блоки циклов</span>
            <Button size="sm" variant="outline" className="h-7"
              onClick={() => setBlocks(b => [...b, { label: `Блок ${b.length + 1}`, cycles: 10, deltaT_C: 20, deltaP_MPa: 5, R: 0 }])}>
              <Plus className="w-3 h-3 mr-1" />Добавить
            </Button>
          </div>
          <div className="space-y-1.5">
            {blocks.map((b, i) => (
              <div key={i} className="grid grid-cols-12 gap-1 items-end">
                <div className="col-span-3">
                  <Label className="text-[10px]">Название</Label>
                  <BlurInput value={b.label || ""} onValueCommit={(v) => setBlocks(bs => bs.map((bb, idx) => idx === i ? { ...bb, label: v } : bb))} className="h-8 text-xs" />
                </div>
                <div className="col-span-2"><NumField label="n циклов" value={b.cycles} onChange={(v) => updateBlock(i, "cycles", v)} step="1" /></div>
                <div className="col-span-2"><NumField label="ΔT" unit="°C" value={b.deltaT_C} onChange={(v) => updateBlock(i, "deltaT_C", v)} step="1" /></div>
                <div className="col-span-2"><NumField label="ΔP" unit="МПа" value={b.deltaP_MPa} onChange={(v) => updateBlock(i, "deltaP_MPa", v)} step="0.5" /></div>
                <div className="col-span-2"><NumField label="R" value={b.R} onChange={(v) => updateBlock(i, "R", v)} step="0.05" /></div>
                <div className="col-span-1">
                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0"
                    onClick={() => setBlocks(bs => bs.filter((_, idx) => idx !== i))}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Per-block result table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left p-1.5">Блок</th>
                <th className="text-right p-1.5">σ_термо, МПа</th>
                <th className="text-right p-1.5">σ_θ, МПа</th>
                <th className="text-right p-1.5">σ_max, МПа</th>
                <th className="text-right p-1.5">S</th>
                <th className="text-right p-1.5">N_f</th>
                <th className="text-right p-1.5">D = n/N_f</th>
              </tr>
            </thead>
            <tbody>
              {res.blocks.map((b, i) => (
                <tr key={i} className="border-t">
                  <td className="p-1.5">{b.label}</td>
                  <td className="text-right p-1.5">{b.thermalStressMPa.toFixed(2)}</td>
                  <td className="text-right p-1.5">{b.pressureHoopMPa.toFixed(2)}</td>
                  <td className="text-right p-1.5 font-medium">{b.combinedMaxMPa.toFixed(2)}</td>
                  <td className="text-right p-1.5">{b.sMax.toFixed(3)}</td>
                  <td className="text-right p-1.5">{b.Nf >= 99999999 ? "∞" : b.Nf.toLocaleString()}</td>
                  <td className={`text-right p-1.5 ${b.damage >= 1 ? "text-red-700 font-bold" : b.damage >= 0.5 ? "text-amber-700" : ""}`}>
                    {b.damage.toFixed(4)}
                  </td>
                </tr>
              ))}
              <tr className="border-t bg-muted/30 font-medium">
                <td colSpan={6} className="text-right p-1.5">Σ D (Miner):</td>
                <td className={`text-right p-1.5 ${res.totalDamage >= 1 ? "text-red-700" : res.totalDamage >= 0.5 ? "text-amber-700" : "text-green-700"}`}>
                  {res.totalDamage.toFixed(4)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Damage chart */}
        <div style={{ width: "100%", height: 160 }}>
          <ResponsiveContainer>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} label={{ value: "Damage", angle: -90, position: "insideLeft", fontSize: 10 }} />
              <Tooltip />
              <ReferenceLine y={1} stroke="#dc2626" strokeDasharray="4 4"
                label={{ value: "D=1 (отказ)", fontSize: 10, fill: "#dc2626" }} />
              <Bar dataKey="D">
                {chartData.map((d, i) => (
                  <Cell key={i} fill={d.D >= 1 ? "#dc2626" : d.D >= 0.5 ? "#d97706" : "#16a34a"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Bond / debond */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <Mini label="f_t (растяж.)" value={`${res.tensileStrengthMPa} МПа`} />
          <Mini label="σ_h гидр. сцепл." value={`${res.hydraulicBondMPa} МПа`} />
          <Mini label="τ_b сдвиг. сцепл." value={`${res.shearBondMPa} МПа`} />
          <Mini label="Микрозазор" value={res.debond ? `${res.microAnnulusUm} μm` : "—"} warn={res.debond} />
        </div>

        {res.warnings.length > 0 && (
          <div className="space-y-1">
            {res.warnings.map((w, i) => <div key={i} className="text-xs leading-snug">{w}</div>)}
          </div>
        )}

        <Alert>
          <AlertDescription className="text-xs whitespace-pre-line">
            {res.recommendation}
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}

function Mini({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`rounded border p-2 ${warn ? "border-red-300 bg-red-50" : "bg-muted/30"}`}>
      <div className="text-[10px] text-muted-foreground uppercase">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
