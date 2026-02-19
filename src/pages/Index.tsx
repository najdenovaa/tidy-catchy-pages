import { useState, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import InputSection from "@/components/InputSection";
import PumpingSchedule from "@/components/PumpingSchedule";
import HydraulicsSection from "@/components/HydraulicsSection";
import MaterialsSection from "@/components/MaterialsSection";
import ChartsSection from "@/components/ChartsSection";
import WellVisualization from "@/components/WellVisualization";
import CentralizationSection from "@/components/CentralizationSection";
import type { CentralizationResult } from "@/lib/centralization-calculations";
import { calculateVolumes, calculatePressureProfile, calculateMaterials, pipeVolumePerMeter, getCasingID } from "@/lib/cementing-calculations";
import type { WellData, BufferFluid, DrillingFluid, SlurryInput, DisplacementFluid } from "@/lib/cementing-calculations";
import { captureElementAsDataUrl } from "@/lib/capture-image";
import { FileDown, Loader2, Send, Home, RotateCcw } from "lucide-react";
import deallsoftLogo from "@/assets/deallsoft-logo.png";
import drillingBanner from "@/assets/drilling-banner.jpg";
import { useCementingSession } from "@/hooks/use-cementing-session";
import { useEffect, useRef } from "react";

interface CalcSnapshot {
  wellData: WellData;
  drillingFluid: DrillingFluid;
  slurries: SlurryInput[];
  buffers: BufferFluid[];
  displacementFluids: DisplacementFluid[];
  fractureGradient: number;
  flushTimeMin: number;
  flushVolumeM3: number;
}

export default function Index() {
  const {
    wellData, setWellData,
    drillingFluid, setDrillingFluid,
    slurries, setSlurries,
    buffers, setBuffers,
    displacementFluids, setDisplacementFluids,
    fractureGradient, setFractureGradient,
    flushTimeMin, setFlushTimeMin,
    flushVolumeM3, setFlushVolumeM3,
    resetSession,
  } = useCementingSession();

  const [activeTab, setActiveTab] = useState("input");
  const [exporting, setExporting] = useState(false);
  const [centralizationResults, setCentralizationResults] = useState<CentralizationResult[] | null>(null);

  // Persistent counters from backend
  const [visitCount, setVisitCount] = useState<number>(0);
  const [calcCount, setCalcCount] = useState<number>(0);

  const fetchStats = useCallback(() => {
    fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-stats`, {
      headers: { Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
    })
      .then(r => r.json())
      .then(data => {
        setVisitCount(data.visits ?? 0);
        setCalcCount(data.calculations ?? 0);
      })
      .catch(() => {});
  }, []);

  // Log visit and fetch stats
  useEffect(() => {
    fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/log-activity`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
      body: JSON.stringify({ type: "visit", module: "cementing", page_url: window.location.href }),
    }).then(() => fetchStats()).catch(() => {});
    fetchStats();
  }, [fetchStats]);

  const liveDispVol = useMemo(() => {
    const cid = getCasingID(wellData.casingOD, wellData.casingWall);
    return pipeVolumePerMeter(cid) * wellData.ckodDepth;
  }, [wellData.casingOD, wellData.casingWall, wellData.ckodDepth]);

  const [calcSnapshot, setCalcSnapshot] = useState<CalcSnapshot | null>(null);

  const handleCalculate = useCallback(() => {
    setCalcSnapshot({ wellData, drillingFluid, slurries, buffers, displacementFluids, fractureGradient, flushTimeMin, flushVolumeM3 });
    setCalcCount(prev => prev + 1);
    // Log calculation to backend
    fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/log-activity`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
      body: JSON.stringify({
        type: "calculation",
        module: "cementing",
        well_data: wellData,
        calc_params: { slurries, buffers, displacementFluids, fractureGradient, flushTimeMin, flushVolumeM3 },
        page_url: window.location.href,
      }),
    }).catch(() => {});
  }, [wellData, drillingFluid, slurries, buffers, displacementFluids, fractureGradient, flushTimeMin, flushVolumeM3]);

  const volumes = useMemo(() => calcSnapshot ? calculateVolumes(calcSnapshot.wellData) : null, [calcSnapshot]);

  const materials = useMemo(
    () => calcSnapshot && volumes ? calculateMaterials(calcSnapshot.slurries, calcSnapshot.buffers, calcSnapshot.wellData) : null,
    [calcSnapshot, volumes]
  );

  const pressureResult = useMemo(
    () => calcSnapshot && volumes
      ? calculatePressureProfile(calcSnapshot.wellData, calcSnapshot.slurries, calcSnapshot.buffers, calcSnapshot.drillingFluid, calcSnapshot.displacementFluids, calcSnapshot.fractureGradient, volumes.displacementVolume, calcSnapshot.flushTimeMin, calcSnapshot.flushVolumeM3)
      : null,
    [calcSnapshot, volumes]
  );

  const tabOrder = ["input", "hydraulics", "schedule", "materials", "charts", "visual", "centralization"] as const;
  const tabNames: Record<string, string> = {
    input: "Исходные данные",
    hydraulics: "Гидравлика",
    schedule: "Закачка",
    materials: "Материалы",
    charts: "Графики",
    visual: "Визуал",
    centralization: "Центрирование",
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
        // Cross-section SVG — serialize to data URL directly
        const svgEls = visualTab.querySelectorAll('svg');
        if (svgEls[0]) {
          try {
            const svgEl = svgEls[0] as SVGSVGElement;
            // Get dimensions from viewBox, attributes, or fallback
            const vb = svgEl.viewBox?.baseVal;
            const svgW = (vb && vb.width > 0) ? vb.width : (svgEl.clientWidth || parseInt(svgEl.getAttribute('width') || '800') || 800);
            const svgH = (vb && vb.height > 0) ? vb.height : (svgEl.clientHeight || parseInt(svgEl.getAttribute('height') || '1000') || 1000);

            // Clone SVG and ensure it has proper attributes for rendering
            const clonedSvg = svgEl.cloneNode(true) as SVGSVGElement;
            clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
            if (!clonedSvg.getAttribute('width')) clonedSvg.setAttribute('width', String(svgW));
            if (!clonedSvg.getAttribute('height')) clonedSvg.setAttribute('height', String(svgH));
            if (!clonedSvg.getAttribute('viewBox')) clonedSvg.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`);

            const serializer = new XMLSerializer();
            const svgStr = serializer.serializeToString(clonedSvg);
            const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(svgBlob);
            const img = new Image();
            const canvasW = svgW * 2;
            const canvasH = svgH * 2;
            await new Promise<void>((resolve, reject) => {
              img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = canvasW;
                canvas.height = canvasH;
                const ctx = canvas.getContext('2d');
                if (ctx) {
                  ctx.fillStyle = '#1a1a2e';
                  ctx.fillRect(0, 0, canvasW, canvasH);
                  ctx.drawImage(img, 0, 0, canvasW, canvasH);
                  visualImages.crossSection = canvas.toDataURL('image/png');
                }
                URL.revokeObjectURL(url);
                resolve();
              };
              img.onerror = () => { URL.revokeObjectURL(url); reject(); };
              img.src = url;
            });
          } catch {}
        }
        // Displacement efficiency canvas (second canvas after 3D)
        const allCanvases = visualTab.querySelectorAll('canvas');
        if (allCanvases.length > 1) {
          try {
            visualImages.displacementEfficiency = allCanvases[1].toDataURL('image/png');
          } catch {}
        }
      }

      // Capture centralization images
      const centralizationImages: Record<string, string> = {};
      const centTab = document.querySelector('[data-tab-content="centralization"]');
      if (centTab) {
        const cards = centTab.querySelectorAll('[class*="Card"], .rounded-lg');
        // Cross-section card
        const crossSectionEl = centTab.querySelector('[class*="flex-col"][class*="sm\\:flex-row"]')?.parentElement;
        if (crossSectionEl instanceof HTMLElement) {
          try { centralizationImages.crossSection = await captureElementAsDataUrl(crossSectionEl); } catch {}
        }
        // Standoff profile - bar chart container
        const barChartEl = centTab.querySelector('.h-40');
        if (barChartEl?.parentElement instanceof HTMLElement) {
          try { centralizationImages.standoffProfile = await captureElementAsDataUrl(barChartEl.parentElement as HTMLElement); } catch {}
        }
        // No longer capturing table as image - passing data directly
      }

      const images = (Object.keys(chartImages).length > 0 || Object.keys(visualImages).length > 0 || Object.keys(centralizationImages).length > 0)
        ? { chartImages, visualImages, centralizationImages } : undefined;

      await exportToDocx(snap.wellData, snap.drillingFluid, snap.slurries, snap.buffers, snap.displacementFluids, snap.fractureGradient, images, centralizationResults ?? undefined);
    } catch (e) {
      console.error("DOCX export error:", e);
    } finally {
      setExporting(false);
    }
  }, [calcSnapshot, wellData, drillingFluid, slurries, buffers, displacementFluids, fractureGradient]);

  return (
    <div className="bg-background">
      <header className="border-b border-border bg-card sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex flex-col items-center sm:items-start">
            <div className="flex items-center gap-4 text-[10px] text-muted-foreground/70 mb-1">
              <span>👁 Посещений от начала проекта: <span className="font-semibold text-muted-foreground">{visitCount}</span></span>
              <span>🧮 Расчётов от начала проекта: <span className="font-semibold text-muted-foreground">{calcCount}</span></span>
            </div>
              <Link to="/" className="flex items-center gap-3">
                <img
                  src={deallsoftLogo}
                  alt="DeAllsoft"
                  className="h-16 sm:h-28 object-cover object-center"
                />
                <p className="text-lg sm:text-2xl font-normal tracking-tight text-foreground uppercase -mt-1">Инженерные расчёты</p>
              </Link>
            <div className="mt-0.5 sm:ml-10 text-center sm:text-left">
              <h1 className="text-sm sm:text-lg font-medium text-muted-foreground leading-tight">Программа цементирования</h1>
              <p className="text-xs text-muted-foreground/70">Расчёт обсадных колонн</p>
            </div>
          </div>
          <div className="flex items-center sm:flex-col sm:items-end gap-3 sm:gap-6 w-full sm:w-auto">
            <div className="flex items-center gap-3">
              <Link
                to="/"
                className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-xs"
              >
                <Home className="w-4 h-4" />
                <span>Главная</span>
              </Link>
              <a
                href="https://t.me/deallbiz_support"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-xs"
              >
                <Send className="w-4 h-4" />
                <span>Поддержка</span>
              </a>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 flex-1 sm:flex-none justify-end">
              <button
                onClick={() => { resetSession(); setCalcSnapshot(null); setCentralizationResults(null); }}
                title="Обнулить все данные сессии"
                className="px-3 py-2 sm:py-2.5 rounded-lg border border-border text-muted-foreground font-semibold text-xs sm:text-sm hover:bg-destructive/10 hover:text-destructive hover:border-destructive/40 transition-colors shadow-sm flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Обнулить</span>
              </button>
              <button
                onClick={handleExportDocx}
                disabled={exporting}
                className="px-3 sm:px-4 py-2 sm:py-2.5 rounded-lg bg-secondary text-secondary-foreground font-semibold text-xs sm:text-sm hover:bg-secondary/80 transition-colors shadow-md flex items-center gap-1.5 disabled:opacity-50"
              >
                {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
                {exporting ? "..." : "DOCX"}
              </button>
              <button
                onClick={handleCalculate}
                className="px-4 sm:px-6 py-2 sm:py-2.5 rounded-lg bg-primary text-primary-foreground font-bold text-xs sm:text-sm hover:bg-primary/90 transition-colors shadow-md"
              >
                РАССЧИТАТЬ
              </button>
            </div>
          </div>
        </div>
      </header>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="overflow-x-auto scrollbar-hide sticky top-[80px] sm:top-[164px] z-[9] bg-background border-b border-border">
          <div className="max-w-7xl mx-auto px-2 sm:px-4 py-2">
            <TabsList className="inline-flex sm:grid sm:w-full sm:grid-cols-7 h-auto min-w-max sm:min-w-0">
              <TabsTrigger value="input" className="text-xs py-2 px-3 sm:px-1">Данные</TabsTrigger>
              <TabsTrigger value="hydraulics" className="text-xs py-2 px-3 sm:px-1">Гидравлика</TabsTrigger>
              <TabsTrigger value="schedule" className="text-xs py-2 px-3 sm:px-1">Закачка</TabsTrigger>
              <TabsTrigger value="materials" className="text-xs py-2 px-3 sm:px-1">Материалы</TabsTrigger>
              <TabsTrigger value="charts" className="text-xs py-2 px-3 sm:px-1">Графики</TabsTrigger>
              <TabsTrigger value="visual" className="text-xs py-2 px-3 sm:px-1">Визуал</TabsTrigger>
              <TabsTrigger value="centralization" className="text-xs py-2 px-3 sm:px-1">Центрир.</TabsTrigger>
            </TabsList>
          </div>
        </div>

        <main className="max-w-7xl mx-auto px-2 sm:px-4 py-4 sm:py-6 space-y-4 sm:space-y-6">

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
                flushTimeMin={flushTimeMin}
                onFlushTimeMinChange={setFlushTimeMin}
                flushVolumeM3={flushVolumeM3}
                onFlushVolumeM3Change={setFlushVolumeM3}
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

          <div className={activeTab !== "charts" ? "h-0 overflow-hidden" : ""}>
            <TabsContent value="charts" forceMount>
              <div data-tab-content="charts">
                {calcSnapshot && pressureResult ? (
                  <ChartsSection pressureData={pressureResult.points} safeTime={pressureResult.safeWorkingTimeMin} cementStartTime={pressureResult.cementStartTime} stopTime={pressureResult.stopTime} stageBoundaries={pressureResult.stageBoundaries} equilibriumTimeMin={pressureResult.equilibriumTimeMin} />
                ) : (
                  <div className="text-center py-12 text-muted-foreground">Нажмите «РАССЧИТАТЬ» для получения результатов</div>
                )}
              </div>
            </TabsContent>
          </div>

          <div className={activeTab !== "visual" ? "h-0 overflow-hidden" : ""}>
            <TabsContent value="visual" forceMount>
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
          </div>

          <div className={activeTab !== "centralization" ? "h-0 overflow-hidden" : ""}>
            <TabsContent value="centralization" forceMount>
              <div data-tab-content="centralization">
                <CentralizationSection
                  wellData={wellData}
                  mudDensity={drillingFluid.density}
                  onResultsChange={setCentralizationResults}
                />
              </div>
            </TabsContent>
          </div>
        </main>
      </Tabs>

      <footer className="w-full">
        <img
          src={drillingBanner}
          alt="Буровые установки"
          className="w-full h-20 sm:h-28 object-cover object-center opacity-30"
        />
      </footer>
    </div>
  );
}