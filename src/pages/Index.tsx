import { useState, useMemo, useCallback } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import InputSection from "@/components/InputSection";
import PumpingSchedule from "@/components/PumpingSchedule";
import HydraulicsSection from "@/components/HydraulicsSection";
import MaterialsSection from "@/components/MaterialsSection";
import ChartsSection from "@/components/ChartsSection";
import WellVisualization from "@/components/WellVisualization";
import { calculateVolumes, calculatePressureProfile, calculateMaterials, getSlurryHeight, pipeVolumePerMeter, getCasingID } from "@/lib/cementing-calculations";
import type { WellData, BufferFluid, DrillingFluid, SlurryInput, DisplacementFluid } from "@/lib/cementing-calculations";

const defaultWellData: WellData = {
  wellDepthMD: 410,
  wellDepthTVD: 410,
  casingDepthMD: 408,
  holeDiameter: 215.9,
  casingOD: 168,
  casingWall: 8.94,
  prevCasingDepth: 41,
  prevCasingOD: 244.5,
  prevCasingID: 222.3,
  ckodDepth: 400,
  cementRiseHeight: 410,
  cavernCoeff: 1.2,
  bottomTempStatic: 10,
  bottomTempCirc: 18,
};

const defaultDrillingFluid: DrillingFluid = {
  name: "Полимерглинистый",
  density: 1100,
  rheology: { pv: 25, yp: 18 },
  fluidLoss: 10,
};

const defaultSlurries: SlurryInput[] = [
  {
    name: "ЦР (ПЦТ-I-50)",
    density: 1.82,
    topDepthMD: 0,
    rheology: { pv: 80, yp: 20 },
    additives: [
      { name: "Atren Cem Premium", percentage: 0.25, massKg: 28 },
      { name: "CaCl2", percentage: 2.0, massKg: 220 },
    ],
    thickeningTime30Bc: 224,
    thickeningTime50Bc: 232,
    flowRateSteps: [{ rateLps: 7, volumeM3: 0 }],
    waterRatio: 0.536,
    yieldPerTon: 0.63,
  },
];

const defaultBuffers: BufferFluid[] = [
  {
    name: "Отмывающий буфер",
    density: 1030,
    volume: 4.0,
    rheology: { pv: 1, yp: 0 },
    additives: [{ name: "Atren Spacer WP", percentage: 0, massKg: 40 }],
    flowRateSteps: [{ rateLps: 5, volumeM3: 4.0 }],
  },
  {
    name: "Реологический буфер",
    density: 1350,
    volume: 4.0,
    rheology: { pv: 5, yp: 2 },
    additives: [
      { name: "ПЦТ-I-50", percentage: 0, massKg: 2100 },
      { name: "Atren Cem Premium", percentage: 0, massKg: 5 },
      { name: "CaCl2", percentage: 0, massKg: 42 },
    ],
    flowRateSteps: [{ rateLps: 5, volumeM3: 4.0 }],
  },
];

const defaultDisplacementFluids: DisplacementFluid[] = [
  {
    name: "Продавочная жидкость",
    density: 1010,
    rheology: { pv: 1, yp: 0 },
    flowRateSteps: [
      { rateLps: 12, volumeM3: 0 },
      { rateLps: 8, volumeM3: 0 },
      { rateLps: 4, volumeM3: 0 },
    ],
  },
];

interface CalcSnapshot {
  wellData: WellData;
  drillingFluid: DrillingFluid;
  slurries: SlurryInput[];
  buffers: BufferFluid[];
  displacementFluids: DisplacementFluid[];
  fractureGradient: number;
}

