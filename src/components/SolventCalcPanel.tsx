import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Flame } from "lucide-react";
import {
  calculateSolventTreatment, SOLVENT_LABEL, type SolventType, type SolventResult,
} from "@/lib/stimulation-special";

interface Props {
  payZoneM: number;
  porosity: number;
  reservoirTempC: number;
  defaultDamage: "asphaltene" | "paraffin";
  onResult?: (r: SolventResult & { penetrationRadiusM: number }) => void;
}

export default function SolventCalcPanel({ payZoneM, porosity, reservoirTempC, defaultDamage, onResult }: Props) {
  const [solvent, setSolvent] = useState<SolventType>(defaultDamage === "asphaltene" ? "toluene" : "neftras");
  const [damageType, setDamageType] = useState<"asphaltene" | "paraffin">(defaultDamage);
  const [penetrationR, setPenetrationR] = useState(1.5);
  const [satPct, setSatPct] = useState(15);
  const [surfaceT, setSurfaceT] = useState(80);
  const [tubingDepth, setTubingDepth] = useState(2200);
  const [rate, setRate] = useState(0.15);
  const [tubingOD, setTubingOD] = useState(73);

  const res = useMemo(() => calculateSolventTreatment({
    solvent, damageType, payZoneM, porosity,
    wellboreRadiusM: 0.108,
    penetrationRadiusM: penetrationR,
    depositSaturation: satPct / 100,
    reservoirTempC,
    surfaceTempC: surfaceT,
    tubingDepthM: tubingDepth,
    rateM3PerMin: rate,
    tubingOD_mm: tubingOD,
  }), [solvent, damageType, payZoneM, porosity, penetrationR, satPct,
       reservoirTempC, surfaceT, tubingDepth, rate, tubingOD]);

  useEffect(() => {
    onResult?.({ ...res, penetrationRadiusM: penetrationR });
  }, [res, penetrationR, onResult]);

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-semibold flex items-center gap-2"><Flame className="w-4 h-4 text-orange-500" /> Спец-расчёт растворителя</h3>
        <Badge variant="outline" className="text-xs">{damageType === "asphaltene" ? "АСПО" : "Парафин"}</Badge>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="space-y-1">
          <Label>Тип отложений</Label>
          <Select value={damageType} onValueChange={(v) => setDamageType(v as "asphaltene" | "paraffin")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="asphaltene">Асфальтены</SelectItem>
              <SelectItem value="paraffin">Парафин</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Растворитель</Label>
          <Select value={solvent} onValueChange={(v) => setSolvent(v as SolventType)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(SOLVENT_LABEL) as SolventType[]).map((k) => (
                <SelectItem key={k} value={k}>{SOLVENT_LABEL[k]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Num label="Радиус обработки, м" value={penetrationR} onChange={setPenetrationR} step={0.1} />
        <Num label="Насыщ. АСПО в ПЗП, %" value={satPct} onChange={setSatPct} step={1} />
        <Num label="T нагрева, °C" value={surfaceT} onChange={setSurfaceT} step={5} />
        <Num label="L НКТ, м" value={tubingDepth} onChange={setTubingDepth} step={50} />
        <Num label="Темп закачки, м³/мин" value={rate} onChange={setRate} step={0.05} />
        <Num label="НКТ нар., мм" value={tubingOD} onChange={setTubingOD} step={1} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm pt-2 border-t border-border/40">
        <KV k="Поровый объём кольца" v={`${res.treatedPoreVolumeM3.toFixed(2)} м³`} />
        <KV k="Масса отложений" v={`${res.depositMassKg.toFixed(0)} кг`} />
        <KV k="Раств. способность" v={`${res.dissolutionCapacityKgPerM3} кг/м³`} />
        <KV k="Требуется растворителя" v={`${res.requiredSolventM3.toFixed(1)} м³`} highlight />
        <KV k="T в забое (оценка)" v={`${res.bottomholeTempC.toFixed(0)} °C`} />
        <KV k="Рекоменд. выдержка" v={`${res.recommendedSoakMin} мин`} />
      </div>

      {damageType === "paraffin" && (
        <div className={`text-xs flex items-center gap-2 p-2 rounded ${res.meetsTempCriterion ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}>
          {res.meetsTempCriterion ? "✓" : "⚠"} Критерий Tзаб ≥ Tкрист.+10°C: {res.meetsTempCriterion ? "выполняется" : "НЕ выполняется"}
        </div>
      )}

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
