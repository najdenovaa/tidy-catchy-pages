import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { getCasingID } from "@/lib/cementing-calculations";
import type { WellData, DrillingFluid, BufferFluid, SlurryInput, Additive } from "@/lib/cementing-calculations";

interface Props {
  wellData: WellData;
  onWellDataChange: (d: WellData) => void;
  drillingFluid: DrillingFluid;
  onDrillingFluidChange: (f: DrillingFluid) => void;
  buffers: BufferFluid[];
  onBuffersChange: (b: BufferFluid[]) => void;
  slurries: SlurryInput[];
  onSlurriesChange: (s: SlurryInput[]) => void;
  fractureGradient: number;
  onFractureGradientChange: (v: number) => void;
  displacementDensity: number;
  onDisplacementDensityChange: (v: number) => void;
  displacementFlowRateLps: number;
  onDisplacementFlowRateChange: (v: number) => void;
}

const wellFields: { key: keyof WellData; label: string; unit: string }[] = [
  { key: "wellDepthMD", label: "Глубина скважины (MD)", unit: "м" },
  { key: "wellDepthTVD", label: "Глубина скважины (TVD)", unit: "м" },
  { key: "casingDepthMD", label: "Глубина спуска ОК (MD)", unit: "м" },
  { key: "holeDiameter", label: "Номинальный диаметр ствола", unit: "мм" },
  { key: "casingOD", label: "Наружный диаметр ОК", unit: "мм" },
  { key: "casingWall", label: "Толщина стенки ОК", unit: "мм" },
  { key: "prevCasingDepth", label: "Глубина пред. колонны (MD)", unit: "м" },
  { key: "prevCasingOD", label: "Наружный диам. пред. колонны", unit: "мм" },
  { key: "prevCasingID", label: "Внутр. диам. пред. колонны", unit: "мм" },
  { key: "ckodDepth", label: "Глубина ЦКОД (MD)", unit: "м" },
  { key: "cementRiseHeight", label: "Высота подъёма цемента", unit: "м" },
  { key: "cavernCoeff", label: "Коэффициент кавернозности", unit: "" },
  { key: "bottomTempStatic", label: "BHST (статическая t°)", unit: "°C" },
  { key: "bottomTempCirc", label: "BHCT (циркуляционная t°)", unit: "°C" },
];

function SectionHeader({ title, isOpen, onClick }: { title: string; isOpen: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full flex items-center justify-between py-3 px-4 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
      <span className="font-medium text-sm text-foreground">{title}</span>
      <span className="text-muted-foreground text-xs">{isOpen ? "▲ Свернуть" : "▼ Развернуть"}</span>
    </button>
  );
}

