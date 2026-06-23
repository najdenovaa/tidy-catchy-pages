import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import {
  DetailedMineralogy, FluidProperties, DepthProfile, StressState,
  totalMineralPct, totalClay, totalCarbonate, normalizeMineralogy,
  suggestedReservoirPressureMPa, suggestedReservoirTempC,
  overburdenPressureMPa, fracturePressureMPa,
  DEFAULT_MINERALOGY_SANDSTONE, DEFAULT_MINERALOGY_CARBONATE, DEFAULT_MINERALOGY_DOLOMITE,
} from "@/lib/geology-model";

interface Props {
  mineralogy: DetailedMineralogy;
  setMineralogy: (m: DetailedMineralogy) => void;
  fluid: FluidProperties;
  setFluid: (f: FluidProperties) => void;
  depth: DepthProfile;
  setDepth: (d: DepthProfile) => void;
  stress: StressState;
  setStress: (s: StressState) => void;
  // Текущие Pr / T — чтобы показать подсказку «применить рассчитанное»
  currentReservoirPressureMPa: number;
  currentReservoirTempC: number;
  onApplyPressure: (p: number) => void;
  onApplyTemperature: (t: number) => void;
  // Опционально: давление обработки, чтобы сравнить с Pfrac
  treatmentPressureMPa?: number;
}

function Num({
  label, value, onChange, step = 1, suffix,
}: { label: string; value: number; onChange: (v: number) => void; step?: number; suffix?: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}{suffix && <span className="text-muted-foreground"> ({suffix})</span>}</Label>
      <Input
        type="number" step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="h-8"
      />
    </div>
  );
}

const MIN_LABELS: Record<keyof DetailedMineralogy, string> = {
  quartz: "Кварц",
  feldspar: "Полевой шпат",
  calcite: "Кальцит (CaCO₃)",
  dolomite: "Доломит",
  chalk: "Мел",
  siderite: "Сидерит (FeCO₃)",
  anhydrite: "Ангидрит (CaSO₄)",
  pyrite: "Пирит (FeS₂)",
  kaolinite: "Каолинит",
  illite: "Иллит",
  chlorite: "Хлорит",
  smectite: "Смектит (мнт.)",
};

