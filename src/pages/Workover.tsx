import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Home, ArrowLeft, Wrench, Anchor, Activity, Magnet, Search, Construction as Crane, Droplets } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine, BarChart, Bar,
} from "recharts";
import deallsoftLogo from "@/assets/deallsoft-logo.png";
import TermsFooter from "@/components/TermsFooter";
import {
  STEEL_GRADES,
  pipeYieldForceKN,
  calculatePacker, calculatePackerRelease, calculateDrag, calculateLubricant,
  calculateFreePoint, diagnoseStuck, calculateFishing, calculateRigCapacity,
  calculateKill, KILL_FLUIDS,
  KILL_SALTS, calculateBrineRecipe, autoSelectSalt, planMultiIntervalKill,
  type WorkoverWellData, type PackerInput, type PackerReleaseInput, type DragInput, type LubricantInput,
  type FreePointInput, type StuckSymptoms, type FishingInput, type RigInput, type KillInput,
  type KillSalt, type KillInterval,
} from "@/lib/workover-calculations";
import { Trash2, Plus } from "lucide-react";

const num = (v: string) => (isNaN(parseFloat(v)) ? 0 : parseFloat(v));

const DEFAULT_WELL: WorkoverWellData = {
  wellDepthMD: 2500,
  trajectory: [
    { md: 0, tvd: 0, zenith: 0, azimuth: 0 },
    { md: 800, tvd: 800, zenith: 0, azimuth: 0 },
    { md: 1500, tvd: 1450, zenith: 35, azimuth: 90 },
    { md: 2500, tvd: 2200, zenith: 55, azimuth: 90 },
  ],
  casingID_mm: 152,
  holeDiameter_mm: 215.9,
  pipeOD_mm: 73,
  pipeID_mm: 62,
  pipeWeight_kgm: 9.67,
  pipeGrade: "N80",
  pipeYieldMPa: STEEL_GRADES.N80,
  pipeYoungModulusGPa: 210,
  fluidDensity_gcm3: 1.10,
  fluidPV_cP: 15,
  fluidYP_Pa: 5,
};

