import { useState, useMemo, useCallback, useEffect } from "react";
import { Link, useSearchParams, useLocation } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import InputSection from "@/components/InputSection";
import PumpingSchedule from "@/components/PumpingSchedule";
import HydraulicsSection from "@/components/HydraulicsSection";
import MaterialsSection from "@/components/MaterialsSection";
import ChartsSection from "@/components/ChartsSection";
import WellVisualization from "@/components/WellVisualization";
import CentralizationSection from "@/components/CentralizationSection";
import TorqueDragSection from "@/components/TorqueDragSection";
import FoamCementSection from "@/components/FoamCementSection";
import CementingAnimation from "@/components/CementingAnimation";
import ContactTimeSection from "@/components/ContactTimeSection";
import CementQualitySection from "@/components/CementQualitySection";
import TrajectorySection from "@/components/TrajectorySection";
import DrillingHydraulicsSection from "@/components/DrillingHydraulicsSection";
import CasingRotationSection from "@/components/CasingRotationSection";
import AnalysisChatPanel from "@/components/AnalysisChatPanel";

import type { CentralizationResult } from "@/lib/centralization-calculations";
import { calculateVolumes, calculatePressureProfile, calculateMaterials, pipeVolumePerMeter, getCasingID } from "@/lib/cementing-calculations";
import type { WellData, BufferFluid, DrillingFluid, SlurryInput, DisplacementFluid } from "@/lib/cementing-calculations";
import { captureElementAsDataUrl } from "@/lib/capture-image";
import { FileDown, Loader2, Send, Home, RotateCcw, Save, LogOut, LayoutDashboard } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import deallsoftLogo from "@/assets/deallsoft-logo.png";
import drillingBanner from "@/assets/drilling-banner.jpg";
import { useCementingSession } from "@/hooks/use-cementing-session";
import { normalizeCementingSnapshot, type CementingSnapshot } from "@/lib/cementing-normalizers";
import TermsFooter from "@/components/TermsFooter";
import SaveToCabinetDialog, { type SaveCalcPayload } from "@/components/SaveToCabinetDialog";

type CalcSnapshot = CementingSnapshot;

