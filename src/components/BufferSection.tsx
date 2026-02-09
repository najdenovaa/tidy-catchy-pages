import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { calculateContactTime } from "@/lib/cementing-calculations";
import type { BufferFluid, Additive } from "@/lib/cementing-calculations";

interface Props {
  buffers: BufferFluid[];
  onChange: (buffers: BufferFluid[]) => void;
  annularVPM: number;
  flowRate: number;
  onFlowRateChange: (v: number) => void;
}

const fmt = (v: number, dec: number = 2) => v.toFixed(dec);

export default function BufferSection({ buffers, onChange, annularVPM, flowRate, onFlowRateChange }: Props) {
  const handleChange = (idx: number, field: string, value: string) => {
    const updated = [...buffers];
    const b = { ...updated[idx] };
    if (field === "name") b.name = value;
    else if (field === "pv") b.rheology = { ...b.rheology, pv: parseFloat(value) || 0 };
    else if (field === "yp") b.rheology = { ...b.rheology, yp: parseFloat(value) || 0 };
    else (b as any)[field] = parseFloat(value) || 0;
    updated[idx] = b;
    onChange(updated);
  };

  const updateAdditive = (bIdx: number, aIdx: number, field: keyof Additive, value: string) => {
    const updated = [...buffers];
    const b = { ...updated[bIdx], additives: [...updated[bIdx].additives] };
    b.additives[aIdx] = { ...b.additives[aIdx], [field]: field === "name" ? value : parseFloat(value) || 0 };
    updated[bIdx] = b;
    onChange(updated);
  };

  const addAdditiveToBuffer = (bIdx: number) => {
    const updated = [...buffers];
    updated[bIdx] = { ...updated[bIdx], additives: [...updated[bIdx].additives, { name: "", percentage: 0, massKg: 0 }] };
    onChange(updated);
  };

  const removeAdditive = (bIdx: number, aIdx: number) => {
    const updated = [...buffers];
    updated[bIdx] = { ...updated[bIdx], additives: updated[bIdx].additives.filter((_, i) => i !== aIdx) };
    onChange(updated);
  };

  const addBuffer = () => {
    onChange([...buffers, { name: `Буфер ${buffers.length + 1}`, density: 1000, volume: 1, rheology: { pv: 1, yp: 0 }, additives: [], flowRateLps: 5 }]);
  };

  const removeBuffer = (idx: number) => {
    onChange(buffers.filter((_, i) => i !== idx));
  };

  const totalVolume = buffers.reduce((s, b) => s + b.volume, 0);
  const totalHeight = annularVPM > 0 ? totalVolume / annularVPM : 0;

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">04. Буферные составы</CardTitle>
          <button onClick={addBuffer} className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
            + Добавить
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1 max-w-xs">
          <Label className="text-xs text-muted-foreground">Производительность насоса, м³/мин</Label>
          <Input type="number" step="0.1" value={flowRate || ""} onChange={(e) => onFlowRateChange(parseFloat(e.target.value) || 0)} className="h-9 text-sm" />
        </div>

        {buffers.map((b, idx) => {
          const ct = annularVPM > 0 && flowRate > 0 ? calculateContactTime(b.volume, annularVPM, flowRate) : null;

          return (
            <div key={idx} className="p-4 rounded-lg bg-muted/50 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm">{b.name}</span>
                {buffers.length > 1 && (
                  <button onClick={() => removeBuffer(idx)} className="text-xs text-destructive hover:underline">Удалить</button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Название</Label>
                  <Input value={b.name} onChange={(e) => handleChange(idx, "name", e.target.value)} className="h-9 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Плотность, кг/м³</Label>
                  <Input type="number" step="1" value={b.density || ""} onChange={(e) => handleChange(idx, "density", e.target.value)} className="h-9 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Объём, м³</Label>
                  <Input type="number" step="0.1" value={b.volume || ""} onChange={(e) => handleChange(idx, "volume", e.target.value)} className="h-9 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">PV, сПз</Label>
                  <Input type="number" step="1" value={b.rheology.pv || ""} onChange={(e) => handleChange(idx, "pv", e.target.value)} className="h-9 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">YP (ДНС), Па</Label>
                  <Input type="number" step="0.1" value={b.rheology.yp || ""} onChange={(e) => handleChange(idx, "yp", e.target.value)} className="h-9 text-sm" />
                </div>
              </div>

              {/* Добавки */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground font-medium">Компонентный состав</span>
                  <button onClick={() => addAdditiveToBuffer(idx)} className="text-xs text-primary hover:underline">+ добавка</button>
                </div>
                {b.additives.map((a, aIdx) => (
                  <div key={aIdx} className="flex items-center gap-2">
                    <Input value={a.name} onChange={(e) => updateAdditive(idx, aIdx, "name", e.target.value)} placeholder="Наименование" className="h-8 text-xs flex-1" />
                    <Input type="number" value={a.massKg || ""} onChange={(e) => updateAdditive(idx, aIdx, "massKg", e.target.value)} placeholder="кг" className="h-8 text-xs w-24" />
                    <span className="text-xs text-muted-foreground">кг</span>
                    <button onClick={() => removeAdditive(idx, aIdx)} className="text-xs text-destructive">✕</button>
                  </div>
                ))}
              </div>

              {ct && (
                <div className="grid grid-cols-3 gap-3 pt-2 border-t border-border">
                  <div><div className="text-xs text-muted-foreground">Высота в затрубе</div><div className="text-sm font-semibold">{fmt(ct.bufferHeightAnnulus)} м</div></div>
                  <div><div className="text-xs text-muted-foreground">Скорость</div><div className="text-sm font-semibold">{fmt(ct.bufferVelocity)} м/мин</div></div>
                  <div><div className="text-xs text-muted-foreground">Время контакта</div><div className="text-sm font-semibold">{fmt(ct.contactTime)} мин</div></div>
                </div>
              )}
            </div>
          );
        })}

        <div className="flex justify-between items-center pt-2 border-t border-border">
          <span className="text-sm text-muted-foreground">Общий объём буферов / эквив. высота</span>
          <span className="text-sm font-semibold">{fmt(totalVolume)} м³ / {fmt(totalHeight, 0)} м кольцевого пространства</span>
        </div>
      </CardContent>
    </Card>
  );
}