export default function Workover() {
  const [well, setWell] = useState<WorkoverWellData>(DEFAULT_WELL);
  const updateWell = <K extends keyof WorkoverWellData>(k: K, v: WorkoverWellData[K]) =>
    setWell((w) => ({ ...w, [k]: v }));

  // ──── Rig (used by summary) ────
  const [rig, setRig] = useState<RigInput>({
    rigCapacityKN: 1000, derrickCapacityKN: 1250, safetyFactor: 1.5, currentHookLoadKN: 450,
  });
  const rigResult = useMemo(() => calculateRigCapacity(rig), [rig]);
  const pipeYield = useMemo(() => pipeYieldForceKN(well), [well]);

  // ──── Packer ────
  const [packer, setPacker] = useState<PackerInput>({
    type: "hydraulic", packerOD_mm: 118, elementLength_mm: 150, setDepthMD: 2200,
    rubberFrictionCoeff: 0.4, setPressureMPa: 20, differentialPressureMPa: 15,
  });
  const packerResult = useMemo(() => calculatePacker(packer), [packer]);

  // ──── Packer RELEASE ────
  const [releaseExtra, setReleaseExtra] = useState({
    monthsInService: 12, h2sPresent: false, scaleDepositRate: 6, pipeWeightAboveKN: 180,
  });
  const releaseResult = useMemo(() => calculatePackerRelease({
    packerType: packer.type,
    holdCapacityKN: packerResult.holdCapacityKN,
    monthsInService: releaseExtra.monthsInService,
    h2sPresent: releaseExtra.h2sPresent,
    scaleDepositRate: releaseExtra.scaleDepositRate,
    pipeWeightAboveKN: releaseExtra.pipeWeightAboveKN,
    pipeYieldMPa: well.pipeYieldMPa,
    pipeOD_mm: well.pipeOD_mm, pipeID_mm: well.pipeID_mm,
  } as PackerReleaseInput), [packer.type, packerResult.holdCapacityKN, releaseExtra, well.pipeYieldMPa, well.pipeOD_mm, well.pipeID_mm]);

  // ──── Kill ────
  const [kill, setKill] = useState<KillInput>({
    method: "wait_weight",
    formationPressureMPa: 28, reservoirDepthTVD: 2200, fracturePressureMPa: 42,
    currentMudDensity: 1.10,
    wellDepthMD: 2500, casingID_mm: 152, tubingOD_mm: 73, tubingID_mm: 62,
    killFluidPV_cP: 20, killFluidYP_Pa: 6, pumpRateLs: 8, safetyMarginPct: 5,
  });
  const killResult = useMemo(() => calculateKill(kill), [kill]);
  const killChart = useMemo(() => {
    const steps = 20;
    const out: { v: number; p: number }[] = [];
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      const p = killResult.initialCircPressureMPa + (killResult.finalCircPressureMPa - killResult.initialCircPressureMPa) * f;
      out.push({ v: +(killResult.killVolumeM3 * f).toFixed(2), p: +p.toFixed(2) });
    }
    return out;
  }, [killResult]);

  // ──── Drag + lubricant ────
  const [drag, setDrag] = useState<DragInput>({ operation: "pull_out", frictionCoeff: 0.30 });
  const [lube, setLube] = useState<LubricantInput>({
    name: "DeAll Slip-X", concentration: 2, baseFrictionCoeff: 0.34,
    lubricatedFrictionCoeff: 0.12, penetrationIndex: 7,
  });
  const [useLube, setUseLube] = useState(false);
  const dragNoLube = useMemo(() => calculateDrag({ ...drag, lubricant: undefined }, well), [drag, well]);
  const dragLube = useMemo(() => calculateDrag({ ...drag, lubricant: lube }, well), [drag, well, lube]);
  const lubeResult = useMemo(
    () => calculateLubricant(lube, dragNoLube.maxHookLoadKN, dragLube.maxHookLoadKN, 30, 15, well.fluidPV_cP),
    [lube, dragNoLube, dragLube, well.fluidPV_cP],
  );
  const activeDrag = useLube ? dragLube : dragNoLube;

  // ──── Stuck pipe ────
  const [fp, setFp] = useState<FreePointInput>({ pulledForceKN: 196, measuredStretchM: 1.5 });
  const fpResult = useMemo(() => calculateFreePoint(fp, well), [fp, well]);
  const [symptoms, setSymptoms] = useState<StuckSymptoms>({
    canRotate: true, canMoveDown: false, canMoveUp: false,
    stuckDepthMD: 1800, occurredDuringCirculation: true, deltaP_MPa: 8, contactLenM: 30, mudcakeFriction: 0.25,
  });
  const stuckDiag = useMemo(
    () => diagnoseStuck(well, symptoms, rigResult.allowableLoadKN),
    [well, symptoms, rigResult.allowableLoadKN],
  );

  // ──── Fishing ────
  const [fish, setFish] = useState<FishingInput>({
    fishTopMD: 1600, fishWeightKN: 120, overpullKN: 150, jarType: "hydraulic", jarStretchM: 1.2,
  });
  const fishResult = useMemo(() => calculateFishing(fish, well), [fish, well]);

  // ──── Drag chart ────
  const dragChart = useMemo(() => {
    const a = dragNoLube.points;
    const b = dragLube.points;
    return a.map((p, i) => ({
      md: Math.round(p.md),
      base: +p.hookLoadKN.toFixed(1),
      lube: +(b[i]?.hookLoadKN ?? 0).toFixed(1),
    }));
  }, [dragNoLube, dragLube]);

  // ──── Layout helpers ────
  const NumberField = ({ label, value, onChange, unit, hint, step = "any" }: {
    label: string; value: number; onChange: (v: number) => void; unit?: string; hint?: string; step?: string;
  }) => (
    <div className="space-y-1">
      <Label className="text-xs">{label}{unit && <span className="text-muted-foreground/70"> ({unit})</span>}</Label>
      <Input type="number" step={step} value={value} onChange={(e) => onChange(num(e.target.value))} className="h-9" />
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );

  // ────────── render ──────────
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border bg-card">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3">
            <img src={deallsoftLogo} alt="DeAllsoft" className="h-10 sm:h-14 object-cover" />
            <p className="text-sm sm:text-lg font-normal tracking-tight uppercase text-foreground">
              КРС — Капитальный ремонт скважин
            </p>
          </Link>
          <div className="flex items-center gap-3">
            <Link to="/" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-xs">
              <ArrowLeft className="w-4 h-4" /> <span>Назад</span>
            </Link>
            <Link to="/" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-xs">
              <Home className="w-4 h-4" /> <span>Главная</span>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto px-4 py-6 w-full space-y-4">
        {/* ─── Шапка с общими данными ─── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><Wrench className="w-4 h-4" /> Общие данные скважины и колонны</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            <NumberField label="Глубина MD" unit="м" value={well.wellDepthMD} onChange={(v) => updateWell("wellDepthMD", v)} />
            <NumberField label="ID обсадной" unit="мм" value={well.casingID_mm} onChange={(v) => updateWell("casingID_mm", v)} />
            <NumberField label="НКТ OD" unit="мм" value={well.pipeOD_mm} onChange={(v) => updateWell("pipeOD_mm", v)} />
            <NumberField label="НКТ ID" unit="мм" value={well.pipeID_mm} onChange={(v) => updateWell("pipeID_mm", v)} />
            <NumberField label="Вес погонный" unit="кг/м" value={well.pipeWeight_kgm} onChange={(v) => updateWell("pipeWeight_kgm", v)} />
            <div className="space-y-1">
              <Label className="text-xs">Марка стали</Label>
              <Select value={well.pipeGrade} onValueChange={(v) => {
                setWell((w) => ({ ...w, pipeGrade: v, pipeYieldMPa: STEEL_GRADES[v] ?? w.pipeYieldMPa }));
              }}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.keys(STEEL_GRADES).map((g) => (
                    <SelectItem key={g} value={g}>{g} — σy {STEEL_GRADES[g]} МПа</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <NumberField label="Плотность жидкости" unit="г/см³" value={well.fluidDensity_gcm3} onChange={(v) => updateWell("fluidDensity_gcm3", v)} />
            <NumberField label="PV жидкости" unit="сП" value={well.fluidPV_cP} onChange={(v) => updateWell("fluidPV_cP", v)} />
            <NumberField label="YP жидкости" unit="Па" value={well.fluidYP_Pa} onChange={(v) => updateWell("fluidYP_Pa", v)} />
            <NumberField label="Диаметр ствола" unit="мм" value={well.holeDiameter_mm} onChange={(v) => updateWell("holeDiameter_mm", v)} />
          </CardContent>
        </Card>

        {/* ─── Сводка нагрузок (всегда видна) ─── */}
        <Card className="border-primary/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm uppercase tracking-wider text-primary">Сводка нагрузок</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
            <Stat label="Грузоподъёмность" v={`${rig.rigCapacityKN} кН`} />
            <Stat label={`Допустимая (÷${rig.safetyFactor})`} v={`${rigResult.allowableLoadKN.toFixed(0)} кН`} />
            <Stat label="Текущая на крюке" v={`${rig.currentHookLoadKN} кН (${rigResult.utilizationPct.toFixed(0)}%)`}
              tone={rigResult.status === "overload" ? "danger" : rigResult.status === "caution" ? "warn" : "ok"} />
            <Stat label="Запас на натяжку" v={`${rigResult.maxOverpullKN.toFixed(0)} кН`} />
            <Stat label={`Предел трубы ${well.pipeGrade}`} v={`${pipeYield.toFixed(0)} кН`} />
            <Stat label="Свободный вес колонны" v={`${dragNoLube.freeWeightKN.toFixed(0)} кН`} />
          </CardContent>
        </Card>

        <Tabs defaultValue="packer" className="w-full">
          <TabsList className="grid grid-cols-2 sm:grid-cols-6 w-full h-auto">
            <TabsTrigger value="packer" className="text-xs gap-1"><Anchor className="w-3.5 h-3.5" /> Пакеры</TabsTrigger>
            <TabsTrigger value="kill" className="text-xs gap-1"><Droplets className="w-3.5 h-3.5" /> Глушение</TabsTrigger>
            <TabsTrigger value="drag" className="text-xs gap-1"><Activity className="w-3.5 h-3.5" /> Затяжки / T&D</TabsTrigger>
            <TabsTrigger value="stuck" className="text-xs gap-1"><Magnet className="w-3.5 h-3.5" /> Прихваты</TabsTrigger>
            <TabsTrigger value="fishing" className="text-xs gap-1"><Search className="w-3.5 h-3.5" /> Ловильные</TabsTrigger>
            <TabsTrigger value="rig" className="text-xs gap-1"><Crane className="w-3.5 h-3.5" /> Подъёмник</TabsTrigger>
          </TabsList>


          {/* ──────────────── PACKER ──────────────── */}
          <TabsContent value="packer" className="space-y-4">
            <div className="grid lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Параметры пакера</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-2 gap-3">
                  <div className="space-y-1 col-span-2">
                    <Label className="text-xs">Тип</Label>
                    <Select value={packer.type} onValueChange={(v) => setPacker((p) => ({ ...p, type: v as PackerInput["type"] }))}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="mechanical">Механический</SelectItem>
                        <SelectItem value="hydraulic">Гидравлический</SelectItem>
                        <SelectItem value="hydrostatic">Гидростатический</SelectItem>
                        <SelectItem value="permanent">Постоянный (PBR)</SelectItem>
                        <SelectItem value="retrievable">Извлекаемый</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <NumberField label="OD пакера" unit="мм" value={packer.packerOD_mm} onChange={(v) => setPacker((p) => ({ ...p, packerOD_mm: v }))} />
                  <NumberField label="Длина элемента" unit="мм" value={packer.elementLength_mm} onChange={(v) => setPacker((p) => ({ ...p, elementLength_mm: v }))} />
                  <NumberField label="Глубина посадки MD" unit="м" value={packer.setDepthMD} onChange={(v) => setPacker((p) => ({ ...p, setDepthMD: v }))} />
                  <NumberField label="μ резины" value={packer.rubberFrictionCoeff} onChange={(v) => setPacker((p) => ({ ...p, rubberFrictionCoeff: v }))} hint="0.30–0.50" />
                  <NumberField label="Давление посадки" unit="МПа" value={packer.setPressureMPa} onChange={(v) => setPacker((p) => ({ ...p, setPressureMPa: v }))} />
                  <NumberField label="Рабочий ΔP" unit="МПа" value={packer.differentialPressureMPa} onChange={(v) => setPacker((p) => ({ ...p, differentialPressureMPa: v }))} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Результаты</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <Row k="Площадь контакта элемента" v={`${packerResult.contactAreaM2.toFixed(4)} м²`} />
                  <Row k="Несущая способность (μ·P·A)" v={`${packerResult.holdCapacityKN.toFixed(0)} кН`} />
                  <Row k="Усилие срыва (+адгезия 20%)" v={`${packerResult.releaseForceKN.toFixed(0)} кН`} />
                  <Row k="Герметичность (0.85·P_set)" v={`${packerResult.sealIntegrityMPa.toFixed(1)} МПа`} />
                  <Row k="Сила заклинивания плашек" v={`${packerResult.slipBiteForceKN.toFixed(0)} кН`} />
                  <div className="pt-2">
                    {packerResult.isSecure
                      ? <Badge className="bg-green-600">🟢 Пакер держит перепад</Badge>
                      : <Badge variant="destructive">🔴 Превышение ΔP — риск пропуска</Badge>}
                  </div>
                  {packerResult.warnings.map((w, i) => (
                    <Alert key={i} className="py-2"><AlertDescription className="text-xs">{w}</AlertDescription></Alert>
                  ))}
                </CardContent>
              </Card>
            </div>

            {/* ─── Срыв пакера ─── */}
            <Card className="border-amber-500/40">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  🔧 Срыв пакера (release) — операция извлечения
                </CardTitle>
              </CardHeader>
              <CardContent className="grid lg:grid-cols-2 gap-4">
                <div className="grid grid-cols-2 gap-3">
                  <NumberField label="Срок эксплуатации" unit="мес"
                    value={releaseExtra.monthsInService}
                    onChange={(v) => setReleaseExtra((s) => ({ ...s, monthsInService: v }))}
                    hint="растёт адгезия и отложения" />
                  <NumberField label="Интенсивность отложений" unit="кН/мес"
                    value={releaseExtra.scaleDepositRate}
                    onChange={(v) => setReleaseExtra((s) => ({ ...s, scaleDepositRate: v }))}
                    hint="соли/парафин/коррозия (3–15)" />
                  <NumberField label="Вес колонны над пакером" unit="кН"
                    value={releaseExtra.pipeWeightAboveKN}
                    onChange={(v) => setReleaseExtra((s) => ({ ...s, pipeWeightAboveKN: v }))} />
                  <label className="flex items-end gap-2 text-xs cursor-pointer pb-2">
                    <input type="checkbox" checked={releaseExtra.h2sPresent}
                      onChange={(e) => setReleaseExtra((s) => ({ ...s, h2sPresent: e.target.checked }))} />
                    H₂S среда (×1.5 прихват)
                  </label>
                </div>
                <div className="space-y-2 text-sm">
                  <Row k="Базовое удержание" v={`${releaseResult.breakdown.baseHold.toFixed(0)} кН`} />
                  <Row k="Адгезия резины" v={`+${releaseResult.breakdown.adhesion.toFixed(0)} кН`} />
                  <Row k="Прихват отложениями" v={`+${releaseResult.breakdown.scaleStick.toFixed(0)} кН`} />
                  <Row k="Усилие срыва" v={<strong>{releaseResult.releaseForceKN.toFixed(0)} кН</strong>} />
                  <Row k="Полное усилие (+ вес колонны)" v={`${releaseResult.totalPullRequiredKN.toFixed(0)} кН`}
                    tone={releaseResult.canReleaseByTension ? "ok" : "danger"} />
                  <Row k="Предел колонны (÷1.25)" v={`${releaseResult.pipeTensileLimitKN.toFixed(0)} кН`} />
                  <div className="pt-1 flex flex-wrap gap-2">
                    {releaseResult.canReleaseByTension
                      ? <Badge className="bg-green-600">🟢 Сорвётся натяжкой</Badge>
                      : <Badge variant="destructive">🔴 Натяжкой не сорвать</Badge>}
                    <Badge variant="secondary">
                      Метод: {{ tension: "Натяжка", rotation: "Вращение", pressure_release: "Сброс давления", mill_out: "Фрезерование" }[releaseResult.recommendedMechanism]}
                    </Badge>
                  </div>
                  {releaseResult.warnings.map((w, i) => (
                    <Alert key={i} className="py-2"><AlertDescription className="text-xs">{w}</AlertDescription></Alert>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ──────────────── KILL ──────────────── */}
          <TabsContent value="kill" className="space-y-4">
            <div className="grid lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Метод и параметры глушения</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-2 gap-3">
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">Метод</Label>
                    <Select value={kill.method} onValueChange={(v) => setKill({ ...kill, method: v as KillInput["method"] })}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="driller">Метод бурильщика (2 цикла)</SelectItem>
                        <SelectItem value="wait_weight">Метод ожидания и утяжеления (1 цикл)</SelectItem>
                        <SelectItem value="volumetric">Объёмный (без циркуляции)</SelectItem>
                        <SelectItem value="bullhead">Bullhead — задавка в пласт</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <NumberField label="Pпл" unit="МПа" value={kill.formationPressureMPa}
                    onChange={(v) => setKill({ ...kill, formationPressureMPa: v })} />
                  <NumberField label="TVD пласта" unit="м" value={kill.reservoirDepthTVD}
                    onChange={(v) => setKill({ ...kill, reservoirDepthTVD: v })} />
                  <NumberField label="Pгрп (предел)" unit="МПа" value={kill.fracturePressureMPa}
                    onChange={(v) => setKill({ ...kill, fracturePressureMPa: v })} />
                  <NumberField label="Текущая плотность" unit="г/см³" value={kill.currentMudDensity}
                    onChange={(v) => setKill({ ...kill, currentMudDensity: v })} />
                  <NumberField label="Запас плотности" unit="%" value={kill.safetyMarginPct}
                    onChange={(v) => setKill({ ...kill, safetyMarginPct: v })} hint="обычно 3–5%" />
                  <NumberField label="Глубина MD" unit="м" value={kill.wellDepthMD}
                    onChange={(v) => setKill({ ...kill, wellDepthMD: v })} />
                  <NumberField label="ID обсадной" unit="мм" value={kill.casingID_mm}
                    onChange={(v) => setKill({ ...kill, casingID_mm: v })} />
                  <NumberField label="НКТ OD" unit="мм" value={kill.tubingOD_mm}
                    onChange={(v) => setKill({ ...kill, tubingOD_mm: v })} />
                  <NumberField label="НКТ ID" unit="мм" value={kill.tubingID_mm}
                    onChange={(v) => setKill({ ...kill, tubingID_mm: v })} />
                  <NumberField label="PV жидкости" unit="сП" value={kill.killFluidPV_cP}
                    onChange={(v) => setKill({ ...kill, killFluidPV_cP: v })} />
                  <NumberField label="YP жидкости" unit="Па" value={kill.killFluidYP_Pa}
                    onChange={(v) => setKill({ ...kill, killFluidYP_Pa: v })} />
                  <NumberField label="Расход насоса" unit="л/с" value={kill.pumpRateLs}
                    onChange={(v) => setKill({ ...kill, pumpRateLs: v })} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Результаты глушения</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <Row k="Плотность баланса" v={`${killResult.balanceDensity.toFixed(3)} г/см³`} />
                  <Row k={`Плотность глушения (+${kill.safetyMarginPct}%)`}
                    v={<strong>{killResult.killDensity.toFixed(3)} г/см³</strong>} />
                  <Row k="Подбор жидкости" v={<Badge variant="secondary">{killResult.selectedFluid}</Badge>} />
                  <Row k="Забойное (после глушения)" v={`${killResult.bottomholePressureMPa.toFixed(2)} МПа`}
                    tone={killResult.exceedsFracture ? "danger" : "ok"} />
                  <Row k="Pгрп" v={`${kill.fracturePressureMPa.toFixed(2)} МПа`} />
                  <Row k="Объём глушения" v={`${killResult.killVolumeM3.toFixed(2)} м³`} />
                  <Row k="Потери на трение (затрубье)" v={`${killResult.frictionLossMPa.toFixed(2)} МПа`} />
                  {(kill.method === "driller" || kill.method === "wait_weight") && (
                    <>
                      <Row k="ICP — нач. циркуляции" v={`${killResult.initialCircPressureMPa.toFixed(2)} МПа`} />
                      <Row k="FCP — кон. циркуляции" v={`${killResult.finalCircPressureMPa.toFixed(2)} МПа`} />
                    </>
                  )}
                  {kill.method === "bullhead" && (
                    <Row k="Устьевое давление задавки" v={`${killResult.bullheadSurfacePressureMPa.toFixed(2)} МПа`}
                      tone={killResult.bullheadSurfacePressureMPa > kill.fracturePressureMPa * 0.7 ? "warn" : "ok"} />
                  )}
                  <div className="pt-1">
                    {killResult.exceedsFracture
                      ? <Badge variant="destructive">🔴 Превышение ГРП</Badge>
                      : <Badge className="bg-green-600">🟢 В безопасном окне</Badge>}
                  </div>
                  <Alert className="py-2"><AlertDescription className="text-xs">{killResult.recommendation}</AlertDescription></Alert>
                  {killResult.warnings.map((w, i) => (
                    <Alert key={i} className="py-2"><AlertDescription className="text-xs">{w}</AlertDescription></Alert>
                  ))}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Давление циркуляции vs объём прокачки</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={killChart}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="v" label={{ value: "Объём, м³", position: "insideBottom", offset: -5 }} />
                    <YAxis label={{ value: "Давление, МПа", angle: -90, position: "insideLeft" }} />
                    <Tooltip />
                    <Legend />
                    <ReferenceLine y={kill.fracturePressureMPa} stroke="#f43f5e" strokeDasharray="4 4" label="Pгрп" />
                    <Line type="monotone" dataKey="p" name="Давление насоса" stroke="#0ea5e9" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Каталог жидкостей глушения</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Жидкость</TableHead>
                      <TableHead>Max плотность, г/см³</TableHead>
                      <TableHead>Тип</TableHead>
                      <TableHead>Подходит</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {KILL_FLUIDS.map((f) => (
                      <TableRow key={f.name}>
                        <TableCell className="text-xs">{f.name}</TableCell>
                        <TableCell className="text-xs">{f.maxDensity.toFixed(2)}</TableCell>
                        <TableCell className="text-xs">{f.type}</TableCell>
                        <TableCell className="text-xs">
                          {f.maxDensity >= killResult.killDensity
                            ? <Badge className="bg-green-600">да</Badge>
                            : <Badge variant="secondary">нет</Badge>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>


          {/* ──────────────── DRAG / LUBE ──────────────── */}
          <TabsContent value="drag" className="space-y-4">
            <div className="grid lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Операция и трение</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Операция</Label>
                    <Select value={drag.operation} onValueChange={(v) => setDrag({ ...drag, operation: v as DragInput["operation"] })}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pull_out">Подъём (POOH)</SelectItem>
                        <SelectItem value="run_in">Спуск (RIH)</SelectItem>
                        <SelectItem value="rotate">Вращение</SelectItem>
                        <SelectItem value="work_pipe">Расхаживание</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <NumberField label="μ базовой жидкости (без смазки)" value={drag.frictionCoeff}
                    onChange={(v) => setDrag({ ...drag, frictionCoeff: v })} hint="из Лубрисити тестера" />
                  <div className="flex items-center gap-2 pt-2">
                    <input id="usel" type="checkbox" checked={useLube} onChange={(e) => setUseLube(e.target.checked)} />
                    <Label htmlFor="usel" className="text-xs cursor-pointer">Применить смазку (лубрикант)</Label>
                  </div>
                  {useLube && (
                    <div className="grid grid-cols-2 gap-2 pt-2 border-t">
                      <div className="col-span-2 space-y-1">
                        <Label className="text-xs">Наименование</Label>
                        <Input value={lube.name} onChange={(e) => setLube({ ...lube, name: e.target.value })} className="h-9" />
                      </div>
                      <NumberField label="Концентрация" unit="%" value={lube.concentration} onChange={(v) => setLube({ ...lube, concentration: v })} />
                      <NumberField label="Индекс проникновения" value={lube.penetrationIndex} onChange={(v) => setLube({ ...lube, penetrationIndex: v })} hint="1–10 (лаб.)" />
                      <NumberField label="CoF базовой жидкости" value={lube.baseFrictionCoeff} onChange={(v) => setLube({ ...lube, baseFrictionCoeff: v })} hint="OFITE/Fann" />
                      <NumberField label="CoF со смазкой" value={lube.lubricatedFrictionCoeff} onChange={(v) => setLube({ ...lube, lubricatedFrictionCoeff: v })} hint="OFITE/Fann" />
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Результаты T&D</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <Row k="Свободный вес колонны" v={`${dragNoLube.freeWeightKN.toFixed(0)} кН`} />
                  <Row k="Max нагрузка на крюке (без смазки)" v={`${dragNoLube.maxHookLoadKN.toFixed(0)} кН`} />
                  <Row k="Max нагрузка (со смазкой)" v={`${dragLube.maxHookLoadKN.toFixed(0)} кН`} />
                  <Row k="Применённый μ" v={`${activeDrag.appliedFrictionCoeff.toFixed(2)}`} />
                  {useLube && (
                    <>
                      <Row k="Снижение трения" v={`${lubeResult.frictionReductionPct.toFixed(0)} %`} />
                      <Row k="Снижение нагрузки" v={`${lubeResult.dragReductionKN.toFixed(0)} кН`} />
                      <Row k="Время проникновения" v={`${lubeResult.penetrationTimeHours.toFixed(1)} ч`} />
                      <div className="pt-1">
                        {lubeResult.effectiveForStuck
                          ? <Badge className="bg-green-600">Эффективна для дифф. прихвата</Badge>
                          : <Badge variant="secondary">Слабо подходит для дифф. прихвата</Badge>}
                      </div>
                    </>
                  )}
                  <Row k="Лимит подъёмника" v={`${rigResult.allowableLoadKN.toFixed(0)} кН`} />
                  <Row k="Предел трубы" v={`${pipeYield.toFixed(0)} кН`} />
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Затяжка vs глубина</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={dragChart}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="md" label={{ value: "MD, м", position: "insideBottom", offset: -5 }} />
                    <YAxis label={{ value: "Нагрузка, кН", angle: -90, position: "insideLeft" }} />
                    <Tooltip />
                    <Legend />
                    <ReferenceLine y={rigResult.allowableLoadKN} stroke="#f43f5e" strokeDasharray="4 4" label="Лимит подъёмника" />
                    <ReferenceLine y={pipeYield} stroke="#a855f7" strokeDasharray="4 4" label="Предел трубы" />
                    <Line type="monotone" dataKey="base" name="Без смазки" stroke="#0ea5e9" dot={false} />
                    <Line type="monotone" dataKey="lube" name="Со смазкой" stroke="#10b981" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ──────────────── STUCK ──────────────── */}
          <TabsContent value="stuck" className="space-y-4">
            <div className="grid lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Точка прихвата (метод растяжения)</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <NumberField label="Приложенное натяжение ΔF" unit="кН" value={fp.pulledForceKN} onChange={(v) => setFp({ ...fp, pulledForceKN: v })} hint="свыше веса колонны" />
                  <NumberField label="Измеренное удлинение ΔL" unit="м" value={fp.measuredStretchM} onChange={(v) => setFp({ ...fp, measuredStretchM: v })} />
                  <div className="border-t pt-3 text-sm space-y-1">
                    <Row k="Закон Гука: L = E·A·ΔL/ΔF" v="" />
                    <Row k="Точка прихвата" v={<strong>{fpResult.freePointMD.toFixed(0)} м</strong>} />
                    <Row k="Длина свободной колонны" v={`${fpResult.freePipeLength.toFixed(0)} м`} />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Диагностика типа прихвата</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-3 gap-2">
                    {([["canRotate", "Вращается"], ["canMoveDown", "Ходит вниз"], ["canMoveUp", "Ходит вверх"]] as const).map(([k, lbl]) => (
                      <label key={k} className="flex items-center gap-2 text-xs cursor-pointer">
                        <input type="checkbox" checked={symptoms[k]} onChange={(e) => setSymptoms({ ...symptoms, [k]: e.target.checked })} />
                        {lbl}
                      </label>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <NumberField label="Глубина прихвата" unit="м" value={symptoms.stuckDepthMD} onChange={(v) => setSymptoms({ ...symptoms, stuckDepthMD: v })} />
                    <NumberField label="ΔP на корке" unit="МПа" value={symptoms.deltaP_MPa ?? 0} onChange={(v) => setSymptoms({ ...symptoms, deltaP_MPa: v })} />
                    <NumberField label="Длина контакта" unit="м" value={symptoms.contactLenM ?? 0} onChange={(v) => setSymptoms({ ...symptoms, contactLenM: v })} />
                    <NumberField label="μ корки" value={symptoms.mudcakeFriction ?? 0.25} onChange={(v) => setSymptoms({ ...symptoms, mudcakeFriction: v })} hint="0.15–0.35" />
                  </div>
                  <div className="border-t pt-3 text-sm space-y-1">
                    <Row k="Тип прихвата" v={<Badge>{labelStuck(stuckDiag.type)}</Badge>} />
                    <Row k="Усилие освобождения (μ·ΔP·A)" v={`${stuckDiag.freeingForceKN.toFixed(0)} кН`} />
                    <Row k="Предел трубы" v={`${stuckDiag.pipeYieldKN.toFixed(0)} кН`} />
                    <Row k="Лимит подъёмника" v={`${rigResult.allowableLoadKN.toFixed(0)} кН`} />
                    <Row k="Освободится натяжением" v={stuckDiag.canFreeByPull
                      ? <Badge className="bg-green-600">ДА</Badge>
                      : <Badge variant="destructive">НЕТ</Badge>} />
                  </div>
                  <Alert><AlertDescription className="text-xs">{stuckDiag.recommendation}</AlertDescription></Alert>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ──────────────── FISHING ──────────────── */}
          <TabsContent value="fishing" className="space-y-4">
            <div className="grid lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Параметры ловильной операции</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-2 gap-3">
                  <NumberField label="Голова рыбы (MD)" unit="м" value={fish.fishTopMD} onChange={(v) => setFish({ ...fish, fishTopMD: v })} />
                  <NumberField label="Вес рыбы" unit="кН" value={fish.fishWeightKN} onChange={(v) => setFish({ ...fish, fishWeightKN: v })} />
                  <NumberField label="Overpull" unit="кН" value={fish.overpullKN} onChange={(v) => setFish({ ...fish, overpullKN: v })} hint="доп. натяжение" />
                  <div className="space-y-1">
                    <Label className="text-xs">Тип ясса</Label>
                    <Select value={fish.jarType ?? "hydraulic"} onValueChange={(v) => setFish({ ...fish, jarType: v as "hydraulic" | "mechanical" })}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="hydraulic">Гидравлический</SelectItem>
                        <SelectItem value="mechanical">Механический</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <NumberField label="Растяжение перед ударом" unit="м" value={fish.jarStretchM ?? 0} onChange={(v) => setFish({ ...fish, jarStretchM: v })} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Результаты</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <Row k="Требуемая нагрузка на крюке" v={`${fishResult.requiredHookLoadKN.toFixed(0)} кН`} />
                  <Row k="Пиковая ударная сила ясса (2× overpull)" v={`${fishResult.jarImpactKN.toFixed(0)} кН`} />
                  <Row k="Энергия удара (½·F·ΔL)" v={`${(fishResult.jarEnergyJ / 1000).toFixed(1)} кДж`} />
                  <Row k="Max безопасная (предел трубы)" v={`${fishResult.maxSafeHookLoadKN.toFixed(0)} кН`} />
                  <Row k="Лимит подъёмника" v={`${rigResult.allowableLoadKN.toFixed(0)} кН`} />
                  <div className="pt-1">
                    {fishResult.canEngage && fishResult.requiredHookLoadKN < rigResult.allowableLoadKN
                      ? <Badge className="bg-green-600">🟢 Операция в безопасном окне</Badge>
                      : <Badge variant="destructive">🔴 Превышение пределов</Badge>}
                  </div>
                  <Alert><AlertDescription className="text-xs">{fishResult.recommendation}</AlertDescription></Alert>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ──────────────── RIG ──────────────── */}
          <TabsContent value="rig" className="space-y-4">
            <div className="grid lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Параметры подъёмника</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-2 gap-3">
                  <NumberField label="Грузоподъёмность лебёдки" unit="кН" value={rig.rigCapacityKN} onChange={(v) => setRig({ ...rig, rigCapacityKN: v })} />
                  <NumberField label="Грузоподъёмность мачты" unit="кН" value={rig.derrickCapacityKN} onChange={(v) => setRig({ ...rig, derrickCapacityKN: v })} />
                  <NumberField label="Коэфф. запаса" value={rig.safetyFactor} onChange={(v) => setRig({ ...rig, safetyFactor: v })} hint="обычно 1.5–2.0" />
                  <NumberField label="Текущая нагрузка на крюке" unit="кН" value={rig.currentHookLoadKN} onChange={(v) => setRig({ ...rig, currentHookLoadKN: v })} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Окно безопасности</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <Row k="Ограничивающий элемент" v={rigResult.limitingComponent === "rig" ? "Лебёдка" : "Мачта"} />
                  <Row k={`Допустимая (÷${rig.safetyFactor})`} v={`${rigResult.allowableLoadKN.toFixed(0)} кН`} />
                  <Row k="Загрузка" v={`${rigResult.utilizationPct.toFixed(1)} %`}
                    tone={rigResult.status === "overload" ? "danger" : rigResult.status === "caution" ? "warn" : "ok"} />
                  <Row k="Запас (на расхаживание)" v={`${rigResult.maxOverpullKN.toFixed(0)} кН`} />
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart
                      layout="vertical"
                      data={[
                        { name: "Тек. нагрузка", v: rig.currentHookLoadKN, fill: "#0ea5e9" },
                        { name: "Допустимая", v: rigResult.allowableLoadKN, fill: "#10b981" },
                        { name: "Предел трубы", v: pipeYield, fill: "#a855f7" },
                        { name: "Лебёдка", v: rig.rigCapacityKN, fill: "#f59e0b" },
                        { name: "Мачта", v: rig.derrickCapacityKN, fill: "#f43f5e" },
                      ]}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" label={{ value: "кН", position: "insideBottom", offset: -5 }} />
                      <YAxis type="category" dataKey="name" width={110} />
                      <Tooltip />
                      <Bar dataKey="v" />
                    </BarChart>
                  </ResponsiveContainer>
                  {rigResult.warnings.map((w, i) => (
                    <Alert key={i} className="py-2"><AlertDescription className="text-xs">{w}</AlertDescription></Alert>
                  ))}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Сводная таблица сценариев</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Операция</TableHead>
                      <TableHead>Требуемая нагрузка</TableHead>
                      <TableHead>Лимит подъёмника</TableHead>
                      <TableHead>Предел трубы</TableHead>
                      <TableHead>Статус</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <ScenarioRow label="Подъём колонны (без смазки)" need={dragNoLube.maxHookLoadKN} allow={rigResult.allowableLoadKN} pipe={pipeYield} />
                    <ScenarioRow label="Подъём со смазкой" need={dragLube.maxHookLoadKN} allow={rigResult.allowableLoadKN} pipe={pipeYield} />
                    <ScenarioRow label="Освобождение прихвата" need={stuckDiag.freeingForceKN + dragNoLube.freeWeightKN} allow={rigResult.allowableLoadKN} pipe={pipeYield} />
                    <ScenarioRow label="Ловильная операция" need={fishResult.requiredHookLoadKN} allow={rigResult.allowableLoadKN} pipe={pipeYield} />
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      <TermsFooter />
    </div>
  );
}

// ───── small helpers ─────

function Stat({ label, v, tone }: { label: string; v: React.ReactNode; tone?: "ok" | "warn" | "danger" }) {
  const color =
    tone === "danger" ? "text-red-600" : tone === "warn" ? "text-amber-600" : tone === "ok" ? "text-green-600" : "";
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={`font-semibold ${color}`}>{v}</span>
    </div>
  );
}

function Row({ k, v, tone }: { k: string; v: React.ReactNode; tone?: "ok" | "warn" | "danger" }) {
  const color =
    tone === "danger" ? "text-red-600" : tone === "warn" ? "text-amber-600" : tone === "ok" ? "text-green-600" : "";
  return (
    <div className="flex items-center justify-between gap-3 py-1 border-b border-border/40 last:border-0">
      <span className="text-muted-foreground text-xs">{k}</span>
      <span className={`font-medium text-right ${color}`}>{v}</span>
    </div>
  );
}

function ScenarioRow({ label, need, allow, pipe }: { label: string; need: number; allow: number; pipe: number }) {
  const ok = need <= Math.min(allow, pipe);
  const overRig = need > allow;
  const overPipe = need > pipe;
  return (
    <TableRow>
      <TableCell className="text-xs">{label}</TableCell>
      <TableCell className="text-xs">{need.toFixed(0)} кН</TableCell>
      <TableCell className="text-xs">{allow.toFixed(0)} кН</TableCell>
      <TableCell className="text-xs">{pipe.toFixed(0)} кН</TableCell>
      <TableCell className="text-xs">
        {ok
          ? <Badge className="bg-green-600">OK</Badge>
          : <Badge variant="destructive">{overPipe ? "ПРЕДЕЛ ТРУБЫ" : overRig ? "ПЕРЕГРУЗ" : "—"}</Badge>}
      </TableCell>
    </TableRow>
  );
}

function labelStuck(t: string) {
  return { differential: "Дифференциальный", mechanical: "Механический", keyseat: "Желобной", cuttings: "Шламовый", cement: "Цементный" }[t] ?? t;
}
