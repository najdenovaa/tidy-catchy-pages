import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, AlertTriangle, Plus, Trash2 } from "lucide-react";
import type { WellData, DrillingFluid, SlurryInput, BufferFluid, DisplacementFluid } from "@/lib/cementing-calculations";
import { getCasingID, pipeVolumePerMeter, totalPipeVolumeForRange, annularVolumePerMeter, getSlurryHeight } from "@/lib/cementing-calculations";

export interface ExtractedData {
  wellData: Partial<Record<keyof WellData, number | null>>;
  trajectory?: { md: number; angle: number; azimuth: number; tvd: number }[];
  drillingFluid: { name?: string | null; density?: number | null; pv?: number | null; yp?: number | null; fluidLoss?: number | null };
  slurries: {
    name?: string | null; density?: number | null; topDepthMD?: number | null;
    waterRatio?: number | null; yieldPerTon?: number | null;
    thickeningTime30Bc?: number | null; thickeningTime50Bc?: number | null;
    flowRateLps?: number | null; pv?: number | null; yp?: number | null;
    fluidLoss?: number | null;
  }[];
  buffers: { name?: string | null; density?: number | null; volume?: number | null; flowRateLps?: number | null }[];
  displacementFluid: { name?: string | null; density?: number | null; flowRateLps?: number | null };
  wellName?: string | null;
  fieldName?: string | null;
  casingType?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  extractedData: ExtractedData;
  onConfirm: (
    wellData: WellData,
    drillingFluid: DrillingFluid,
    slurries: SlurryInput[],
    buffers: BufferFluid[],
    displacementFluids: DisplacementFluid[],
  ) => void;
}

const wellFields: { key: string; label: string; unit: string; required: boolean }[] = [
  { key: "wellDepthMD", label: "Глубина скважины (MD)", unit: "м", required: true },
  { key: "wellDepthTVD", label: "Глубина скважины (TVD)", unit: "м", required: false },
  { key: "casingDepthMD", label: "Глубина спуска ОК (MD)", unit: "м", required: true },
  { key: "holeDiameter", label: "Диаметр ствола", unit: "мм", required: true },
  { key: "casingOD", label: "Наружный диаметр ОК", unit: "мм", required: true },
  { key: "casingWall", label: "Толщина стенки ОК", unit: "мм", required: true },
  { key: "prevCasingDepth", label: "Глубина пред. колонны", unit: "м", required: false },
  { key: "prevCasingID", label: "Внутр. диам. пред. колонны", unit: "мм", required: false },
  { key: "prevCasingOD", label: "Наруж. диам. пред. колонны", unit: "мм", required: false },
  { key: "ckodDepth", label: "Глубина ЦКОД", unit: "м", required: true },
  { key: "cementRiseHeight", label: "Высота подъёма цемента", unit: "м", required: true },
  { key: "cavernCoeff", label: "Коэф. кавернозности", unit: "", required: false },
  { key: "bottomTempStatic", label: "BHST", unit: "°C", required: false },
  { key: "bottomTempCirc", label: "BHCT", unit: "°C", required: false },
];

