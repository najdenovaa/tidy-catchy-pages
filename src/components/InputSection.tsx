import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DebouncedInput } from "@/components/DebouncedInput";
import { Label } from "@/components/ui/label";
import { useState, memo, useCallback, useMemo, ChangeEvent } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { getCasingID, getSlurryHeight, annularVolumePerMeter, annularVolumeForInterval, hydrostaticPressure, interpolateTVD, calculateTVDFromSurvey, calculateCement, calculateAdditiveMass, effectiveRheology, cementCategory, calculateHydraulics, getFlowRateLps } from "@/lib/cementing-calculations";
import type { WellData, DrillingFluid, BufferFluid, SlurryInput, Additive, AdditivePercentageType, DisplacementFluid, FlowRateStep, TrajectoryPoint, CasingSection, CavernInterval } from "@/lib/cementing-calculations";
import * as XLSX from "xlsx";

interface Props {
  wellData: WellData;
  onWellDataChange: (d: WellData) => void;
  drillingFluid: DrillingFluid;
  onDrillingFluidChange: (f: DrillingFluid) => void;
  buffers: BufferFluid[];
  onBuffersChange: (b: BufferFluid[]) => void;
  slurries: SlurryInput[];
  onSlurriesChange: (s: SlurryInput[]) => void;
  displacementFluids: DisplacementFluid[];
  onDisplacementFluidsChange: (d: DisplacementFluid[]) => void;
  fractureGradient: number;
  onFractureGradientChange: (v: number) => void;
  flushTimeMin: number;
  onFlushTimeMinChange: (v: number) => void;
  flushVolumeM3: number;
  onFlushVolumeM3Change: (v: number) => void;
  displacementVolume?: number;
  dynamicBHPMap?: Record<string, { bhp: number; fracP: number }>; // ключ = "stageName|rateLps"
  onCalculate?: () => void;
}

type WellNumericKey = Exclude<keyof WellData, 'trajectory' | 'casingSections' | 'cavernIntervals'>;
const wellFields: { key: WellNumericKey; label: string; unit: string }[] = [
  { key: "wellDepthMD", label: "Глубина скважины (по стволу)", unit: "м" },
  { key: "wellDepthTVD", label: "Глубина скважины (по вертикали)", unit: "м" },
  { key: "casingDepthMD", label: "Глубина спуска ОК (по стволу)", unit: "м" },
  { key: "holeDiameter", label: "Номинальный диаметр ствола", unit: "мм" },
  { key: "casingOD", label: "Наружный диаметр ОК", unit: "мм" },
  { key: "casingWall", label: "Толщина стенки ОК", unit: "мм" },
  { key: "prevCasingDepth", label: "Глубина пред. колонны (по стволу)", unit: "м" },
  { key: "prevCasingOD", label: "Наружный диам. пред. колонны", unit: "мм" },
  { key: "prevCasingID", label: "Внутр. диам. пред. колонны", unit: "мм" },
  { key: "ckodDepth", label: "Глубина ЦКОД (по стволу)", unit: "м" },
  { key: "cementRiseHeight", label: "Высота подъёма цемента", unit: "м" },
  { key: "cavernCoeff", label: "Коэффициент кавернозности", unit: "" },
  { key: "bottomTempStatic", label: "BHST (статическая t°)", unit: "°C" },
  { key: "bottomTempCirc", label: "BHCT (циркуляционная t°)", unit: "°C" },
];

function SectionHeader({ title, isOpen, onClick }: { title: string; isOpen: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-2 py-3 px-4 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
      {isOpen ? <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />}
      <span className="font-medium text-sm text-foreground text-left">{title}</span>
    </button>
  );
}

const FlowRateStepsEditor = memo(function FlowRateStepsEditor({ steps, totalVolume, onChange, fracCheck, isDynamic }: {
  steps: FlowRateStep[];
  totalVolume: number;
  onChange: (s: FlowRateStep[]) => void;
  fracCheck?: (rateLps: number) => { risk: boolean; ecd: number; fracP: number; hydroStatic: number; frictionLoss: number } | null;
  isDynamic?: boolean;
}) {
  const usedVolume = steps.reduce((s, st) => s + st.volumeM3, 0);
  const remaining = totalVolume - usedVolume;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground font-medium">Режимы закачки</span>
        <button onClick={() => onChange([...steps, { rateLps: 5, volumeM3: Math.max(0, remaining) }])} className="text-xs text-primary hover:underline">+ режим</button>
      </div>
      {steps.map((step, i) => {
        const fc = fracCheck ? fracCheck(step.rateLps) : null;
        return (
          <div key={i} className="space-y-0.5">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 flex-1">
                <DebouncedInput type="number" step="0.1" value={step.rateLps || ""} onChange={(e) => {
                  const u = [...steps]; u[i] = { ...u[i], rateLps: parseFloat(e.target.value) || 0 }; onChange(u);
                }} className="h-7 text-xs w-20" placeholder="л/с" />
                <span className="text-xs text-muted-foreground">л/с</span>
              </div>
              <div className="flex items-center gap-1">
                <DebouncedInput type="number" step="0.1" value={step.volumeM3 || ""} onChange={(e) => {
                  const u = [...steps]; u[i] = { ...u[i], volumeM3: parseFloat(e.target.value) || 0 }; onChange(u);
                }} className="h-7 text-xs w-20" placeholder="м³" />
                <span className="text-xs text-muted-foreground">м³</span>
              </div>
              {steps.length > 1 && (
                <button onClick={() => onChange(steps.filter((_, j) => j !== i))} className="text-xs text-destructive">✕</button>
              )}
            </div>
            {fc && step.rateLps > 0 && (
              <div className={`text-xs px-2 py-1 rounded space-y-0.5 ${fc.risk ? "bg-destructive/10 text-destructive" : "bg-green-500/10 text-green-700 dark:text-green-400"}`}>
                <div className="font-medium">
                  {fc.risk
                    ? `⚠ Риск ГРП! ECD ${isDynamic ? "=" : "≈"} ${fc.ecd.toFixed(2)} МПа > Pгрп ${fc.fracP.toFixed(2)} МПа`
                    : `✓ Нет риска ГРП (ECD ${isDynamic ? "=" : "≈"} ${fc.ecd.toFixed(2)} МПа < Pгрп ${fc.fracP.toFixed(2)} МПа)`}
                </div>
                {!isDynamic && (
                  <div className="opacity-75">
                    Гидростатика: {fc.hydroStatic.toFixed(2)} МПа &nbsp;|&nbsp; Трение: {fc.frictionLoss.toFixed(3)} МПа
                  </div>
                )}
                <div className={`text-[10px] italic ${isDynamic ? "opacity-90 font-medium" : "opacity-60"}`}>
                  {isDynamic ? "📊 Точные данные из динамической симуляции" : "⏳ Приближённо. Точные значения — после нажатия «РАССЧИТАТЬ»"}
                </div>
              </div>
            )}
          </div>
        );
      })}
      {totalVolume > 0 && (
        <div className={`text-xs ${Math.abs(remaining) < 0.01 ? "text-muted-foreground" : "text-destructive font-medium"}`}>
          Остаток: {remaining.toFixed(2)} м³ из {totalVolume.toFixed(2)} м³
        </div>
      )}
    </div>
  );
});