export default function Index() {
  const location = useLocation();
  const analysisState = location.state as {
    fromAnalysis?: boolean;
    wellData?: WellData;
    drillingFluid?: DrillingFluid;
    slurries?: SlurryInput[];
    buffers?: BufferFluid[];
    displacementFluids?: DisplacementFluid[];
    sourceDocuments?: string[];
  } | null;
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
  const [centralizerIntervals, setCentralizerIntervals] = useState<import("@/lib/centralization-calculations").CentralizerInterval[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [loadingSavedCalc, setLoadingSavedCalc] = useState(false);
  const [searchParams] = useSearchParams();
  const calcId = searchParams.get("calc");
  const selectedWellId = searchParams.get("well");
  const fromDashboard = searchParams.get("from") === "dashboard";

  // Track if this session came from analysis (for showing chat)
  const [fromAnalysis, setFromAnalysis] = useState(false);
  const [sourceDocuments, setSourceDocuments] = useState<string[]>([]);

  // Apply analysis navigation state once on mount
  useEffect(() => {
    if (analysisState?.fromAnalysis) {
      const normalized = normalizeCementingSnapshot({
        wellData: analysisState.wellData ?? wellData,
        drillingFluid: analysisState.drillingFluid ?? drillingFluid,
        slurries: analysisState.slurries ?? slurries,
        buffers: analysisState.buffers ?? buffers,
        displacementFluids: analysisState.displacementFluids ?? displacementFluids,
        fractureGradient,
        flushTimeMin,
        flushVolumeM3,
      });
      setWellData(normalized.wellData);
      setDrillingFluid(normalized.drillingFluid);
      setSlurries(normalized.slurries);
      setBuffers(normalized.buffers);
      setDisplacementFluids(normalized.displacementFluids);
      if (analysisState.sourceDocuments) setSourceDocuments(analysisState.sourceDocuments);
      setFromAnalysis(true);
      // Clear navigation state to prevent re-applying
      window.history.replaceState({}, document.title);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-sync cementRiseHeight from slurries' minimum topDepthMD
  useEffect(() => {
    if (slurries.length > 0) {
      const minTop = Math.min(...slurries.map(s => s.topDepthMD));
      if (wellData.cementRiseHeight !== minTop) {
        setWellData(prev => ({ ...prev, cementRiseHeight: minTop }));
      }
    }
  }, [slurries]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const compressionCoeff = Math.max(displacementFluids?.[0]?.compressionCoeff || 1.0, 1.0);
    return pipeVolumePerMeter(cid) * wellData.ckodDepth * compressionCoeff;
  }, [wellData.casingOD, wellData.casingWall, wellData.ckodDepth, displacementFluids]);

  const [calcSnapshot, setCalcSnapshot] = useState<CalcSnapshot | null>(null);

  useEffect(() => {
    if (!calcId) return;

    const loadSavedCalculation = async () => {
      setLoadingSavedCalc(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        alert("Чтобы открыть сохранённый расчёт, войдите в аккаунт");
        setLoadingSavedCalc(false);
        return;
      }

      const { data, error } = await supabase
        .from("saved_calculations")
        .select("*")
        .eq("id", calcId)
        .single();

      if (error || !data) {
        alert("Не удалось загрузить сохранённый расчёт");
        setLoadingSavedCalc(false);
        return;
      }

      if (data.user_id !== session.user.id) {
        alert("Этот расчёт недоступен для вашего аккаунта");
        setLoadingSavedCalc(false);
        return;
      }

      const params = (data.calc_params ?? {}) as Record<string, unknown>;
      const snapshot = normalizeCementingSnapshot({
        wellData: data.well_data,
        drillingFluid: params.drillingFluid,
        slurries: params.slurries,
        buffers: params.buffers,
        displacementFluids: params.displacementFluids,
        fractureGradient: params.fractureGradient,
        flushTimeMin: params.flushTimeMin,
        flushVolumeM3: params.flushVolumeM3,
      });

      setWellData(snapshot.wellData);
      setDrillingFluid(snapshot.drillingFluid);
      setSlurries(snapshot.slurries);
      setBuffers(snapshot.buffers);
      setDisplacementFluids(snapshot.displacementFluids);
      setFractureGradient(snapshot.fractureGradient);
      setFlushTimeMin(snapshot.flushTimeMin);
      setFlushVolumeM3(snapshot.flushVolumeM3);

      setCalcSnapshot(snapshot);
      setActiveTab("hydraulics");
      setLoadingSavedCalc(false);
    };

    loadSavedCalculation();
  }, [calcId]);

  const handleCalculate = useCallback(() => {
    const snapshot = normalizeCementingSnapshot({
      wellData,
      drillingFluid,
      slurries,
      buffers,
      displacementFluids,
      fractureGradient,
      flushTimeMin,
      flushVolumeM3,
    });
    setCalcSnapshot(snapshot);
    setCalcCount(prev => prev + 1);
    // Log calculation to backend
    fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/log-activity`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
      body: JSON.stringify({
        type: "calculation",
        module: "cementing",
        well_data: snapshot.wellData,
        calc_params: {
          drillingFluid: snapshot.drillingFluid,
          slurries: snapshot.slurries,
          buffers: snapshot.buffers,
          displacementFluids: snapshot.displacementFluids,
          fractureGradient: snapshot.fractureGradient,
          flushTimeMin: snapshot.flushTimeMin,
          flushVolumeM3: snapshot.flushVolumeM3,
        },
        page_url: window.location.href,
      }),
    }).catch(() => {});
  }, [wellData, drillingFluid, slurries, buffers, displacementFluids, fractureGradient, flushTimeMin, flushVolumeM3]);

  const volumes = useMemo(() => calcSnapshot ? calculateVolumes(calcSnapshot.wellData, calcSnapshot.slurries, calcSnapshot.displacementFluids?.[0]?.compressionCoeff ?? 1.0) : null, [calcSnapshot]);

  const materials = useMemo(
    () => calcSnapshot && volumes ? calculateMaterials(calcSnapshot.slurries, calcSnapshot.buffers, calcSnapshot.wellData) : null,
    [calcSnapshot, volumes]
  );

  const pressureResult = useMemo(
    () => calcSnapshot && volumes
      ? calculatePressureProfile(calcSnapshot.wellData, calcSnapshot.slurries, calcSnapshot.buffers, calcSnapshot.drillingFluid, calcSnapshot.displacementFluids, calcSnapshot.fractureGradient, volumes.displacementVolumeWithCompression, calcSnapshot.flushTimeMin, calcSnapshot.flushVolumeM3)
      : null,
    [calcSnapshot, volumes]
  );

  // Карта макс. BHP по этапам/режимам из динамической симуляции
  const dynamicBHPMap = useMemo(() => {
    if (!pressureResult) return undefined;
    const map: Record<string, { bhp: number; fracP: number }> = {};
    for (const p of pressureResult.points) {
      if (p.pumpRateLps <= 0) continue;
      const key = `${p.stage}|${p.pumpRateLps}`;
      const existing = map[key];
      if (!existing || p.bottomholePressure > existing.bhp) {
        map[key] = { bhp: p.bottomholePressure, fracP: p.fracturePressure };
      }
    }
    return map;
  }, [pressureResult]);

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
      const snap = calcSnapshot ?? normalizeCementingSnapshot({ wellData, drillingFluid, slurries, buffers, displacementFluids, fractureGradient, flushTimeMin, flushVolumeM3 });

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

      await exportToDocx(snap.wellData, snap.drillingFluid, snap.slurries, snap.buffers, snap.displacementFluids, snap.fractureGradient, images, centralizationResults ?? undefined, {
        volumes: volumes ?? undefined,
        pressureResult: pressureResult ?? undefined,
        materials: materials ?? undefined,
        flushTimeMin: snap.flushTimeMin,
        flushVolumeM3: snap.flushVolumeM3,
      });
    } catch (e) {
      console.error("DOCX export error:", e);
    } finally {
      setExporting(false);
    }
  }, [calcSnapshot, wellData, drillingFluid, slurries, buffers, displacementFluids, fractureGradient]);

  const buildSavePayload = useCallback((): SaveCalcPayload => {
    const freshSnapshot = normalizeCementingSnapshot({
      wellData, drillingFluid, slurries, buffers, displacementFluids,
      fractureGradient, flushTimeMin, flushVolumeM3,
    });
    const computedVolumes = calculateVolumes(
      freshSnapshot.wellData, freshSnapshot.slurries,
      freshSnapshot.displacementFluids?.[0]?.compressionCoeff ?? 1.0
    );
    const computedMaterials = calculateMaterials(freshSnapshot.slurries, freshSnapshot.buffers, freshSnapshot.wellData);
    const computedPressure = calculatePressureProfile(
      freshSnapshot.wellData, freshSnapshot.slurries, freshSnapshot.buffers,
      freshSnapshot.drillingFluid, freshSnapshot.displacementFluids,
      freshSnapshot.fractureGradient, computedVolumes.displacementVolumeWithCompression,
      freshSnapshot.flushTimeMin, freshSnapshot.flushVolumeM3,
    );
    return {
      module: "cementing",
      title: `Расчёт ${new Date().toLocaleDateString("ru-RU")}`,
      well_data: freshSnapshot.wellData,
      calc_params: { slurries, buffers, displacementFluids, fractureGradient, flushTimeMin, flushVolumeM3, drillingFluid },
      results: { volumes: computedVolumes, materials: computedMaterials, pressureResult: computedPressure },
    };
  }, [wellData, drillingFluid, slurries, buffers, displacementFluids, fractureGradient, flushTimeMin, flushVolumeM3]);

  const handleSaveToAccount = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      alert("Для сохранения расчёта войдите в личный кабинет");
      return;
    }
    setSaveDialogOpen(true);
  }, []);


  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut();
    window.location.href = "/";
  }, []);

  return (
    <div className={`bg-background ${fromAnalysis ? 'flex' : ''}`}>
      {/* Persistent left chat panel for analysis sessions */}
      {fromAnalysis && (
        <div className="hidden md:block">
          <AnalysisChatPanel wellData={wellData} sourceDocuments={sourceDocuments} />
        </div>
      )}
      <div className={`flex-1 min-w-0`}>
      <header className="border-b border-border bg-card sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex flex-col items-center sm:items-start">
            <div className="flex items-center gap-4 text-[10px] text-muted-foreground/70 mb-1">
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
            {loadingSavedCalc && <p className="text-xs text-muted-foreground">Загрузка сохранённого расчёта...</p>}
            <div className="flex items-center gap-3">
              <Link
                to="/"
                className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-xs"
              >
                <Home className="w-4 h-4" />
                <span>Главная</span>
              </Link>
              {fromDashboard && (
                <>
                  <Link
                    to="/dashboard"
                    className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-xs"
                  >
                    <LayoutDashboard className="w-4 h-4" />
                    <span>Кабинет</span>
                  </Link>
                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-1.5 text-muted-foreground hover:text-destructive transition-colors text-xs"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Выйти</span>
                  </button>
                </>
              )}
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
          <div className="flex items-center gap-1.5 sm:gap-3 flex-1 sm:flex-none justify-end flex-wrap">
              <button
                onClick={() => { resetSession(); setCalcSnapshot(null); setCentralizationResults(null); }}
                title="Обнулить все данные сессии"
                className="px-2 sm:px-3 py-2 sm:py-2.5 rounded-lg border border-border text-muted-foreground font-semibold text-[10px] sm:text-sm hover:bg-destructive/10 hover:text-destructive hover:border-destructive/40 transition-colors shadow-sm flex items-center gap-1"
              >
                <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline">Обнулить</span>
              </button>
              <button
                onClick={handleSaveToAccount}
                disabled={saving}
                className="px-2 sm:px-3 py-2 sm:py-2.5 rounded-lg border border-border text-muted-foreground font-semibold text-[10px] sm:text-sm hover:bg-primary/10 hover:text-primary hover:border-primary/40 transition-colors shadow-sm flex items-center gap-1 disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5 shrink-0" />}
                <span className="hidden sm:inline">Сохранить</span>
              </button>
              <button
                onClick={handleExportDocx}
                disabled={exporting}
                className="px-2 sm:px-4 py-2 sm:py-2.5 rounded-lg bg-secondary text-secondary-foreground font-semibold text-[10px] sm:text-sm hover:bg-secondary/80 transition-colors shadow-md flex items-center gap-1 disabled:opacity-50"
              >
                {exporting ? <Loader2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 animate-spin" /> : <FileDown className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />}
                {exporting ? "..." : "DOCX"}
              </button>
              <button
                onClick={handleCalculate}
                className="px-3 sm:px-6 py-2 sm:py-2.5 rounded-lg bg-primary text-primary-foreground font-bold text-[10px] sm:text-sm hover:bg-primary/90 transition-colors shadow-md whitespace-nowrap"
              >
                РАСЧЁТ
              </button>
            </div>
          </div>
        </div>
      </header>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="overflow-x-auto scrollbar-hide sticky top-[80px] sm:top-[164px] z-[9] bg-background border-b border-border">
          <div className="max-w-7xl mx-auto px-2 sm:px-4 py-2">
          <TabsList className="inline-flex w-max sm:w-full h-auto min-w-max">
             <TabsTrigger value="input" className="text-xs py-2 px-3 sm:px-1">Данные</TabsTrigger>
             <TabsTrigger value="trajectory" className="text-xs py-2 px-3 sm:px-1">Траектория</TabsTrigger>
             <TabsTrigger value="hydraulics" className="text-xs py-2 px-3 sm:px-1">Гидравлика</TabsTrigger>
             <TabsTrigger value="schedule" className="text-xs py-2 px-3 sm:px-1">Закачка</TabsTrigger>
             <TabsTrigger value="materials" className="text-xs py-2 px-3 sm:px-1">Материалы</TabsTrigger>
             <TabsTrigger value="charts" className="text-xs py-2 px-3 sm:px-1">Графики</TabsTrigger>
             <TabsTrigger value="animation" className="text-xs py-2 px-3 sm:px-1">Анимация</TabsTrigger>
             <TabsTrigger value="contact" className="text-xs py-2 px-3 sm:px-1">Контакт</TabsTrigger>
             <TabsTrigger value="quality" className="text-xs py-2 px-3 sm:px-1">CQI</TabsTrigger>
             <TabsTrigger value="visual" className="text-xs py-2 px-3 sm:px-1">Визуал</TabsTrigger>
             <TabsTrigger value="centralization" className="text-xs py-2 px-3 sm:px-1">Центрир.</TabsTrigger>
             <TabsTrigger value="torquedrag" className="text-xs py-2 px-3 sm:px-1">T&D</TabsTrigger>
             <TabsTrigger value="drillhydr" className="text-xs py-2 px-3 sm:px-1">Гидр. бур.</TabsTrigger>
             <TabsTrigger value="foam" className="text-xs py-2 px-3 sm:px-1">Пена</TabsTrigger>
           </TabsList>
          </div>
        </div>

        <main className="max-w-7xl mx-auto px-2 sm:px-4 py-4 sm:py-6 space-y-4 sm:space-y-6">

          {fromAnalysis && (
            <div className="flex items-center gap-2 text-sm bg-primary/10 text-primary rounded-lg p-3 border border-primary/20">
              <span>📄</span>
              <span>
                Данные загружены из документов: <strong>{sourceDocuments.join(", ")}</strong>.
                Проверьте данные и нажмите <strong>РАСЧЁТ</strong> для полной программы с графиками и гидравликой.
              </span>
            </div>
          )}

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
                dynamicBHPMap={dynamicBHPMap}
                onCalculate={handleCalculate}
              />
            </div>
          </TabsContent>

          <div className={activeTab !== "trajectory" ? "h-0 overflow-hidden" : ""}>
            <TabsContent value="trajectory" forceMount>
              <div data-tab-content="trajectory">
                <TrajectorySection wellData={wellData} />
              </div>
            </TabsContent>
          </div>

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
                  dynamicMaxBHP={pressureResult ? Math.max(...pressureResult.points.map(p => p.bottomholePressure)) : undefined}
                  dynamicFracP={pressureResult ? pressureResult.points[0]?.fracturePressure : undefined}
                  dynamicStopP={pressureResult ? pressureResult.points.find(p => p.stage.includes('СТОП'))?.surfacePressure : undefined}
                  dynamicPreStopP={pressureResult ? (() => { const pts = pressureResult.points; const stopIdx = pts.findIndex(p => p.stage.includes('СТОП')); return stopIdx > 0 ? pts[stopIdx - 1].surfacePressure : undefined; })() : undefined}
                  pressureData={pressureResult?.points}
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
                  displacementVolume={volumes.displacementVolumeWithCompression}
                  displacementFluids={calcSnapshot.displacementFluids}
                  casingDepthMD={calcSnapshot.wellData.casingDepthMD}
                  wellData={calcSnapshot.wellData}
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

          <div className={activeTab !== "animation" ? "h-0 overflow-hidden" : ""}>
            <TabsContent value="animation" forceMount>
              <div data-tab-content="animation">
                {calcSnapshot && pressureResult ? (
                  <CementingAnimation
                    pressureData={pressureResult.points}
                    stageBoundaries={pressureResult.stageBoundaries}
                    casingDepthMD={calcSnapshot.wellData.casingDepthMD}
                    wellDepthMD={calcSnapshot.wellData.wellDepthMD}
                    slurries={calcSnapshot.slurries}
                    buffers={calcSnapshot.buffers}
                    reservoirLayers={calcSnapshot.wellData.reservoirLayers}
                    pipeCapacityM3={volumes?.totalPipeVolume || 0}
                    annularVolumeM3={volumes?.totalAnnularVolume || 0}
                    prevCasingDepth={calcSnapshot.wellData.prevCasingDepth || 0}
                    ckodDepth={calcSnapshot.wellData.ckodDepth || 0}
                    holeDiameter={calcSnapshot.wellData.holeDiameter}
                    casingOD={calcSnapshot.wellData.casingOD}
                    prevCasingID={calcSnapshot.wellData.prevCasingID || 0}
                  />
                ) : (
                  <div className="text-center py-12 text-muted-foreground">Нажмите «РАССЧИТАТЬ» для получения результатов</div>
                )}
              </div>
            </TabsContent>
          </div>

          <div className={activeTab !== "contact" ? "h-0 overflow-hidden" : ""}>
            <TabsContent value="contact" forceMount>
              <div data-tab-content="contact">
                {calcSnapshot && pressureResult && volumes ? (
                  <ContactTimeSection
                    pressureData={pressureResult.points}
                    casingDepthMD={calcSnapshot.wellData.casingDepthMD}
                    annVPM={volumes.annularVolumePerMeter}
                    wellData={calcSnapshot.wellData}
                    slurries={calcSnapshot.slurries}
                    buffers={calcSnapshot.buffers}
                    drillingFluid={calcSnapshot.drillingFluid}
                    centralizationResults={centralizationResults ?? undefined}
                    prevCasingDepth={calcSnapshot.wellData.prevCasingDepth || 0}
                  />
                ) : (
                  <div className="text-center py-12 text-muted-foreground">Нажмите «РАССЧИТАТЬ» для получения результатов</div>
                )}
              </div>
            </TabsContent>
          </div>

          <div className={activeTab !== "quality" ? "h-0 overflow-hidden" : ""}>
            <TabsContent value="quality" forceMount>
              <div data-tab-content="quality">
                {calcSnapshot && pressureResult && volumes ? (
                  <CementQualitySection
                    pressureData={pressureResult.points}
                    casingDepthMD={calcSnapshot.wellData.casingDepthMD}
                    annVPM={volumes.annularVolumePerMeter}
                    wellData={calcSnapshot.wellData}
                    slurries={calcSnapshot.slurries}
                    buffers={calcSnapshot.buffers}
                    drillingFluid={calcSnapshot.drillingFluid}
                    centralizationResults={centralizationResults ?? undefined}
                    prevCasingDepth={calcSnapshot.wellData.prevCasingDepth || 0}
                  />
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
                  centralizationResults={centralizationResults ?? undefined}
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
                  fluidPV={drillingFluid.rheology?.pv || 25}
                  fluidYP={drillingFluid.rheology?.yp || 25}
                  flowRateLps={slurries[0]?.flowRateSteps?.[0]?.rateLps || 10}
                  onResultsChange={setCentralizationResults}
                  onIntervalsChange={setCentralizerIntervals}
                />
              </div>
            </TabsContent>
          </div>

          <div className={activeTab !== "torquedrag" ? "h-0 overflow-hidden" : ""}>
            <TabsContent value="torquedrag" forceMount>
              <div data-tab-content="torquedrag">
              <TorqueDragSection
                  wellData={wellData}
                  mudDensity={drillingFluid.density}
                  drillingFluid={drillingFluid}
                  slurries={slurries}
                  buffers={buffers}
                  displacementFluids={displacementFluids}
                  centralizerIntervals={centralizerIntervals}
                />
              </div>
            </TabsContent>
          </div>

          <div className={activeTab !== "drillhydr" ? "h-0 overflow-hidden" : ""}>
            <TabsContent value="drillhydr" forceMount>
              <div data-tab-content="drillhydr">
                <DrillingHydraulicsSection
                  wellData={wellData}
                  mudDensity={drillingFluid.density}
                  mudRheology={drillingFluid.rheology}
                />
              </div>
            </TabsContent>
          </div>

          <div className={activeTab !== "foam" ? "h-0 overflow-hidden" : ""}>
            <TabsContent value="foam" forceMount>
              <div data-tab-content="foam">
                <FoamCementSection
                  wellData={wellData}
                  slurries={slurries}
                  buffers={buffers}
                  mudDensity={drillingFluid.density}
                  pumpRateLps={slurries[0]?.flowRateSteps?.[0]?.rateLps}
                  fractureGradient={fractureGradient}
                />
              </div>
            </TabsContent>
          </div>


        </main>
      </Tabs>

      <footer className="w-full">
        <TermsFooter />
        <img
          src={drillingBanner}
          alt="Буровые установки"
          className="w-full h-20 sm:h-28 object-cover object-center opacity-30"
        />
      </footer>

      {/* Mobile: floating chat for analysis sessions */}
      {fromAnalysis && (
        <div className="md:hidden">
          <AnalysisChatPanel wellData={wellData} sourceDocuments={sourceDocuments} />
        </div>
      )}
      </div>{/* close flex-1 wrapper */}

      <SaveToCabinetDialog
        open={saveDialogOpen}
        onOpenChange={setSaveDialogOpen}
        defaultTitle={`Цементирование ${new Date().toLocaleDateString("ru-RU")}`}
        initialWellId={selectedWellId}
        calcId={calcId}
        buildPayload={buildSavePayload}
      />
    </div>
  );
}