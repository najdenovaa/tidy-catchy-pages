import { useState, useMemo } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import InputSection from "@/components/InputSection";
import PumpingSchedule, { getWorkTimeWithCement } from "@/components/PumpingSchedule";
import HydraulicsSection from "@/components/HydraulicsSection";
import MaterialsSection from "@/components/MaterialsSection";
import ChartsSection from "@/components/ChartsSection";
import { calculateVolumes, calculatePressureProfile, calculateMaterials } from "@/lib/cementing-calculations";
import type { WellData, BufferFluid, DrillingFluid, SlurryInput } from "@/lib/cementing-calculations";

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
  shoeLength: 8,
  sumpLength: 2,
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
    height: 410,
    rheology: { pv: 80, yp: 20 },
    additives: [
      { name: "Atren Cem Premium", percentage: 0.25, massKg: 28 },
      { name: "CaCl2", percentage: 2.0, massKg: 220 },
    ],
    thickeningTime30Bc: 224,
    thickeningTime50Bc: 232,
  },
];

const defaultBuffers: BufferFluid[] = [
  {
    name: "Отмывающий буфер",
    density: 1030,
    volume: 4.0,
    rheology: { pv: 1, yp: 0 },
    additives: [{ name: "Atren Spacer WP", percentage: 0, massKg: 40 }],
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
  },
];

export default function Index() {
  const [wellData, setWellData] = useState<WellData>(defaultWellData);
  const [drillingFluid, setDrillingFluid] = useState<DrillingFluid>(defaultDrillingFluid);
  const [slurries, setSlurries] = useState<SlurryInput[]>(defaultSlurries);
  const [buffers, setBuffers] = useState<BufferFluid[]>(defaultBuffers);
  const [fractureGradient, setFractureGradient] = useState(17.7);
  const [flowRate, setFlowRate] = useState(0.4);
  const [displacementDensity, setDisplacementDensity] = useState(1010);

  const volumes = useMemo(() => calculateVolumes(wellData), [wellData]);

  const workTimeWithCement = useMemo(
    () => getWorkTimeWithCement(buffers, slurries, volumes.annularVolumePerMeter, volumes.displacementVolume, flowRate),
    [buffers, slurries, volumes.annularVolumePerMeter, volumes.displacementVolume, flowRate]
  );

  const materials = useMemo(
    () => calculateMaterials(slurries, buffers, volumes.annularVolumePerMeter),
    [slurries, buffers, volumes.annularVolumePerMeter]
  );

  const pressureData = useMemo(
    () => calculatePressureProfile(wellData, slurries, buffers, drillingFluid, fractureGradient, flowRate, volumes.displacementVolume),
    [wellData, slurries, buffers, drillingFluid, fractureGradient, flowRate, volumes.displacementVolume]
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-sm">ЦП</span>
          </div>
          <div>
            <h1 className="text-base font-bold text-foreground leading-tight">Программа цементирования</h1>
            <p className="text-xs text-muted-foreground">Расчёт обсадных колонн</p>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        <Tabs defaultValue="input" className="space-y-6">
          <TabsList className="grid w-full grid-cols-5 h-auto">
            <TabsTrigger value="input" className="text-xs py-2">Исходные данные</TabsTrigger>
            <TabsTrigger value="hydraulics" className="text-xs py-2">Гидравлика</TabsTrigger>
            <TabsTrigger value="schedule" className="text-xs py-2">Закачка</TabsTrigger>
            <TabsTrigger value="materials" className="text-xs py-2">Материалы</TabsTrigger>
            <TabsTrigger value="charts" className="text-xs py-2">Графики</TabsTrigger>
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
              fractureGradient={fractureGradient}
              onFractureGradientChange={setFractureGradient}
              flowRate={flowRate}
              onFlowRateChange={setFlowRate}
              displacementDensity={displacementDensity}
              onDisplacementDensityChange={setDisplacementDensity}
            />
          </TabsContent>

          <TabsContent value="hydraulics">
            <HydraulicsSection
              wellData={wellData}
              slurries={slurries}
              fractureGradient={fractureGradient}
              displacementDensity={displacementDensity}
              workTimeWithCement={workTimeWithCement}
              volumes={volumes}
            />
          </TabsContent>

          <TabsContent value="schedule">
            <PumpingSchedule
              buffers={buffers}
              slurries={slurries}
              annularVPM={volumes.annularVolumePerMeter}
              displacementVolume={volumes.displacementVolume}
              flowRate={flowRate}
            />
          </TabsContent>

          <TabsContent value="materials">
            <MaterialsSection materials={materials} />
          </TabsContent>

          <TabsContent value="charts">
            <ChartsSection pressureData={pressureData} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
