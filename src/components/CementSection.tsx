import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { calculateCement, getWaterCementRatio } from "@/lib/cementing-calculations";

interface SlurryInput {
  name: string;
  density: number;
  height: number;
}

interface Props {
  slurries: SlurryInput[];
  onChange: (slurries: SlurryInput[]) => void;
  annularVPM: number;
}

const fmt = (v: number, dec: number = 2) => v.toFixed(dec);

export default function CementSection({ slurries, onChange, annularVPM }: Props) {
  const handleChange = (idx: number, field: keyof SlurryInput, value: string) => {
    const updated = [...slurries];
    if (field === "name") {
      updated[idx] = { ...updated[idx], name: value };
    } else {
      updated[idx] = { ...updated[idx], [field]: parseFloat(value) || 0 };
    }
    onChange(updated);
  };

  const addSlurry = () => {
    onChange([...slurries, { name: `Раствор ${slurries.length + 1}`, density: 1.85, height: 0 }]);
  };

  const removeSlurry = (idx: number) => {
    onChange(slurries.filter((_, i) => i !== idx));
  };

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Цементные растворы</CardTitle>
          <button
            onClick={addSlurry}
            className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            + Добавить
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {slurries.map((s, idx) => {
          const res = s.height > 0 && annularVPM > 0
            ? calculateCement(annularVPM, s.height, s.density)
            : null;
          const wcr = getWaterCementRatio(s.density * 1000);

          return (
            <div key={idx} className="p-4 rounded-lg bg-muted/50 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm">{s.name}</span>
                {slurries.length > 1 && (
                  <button
                    onClick={() => removeSlurry(idx)}
                    className="text-xs text-destructive hover:underline"
                  >
                    Удалить
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Название</Label>
                  <Input
                    value={s.name}
                    onChange={(e) => handleChange(idx, "name", e.target.value)}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Плотность, г/см³</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={s.density || ""}
                    onChange={(e) => handleChange(idx, "density", e.target.value)}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Высота подъёма, м</Label>
                  <Input
                    type="number"
                    step="1"
                    value={s.height || ""}
                    onChange={(e) => handleChange(idx, "height", e.target.value)}
                    className="h-9 text-sm"
                  />
                </div>
              </div>
              {res && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-border">
                  <ResultItem label="В/Ц отношение" value={fmt(wcr, 3)} />
                  <ResultItem label="Объём раствора" value={`${fmt(res.slurryVolume)} м³`} />
                  <ResultItem label="Масса цемента" value={`${fmt(res.dryMass)} тн`} />
                  <ResultItem label="Объём воды" value={`${fmt(res.waterVolume)} м³`} />
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