export default function GeologyEditor(props: Props) {
  const {
    mineralogy, setMineralogy, fluid, setFluid, depth, setDepth, stress, setStress,
    currentReservoirPressureMPa, currentReservoirTempC,
    onApplyPressure, onApplyTemperature, treatmentPressureMPa,
  } = props;

  const total = useMemo(() => totalMineralPct(mineralogy), [mineralogy]);
  const tClay = useMemo(() => totalClay(mineralogy), [mineralogy]);
  const tCarb = useMemo(() => totalCarbonate(mineralogy), [mineralogy]);

  const suggestedP = useMemo(() => suggestedReservoirPressureMPa(depth), [depth]);
  const suggestedT = useMemo(() => suggestedReservoirTempC(depth), [depth]);
  const sigmaV = useMemo(() => overburdenPressureMPa(depth, stress), [depth, stress]);
  const pFrac = useMemo(
    () => fracturePressureMPa(depth, currentReservoirPressureMPa, stress),
    [depth, currentReservoirPressureMPa, stress]
  );

  const dPr = Math.abs(suggestedP - currentReservoirPressureMPa);
  const dT = Math.abs(suggestedT - currentReservoirTempC);

  const setMin = (k: keyof DetailedMineralogy, v: number) =>
    setMineralogy({ ...mineralogy, [k]: Math.max(0, v) });

  const pFracExceeded = treatmentPressureMPa !== undefined && treatmentPressureMPa >= pFrac;

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="font-semibold">Геология и пласт</h2>
        <div className="flex items-center gap-2 text-xs">
          <Badge variant={Math.abs(total - 100) < 1 ? "secondary" : "destructive"}>
            Σ минералов: {total.toFixed(1)}%
          </Badge>
          <Badge variant="outline">Глины: {tClay.toFixed(1)}%</Badge>
          <Badge variant="outline">Карбонаты: {tCarb.toFixed(1)}%</Badge>
        </div>
      </div>

      <Accordion type="multiple" defaultValue={["min", "fluid"]} className="w-full">
        {/* ── Минеральный состав ── */}
        <AccordionItem value="min">
          <AccordionTrigger className="text-sm">⛏️ Минеральный состав</AccordionTrigger>
          <AccordionContent className="space-y-3 pt-2">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setMineralogy(DEFAULT_MINERALOGY_SANDSTONE)}>Песчаник</Button>
              <Button size="sm" variant="outline" onClick={() => setMineralogy(DEFAULT_MINERALOGY_CARBONATE)}>Известняк</Button>
              <Button size="sm" variant="outline" onClick={() => setMineralogy(DEFAULT_MINERALOGY_DOLOMITE)}>Доломит</Button>
              <Button size="sm" variant="secondary" onClick={() => setMineralogy(normalizeMineralogy(mineralogy))}>
                ⇄ Нормализовать к 100%
              </Button>
            </div>

            <div>
              <div className="text-xs text-muted-foreground mb-1">Силикаты и карбонаты, %</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(["quartz", "feldspar", "calcite", "dolomite", "chalk", "siderite", "anhydrite", "pyrite"] as const).map((k) => (
                  <Num key={k} label={MIN_LABELS[k]} value={mineralogy[k]} step={0.5} onChange={(v) => setMin(k, v)} />
                ))}
              </div>
            </div>

            <div>
              <div className="text-xs text-muted-foreground mb-1">Глины по типам, %</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(["kaolinite", "illite", "chlorite", "smectite"] as const).map((k) => (
                  <Num key={k} label={MIN_LABELS[k]} value={mineralogy[k]} step={0.5} onChange={(v) => setMin(k, v)} />
                ))}
              </div>
              <div className="text-[11px] text-muted-foreground mt-2 leading-snug">
                <b>Смектит</b> — основной набухающий. <b>Иллит</b> — миграция фибрилл при HF. <b>Хлорит</b> + HF → риск осадка Fe(OH)₃. <b>Каолинит</b> — миграция частиц.
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* ── Пластовый флюид ── */}
        <AccordionItem value="fluid">
          <AccordionTrigger className="text-sm">🛢️ Пластовый флюид</AccordionTrigger>
          <AccordionContent className="pt-2">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <Num label="μ нефти" suffix="сПз" value={fluid.oilViscosity_cP} step={0.1}
                onChange={(v) => setFluid({ ...fluid, oilViscosity_cP: v })} />
              <Num label="Bo" suffix="м³/м³" value={fluid.Bo} step={0.01}
                onChange={(v) => setFluid({ ...fluid, Bo: v })} />
              <Num label="ГФ" suffix="м³/м³" value={fluid.GOR_m3m3} step={5}
                onChange={(v) => setFluid({ ...fluid, GOR_m3m3: v })} />
              <Num label="Обводнённость" suffix="%" value={fluid.waterCutPct} step={1}
                onChange={(v) => setFluid({ ...fluid, waterCutPct: v })} />
              <Num label="ρ нефти" suffix="кг/м³" value={fluid.oilDensity_kgm3} step={5}
                onChange={(v) => setFluid({ ...fluid, oilDensity_kgm3: v })} />
            </div>
            <div className="text-[11px] text-muted-foreground mt-2">
              Используется в IPR (Дарси / Вогель) и кинетике обработки вместо стандартных значений.
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* ── Глубина и градиенты ── */}
        <AccordionItem value="depth">
          <AccordionTrigger className="text-sm">📏 Глубина и градиенты</AccordionTrigger>
          <AccordionContent className="pt-2 space-y-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Num label="Глубина MD" suffix="м" value={depth.depthMD_m} step={50}
                onChange={(v) => setDepth({ ...depth, depthMD_m: v })} />
              <Num label="Градиент P" suffix="МПа/100м" value={depth.pressureGradient_MPa_per_100m} step={0.01}
                onChange={(v) => setDepth({ ...depth, pressureGradient_MPa_per_100m: v })} />
              <Num label="Градиент T" suffix="°C/100м" value={depth.tempGradient_C_per_100m} step={0.1}
                onChange={(v) => setDepth({ ...depth, tempGradient_C_per_100m: v })} />
              <Num label="T поверхн." suffix="°C" value={depth.surfaceTempC} step={1}
                onChange={(v) => setDepth({ ...depth, surfaceTempC: v })} />
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <div className="flex items-center gap-2 px-2 py-1 rounded border border-border/60 bg-muted/30">
                По градиенту: <b>{suggestedP.toFixed(1)} МПа</b>
                {dPr > 0.5 && (
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-xs"
                    onClick={() => onApplyPressure(suggestedP)}>применить</Button>
                )}
              </div>
              <div className="flex items-center gap-2 px-2 py-1 rounded border border-border/60 bg-muted/30">
                По градиенту: <b>{suggestedT.toFixed(0)}°C</b>
                {dT > 1 && (
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-xs"
                    onClick={() => onApplyTemperature(suggestedT)}>применить</Button>
                )}
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* ── Геомеханика (упрощённая) ── */}
        <AccordionItem value="stress">
          <AccordionTrigger className="text-sm">
            🪨 Геомеханика (Eaton)
            {pFracExceeded && (
              <Badge variant="destructive" className="ml-2 text-[10px]">P обработки ≥ Pfrac</Badge>
            )}
          </AccordionTrigger>
          <AccordionContent className="pt-2 space-y-2">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <Num label="Градиент σv" suffix="МПа/100м" value={stress.overburdenGradient_MPa_per_100m} step={0.01}
                onChange={(v) => setStress({ ...stress, overburdenGradient_MPa_per_100m: v })} />
              <Num label="Коэф. Eaton" value={stress.eatonRatio} step={0.05}
                onChange={(v) => setStress({ ...stress, eatonRatio: Math.max(0, Math.min(1, v)) })} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
              <div className="px-2 py-1 rounded border border-border/60 bg-muted/30">
                σv (горн.): <b>{sigmaV.toFixed(1)} МПа</b>
              </div>
              <div className="px-2 py-1 rounded border border-border/60 bg-muted/30">
                Pp (текущ.): <b>{currentReservoirPressureMPa.toFixed(1)} МПа</b>
              </div>
              <div className={`px-2 py-1 rounded border ${pFracExceeded ? "border-destructive/60 bg-destructive/10" : "border-border/60 bg-muted/30"}`}>
                Pfrac: <b>{pFrac.toFixed(1)} МПа</b>
                {treatmentPressureMPa !== undefined && (
                  <span className="text-muted-foreground"> · P обр. {treatmentPressureMPa.toFixed(1)}</span>
                )}
              </div>
            </div>
            <div className="text-[11px] text-muted-foreground leading-snug">
              Упрощённая формула Итона: Pfrac ≈ {stress.eatonRatio.toFixed(2)}·σv + {(1 - stress.eatonRatio).toFixed(2)}·Pp.
              Превышение давления обработки над Pfrac означает риск ГРП.
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </Card>
  );
}
