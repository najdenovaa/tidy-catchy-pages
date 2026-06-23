import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Wind } from "lucide-react";
import {
  calculateNitrogenOperation, type NitrogenResult,
} from "@/lib/stimulation-special";

interface Props {
  reservoirPressureMPa: number;
  reservoirTempC: number;
  operationType: "n2_lift" | "n2_foam_lift" | "n2_cleanup";
  defaultFoamQuality?: number;
  onResult?: (r: NitrogenResult & { targetBhpMPa: number }) => void;
}

export default function NitrogenCalcPanel({
  reservoirPressureMPa, reservoirTempC, operationType, defaultFoamQuality, onResult,
}: Props) {
  const [wellDepth, setWellDepth] = useState(2500);
  const [tubingID, setTubingID] = useState(62);
  const [fluidDensity, setFluidDensity] = useState(1050);
  const [surfaceT, setSurfaceT] = useState(20);
  const [targetBhp, setTargetBhp] = useState(Math.max(2, reservoirPressureMPa * 0.5));
  const [foamQ, setFoamQ] = useState(defaultFoamQuality ?? 85);
  const [pumpRate, setPumpRate] = useState(15); // м³/мин н.у.

  const res = useMemo(() => calculateNitrogenOperation({
    operationType,
    wellDepthM: wellDepth,
    tubingID_mm: tubingID,
    fluidDensityKgM3: fluidDensity,
    reservoirPressureMPa,
    reservoirTempC,
    surfaceTempC: surfaceT,
    targetBhpMPa: targetBhp,
    foamQualityPct: operationType === "n2_foam_lift" ? foamQ : undefined,
    pumpRateM3PerMin: pumpRate,
  }), [operationType, wellDepth, tubingID, fluidDensity, reservoirPressureMPa,
       reservoirTempC, surfaceT, targetBhp, foamQ, pumpRate]);

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-semibold flex items-center gap-2"><Wind className="w-4 h-4 text-sky-500" /> Спец-расчёт азотной операции</h3>
        <Badge variant="outline" className="text-xs">
          {operationType === "n2_lift" ? "Лифт" : operationType === "n2_foam_lift" ? "Пенный лифт" : "Очистка"}
        </Badge>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Num label="L скв., м" value={wellDepth} onChange={setWellDepth} step={50} />
        <Num label="d НКТ внутр., мм" value={tubingID} onChange={setTubingID} step={1} />
        <Num label="ρ жидкости, кг/м³" value={fluidDensity} onChange={setFluidDensity} step={10} />
        <Num label="T устья, °C" value={surfaceT} onChange={setSurfaceT} step={5} />
        <Num label="Целевое Pзаб, МПа" value={targetBhp} onChange={setTargetBhp} step={0.5} />
        <Num label="Темп закачки, м³/мин (н.у.)" value={pumpRate} onChange={setPumpRate} step={1} />
        {operationType === "n2_foam_lift" && (
          <Num label="Foam Quality, %" value={foamQ} onChange={setFoamQ} step={5} />
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm pt-2 border-t border-border/40">
        <KV k="Объём НКТ" v={`${res.tubingVolumeM3.toFixed(2)} м³`} />
        <KV k="Pгидрост. жидкости" v={`${res.bhpHydrostaticMPa.toFixed(2)} МПа`} />
        <KV k="Депрессия (Pпл-Pзаб)" v={`${res.drawdownMPa.toFixed(2)} МПа`} />
        <KV k="Высота замещения N₂" v={`${res.liftHeightM.toFixed(0)} м`} />
        <KV k="Z-фактор N₂ (забой)" v={res.zFactorBh.toFixed(3)} />
        <KV k="ρ N₂ в забое" v={`${res.n2DensityBh.toFixed(1)} кг/м³`} />
        <KV k="Градиент N₂" v={`${res.n2GradientBhMPaPer100m.toFixed(3)} МПа/100м`} />
        <KV k="V N₂ в забое" v={`${res.n2VolumeDownholeM3.toFixed(2)} м³`} />
        <KV k="V N₂ на устье (н.у.)" v={`${res.n2VolumeSurfaceStandardM3.toFixed(0)} м³`} highlight />
        <KV k="Масса N₂" v={`${res.n2MassKg.toFixed(0)} кг`} />
        <KV k="Время закачки" v={`${res.pumpTimeMin.toFixed(0)} мин`} />
        {res.foamLiquidVolumeM3 !== undefined && (
          <KV k="V раствора ПАВ" v={`${res.foamLiquidVolumeM3.toFixed(2)} м³`} />
        )}
      </div>

      {res.warnings.length > 0 && (
        <div className="space-y-1">
          {res.warnings.map((w, i) => (
            <div key={i} className="text-xs flex items-start gap-2 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" /> {w}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function Num({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input type="number" step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}
function KV({ k, v, highlight }: { k: string; v: string; highlight?: boolean }) {
  return (
    <div className={`flex justify-between border-b border-border/40 pb-1 ${highlight ? "font-semibold" : ""}`}>
      <span className="text-muted-foreground">{k}</span>
      <span>{v}</span>
    </div>
  );
}
