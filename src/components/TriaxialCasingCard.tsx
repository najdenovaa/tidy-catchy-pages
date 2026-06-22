import { useMemo, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield, AlertTriangle, CheckCircle2 } from "lucide-react";
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ZAxis, ReferenceLine, Cell, BarChart, Bar, Legend } from "recharts";
import CopyImageButton from "@/components/CopyImageButton";
import { calculateTriaxial, type CasingLoadCase, type CasingGrade, GRADE_YIELD_MPA } from "@/lib/casing-triaxial";
import type { WellData } from "@/lib/cementing-calculations";

interface Props {
  wellData: WellData;
  mudDensity: number;
  /** Макс. устьевое давление при цементировании, МПа (для burst) */
  maxSurfacePressureMPa?: number;
  /** Опрессовочное давление, МПа */
  pressureTestMPa?: number;
}

const G = 9.81;

const GRADE_OPTIONS: CasingGrade[] = ["J-55", "K-55", "N-80", "L-80", "C-90", "P-110", "Q-125"];

export default function TriaxialCasingCard({ wellData, mudDensity, maxSurfacePressureMPa = 0, pressureTestMPa = 0 }: Props) {
  const [grade, setGrade] = useState<CasingGrade>("N-80");
  const [df, setDf] = useState({ burst: 1.10, collapse: 1.125, tension: 1.60, vme: 1.25 });
  const chartRef = useRef<HTMLDivElement>(null);
  const utilRef = useRef<HTMLDivElement>(null);

  const result = useMemo(() => {
    if (!wellData.casingOD || !wellData.casingWall || !wellData.wellDepthTVD) return null;

    const tvd = wellData.wellDepthTVD;
    const pHydMud = mudDensity * G * tvd / 1e6;
    const A = Math.PI / 4 * (Math.pow(wellData.casingOD / 1000, 2) - Math.pow((wellData.casingOD - 2 * wellData.casingWall) / 1000, 2));
    const weightKgM = A * 7850;
    const buoyancy = 1 - mudDensity / 7850;
    const hangingWeightKN = weightKgM * G * tvd * buoyancy / 1000;

    // Стандартные сценарии (API/ISO 10400 + промысловая практика для цементирования)
    const loadCases: CasingLoadCase[] = [
      {
        name: "Опрессовка (burst)",
        internalPressureMPa: (pressureTestMPa > 0 ? pressureTestMPa : maxSurfacePressureMPa * 1.1) + pHydMud,
        externalPressureMPa: pHydMud, // backup = mud snaружи
        axialForceKN: hangingWeightKN,
      },
      {
        name: "Цементирование (bump plug)",
        internalPressureMPa: (maxSurfacePressureMPa || pHydMud * 0.3) + pHydMud,
        externalPressureMPa: pHydMud * 1.05, // цемент в затрубье плотнее
        axialForceKN: hangingWeightKN + 500, // bump pressure → overpull
      },
      {
        name: "Эвакуация (collapse)",
        internalPressureMPa: 0,
        externalPressureMPa: pHydMud,
        axialForceKN: hangingWeightKN * 0.7,
      },
      {
        name: "Подвес в собственном весе",
        internalPressureMPa: pHydMud,
        externalPressureMPa: pHydMud,
        axialForceKN: hangingWeightKN,
      },
    ];

    return calculateTriaxial({
      od: wellData.casingOD,
      wall: wellData.casingWall,
      grade,
      designFactor: df,
      loadCases,
    });
  }, [wellData, mudDensity, grade, df, maxSurfacePressureMPa, pressureTestMPa]);

  if (!result) {
    return (
      <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">
        Заполните параметры обсадной колонны для триаксиального анализа.
      </CardContent></Card>
    );
  }

  const utilData = result.cases.map(c => ({
    name: c.case,
    Burst: +(c.burstUtilDF * 100).toFixed(0),
    Collapse: +(c.collapseUtilDF * 100).toFixed(0),
    Tension: +(c.tensionUtilDF * 100).toFixed(0),
    VME: +(c.vmeUtilDF * 100).toFixed(0),
    worst: c.worstUtilDF,
  }));

  const envelopeData = result.envelope.filter(p => Math.abs(p.pressureMPa) < result.limits.burstBarlowMPa * 1.2);
  const caseDots = result.cases.map(c => ({
    axial: c.axialStressMPa,
    dp: c.case.includes("Эвак") ? -(c.collapseUtilDF * result.limits.collapseMPa)
       : c.burstUtilDF * result.limits.burstBarlowMPa,
    name: c.case,
  }));

  const worstAny = result.cases.reduce((m, c) => Math.max(m, c.worstUtilDF), 0);
  const allPass = result.cases.every(c => c.pass);

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-lg flex items-center gap-2">
          <Shield className="h-5 w-5 text-indigo-600" />
          Триаксиальный анализ обсадной колонны (API TR 5C3 · VME)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Inputs */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Группа прочности</label>
            <select value={grade} onChange={e => setGrade(e.target.value as CasingGrade)}
              className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background">
              {GRADE_OPTIONS.map(g => <option key={g} value={g}>{g} · σ_T = {GRADE_YIELD_MPA[g]} МПа</option>)}
            </select>
          </div>
          {(["burst","collapse","tension","vme"] as const).map(k => (
            <div key={k}>
              <label className="text-xs text-muted-foreground">DF {k}</label>
              <input type="number" step="0.05" value={df[k]} onChange={e => setDf({ ...df, [k]: +e.target.value })}
                className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
            </div>
          ))}
        </div>

        {/* Limits */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Tile label="Burst (Barlow)" value={`${result.limits.burstBarlowMPa.toFixed(1)} МПа`} />
          <Tile label={`Collapse (${result.limits.collapseRegime})`} value={`${result.limits.collapseMPa.toFixed(1)} МПа`} />
          <Tile label="Axial yield" value={`${result.limits.axialYieldKN.toFixed(0)} кН`} />
          <Tile label="Вес 1 м (в воздухе)" value={`${result.limits.weightPerMeterKgM.toFixed(1)} кг`} />
        </div>

        {/* Headline */}
        <div className={`border rounded-lg p-3 ${allPass ? "border-emerald-500/40 bg-emerald-500/5" : "border-red-500/40 bg-red-500/5"}`}>
          <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
            {allPass ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <AlertTriangle className="h-3.5 w-3.5 text-red-600" />}
            Худшая утилизация с DF
          </div>
          <div className={`text-3xl font-bold ${allPass ? "text-emerald-600" : "text-red-600"}`}>
            {(worstAny * 100).toFixed(0)}%
          </div>
        </div>

        {/* Utilization chart */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium">Утилизация по сценариям (с design factor)</div>
            <CopyImageButton targetRef={utilRef} />
          </div>
          <div ref={utilRef} className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={utilData} margin={{ top: 10, right: 20, bottom: 5, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} />
                <YAxis domain={[0, 120]} tick={{ fontSize: 10 }} label={{ value: "%", angle: -90, position: "insideLeft", style: { fontSize: 11 } }} />
                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px", fontSize: "12px" }} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <ReferenceLine y={100} stroke="hsl(0,80%,55%)" strokeDasharray="4 4" label={{ value: "100% DF", fill: "hsl(0,80%,55%)", fontSize: 10 }} />
                <Bar dataKey="Burst" fill="hsl(0,75%,55%)" />
                <Bar dataKey="Collapse" fill="hsl(200,70%,50%)" />
                <Bar dataKey="Tension" fill="hsl(140,60%,45%)" />
                <Bar dataKey="VME" fill="hsl(280,60%,55%)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* VME envelope */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium">VME-эллипс (осевое vs дифф. давление)</div>
            <CopyImageButton targetRef={chartRef} />
          </div>
          <div ref={chartRef} className="h-[340px]">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis type="number" dataKey="axialMPa" name="σ axial"
                  label={{ value: "σ осевое, МПа", position: "insideBottom", offset: -5, style: { fontSize: 11 } }}
                  tick={{ fontSize: 10 }} />
                <YAxis type="number" dataKey="pressureMPa" name="ΔP"
                  label={{ value: "ΔP (внутр.−внеш.), МПа", angle: -90, position: "insideLeft", style: { fontSize: 11 } }}
                  tick={{ fontSize: 10 }} />
                <ZAxis range={[20, 20]} />
                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px", fontSize: "12px" }}
                  formatter={(v: number) => v.toFixed(1)} />
                <ReferenceLine y={0} stroke="hsl(var(--border))" />
                <ReferenceLine x={0} stroke="hsl(var(--border))" />
                <Scatter name="VME envelope" data={envelopeData} fill="hsl(280,60%,55%)" line={{ stroke: "hsl(280,60%,55%)", strokeWidth: 1 }} shape="circle" />
                <Scatter name="Сценарии" data={caseDots} fill="hsl(0,80%,55%)" shape="triangle">
                  {caseDots.map((d, i) => <Cell key={i} fill={result.cases[i].pass ? "hsl(140,60%,45%)" : "hsl(0,80%,55%)"} />)}
                </Scatter>
                <Legend wrapperStyle={{ fontSize: 10 }} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Details table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left py-2 px-1">Сценарий</th>
                <th className="text-right py-2 px-1">σ_h, МПа</th>
                <th className="text-right py-2 px-1">σ_a, МПа</th>
                <th className="text-right py-2 px-1">σ_VME, МПа</th>
                <th className="text-right py-2 px-1">Burst</th>
                <th className="text-right py-2 px-1">Coll.</th>
                <th className="text-right py-2 px-1">Tens.</th>
                <th className="text-right py-2 px-1">VME</th>
                <th className="text-right py-2 px-1">Огранич.</th>
              </tr>
            </thead>
            <tbody>
              {result.cases.map((c, i) => (
                <tr key={i} className={`border-b border-border ${c.pass ? "" : "bg-red-500/5"}`}>
                  <td className="py-1.5 px-1 font-medium">{c.case}</td>
                  <td className="py-1.5 px-1 text-right">{c.hoopStressMPa.toFixed(0)}</td>
                  <td className="py-1.5 px-1 text-right">{c.axialStressMPa.toFixed(0)}</td>
                  <td className="py-1.5 px-1 text-right">{c.vmeStressMPa.toFixed(0)}</td>
                  <td className={`py-1.5 px-1 text-right ${c.burstUtilDF >= 1 ? "text-red-600 font-bold" : ""}`}>{(c.burstUtilDF * 100).toFixed(0)}%</td>
                  <td className={`py-1.5 px-1 text-right ${c.collapseUtilDF >= 1 ? "text-red-600 font-bold" : ""}`}>{(c.collapseUtilDF * 100).toFixed(0)}%</td>
                  <td className={`py-1.5 px-1 text-right ${c.tensionUtilDF >= 1 ? "text-red-600 font-bold" : ""}`}>{(c.tensionUtilDF * 100).toFixed(0)}%</td>
                  <td className={`py-1.5 px-1 text-right ${c.vmeUtilDF >= 1 ? "text-red-600 font-bold" : ""}`}>{(c.vmeUtilDF * 100).toFixed(0)}%</td>
                  <td className="py-1.5 px-1 text-right uppercase font-semibold">{c.governing}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Warnings */}
        {result.warnings.length > 0 && (
          <div className="space-y-1.5">
            {result.warnings.map((w, i) => (
              <div key={i} className="text-xs flex items-start gap-2 p-2 rounded bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-300">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}

        <div className="text-[11px] text-muted-foreground border-t border-border pt-2">
          API TR 5C3: Burst = Barlow (87.5% wall), Collapse — 4-режимный (yield / plastic / transition / elastic), Axial = σ_T·A, VME = √[½((σ_a−σ_h)²+(σ_h−σ_r)²+(σ_r−σ_a)²)] с σ_r на внутр. поверхности (Lamé).
        </div>
      </CardContent>
    </Card>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border rounded-lg p-3 bg-card">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
