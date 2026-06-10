import { useState, useMemo, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceArea, ReferenceLine, AreaChart, Area, ComposedChart,
} from "recharts";
import {
  calculateFoamCement, calculateFoamPressureProfile,
  FOAM_CEMENT_RECIPES,
  type FoamCementInput, type FoamPumpingInput, type FoamQualityZone, type FoamCementRecipe,
} from "@/lib/foam-cement-calculations";
import type { WellData, SlurryInput, BufferFluid } from "@/lib/cementing-calculations";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import FoamCementSchematic from "./FoamCementSchematic";
import FoamCement3D from "./FoamCement3D";
import CopyImageButton from "./CopyImageButton";

interface Props {
  wellData: WellData;
  slurries: SlurryInput[];
  buffers?: BufferFluid[];
  mudDensity: number; // kg/m³
  pumpRateLps?: number;
  fractureGradient?: number; // kPa/m
}

const fmt = (v: number, dec = 2) => (Number.isFinite(v) ? v.toFixed(dec) : "—");

function ScrollableChart({ children, chartRef, height }: { children: React.ReactNode; chartRef: React.RefObject<HTMLDivElement>; height: string }) {
  return (
    <div className="overflow-x-auto scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0">
      <div ref={chartRef} className={`${height} min-w-[700px]`}>
        {children}
      </div>
    </div>
  );
}

const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
  fontSize: "12px",
};

