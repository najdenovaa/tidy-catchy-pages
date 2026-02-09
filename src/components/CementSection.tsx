import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { calculateCement, getWaterCementRatio } from "@/lib/cementing-calculations";
import type { SlurryInput, Additive } from "@/lib/cementing-calculations";

interface Props {
  slurries: SlurryInput[];
  onChange: (slurries: SlurryInput[]) => void;
  annularVPM: number;
}

const fmt = (v: number, dec: number = 2) => v.toFixed(dec);

export default function CementSection({ slurries, onChange, annularVPM }: Props) {
  const handleChange = (idx: number, field: string, value: string) => {
    const updated = [...slurries];
    const s = { ...updated[idx] };
    if (field === "name") s.name = value;
    else if (field === "pv") s.rheology = { ...s.rheology, pv: parseFloat(value) || 0 };
    else if (field === "yp") s.rheology = { ...s.rheology, yp: parseFloat(value) || 0 };
    else (s as any)[field] = parseFloat(value) || 0;
    updated[idx] = s;
    onChange(updated);
  };

  const updateAdditive = (sIdx: number, aIdx: number, field: keyof Additive, value: string) => {
    const updated = [...slurries];
    const s = { ...updated[sIdx], additives: [...updated[sIdx].additives] };
    if (field === "name") {
      s.additives[aIdx] = { ...s.additives[aIdx], name: value };
    } else if (field === "percentage") {
      const pct = parseFloat(value) || 0;
      // Авто-расчёт массы добавки от массы цемента
      const res = s.height > 0 && annularVPM > 0 ? calculateCement(annularVPM, s.height, s.density) : null;
      const cementMassKg = res ? res.dryMass * 1000 : 0;
      s.additives[aIdx] = { ...s.additives[aIdx], percentage: pct, massKg: cementMassKg * pct / 100 };
    } else {
      s.additives[aIdx] = { ...s.additives[aIdx], [field]: parseFloat(value) || 0 };
    }
    updated[sIdx] = s;
    onChange(updated);
  };

  const addAdditive = (sIdx: number) => {
    const updated = [...slurries];
    updated[sIdx] = { ...updated[sIdx], additives: [...updated[sIdx].additives, { name: "", percentage: 0, massKg: 0 }] };
    onChange(updated);
  };

  const removeAdditive = (sIdx: number, aIdx: number) => {
    const updated = [...slurries];
    updated[sIdx] = { ...updated[sIdx], additives: updated[sIdx].additives.filter((_, i) => i !== aIdx) };
    onChange(updated);
  };

  const addSlurry = () => {
    onChange([...slurries, {
      name: `Раствор ${slurries.length + 1}`, density: 1.85, height: 0,
      rheology: { pv: 30, yp: 10 }, additives: [],
      thickeningTime30Bc: 0, thickeningTime50Bc: 0,
      flowRateLps: 5, waterRatio: 0.5, yieldPerTon: 0.63,
    }]);
  };

  const removeSlurry = (idx: number) => {
    onChange(slurries.filter((_, i) => i !== idx));
  };

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">05. Тампонажные растворы</CardTitle>
          <button onClick={addSlurry} className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
            + Добавить
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {slurries.map((s, idx) => {
          const res = s.height > 0 && annularVPM > 0 ? calculateCement(annularVPM, s.height, s.density) : null;
          const wcr = getWaterCementRatio(s.density * 1000);

          return (
            <div key={idx} className="p-4 rounded-lg bg-muted/50 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm">{s.name}</span>
                {slurries.length > 1 && (
                  <button onClick={() => removeSlurry(idx)} className="text-xs text-destructive hover:underline">Удалить</button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Название</Label>
                  <Input value={s.name} onChange={(e) => handleChange(idx, "name", e.target.value)} className="h-9 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Плотность, г/см³</Label>
                  <Input type="number" step="0.01" value={s.density || ""} onChange={(e) => handleChange(idx, "density", e.target.value)} className="h-9 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Интервал (высота), м</Label>
                  <Input type="number" step="1" value={s.height || ""} onChange={(e) => handleChange(idx, "height", e.target.value)} className="h-9 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">PV / YP</Label>
                  <div className="flex gap-2">
                    <Input type="number" step="1" value={s.rheology.pv || ""} onChange={(e) => handleChange(idx, "pv", e.target.value)} className="h-9 text-sm" placeholder="PV" />
                    <Input type="number" step="0.1" value={s.rheology.yp || ""} onChange={(e) => handleChange(idx, "yp", e.target.value)} className="h-9 text-sm" placeholder="YP" />
                  </div>
                </div>
              </div>

              {/* Время загустевания */}
              <div className="grid grid-cols-2 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Время загуст. до 30 Вс, мин</Label>
                  <Input type="number" value={s.thickeningTime30Bc || ""} onChange={(e) => handleChange(idx, "thickeningTime30Bc", e.target.value)} className="h-9 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Время загуст. до 50 Вс, мин</Label>
                  <Input type="number" value={s.thickeningTime50Bc || ""} onChange={(e) => handleChange(idx, "thickeningTime50Bc", e.target.value)} className="h-9 text-sm" />
                </div>
              </div>

              {/* Добавки */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground font-medium">Добавки (% от массы цемента — bwoc)</span>
                  <button onClick={() => addAdditive(idx)} className="text-xs text-primary hover:underline">+ добавка</button>
                </div>
                {s.additives.map((a, aIdx) => (
                  <div key={aIdx} className="flex items-center gap-2">
                    <Input value={a.name} onChange={(e) => updateAdditive(idx, aIdx, "name", e.target.value)} placeholder="Наименование" className="h-8 text-xs flex-1" />
                    <Input type="number" step="0.01" value={a.percentage || ""} onChange={(e) => updateAdditive(idx, aIdx, "percentage", e.target.value)} placeholder="%" className="h-8 text-xs w-20" />
                    <span className="text-xs text-muted-foreground">%</span>
                    <div className="h-8 flex items-center px-2 rounded bg-muted text-xs font-medium w-24 border border-border">
                      {a.massKg > 0 ? `${a.massKg.toFixed(1)} кг` : "—"}
                    </div>
                    <button onClick={() => removeAdditive(idx, aIdx)} className="text-xs text-destructive">✕</button>
                  </div>
                ))}
              </div>

              {res && (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-2 border-t border-border">
                  <ResultItem label="В/Ц отношение" value={fmt(wcr, 3)} />
                  <ResultItem label="Объём раствора" value={`${fmt(res.slurryVolume)} м³`} />
                  <ResultItem label="Масса цемента" value={`${fmt(res.dryMass)} т`} />
                  <ResultItem label="Объём воды" value={`${fmt(res.waterVolume)} м³`} />
                  <ResultItem label="Выход из 1 т" value={`${fmt(res.yieldPerTon)} м³/т`} />
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function ResultItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}