export default function WellDataExtractionDialog({ open, onClose, extractedData, onConfirm }: Props) {
  const [wellValues, setWellValues] = useState<Record<string, number>>(() => {
    const vals: Record<string, number> = {};
    const wd = extractedData.wellData || {};
    wellFields.forEach(f => {
      const v = (wd as any)[f.key];
      vals[f.key] = typeof v === "number" ? v : (f.key === "cavernCoeff" ? 1.1 : 0);
    });
    return vals;
  });

  const [df, setDf] = useState(() => ({
    name: extractedData.drillingFluid?.name || "",
    density: extractedData.drillingFluid?.density || 0,
    pv: extractedData.drillingFluid?.pv || 0,
    yp: extractedData.drillingFluid?.yp || 0,
    fluidLoss: extractedData.drillingFluid?.fluidLoss || 0,
  }));

  const [slurries, setSlurries] = useState(() => {
    const raw = extractedData.slurries || [];
    if (raw.length === 0) return [{
      name: "", density: 0, topDepthMD: 0, waterRatio: 0.5, yieldPerTon: 0.63,
      thickeningTime30Bc: 0, thickeningTime50Bc: 0, flowRateLps: 0, pv: 0, yp: 0,
    }];
    return raw.map(s => ({
      name: s.name || "",
      density: s.density || 0,
      topDepthMD: s.topDepthMD || 0,
      waterRatio: s.waterRatio || 0.5,
      yieldPerTon: s.yieldPerTon || 0.63,
      thickeningTime30Bc: s.thickeningTime30Bc || 0,
      thickeningTime50Bc: s.thickeningTime50Bc || 0,
      flowRateLps: s.flowRateLps || 0,
      pv: s.pv || 0,
      yp: s.yp || 0,
    }));
  });

  const [bufs, setBufs] = useState(() => {
    const raw = extractedData.buffers || [];
    return raw.map(b => ({
      name: b.name || "Буфер",
      density: b.density || 1000,
      volume: b.volume || 0,
      flowRateLps: b.flowRateLps || 0,
    }));
  });

  const [dispFluid, setDispFluid] = useState(() => ({
    name: extractedData.displacementFluid?.name || "Продавочная жидкость",
    density: extractedData.displacementFluid?.density || 0,
    flowRateLps: extractedData.displacementFluid?.flowRateLps || 0,
  }));

  const missingRequired = useMemo(() => {
    return wellFields
      .filter(f => f.required && (!wellValues[f.key] || wellValues[f.key] === 0))
      .map(f => f.label);
  }, [wellValues]);

  const extractedCount = useMemo(() => {
    return wellFields.filter(f => {
      const v = (extractedData.wellData as any)?.[f.key];
      return typeof v === "number" && v > 0;
    }).length;
  }, [extractedData]);

  const handleConfirm = () => {
    const wd: WellData = {
      wellDepthMD: wellValues.wellDepthMD || 0,
      wellDepthTVD: wellValues.wellDepthTVD || wellValues.wellDepthMD || 0,
      casingDepthMD: wellValues.casingDepthMD || 0,
      holeDiameter: wellValues.holeDiameter || 0,
      casingOD: wellValues.casingOD || 0,
      casingWall: wellValues.casingWall || 0,
      prevCasingDepth: wellValues.prevCasingDepth || 0,
      prevCasingID: wellValues.prevCasingID || 0,
      prevCasingOD: wellValues.prevCasingOD || 0,
      ckodDepth: wellValues.ckodDepth || 0,
      cementRiseHeight: wellValues.cementRiseHeight || 0,
      cavernCoeff: wellValues.cavernCoeff || 1.1,
      bottomTempStatic: wellValues.bottomTempStatic || 0,
      bottomTempCirc: wellValues.bottomTempCirc || 0,
      trajectory: [],
    };

    const drillingFluid: DrillingFluid = {
      name: df.name,
      density: df.density,
      rheology: { pv: df.pv, yp: df.yp },
      fluidLoss: df.fluidLoss,
    };

    // Calculate annular volumes for slurries
    const casingID = getCasingID(wd.casingOD, wd.casingWall);
    const prevCasingBottom = wd.prevCasingDepth > 0 ? wd.prevCasingDepth : 0;
    const cementTopMD = wd.cementRiseHeight > 0 ? wd.cementRiseHeight : 0;
    const openHoleVolPm = annularVolumePerMeter(wd.holeDiameter, wd.casingOD, 1.0);
    const prevCasingAnnPm = wd.prevCasingID > 0 ? annularVolumePerMeter(wd.prevCasingID, wd.casingOD, 1.0) : 0;
    const cavCoeff = wd.cavernCoeff || 1.1;

    const slurryInputs: SlurryInput[] = slurries.map((s, idx) => {
      const rateLps = s.flowRateLps > 0 ? s.flowRateLps : 10;
      // Calculate slurry volume from annular geometry
      const slurryTop = s.topDepthMD || 0;
      const slurryBottom = idx < slurries.length - 1 ? (slurries[idx + 1].topDepthMD || wd.casingDepthMD) : wd.casingDepthMD;
      let vol = 0;
      // Open hole portion
      const ohTop = Math.max(slurryTop, prevCasingBottom);
      const ohBot = Math.min(slurryBottom, wd.casingDepthMD);
      if (ohBot > ohTop) vol += openHoleVolPm * (ohBot - ohTop) * cavCoeff;
      // Previous casing portion
      const pcTop = Math.max(slurryTop, cementTopMD);
      const pcBot = Math.min(slurryBottom, prevCasingBottom);
      if (pcBot > pcTop) vol += prevCasingAnnPm * (pcBot - pcTop);
      const slurryVol = parseFloat(vol.toFixed(2));

      return {
        name: s.name,
        density: s.density,
        topDepthMD: s.topDepthMD,
        rheology: { pv: s.pv, yp: s.yp },
        additives: [],
        thickeningTime30Bc: s.thickeningTime30Bc,
        thickeningTime50Bc: s.thickeningTime50Bc,
        flowRateSteps: [{ rateLps, volumeM3: slurryVol }],
        waterRatio: s.waterRatio,
        yieldPerTon: s.yieldPerTon,
      };
    });

    const bufferInputs: BufferFluid[] = bufs.map(b => ({
      name: b.name,
      density: b.density,
      volume: b.volume,
      rheology: { pv: 0, yp: 0 },
      additives: [],
      flowRateSteps: [{ rateLps: b.flowRateLps > 0 ? b.flowRateLps : 10, volumeM3: b.volume }],
    }));

    // Calculate actual displacement volume from pipe geometry
    const dispVolume = totalPipeVolumeForRange(0, wd.ckodDepth || wd.casingDepthMD, wd.casingOD, wd.casingWall);

    const dispRateLps = dispFluid.flowRateLps > 0 ? dispFluid.flowRateLps : 10;
    const dispInputs: DisplacementFluid[] = [{
      name: dispFluid.name,
      density: dispFluid.density || df.density || 1000,
      rheology: { pv: 0, yp: 0 },
      flowRateSteps: [{ rateLps: dispRateLps, volumeM3: parseFloat(dispVolume.toFixed(2)) }],
      compressionCoeff: 1.0,
    }];

    onConfirm(wd, drillingFluid, slurryInputs, bufferInputs, dispInputs);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            📋 Распознанные данные скважины
            {extractedData.wellName && <Badge variant="outline">{extractedData.wellName}</Badge>}
          </DialogTitle>
          <DialogDescription>
            Распознано {extractedCount} из {wellFields.length} параметров скважины.
            {missingRequired.length > 0 && (
              <span className="text-amber-600"> Заполните обязательные поля, отмеченные ⚠️.</span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Well Data */}
          <div>
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">🔧 Скважина</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {wellFields.map(f => {
                const extracted = typeof (extractedData.wellData as any)?.[f.key] === "number" && (extractedData.wellData as any)[f.key] > 0;
                const missing = f.required && (!wellValues[f.key] || wellValues[f.key] === 0);
                return (
                  <div key={f.key} className="space-y-1">
                    <Label className="text-xs flex items-center gap-1">
                      {extracted ? <CheckCircle className="w-3 h-3 text-green-500" /> : missing ? <AlertTriangle className="w-3 h-3 text-amber-500" /> : null}
                      {f.label}{f.unit && `, ${f.unit}`}
                    </Label>
                    <Input
                      type="number"
                      step="any"
                      value={wellValues[f.key] || ""}
                      onChange={e => setWellValues(p => ({ ...p, [f.key]: parseFloat(e.target.value) || 0 }))}
                      className={`h-8 text-sm ${missing ? "border-amber-400" : extracted ? "border-green-400" : ""}`}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Drilling Fluid */}
          <div>
            <h3 className="text-sm font-semibold mb-2">🛢️ Буровой раствор</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Название</Label>
                <Input value={df.name} onChange={e => setDf(p => ({ ...p, name: e.target.value }))} className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Плотность, кг/м³</Label>
                <Input type="number" value={df.density || ""} onChange={e => setDf(p => ({ ...p, density: parseFloat(e.target.value) || 0 }))} className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">PV, сПз</Label>
                <Input type="number" value={df.pv || ""} onChange={e => setDf(p => ({ ...p, pv: parseFloat(e.target.value) || 0 }))} className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">YP, Па</Label>
                <Input type="number" value={df.yp || ""} onChange={e => setDf(p => ({ ...p, yp: parseFloat(e.target.value) || 0 }))} className="h-8 text-sm" />
              </div>
            </div>
          </div>

          {/* Slurries */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">🧪 Тампонажные растворы</h3>
              <Button size="sm" variant="ghost" onClick={() => setSlurries(p => [...p, {
                name: "", density: 0, topDepthMD: 0, waterRatio: 0.5, yieldPerTon: 0.63,
                thickeningTime30Bc: 0, thickeningTime50Bc: 0, flowRateLps: 0, pv: 0, yp: 0,
              }])}>
                <Plus className="w-3 h-3 mr-1" /> Добавить
              </Button>
            </div>
            {slurries.map((s, i) => (
              <div key={i} className="border rounded-lg p-3 mb-2 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">Раствор {i + 1}</span>
                  {slurries.length > 1 && (
                    <Button size="sm" variant="ghost" onClick={() => setSlurries(p => p.filter((_, j) => j !== i))}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { key: "name", label: "Название", type: "text" },
                    { key: "density", label: "Плотность, г/см³", type: "number" },
                    { key: "topDepthMD", label: "Верх цемента, м", type: "number" },
                    { key: "waterRatio", label: "В/Ц", type: "number" },
                    { key: "yieldPerTon", label: "Выход, м³/т", type: "number" },
                    { key: "thickeningTime30Bc", label: "Загуст. 30Bc, мин", type: "number" },
                    { key: "flowRateLps", label: "Расход, л/с", type: "number" },
                  ].map(field => (
                    <div key={field.key} className="space-y-1">
                      <Label className="text-[10px]">{field.label}</Label>
                      <Input
                        type={field.type}
                        step="any"
                        value={(s as any)[field.key] || ""}
                        onChange={e => {
                          const val = field.type === "number" ? parseFloat(e.target.value) || 0 : e.target.value;
                          setSlurries(p => p.map((sl, j) => j === i ? { ...sl, [field.key]: val } : sl));
                        }}
                        className="h-7 text-xs"
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Displacement */}
          <div>
            <h3 className="text-sm font-semibold mb-2">💧 Продавочная жидкость</h3>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Название</Label>
                <Input value={dispFluid.name} onChange={e => setDispFluid(p => ({ ...p, name: e.target.value }))} className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Плотность, кг/м³</Label>
                <Input type="number" value={dispFluid.density || ""} onChange={e => setDispFluid(p => ({ ...p, density: parseFloat(e.target.value) || 0 }))} className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Расход, л/с</Label>
                <Input type="number" value={dispFluid.flowRateLps || ""} onChange={e => setDispFluid(p => ({ ...p, flowRateLps: parseFloat(e.target.value) || 0 }))} className="h-8 text-sm" />
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={handleConfirm} disabled={missingRequired.length > 3}>
            🚀 Составить программу
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