export default function InputSection(props: Props) {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    well: false, trajectory: false, mud: false, buffers: false, cement: false, displacement: false, hydraulics: false, flush: false,
  });

  const toggle = (key: string) => {
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const { wellData, onWellDataChange, drillingFluid, onDrillingFluidChange, buffers, onBuffersChange, slurries, onSlurriesChange, displacementFluids, onDisplacementFluidsChange, fractureGradient, onFractureGradientChange, flushTimeMin, onFlushTimeMinChange, flushVolumeM3, onFlushVolumeM3Change, displacementVolume, dynamicBHPMap, onCalculate } = props;

  // Обновить траекторию: автоматически пересчитывает TVD по методу минимальной кривизны
  const updateTrajectory = (newTraj: TrajectoryPoint[], autoCalcTVD: boolean = true) => {
    let traj = [...newTraj];
    if (autoCalcTVD && traj.length >= 2) {
      traj = calculateTVDFromSurvey(traj);
    }
    const sorted = [...traj].sort((a, b) => a.md - b.md);
    const lastTVD = sorted.length > 0 ? sorted[sorted.length - 1].tvd : wellData.wellDepthTVD;
    onWellDataChange({ ...wellData, trajectory: sorted, wellDepthTVD: lastTVD });
  };

  // Обновление одного поля строки — БЕЗ пересчёта TVD и БЕЗ сортировки (строки независимые)
  const updateTrajectoryPoint = (index: number, key: "md" | "azimuth" | "zenith", rawValue: string) => {
    const traj = [...(wellData.trajectory || [])];
    const current = traj[index];
    if (!current) return;
    if (rawValue.trim() === "") return; // пустое поле — игнорируем
    traj[index] = { ...current, [key]: Number(rawValue) };
    // Просто обновляем данные на месте, без сортировки и пересчёта
    onWellDataChange({ ...wellData, trajectory: traj });
  };

  // Пересчитать TVD по кнопке
  const recalcTrajectoryTVD = () => {
    const traj = [...(wellData.trajectory || [])];
    if (traj.length < 2) return;
    const sorted = [...traj].sort((a, b) => a.md - b.md);
    const calculated = calculateTVDFromSurvey(sorted);
    const lastTVD = calculated.length > 0 ? calculated[calculated.length - 1].tvd : wellData.wellDepthTVD;
    onWellDataChange({ ...wellData, trajectory: calculated, wellDepthTVD: lastTVD });
  };

  const handleTrajectoryExcelUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

      const normalize = (v: unknown) => String(v ?? "").trim().toLowerCase();
      const getNumber = (value: unknown) => {
        const num = Number(String(value ?? "").replace(",", "."));
        return Number.isFinite(num) ? num : null;
      };

      const mapped: TrajectoryPoint[] = rows
        .map((row) => {
          const keys = Object.keys(row);
          const mdKey = keys.find((k) => ["md", "глубина по стволу", "depth", "measured depth"].includes(normalize(k)));
          const azKey = keys.find((k) => ["azimuth", "азимут"].includes(normalize(k)));
          const zeKey = keys.find((k) => ["zenith", "зенит", "inclination", "inc"].includes(normalize(k)));

          const md = getNumber(mdKey ? row[mdKey] : undefined);
          const azimuth = getNumber(azKey ? row[azKey] : undefined);
          const zenith = getNumber(zeKey ? row[zeKey] : undefined);

          if (md === null || azimuth === null || zenith === null) return null;
          return { md, azimuth, zenith, tvd: 0 };
        })
        .filter((point): point is TrajectoryPoint => point !== null);

      if (mapped.length < 2) {
        alert("В Excel нужно минимум 2 строки с колонками: Глубина по стволу, Азимут, Зенит");
        event.target.value = "";
        return;
      }

      updateTrajectory(mapped, true);
      event.target.value = "";
    } catch {
      alert("Не удалось прочитать Excel-файл");
      event.target.value = "";
    }
  };

  const calcDispVol = displacementVolume ?? 0;

  const casingID = getCasingID(wellData.casingOD, wellData.casingWall);
  const annVPM = annularVolumePerMeter(wellData.holeDiameter, wellData.casingOD, wellData.cavernCoeff);

  // Fracture risk checker — использует динамические BHP из симуляции когда доступны,
  // иначе вычисляет приближённо
  const fracCheck = (rateLps: number, _fluidDensity: number, fluidPv: number, fluidYp: number, isDisplacement: boolean = false, stageName?: string): { risk: boolean; ecd: number; fracP: number; hydroStatic: number; frictionLoss: number } | null => {
    // Если есть динамические данные — используем их (100% совпадение с графиком)
    if (dynamicBHPMap && stageName) {
      const key = `${stageName}|${rateLps}`;
      const dyn = dynamicBHPMap[key];
      if (dyn) {
        return {
          risk: dyn.bhp > dyn.fracP,
          ecd: dyn.bhp,
          fracP: dyn.fracP,
          hydroStatic: 0,
          frictionLoss: 0,
        };
      }
    }

    const bottomTVD = interpolateTVD(wellData.casingDepthMD, wellData.trajectory);
    if (fractureGradient <= 0 || bottomTVD <= 0 || rateLps <= 0) return null;

    const fracP = (fractureGradient * bottomTVD) / 1000;
    const mudDensityGcm3 = drillingFluid.density > 0 ? drillingFluid.density / 1000 : 1.1;

    // === 1. Гидростатика затрубья (цементы + буферы + буровой) ===
    // Идентично calcAnnularHydrostatic() в динамике: строим столбы снизу вверх
    let annHydrostatic = 0;
    let currentBottomMD = wellData.casingDepthMD;

    // Цементные столбы (снизу вверх)
    for (let i = slurries.length - 1; i >= 0; i--) {
      const s = slurries[i];
      const hMD = getSlurryHeight(slurries, i, wellData.casingDepthMD);
      if (hMD > 0 && currentBottomMD > 0) {
        const lastIdx = slurries.length - 1;
        const mdBot = i === lastIdx ? wellData.casingDepthMD : slurries[i + 1].topDepthMD;
        const topMD = Math.max(0, mdBot - hMD);
        const tvdBot = interpolateTVD(Math.min(currentBottomMD, mdBot), wellData.trajectory);
        const tvdTop = interpolateTVD(topMD, wellData.trajectory);
        annHydrostatic += s.density * Math.max(0, tvdBot - tvdTop) * 0.00981;
        currentBottomMD = topMD;
      }
    }
    // Буферные столбы (над цементом)
    for (let i = buffers.length - 1; i >= 0; i--) {
      const b = buffers[i];
      if (b.volume > 0 && currentBottomMD > 0) {
        const annVPM = annularVolumePerMeter(wellData.holeDiameter, wellData.casingOD, wellData.cavernCoeff || 1);
        const bufferHeightMD = b.volume / annVPM;
        const topMD = Math.max(0, currentBottomMD - bufferHeightMD);
        const tvdBot = interpolateTVD(currentBottomMD, wellData.trajectory);
        const tvdTop = interpolateTVD(topMD, wellData.trajectory);
        annHydrostatic += (b.density / 1000) * Math.max(0, tvdBot - tvdTop) * 0.00981;
        currentBottomMD = topMD;
      }
    }
    // Оставшийся буровой раствор выше
    if (currentBottomMD > 0) {
      const tvd = interpolateTVD(currentBottomMD, wellData.trajectory);
      annHydrostatic += mudDensityGcm3 * tvd * 0.00981;
    }

    // === 2. Трение в затрубье — двухсекционная модель с загустеванием ===
    const casODm = wellData.casingOD / 1000;
    const prevShoe = wellData.prevCasingDepth || 0;
    const upperLen = Math.min(prevShoe, wellData.casingDepthMD);
    const lowerLen = Math.max(0, wellData.casingDepthMD - upperLen);

    const prevID = (wellData.prevCasingID || wellData.holeDiameter) / 1000;
    const dHydUpper = Math.max((wellData.prevCasingID || wellData.holeDiameter) - wellData.casingOD, 10); // mm
    const annAreaUpper = (Math.PI / 4) * (prevID * prevID - casODm * casODm);

    const dHoleM = wellData.holeDiameter / 1000;
    const dHydLower = Math.max(wellData.holeDiameter - wellData.casingOD, 10); // mm
    const annAreaLower = (Math.PI / 4) * (dHoleM * dHoleM - casODm * casODm);

    // Средняя реология и плотность в затрубье (как в динамике)
    const mudRheo = effectiveRheology(drillingFluid.rheology, 'mud');
    let annPv: number, annYp: number, annDensity: number;
    if (isDisplacement && slurries.length > 0) {
      const n = slurries.length;
      annPv = slurries.reduce((s, sl) => s + effectiveRheology(sl.rheology, cementCategory(sl.density)).pv, 0) / n;
      annYp = slurries.reduce((s, sl) => s + effectiveRheology(sl.rheology, cementCategory(sl.density)).yp, 0) / n;
      annDensity = slurries.reduce((s, sl) => s + sl.density * 1000, 0) / n;
    } else {
      annPv = mudRheo.pv;
      annYp = mudRheo.yp;
      annDensity = drillingFluid.density > 0 ? drillingFluid.density : 1100;
    }

    // Загустевание (при продавке)
    let thickeningMultiplier = 1.0;
    if (isDisplacement && slurries.length > 0) {
      let cementTimeMin = 0;
      slurries.forEach(s => {
        s.flowRateSteps.forEach(st => {
          if (st.rateLps > 0 && st.volumeM3 > 0) cementTimeMin += (st.volumeM3 * 1000 / st.rateLps) / 60;
        });
      });
      let dispTimeMin = 0;
      displacementFluids.forEach(df => {
        df.flowRateSteps.forEach(st => {
          if (st.rateLps > 0 && st.volumeM3 > 0) dispTimeMin += (st.volumeM3 * 1000 / st.rateLps) / 60;
        });
      });
      const totalTime = cementTimeMin + dispTimeMin;
      const maxThick30 = Math.max(...slurries.map(sl => sl.thickeningTime30Bc || 180));
      const p = Math.min(1, totalTime / maxThick30);
      thickeningMultiplier = 1.0 + 0.15 * p + 0.15 * p * p + 0.10 * p * p * p;
    }

    const effPv = annPv * thickeningMultiplier;
    const effYp = annYp * thickeningMultiplier;
    const flowRateM3min = rateLps * 0.06;

    // frictionLossWithRegime эквивалент (встроенный для точного совпадения)
    const calcSectionFriction = (flowRate: number, length: number, dHydMm: number, pv: number, yp: number, area: number, dens: number): number => {
      const dHyd = dHydMm / 1000;
      if (dHyd <= 0 || flowRate <= 0 || length <= 0) return 0;
      const fArea = area > 0 ? area : (Math.PI / 4) * dHyd * dHyd;
      const v = (flowRate / 60) / fArea;
      const pvPas = pv / 1000;
      const muEff = pvPas + yp * dHyd / (6 * v);
      const Re = dens * v * dHyd / muEff;
      const frLam = (32 * pvPas * v * length) / (dHyd * dHyd) / 1e6;
      const yieldTerm = (16 * yp * length) / (3 * dHyd) / 1e6;
      const laminar = frLam + yieldTerm;
      const f = 0.0791 / Math.pow(Math.max(Re, 100), 0.25);
      const turbulent = (2 * f * dens * v * v * length) / dHyd / 1e6;
      if (Re < 2100) return laminar;
      if (Re > 4000) return turbulent;
      const blend = (Re - 2100) / 1900;
      return laminar * (1 - blend) + turbulent * blend;
    };

    let frAnn = 0;
    if (upperLen > 0) frAnn += calcSectionFriction(flowRateM3min, upperLen, dHydUpper, effPv, effYp, annAreaUpper, annDensity);
    if (lowerLen > 0) frAnn += calcSectionFriction(flowRateM3min, lowerLen, dHydLower, effPv, effYp, annAreaLower, annDensity);
    const frictionLoss = frAnn * 0.8;

    const ecd = annHydrostatic + frictionLoss;
    return {
      risk: ecd > fracP,
      ecd,
      fracP,
      hydroStatic: annHydrostatic,
      frictionLoss,
    };
  };

  const handleWellChange = (key: WellNumericKey, value: string) => {
    onWellDataChange({ ...wellData, [key]: parseFloat(value) || 0 });
  };

  const handleMudChange = (field: string, value: string) => {
    const num = parseFloat(value) || 0;
    if (field === "density") onDrillingFluidChange({ ...drillingFluid, density: num });
    else if (field === "pv") onDrillingFluidChange({ ...drillingFluid, rheology: { ...drillingFluid.rheology, pv: num } });
    else if (field === "yp") onDrillingFluidChange({ ...drillingFluid, rheology: { ...drillingFluid.rheology, yp: num } });
    else if (field === "pvBottom") onDrillingFluidChange({ ...drillingFluid, rheologyBottomhole: { ...(drillingFluid.rheologyBottomhole || { pv: 0, yp: 0 }), pv: num } });
    else if (field === "ypBottom") onDrillingFluidChange({ ...drillingFluid, rheologyBottomhole: { ...(drillingFluid.rheologyBottomhole || { pv: 0, yp: 0 }), yp: num } });
    else if (field === "fluidLoss") onDrillingFluidChange({ ...drillingFluid, fluidLoss: num });
    else if (field === "name") onDrillingFluidChange({ ...drillingFluid, name: value });
  };

  const handleBufferChange = (idx: number, field: string, value: string) => {
    const updated = [...buffers];
    const b = { ...updated[idx] };
    if (field === "name") b.name = value;
    else if (field === "pv") b.rheology = { ...b.rheology, pv: parseFloat(value) || 0 };
    else if (field === "yp") b.rheology = { ...b.rheology, yp: parseFloat(value) || 0 };
    else (b as any)[field] = parseFloat(value) || 0;
    updated[idx] = b;
    onBuffersChange(updated);
  };

  const updateBufferAdditive = (bIdx: number, aIdx: number, field: keyof Additive, value: string) => {
    const updated = [...buffers];
    const b = { ...updated[bIdx], additives: [...updated[bIdx].additives] };
    b.additives[aIdx] = { ...b.additives[aIdx], [field]: field === "name" ? value : parseFloat(value) || 0 };
    updated[bIdx] = b;
    onBuffersChange(updated);
  };

  const handleSlurryChange = (idx: number, field: string, value: string) => {
    const updated = [...slurries];
    const s = { ...updated[idx] };
    if (field === "name") s.name = value;
    else if (field === "pv") s.rheology = { ...s.rheology, pv: parseFloat(value) || 0 };
    else if (field === "yp") s.rheology = { ...s.rheology, yp: parseFloat(value) || 0 };
    else (s as any)[field] = parseFloat(value) || 0;
    updated[idx] = s;
    onSlurriesChange(updated);
  };

  const updateSlurryAdditive = (sIdx: number, aIdx: number, field: keyof Additive, value: string) => {
    const updated = [...slurries];
    const s = { ...updated[sIdx], additives: [...updated[sIdx].additives] };
    if (field === "percentage") {
      const pct = parseFloat(value) || 0;
      s.additives[aIdx] = { ...s.additives[aIdx], percentage: pct };
    } else {
      s.additives[aIdx] = { ...s.additives[aIdx], [field]: field === "name" ? value : parseFloat(value) || 0 };
    }
    updated[sIdx] = s;
    onSlurriesChange(updated);
  };

  const handleDispFluidChange = (idx: number, field: string, value: string) => {
    const updated = [...displacementFluids];
    const d = { ...updated[idx] };
    const num = parseFloat(value) || 0;
    if (field === "name") d.name = value;
    else if (field === "density") d.density = num;
    else if (field === "pv") d.rheology = { ...d.rheology, pv: num };
    else if (field === "yp") d.rheology = { ...d.rheology, yp: num };
    else if (field === "compressionCoeff") d.compressionCoeff = num;
    updated[idx] = d;
    onDisplacementFluidsChange(updated);
  };

  return (
    <div className="space-y-4">
      {/* ===== 1. Скважина ===== */}
      <Card>
        <SectionHeader title="📐 Данные скважины" isOpen={openSections.well} onClick={() => toggle("well")} />
        {openSections.well && (
          <CardContent className="pt-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {wellFields.map(({ key, label, unit }) => (
                <div key={key} className="space-y-1">
                  <Label htmlFor={key} className="text-xs text-muted-foreground">{label}{unit && `, ${unit}`}</Label>
                  <Input id={key} type="number" step="any" value={wellData[key] || ""} onChange={(e) => handleWellChange(key, e.target.value)} className="h-9 text-sm" />
                </div>
              ))}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Внутр. диаметр ОК (расчёт), мм</Label>
                <div className="h-9 flex items-center px-3 rounded-md bg-muted text-sm font-semibold border border-border">{casingID.toFixed(1)}</div>
              </div>
            </div>

            {/* Секции обсадной колонны */}
            <div className="mt-6 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Секции ОК (разная толщина стенки)</span>
                <button
                  onClick={() => {
                    const sections = [...(wellData.casingSections || [])];
                    sections.push({ fromMD: 0, toMD: wellData.casingDepthMD || 1000, wallThickness: wellData.casingWall || 10 });
                    onWellDataChange({ ...wellData, casingSections: sections });
                  }}
                  className="text-xs text-primary hover:underline"
                >+ секция</button>
              </div>
              {wellData.casingSections && wellData.casingSections.length > 0 ? (
                <div className="space-y-1">
                  <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 text-xs text-muted-foreground px-1">
                    <span>От (MD), м</span><span>До (MD), м</span><span>Стенка, мм</span><span></span>
                  </div>
                  {wellData.casingSections.map((sec, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center">
                      <Input type="number" step="any" value={sec.fromMD || ""} onChange={(e) => {
                        const s = [...wellData.casingSections!]; s[i] = { ...s[i], fromMD: parseFloat(e.target.value) || 0 };
                        onWellDataChange({ ...wellData, casingSections: s });
                      }} className="h-7 text-xs" />
                      <Input type="number" step="any" value={sec.toMD || ""} onChange={(e) => {
                        const s = [...wellData.casingSections!]; s[i] = { ...s[i], toMD: parseFloat(e.target.value) || 0 };
                        onWellDataChange({ ...wellData, casingSections: s });
                      }} className="h-7 text-xs" />
                      <Input type="number" step="any" value={sec.wallThickness || ""} onChange={(e) => {
                        const s = [...wellData.casingSections!]; s[i] = { ...s[i], wallThickness: parseFloat(e.target.value) || 0 };
                        onWellDataChange({ ...wellData, casingSections: s });
                      }} className="h-7 text-xs" />
                      <button onClick={() => {
                        const s = wellData.casingSections!.filter((_, j) => j !== i);
                        onWellDataChange({ ...wellData, casingSections: s.length > 0 ? s : undefined });
                      }} className="text-xs text-destructive">✕</button>
                    </div>
                  ))}
                  <p className="text-[10px] text-muted-foreground/60 italic">Глубины без секций используют толщину стенки по умолчанию ({wellData.casingWall} мм)</p>
                </div>
              ) : (
                <p className="text-[10px] text-muted-foreground/60 italic">Не задано — используется единая толщина стенки ({wellData.casingWall} мм)</p>
              )}
            </div>

            {/* Интервалы кавернозности */}
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Интервалы кавернозности (открытый ствол)</span>
                <button
                  onClick={() => {
                    const intervals = [...(wellData.cavernIntervals || [])];
                    intervals.push({ fromMD: wellData.prevCasingDepth || 0, toMD: wellData.casingDepthMD || 1000, coeff: wellData.cavernCoeff || 1.0 });
                    onWellDataChange({ ...wellData, cavernIntervals: intervals });
                  }}
                  className="text-xs text-primary hover:underline"
                >+ интервал</button>
              </div>
              {wellData.cavernIntervals && wellData.cavernIntervals.length > 0 ? (
                <div className="space-y-1">
                  <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 text-xs text-muted-foreground px-1">
                    <span>От (MD), м</span><span>До (MD), м</span><span>Коэфф. каверн.</span><span></span>
                  </div>
                  {wellData.cavernIntervals.map((iv, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center">
                      <Input type="number" step="any" value={iv.fromMD || ""} onChange={(e) => {
                        const arr = [...wellData.cavernIntervals!]; arr[i] = { ...arr[i], fromMD: parseFloat(e.target.value) || 0 };
                        onWellDataChange({ ...wellData, cavernIntervals: arr });
                      }} className="h-7 text-xs" />
                      <Input type="number" step="any" value={iv.toMD || ""} onChange={(e) => {
                        const arr = [...wellData.cavernIntervals!]; arr[i] = { ...arr[i], toMD: parseFloat(e.target.value) || 0 };
                        onWellDataChange({ ...wellData, cavernIntervals: arr });
                      }} className="h-7 text-xs" />
                      <Input type="number" step="0.01" value={iv.coeff || ""} onChange={(e) => {
                        const arr = [...wellData.cavernIntervals!]; arr[i] = { ...arr[i], coeff: parseFloat(e.target.value) || 0 };
                        onWellDataChange({ ...wellData, cavernIntervals: arr });
                      }} className="h-7 text-xs" />
                      <button onClick={() => {
                        const arr = wellData.cavernIntervals!.filter((_, j) => j !== i);
                        onWellDataChange({ ...wellData, cavernIntervals: arr.length > 0 ? arr : undefined });
                      }} className="text-xs text-destructive">✕</button>
                    </div>
                  ))}
                  <p className="text-[10px] text-muted-foreground/60 italic">Глубины без интервалов используют коэфф. по умолчанию ({wellData.cavernCoeff})</p>
                </div>
              ) : (
                <p className="text-[10px] text-muted-foreground/60 italic">Не задано — используется единый коэфф. кавернозности ({wellData.cavernCoeff})</p>
              )}
            </div>
          </CardContent>
        )}
      </Card>

      {/* ===== 1.5. Профиль скважины ===== */}
      <Card>
        <SectionHeader title="📏 Профиль скважины (инклинометрия)" isOpen={openSections.trajectory} onClick={() => toggle("trajectory")} />
        {openSections.trajectory && (
          <CardContent className="pt-4 space-y-3">
            <p className="text-xs text-muted-foreground italic">Задайте точки инклинометрии. TVD используется для расчёта давлений.</p>
            {/* Desktop table */}
            <div className="overflow-x-auto hidden sm:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="text-left py-1 px-2 w-8">#</th>
                    <th className="text-left py-1 px-2">По стволу (MD), м</th>
                    <th className="text-left py-1 px-2">Азимут, °</th>
                    <th className="text-left py-1 px-2">Зенит, °</th>
                    <th className="text-left py-1 px-2">По вертикали (TVD), м <span className="text-primary font-normal">(авто)</span></th>
                    <th className="py-1 px-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {(wellData.trajectory || []).map((pt, i) => (
                    <tr key={i} className="border-b border-border/30">
                      <td className="py-1 px-2 text-xs text-muted-foreground">{i + 1}</td>
                      <td className="py-1 px-2"><Input type="number" step="any" value={pt.md || ""} onChange={(e) => updateTrajectoryPoint(i, "md", e.target.value)} className="h-7 text-xs" /></td>
                      <td className="py-1 px-2"><Input type="number" step="any" value={pt.azimuth || ""} onChange={(e) => updateTrajectoryPoint(i, "azimuth", e.target.value)} className="h-7 text-xs" /></td>
                      <td className="py-1 px-2"><Input type="number" step="any" value={pt.zenith || ""} onChange={(e) => updateTrajectoryPoint(i, "zenith", e.target.value)} className="h-7 text-xs" /></td>
                      <td className="py-1 px-2">
                        <div className="h-7 flex items-center px-2 rounded bg-muted text-xs font-medium border border-border">
                          {pt.tvd ? pt.tvd.toFixed(2) : "—"}
                        </div>
                      </td>
                      <td className="py-1 px-2">
                        {(wellData.trajectory || []).length > 2 && (
                          <button onClick={() => {
                            const traj = (wellData.trajectory || []).filter((_, j) => j !== i);
                            updateTrajectory(traj);
                          }} className="text-xs text-destructive">✕</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Mobile cards */}
            <div className="sm:hidden space-y-3">
              {(wellData.trajectory || []).map((pt, i) => (
                <div key={i} className="border border-border rounded-lg p-3 space-y-2 bg-muted/30">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">Точка {i + 1}</span>
                    {(wellData.trajectory || []).length > 2 && (
                      <button onClick={() => {
                        const traj = (wellData.trajectory || []).filter((_, j) => j !== i);
                        updateTrajectory(traj);
                      }} className="text-xs text-destructive">✕ Удалить</button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">MD, м</Label>
                      <Input type="number" step="any" value={pt.md || ""} onChange={(e) => updateTrajectoryPoint(i, "md", e.target.value)} className="h-9 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Азимут, °</Label>
                      <Input type="number" step="any" value={pt.azimuth || ""} onChange={(e) => updateTrajectoryPoint(i, "azimuth", e.target.value)} className="h-9 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Зенит, °</Label>
                      <Input type="number" step="any" value={pt.zenith || ""} onChange={(e) => updateTrajectoryPoint(i, "zenith", e.target.value)} className="h-9 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">TVD, м (авто)</Label>
                      <div className="h-9 flex items-center px-3 rounded-md bg-muted text-sm font-medium border border-border">
                        {pt.tvd ? pt.tvd.toFixed(2) : "—"}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs px-3 py-1.5 rounded-md border border-border text-foreground hover:bg-muted cursor-pointer transition-colors">
                Импорт Excel (MD-азимут-зенит)
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleTrajectoryExcelUpload}
                  className="hidden"
                />
              </label>
              <button
                onClick={() => {
                  const traj = [...(wellData.trajectory || [])];
                  const lastPt = traj[traj.length - 1];
                  traj.push({ md: (lastPt?.md || 0) + 50, azimuth: lastPt?.azimuth || 0, zenith: lastPt?.zenith || 0, tvd: 0 });
                  onWellDataChange({ ...wellData, trajectory: traj });
                }}
                className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                + Добавить точку
              </button>
              <button
                onClick={recalcTrajectoryTVD}
                className="text-xs px-3 py-1.5 rounded-md bg-accent text-accent-foreground hover:bg-accent/80 transition-colors font-medium"
              >
                📐 Пересчитать TVD
              </button>
            </div>
          </CardContent>
        )}
      </Card>

      {/* ===== 2. Буровой раствор ===== */}
      <Card>
        <SectionHeader title="🧪 Буровой раствор" isOpen={openSections.mud} onClick={() => toggle("mud")} />
        {openSections.mud && (
          <CardContent className="pt-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Тип бурового раствора</Label>
                <Input value={drillingFluid.name} onChange={(e) => handleMudChange("name", e.target.value)} className="h-9 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Плотность, кг/м³</Label>
                <Input type="number" step="1" value={drillingFluid.density || ""} onChange={(e) => handleMudChange("density", e.target.value)} className="h-9 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Водоотдача, мл/30мин</Label>
                <Input type="number" step="1" value={drillingFluid.fluidLoss || ""} onChange={(e) => handleMudChange("fluidLoss", e.target.value)} className="h-9 text-sm" />
              </div>
            </div>
            <div className="mt-4">
              <p className="text-xs font-medium text-muted-foreground mb-2">Реология на поверхности</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">PV (пласт. вязкость), сПз</Label>
                  <Input type="number" step="1" value={drillingFluid.rheology.pv || ""} onChange={(e) => handleMudChange("pv", e.target.value)} className="h-9 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">YP (ДНС), Па</Label>
                  <Input type="number" step="0.1" value={drillingFluid.rheology.yp || ""} onChange={(e) => handleMudChange("yp", e.target.value)} className="h-9 text-sm" />
                </div>
              </div>
            </div>
            <div className="mt-4">
              <p className="text-xs font-medium text-muted-foreground mb-2">Реология на забое (опционально)</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">PV забой, сПз</Label>
                  <Input type="number" step="1" value={drillingFluid.rheologyBottomhole?.pv || ""} onChange={(e) => handleMudChange("pvBottom", e.target.value)} className="h-9 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">YP забой, Па</Label>
                  <Input type="number" step="0.1" value={drillingFluid.rheologyBottomhole?.yp || ""} onChange={(e) => handleMudChange("ypBottom", e.target.value)} className="h-9 text-sm" />
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground/60 italic mt-1">Если не задано, используются значения с поверхности</p>
            </div>
          </CardContent>
        )}
      </Card>

      {/* ===== 3. Буферы ===== */}
      <Card>
        <SectionHeader title="💧 Буферные жидкости" isOpen={openSections.buffers} onClick={() => toggle("buffers")} />
        {openSections.buffers && (
          <CardContent className="pt-4 space-y-4">
            <div className="flex justify-end">
              <button onClick={() => onBuffersChange([...buffers, { name: `Буфер ${buffers.length + 1}`, density: 1000, volume: 1, rheology: { pv: 1, yp: 0 }, additives: [], flowRateSteps: [{ rateLps: 5, volumeM3: 1 }] }])} className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                + Добавить буфер
              </button>
            </div>

            {buffers.map((b, idx) => (
              <div key={idx} className="p-3 rounded-lg bg-muted/30 space-y-3 border border-border/50">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{b.name}</span>
                  {buffers.length > 1 && <button onClick={() => onBuffersChange(buffers.filter((_, i) => i !== idx))} className="text-xs text-destructive hover:underline">Удалить</button>}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  <div className="space-y-1"><Label className="text-xs text-muted-foreground">Название</Label><DebouncedInput value={b.name} onChange={(e) => handleBufferChange(idx, "name", e.target.value)} className="h-8 text-sm" /></div>
                  <div className="space-y-1"><Label className="text-xs text-muted-foreground">Плотность, кг/м³</Label><DebouncedInput type="number" value={b.density || ""} onChange={(e) => handleBufferChange(idx, "density", e.target.value)} className="h-8 text-sm" /></div>
                  <div className="space-y-1"><Label className="text-xs text-muted-foreground">Объём, м³</Label><DebouncedInput type="number" step="0.1" value={b.volume || ""} onChange={(e) => handleBufferChange(idx, "volume", e.target.value)} className="h-8 text-sm" /></div>
                  <div className="space-y-1"><Label className="text-xs text-muted-foreground">PV, сПз</Label><DebouncedInput type="number" value={b.rheology.pv || ""} onChange={(e) => handleBufferChange(idx, "pv", e.target.value)} className="h-8 text-sm" /></div>
                  <div className="space-y-1"><Label className="text-xs text-muted-foreground">YP, Па</Label><DebouncedInput type="number" step="0.1" value={b.rheology.yp || ""} onChange={(e) => handleBufferChange(idx, "yp", e.target.value)} className="h-8 text-sm" /></div>
                </div>
                {/* Режимы закачки */}
                <FlowRateStepsEditor
                  steps={b.flowRateSteps}
                  totalVolume={b.volume}
                  onChange={(steps) => { const u = [...buffers]; u[idx] = { ...u[idx], flowRateSteps: steps }; onBuffersChange(u); }}
                  fracCheck={(rateLps) => fracCheck(rateLps, b.density, b.rheology.pv, b.rheology.yp, false, b.name)}
                  isDynamic={!!dynamicBHPMap}
                />
                {/* Добавки */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Компонентный состав</span>
                    <button onClick={() => { const u = [...buffers]; u[idx] = { ...u[idx], additives: [...u[idx].additives, { name: "", percentage: 0, percentageType: 'bwoc' as AdditivePercentageType, massKg: 0 }] }; onBuffersChange(u); }} className="text-xs text-primary hover:underline">+ добавка</button>
                  </div>
                  {b.additives.map((a, aIdx) => {
                    const bufferMassKg = b.volume * b.density;
                    const computedMass = a.percentage > 0 ? (a.percentage / 100) * bufferMassKg : a.massKg;
                    return (
                      <div key={aIdx} className="flex items-center gap-2">
                        <DebouncedInput value={a.name} onChange={(e) => updateBufferAdditive(idx, aIdx, "name", e.target.value)} placeholder="Наименование" className="h-7 text-xs flex-1" />
                        <DebouncedInput type="number" step="0.01" value={a.percentage || ""} onChange={(e) => updateBufferAdditive(idx, aIdx, "percentage", e.target.value)} className="h-7 text-xs w-16" placeholder="%" />
                        <span className="text-xs text-muted-foreground">%</span>
                        <div className="h-7 flex items-center px-2 rounded bg-muted text-xs font-medium border border-border min-w-[60px]">
                          {computedMass > 0 ? computedMass.toFixed(1) : "—"}
                        </div>
                        <span className="text-xs text-muted-foreground">кг</span>
                        <button onClick={() => { const u = [...buffers]; u[idx] = { ...u[idx], additives: u[idx].additives.filter((_, i) => i !== aIdx) }; onBuffersChange(u); }} className="text-xs text-destructive">✕</button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </CardContent>
        )}
      </Card>

      {/* ===== 4. Цементные растворы ===== */}
      <Card>
        <SectionHeader title="🏗️ Тампонажные растворы (цемент)" isOpen={openSections.cement} onClick={() => toggle("cement")} />
        {openSections.cement && (
          <CardContent className="pt-4 space-y-4">
            <div className="flex justify-end gap-2">
              <button onClick={() => onSlurriesChange([...slurries, { name: `Раствор ${slurries.length + 1}`, density: 1.85, topDepthMD: 0, rheology: { pv: 30, yp: 10 }, additives: [], thickeningTime30Bc: 0, thickeningTime50Bc: 0, flowRateSteps: [{ rateLps: 5, volumeM3: 0 }], waterRatio: 0.5, yieldPerTon: 0.63 }])} className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                + Добавить раствор
              </button>
            </div>
            <p className="text-xs text-muted-foreground italic">Порядок: первый = у устья (верхний), последний = у забоя. В закачке: последний качается первым.</p>

            {slurries.map((s, idx) => {
              const height = getSlurryHeight(slurries, idx, wellData.casingDepthMD);
              // Расчёт сухой массы цемента для автоподстановки массы добавок
              const lastIdx = slurries.length - 1;
              const mdBot = idx === lastIdx ? wellData.casingDepthMD : slurries[idx + 1].topDepthMD;
              const slurryVol = height > 0 ? annularVolumeForInterval(s.topDepthMD, mdBot, wellData.holeDiameter, wellData.casingOD, wellData.prevCasingID, wellData.prevCasingDepth, wellData.cavernCoeff, wellData.cavernIntervals) : 0;
              const cementRes = slurryVol > 0 ? calculateCement(slurryVol, s.density) : null;
              const dryMassKg = cementRes ? cementRes.dryMass * 1000 : 0; // т → кг
              return (
                <div key={idx} className="p-3 rounded-lg bg-muted/30 space-y-3 border border-border/50">
                <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">{s.name}</span>
                    <div className="flex items-center gap-2">
                      {idx > 0 && (
                        <button onClick={() => { const u = [...slurries]; [u[idx - 1], u[idx]] = [u[idx], u[idx - 1]]; onSlurriesChange(u); }} className="text-xs px-1.5 py-0.5 rounded bg-muted hover:bg-muted/80 text-foreground" title="Переместить вверх">↑</button>
                      )}
                      {idx < slurries.length - 1 && (
                        <button onClick={() => { const u = [...slurries]; [u[idx], u[idx + 1]] = [u[idx + 1], u[idx]]; onSlurriesChange(u); }} className="text-xs px-1.5 py-0.5 rounded bg-muted hover:bg-muted/80 text-foreground" title="Переместить вниз">↓</button>
                      )}
                      {slurries.length > 1 && <button onClick={() => onSlurriesChange(slurries.filter((_, i) => i !== idx))} className="text-xs text-destructive hover:underline">Удалить</button>}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    <div className="space-y-1"><Label className="text-xs text-muted-foreground">Название</Label><DebouncedInput value={s.name} onChange={(e) => handleSlurryChange(idx, "name", e.target.value)} className="h-8 text-sm" /></div>
                    <div className="space-y-1"><Label className="text-xs text-muted-foreground">Плотность, г/см³</Label><DebouncedInput type="number" step="0.01" value={s.density || ""} onChange={(e) => handleSlurryChange(idx, "density", e.target.value)} className="h-8 text-sm" /></div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Верх цемента от устья, м</Label>
                      <DebouncedInput type="number" value={s.topDepthMD || ""} onChange={(e) => handleSlurryChange(idx, "topDepthMD", e.target.value)} className="h-8 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Высота столба (расчёт), м</Label>
                      <div className="h-8 flex items-center px-3 rounded-md bg-muted text-sm font-semibold border border-border">{height.toFixed(0)}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="space-y-1"><Label className="text-xs text-muted-foreground">В/Ц отношение</Label><DebouncedInput type="number" step="0.001" value={s.waterRatio || ""} onChange={(e) => handleSlurryChange(idx, "waterRatio", e.target.value)} className="h-8 text-sm" /></div>
                    <div className="space-y-1"><Label className="text-xs text-muted-foreground">Выход, м³/т</Label><DebouncedInput type="number" step="0.01" value={s.yieldPerTon || ""} onChange={(e) => handleSlurryChange(idx, "yieldPerTon", e.target.value)} className="h-8 text-sm" /></div>
                    <div className="space-y-1"><Label className="text-xs text-muted-foreground">Загуст. 30 Вс, мин</Label><DebouncedInput type="number" value={s.thickeningTime30Bc || ""} onChange={(e) => handleSlurryChange(idx, "thickeningTime30Bc", e.target.value)} className="h-8 text-sm" /></div>
                    <div className="space-y-1"><Label className="text-xs text-muted-foreground">Загуст. 50 Вс, мин</Label><DebouncedInput type="number" value={s.thickeningTime50Bc || ""} onChange={(e) => handleSlurryChange(idx, "thickeningTime50Bc", e.target.value)} className="h-8 text-sm" /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">PV / YP</Label>
                      <div className="flex gap-1">
                        <DebouncedInput type="number" value={s.rheology.pv || ""} onChange={(e) => handleSlurryChange(idx, "pv", e.target.value)} className="h-8 text-sm" placeholder="PV" />
                        <DebouncedInput type="number" step="0.1" value={s.rheology.yp || ""} onChange={(e) => handleSlurryChange(idx, "yp", e.target.value)} className="h-8 text-sm" placeholder="YP" />
                      </div>
                    </div>
                  </div>
                  {/* Режимы закачки */}
                  <FlowRateStepsEditor
                    steps={s.flowRateSteps}
                    totalVolume={height > 0 ? annVPM * height : 0}
                    onChange={(steps) => { const u = [...slurries]; u[idx] = { ...u[idx], flowRateSteps: steps }; onSlurriesChange(u); }}
                    fracCheck={(rateLps) => fracCheck(rateLps, s.density * 1000, s.rheology.pv, s.rheology.yp, false, s.name)}
                    isDynamic={!!dynamicBHPMap}
                  />
                  {/* Добавки */}
                  <div className="space-y-1">
                     <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Добавки</span>
                      <button onClick={() => { const u = [...slurries]; u[idx] = { ...u[idx], additives: [...u[idx].additives, { name: "", percentage: 0, percentageType: 'bwoc' as AdditivePercentageType, massKg: 0 }] }; onSlurriesChange(u); }} className="text-xs text-primary hover:underline">+ добавка</button>
                    </div>
                    {s.additives.map((a, aIdx) => {
                      const pctType = a.percentageType || 'bwoc';
                      const computedMass = a.percentage > 0 && dryMassKg > 0
                        ? calculateAdditiveMass(a.percentage, pctType, dryMassKg)
                        : a.massKg;
                      return (
                        <div key={aIdx} className="flex items-center gap-2 flex-wrap">
                          <DebouncedInput value={a.name} onChange={(e) => updateSlurryAdditive(idx, aIdx, "name", e.target.value)} placeholder="Наименование" className="h-7 text-xs flex-1 min-w-[100px]" />
                          <DebouncedInput type="number" step="0.01" value={a.percentage || ""} onChange={(e) => updateSlurryAdditive(idx, aIdx, "percentage", e.target.value)} className="h-7 text-xs w-16" placeholder="%" />
                          <select
                            value={pctType}
                            onChange={(e) => {
                              const u = [...slurries];
                              const sl = { ...u[idx], additives: [...u[idx].additives] };
                              sl.additives[aIdx] = { ...sl.additives[aIdx], percentageType: e.target.value as AdditivePercentageType };
                              u[idx] = sl;
                              onSlurriesChange(u);
                            }}
                            className="h-7 text-xs rounded border border-border bg-background px-1"
                          >
                            <option value="bwoc">% bwoc</option>
                            <option value="bwob">% bwob</option>
                          </select>
                          <div className="h-7 flex items-center px-2 rounded bg-muted text-xs font-medium border border-border min-w-[60px]">
                            {computedMass > 0 ? computedMass.toFixed(1) : "—"}
                          </div>
                          <span className="text-xs text-muted-foreground">кг</span>
                          <button onClick={() => { const u = [...slurries]; u[idx] = { ...u[idx], additives: u[idx].additives.filter((_, i) => i !== aIdx) }; onSlurriesChange(u); }} className="text-xs text-destructive">✕</button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </CardContent>
        )}
      </Card>

      {/* ===== 5. Продавочная жидкость ===== */}
      <Card>
        <SectionHeader title="🚀 Продавочная жидкость" isOpen={openSections.displacement} onClick={() => toggle("displacement")} />
        {openSections.displacement && (
          <CardContent className="pt-4 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground italic">Порции продавки — порядок закачки. Можно использовать разные жидкости.</span>
              <button onClick={() => onDisplacementFluidsChange([...displacementFluids, { name: `Порция ${displacementFluids.length + 1}`, density: 1010, rheology: { pv: 1, yp: 0 }, compressionCoeff: 1.0, flowRateSteps: [{ rateLps: 5, volumeM3: 0 }] }])} className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                + Порция
              </button>
            </div>
            {calcDispVol > 0 && (
              <div className="p-3 rounded-lg bg-muted/50 border border-border/50">
                <span className="text-sm font-medium">Расчётный объём продавки: <span className="text-primary font-bold">{calcDispVol.toFixed(2)} м³</span></span>
                {(() => {
                  const totalUsed = displacementFluids.reduce((s, df) => s + df.flowRateSteps.reduce((ss, st) => ss + st.volumeM3, 0), 0);
                  const rem = calcDispVol - totalUsed;
                  return (
                    <span className={`ml-3 text-sm ${Math.abs(rem) < 0.01 ? "text-muted-foreground" : "text-destructive font-medium"}`}>
                      (остаток: {rem.toFixed(2)} м³)
                    </span>
                  );
                })()}
              </div>
            )}
            {displacementFluids.map((df, idx) => (
              <div key={idx} className="p-3 rounded-lg bg-muted/30 space-y-3 border border-border/50">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{df.name}</span>
                  <div className="flex items-center gap-2">
                    {idx > 0 && (
                      <button onClick={() => { const u = [...displacementFluids]; [u[idx - 1], u[idx]] = [u[idx], u[idx - 1]]; onDisplacementFluidsChange(u); }} className="text-xs px-1.5 py-0.5 rounded bg-muted hover:bg-muted/80 text-foreground" title="Вверх">↑</button>
                    )}
                    {idx < displacementFluids.length - 1 && (
                      <button onClick={() => { const u = [...displacementFluids]; [u[idx], u[idx + 1]] = [u[idx + 1], u[idx]]; onDisplacementFluidsChange(u); }} className="text-xs px-1.5 py-0.5 rounded bg-muted hover:bg-muted/80 text-foreground" title="Вниз">↓</button>
                    )}
                    {displacementFluids.length > 1 && <button onClick={() => onDisplacementFluidsChange(displacementFluids.filter((_, i) => i !== idx))} className="text-xs text-destructive hover:underline">Удалить</button>}
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <div className="space-y-1"><Label className="text-xs text-muted-foreground">Название</Label><DebouncedInput value={df.name} onChange={(e) => handleDispFluidChange(idx, "name", e.target.value)} className="h-8 text-sm" /></div>
                  <div className="space-y-1"><Label className="text-xs text-muted-foreground">Плотность, кг/м³</Label><DebouncedInput type="number" step="1" value={df.density || ""} onChange={(e) => handleDispFluidChange(idx, "density", e.target.value)} className="h-8 text-sm" /></div>
                  <div className="space-y-1"><Label className="text-xs text-muted-foreground">PV, сПз</Label><DebouncedInput type="number" value={df.rheology.pv || ""} onChange={(e) => handleDispFluidChange(idx, "pv", e.target.value)} className="h-8 text-sm" /></div>
                  <div className="space-y-1"><Label className="text-xs text-muted-foreground">YP, Па</Label><DebouncedInput type="number" step="0.1" value={df.rheology.yp || ""} onChange={(e) => handleDispFluidChange(idx, "yp", e.target.value)} className="h-8 text-sm" /></div>
                  <div className="space-y-1"><Label className="text-xs text-muted-foreground">Коэфф. сжатия</Label><DebouncedInput type="number" step="0.01" value={df.compressionCoeff || ""} onChange={(e) => handleDispFluidChange(idx, "compressionCoeff", e.target.value)} className="h-8 text-sm" placeholder="1.05" /></div>
                </div>
                <FlowRateStepsEditor
                  steps={df.flowRateSteps}
                  totalVolume={calcDispVol}
                  onChange={(steps) => { const u = [...displacementFluids]; u[idx] = { ...u[idx], flowRateSteps: steps }; onDisplacementFluidsChange(u); }}
                  fracCheck={(rateLps) => fracCheck(rateLps, df.density, df.rheology.pv, df.rheology.yp, true, df.name)}
                />
              </div>
            ))}
          </CardContent>
        )}
      </Card>

      {/* ===== 6. Параметры ГРП ===== */}
      <Card>
        <SectionHeader title="⚙️ Параметры гидроразрыва" isOpen={openSections.hydraulics} onClick={() => toggle("hydraulics")} />
        {openSections.hydraulics && (
          <CardContent className="pt-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Градиент гидроразрыва, кПа/м</Label>
                <Input type="number" step="0.1" value={fractureGradient || ""} onChange={(e) => onFractureGradientChange(parseFloat(e.target.value) || 0)} className="h-9 text-sm" />
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* ===== 7. Промывка линии ===== */}
      <Card>
        <SectionHeader title="🔄 Промывка линии перед продавкой" isOpen={openSections.flush ?? true} onClick={() => toggle("flush" as any)} />
        {(openSections as any).flush !== false && (
          <CardContent className="pt-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Время промывки, мин</Label>
                <Input type="number" step="1" value={flushTimeMin || ""} onChange={(e) => onFlushTimeMinChange(parseFloat(e.target.value) || 0)} className="h-9 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Объём промывки, м³</Label>
                <Input type="number" step="0.1" value={flushVolumeM3 || ""} onChange={(e) => onFlushVolumeM3Change(parseFloat(e.target.value) || 0)} className="h-9 text-sm" />
              </div>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