export default function InputSection(props: Props) {
  const [openSections, setOpenSections] = useState({
    well: true, mud: true, buffers: true, cement: true, hydraulics: true,
  });

  const toggle = (key: keyof typeof openSections) => {
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const { wellData, onWellDataChange, drillingFluid, onDrillingFluidChange, buffers, onBuffersChange, slurries, onSlurriesChange, fractureGradient, onFractureGradientChange, displacementDensity, onDisplacementDensityChange, displacementFlowRateLps, onDisplacementFlowRateChange } = props;

  const casingID = getCasingID(wellData.casingOD, wellData.casingWall);

  const handleWellChange = (key: keyof WellData, value: string) => {
    onWellDataChange({ ...wellData, [key]: parseFloat(value) || 0 });
  };

  const handleMudChange = (field: string, value: string) => {
    const num = parseFloat(value) || 0;
    if (field === "density") onDrillingFluidChange({ ...drillingFluid, density: num });
    else if (field === "pv") onDrillingFluidChange({ ...drillingFluid, rheology: { ...drillingFluid.rheology, pv: num } });
    else if (field === "yp") onDrillingFluidChange({ ...drillingFluid, rheology: { ...drillingFluid.rheology, yp: num } });
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
          </CardContent>
        )}
      </Card>

      {/* ===== 2. Буровой раствор ===== */}
      <Card>
        <SectionHeader title="🧪 Буровой раствор и продавочная жидкость" isOpen={openSections.mud} onClick={() => toggle("mud")} />
        {openSections.mud && (
          <CardContent className="pt-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Тип бурового раствора</Label>
                <Input value={drillingFluid.name} onChange={(e) => handleMudChange("name", e.target.value)} className="h-9 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Плотность бур. раствора, кг/м³</Label>
                <Input type="number" step="1" value={drillingFluid.density || ""} onChange={(e) => handleMudChange("density", e.target.value)} className="h-9 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Плотность продавочной жидкости, кг/м³</Label>
                <Input type="number" step="1" value={displacementDensity || ""} onChange={(e) => onDisplacementDensityChange(parseFloat(e.target.value) || 0)} className="h-9 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Производ. продавки, л/с</Label>
                <Input type="number" step="0.1" value={displacementFlowRateLps || ""} onChange={(e) => onDisplacementFlowRateChange(parseFloat(e.target.value) || 0)} className="h-9 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">PV (пласт. вязкость), сПз</Label>
                <Input type="number" step="1" value={drillingFluid.rheology.pv || ""} onChange={(e) => handleMudChange("pv", e.target.value)} className="h-9 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">YP (ДНС), Па</Label>
                <Input type="number" step="0.1" value={drillingFluid.rheology.yp || ""} onChange={(e) => handleMudChange("yp", e.target.value)} className="h-9 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Водоотдача, мл/30мин</Label>
                <Input type="number" step="1" value={drillingFluid.fluidLoss || ""} onChange={(e) => handleMudChange("fluidLoss", e.target.value)} className="h-9 text-sm" />
              </div>
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
              <button onClick={() => onBuffersChange([...buffers, { name: `Буфер ${buffers.length + 1}`, density: 1000, volume: 1, rheology: { pv: 1, yp: 0 }, additives: [], flowRateLps: 5 }])} className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                + Добавить буфер
              </button>
            </div>

            {buffers.map((b, idx) => (
              <div key={idx} className="p-3 rounded-lg bg-muted/30 space-y-3 border border-border/50">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{b.name}</span>
                  {buffers.length > 1 && <button onClick={() => onBuffersChange(buffers.filter((_, i) => i !== idx))} className="text-xs text-destructive hover:underline">Удалить</button>}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  <div className="space-y-1"><Label className="text-xs text-muted-foreground">Название</Label><Input value={b.name} onChange={(e) => handleBufferChange(idx, "name", e.target.value)} className="h-8 text-sm" /></div>
                  <div className="space-y-1"><Label className="text-xs text-muted-foreground">Плотность, кг/м³</Label><Input type="number" value={b.density || ""} onChange={(e) => handleBufferChange(idx, "density", e.target.value)} className="h-8 text-sm" /></div>
                  <div className="space-y-1"><Label className="text-xs text-muted-foreground">Объём, м³</Label><Input type="number" step="0.1" value={b.volume || ""} onChange={(e) => handleBufferChange(idx, "volume", e.target.value)} className="h-8 text-sm" /></div>
                  <div className="space-y-1"><Label className="text-xs text-muted-foreground">Произв., л/с</Label><Input type="number" step="0.1" value={b.flowRateLps || ""} onChange={(e) => handleBufferChange(idx, "flowRateLps", e.target.value)} className="h-8 text-sm" /></div>
                  <div className="space-y-1"><Label className="text-xs text-muted-foreground">PV, сПз</Label><Input type="number" value={b.rheology.pv || ""} onChange={(e) => handleBufferChange(idx, "pv", e.target.value)} className="h-8 text-sm" /></div>
                  <div className="space-y-1"><Label className="text-xs text-muted-foreground">YP, Па</Label><Input type="number" step="0.1" value={b.rheology.yp || ""} onChange={(e) => handleBufferChange(idx, "yp", e.target.value)} className="h-8 text-sm" /></div>
                </div>
                {/* Добавки */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Компонентный состав</span>
                    <button onClick={() => { const u = [...buffers]; u[idx] = { ...u[idx], additives: [...u[idx].additives, { name: "", percentage: 0, massKg: 0 }] }; onBuffersChange(u); }} className="text-xs text-primary hover:underline">+ добавка</button>
                  </div>
                  {b.additives.map((a, aIdx) => (
                    <div key={aIdx} className="flex items-center gap-2">
                      <Input value={a.name} onChange={(e) => updateBufferAdditive(idx, aIdx, "name", e.target.value)} placeholder="Наименование" className="h-7 text-xs flex-1" />
                      <Input type="number" value={a.massKg || ""} onChange={(e) => updateBufferAdditive(idx, aIdx, "massKg", e.target.value)} className="h-7 text-xs w-20" placeholder="кг" />
                      <span className="text-xs text-muted-foreground">кг</span>
                      <button onClick={() => { const u = [...buffers]; u[idx] = { ...u[idx], additives: u[idx].additives.filter((_, i) => i !== aIdx) }; onBuffersChange(u); }} className="text-xs text-destructive">✕</button>
                    </div>
                  ))}
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
            <div className="flex justify-end">
              <button onClick={() => onSlurriesChange([...slurries, { name: `Раствор ${slurries.length + 1}`, density: 1.85, height: 0, rheology: { pv: 30, yp: 10 }, additives: [], thickeningTime30Bc: 0, thickeningTime50Bc: 0, flowRateLps: 5, waterRatio: 0.5, yieldPerTon: 0.63 }])} className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                + Добавить раствор
              </button>
            </div>

            {slurries.map((s, idx) => (
              <div key={idx} className="p-3 rounded-lg bg-muted/30 space-y-3 border border-border/50">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{s.name}</span>
                  {slurries.length > 1 && <button onClick={() => onSlurriesChange(slurries.filter((_, i) => i !== idx))} className="text-xs text-destructive hover:underline">Удалить</button>}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  <div className="space-y-1"><Label className="text-xs text-muted-foreground">Название</Label><Input value={s.name} onChange={(e) => handleSlurryChange(idx, "name", e.target.value)} className="h-8 text-sm" /></div>
                  <div className="space-y-1"><Label className="text-xs text-muted-foreground">Плотность, г/см³</Label><Input type="number" step="0.01" value={s.density || ""} onChange={(e) => handleSlurryChange(idx, "density", e.target.value)} className="h-8 text-sm" /></div>
                  <div className="space-y-1"><Label className="text-xs text-muted-foreground">Интервал (высота), м</Label><Input type="number" value={s.height || ""} onChange={(e) => handleSlurryChange(idx, "height", e.target.value)} className="h-8 text-sm" /></div>
                  <div className="space-y-1"><Label className="text-xs text-muted-foreground">Произв., л/с</Label><Input type="number" step="0.1" value={s.flowRateLps || ""} onChange={(e) => handleSlurryChange(idx, "flowRateLps", e.target.value)} className="h-8 text-sm" /></div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="space-y-1"><Label className="text-xs text-muted-foreground">В/Ц отношение</Label><Input type="number" step="0.001" value={s.waterRatio || ""} onChange={(e) => handleSlurryChange(idx, "waterRatio", e.target.value)} className="h-8 text-sm" /></div>
                  <div className="space-y-1"><Label className="text-xs text-muted-foreground">Выход, м³/т</Label><Input type="number" step="0.01" value={s.yieldPerTon || ""} onChange={(e) => handleSlurryChange(idx, "yieldPerTon", e.target.value)} className="h-8 text-sm" /></div>
                  <div className="space-y-1"><Label className="text-xs text-muted-foreground">Загуст. 30 Вс, мин</Label><Input type="number" value={s.thickeningTime30Bc || ""} onChange={(e) => handleSlurryChange(idx, "thickeningTime30Bc", e.target.value)} className="h-8 text-sm" /></div>
                  <div className="space-y-1"><Label className="text-xs text-muted-foreground">Загуст. 50 Вс, мин</Label><Input type="number" value={s.thickeningTime50Bc || ""} onChange={(e) => handleSlurryChange(idx, "thickeningTime50Bc", e.target.value)} className="h-8 text-sm" /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">PV / YP</Label>
                    <div className="flex gap-1">
                      <Input type="number" value={s.rheology.pv || ""} onChange={(e) => handleSlurryChange(idx, "pv", e.target.value)} className="h-8 text-sm" placeholder="PV" />
                      <Input type="number" step="0.1" value={s.rheology.yp || ""} onChange={(e) => handleSlurryChange(idx, "yp", e.target.value)} className="h-8 text-sm" placeholder="YP" />
                    </div>
                  </div>
                </div>
                {/* Добавки */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Добавки (% bwoc)</span>
                    <button onClick={() => { const u = [...slurries]; u[idx] = { ...u[idx], additives: [...u[idx].additives, { name: "", percentage: 0, massKg: 0 }] }; onSlurriesChange(u); }} className="text-xs text-primary hover:underline">+ добавка</button>
                  </div>
                  {s.additives.map((a, aIdx) => (
                    <div key={aIdx} className="flex items-center gap-2">
                      <Input value={a.name} onChange={(e) => updateSlurryAdditive(idx, aIdx, "name", e.target.value)} placeholder="Наименование" className="h-7 text-xs flex-1" />
                      <Input type="number" step="0.01" value={a.percentage || ""} onChange={(e) => updateSlurryAdditive(idx, aIdx, "percentage", e.target.value)} className="h-7 text-xs w-16" placeholder="%" />
                      <span className="text-xs text-muted-foreground">%</span>
                      <Input type="number" value={a.massKg || ""} onChange={(e) => updateSlurryAdditive(idx, aIdx, "massKg", e.target.value)} className="h-7 text-xs w-20" placeholder="кг" />
                      <span className="text-xs text-muted-foreground">кг</span>
                      <button onClick={() => { const u = [...slurries]; u[idx] = { ...u[idx], additives: u[idx].additives.filter((_, i) => i !== aIdx) }; onSlurriesChange(u); }} className="text-xs text-destructive">✕</button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        )}
      </Card>

      {/* ===== 5. Параметры ГРП ===== */}
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
    </div>
  );
}
