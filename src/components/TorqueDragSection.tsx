import { useState, useMemo, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from "recharts";
import { calculateTDSummary, calculateTD, calculateSurgeSwab, findStuckZones, type TDInput, type TDMode, type TDResult, type TDSummary, type FluidSegment, type CentralizerDragItem, type StuckZone } from "@/lib/torque-drag-calculations";
import type { WellData, SlurryInput, BufferFluid, DrillingFluid, DisplacementFluid } from "@/lib/cementing-calculations";
import { getCasingID } from "@/lib/cementing-calculations";
import type { CentralizationResult, CentralizerInterval } from "@/lib/centralization-calculations";
import CopyImageButton from "./CopyImageButton";

interface Props {
  wellData: WellData;
  mudDensity: number;
  drillingFluid?: DrillingFluid;
  slurries?: SlurryInput[];
  buffers?: BufferFluid[];
  displacementFluids?: DisplacementFluid[];
  centralizerIntervals?: CentralizerInterval[];
}

const fmt = (v: number, dec = 2) => v.toFixed(dec);

function ScrollableChart({ children, chartRef, height }: { children: React.ReactNode; chartRef: React.RefObject<HTMLDivElement>; height: string }) {
  return (
    <div className="overflow-x-auto scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0">
      <div ref={chartRef} className={`${height} min-w-[700px]`}>{children}</div>
    </div>
  );
}

/** Build fluid segments for T&D viscous drag from cementing fluids */
function buildFluidSegments(
  wellData: WellData,
  drillingFluid?: DrillingFluid,
  slurries?: SlurryInput[],
  buffers?: BufferFluid[],
): FluidSegment[] {
  const segments: FluidSegment[] = [];

  // Drilling fluid fills the entire well by default
  if (drillingFluid && drillingFluid.density > 0) {
    segments.push({
      name: drillingFluid.name || "Буровой р-р",
      density: drillingFluid.density,
      pv: drillingFluid.rheology.pv,
      yp: drillingFluid.rheology.yp,
      topMD: 0,
      bottomMD: wellData.casingDepthMD,
    });
  }

  // Add slurries — they override the drilling fluid in their intervals
  if (slurries && slurries.length > 0) {
    slurries.forEach((s, idx) => {
      const bottomMD = idx === slurries.length - 1 ? wellData.casingDepthMD : (slurries[idx + 1]?.topDepthMD ?? wellData.casingDepthMD);
      if (s.density > 0 && s.rheology) {
        segments.push({
          name: s.name || `Раствор ${idx + 1}`,
          density: s.density >= 10 ? s.density : s.density * 1000,
          pv: s.rheology.pv,
          yp: s.rheology.yp,
          topMD: s.topDepthMD,
          bottomMD,
        });
      }
    });
  }

  return segments;
}

/** Build centralizer drag items from centralization intervals */
function buildCentralizerDrag(intervals?: CentralizerInterval[]): CentralizerDragItem[] {
  if (!intervals || intervals.length === 0) return [];
  return intervals.map(iv => ({
    fromMD: iv.fromMD,
    toMD: iv.toMD,
    centralizersPerJoint: iv.centralizersPerJoint,
    jointLength: iv.jointLength,
    // Drag force depends on centralizer type & restoring force
    // Approximate: rigid ~2-5 kN, spring ~0.5-2 kN, solid ~3-8 kN
    dragForcePerUnit: iv.spec.type === 'spring' ? Math.min(iv.spec.restoringForce * 0.3, 2)
      : iv.spec.type === 'solid' ? Math.min(iv.spec.restoringForce * 0.5, 8)
      : Math.min(iv.spec.restoringForce * 0.4, 5), // rigid
  }));
}

export default function TorqueDragSection({ wellData, mudDensity, drillingFluid, slurries, buffers, displacementFluids, centralizerIntervals }: Props) {
  const [frictionCased, setFrictionCased] = useState(0.20);
  const [frictionOpenhole, setFrictionOpenhole] = useState(0.30);
  const [pipeWeight, setPipeWeight] = useState(47);
  const [wob, setWob] = useState(50);
  const [rpm, setRpm] = useState(60);
  const [blockWeight, setBlockWeight] = useState(20);
  const [yieldStrength, setYieldStrength] = useState(550);
  const [dcLength, setDcLength] = useState(100);
  const [dcOD, setDcOD] = useState(172);
  const [dcWeight, setDcWeight] = useState(145);
  const [motorBendAngle, setMotorBendAngle] = useState(1.5);
  const [tripSpeed, setTripSpeed] = useState(0.5);
  const [useFluidRheology, setUseFluidRheology] = useState(true);
  const [useCentralizerDrag, setUseCentralizerDrag] = useState(true);
  // V3 inputs
  const [fillLevel, setFillLevel] = useState(100);
  const [fillFluidDensity, setFillFluidDensity] = useState<number>(() => mudDensity / 1000);
  const [isOpenEnded, setIsOpenEnded] = useState(false);
  const [fracGradKpa, setFracGradKpa] = useState(18);
  const [poreGradKpa, setPoreGradKpa] = useState(10.5);
  const [maxHookLoad, setMaxHookLoad] = useState(3500);

  const chartRef1 = useRef<HTMLDivElement>(null);
  const chartRef2 = useRef<HTMLDivElement>(null);
  const chartRef3 = useRef<HTMLDivElement>(null);
  const chartRef4 = useRef<HTMLDivElement>(null);
  const chartRef5 = useRef<HTMLDivElement>(null);
  const chartRef6 = useRef<HTMLDivElement>(null);

  const casingID = getCasingID(wellData.casingOD, wellData.casingWall);

  const fluidSegments = useMemo(() => {
    if (!useFluidRheology) return undefined;
    return buildFluidSegments(wellData, drillingFluid, slurries, buffers);
  }, [wellData, drillingFluid, slurries, buffers, useFluidRheology]);

  const centralizerDrag = useMemo(() => {
    if (!useCentralizerDrag) return undefined;
    return buildCentralizerDrag(centralizerIntervals);
  }, [centralizerIntervals, useCentralizerDrag]);

  const makeInput = (): TDInput => ({
    trajectory: wellData.trajectory,
    wellDepthMD: wellData.wellDepthMD,
    casingDepthMD: wellData.casingDepthMD,
    casingShoe: wellData.prevCasingDepth,
    holeDiameter: wellData.holeDiameter,
    casingOD: wellData.casingOD,
    casingID: wellData.prevCasingID || casingID,
    pipeWeightKgPerM: pipeWeight,
    mudDensity: mudDensity / 1000,
    frictionCased, frictionOpenhole,
    wob, rpm, blockWeight,
    yieldStrength,
    dcLength, dcOD, dcWeight,
    motorBendAngle,
    fluidSegments,
    tripSpeedMps: tripSpeed,
    centralizerDrag,
    fillLevel,
    fillFluidDensity,
    isOpenEnded,
    fracGradient_kPaPerM: fracGradKpa,
    porePressureGrad_kPaPerM: poreGradKpa,
    maxHookLoad_kN: maxHookLoad,
  });

  const summary = useMemo<TDSummary | null>(() => {
    if (!wellData.casingDepthMD || wellData.casingDepthMD <= 0) return null;
    return calculateTDSummary(makeInput());
  }, [wellData, mudDensity, frictionCased, frictionOpenhole, pipeWeight, wob, rpm, blockWeight, casingID, yieldStrength, dcLength, dcOD, dcWeight, motorBendAngle, fluidSegments, centralizerDrag, tripSpeed, fillLevel, fillFluidDensity, isOpenEnded, fracGradKpa, poreGradKpa, maxHookLoad]);

  const extraModes = useMemo(() => {
    if (!wellData.casingDepthMD || wellData.casingDepthMD <= 0) return null;
    const input = makeInput();
    return {
      drillRotary: calculateTD(input, 'drill_rotary'),
      drillMotor: calculateTD(input, 'drill_motor'),
      backReam: calculateTD(input, 'back_ream'),
      pickup: calculateTD(input, 'pickup'),
      slackoff: calculateTD(input, 'slackoff'),
      cementRotate: calculateTD(input, 'cement_rotate'),
    };
  }, [wellData, mudDensity, frictionCased, frictionOpenhole, pipeWeight, wob, rpm, blockWeight, casingID, yieldStrength, dcLength, dcOD, dcWeight, motorBendAngle, fluidSegments, centralizerDrag, tripSpeed, fillLevel, fillFluidDensity, isOpenEnded, fracGradKpa, poreGradKpa, maxHookLoad]);

  const surgeSwab = useMemo(() => {
    if (!wellData.casingDepthMD || wellData.casingDepthMD <= 0) return null;
    return calculateSurgeSwab(makeInput());
  }, [wellData, mudDensity, pipeWeight, fluidSegments, tripSpeed, fracGradKpa, poreGradKpa, isOpenEnded]);

  const stuckZones = useMemo<StuckZone[] | null>(() => {
    if (!summary || !surgeSwab) return null;
    return findStuckZones(summary.tripIn, summary.tripOut, surgeSwab, makeInput());
  }, [summary, surgeSwab, maxHookLoad, yieldStrength]);


  if (!summary || !extraModes) {
    return (
      <Card><CardContent className="py-8 text-center text-muted-foreground">
        Заполните данные скважины для расчёта Torque & Drag
      </CardContent></Card>
    );
  }

  const allModes = [summary.tripIn, summary.tripOut, summary.rotate, extraModes.drillRotary, extraModes.drillMotor, extraModes.backReam, extraModes.pickup, extraModes.slackoff, extraModes.cementRotate];

  const chartData = summary.tripIn.points.map((pt, i) => ({
    md: pt.md,
    tripInHL: summary.tripIn.points[i]?.hookLoad ?? 0,
    tripOutHL: summary.tripOut.points[i]?.hookLoad ?? 0,
    rotateHL: summary.rotate.points[i]?.hookLoad ?? 0,
    freeWeight: summary.freeWeight,
    drillRotaryHL: extraModes.drillRotary.points[i]?.hookLoad ?? 0,
    drillMotorHL: extraModes.drillMotor.points[i]?.hookLoad ?? 0,
    pickupHL: extraModes.pickup.points[i]?.hookLoad ?? 0,
    slackoffHL: extraModes.slackoff.points[i]?.hookLoad ?? 0,
    cementRotateHL: extraModes.cementRotate.points[i]?.hookLoad ?? 0,
    tripInTension: summary.tripIn.points[i]?.effectiveTension ?? 0,
    tripOutTension: summary.tripOut.points[i]?.effectiveTension ?? 0,
    torqueRot: summary.rotate.points[i]?.torque ?? 0,
    torqueDrill: extraModes.drillRotary.points[i]?.torque ?? 0,
    torqueMotor: extraModes.drillMotor.points[i]?.torque ?? 0,
    torqueCement: extraModes.cementRotate.points[i]?.torque ?? 0,
    sideForce: summary.tripIn.points[i]?.sideForce ?? 0,
    clearance: summary.tripIn.points[i]?.clearance ?? 0,
    fatigue: summary.rotate.points[i]?.fatigueDamage ?? 0,
    vonMises: summary.tripIn.points[i]?.vonMises ?? 0,
    viscousDrag: summary.tripIn.points[i]?.viscousDrag ?? 0,
    centDrag: summary.tripIn.points[i]?.centralizerDragForce ?? 0,
  }));

  const ts = {
    backgroundColor: "hsl(var(--card))",
    border: "1px solid hsl(var(--border))",
    borderRadius: "8px",
    fontSize: "12px",
  };

  const hasFluidData = fluidSegments && fluidSegments.length > 0;
  const hasCentData = centralizerDrag && centralizerDrag.length > 0;

  return (
    <div className="space-y-6">
      {/* Inputs */}
      <Card>
        <CardHeader className="pb-4"><CardTitle className="text-lg">⚙️ Параметры расчёта T&D</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            <div>
              <label className="text-xs text-muted-foreground">μ в ОК</label>
              <input type="number" step="0.01" min="0.05" max="0.5" value={frictionCased} onChange={e => setFrictionCased(+e.target.value)}
                className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">μ в откр. стволе</label>
              <input type="number" step="0.01" min="0.05" max="0.6" value={frictionOpenhole} onChange={e => setFrictionOpenhole(+e.target.value)}
                className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Вес трубы, кг/м</label>
              <input type="number" step="1" min="10" max="200" value={pipeWeight} onChange={e => setPipeWeight(+e.target.value)}
                className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">WOB, кН</label>
              <input type="number" step="5" min="0" max="300" value={wob} onChange={e => setWob(+e.target.value)}
                className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">RPM</label>
              <input type="number" step="5" min="0" max="200" value={rpm} onChange={e => setRpm(+e.target.value)}
                className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Вес блока, кН</label>
              <input type="number" step="1" min="0" max="100" value={blockWeight} onChange={e => setBlockWeight(+e.target.value)}
                className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mt-4">
            <div>
              <label className="text-xs text-muted-foreground">Предел текучести, МПа</label>
              <input type="number" step="10" value={yieldStrength} onChange={e => setYieldStrength(+e.target.value)}
                className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Длина УБТ, м</label>
              <input type="number" step="10" value={dcLength} onChange={e => setDcLength(+e.target.value)}
                className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">OD УБТ, мм</label>
              <input type="number" step="1" value={dcOD} onChange={e => setDcOD(+e.target.value)}
                className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Вес УБТ, кг/м</label>
              <input type="number" step="5" value={dcWeight} onChange={e => setDcWeight(+e.target.value)}
                className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Угол перекоса ГЗД, °</label>
              <input type="number" step="0.25" min="0" max="5" value={motorBendAngle} onChange={e => setMotorBendAngle(+e.target.value)}
                className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Скорость СПО, м/с</label>
              <input type="number" step="0.1" min="0.1" max="2" value={tripSpeed} onChange={e => setTripSpeed(+e.target.value)}
                className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
            </div>
          </div>

          {/* V3: Fill / Surge-Swab / Rig limit inputs */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mt-4 pt-4 border-t border-border">
            <div>
              <label className="text-xs text-muted-foreground">Заполнение колонны, %</label>
              <input type="number" step="5" min="0" max="100" value={fillLevel} onChange={e => setFillLevel(+e.target.value)}
                className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
              <div className="text-[10px] text-muted-foreground mt-0.5">100 = долив, 0 = воздух</div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">ρ жидк. внутри, г/см³</label>
              <input type="number" step="0.01" min="0" max="2.5" value={fillFluidDensity} onChange={e => setFillFluidDensity(+e.target.value)}
                className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Грузоподъёмность, кН</label>
              <input type="number" step="100" min="500" max="10000" value={maxHookLoad} onChange={e => setMaxHookLoad(+e.target.value)}
                className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Градиент ГРП, кПа/м</label>
              <input type="number" step="0.5" min="10" max="30" value={fracGradKpa} onChange={e => setFracGradKpa(+e.target.value)}
                className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Градиент пласт., кПа/м</label>
              <input type="number" step="0.5" min="5" max="20" value={poreGradKpa} onChange={e => setPoreGradKpa(+e.target.value)}
                className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer text-xs">
                <input type="checkbox" checked={isOpenEnded} onChange={e => setIsOpenEnded(e.target.checked)} className="rounded border-border" />
                <span className="text-muted-foreground">Открытый конец (без БКМ)</span>
              </label>
            </div>
          </div>

          {/* Toggles for rheology and centralizer effects */}
          <div className="flex flex-wrap gap-4 mt-4 text-xs">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={useFluidRheology} onChange={e => setUseFluidRheology(e.target.checked)}
                className="rounded border-border" />
              <span className="text-muted-foreground">Учёт реологии жидкостей</span>
              {hasFluidData && <span className="text-green-400">({fluidSegments!.length} сегм.)</span>}
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={useCentralizerDrag} onChange={e => setUseCentralizerDrag(e.target.checked)}
                className="rounded border-border" />
              <span className="text-muted-foreground">Учёт сопр. центраторов</span>
              {hasCentData && <span className="text-green-400">({centralizerDrag!.length} инт.)</span>}
            </label>
          </div>

          {/* Info about fluid effects */}
          {(hasFluidData || hasCentData) && (
            <div className="mt-3 p-2 rounded bg-muted/30 text-[10px] text-muted-foreground space-y-1">
              {hasFluidData && (
                <p>Реология: вязкостное сопр. потока учтено в спуске/подъёме (Бингам-пластик, v={tripSpeed} м/с). Момент от жидкости — в режиме «Цемент. с вращением».</p>
              )}
              {hasCentData && (
                <p>Центраторы: доп. сопр. {centralizerDrag!.reduce((s, c) => s + c.centralizersPerJoint * Math.ceil((c.toMD - c.fromMD) / c.jointLength), 0)} шт. учтено при спуске.</p>
              )}
              {summary.tripIn.totalViscousDrag! > 0 && (
                <p>Суммарное вязкостное сопротивление (спуск): <strong>{fmt(summary.tripIn.totalViscousDrag!, 1)} кН</strong></p>
              )}
              {summary.tripIn.totalCentralizerDrag! > 0 && (
                <p>Суммарное сопротивление центраторов (спуск): <strong>{fmt(summary.tripIn.totalCentralizerDrag!, 1)} кН</strong></p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Summary table - all 9 modes */}
      <Card>
        <CardHeader className="pb-4"><CardTitle className="text-lg">📊 Сводка Torque & Drag (9 режимов)</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-1 text-muted-foreground font-medium text-xs">Параметр</th>
                  {allModes.map((m, i) => (
                    <th key={i} className="text-right py-2 px-1 text-muted-foreground font-medium text-[10px] whitespace-nowrap">{m.modeLabel.split(' ').slice(0, 2).join(' ')}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border">
                  <td className="py-2 px-1 text-muted-foreground text-xs">HL макс, кН</td>
                  {allModes.map((m, i) => <td key={i} className="py-2 px-1 text-right font-semibold text-xs">{fmt(m.maxHookLoad, 0)}</td>)}
                </tr>
                <tr className="border-b border-border">
                  <td className="py-2 px-1 text-muted-foreground text-xs">HL мин, кН</td>
                  {allModes.map((m, i) => <td key={i} className="py-2 px-1 text-right font-semibold text-xs">{fmt(m.minHookLoad, 0)}</td>)}
                </tr>
                <tr className="border-b border-border">
                  <td className="py-2 px-1 text-muted-foreground text-xs">Момент макс, кН·м</td>
                  {allModes.map((m, i) => <td key={i} className="py-2 px-1 text-right font-semibold text-xs">{m.maxTorque > 0 ? fmt(m.maxTorque, 1) : "—"}</td>)}
                </tr>
                <tr className="border-b border-border">
                  <td className="py-2 px-1 text-muted-foreground text-xs">Бок. сила макс, кН/м</td>
                  {allModes.map((m, i) => <td key={i} className="py-2 px-1 text-right font-semibold text-xs">{fmt(m.maxSideForce, 2)}</td>)}
                </tr>
                <tr className="border-b border-border">
                  <td className="py-2 px-1 text-muted-foreground text-xs">Вязк. сопр., кН</td>
                  {allModes.map((m, i) => <td key={i} className="py-2 px-1 text-right font-semibold text-xs">{m.totalViscousDrag && m.totalViscousDrag > 0.1 ? fmt(m.totalViscousDrag, 1) : "—"}</td>)}
                </tr>
                <tr className="border-b border-border">
                  <td className="py-2 px-1 text-muted-foreground text-xs">Центр. сопр., кН</td>
                  {allModes.map((m, i) => <td key={i} className="py-2 px-1 text-right font-semibold text-xs">{m.totalCentralizerDrag && m.totalCentralizerDrag > 0.1 ? fmt(m.totalCentralizerDrag, 1) : "—"}</td>)}
                </tr>
                <tr className="border-b border-border">
                  <td className="py-2 px-1 text-muted-foreground text-xs">Усталость (макс)</td>
                  {allModes.map((m, i) => <td key={i} className="py-2 px-1 text-right font-semibold text-xs">{m.maxFatigueDamage && m.maxFatigueDamage > 0 ? fmt(m.maxFatigueDamage, 6) : "—"}</td>)}
                </tr>
                <tr>
                  <td className="py-2 px-1 text-muted-foreground text-xs">Von Mises макс, МПа</td>
                  {allModes.map((m, i) => <td key={i} className="py-2 px-1 text-right font-semibold text-xs">{m.maxVonMises && m.maxVonMises > 0 ? fmt(m.maxVonMises, 0) : "—"}</td>)}
                </tr>
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
            <span>Коэфф. плавучести: <strong>{fmt(summary.buoyancyFactor, 3)}</strong></span>
            <span>Свободный вес: <strong>{fmt(summary.freeWeight, 0)} кН</strong></span>
          </div>
        </CardContent>
      </Card>

      {/* Chart 1: Hook Load — all modes */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-lg">📈 Вес на крюке по глубине (все режимы)</CardTitle>
          <CopyImageButton targetRef={chartRef1} />
        </CardHeader>
        <CardContent>
          <ScrollableChart chartRef={chartRef1} height="h-[450px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <YAxis dataKey="md" type="number" reversed domain={[0, 'dataMax']} label={{ value: 'MD, м', angle: -90, position: 'insideLeft' }} tick={{ fontSize: 11 }} />
                <XAxis type="number" label={{ value: 'кН', position: 'insideBottom', offset: -5 }} tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={ts} formatter={(v: number) => fmt(v, 0) + ' кН'} labelFormatter={(l: number) => `MD: ${l} м`} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Line dataKey="tripInHL" name="Спуск" stroke="hsl(200, 70%, 50%)" dot={false} strokeWidth={2} />
                <Line dataKey="tripOutHL" name="Подъём" stroke="hsl(0, 70%, 50%)" dot={false} strokeWidth={2} />
                <Line dataKey="rotateHL" name="Вращение" stroke="hsl(120, 50%, 45%)" dot={false} strokeWidth={2} />
                <Line dataKey="drillRotaryHL" name="Бурение рот." stroke="hsl(280, 60%, 50%)" dot={false} strokeWidth={1.5} strokeDasharray="4 2" />
                <Line dataKey="drillMotorHL" name="Бурение ГЗД" stroke="hsl(30, 80%, 50%)" dot={false} strokeWidth={1.5} strokeDasharray="4 2" />
                <Line dataKey="pickupHL" name="Затяжка" stroke="hsl(340, 70%, 55%)" dot={false} strokeWidth={1.5} />
                <Line dataKey="slackoffHL" name="Разгрузка" stroke="hsl(170, 60%, 45%)" dot={false} strokeWidth={1.5} />
                <Line dataKey="cementRotateHL" name="Цемент+вращ." stroke="hsl(45, 90%, 50%)" dot={false} strokeWidth={2} strokeDasharray="6 3" />
                <Line dataKey="freeWeight" name="Своб. вес" stroke="hsl(var(--muted-foreground))" dot={false} strokeWidth={1} strokeDasharray="5 5" />
              </LineChart>
            </ResponsiveContainer>
          </ScrollableChart>
        </CardContent>
      </Card>

      {/* Chart 2: Effective Tension */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-lg">📈 Эффективное натяжение по глубине</CardTitle>
          <CopyImageButton targetRef={chartRef2} />
        </CardHeader>
        <CardContent>
          <ScrollableChart chartRef={chartRef2} height="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <YAxis dataKey="md" type="number" reversed domain={[0, 'dataMax']} label={{ value: 'MD, м', angle: -90, position: 'insideLeft' }} tick={{ fontSize: 11 }} />
                <XAxis type="number" label={{ value: 'кН', position: 'insideBottom', offset: -5 }} tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={ts} formatter={(v: number) => fmt(v, 1) + ' кН'} labelFormatter={(l: number) => `MD: ${l} м`} />
                <Legend />
                <ReferenceLine x={0} stroke="hsl(var(--border))" strokeWidth={1} />
                <Line dataKey="tripInTension" name="Спуск" stroke="hsl(200, 70%, 50%)" dot={false} strokeWidth={2} />
                <Line dataKey="tripOutTension" name="Подъём" stroke="hsl(0, 70%, 50%)" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </ScrollableChart>
        </CardContent>
      </Card>

      {/* Chart 3: Torque — all rotating modes incl. cement */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-lg">📈 Крутящий момент по глубине</CardTitle>
          <CopyImageButton targetRef={chartRef3} />
        </CardHeader>
        <CardContent>
          <ScrollableChart chartRef={chartRef3} height="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <YAxis dataKey="md" type="number" reversed domain={[0, 'dataMax']} label={{ value: 'MD, м', angle: -90, position: 'insideLeft' }} tick={{ fontSize: 11 }} />
                <XAxis type="number" label={{ value: 'кН·м', position: 'insideBottom', offset: -5 }} tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={ts} formatter={(v: number) => fmt(v, 2) + ' кН·м'} labelFormatter={(l: number) => `MD: ${l} м`} />
                <Legend />
                <Line dataKey="torqueRot" name="Вращение" stroke="hsl(280, 60%, 50%)" dot={false} strokeWidth={2} />
                <Line dataKey="torqueDrill" name="Бурение рот." stroke="hsl(200, 70%, 50%)" dot={false} strokeWidth={2} />
                <Line dataKey="torqueMotor" name="Бурение ГЗД" stroke="hsl(30, 80%, 50%)" dot={false} strokeWidth={2} />
                <Line dataKey="torqueCement" name="Цемент+вращ." stroke="hsl(45, 90%, 50%)" dot={false} strokeWidth={2} strokeDasharray="6 3" />
              </LineChart>
            </ResponsiveContainer>
          </ScrollableChart>
        </CardContent>
      </Card>

      {/* Chart 4: Side Force + Clearance */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-lg">📈 Боковая сила и зазор по глубине</CardTitle>
          <CopyImageButton targetRef={chartRef4} />
        </CardHeader>
        <CardContent>
          <ScrollableChart chartRef={chartRef4} height="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <YAxis dataKey="md" type="number" reversed domain={[0, 'dataMax']} label={{ value: 'MD, м', angle: -90, position: 'insideLeft' }} tick={{ fontSize: 11 }} />
                <XAxis type="number" label={{ value: 'кН/м | мм', position: 'insideBottom', offset: -5 }} tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={ts} labelFormatter={(l: number) => `MD: ${l} м`} />
                <Legend />
                <Line dataKey="sideForce" name="Бок. сила (спуск)" stroke="hsl(35, 80%, 50%)" dot={false} strokeWidth={2} />
                <Line dataKey="clearance" name="Зазор, мм" stroke="hsl(160, 60%, 45%)" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </ScrollableChart>
        </CardContent>
      </Card>

      {/* Chart 5: Fatigue Damage */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-lg">📈 Усталостное повреждение по глубине</CardTitle>
          <CopyImageButton targetRef={chartRef5} />
        </CardHeader>
        <CardContent>
          <ScrollableChart chartRef={chartRef5} height="h-[350px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <YAxis dataKey="md" type="number" reversed domain={[0, 'dataMax']} label={{ value: 'MD, м', angle: -90, position: 'insideLeft' }} tick={{ fontSize: 11 }} />
                <XAxis type="number" label={{ value: 'Damage ratio', position: 'insideBottom', offset: -5 }} tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={ts} formatter={(v: number) => v.toExponential(2)} labelFormatter={(l: number) => `MD: ${l} м`} />
                <Legend />
                <Line dataKey="fatigue" name="Fatigue Damage (вращение)" stroke="hsl(0, 80%, 50%)" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </ScrollableChart>
        </CardContent>
      </Card>

      {/* Chart 6: Von Mises Stress */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-lg">📈 Напряжение Von Mises по глубине</CardTitle>
          <CopyImageButton targetRef={chartRef6} />
        </CardHeader>
        <CardContent>
          <ScrollableChart chartRef={chartRef6} height="h-[350px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <YAxis dataKey="md" type="number" reversed domain={[0, 'dataMax']} label={{ value: 'MD, м', angle: -90, position: 'insideLeft' }} tick={{ fontSize: 11 }} />
                <XAxis type="number" label={{ value: 'МПа', position: 'insideBottom', offset: -5 }} tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={ts} formatter={(v: number) => fmt(v, 0) + ' МПа'} labelFormatter={(l: number) => `MD: ${l} м`} />
                <Legend />
                <ReferenceLine x={yieldStrength} stroke="hsl(0, 80%, 50%)" strokeWidth={1} strokeDasharray="8 4" label={{ value: `Предел текучести ${yieldStrength} МПа`, position: "insideTopRight", fontSize: 10 }} />
                <Line dataKey="vonMises" name="Von Mises (спуск)" stroke="hsl(280, 60%, 50%)" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </ScrollableChart>
        </CardContent>
      </Card>

      {/* Detail Table */}
      <Card>
        <CardHeader className="pb-4"><CardTitle className="text-lg">📋 Детальная таблица по глубине</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="border-b border-border">
                  <th className="py-2 px-1 text-left text-muted-foreground">MD</th>
                  <th className="py-2 px-1 text-left text-muted-foreground">TVD</th>
                  <th className="py-2 px-1 text-right text-muted-foreground">Зенит</th>
                  <th className="py-2 px-1 text-right text-muted-foreground">HL спуск</th>
                  <th className="py-2 px-1 text-right text-muted-foreground">HL подъём</th>
                  <th className="py-2 px-1 text-right text-muted-foreground">HL вращ.</th>
                  <th className="py-2 px-1 text-right text-muted-foreground">HL цем.вр.</th>
                  <th className="py-2 px-1 text-right text-muted-foreground">Момент</th>
                  <th className="py-2 px-1 text-right text-muted-foreground">Бок. сила</th>
                  <th className="py-2 px-1 text-right text-muted-foreground">Зазор</th>
                  <th className="py-2 px-1 text-right text-muted-foreground">Fatigue</th>
                </tr>
              </thead>
              <tbody>
                {summary.tripIn.points.filter((_, i) => i % 5 === 0 || i === summary.tripIn.points.length - 1).map((pt, idx) => {
                  const i = summary.tripIn.points.indexOf(pt);
                  return (
                    <tr key={idx} className="border-b border-border">
                      <td className="py-1 px-1">{fmt(pt.md, 0)}</td>
                      <td className="py-1 px-1">{fmt(pt.tvd, 0)}</td>
                      <td className="py-1 px-1 text-right">{fmt(pt.zenith, 1)}°</td>
                      <td className="py-1 px-1 text-right">{fmt(pt.hookLoad, 0)}</td>
                      <td className="py-1 px-1 text-right">{fmt(summary.tripOut.points[i]?.hookLoad ?? 0, 0)}</td>
                      <td className="py-1 px-1 text-right">{fmt(summary.rotate.points[i]?.hookLoad ?? 0, 0)}</td>
                      <td className="py-1 px-1 text-right">{fmt(extraModes.cementRotate.points[i]?.hookLoad ?? 0, 0)}</td>
                      <td className="py-1 px-1 text-right">{fmt(summary.rotate.points[i]?.torque ?? 0, 2)}</td>
                      <td className="py-1 px-1 text-right">{fmt(pt.sideForce, 2)}</td>
                      <td className="py-1 px-1 text-right">{fmt(pt.clearance, 0)}</td>
                      <td className="py-1 px-1 text-right">{(pt.fatigueDamage ?? 0).toExponential(1)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