export default function FoamCementSection({ wellData, slurries, buffers, mudDensity, pumpRateLps, fractureGradient }: Props) {
  const [recipeId, setRecipeId] = useState<string>("custom");
  const [targetQuality, setTargetQuality] = useState(35);
  const [backPressure, setBackPressure] = useState(0.5);
  const [surfaceTemp, setSurfaceTemp] = useState(20);
  const [pumpingTime, setPumpingTime] = useState<number | "">("");
  const [baseDensity, setBaseDensity] = useState(() => {
    const s = slurries[0];
    return s ? (s.density >= 100 ? s.density / 1000 : s.density) : 1.85;
  });
  const [pumpRate, setPumpRate] = useState<number>(pumpRateLps && pumpRateLps > 0 ? pumpRateLps : 15);
  const [fqZones, setFqZones] = useState<FoamQualityZone[]>([]);

  const activeRecipe: FoamCementRecipe | null = recipeId === "custom"
    ? null
    : FOAM_CEMENT_RECIPES.find(r => r.id === recipeId) ?? null;

  const applyRecipe = (id: string) => {
    setRecipeId(id);
    if (id === "custom") return;
    const r = FOAM_CEMENT_RECIPES.find(x => x.id === id);
    if (!r) return;
    setBaseDensity(r.baseDensity);
    // suggest mid of recommended FQ
    setTargetQuality(Math.round((r.recommendedFQ[0] + r.recommendedFQ[1]) / 2));
  };

  const addZone = () => {
    const last = fqZones[fqZones.length - 1];
    const top = last ? last.bottomMD : cementTopMD;
    setFqZones([...fqZones, { topMD: top, bottomMD: cementBottomMD, targetFQ: targetQuality }]);
  };
  const updateZone = (i: number, patch: Partial<FoamQualityZone>) => {
    setFqZones(fqZones.map((z, idx) => idx === i ? { ...z, ...patch } : z));
  };
  const removeZone = (i: number) => setFqZones(fqZones.filter((_, idx) => idx !== i));


  const refs = Array.from({ length: 10 }, () => useRef<HTMLDivElement>(null));

  const cementTopMD = slurries.length > 0 ? Math.min(...slurries.map(s => s.topDepthMD)) : wellData.cementRiseHeight;
  const cementBottomMD = wellData.casingDepthMD;

  const bufferDensity = useMemo(() => {
    const b = buffers?.[0];
    if (!b) return 1.10;
    return b.density >= 100 ? b.density / 1000 : b.density;
  }, [buffers]);
  const bufferVolume = useMemo(() => buffers?.[0]?.volume ?? 3, [buffers]);
  const fracGrad = fractureGradient && fractureGradient > 0 ? fractureGradient : 18; // kPa/m default

  const staticResult = useMemo(() => {
    if (cementBottomMD <= cementTopMD) return null;
    const input: FoamCementInput = {
      baseDensity, targetFoamQuality: targetQuality, backPressure,
      surfaceTemperature: surfaceTemp, bottomTemperature: wellData.bottomTempStatic,
      wellDepthMD: wellData.wellDepthMD, casingDepthMD: wellData.casingDepthMD,
      holeDiameter: wellData.holeDiameter, casingOD: wellData.casingOD,
      cementTopMD, cementBottomMD, trajectory: wellData.trajectory,
      mudDensity: mudDensity / 1000, cavernCoeff: wellData.cavernCoeff,
      pumpingTimeMin: typeof pumpingTime === "number" && pumpingTime > 0 ? pumpingTime : undefined,
      pumpRateLps: pumpRate,
      foamQualityZones: fqZones.length > 0 ? fqZones : undefined,
      recipeId: recipeId !== "custom" ? recipeId : undefined,
    };
    return calculateFoamCement(input);
  }, [baseDensity, targetQuality, backPressure, surfaceTemp, pumpingTime, wellData, cementTopMD, cementBottomMD, mudDensity, pumpRate, fqZones, recipeId]);


  const dynamicResult = useMemo(() => {
    if (cementBottomMD <= cementTopMD) return null;
    const input: FoamPumpingInput = {
      wellData, trajectory: wellData.trajectory,
      mudDensity: mudDensity / 1000,
      baseDensity, targetFoamQuality: targetQuality,
      backPressure, surfaceTemperature: surfaceTemp, bottomTemperature: wellData.bottomTempStatic,
      bufferVolume, bufferDensity,
      pumpRateLps: pumpRate, cementTopMD, cementBottomMD,
      fractureGradient: fracGrad, cavernCoeff: wellData.cavernCoeff || 1,
    };
    return calculateFoamPressureProfile(input);
  }, [wellData, mudDensity, baseDensity, targetQuality, backPressure, surfaceTemp, bufferVolume, bufferDensity, pumpRate, cementTopMD, cementBottomMD, fracGrad]);

  if (!staticResult || !dynamicResult) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Заполните данные скважины и растворы для расчёта пеноцементирования
        </CardContent>
      </Card>
    );
  }

  const staticData = staticResult.points.map(pt => ({
    md: pt.md, foamQuality: pt.foamQuality, foamDensity: pt.foamDensity,
    pressure: pt.pressure, n2Ratio: pt.n2VolumeRatio * 100,
    temperature: pt.temperature, zFactor: pt.zFactor,
    compression: 1 / Math.max(0.0001, pt.compressionFactor),
  }));

  const dynData = dynamicResult.points.map(pt => ({
    time: +pt.time.toFixed(2),
    surfP: pt.surfacePressure, bhp: pt.bottomholePressure, fracP: pt.fracturePressure,
    pumpRate: pt.pumpRateLps, n2Rate: pt.n2RateStdM3min,
    cumN2: pt.cumulativeN2StdM3, cumVol: pt.cumulativeVolume,
    fqSurface: pt.foamQualitySurface, fqBottom: pt.foamQualityBottom,
    densSurface: pt.foamDensitySurface, densBottom: pt.foamDensityBottom,
    ecd: pt.ecdAtBottom, fracEcd: pt.fracGradEcd,
    annVel: pt.annularVelocityMps,
    mudH: pt.annMudHeightM, bufferH: pt.annBufferHeightM, foamH: pt.annFoamHeightM,
    foamTopMD: pt.foamTopMD,
  }));

  const qualityOk = staticResult.minFoamQuality >= 20 && staticResult.maxFoamQuality <= 80;
  const bottomFQwarn = (dynamicResult.points.at(-1)?.foamQualityBottom ?? 100) < 20;
  const fracReserve = dynamicResult.points[0]?.fracGradEcd - dynamicResult.maxECD;

  return (
    <div className="space-y-6">
      {/* Recipe library */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">🧪 База рецептур пеноцемента</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label className="text-xs text-muted-foreground">Тип базового раствора</label>
              <select
                value={recipeId}
                onChange={e => applyRecipe(e.target.value)}
                className="w-full border border-border rounded px-2 py-2 text-sm bg-background"
              >
                <option value="custom">— Своя рецептура (ручной ввод) —</option>
                {FOAM_CEMENT_RECIPES.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.nameRu} • ρ={r.baseDensity} • FQ {r.recommendedFQ[0]}–{r.recommendedFQ[1]}%
                  </option>
                ))}
              </select>
            </div>
            {activeRecipe && (
              <div className="text-[11px] text-muted-foreground leading-relaxed border border-border rounded p-2 bg-muted/30">
                <div><b>В/Ц:</b> {activeRecipe.waterCementRatio}, <b>Выход:</b> {activeRecipe.yieldM3PerTon} м³/т</div>
                <div><b>PV/YP:</b> {activeRecipe.pvCp} сПз / {activeRecipe.ypPa} Па</div>
                <div><b>Загуст. 30 Bc:</b> {activeRecipe.thickeningTime30Bc} мин, <b>T<sub>max</sub>:</b> {activeRecipe.maxTemp} °C</div>
                <div><b>Стабилизатор:</b> {activeRecipe.foamStabilizerType} ({activeRecipe.foamStabilizerConc}%)</div>
              </div>
            )}
          </div>
          {activeRecipe && (
            <div className="mt-2 text-xs text-muted-foreground">{activeRecipe.description}</div>
          )}
        </CardContent>
      </Card>

      {/* Inputs */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">🫧 Параметры пеноцементирования</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <Input label="Базовая плотность, г/см³" value={baseDensity} step={0.01} min={1} max={2.5} onChange={setBaseDensity} />
            <Input label="Целевое качество пены, %" value={targetQuality} step={5} min={10} max={85} onChange={setTargetQuality} hint={activeRecipe ? `реком. ${activeRecipe.recommendedFQ[0]}–${activeRecipe.recommendedFQ[1]}%` : "20–80%"} />
            <Input label="Обратное давление, МПа" value={backPressure} step={0.1} min={0} max={10} onChange={setBackPressure} />
            <Input label="Температура устья, °C" value={surfaceTemp} step={1} min={-30} max={60} onChange={setSurfaceTemp} />
            <Input label="Расход суспензии, л/с" value={pumpRate} step={0.5} min={1} max={60} onChange={setPumpRate} />
            <div>
              <label className="text-xs text-muted-foreground">Время закачки, мин (опц.)</label>
              <input type="number" step="1" min="0" value={pumpingTime}
                placeholder="из расхода"
                onChange={e => setPumpingTime(e.target.value === "" ? "" : +e.target.value)}
                className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
              <div className="text-[10px] text-muted-foreground mt-0.5">Принято: {fmt(dynamicResult.pumpingTimeMin, 1)} мин</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Multi-zone FQ */}
      <Card>
        <CardHeader className="pb-4 flex flex-row items-center justify-between">
          <CardTitle className="text-lg">🎯 Поинтервальный FQ (зоны качества пены)</CardTitle>
          <Button size="sm" variant="outline" onClick={addZone}>
            <Plus className="h-4 w-4 mr-1" /> Добавить зону
          </Button>
        </CardHeader>
        <CardContent>
          {fqZones.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              Зоны не заданы — используется единое целевое FQ {targetQuality}% по всей длине пеноцемента.
              Добавьте зоны, чтобы задать разные значения FQ по интервалам глубины (например, верх 40%, низ 25%).
            </div>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-12 gap-2 text-[11px] text-muted-foreground font-medium px-1">
                <div className="col-span-3">От, м (MD)</div>
                <div className="col-span-3">До, м (MD)</div>
                <div className="col-span-4">Целевое FQ (устье), %</div>
                <div className="col-span-2"></div>
              </div>
              {fqZones.map((z, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <input type="number" value={z.topMD} step={10}
                    onChange={e => updateZone(i, { topMD: +e.target.value })}
                    className="col-span-3 min-w-[100px] border border-border rounded px-2 py-1.5 text-sm bg-background" />
                  <input type="number" value={z.bottomMD} step={10}
                    onChange={e => updateZone(i, { bottomMD: +e.target.value })}
                    className="col-span-3 min-w-[100px] border border-border rounded px-2 py-1.5 text-sm bg-background" />
                  <input type="number" value={z.targetFQ} step={1} min={5} max={85}
                    onChange={e => updateZone(i, { targetFQ: +e.target.value })}
                    className="col-span-4 min-w-[100px] border border-border rounded px-2 py-1.5 text-sm bg-background" />
                  <Button size="sm" variant="ghost" className="col-span-2" onClick={() => removeZone(i)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <div className="text-[11px] text-muted-foreground mt-2">
                ℹ Зоны применяются к статическому профилю по глубине. Динамическая симуляция использует единое целевое FQ устья.
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Summary */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">📊 Сводная карточка результатов</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
            <div className="space-y-1">
              <div className="text-xs uppercase text-muted-foreground mt-2 mb-1">Плотности</div>
              <Row label="Базовая суспензия" value={`${fmt(baseDensity, 2)} г/см³`} />
              <Row label="Пеноцемент устье" value={`${fmt(staticResult.points[0]?.foamDensity ?? 0, 3)} г/см³`} />
              <Row label="Пеноцемент забой" value={`${fmt(staticResult.points.at(-1)?.foamDensity ?? 0, 3)} г/см³`} />
              <Row label="Средняя в затрубье" value={`${fmt(dynamicResult.avgFoamDensityAnn, 3)} г/см³`} />

              <div className="text-xs uppercase text-muted-foreground mt-3 mb-1">Качество пены (FQ)</div>
              <Row label="Целевое (устье)" value={fqZones.length > 0 ? `зональный (${fqZones.length} зон)` : `${fmt(targetQuality, 0)}%`} />
              <Row label="FQ забой / устье / среднее" value={`${fmt(staticResult.points.at(-1)?.foamQuality ?? 0, 1)} / ${fmt(staticResult.points[0]?.foamQuality ?? 0, 1)} / ${fmt(staticResult.avgFoamQuality, 1)} %`} />
              <Row label="FQ min / max" value={`${fmt(staticResult.minFoamQuality, 1)} / ${fmt(staticResult.maxFoamQuality, 1)} %`} />
            </div>
            <div className="space-y-1">
              <div className="text-xs uppercase text-muted-foreground mt-2 mb-1">Объёмы и азот</div>
              <Row label="Базовая суспензия" value={`${fmt(dynamicResult.totalBaseSlurryM3, 2)} м³`} />
              <Row label="Пеноцемент на устье" value={`${fmt(dynamicResult.totalFoamVolumeAtSurfaceM3, 2)} м³`} />
              <Row label="N₂ (стд. условия)" value={`${fmt(dynamicResult.totalN2StdM3, 1)} м³`} />
              <Row label="Пиковый расход N₂" value={`${fmt(dynamicResult.peakN2RateStdM3min, 2)} м³/мин`} />
              <Row label="Z-фактор на забое" value={fmt(staticResult.points.at(-1)?.zFactor ?? 1, 3)} />

              <div className="text-xs uppercase text-muted-foreground mt-3 mb-1">Давление и время</div>
              <Row label="Макс. ЭЦП на забое" value={`${fmt(dynamicResult.maxECD, 3)} г/см³`} />
              <Row label="ЭЦП ГРП" value={`${fmt(dynamicResult.points[0]?.fracGradEcd ?? 0, 3)} г/см³`} />
              <Row label="Запас до ГРП" value={`${fmt(fracReserve, 3)} г/см³ ${fracReserve > 0 ? "✓" : "⚠"}`} />
              <Row label="Время: буф / пена / прод" value={`${fmt(dynamicResult.bufferTimeMin, 1)} / ${fmt(dynamicResult.foamTimeMin, 1)} / ${fmt(dynamicResult.displacementTimeMin, 1)} мин`} />
              <Row label="ВСЕГО" value={`${fmt(dynamicResult.pumpingTimeMin, 1)} мин`} />
            </div>
          </div>

          {/* Warnings */}
          <div className="mt-4 space-y-2">
            <div className={`p-3 rounded-lg text-sm font-medium ${qualityOk ? "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200" : "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200"}`}>
              {qualityOk
                ? "✓ Качество пены в допустимом диапазоне 20–80% по всей глубине"
                : `⚠ FQ выходит за диапазон 20–80% (min ${fmt(staticResult.minFoamQuality, 1)}%, max ${fmt(staticResult.maxFoamQuality, 1)}%) — скорректируйте параметры или зоны`}
            </div>
            {bottomFQwarn && (
              <div className="p-3 rounded-lg text-sm bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                ⚠ FQ на забое ниже 20% — возможна потеря стабильности пены. Увеличьте целевой FQ до 45–50% или примените стабилизатор.
              </div>
            )}
            {fracReserve <= 0 && (
              <div className="p-3 rounded-lg text-sm bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200">
                ⚠ ЭЦП превышает градиент ГРП — риск поглощения. Снизьте плотность базы, увеличьте FQ или уменьшите расход.
              </div>
            )}
            {activeRecipe && wellData.bottomTempStatic > activeRecipe.maxTemp && (
              <div className="p-3 rounded-lg text-sm bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200">
                ⚠ Температура забоя ({wellData.bottomTempStatic} °C) превышает T<sub>max</sub> рецептуры «{activeRecipe.nameRu}» ({activeRecipe.maxTemp} °C). Выберите более термостойкий рецепт.
              </div>
            )}
            {activeRecipe && (targetQuality < activeRecipe.recommendedFQ[0] || targetQuality > activeRecipe.recommendedFQ[1]) && (
              <div className="p-3 rounded-lg text-sm bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                ⚠ Целевое FQ {targetQuality}% вне рекомендуемого диапазона рецептуры {activeRecipe.recommendedFQ[0]}–{activeRecipe.recommendedFQ[1]}%.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Equipment schematic */}
      <FoamCementSchematic
        baseSlurryRateLps={pumpRate}
        n2RateStdM3Min={dynamicResult.peakN2RateStdM3min}
        surfacePressureMPa={dynamicResult.points.reduce((m, pt) => Math.max(m, pt.surfacePressure), 0)}
        backPressureMPa={backPressure}
        baseSlurryVolumeM3={dynamicResult.totalBaseSlurryM3}
        n2VolumeStdM3={dynamicResult.totalN2StdM3}
        baseDensity={baseDensity}
        foamDensitySurface={staticResult.points[0]?.foamDensity ?? baseDensity}
        targetFQ={targetQuality}
      />

      {/* 3D foam-cement fill animation */}
      <FoamCement3D
        points={staticResult.points}
        totalDepthMD={wellData.casingDepthMD}
        holeDiameterMm={wellData.holeDiameter}
        casingODmm={wellData.casingOD}
        baseDensity={baseDensity}
      />


      {/* Chart 1: Combined cementing diagram */}
      <ChartCard title="📊 Совмещённый график пеноцементирования" refEl={refs[0]}>
        <ScrollableChart chartRef={refs[0]} height="h-[440px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={dynData} margin={{ top: 10, right: 60, bottom: 30, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="time" type="number" label={{ value: 'Время, мин', position: 'insideBottom', offset: -5 }} tick={{ fontSize: 11 }} />
              <YAxis yAxisId="p" orientation="left" label={{ value: 'P, МПа', angle: -90, position: 'insideLeft' }} tick={{ fontSize: 11 }} />
              <YAxis yAxisId="q" orientation="right" domain={[0, 30]} label={{ value: 'Q, л/с', angle: 90, position: 'insideRight' }} tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend />
              {dynamicResult.stageBoundaries.slice(1, -1).map((b, i) => (
                <ReferenceLine key={i} yAxisId="p" x={b.time} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" label={{ value: b.label, fontSize: 10, position: 'top' }} />
              ))}
              <Line yAxisId="p" dataKey="surfP" name="P насос, МПа" stroke="hsl(0, 70%, 50%)" dot={false} strokeWidth={2} />
              <Line yAxisId="p" dataKey="bhp" name="P забой, МПа" stroke="hsl(220, 70%, 50%)" dot={false} strokeWidth={2} />
              <Line yAxisId="p" dataKey="fracP" name="P ГРП, МПа" stroke="hsl(30, 90%, 50%)" strokeDasharray="6 4" dot={false} strokeWidth={2} />
              <Line yAxisId="q" dataKey="pumpRate" name="Q сусп., л/с" stroke="hsl(160, 60%, 45%)" dot={false} strokeWidth={2} />
              <Line yAxisId="q" dataKey="n2Rate" name="Q N₂ (стд), м³/мин" stroke="hsl(280, 60%, 55%)" dot={false} strokeWidth={2} />
            </ComposedChart>
          </ResponsiveContainer>
        </ScrollableChart>
      </ChartCard>

      {/* Chart 2: BHP vs Frac */}
      <ChartCard title="📈 Давление на забое vs ГРП" refEl={refs[1]}>
        <ScrollableChart chartRef={refs[1]} height="h-[360px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={dynData} margin={{ top: 10, right: 30, bottom: 30, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="time" type="number" label={{ value: 'Время, мин', position: 'insideBottom', offset: -5 }} tick={{ fontSize: 11 }} />
              <YAxis label={{ value: 'P, МПа', angle: -90, position: 'insideLeft' }} tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend />
              <Line dataKey="bhp" name="P забой" stroke="hsl(220, 70%, 50%)" dot={false} strokeWidth={2} />
              <Line dataKey="fracP" name="P ГРП" stroke="hsl(0, 80%, 50%)" strokeDasharray="6 4" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </ScrollableChart>
      </ChartCard>

      {/* Chart 3: ECD vs time + velocity */}
      <ChartCard title="📈 ЭЦП и скорость в затрубье по времени" refEl={refs[2]}>
        <ScrollableChart chartRef={refs[2]} height="h-[360px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={dynData} margin={{ top: 10, right: 60, bottom: 30, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="time" type="number" label={{ value: 'Время, мин', position: 'insideBottom', offset: -5 }} tick={{ fontSize: 11 }} />
              <YAxis yAxisId="ecd" orientation="left" label={{ value: 'ЭЦП, г/см³', angle: -90, position: 'insideLeft' }} tick={{ fontSize: 11 }} />
              <YAxis yAxisId="v" orientation="right" label={{ value: 'v, м/с', angle: 90, position: 'insideRight' }} tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend />
              <Line yAxisId="ecd" dataKey="ecd" name="ЭЦП забой" stroke="hsl(220, 70%, 50%)" dot={false} strokeWidth={2} />
              <Line yAxisId="ecd" dataKey="fracEcd" name="ЭЦП ГРП" stroke="hsl(0, 80%, 50%)" strokeDasharray="6 4" dot={false} strokeWidth={2} />
              <Line yAxisId="v" dataKey="annVel" name="v затруб., м/с" stroke="hsl(160, 60%, 45%)" dot={false} strokeWidth={2} />
            </ComposedChart>
          </ResponsiveContainer>
        </ScrollableChart>
      </ChartCard>

      {/* Chart 4: FQ & density by depth */}
      <ChartCard title="📈 Качество пены и плотность по глубине" refEl={refs[3]}>
        <ScrollableChart chartRef={refs[3]} height="h-[400px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={staticData} layout="vertical" margin={{ top: 5, right: 60, bottom: 5, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <YAxis dataKey="md" type="number" reversed domain={[0, 'dataMax']} label={{ value: 'MD, м', angle: -90, position: 'insideLeft' }} tick={{ fontSize: 11 }} />
              <XAxis xAxisId="quality" type="number" domain={[0, 100]} orientation="bottom" label={{ value: 'FQ, %', position: 'insideBottom', offset: -2 }} tick={{ fontSize: 11 }} />
              <XAxis xAxisId="density" type="number" domain={['auto', 'auto']} orientation="top" label={{ value: 'ρ, г/см³', position: 'insideTop', offset: -2 }} tick={{ fontSize: 11 }} />
              <ReferenceArea xAxisId="quality" x1={20} x2={80} fill="hsl(var(--primary))" fillOpacity={0.04} />
              <ReferenceArea xAxisId="quality" x1={0} x2={20} fill="hsl(var(--destructive))" fillOpacity={0.06} />
              <ReferenceArea xAxisId="quality" x1={80} x2={100} fill="hsl(var(--destructive))" fillOpacity={0.06} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend />
              <Line xAxisId="quality" dataKey="foamQuality" name="FQ, %" stroke="hsl(200, 70%, 50%)" dot={false} strokeWidth={2} />
              <Line xAxisId="density" dataKey="foamDensity" name="ρ, г/см³" stroke="hsl(35, 80%, 50%)" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </ScrollableChart>
      </ChartCard>

      {/* Chart 5: FQ surface vs bottom by time */}
      <ChartCard title="📈 Качество пены: устье vs забой (по времени)" refEl={refs[4]}>
        <ScrollableChart chartRef={refs[4]} height="h-[340px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={dynData} margin={{ top: 10, right: 30, bottom: 30, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="time" type="number" label={{ value: 'Время, мин', position: 'insideBottom', offset: -5 }} tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} label={{ value: 'FQ, %', angle: -90, position: 'insideLeft' }} tick={{ fontSize: 11 }} />
              <ReferenceArea y1={20} y2={80} fill="hsl(var(--primary))" fillOpacity={0.06} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend />
              <Line dataKey="fqSurface" name="FQ устье" stroke="hsl(200, 70%, 50%)" dot={false} strokeWidth={2} />
              <Line dataKey="fqBottom" name="FQ забой" stroke="hsl(15, 80%, 50%)" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </ScrollableChart>
      </ChartCard>

      {/* Chart 6: N₂ rate & cumulative */}
      <ChartCard title="📈 Расход и объём N₂ (по времени)" refEl={refs[5]}>
        <ScrollableChart chartRef={refs[5]} height="h-[340px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={dynData} margin={{ top: 10, right: 60, bottom: 30, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="time" type="number" label={{ value: 'Время, мин', position: 'insideBottom', offset: -5 }} tick={{ fontSize: 11 }} />
              <YAxis yAxisId="r" orientation="left" label={{ value: 'Q N₂, м³/мин', angle: -90, position: 'insideLeft' }} tick={{ fontSize: 11 }} />
              <YAxis yAxisId="c" orientation="right" label={{ value: 'V N₂, м³', angle: 90, position: 'insideRight' }} tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend />
              <Line yAxisId="r" dataKey="n2Rate" name="Q N₂ (стд)" stroke="hsl(280, 60%, 55%)" dot={false} strokeWidth={2} />
              <Line yAxisId="c" dataKey="cumN2" name="ΣN₂ (стд)" stroke="hsl(160, 60%, 40%)" dot={false} strokeWidth={2} />
            </ComposedChart>
          </ResponsiveContainer>
        </ScrollableChart>
      </ChartCard>

      {/* Chart 7: Z-factor & compression by depth */}
      <ChartCard title="📈 Z-фактор и сжатие газа по глубине" refEl={refs[6]}>
        <ScrollableChart chartRef={refs[6]} height="h-[360px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={staticData} layout="vertical" margin={{ top: 5, right: 60, bottom: 5, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <YAxis dataKey="md" type="number" reversed domain={[0, 'dataMax']} label={{ value: 'MD, м', angle: -90, position: 'insideLeft' }} tick={{ fontSize: 11 }} />
              <XAxis xAxisId="z" type="number" domain={['auto', 'auto']} orientation="bottom" label={{ value: 'Z', position: 'insideBottom', offset: -2 }} tick={{ fontSize: 11 }} />
              <XAxis xAxisId="comp" type="number" domain={['auto', 'auto']} orientation="top" label={{ value: 'V_depth/V_std', position: 'insideTop', offset: -2 }} tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend />
              <Line xAxisId="z" dataKey="zFactor" name="Z-фактор" stroke="hsl(200, 70%, 50%)" dot={false} strokeWidth={2} />
              <Line xAxisId="comp" dataKey="compression" name="Сжатие" stroke="hsl(280, 60%, 55%)" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </ScrollableChart>
      </ChartCard>

      {/* Chart 8: Annulus composition (stacked area) */}
      <ChartCard title="📈 Состав затрубья по времени" refEl={refs[7]}>
        <ScrollableChart chartRef={refs[7]} height="h-[360px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={dynData} margin={{ top: 10, right: 30, bottom: 30, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="time" type="number" label={{ value: 'Время, мин', position: 'insideBottom', offset: -5 }} tick={{ fontSize: 11 }} />
              <YAxis label={{ value: 'Высота, м', angle: -90, position: 'insideLeft' }} tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend />
              <Area type="stepAfter" dataKey="bufferH" name="Буфер" stackId="1" stroke="hsl(45, 90%, 50%)" fill="hsl(45, 90%, 50%)" fillOpacity={0.6} />
              <Area type="stepAfter" dataKey="foamH" name="Пеноцемент" stackId="1" stroke="hsl(200, 70%, 50%)" fill="hsl(200, 70%, 50%)" fillOpacity={0.6} />
              <Area type="stepAfter" dataKey="mudH" name="Буровой раствор" stackId="1" stroke="hsl(30, 40%, 40%)" fill="hsl(30, 40%, 40%)" fillOpacity={0.5} />
            </AreaChart>
          </ResponsiveContainer>
        </ScrollableChart>
      </ChartCard>

      {/* Static profile table */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">📋 Профиль пеноцемента по глубине</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="border-b border-border">
                  <th className="py-2 px-1 text-left text-muted-foreground">MD, м</th>
                  <th className="py-2 px-1 text-right text-muted-foreground">TVD, м</th>
                  <th className="py-2 px-1 text-right text-muted-foreground">P, МПа</th>
                  <th className="py-2 px-1 text-right text-muted-foreground">T, °C</th>
                  <th className="py-2 px-1 text-right text-muted-foreground">Z</th>
                  <th className="py-2 px-1 text-right text-muted-foreground">FQ, %</th>
                  <th className="py-2 px-1 text-right text-muted-foreground">ρ, г/см³</th>
                </tr>
              </thead>
              <tbody>
                {staticResult.points.filter((_, i) => i % 5 === 0 || i === staticResult.points.length - 1).map((pt, i) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-muted/50">
                    <td className="py-1.5 px-1">{fmt(pt.md, 0)}</td>
                    <td className="py-1.5 px-1 text-right">{fmt(pt.tvd, 0)}</td>
                    <td className="py-1.5 px-1 text-right">{fmt(pt.pressure, 2)}</td>
                    <td className="py-1.5 px-1 text-right">{fmt(pt.temperature, 1)}</td>
                    <td className="py-1.5 px-1 text-right">{fmt(pt.zFactor, 3)}</td>
                    <td className="py-1.5 px-1 text-right">{fmt(pt.foamQuality, 1)}</td>
                    <td className="py-1.5 px-1 text-right">{fmt(pt.foamDensity, 3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold">{value}</span>
    </div>
  );
}

function Input({ label, value, step, min, max, onChange, hint }: { label: string; value: number; step: number; min: number; max: number; onChange: (v: number) => void; hint?: string }) {
  return (
    <div>
      <label className="text-xs text-muted-foreground">{label}</label>
      <input type="number" step={step} min={min} max={max} value={value}
        onChange={e => onChange(+e.target.value)}
        className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
      {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

function ChartCard({ title, refEl, children }: { title: string; refEl: React.RefObject<HTMLDivElement>; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-lg">{title}</CardTitle>
        <CopyImageButton targetRef={refEl} />
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