export default function Index() {
  const [wellData, setWellData] = useState<WellData>(defaultWellData);
  const [drillingFluid, setDrillingFluid] = useState<DrillingFluid>(defaultDrillingFluid);
  const [slurries, setSlurries] = useState<SlurryInput[]>(defaultSlurries);
  const [buffers, setBuffers] = useState<BufferFluid[]>(defaultBuffers);
  const [displacementFluids, setDisplacementFluids] = useState<DisplacementFluid[]>(defaultDisplacementFluids);
  const [fractureGradient, setFractureGradient] = useState(17.7);

  const liveDispVol = useMemo(() => {
    const cid = getCasingID(wellData.casingOD, wellData.casingWall);
    return pipeVolumePerMeter(cid) * wellData.ckodDepth;
  }, [wellData.casingOD, wellData.casingWall, wellData.ckodDepth]);

  const [calcSnapshot, setCalcSnapshot] = useState<CalcSnapshot | null>(null);

  const handleCalculate = useCallback(() => {
    setCalcSnapshot({ wellData, drillingFluid, slurries, buffers, displacementFluids, fractureGradient });
  }, [wellData, drillingFluid, slurries, buffers, displacementFluids, fractureGradient]);

  const volumes = useMemo(() => calcSnapshot ? calculateVolumes(calcSnapshot.wellData) : null, [calcSnapshot]);

  const materials = useMemo(
    () => calcSnapshot && volumes ? calculateMaterials(calcSnapshot.slurries, calcSnapshot.buffers, volumes.annularVolumePerMeter, calcSnapshot.wellData.casingDepthMD) : null,
    [calcSnapshot, volumes]
  );

  const pressureData = useMemo(
    () => calcSnapshot && volumes
      ? calculatePressureProfile(calcSnapshot.wellData, calcSnapshot.slurries, calcSnapshot.buffers, calcSnapshot.drillingFluid, calcSnapshot.fractureGradient, 0.48, volumes.displacementVolume)
      : [],
    [calcSnapshot, volumes]
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">ЦП</span>
            </div>
            <div>
              <h1 className="text-base font-bold text-foreground leading-tight">Программа цементирования</h1>
              <p className="text-xs text-muted-foreground">Расчёт обсадных колонн</p>
            </div>
          </div>
          <button
            onClick={handleCalculate}
            className="px-6 py-2.5 rounded-lg bg-primary text-primary-foreground font-bold text-sm hover:bg-primary/90 transition-colors shadow-md"
          >
            РАССЧИТАТЬ
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        <Tabs defaultValue="input" className="space-y-6">
          <TabsList className="grid w-full grid-cols-6 h-auto">
            <TabsTrigger value="input" className="text-xs py-2">Исходные данные</TabsTrigger>
            <TabsTrigger value="hydraulics" className="text-xs py-2">Гидравлика</TabsTrigger>
            <TabsTrigger value="schedule" className="text-xs py-2">Закачка</TabsTrigger>
            <TabsTrigger value="materials" className="text-xs py-2">Материалы</TabsTrigger>
            <TabsTrigger value="charts" className="text-xs py-2">Графики</TabsTrigger>
            <TabsTrigger value="visual" className="text-xs py-2">Визуал</TabsTrigger>
          </TabsList>

          <TabsContent value="input">
            <InputSection
              wellData={wellData}
              onWellDataChange={setWellData}
              drillingFluid={drillingFluid}
              onDrillingFluidChange={setDrillingFluid}
              buffers={buffers}
              onBuffersChange={setBuffers}
              slurries={slurries}
              onSlurriesChange={setSlurries}
              displacementFluids={displacementFluids}
              onDisplacementFluidsChange={setDisplacementFluids}
              displacementVolume={liveDispVol}
              fractureGradient={fractureGradient}
              onFractureGradientChange={setFractureGradient}
            />
          </TabsContent>

          <TabsContent value="hydraulics">
            {calcSnapshot && volumes ? (
              <HydraulicsSection
                wellData={calcSnapshot.wellData}
                slurries={calcSnapshot.slurries}
                fractureGradient={calcSnapshot.fractureGradient}
                displacementDensity={calcSnapshot.displacementFluids[0]?.density ?? 1000}
                workTimeWithCement={0}
                volumes={volumes}
              />
            ) : (
              <div className="text-center py-12 text-muted-foreground">Нажмите «РАССЧИТАТЬ» для получения результатов</div>
            )}
          </TabsContent>

          <TabsContent value="schedule">
            {calcSnapshot && volumes ? (
              <PumpingSchedule
                buffers={calcSnapshot.buffers}
                slurries={calcSnapshot.slurries}
                annularVPM={volumes.annularVolumePerMeter}
                displacementVolume={volumes.displacementVolume}
                displacementFluids={calcSnapshot.displacementFluids}
                casingDepthMD={calcSnapshot.wellData.casingDepthMD}
              />
            ) : (
              <div className="text-center py-12 text-muted-foreground">Нажмите «РАССЧИТАТЬ» для получения результатов</div>
            )}
          </TabsContent>

          <TabsContent value="materials">
            {materials ? (
              <MaterialsSection materials={materials} />
            ) : (
              <div className="text-center py-12 text-muted-foreground">Нажмите «РАССЧИТАТЬ» для получения результатов</div>
            )}
          </TabsContent>

          <TabsContent value="charts">
            {calcSnapshot ? (
              <ChartsSection pressureData={pressureData} />
            ) : (
              <div className="text-center py-12 text-muted-foreground">Нажмите «РАССЧИТАТЬ» для получения результатов</div>
            )}
          </TabsContent>

          <TabsContent value="visual">
            <WellVisualization
              wellData={wellData}
              slurries={slurries}
              buffers={buffers}
              drillingFluid={drillingFluid}
            />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}