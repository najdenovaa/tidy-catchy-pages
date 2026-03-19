import { useState, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Send, Gauge, Shield, Droplets, Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import deallsoftLogo from "@/assets/deallsoft-logo.png";
import {
  CTStringData, WellGeometry, FluidData, PumpData, ToolsData,
  calculateTubingForces, calculateLimits, calculateHydraulics, calculateFatigue,
  CT_PRESETS, FLUID_PRESETS, ctWeightPerMeter,
  ForceResult, LimitResult, HydraulicsResult, FatigueResult,
} from "@/lib/coiled-tubing-calculations";
import { supabase } from "@/integrations/supabase/client";

const defaultCT: CTStringData = { od: 50.8, wall: 3.96, grade: "CT-80", length: 3000, ovality: 1 };
const defaultWell: WellGeometry = {
  md: 3000, tvd: 2800, casingID: 168.3, tubingID: 62, wellheadPressure: 5,
  bhTemp: 80, whTemp: 20, trajectory: [{ md: 0, inc: 0, azi: 0, tvd: 0 }, { md: 3000, inc: 15, azi: 0, tvd: 2800 }],
};
const defaultFluid: FluidData = { name: "Вода", density: 1.0, pv: 1, yp: 0, nIndex: 1, kIndex: 0.001 };
const defaultPump: PumpData = { flowRate: 300, surfacePressure: 0 };
const defaultTools: ToolsData = { bhaWeight: 200, bhaLength: 5, bhaOD: 48, nozzleDiam: 4, nozzleCount: 3 };

function Num({ value, unit, label, warn }: { value: number | string; unit?: string; label: string; warn?: boolean }) {
  return (
    <div className={`flex justify-between items-center py-1.5 px-2 rounded text-sm ${warn ? "bg-destructive/10 text-destructive" : ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums">{value}{unit && <span className="ml-1 text-muted-foreground font-normal text-xs">{unit}</span>}</span>
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-2">
      <Label className="text-xs text-muted-foreground whitespace-nowrap">{label}</Label>
      {children}
    </div>
  );
}

export default function CoiledTubing() {
  const [ct, setCT] = useState<CTStringData>(defaultCT);
  const [well, setWell] = useState<WellGeometry>(defaultWell);
  const [fluid, setFluid] = useState<FluidData>(defaultFluid);
  const [pump, setPump] = useState<PumpData>(defaultPump);
  const [tools, setTools] = useState<ToolsData>(defaultTools);
  const [friction, setFriction] = useState(0.25);
  const [reelSize, setReelSize] = useState<"small" | "medium" | "large">("medium");
  const [prevTrips, setPrevTrips] = useState(0);
  const [tab, setTab] = useState("forces");

  const upCT = useCallback((p: Partial<CTStringData>) => setCT(prev => ({ ...prev, ...p })), []);
  const upWell = useCallback((p: Partial<WellGeometry>) => setWell(prev => ({ ...prev, ...p })), []);
  const upFluid = useCallback((p: Partial<FluidData>) => setFluid(prev => ({ ...prev, ...p })), []);
  const upPump = useCallback((p: Partial<PumpData>) => setPump(prev => ({ ...prev, ...p })), []);
  const upTools = useCallback((p: Partial<ToolsData>) => setTools(prev => ({ ...prev, ...p })), []);

  const forces = useMemo<ForceResult>(() => calculateTubingForces(ct, well, fluid, tools, friction), [ct, well, fluid, tools, friction]);
  const limits = useMemo<LimitResult>(() => calculateLimits(ct, pump.surfacePressure, well.wellheadPressure, forces.surfaceLoadPOOH), [ct, pump.surfacePressure, well.wellheadPressure, forces.surfaceLoadPOOH]);
  const hydraulics = useMemo<HydraulicsResult>(() => calculateHydraulics(ct, well, fluid, pump, tools), [ct, well, fluid, pump, tools]);
  const fatigue = useMemo<FatigueResult>(() => calculateFatigue(ct, reelSize, pump.surfacePressure || hydraulics.dpTotal, prevTrips), [ct, reelSize, pump.surfacePressure, hydraulics.dpTotal, prevTrips]);

  // Log calculation
  const logCalc = useCallback(() => {
    supabase.functions.invoke("log-activity", {
      body: { type: "calculation", module: "coiled-tubing", page_url: "/coiled-tubing" },
    }).catch(() => {});
  }, []);

  // Auto-log on tab change
  const handleTabChange = useCallback((t: string) => {
    setTab(t);
    logCalc();
  }, [logCalc]);

  const linWeight = ctWeightPerMeter(ct.od, ct.wall);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <Link to="/" className="flex items-center gap-2">
              <img src={deallsoftLogo} alt="DeAllsoft" className="h-10 object-cover" />
            </Link>
            <span className="text-sm font-semibold text-foreground">ГНКТ — Гибкие НКТ</span>
          </div>
          <a href="https://t.me/deall_support" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-xs">
            <Send className="w-4 h-4" /><span>Поддержка</span>
          </a>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto px-4 py-6 w-full">
        <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6">
          {/* ── Left: Inputs ── */}
          <div className="space-y-4">
            {/* CT String */}
            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm">Параметры ГНКТ</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-2">
                <FieldRow label="Типоразмер">
                  <Select onValueChange={v => {
                    const p = CT_PRESETS.find(x => x.label === v);
                    if (p) upCT({ od: p.od, wall: p.wall });
                  }}>
                    <SelectTrigger className="w-44 h-8 text-xs"><SelectValue placeholder="Выбрать..." /></SelectTrigger>
                    <SelectContent>{CT_PRESETS.map(p => <SelectItem key={p.label} value={p.label}>{p.label}</SelectItem>)}</SelectContent>
                  </Select>
                </FieldRow>
                <FieldRow label="Нар. Ø, мм">
                  <Input type="number" className="w-24 h-8 text-xs" value={ct.od} onChange={e => upCT({ od: +e.target.value })} />
                </FieldRow>
                <FieldRow label="Стенка, мм">
                  <Input type="number" className="w-24 h-8 text-xs" value={ct.wall} onChange={e => upCT({ wall: +e.target.value })} />
                </FieldRow>
                <FieldRow label="Марка стали">
                  <Select value={ct.grade} onValueChange={v => upCT({ grade: v })}>
                    <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["CT-70", "CT-80", "CT-90", "CT-110"].map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FieldRow>
                <FieldRow label="Длина, м">
                  <Input type="number" className="w-24 h-8 text-xs" value={ct.length} onChange={e => upCT({ length: +e.target.value })} />
                </FieldRow>
                <FieldRow label="Овальность, %">
                  <Input type="number" className="w-24 h-8 text-xs" value={ct.ovality} onChange={e => upCT({ ovality: +e.target.value })} min={0} max={10} step={0.5} />
                </FieldRow>
                <div className="text-[10px] text-muted-foreground pt-1">
                  Вн.Ø: {(ct.od - 2 * ct.wall).toFixed(1)} мм · Вес: {linWeight.toFixed(3)} кг/м
                </div>
              </CardContent>
            </Card>

            {/* Well */}
            <Card>
              <CardHeader className="py-3 px-4"><CardTitle className="text-sm">Скважина</CardTitle></CardHeader>
              <CardContent className="px-4 pb-4 space-y-2">
                <FieldRow label="MD, м">
                  <Input type="number" className="w-24 h-8 text-xs" value={well.md} onChange={e => upWell({ md: +e.target.value })} />
                </FieldRow>
                <FieldRow label="TVD, м">
                  <Input type="number" className="w-24 h-8 text-xs" value={well.tvd} onChange={e => upWell({ tvd: +e.target.value })} />
                </FieldRow>
                <FieldRow label="Экспл.кол. ID, мм">
                  <Input type="number" className="w-24 h-8 text-xs" value={well.casingID} onChange={e => upWell({ casingID: +e.target.value })} />
                </FieldRow>
                <FieldRow label="НКТ ID, мм (0=нет)">
                  <Input type="number" className="w-24 h-8 text-xs" value={well.tubingID} onChange={e => upWell({ tubingID: +e.target.value })} />
                </FieldRow>
                <FieldRow label="Устьевое P, МПа">
                  <Input type="number" className="w-24 h-8 text-xs" value={well.wellheadPressure} onChange={e => upWell({ wellheadPressure: +e.target.value })} />
                </FieldRow>
                <FieldRow label="Зенит. угол, °">
                  <Input type="number" className="w-24 h-8 text-xs" value={well.trajectory[1]?.inc ?? 0}
                    onChange={e => {
                      const inc = +e.target.value;
                      upWell({ trajectory: [{ md: 0, inc: 0, azi: 0, tvd: 0 }, { md: well.md, inc, azi: 0, tvd: well.tvd }] });
                    }} />
                </FieldRow>
                <FieldRow label="Коэф. трения">
                  <Input type="number" className="w-24 h-8 text-xs" value={friction} onChange={e => setFriction(+e.target.value)} min={0.1} max={0.5} step={0.05} />
                </FieldRow>
              </CardContent>
            </Card>

            {/* Fluid */}
            <Card>
              <CardHeader className="py-3 px-4"><CardTitle className="text-sm">Жидкость</CardTitle></CardHeader>
              <CardContent className="px-4 pb-4 space-y-2">
                <FieldRow label="Тип">
                  <Select onValueChange={v => {
                    const p = FLUID_PRESETS.find(x => x.label === v);
                    if (p) setFluid(p.data);
                  }}>
                    <SelectTrigger className="w-44 h-8 text-xs"><SelectValue placeholder="Выбрать..." /></SelectTrigger>
                    <SelectContent>{FLUID_PRESETS.map(p => <SelectItem key={p.label} value={p.label}>{p.label}</SelectItem>)}</SelectContent>
                  </Select>
                </FieldRow>
                <FieldRow label="Плотность, г/см³">
                  <Input type="number" className="w-24 h-8 text-xs" value={fluid.density} onChange={e => upFluid({ density: +e.target.value })} step={0.01} />
                </FieldRow>
                <FieldRow label="PV, сП">
                  <Input type="number" className="w-24 h-8 text-xs" value={fluid.pv} onChange={e => upFluid({ pv: +e.target.value })} />
                </FieldRow>
                <FieldRow label="YP, Па">
                  <Input type="number" className="w-24 h-8 text-xs" value={fluid.yp} onChange={e => upFluid({ yp: +e.target.value })} />
                </FieldRow>
              </CardContent>
            </Card>

            {/* Pump & Tools */}
            <Card>
              <CardHeader className="py-3 px-4"><CardTitle className="text-sm">Насос и инструмент</CardTitle></CardHeader>
              <CardContent className="px-4 pb-4 space-y-2">
                <FieldRow label="Расход, л/мин">
                  <Input type="number" className="w-24 h-8 text-xs" value={pump.flowRate} onChange={e => upPump({ flowRate: +e.target.value })} />
                </FieldRow>
                <FieldRow label="Вес КНБК, кг">
                  <Input type="number" className="w-24 h-8 text-xs" value={tools.bhaWeight} onChange={e => upTools({ bhaWeight: +e.target.value })} />
                </FieldRow>
                <FieldRow label="Длина КНБК, м">
                  <Input type="number" className="w-24 h-8 text-xs" value={tools.bhaLength} onChange={e => upTools({ bhaLength: +e.target.value })} />
                </FieldRow>
                <FieldRow label="Ø насадки, мм">
                  <Input type="number" className="w-24 h-8 text-xs" value={tools.nozzleDiam} onChange={e => upTools({ nozzleDiam: +e.target.value })} />
                </FieldRow>
                <FieldRow label="Кол-во насадок">
                  <Input type="number" className="w-24 h-8 text-xs" value={tools.nozzleCount} onChange={e => upTools({ nozzleCount: +e.target.value })} />
                </FieldRow>
              </CardContent>
            </Card>

            {/* Fatigue params */}
            <Card>
              <CardHeader className="py-3 px-4"><CardTitle className="text-sm">Усталость</CardTitle></CardHeader>
              <CardContent className="px-4 pb-4 space-y-2">
                <FieldRow label="Размер барабана">
                  <Select value={reelSize} onValueChange={v => setReelSize(v as any)}>
                    <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="small">Малый (1.37 м)</SelectItem>
                      <SelectItem value="medium">Средний (1.83 м)</SelectItem>
                      <SelectItem value="large">Большой (2.44 м)</SelectItem>
                    </SelectContent>
                  </Select>
                </FieldRow>
                <FieldRow label="Выполнено рейсов">
                  <Input type="number" className="w-24 h-8 text-xs" value={prevTrips} onChange={e => setPrevTrips(+e.target.value)} min={0} />
                </FieldRow>
              </CardContent>
            </Card>
          </div>

          {/* ── Right: Results ── */}
          <div>
            <Tabs value={tab} onValueChange={handleTabChange}>
              <TabsList className="mb-4 w-full flex">
                <TabsTrigger value="forces" className="flex-1 gap-1 text-xs"><Gauge className="w-3.5 h-3.5" /> Силы</TabsTrigger>
                <TabsTrigger value="limits" className="flex-1 gap-1 text-xs"><Shield className="w-3.5 h-3.5" /> Пределы</TabsTrigger>
                <TabsTrigger value="hydraulics" className="flex-1 gap-1 text-xs"><Droplets className="w-3.5 h-3.5" /> Гидравлика</TabsTrigger>
                <TabsTrigger value="fatigue" className="flex-1 gap-1 text-xs"><Activity className="w-3.5 h-3.5" /> Усталость</TabsTrigger>
              </TabsList>

              {/* Forces */}
              <TabsContent value="forces">
                <Card>
                  <CardHeader className="py-3 px-4"><CardTitle className="text-sm">Tubing Forces — Силы на колтюбинг</CardTitle></CardHeader>
                  <CardContent className="px-4 pb-4 space-y-1">
                    <Num label="Вес в воздухе" value={forces.weightInAir.toFixed(1)} unit="кН" />
                    <Num label="Коэффициент плавучести" value={forces.buoyancyFactor.toFixed(3)} />
                    <Num label="Вес в жидкости" value={forces.weightInFluid.toFixed(1)} unit="кН" />
                    <div className="border-t border-border my-2" />
                    <Num label="Сила трения (СПО вниз)" value={forces.dragForceRIH.toFixed(1)} unit="кН" />
                    <Num label="Сила трения (СПО вверх)" value={forces.dragForcePOOH.toFixed(1)} unit="кН" />
                    <div className="border-t border-border my-2" />
                    <Num label="Нагрузка на устье (СПО вниз)" value={forces.surfaceLoadRIH.toFixed(1)} unit="кН"
                      warn={forces.surfaceLoadRIH < 0} />
                    <Num label="Нагрузка на устье (СПО вверх)" value={forces.surfaceLoadPOOH.toFixed(1)} unit="кН" />
                    <div className="border-t border-border my-2" />
                    <Num label="Крит. нагрузка синус. потери устойч." value={forces.sinusoidalBucklingLoad.toFixed(1)} unit="кН" />
                    <Num label="Крит. нагрузка спирального изгиба" value={forces.helicalBucklingLoad.toFixed(1)} unit="кН" />
                    <Num label="Глубина запирания (lock-up)" value={forces.lockUpDepth > 0 ? forces.lockUpDepth.toFixed(0) : "—"} unit={forces.lockUpDepth > 0 ? "м" : ""}
                      warn={forces.lockUpDepth > 0} />
                    {forces.surfaceLoadRIH < 0 && (
                      <p className="text-xs text-destructive mt-2">⚠ Колтюбинг в сжатии на устье — риск запирания!</p>
                    )}
                    {forces.lockUpDepth > 0 && (
                      <p className="text-xs text-warning mt-1">⚠ Прогнозируемое запирание на глубине {forces.lockUpDepth.toFixed(0)} м</p>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Limits */}
              <TabsContent value="limits">
                <Card>
                  <CardHeader className="py-3 px-4"><CardTitle className="text-sm">CoilLIMIT — Пределы давления и нагрузок</CardTitle></CardHeader>
                  <CardContent className="px-4 pb-4 space-y-1">
                    <Num label="Давление разрыва (Barlow)" value={limits.burstPressure.toFixed(1)} unit="МПа" />
                    <Num label="Макс. рабочее давление (80%)" value={limits.maxWorkingPressure.toFixed(1)} unit="МПа" />
                    <div className="border-t border-border my-2" />
                    <Num label="Давление смятия" value={limits.collapsePressure.toFixed(1)} unit="МПа" />
                    <Num label="Смятие с овальностью" value={limits.collapseWithOvality.toFixed(1)} unit="МПа"
                      warn={limits.collapseWithOvality < well.wellheadPressure} />
                    <div className="border-t border-border my-2" />
                    <Num label="Предел текучести (растяж.)" value={limits.yieldTension.toFixed(1)} unit="кН" />
                    <Num label="Макс. раб. натяжение (80%)" value={limits.maxWorkingTension.toFixed(1)} unit="кН" />
                    <div className="border-t border-border my-2" />
                    <Num label="Коэфф. Мизеса (σ_vm / σ_y)" value={limits.vonMisesRatio.toFixed(3)}
                      warn={limits.vonMisesRatio >= 0.8} />
                    {limits.vonMisesRatio >= 1.0 && (
                      <p className="text-xs text-destructive mt-2">⛔ Критерий Мизеса превышен! Деформация неизбежна.</p>
                    )}
                    {limits.vonMisesRatio >= 0.8 && limits.vonMisesRatio < 1.0 && (
                      <p className="text-xs text-warning mt-2">⚠ Коэффициент Мизеса выше 0.8 — близко к пределу!</p>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Hydraulics */}
              <TabsContent value="hydraulics">
                <Card>
                  <CardHeader className="py-3 px-4"><CardTitle className="text-sm">Гидравлика циркуляции</CardTitle></CardHeader>
                  <CardContent className="px-4 pb-4 space-y-1">
                    <Num label="Скорость в ГНКТ" value={hydraulics.velocityInCT.toFixed(2)} unit="м/с" />
                    <Num label="Скорость в затрубье" value={hydraulics.velocityAnnulus.toFixed(2)} unit="м/с" />
                    <div className="border-t border-border my-2" />
                    <Num label="Re в ГНКТ" value={hydraulics.reynoldsInCT} />
                    <Num label="Режим в ГНКТ" value={hydraulics.flowRegimeCT} />
                    <Num label="Re в затрубье" value={hydraulics.reynoldsAnnulus} />
                    <Num label="Режим в затрубье" value={hydraulics.flowRegimeAnnulus} />
                    <div className="border-t border-border my-2" />
                    <Num label="ΔP внутри ГНКТ" value={hydraulics.dpInsideCT.toFixed(2)} unit="МПа" />
                    <Num label="ΔP в затрубье" value={hydraulics.dpAnnulus.toFixed(2)} unit="МПа" />
                    <Num label="ΔP на насадках" value={hydraulics.dpNozzle.toFixed(2)} unit="МПа" />
                    <Num label="Общее ΔP (поверх.)" value={hydraulics.dpTotal.toFixed(2)} unit="МПа"
                      warn={hydraulics.dpTotal > limits.maxWorkingPressure} />
                    <div className="border-t border-border my-2" />
                    <Num label="Гидростатика (внутр.)" value={hydraulics.hydrostaticInside.toFixed(2)} unit="МПа" />
                    <Num label="Гидростатика (затруб.)" value={hydraulics.hydrostaticAnnulus.toFixed(2)} unit="МПа" />
                    <Num label="Забойное давление (цирк.)" value={hydraulics.bhCircPressure.toFixed(2)} unit="МПа" />
                    {hydraulics.dpTotal > limits.maxWorkingPressure && (
                      <p className="text-xs text-destructive mt-2">⚠ Давление циркуляции превышает макс. рабочее давление ГНКТ!</p>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Fatigue */}
              <TabsContent value="fatigue">
                <Card>
                  <CardHeader className="py-3 px-4"><CardTitle className="text-sm">CoilLIFE — Ресурс усталости</CardTitle></CardHeader>
                  <CardContent className="px-4 pb-4 space-y-1">
                    <Num label="Деформация на барабане" value={fatigue.bendingStrainReel.toFixed(3)} unit="%" />
                    <Num label="Деформация на направл. арке" value={fatigue.bendingStrainGuideArch.toFixed(3)} unit="%" />
                    <Num label="Суммарная деформация за рейс" value={fatigue.totalStrainPerTrip.toFixed(3)} unit="%" />
                    <div className="border-t border-border my-2" />
                    <Num label="Расчётный ресурс" value={fatigue.estimatedCycles} unit="рейсов" />
                    <Num label="Безопасный ресурс (SF=2)" value={fatigue.maxSafeTrips} unit="рейсов" />
                    <Num label="Использовано ресурса" value={fatigue.fatigueLifeUsed.toFixed(1)} unit="%"
                      warn={fatigue.fatigueLifeUsed > 60} />
                    <Num label="Снижение давления разрыва" value={fatigue.pressureDerate.toFixed(1)} unit="%" />
                    {fatigue.fatigueLifeUsed > 80 && (
                      <p className="text-xs text-destructive mt-2">⛔ Ресурс ГНКТ критически исчерпан! Необходима замена.</p>
                    )}
                    {fatigue.fatigueLifeUsed > 50 && fatigue.fatigueLifeUsed <= 80 && (
                      <p className="text-xs text-warning mt-2">⚠ Более 50% ресурса использовано. Повышенный контроль.</p>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </main>
    </div>
  );
}
