import { useState, useMemo, useCallback, useRef } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import InputSection from "@/components/InputSection";
import PumpingSchedule from "@/components/PumpingSchedule";
import HydraulicsSection from "@/components/HydraulicsSection";
import MaterialsSection from "@/components/MaterialsSection";
import ChartsSection from "@/components/ChartsSection";
import WellVisualization from "@/components/WellVisualization";
import { calculateVolumes, calculatePressureProfile, calculateMaterials, getSlurryHeight, pipeVolumePerMeter, getCasingID } from "@/lib/cementing-calculations";
import type { WellData, BufferFluid, DrillingFluid, SlurryInput, DisplacementFluid, PressureProfileResult, TrajectoryPoint } from "@/lib/cementing-calculations";
import { captureElementAsDataUrl } from "@/lib/capture-image";
import { FileDown, Loader2 } from "lucide-react";
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
  trajectory: [
    { md: 0, azimuth: 0, zenith: 0, tvd: 0 },
    { md: 410, azimuth: 0, zenith: 0, tvd: 410 },
  ],
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
    compressionCoeff: 1.05,
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
  const [activeTab, setActiveTab] = useState("input");
  const [exporting, setExporting] = useState(false);

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
    () => calcSnapshot && volumes ? calculateMaterials(calcSnapshot.slurries, calcSnapshot.buffers, calcSnapshot.wellData) : null,
    [calcSnapshot, volumes]
  );

  const pressureResult = useMemo(
    () => calcSnapshot && volumes
      ? calculatePressureProfile(calcSnapshot.wellData, calcSnapshot.slurries, calcSnapshot.buffers, calcSnapshot.drillingFluid, calcSnapshot.displacementFluids, calcSnapshot.fractureGradient, volumes.displacementVolume)
      : null,
    [calcSnapshot, volumes]
  );

  const tabOrder = ["input", "hydraulics", "schedule", "materials", "charts", "visual"] as const;
  const tabNames: Record<string, string> = {
    input: "Исходные данные",
    hydraulics: "Гидравлика",
    schedule: "Закачка",
    materials: "Материалы",
    charts: "Графики",
    visual: "Визуал",
  };

  const handleExportDocx = useCallback(async () => {
    setExporting(true);
    try {
      const { exportToDocx } = await import("@/lib/export-docx");
      const snap = calcSnapshot ?? { wellData, drillingFluid, slurries, buffers, displacementFluids, fractureGradient };

      // Capture chart images from the DOM
      const chartImages: Record<string, string> = {};
      const chartSelectors = [
        { key: "combined", index: 1 },
        { key: "bhpVsFrac", index: 2 },
        { key: "volVsPressure", index: 3 },
        { key: "pumpPlan", index: 4 },
        { key: "flowRegime", index: 5 },
      ];
      const chartsTab = document.querySelector('[data-tab-content="charts"]');
      if (chartsTab) {
        const cards = chartsTab.querySelectorAll('.recharts-responsive-container');
        for (const { key, index } of chartSelectors) {
          const container = cards[index - 1]?.parentElement;
          if (container instanceof HTMLElement) {
            try {
              chartImages[key] = await captureElementAsDataUrl(container);
            } catch {}
          }
        }
      }

      // Capture visual images
      const visualImages: Record<string, string> = {};
      const visualTab = document.querySelector('[data-tab-content="visual"]');
      if (visualTab) {
        // 3D canvas
        const canvas3d = visualTab.querySelector('canvas');
        if (canvas3d) {
          try {
            visualImages.well3d = canvas3d.toDataURL('image/png');
          } catch {}
        }
        // Cross-section SVG
        const svgEl = visualTab.querySelector('svg');
        if (svgEl) {
          try {
            const parent = svgEl.parentElement;
            if (parent instanceof HTMLElement) {
              visualImages.crossSection = await captureElementAsDataUrl(parent);
            }
          } catch {}
        }
      }

      const images = (Object.keys(chartImages).length > 0 || Object.keys(visualImages).length > 0)
        ? { chartImages, visualImages } : undefined;

      await exportToDocx(snap.wellData, snap.drillingFluid, snap.slurries, snap.buffers, snap.displacementFluids, snap.fractureGradient, images);
    } catch (e) {
      console.error("DOCX export error:", e);
    } finally {
      setExporting(false);
    }
  }, [calcSnapshot, wellData, drillingFluid, slurries, buffers, displacementFluids, fractureGradient]);

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
          <div className="flex items-center gap-3">
            <button
              onClick={handleExportDocx}
              disabled={exporting}
              className="px-4 py-2.5 rounded-lg bg-secondary text-secondary-foreground font-semibold text-sm hover:bg-secondary/80 transition-colors shadow-md flex items-center gap-2 disabled:opacity-50"
            >
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
              {exporting ? "Экспорт..." : "DOCX"}
            </button>
            <button
              onClick={handleCalculate}
              className="px-6 py-2.5 rounded-lg bg-primary text-primary-foreground font-bold text-sm hover:bg-primary/90 transition-colors shadow-md"
            >
              РАССЧИТАТЬ
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-6 h-auto">
            <TabsTrigger value="input" className="text-xs py-2">Исходные данные</TabsTrigger>
            <TabsTrigger value="hydraulics" className="text-xs py-2">Гидравлика</TabsTrigger>
            <TabsTrigger value="schedule" className="text-xs py-2">Закачка</TabsTrigger>
            <TabsTrigger value="materials" className="text-xs py-2">Материалы</TabsTrigger>
            <TabsTrigger value="charts" className="text-xs py-2">Графики</TabsTrigger>
            <TabsTrigger value="visual" className="text-xs py-2">Визуал</TabsTrigger>
          </TabsList>

          <TabsContent value="input">
            <div data-tab-content="input">
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
            </div>
          </TabsContent>

          <TabsContent value="hydraulics">
            <div data-tab-content="hydraulics">
              {calcSnapshot && volumes ? (
                <HydraulicsSection
                  wellData={calcSnapshot.wellData}
                  slurries={calcSnapshot.slurries}
                  fractureGradient={calcSnapshot.fractureGradient}
                  displacementDensity={calcSnapshot.displacementFluids[0]?.density ?? 1000}
                  workTimeWithCement={pressureResult ? pressureResult.stopTime - pressureResult.cementStartTime : 0}
                  volumes={volumes}
                  displacementFluids={calcSnapshot.displacementFluids}
                  drillingFluid={calcSnapshot.drillingFluid}
                />
              ) : (
                <div className="text-center py-12 text-muted-foreground">Нажмите «РАССЧИТАТЬ» для получения результатов</div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="schedule">
            <div data-tab-content="schedule">
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
            </div>
          </TabsContent>

          <TabsContent value="materials">
            <div data-tab-content="materials">
              {materials ? (
                <MaterialsSection materials={materials} />
              ) : (
                <div className="text-center py-12 text-muted-foreground">Нажмите «РАССЧИТАТЬ» для получения результатов</div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="charts">
            <div data-tab-content="charts">
              {calcSnapshot && pressureResult ? (
                <ChartsSection pressureData={pressureResult.points} safeTime={pressureResult.safeWorkingTimeMin} cementStartTime={pressureResult.cementStartTime} stopTime={pressureResult.stopTime} stageBoundaries={pressureResult.stageBoundaries} equilibriumTimeMin={pressureResult.equilibriumTimeMin} />
              ) : (
                <div className="text-center py-12 text-muted-foreground">Нажмите «РАССЧИТАТЬ» для получения результатов</div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="visual">
            <div data-tab-content="visual">
              <WellVisualization
                wellData={wellData}
                slurries={slurries}
                buffers={buffers}
                drillingFluid={drillingFluid}
                displacementFluids={displacementFluids}
              />
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}