import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Beaker, AlertTriangle } from "lucide-react";
import {
  AcidComposition, ACID_PRESETS, calculateDissolvingPower, validateComposition,
} from "@/lib/acid-chemistry";

interface Props {
  value: AcidComposition;
  onChange: (c: AcidComposition) => void;
  rockType: "carbonate" | "sandstone" | "dolomite";
  bhPressureMPa: number;
  bhTemperatureC: number;
  compact?: boolean;
}

const Row = ({ label, min, max, step, value, suffix, onChange }: {
  label: string; min: number; max: number; step: number; value: number; suffix: string;
  onChange: (v: number) => void;
}) => (
  <div className="space-y-1">
    <div className="flex items-baseline justify-between">
      <Label className="text-xs">{label}</Label>
      <span className="text-xs tabular-nums font-medium">{value.toFixed(step < 1 ? 2 : 0)} {suffix}</span>
    </div>
    <Slider min={min} max={max} step={step} value={[value]} onValueChange={(v) => onChange(v[0])} />
  </div>
);

export default function AcidCompositionEditor({
  value, onChange, rockType, bhPressureMPa, bhTemperatureC, compact,
}: Props) {
  const diss = useMemo(
    () => calculateDissolvingPower(value, bhPressureMPa, bhTemperatureC),
    [value, bhPressureMPa, bhTemperatureC]
  );
  const warnings = useMemo(
    () => validateComposition(value, rockType, bhTemperatureC),
    [value, rockType, bhTemperatureC]
  );
  const apply = (patch: Partial<AcidComposition>) => onChange({ ...value, ...patch });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Beaker className="w-4 h-4" /> Состав кислотного состава
        </CardTitle>
        <div className="flex flex-wrap gap-1 pt-2">
          {ACID_PRESETS.map(p => (
            <Button key={p.id} size="sm" variant="outline" className="h-7 text-[10px]"
              onClick={() => apply(p.comp)} title={p.desc}>
              {p.label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className={`grid ${compact ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2"} gap-3`}>
          <Row label="HCl" min={0} max={36} step={0.5} suffix="%"
            value={value.hclPct} onChange={(v) => apply({ hclPct: v })} />
          <Row label="HF" min={0} max={15} step={0.5} suffix="%"
            value={value.hfPct} onChange={(v) => apply({ hfPct: v })} />
          <Row label="Ингибитор коррозии" min={0} max={3} step={0.1} suffix="%"
            value={value.corrosionInhibitorPct} onChange={(v) => apply({ corrosionInhibitorPct: v })} />
          <Row label="Стабилизатор Fe" min={0} max={2} step={0.1} suffix="%"
            value={value.ironControlPct} onChange={(v) => apply({ ironControlPct: v })} />
          <Row label="ПАВ" min={0} max={3} step={0.1} suffix="%"
            value={value.surfactantPct} onChange={(v) => apply({ surfactantPct: v })} />
          <Row label="Взаимный растворитель" min={0} max={10} step={0.5} suffix="%"
            value={value.mutualSolventPct} onChange={(v) => apply({ mutualSolventPct: v })} />
          <Row label="Замедлитель (гель)" min={0} max={5} step={0.25} suffix="%"
            value={value.retarderPct} onChange={(v) => apply({ retarderPct: v })} />
        </div>

        <div className="rounded-lg bg-muted/40 border border-border/50 p-3 text-xs space-y-1">
          <div className="flex justify-between"><span>Плотность раствора:</span>
            <b className="tabular-nums">{diss.densityGcc.toFixed(3)} г/см³</b></div>
          <div className="flex justify-between"><span>HCl в растворе:</span>
            <b className="tabular-nums">{diss.hclMolPerL.toFixed(2)} моль/л</b></div>
          {rockType === "carbonate" && (
            <div className="flex justify-between"><span>Растворяющая способность (кальцит):</span>
              <b className="tabular-nums">{diss.dissolvingPowerCalcite.toFixed(0)} кг/м³</b></div>
          )}
          {rockType === "dolomite" && (
            <div className="flex justify-between"><span>Растворяющая способность (доломит):</span>
              <b className="tabular-nums">{diss.dissolvingPowerDolomite.toFixed(0)} кг/м³</b></div>
          )}
          {value.hfPct > 0 && (
            <div className="flex justify-between"><span>Растворяющая способность (кварц):</span>
              <b className="tabular-nums">{diss.dissolvingPowerQuartz.toFixed(0)} кг/м³</b></div>
          )}
          <div className="flex justify-between"><span>CO₂ в забое:</span>
            <b className="tabular-nums">{diss.co2GeneratedM3PerM3.toFixed(2)} м³/м³ ({diss.co2GeneratedStdM3PerM3.toFixed(1)} м³ст)</b></div>
          <div className="flex justify-between"><span>Эфф. сила (с замедлителем):</span>
            <b className="tabular-nums">{diss.effectiveAcidStrength.toFixed(1)} %</b></div>
        </div>

        {warnings.length > 0 && (
          <div className="space-y-1">
            {warnings.map((w, i) => (
              <div key={i} className="flex items-start gap-2 text-xs px-3 py-2 rounded-lg
                bg-yellow-500/10 border border-yellow-500/30 text-yellow-900 dark:text-yellow-200">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
