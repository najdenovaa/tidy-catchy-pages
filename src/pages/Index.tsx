import { useState, useMemo } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import WellDataForm from "@/components/WellDataForm";
import VolumeResults from "@/components/VolumeResults";
import DrillingFluidSection from "@/components/DrillingFluidSection";
import CementSection from "@/components/CementSection";
import HydraulicsSection from "@/components/HydraulicsSection";
import BufferSection from "@/components/BufferSection";
import PumpingSchedule from "@/components/PumpingSchedule";
import ChartsSection from "@/components/ChartsSection";
import { calculateVolumes, calculatePressureProfile } from "@/lib/cementing-calculations";
import type { WellData, BufferFluid, DrillingFluid, SlurryInput } from "@/lib/cementing-calculations";

const defaultWellData: WellData = {
  wellDepthMD: 3202.3,
  wellDepthTVD: 3200,
  casingDepthMD: 3197,
  holeDiameter: 220.7,
  casingOD: 168,
  casingWall: 8.9,
  prevCasingDepth: 1570.9,
  prevCasingID: 223.8,
  ckodDepth: 3186,
  cementRiseHeight: 2300,
  cavernCoeff: 1.1,
  bottomTemp: 82,
  maxAngle: 1.3,
  maxAngleDepth: 2675,
};

const defaultDrillingFluid: DrillingFluid = {
  name: "Буровой раствор",
  density: 1.16,
  rheology: { pv: 15, yp: 5 },
};

const defaultSlurries: SlurryInput[] = [
  { name: "Облегчённый (ЦТОС-4-АРМ)", density: 1.36, height: 0, rheology: { pv: 50, yp: 15 } },
  { name: "Тяжёлый (ПЦТI-G-CC-1)", density: 1.92, height: 2300, rheology: { pv: 80, yp: 20 } },
];

const defaultBuffers: BufferFluid[] = [
  { name: "PetroWasher 1", density: 1001, volume: 3.0, rheology: { pv: 1, yp: 0 } },
  { name: "PetroCemBuff 1", density: 1350, volume: 5.0, rheology: { pv: 5, yp: 2 } },
];

export default function Index() {
  const [wellData, setWellData] = useState<WellData>(defaultWellData);
  const [drillingFluid, setDrillingFluid] = useState<DrillingFluid>(defaultDrillingFluid);
  const [slurries, setSlurries] = useState<SlurryInput[]>(defaultSlurries);
  const [buffers, setBuffers] = useState<BufferFluid[]>(defaultBuffers);
  const [fractureGradient, setFractureGradient] = useState(17.7);
  const [flowRate, setFlowRate] = useState(0.9);

  const volumes = useMemo(() => calculateVolumes(wellData), [wellData]);

  const pressureData = useMemo(() =>
    calculatePressureProfile(wellData, slurries, buffers, drillingFluid, fractureGradient, flowRate, volumes.displacementVolume),
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
            <h1 className="text-base font-bold text-foreground leading-tight">Расчёт программы цементирования</h1>
            <p className="text-xs text-muted-foreground">Калькулятор обсадных колонн</p>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        <Tabs defaultValue="input" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4 lg:grid-cols-8 h-auto">
            <TabsTrigger value="input" className="text-xs py-2">Исходные</TabsTrigger>
            <TabsTrigger value="mud" className="text-xs py-2">Бур. раствор</TabsTrigger>
            <TabsTrigger value="volumes" className="text-xs py-2">Объёмы</TabsTrigger>
            <TabsTrigger value="cement" className="text-xs py-2">Цемент</TabsTrigger>
            <TabsTrigger value="buffers" className="text-xs py-2">Буферы</TabsTrigger>
            <TabsTrigger value="hydraulics" className="text-xs py-2">Гидравлика</TabsTrigger>
            <TabsTrigger value="schedule" className="text-xs py-2">Закачка</TabsTrigger>
            <TabsTrigger value="charts" className="text-xs py-2">Графики</TabsTrigger>
          </TabsList>

          <TabsContent value="input">
            <WellDataForm data={wellData} onChange={setWellData} />
          </TabsContent>

          <TabsContent value="mud">
            <DrillingFluidSection fluid={drillingFluid} onChange={setDrillingFluid} />
          </TabsContent>

          <TabsContent value="volumes">
            <VolumeResults results={volumes} />
          </TabsContent>

          <TabsContent value="cement">
            <CementSection slurries={slurries} onChange={setSlurries} annularVPM={volumes.annularVolumePerMeter} />
          </TabsContent>

          <TabsContent value="buffers">
            <BufferSection buffers={buffers} onChange={setBuffers} annularVPM={volumes.annularVolumePerMeter} flowRate={flowRate} onFlowRateChange={setFlowRate} />
          </TabsContent>

          <TabsContent value="hydraulics">
            <HydraulicsSection wellData={wellData} slurries={slurries} fractureGradient={fractureGradient} onFractureGradientChange={setFractureGradient} />
          </TabsContent>

          <TabsContent value="schedule">
            <PumpingSchedule buffers={buffers} slurries={slurries} annularVPM={volumes.annularVolumePerMeter} displacementVolume={volumes.displacementVolume} flowRate={flowRate} />
          </TabsContent>

          <TabsContent value="charts">
            <ChartsSection pressureData={pressureData} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
