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

  const handleExportPDF = useCallback(async () => {
    setExporting(true);
    try {
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
        import("jspdf"),
        import("html2canvas"),
      ]);

      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 8;
      const contentW = pageW - margin * 2;

      const prevTab = activeTab;
      const exportTabs = tabOrder.filter(t => t !== "visual");

      let isFirstPage = true;

      for (let t = 0; t < exportTabs.length; t++) {
        const tab = exportTabs[t];

        // Switch tab and wait for render (charts need time)
        setActiveTab(tab);
        await new Promise(r => setTimeout(r, 1500));

        const tabContent = document.querySelector(`[data-tab-content="${tab}"]`) as HTMLElement;
        if (!tabContent || tabContent.offsetHeight === 0) continue;

        // Temporarily inject a header into the DOM for capture
        const header = document.createElement("div");
        header.style.cssText = "padding:16px 0 12px;border-bottom:2px solid #555;margin-bottom:16px;font-family:sans-serif;";
        header.innerHTML = `<div style="font-size:20px;font-weight:700;color:#e0e0e0;">Программа цементирования</div><div style="font-size:14px;color:#aaa;margin-top:4px;">${tabNames[tab]}</div>`;
        tabContent.prepend(header);

        // Also inject page number footer
        const footer = document.createElement("div");
        footer.style.cssText = "text-align:right;padding-top:12px;border-top:1px solid #444;margin-top:16px;font-size:11px;color:#888;font-family:sans-serif;";
        footer.textContent = `Страница ${t + 1} из ${exportTabs.length}`;
        tabContent.appendChild(footer);

        await new Promise(r => setTimeout(r, 200));

        const canvas = await html2canvas(tabContent, {
          scale: 2,
          useCORS: true,
          backgroundColor: "#1a1a2e",
          logging: false,
          windowWidth: 1200,
        });

        // Remove injected elements
        header.remove();
        footer.remove();

        const imgData = canvas.toDataURL("image/png");
        const imgRatio = canvas.height / canvas.width;
        const imgW = contentW;
        const imgH = imgW * imgRatio;

        const availH = pageH - margin * 2;

        if (!isFirstPage) pdf.addPage();
        isFirstPage = false;

        if (imgH <= availH) {
          pdf.addImage(imgData, "PNG", margin, margin, imgW, imgH);
        } else {
          // Split into multiple pages
          const pxPerMM = canvas.width / contentW;
          const sliceHpx = availH * pxPerMM;
          let srcY = 0;
          let firstSlice = true;

          while (srcY < canvas.height) {
            if (!firstSlice) pdf.addPage();

            const remaining = canvas.height - srcY;
            const thisSlice = Math.min(sliceHpx, remaining);

            const sliceCanvas = document.createElement("canvas");
            sliceCanvas.width = canvas.width;
            sliceCanvas.height = thisSlice;
            const ctx = sliceCanvas.getContext("2d");
            if (ctx) {
              ctx.drawImage(canvas, 0, srcY, canvas.width, thisSlice, 0, 0, canvas.width, thisSlice);
              const sliceImg = sliceCanvas.toDataURL("image/png");
              const sliceHmm = thisSlice / pxPerMM;
              pdf.addImage(sliceImg, "PNG", margin, margin, imgW, sliceHmm);
            }
            srcY += thisSlice;
            firstSlice = false;
          }
        }
      }

      setActiveTab(prevTab);
      pdf.save("cementing-program.pdf");
    } catch (e) {
      console.error("PDF export error:", e);
    } finally {
      setExporting(false);
    }
  }, [activeTab, calcSnapshot]);

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
              onClick={handleExportPDF}
              disabled={exporting}
              className="px-4 py-2.5 rounded-lg bg-secondary text-secondary-foreground font-semibold text-sm hover:bg-secondary/80 transition-colors shadow-md flex items-center gap-2 disabled:opacity-50"
            >
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
              {exporting ? "Экспорт..." : "PDF"}
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