import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Send, Home, Calculator, ArrowLeft, FileDown, Save, Loader2, LayoutDashboard, LogOut, RotateCcw, Plus, Trash2, AlertTriangle, ShieldCheck, ShieldAlert } from "lucide-react";
import ComplicationsSection from "@/components/ComplicationsSection";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { BlurInput } from "@/components/BlurInput";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import deallsoftLogo from "@/assets/deallsoft-logo.png";
import CementPlugVisualization from "@/components/CementPlugVisualization";
import CementPlugPressureChart from "@/components/CementPlugPressureChart";
import CementPlugAnimation from "@/components/CementPlugAnimation";
import { calculateBalancedPlug, type PlugInputs, type PlugWellData, type PlugFluid, type PlugInterval, type PlugResults, type WashType, type PipeSection } from "@/lib/cement-plug-calculations";
import { calculateTVDFromSurvey, type TrajectoryPoint } from "@/lib/cementing-calculations";
import { captureElementAsDataUrl } from "@/lib/capture-image";
import { exportCementPlugToDocx, type CementPlugExportData } from "@/lib/export-cement-plug-docx";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import TermsFooter from "@/components/TermsFooter";

const SESSION_KEY = "cement_plug_session_v2";

function num(v: string): number {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

/** Compute annular area for spacer height preview */
function annArea(boreMm: number, pipeODMm: number): number {
  const bo = boreMm / 1000;
  const pi = pipeODMm / 1000;
  return (Math.PI / 4) * (bo * bo - pi * pi);
}

export type PlacementMode = 'openhole' | 'casing';

interface SessionState {
  well: PlugWellData;
  plug: PlugInterval;
  cement: PlugFluid;
  spacer: PlugFluid;
  wellFluid: PlugFluid;
  spacerVolumeAbove: number;
  spacerVolumeBelow: number;
  thickeningTime: number;
  settingTimeStartMin: number;
  settingTimeEndMin: number;
  wocTimeHours: number;
  pullOutAbove: number;
  washType: WashType;
  washCycles: number;
  tripSpeed: number;
  trajPoints: TrajectoryPoint[];
  lastResults: PlugResults | null;
  wcRatio: number;
  slurryYield: number;
  additives: { name: string; percent: number }[];
  spacerAdditives: { name: string; percent: number }[];
  pumpRateCement: number;
  pumpRateSpacer: number;
  pumpRateDisplacement: number;
  pumpRateWash: number;
  fracGradient: number;
  pipeSections: PipeSection[];
  useViscousPad: boolean;
  viscousPadFluid?: PlugFluid;
  viscousPadAdditives?: { name: string; percent: number }[];
  padPullUpAbove?: number;
  placementMode?: PlacementMode;
}

function loadSession(): Partial<SessionState> {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}

function saveSession(state: SessionState) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
  } catch {}
}

const defaultWell: PlugWellData = {
  wellDepthMD: 3000, holeDiameter: 215.9, casingShoe: 2500, casingID: 220,
  pipeOD: 89, pipeID: 75.9, cavernCoeff: 1.3,
  trajectory: [{ md: 0, azimuth: 0, zenith: 0, tvd: 0 }],
};

export default function CementPlug() {
  useEffect(() => {
    supabase.functions.invoke("log-activity", {
      body: { type: "visit", module: "cement-plug", page_url: "/cement-plug" },
    }).catch(() => {});
  }, []);

  const saved = useMemo(() => loadSession(), []);
  const vizRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  /* ── Dashboard integration ── */
  const [searchParams] = useSearchParams();
  const calcId = searchParams.get("calc");
  const selectedWellId = searchParams.get("well");
  const fromDashboard = searchParams.get("from") === "dashboard";
  const [saving, setSaving] = useState(false);
  const [loadingSavedCalc, setLoadingSavedCalc] = useState(false);

  /* ── State ── */
  const [well, setWell] = useState<PlugWellData>(saved.well || defaultWell);
  const [plug, setPlug] = useState<PlugInterval>(saved.plug || { topMD: 2600, bottomMD: 2650 });
  const [cement, setCement] = useState<PlugFluid>(saved.cement || { name: "Тампонажный р-р", density: 1.85, rheology: { pv: 50, yp: 10 }, gel10sec: 0, gel10min: 0 });
  const [spacer, setSpacer] = useState<PlugFluid>(saved.spacer || { name: "Буферная жидкость", density: 1.10, rheology: { pv: 5, yp: 2 }, gel10sec: 0, gel10min: 0 });
  const [wellFluid, setWellFluid] = useState<PlugFluid>(saved.wellFluid || { name: "Буровой раствор", density: 1.20, rheology: { pv: 15, yp: 5 }, gel10sec: 0, gel10min: 0 });
  const [spacerVolumeAbove, setSpacerVolumeAbove] = useState(saved.spacerVolumeAbove ?? 0.3);
  const [spacerVolumeBelow, setSpacerVolumeBelow] = useState(saved.spacerVolumeBelow ?? 0.3);
  const [thickeningTime, setThickeningTime] = useState(saved.thickeningTime ?? 120);
  const [settingTimeStartMin, setSettingTimeStartMin] = useState(saved.settingTimeStartMin ?? 0);
  const [settingTimeEndMin, setSettingTimeEndMin] = useState(saved.settingTimeEndMin ?? 0);
  const [wocTimeHours, setWocTimeHours] = useState(saved.wocTimeHours ?? 24);
  const [pullOutAbove, setPullOutAbove] = useState(saved.pullOutAbove ?? 50);
  const [washType, setWashType] = useState<WashType>(saved.washType || 'direct');
  const [washCycles, setWashCycles] = useState(saved.washCycles ?? 2);
  const [tripSpeed, setTripSpeed] = useState(saved.tripSpeed ?? 0.3);
  const [trajPoints, setTrajPoints] = useState<TrajectoryPoint[]>(saved.trajPoints || well.trajectory);
  const [results, setResults] = useState<PlugResults | null>(() => {
    const r = saved.lastResults;
    return r && r.pumpTimeCementMin !== undefined ? r : null;
  });
  const [wcRatio, setWcRatio] = useState(saved.wcRatio ?? 0.44);
  const [slurryYield, setSlurryYield] = useState(saved.slurryYield ?? 0.63);
  const [additives, setAdditives] = useState<{ name: string; percent: number }[]>(saved.additives || []);
  const [spacerAdditives, setSpacerAdditives] = useState<{ name: string; percent: number }[]>(saved.spacerAdditives || []);
  const [pumpRateCement, setPumpRateCement] = useState(saved.pumpRateCement ?? 3);
  const [pumpRateSpacer, setPumpRateSpacer] = useState(saved.pumpRateSpacer ?? 5);
  const [pumpRateDisplacement, setPumpRateDisplacement] = useState(saved.pumpRateDisplacement ?? 8);
  const [pumpRateWash, setPumpRateWash] = useState(saved.pumpRateWash ?? 10);
  const [fracGradient, setFracGradient] = useState(saved.fracGradient ?? 0.017);
  const [pipeSections, setPipeSections] = useState<PipeSection[]>(saved.pipeSections || []);
  const [useViscousPad, setUseViscousPad] = useState(saved.useViscousPad ?? false);
  const [viscousPadFluid, setViscousPadFluid] = useState<PlugFluid>(saved.viscousPadFluid || { name: "Вязкая пачка", density: 1.15, rheology: { pv: 30, yp: 15 }, gel10sec: 0, gel10min: 0 });
  const [viscousPadAdditives, setViscousPadAdditives] = useState<{ name: string; percent: number }[]>(saved.viscousPadAdditives || []);
  const [padPullUpAbove, setPadPullUpAbove] = useState(saved.padPullUpAbove ?? 5);
  const [placementMode, setPlacementMode] = useState<PlacementMode>(saved.placementMode || 'openhole');

  /* ── Session save ── */
  useEffect(() => {
    const timer = setTimeout(() => {
      saveSession({ well, plug, cement, spacer, wellFluid, spacerVolumeAbove, spacerVolumeBelow, thickeningTime, settingTimeStartMin, settingTimeEndMin, wocTimeHours, pullOutAbove, washType, washCycles, tripSpeed, trajPoints, lastResults: results, wcRatio, slurryYield, additives, spacerAdditives, pumpRateCement, pumpRateSpacer, pumpRateDisplacement, pumpRateWash, fracGradient, pipeSections, useViscousPad, viscousPadFluid, viscousPadAdditives, padPullUpAbove, placementMode });
    }, 500);
    return () => clearTimeout(timer);
  }, [well, plug, cement, spacer, wellFluid, spacerVolumeAbove, spacerVolumeBelow, thickeningTime, settingTimeStartMin, settingTimeEndMin, wocTimeHours, pullOutAbove, washType, washCycles, tripSpeed, trajPoints, results, wcRatio, slurryYield, additives, spacerAdditives, pumpRateCement, pumpRateSpacer, pumpRateDisplacement, pumpRateWash, fracGradient, pipeSections, useViscousPad, viscousPadFluid, viscousPadAdditives, padPullUpAbove, placementMode]);

  /* ── Spacer height preview (real-time) ── */
  const isCasingMode = placementMode === 'casing';
  const isOpenHole = !isCasingMode && plug.bottomMD > well.casingShoe;
  const effectiveBore = isOpenHole ? well.holeDiameter * Math.sqrt(Math.max(1, well.cavernCoeff)) : well.casingID;
  const previewAnnArea = annArea(effectiveBore, well.pipeOD);
  const previewBoreArea = (Math.PI / 4) * (effectiveBore / 1000) ** 2;
  const spacerAboveHeight = previewAnnArea > 0 ? spacerVolumeAbove / previewAnnArea : 0;
  const spacerBelowHeight = previewBoreArea > 0 ? spacerVolumeBelow / previewBoreArea : 0;

  /* ── Trajectory ── */
  const updateTrajPoint = (idx: number, key: keyof TrajectoryPoint, val: string) => {
    const pts = [...trajPoints];
    pts[idx] = { ...pts[idx], [key]: num(val) };
    setTrajPoints(pts);
  };
  const addTrajPoint = () => setTrajPoints(p => [...p, { md: 0, azimuth: 0, zenith: 0, tvd: 0 }]);
  const removeTrajPoint = (i: number) => setTrajPoints(p => p.filter((_, idx) => idx !== i));

  const recalcTVD = () => {
    const sorted = [...trajPoints].sort((a, b) => a.md - b.md);
    const calc = calculateTVDFromSurvey(sorted);
    setTrajPoints(calc);
    if (calc.length > 0) {
      setWell(w => ({ ...w, trajectory: calc, wellDepthMD: Math.max(w.wellDepthMD, calc[calc.length - 1].md) }));
    }
  };

  const importExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target?.result, { type: "array" });
        const getNum = (v: unknown): number | null => {
          if (v === null || v === undefined || v === "") return null;
          if (typeof v === "number") return Number.isFinite(v) ? v : null;
          const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
          return Number.isFinite(n) ? n : null;
        };
        const norm = (v: unknown) => String(v ?? "").toLowerCase().replace(/[\s\n\r,.;:°()/\\-]+/g, " ").trim();
        const isMd = (s: string) => /\bmd\b/.test(s) || s.includes("глубина") || s.includes("ствол") || s.includes("measured") || s.includes("depth");
        const isZen = (s: string) => /\bzen/.test(s) || s.includes("зенит") || s.includes("inclination") || /\binc\b/.test(s) || s.includes("угол");
        const isAz = (s: string) => /\baz/.test(s) || s.includes("азимут");
        const isTvd = (s: string) => /\btvd\b/.test(s) || s.includes("верт") || s.includes("vertical");

        let mapped: TrajectoryPoint[] = [];
        for (const sheetName of wb.SheetNames) {
          const ws = wb.Sheets[sheetName];
          const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", blankrows: false });
          if (!grid.length) continue;

          let hdr = -1, mC = -1, zC = -1, aC = -1, tC = -1;
          for (let r = 0; r < Math.min(grid.length, 20); r++) {
            const row = grid[r] || [];
            let m = -1, z = -1, a = -1, t = -1;
            for (let c = 0; c < row.length; c++) {
              const s = norm(row[c]);
              if (!s) continue;
              if (m < 0 && isMd(s) && !isTvd(s)) m = c;
              else if (z < 0 && isZen(s)) z = c;
              else if (a < 0 && isAz(s)) a = c;
              else if (t < 0 && isTvd(s)) t = c;
            }
            if (m >= 0 && z >= 0 && a >= 0) { hdr = r; mC = m; zC = z; aC = a; tC = t; break; }
          }

          const candidate: TrajectoryPoint[] = [];
          if (hdr >= 0) {
            for (let r = hdr + 1; r < grid.length; r++) {
              const row = grid[r] || [];
              const md = getNum(row[mC]);
              const zenith = getNum(row[zC]);
              const azimuth = getNum(row[aC]);
              if (md === null || zenith === null || azimuth === null) continue;
              const tvd = tC >= 0 ? getNum(row[tC]) ?? 0 : 0;
              candidate.push({ md, azimuth, zenith, tvd });
            }
          } else {
            for (const row of grid) {
              const r = row as unknown[];
              const md = getNum(r[0]);
              const zenith = getNum(r[1]);
              const azimuth = getNum(r[2]);
              if (md === null || zenith === null || azimuth === null) continue;
              const tvd = getNum(r[3]) ?? 0;
              candidate.push({ md, azimuth, zenith, tvd });
            }
          }
          if (candidate.length >= 2) { mapped = candidate; break; }
        }

        if (mapped.length < 2) {
          alert("Не удалось распознать данные. Используйте шаблон: колонки MD, Zenith, Azimuth. Минимум 2 строки данных.");
          return;
        }

        const calc = calculateTVDFromSurvey(mapped.sort((a, b) => a.md - b.md));
        setTrajPoints(calc);
        setWell(w => ({ ...w, trajectory: calc }));
      } catch (err) {
        console.error("Trajectory upload error:", err);
        alert("Не удалось прочитать Excel-файл");
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  /* ── Pipe sections helpers ── */
  const addPipeSection = () => setPipeSections(s => [...s, { fromMD: 0, toMD: 0, od: well.pipeOD || 89, id: well.pipeID || 75.9, name: `Секция ${s.length + 1}` }]);
  const updatePipeSection = (idx: number, key: keyof PipeSection, val: string) => {
    setPipeSections(s => s.map((sec, i) => i === idx ? { ...sec, [key]: key === 'name' ? val : num(val) } : sec));
  };
  const removePipeSection = (idx: number) => setPipeSections(s => s.filter((_, i) => i !== idx));

  /* ── Calculation ── */
  const buildInputs = (): PlugInputs => {
    // In casing mode: ensure casingShoe is always deeper than plug bottom
    const effectiveWell: PlugWellData = {
      ...well,
      trajectory: trajPoints.length > 1 ? trajPoints : well.trajectory,
      pipeSections: pipeSections.length > 0 ? pipeSections : undefined,
      ...(isCasingMode ? {
        casingShoe: Math.max(well.wellDepthMD, plug.bottomMD + 100),
        holeDiameter: well.casingID, // bore = casing ID
        cavernCoeff: 1.0, // no cavern in casing
      } : {}),
    };
    return {
      well: effectiveWell,
      plug, cement, spacer, wellFluid,
      spacerVolumeAboveM3: spacerVolumeAbove,
      spacerVolumeBelowM3: spacerVolumeBelow,
      safetyMarginM: 30,
      thickeningTimeMin: thickeningTime,
      pullOutAbovePlugM: pullOutAbove,
      washType,
      washCycles,
      tripSpeedMs: tripSpeed,
      pumpRateCementLs: pumpRateCement,
      pumpRateSpacerLs: pumpRateSpacer,
      pumpRateDisplacementLs: pumpRateDisplacement,
      pumpRateWashLs: pumpRateWash,
      useViscousPad,
      viscousPadFluid: useViscousPad ? viscousPadFluid : undefined,
      padPullUpAboveM: useViscousPad ? padPullUpAbove : undefined,
    };
  };

  const calculate = () => {
    const inputs = buildInputs();
    const res = calculateBalancedPlug(inputs);
    setResults(res);
    // Log calculation to backend
    supabase.functions.invoke("log-activity", {
      body: {
        type: "calculation",
        module: "cement-plug",
        page_url: "/cement-plug",
        well_data: {
          wellDepthMD: inputs.well.wellDepthMD,
          holeDiameter: inputs.well.holeDiameter,
          casingOD: inputs.well.pipeOD,
          plugTop: inputs.plug.topMD,
          plugBottom: inputs.plug.bottomMD,
        },
        calc_params: {
          cementDensity: inputs.cement.density,
          spacerDensity: inputs.spacer.density,
          spacerVolumeAbove: inputs.spacerVolumeAboveM3,
          spacerVolumeBelow: inputs.spacerVolumeBelowM3,
          wcRatio, slurryYield,
        },
      },
    }).catch(() => {});
  };

  /* ── Load saved calculation from dashboard ── */
  useEffect(() => {
    if (!calcId) return;
    const loadSaved = async () => {
      setLoadingSavedCalc(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { alert("Войдите в аккаунт"); setLoadingSavedCalc(false); return; }
      const { data, error } = await supabase.from("saved_calculations").select("*").eq("id", calcId).single();
      if (error || !data) { alert("Не удалось загрузить расчёт"); setLoadingSavedCalc(false); return; }
      if (data.user_id !== session.user.id) { alert("Расчёт недоступен"); setLoadingSavedCalc(false); return; }

      const p = (data.calc_params ?? {}) as any;
      const w = (data.well_data ?? {}) as unknown as PlugWellData;
      setWell(w);
      if (p.plug) setPlug(p.plug);
      if (p.cement) setCement(p.cement);
      if (p.spacer) setSpacer(p.spacer);
      if (p.wellFluid) setWellFluid(p.wellFluid);
      if (typeof p.spacerVolumeAbove === "number") setSpacerVolumeAbove(p.spacerVolumeAbove);
      if (typeof p.spacerVolumeBelow === "number") setSpacerVolumeBelow(p.spacerVolumeBelow);
      if (typeof p.thickeningTime === "number") setThickeningTime(p.thickeningTime);
      if (typeof p.settingTimeStartMin === "number") setSettingTimeStartMin(p.settingTimeStartMin);
      if (typeof p.settingTimeEndMin === "number") setSettingTimeEndMin(p.settingTimeEndMin);
      if (typeof p.wocTimeHours === "number") setWocTimeHours(p.wocTimeHours);
      if (typeof p.pullOutAbove === "number") setPullOutAbove(p.pullOutAbove);
      if (p.washType) setWashType(p.washType);
      if (typeof p.washCycles === "number") setWashCycles(p.washCycles);
      if (typeof p.tripSpeed === "number") setTripSpeed(p.tripSpeed);
      if (Array.isArray(p.trajPoints)) setTrajPoints(p.trajPoints);
      if (typeof p.wcRatio === "number") setWcRatio(p.wcRatio);
      if (typeof p.slurryYield === "number") setSlurryYield(p.slurryYield);
      if (Array.isArray(p.additives)) setAdditives(p.additives);
      if (Array.isArray(p.spacerAdditives)) setSpacerAdditives(p.spacerAdditives);
      if (typeof p.pumpRateCement === "number") setPumpRateCement(p.pumpRateCement);
      if (typeof p.pumpRateSpacer === "number") setPumpRateSpacer(p.pumpRateSpacer);
      if (typeof p.pumpRateDisplacement === "number") setPumpRateDisplacement(p.pumpRateDisplacement);
      if (typeof p.pumpRateWash === "number") setPumpRateWash(p.pumpRateWash);
      if (typeof p.fracGradient === "number") setFracGradient(p.fracGradient);
      if (Array.isArray(p.pipeSections)) setPipeSections(p.pipeSections);
      if (typeof p.useViscousPad === "boolean") setUseViscousPad(p.useViscousPad);
      if (p.viscousPadFluid) setViscousPadFluid(p.viscousPadFluid);
      if (Array.isArray(p.viscousPadAdditives)) setViscousPadAdditives(p.viscousPadAdditives);
      if (typeof p.padPullUpAbove === "number") setPadPullUpAbove(p.padPullUpAbove);

      // Restore results if present
      if (data.results) {
        const r = data.results as any;
        if (r.plugResults) setResults(r.plugResults);
      }
      setLoadingSavedCalc(false);
    };
    loadSaved();
  }, [calcId]);

  /* ── Save to account ── */
  const handleSaveToAccount = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { alert("Для сохранения войдите в личный кабинет"); return; }
    if (!selectedWellId) { alert("Откройте модуль из личного кабинета, выбрав скважину"); return; }

    const calcTitle = prompt("Название расчёта:", `Мост ${new Date().toLocaleDateString("ru-RU")}`);
    if (!calcTitle) return;

    const currentResults = results ?? calculateBalancedPlug(buildInputs());

    const calcParams = {
      plug, cement, spacer, wellFluid,
      spacerVolumeAbove, spacerVolumeBelow, thickeningTime, wocTimeHours,
      pullOutAbove, washType, washCycles, tripSpeed, trajPoints,
      wcRatio, slurryYield, additives, spacerAdditives,
      pumpRateCement, pumpRateSpacer, pumpRateDisplacement, pumpRateWash, fracGradient,
      pipeSections, useViscousPad,
      viscousPadFluid: useViscousPad ? viscousPadFluid : undefined,
      viscousPadAdditives: useViscousPad ? viscousPadAdditives : undefined,
    };

    setSaving(true);
    try {
      if (calcId) {
        const { error } = await supabase.from("saved_calculations")
          .update({
            title: calcTitle,
            well_data: well as any,
            calc_params: calcParams as any,
            results: { plugResults: currentResults } as any,
          } as any)
          .eq("id", calcId).eq("user_id", session.user.id);
        if (error) throw error;
        alert("Расчёт обновлён");
      } else {
        const { error } = await supabase.from("saved_calculations").insert({
          user_id: session.user.id,
          well_id: selectedWellId,
          module: "cement-plug",
          title: calcTitle,
          well_data: well as any,
          calc_params: calcParams as any,
          results: { plugResults: currentResults } as any,
        } as any);
        if (error) throw error;
        alert("Расчёт сохранён в личный кабинет");
      }
    } catch (e: any) {
      alert("Ошибка сохранения: " + e.message);
    } finally {
      setSaving(false);
    }
  }, [selectedWellId, calcId, well, plug, cement, spacer, wellFluid, spacerVolumeAbove, spacerVolumeBelow, thickeningTime, wocTimeHours, pullOutAbove, washType, washCycles, tripSpeed, trajPoints, wcRatio, slurryYield, additives, spacerAdditives, pumpRateCement, pumpRateSpacer, pumpRateDisplacement, pumpRateWash, fracGradient, results, pipeSections, useViscousPad, viscousPadFluid, viscousPadAdditives]);

  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut();
    window.location.href = "/";
  }, []);

  const captureSvgAsDataUrl = async (container: HTMLElement): Promise<string | undefined> => {
    const svgEls = container.querySelectorAll('svg');
    if (svgEls.length === 0) return undefined;

    // Capture all SVGs and combine them side by side
    const images: string[] = [];
    const dims: { w: number; h: number }[] = [];

    for (const svgEl of Array.from(svgEls)) {
      try {
        const vb = svgEl.viewBox?.baseVal;
        const svgW = (vb && vb.width > 0) ? vb.width : (svgEl.clientWidth || parseInt(svgEl.getAttribute('width') || '440') || 440);
        const svgH = (vb && vb.height > 0) ? vb.height : (svgEl.clientHeight || parseInt(svgEl.getAttribute('height') || '580') || 580);

        const clonedSvg = svgEl.cloneNode(true) as SVGSVGElement;
        clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        if (!clonedSvg.getAttribute('width')) clonedSvg.setAttribute('width', String(svgW));
        if (!clonedSvg.getAttribute('height')) clonedSvg.setAttribute('height', String(svgH));
        if (!clonedSvg.getAttribute('viewBox')) clonedSvg.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`);

        // Inline computed styles for text elements
        const textEls = clonedSvg.querySelectorAll('text');
        textEls.forEach(t => {
          if (!t.getAttribute('font-family')) t.setAttribute('font-family', 'system-ui, sans-serif');
        });

        const serializer = new XMLSerializer();
        const svgStr = serializer.serializeToString(clonedSvg);
        const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(svgBlob);
        const img = new Image();
        const scale = 2;
        await new Promise<void>((resolve, reject) => {
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = svgW * scale;
            canvas.height = svgH * scale;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.fillStyle = '#1a1a2e';
              ctx.fillRect(0, 0, canvas.width, canvas.height);
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
              images.push(canvas.toDataURL('image/png'));
              dims.push({ w: svgW * scale, h: svgH * scale });
            }
            URL.revokeObjectURL(url);
            resolve();
          };
          img.onerror = () => { URL.revokeObjectURL(url); reject(); };
          img.src = url;
        });
      } catch {}
    }

    if (images.length === 0) return undefined;
    if (images.length === 1) return images[0];

    // Combine multiple SVGs side by side
    const totalW = dims.reduce((s, d) => s + d.w, 0) + (dims.length - 1) * 20;
    const maxH = Math.max(...dims.map(d => d.h));
    const combo = document.createElement('canvas');
    combo.width = totalW;
    combo.height = maxH;
    const ctx = combo.getContext('2d');
    if (!ctx) return images[0];
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, totalW, maxH);
    let xOff = 0;
    for (let i = 0; i < images.length; i++) {
      const imgEl = new Image();
      await new Promise<void>(resolve => {
        imgEl.onload = () => {
          ctx.drawImage(imgEl, xOff, 0);
          xOff += dims[i].w + 20;
          resolve();
        };
        imgEl.onerror = () => resolve();
        imgEl.src = images[i];
      });
    }
    return combo.toDataURL('image/png');
  };

  const handleExportDocx = async () => {
    if (!results) return;
    try {
      toast.info("Формирование документа...");
      let vizImage: string | undefined;
      let chartImage: string | undefined;
      if (vizRef.current) {
        try { vizImage = await captureSvgAsDataUrl(vizRef.current); } catch (e) { console.warn('Viz capture failed:', e); }
      }
      if (chartRef.current) {
        try { chartImage = await captureElementAsDataUrl(chartRef.current); } catch {}
      }
      const exportData: CementPlugExportData = {
        inputs: buildInputs(), results, fracGradient,
        wcRatio, slurryYield, additives, spacerAdditives,
        viscousPadAdditives: useViscousPad ? viscousPadAdditives : undefined,
        trajPoints, wocTimeHours,
        visualizationImage: vizImage, pressureChartImage: chartImage,
      };
      await exportCementPlugToDocx(exportData);
      toast.success("Документ сохранён!");
    } catch (e) {
      console.error(e);
      toast.error("Ошибка экспорта");
    }
  };

  const resetSession = useCallback(() => {
    sessionStorage.removeItem(SESSION_KEY);
    setWell({ wellDepthMD: 0, holeDiameter: 0, casingShoe: 0, casingID: 0, pipeOD: 0, pipeID: 0, cavernCoeff: 0, trajectory: [{ md: 0, azimuth: 0, zenith: 0, tvd: 0 }] });
    setPlug({ topMD: 0, bottomMD: 0 });
    setCement({ name: "", density: 0, rheology: { pv: 0, yp: 0 } });
    setSpacer({ name: "", density: 0, rheology: { pv: 0, yp: 0 } });
    setWellFluid({ name: "", density: 0, rheology: { pv: 0, yp: 0 } });
    setSpacerVolumeAbove(0);
    setSpacerVolumeBelow(0);
    setThickeningTime(0);
    setSettingTimeStartMin(0);
    setSettingTimeEndMin(0);
    setWocTimeHours(0);
    setPullOutAbove(0);
    setWashType('direct');
    setWashCycles(0);
    setTripSpeed(0);
    setTrajPoints([{ md: 0, azimuth: 0, zenith: 0, tvd: 0 }]);
    setResults(null);
    setWcRatio(0);
    setSlurryYield(0);
    setAdditives([]);
    setSpacerAdditives([]);
    setPumpRateCement(0);
    setPumpRateSpacer(0);
    setPumpRateDisplacement(0);
    setPumpRateWash(0);
    setFracGradient(0);
    setPipeSections([]);
    setUseViscousPad(false);
    setViscousPadFluid({ name: "", density: 0, rheology: { pv: 0, yp: 0 } });
    setViscousPadAdditives([]);
    setPadPullUpAbove(5);
    setPlacementMode('openhole');
  }, []);

  /* ── Collapsible state ── */
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({ well: false, plug: false, fluids: false, process: false, pipeSec: false, complications: false });
  const toggle = (k: string) => setOpenSections(s => ({ ...s, [k]: !s[k] }));

  const Field = ({ label, value, onChange, unit }: { label: string; value: number; onChange: (v: string) => void; unit?: string }) => (
    <div className="space-y-1">
      <Label className="text-xs">{label}{unit ? ` (${unit})` : ""}</Label>
      <BlurInput type="number" step="any" value={value || ""} onValueCommit={onChange} className="h-8 text-xs" />
    </div>
  );

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-card sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex flex-col items-center sm:items-start">
            <Link to="/" className="flex items-center gap-3">
              <img src={deallsoftLogo} alt="DeAllsoft" className="h-16 sm:h-28 object-cover object-center" />
              <p className="text-lg sm:text-2xl font-normal tracking-tight text-foreground uppercase -mt-1">Инженерные расчёты</p>
            </Link>
            <div className="mt-0.5 sm:ml-10 text-center sm:text-left">
              <h1 className="text-sm sm:text-lg font-medium text-muted-foreground leading-tight">Цементные мосты</h1>
              <p className="text-xs text-muted-foreground/70">
                {isCasingMode ? "Установка мостов в колонне (КРС)" : "Установка мостов на равновесие"}
              </p>
            </div>
          </div>
          <div className="flex items-center sm:flex-col sm:items-end gap-3 sm:gap-6 w-full sm:w-auto">
            {loadingSavedCalc && <p className="text-xs text-muted-foreground">Загрузка сохранённого расчёта...</p>}
            <div className="flex items-center gap-3">
              <Link to="/" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-xs">
                <Home className="w-4 h-4" /> <span>Главная</span>
              </Link>
              <Link to="/dashboard" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-xs">
                <LayoutDashboard className="w-4 h-4" /> <span>Кабинет</span>
              </Link>
              <a href="https://t.me/deall_support" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-xs">
                <Send className="w-4 h-4" /> <span>Поддержка</span>
              </a>
              <button onClick={handleLogout} className="flex items-center gap-1.5 text-muted-foreground hover:text-destructive transition-colors text-xs">
                <LogOut className="w-4 h-4" /> <span>Выйти</span>
              </button>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-3 flex-1 sm:flex-none justify-end flex-wrap">
              <button onClick={resetSession} title="Обнулить все данные сессии" className="px-2 sm:px-3 py-2 sm:py-2.5 rounded-lg border border-border text-muted-foreground font-semibold text-[10px] sm:text-sm hover:bg-destructive/10 hover:text-destructive hover:border-destructive/40 transition-colors shadow-sm flex items-center gap-1">
                <RotateCcw className="w-3.5 h-3.5 shrink-0" /> <span className="hidden sm:inline">Обнулить</span>
              </button>
              {fromDashboard && (
                <button onClick={handleSaveToAccount} disabled={saving} className="px-2 sm:px-3 py-2 sm:py-2.5 rounded-lg border border-border text-muted-foreground font-semibold text-[10px] sm:text-sm hover:bg-primary/10 hover:text-primary hover:border-primary/40 transition-colors shadow-sm flex items-center gap-1 disabled:opacity-50">
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5 shrink-0" />}
                  <span className="hidden sm:inline">Сохранить</span>
                </button>
              )}
              {results && (
                <button onClick={handleExportDocx} className="px-2 sm:px-4 py-2 sm:py-2.5 rounded-lg bg-secondary text-secondary-foreground font-semibold text-[10px] sm:text-sm hover:bg-secondary/80 transition-colors shadow-md flex items-center gap-1">
                  <FileDown className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" /> DOCX
                </button>
              )}
              <button onClick={calculate} className="px-3 sm:px-6 py-2 sm:py-2.5 rounded-lg bg-primary text-primary-foreground font-bold text-[10px] sm:text-sm hover:bg-primary/90 transition-colors shadow-md whitespace-nowrap">
                РАСЧЁТ
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-3 py-4">
        <div className="space-y-4">
          {/* Inputs & results */}
          <div className="space-y-3">
            {/* Placement mode toggle */}
            <Card>
              <CardContent className="py-3 px-4">
                <div className="flex items-center gap-4">
                  <p className="text-xs font-medium text-muted-foreground">Тип установки:</p>
                  <RadioGroup value={placementMode} onValueChange={v => setPlacementMode(v as PlacementMode)} className="flex gap-4">
                    <div className="flex items-center gap-1.5">
                      <RadioGroupItem value="openhole" id="mode-oh" />
                      <Label htmlFor="mode-oh" className="text-xs cursor-pointer">Открытый ствол</Label>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <RadioGroupItem value="casing" id="mode-cas" />
                      <Label htmlFor="mode-cas" className="text-xs cursor-pointer">В колонне (КРС)</Label>
                    </div>
                  </RadioGroup>
                </div>
                {isCasingMode && (
                  <p className="text-[10px] text-muted-foreground mt-1.5">
                    🔧 Режим КРС: мост устанавливается внутри обсадной колонны. Каверновость = 1.0, диаметр ствола = внутренний ∅ колонны.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Well data */}
            <Collapsible open={openSections.well} onOpenChange={() => toggle("well")}>
              <Card>
                <CollapsibleTrigger className="w-full">
                  <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
                    <CardTitle className="text-sm">🛢️ Данные скважины</CardTitle>
                    <ChevronDown className={`w-4 h-4 transition-transform ${openSections.well ? "rotate-180" : ""}`} />
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="pt-0 space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      <Field label="Глубина скважины" value={well.wellDepthMD} onChange={v => setWell(w => ({ ...w, wellDepthMD: num(v) }))} unit="м MD" />
                      {!isCasingMode && (
                        <Field label="Диаметр ствола" value={well.holeDiameter} onChange={v => setWell(w => ({ ...w, holeDiameter: num(v) }))} unit="мм" />
                      )}
                      {!isCasingMode && (
                        <Field label="Башмак колонны" value={well.casingShoe} onChange={v => setWell(w => ({ ...w, casingShoe: num(v) }))} unit="м MD" />
                      )}
                      <Field label="Вн. ∅ колонны" value={well.casingID} onChange={v => setWell(w => ({ ...w, casingID: num(v) }))} unit="мм" />
                      <Field label="Нар. ∅ труб" value={well.pipeOD} onChange={v => setWell(w => ({ ...w, pipeOD: num(v) }))} unit="мм" />
                      <Field label="Вн. ∅ труб" value={well.pipeID} onChange={v => setWell(w => ({ ...w, pipeID: num(v) }))} unit="мм" />
                      {!isCasingMode && (
                        <Field label="Коэфф. кавернозности" value={well.cavernCoeff} onChange={v => setWell(w => ({ ...w, cavernCoeff: num(v) }))} unit="" />
                      )}
                      <Field label="Градиент ГРП" value={fracGradient} onChange={v => setFracGradient(num(v))} unit="МПа/м" />
                    </div>
                    {isOpenHole && (
                      <p className="text-[10px] text-amber-400">⚠ Открытый ствол: эфф. диаметр = {effectiveBore.toFixed(1)} мм (Kкав = {well.cavernCoeff})</p>
                    )}
                    <Separator />
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-muted-foreground">Инклинометрия</p>
                      <div className="flex gap-1 items-center">
                        <a
                          href="/trajectory_template.xlsx"
                          download="trajectory_template.xlsx"
                          className="text-[10px] text-primary hover:underline"
                        >
                          📥 Шаблон
                        </a>
                        <label className="text-[10px] text-primary hover:underline cursor-pointer">
                          📥 Excel
                          <input type="file" accept=".xlsx,.xls" className="hidden" onChange={importExcel} />
                        </label>
                        <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={addTrajPoint}>+ точка</Button>
                        <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={recalcTVD}>📐 TVD</Button>
                      </div>
                    </div>
                    <div className="max-h-40 overflow-auto text-[10px]">
                      <table className="w-full">
                        <thead><tr className="text-muted-foreground"><th className="px-1">MD</th><th className="px-1">Азимут°</th><th className="px-1">Зенит°</th><th className="px-1">TVD</th><th></th></tr></thead>
                        <tbody>
                          {trajPoints.map((p, i) => (
                            <tr key={i}>
                              <td><BlurInput type="number" className="h-6 text-[10px] w-16" value={p.md || ""} onValueCommit={v => updateTrajPoint(i, "md", v)} /></td>
                              <td><BlurInput type="number" className="h-6 text-[10px] w-16" value={p.azimuth || ""} onValueCommit={v => updateTrajPoint(i, "azimuth", v)} /></td>
                              <td><BlurInput type="number" className="h-6 text-[10px] w-16" value={p.zenith || ""} onValueCommit={v => updateTrajPoint(i, "zenith", v)} /></td>
                              <td className="text-center text-muted-foreground">{p.tvd?.toFixed(1)}</td>
                              <td>{trajPoints.length > 1 && <button className="text-destructive text-[10px]" onClick={() => removeTrajPoint(i)}>✕</button>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>

            {/* Pipe sections (drill string) */}
            <Collapsible open={openSections.pipeSec} onOpenChange={() => toggle("pipeSec")}>
              <Card>
                <CollapsibleTrigger className="w-full">
                  <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
                    <CardTitle className="text-sm">🔧 Компоновка инструмента {pipeSections.length > 0 && <Badge variant="secondary" className="ml-2 text-[10px]">{pipeSections.length} секц.</Badge>}</CardTitle>
                    <ChevronDown className={`w-4 h-4 transition-transform ${openSections.pipeSec ? "rotate-180" : ""}`} />
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="pt-0 space-y-3">
                    <p className="text-[10px] text-muted-foreground">
                      Если инструмент состоит из нескольких секций с разными диаметрами — задайте их здесь.
                      При пустом списке используются диаметры труб из «Данные скважины» (∅{well.pipeOD}/{well.pipeID} мм).
                    </p>
                    {pipeSections.length > 0 && (
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-[10px]">Название</TableHead>
                              <TableHead className="text-[10px]">От, м MD</TableHead>
                              <TableHead className="text-[10px]">До, м MD</TableHead>
                              <TableHead className="text-[10px]">Нар. ∅, мм</TableHead>
                              <TableHead className="text-[10px]">Вн. ∅, мм</TableHead>
                              <TableHead className="text-[10px] w-8"></TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {pipeSections.map((sec, i) => (
                              <TableRow key={i}>
                                <TableCell className="p-1">
                                  <BlurInput className="h-7 text-[10px] w-24" value={sec.name || ""} onValueCommit={v => updatePipeSection(i, "name", v)} />
                                </TableCell>
                                <TableCell className="p-1">
                                  <BlurInput type="number" className="h-7 text-[10px] w-20" value={sec.fromMD || ""} onValueCommit={v => updatePipeSection(i, "fromMD", v)} />
                                </TableCell>
                                <TableCell className="p-1">
                                  <BlurInput type="number" className="h-7 text-[10px] w-20" value={sec.toMD || ""} onValueCommit={v => updatePipeSection(i, "toMD", v)} />
                                </TableCell>
                                <TableCell className="p-1">
                                  <BlurInput type="number" className="h-7 text-[10px] w-20" value={sec.od || ""} onValueCommit={v => updatePipeSection(i, "od", v)} />
                                </TableCell>
                                <TableCell className="p-1">
                                  <BlurInput type="number" className="h-7 text-[10px] w-20" value={sec.id || ""} onValueCommit={v => updatePipeSection(i, "id", v)} />
                                </TableCell>
                                <TableCell className="p-1">
                                  <button className="text-destructive hover:text-destructive/80" onClick={() => removePipeSection(i)}>
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                    <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" onClick={addPipeSection}>
                      <Plus className="w-3 h-3" /> Добавить секцию
                    </Button>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>

            {/* Plug interval */}
            <Collapsible open={openSections.plug} onOpenChange={() => toggle("plug")}>
              <Card>
                <CollapsibleTrigger className="w-full">
                  <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
                    <CardTitle className="text-sm">🧱 Интервал моста</CardTitle>
                    <ChevronDown className={`w-4 h-4 transition-transform ${openSections.plug ? "rotate-180" : ""}`} />
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="pt-0">
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Верх моста" value={plug.topMD} onChange={v => setPlug(p => ({ ...p, topMD: num(v) }))} unit="м MD" />
                      <Field label="Низ моста" value={plug.bottomMD} onChange={v => setPlug(p => ({ ...p, bottomMD: num(v) }))} unit="м MD" />
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">Длина моста: {Math.max(0, plug.bottomMD - plug.topMD)} м</p>
                    {isCasingMode && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        🔧 Мост в колонне ∅{well.casingID} мм · Затрубье: ∅{well.casingID}–∅{well.pipeOD} мм
                      </p>
                    )}
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>

            {/* Fluids */}
            <Collapsible open={openSections.fluids} onOpenChange={() => toggle("fluids")}>
              <Card>
                <CollapsibleTrigger className="w-full">
                  <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
                    <CardTitle className="text-sm">🧪 Растворы и жидкости</CardTitle>
                    <ChevronDown className={`w-4 h-4 transition-transform ${openSections.fluids ? "rotate-180" : ""}`} />
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="pt-0 space-y-4">
                    {/* Cement */}
                    <div>
                      <p className="text-xs font-semibold mb-1">Цементный раствор</p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div className="space-y-1"><Label className="text-xs">Название</Label><BlurInput className="h-8 text-xs" value={cement.name} onValueCommit={v => setCement(c => ({ ...c, name: v }))} /></div>
                        <Field label="Плотность" value={cement.density} onChange={v => setCement(c => ({ ...c, density: num(v) }))} unit="г/см³" />
                        <Field label="PV" value={cement.rheology.pv} onChange={v => setCement(c => ({ ...c, rheology: { ...c.rheology, pv: num(v) } }))} unit="сПз" />
                        <Field label="YP" value={cement.rheology.yp} onChange={v => setCement(c => ({ ...c, rheology: { ...c.rheology, yp: num(v) } }))} unit="Па" />
                        <Field label="СНС 10 сек" value={cement.gel10sec || 0} onChange={v => setCement(c => ({ ...c, gel10sec: num(v) }))} unit="Па" />
                        <Field label="СНС 10 мин" value={cement.gel10min || 0} onChange={v => setCement(c => ({ ...c, gel10min: num(v) }))} unit="Па" />
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
                        <Field label="Загустевание (50Bc)" value={thickeningTime} onChange={v => setThickeningTime(num(v))} unit="мин" />
                        <div className="space-y-1">
                          <Label className="text-xs">Безопасн. время (0.75×50Bc)</Label>
                          <div className="h-8 flex items-center text-xs font-semibold text-amber-400">{(thickeningTime * 0.75).toFixed(0)} мин</div>
                        </div>
                        <Field label="Время ОЗЦ" value={wocTimeHours} onChange={v => setWocTimeHours(num(v))} unit="ч" />
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-1">
                        <Field label="Нач. схватывания (стат.)" value={settingTimeStartMin} onChange={v => setSettingTimeStartMin(num(v))} unit="мин" />
                        <Field label="Кон. схватывания (стат.)" value={settingTimeEndMin} onChange={v => setSettingTimeEndMin(num(v))} unit="мин" />
                      </div>
                      <Separator className="my-2" />
                      <p className="text-[10px] font-medium text-muted-foreground mb-1">Рецептура</p>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        <Field label="В/Ц" value={wcRatio} onChange={v => setWcRatio(num(v))} unit="" />
                        <Field label="Выход раствора" value={slurryYield} onChange={v => setSlurryYield(num(v))} unit="м³/т" />
                      </div>
                      <div className="mt-2">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-[10px] font-medium text-muted-foreground">Добавки (% BWOC)</p>
                          <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1" onClick={() => setAdditives(a => [...a, { name: "Добавка", percent: 0 }])}>+ добавка</Button>
                        </div>
                        {additives.map((add, i) => (
                          <div key={i} className="flex gap-1 items-center mb-1">
                            <BlurInput className="h-6 text-[10px] flex-1" value={add.name} onValueCommit={v => { const a = [...additives]; a[i] = { ...a[i], name: v }; setAdditives(a); }} />
                            <BlurInput type="number" className="h-6 text-[10px] w-16" value={add.percent || ""} onValueCommit={v => { const a = [...additives]; a[i] = { ...a[i], percent: num(v) }; setAdditives(a); }} />
                            <span className="text-[10px] text-muted-foreground">%</span>
                            <button className="text-destructive text-[10px]" onClick={() => setAdditives(a => a.filter((_, idx) => idx !== i))}>✕</button>
                          </div>
                        ))}
                      </div>
                    </div>
                    <Separator />
                    {/* Spacer */}
                    <div>
                      <p className="text-xs font-semibold mb-1">Буферная жидкость</p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div className="space-y-1"><Label className="text-xs">Название</Label><BlurInput className="h-8 text-xs" value={spacer.name} onValueCommit={v => setSpacer(s => ({ ...s, name: v }))} /></div>
                        <Field label="Плотность" value={spacer.density} onChange={v => setSpacer(s => ({ ...s, density: num(v) }))} unit="г/см³" />
                        <Field label="PV" value={spacer.rheology.pv} onChange={v => setSpacer(s => ({ ...s, rheology: { ...s.rheology, pv: num(v) } }))} unit="сПз" />
                        <Field label="YP" value={spacer.rheology.yp} onChange={v => setSpacer(s => ({ ...s, rheology: { ...s.rheology, yp: num(v) } }))} unit="Па" />
                        <Field label="СНС 10 сек" value={spacer.gel10sec || 0} onChange={v => setSpacer(s => ({ ...s, gel10sec: num(v) }))} unit="Па" />
                        <Field label="СНС 10 мин" value={spacer.gel10min || 0} onChange={v => setSpacer(s => ({ ...s, gel10min: num(v) }))} unit="Па" />
                      </div>
                        <div className="space-y-2 mt-2">
                        <div className="space-y-1">
                          <Field label="Объём буфера сверху" value={spacerVolumeAbove} onChange={v => setSpacerVolumeAbove(num(v))} unit="м³" />
                          <p className="text-[10px] text-muted-foreground">↕ Высота в затрубье: {spacerAboveHeight.toFixed(2)} м</p>
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                          <Switch checked={useViscousPad} onCheckedChange={setUseViscousPad} id="viscous-pad" />
                          <Label htmlFor="viscous-pad" className="text-xs cursor-pointer">Нижняя вязкая пачка</Label>
                        </div>
                        {useViscousPad && (
                          <div className="space-y-2 rounded-lg border border-border p-2 mt-1">
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                              <div className="space-y-1"><Label className="text-xs">Название</Label><BlurInput className="h-8 text-xs" value={viscousPadFluid.name} onValueCommit={v => setViscousPadFluid(f => ({ ...f, name: v }))} /></div>
                              <Field label="Плотность" value={viscousPadFluid.density} onChange={v => setViscousPadFluid(f => ({ ...f, density: num(v) }))} unit="г/см³" />
                              <Field label="PV" value={viscousPadFluid.rheology.pv} onChange={v => setViscousPadFluid(f => ({ ...f, rheology: { ...f.rheology, pv: num(v) } }))} unit="сПз" />
                              <Field label="YP" value={viscousPadFluid.rheology.yp} onChange={v => setViscousPadFluid(f => ({ ...f, rheology: { ...f.rheology, yp: num(v) } }))} unit="Па" />
                              <Field label="СНС 10 сек" value={viscousPadFluid.gel10sec || 0} onChange={v => setViscousPadFluid(f => ({ ...f, gel10sec: num(v) }))} unit="Па" />
                              <Field label="СНС 10 мин" value={viscousPadFluid.gel10min || 0} onChange={v => setViscousPadFluid(f => ({ ...f, gel10min: num(v) }))} unit="Па" />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <Field label="Объём вязкой пачки" value={spacerVolumeBelow} onChange={v => setSpacerVolumeBelow(num(v))} unit="м³" />
                              <Field label="Подъём над пачкой" value={padPullUpAbove} onChange={v => setPadPullUpAbove(num(v))} unit="м" />
                            </div>
                            <p className="text-[10px] text-muted-foreground">↕ Высота в затрубье: {spacerBelowHeight.toFixed(2)} м</p>
                            <p className="text-[10px] text-amber-400">⚠ Вязкая пачка будет установлена отдельной стадией с подъёмом и обратной промывкой</p>
                            <div className="mt-1">
                              <div className="flex items-center justify-between mb-1">
                                <p className="text-[10px] font-medium text-muted-foreground">Добавки вязкой пачки (% BWOB)</p>
                                <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1" onClick={() => setViscousPadAdditives(a => [...a, { name: "Добавка", percent: 0 }])}>+ добавка</Button>
                              </div>
                              {viscousPadAdditives.map((add, i) => (
                                <div key={i} className="flex gap-1 items-center mb-1">
                                  <BlurInput className="h-6 text-[10px] flex-1" value={add.name} onValueCommit={v => { const a = [...viscousPadAdditives]; a[i] = { ...a[i], name: v }; setViscousPadAdditives(a); }} />
                                  <BlurInput type="number" className="h-6 text-[10px] w-16" value={add.percent || ""} onValueCommit={v => { const a = [...viscousPadAdditives]; a[i] = { ...a[i], percent: num(v) }; setViscousPadAdditives(a); }} />
                                  <span className="text-[10px] text-muted-foreground">%</span>
                                  <button className="text-destructive text-[10px]" onClick={() => setViscousPadAdditives(a => a.filter((_, idx) => idx !== i))}>✕</button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="mt-2">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-[10px] font-medium text-muted-foreground">Добавки буфера (% BWOB)</p>
                          <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1" onClick={() => setSpacerAdditives(a => [...a, { name: "Добавка", percent: 0 }])}>+ добавка</Button>
                        </div>
                        {spacerAdditives.map((add, i) => (
                          <div key={i} className="flex gap-1 items-center mb-1">
                            <BlurInput className="h-6 text-[10px] flex-1" value={add.name} onValueCommit={v => { const a = [...spacerAdditives]; a[i] = { ...a[i], name: v }; setSpacerAdditives(a); }} />
                            <BlurInput type="number" className="h-6 text-[10px] w-16" value={add.percent || ""} onValueCommit={v => { const a = [...spacerAdditives]; a[i] = { ...a[i], percent: num(v) }; setSpacerAdditives(a); }} />
                            <span className="text-[10px] text-muted-foreground">%</span>
                            <button className="text-destructive text-[10px]" onClick={() => setSpacerAdditives(a => a.filter((_, idx) => idx !== i))}>✕</button>
                          </div>
                        ))}
                      </div>
                    </div>
                    <Separator />
                    {/* Well fluid */}
                    <div>
                      <p className="text-xs font-semibold mb-1">Жидкость заполнения скважины</p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div className="space-y-1"><Label className="text-xs">Название</Label><BlurInput className="h-8 text-xs" value={wellFluid.name} onValueCommit={v => setWellFluid(d => ({ ...d, name: v }))} /></div>
                        <Field label="Плотность" value={wellFluid.density} onChange={v => setWellFluid(d => ({ ...d, density: num(v) }))} unit="г/см³" />
                        <Field label="PV" value={wellFluid.rheology.pv} onChange={v => setWellFluid(d => ({ ...d, rheology: { ...d.rheology, pv: num(v) } }))} unit="сПз" />
                        <Field label="YP" value={wellFluid.rheology.yp} onChange={v => setWellFluid(d => ({ ...d, rheology: { ...d.rheology, yp: num(v) } }))} unit="Па" />
                        <Field label="СНС 10 сек" value={wellFluid.gel10sec || 0} onChange={v => setWellFluid(d => ({ ...d, gel10sec: num(v) }))} unit="Па" />
                        <Field label="СНС 10 мин" value={wellFluid.gel10min || 0} onChange={v => setWellFluid(d => ({ ...d, gel10min: num(v) }))} unit="Па" />
                      </div>
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>

            {/* Process parameters */}
            <Collapsible open={openSections.process} onOpenChange={() => toggle("process")}>
              <Card>
                <CollapsibleTrigger className="w-full">
                  <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
                    <CardTitle className="text-sm">⚙️ Параметры процесса</CardTitle>
                    <ChevronDown className={`w-4 h-4 transition-transform ${openSections.process ? "rotate-180" : ""}`} />
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="pt-0 space-y-3">
                    <p className="text-[10px] font-medium text-muted-foreground">Производительность насосов</p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <Field label="Q цемент" value={pumpRateCement} onChange={v => setPumpRateCement(num(v))} unit="л/с" />
                      <Field label="Q буфер" value={pumpRateSpacer} onChange={v => setPumpRateSpacer(num(v))} unit="л/с" />
                      <Field label="Q продавка" value={pumpRateDisplacement} onChange={v => setPumpRateDisplacement(num(v))} unit="л/с" />
                      <Field label="Q промывка" value={pumpRateWash} onChange={v => setPumpRateWash(num(v))} unit="л/с" />
                    </div>
                    <Separator />
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      <Field label="Подъём над кровлей моста" value={pullOutAbove} onChange={v => setPullOutAbove(num(v))} unit="м" />
                      <Field label="Кол-во циклов промывки" value={washCycles} onChange={v => setWashCycles(Math.max(1, num(v)))} unit="" />
                      <Field label="Скорость подъёма" value={tripSpeed} onChange={v => setTripSpeed(num(v))} unit="м/с" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Тип промывки</Label>
                      <RadioGroup value={washType} onValueChange={v => setWashType(v as WashType)} className="flex gap-4">
                        <div className="flex items-center space-x-1.5">
                          <RadioGroupItem value="direct" id="wash-direct" />
                          <Label htmlFor="wash-direct" className="text-xs cursor-pointer">Прямая</Label>
                        </div>
                        <div className="flex items-center space-x-1.5">
                          <RadioGroupItem value="reverse" id="wash-reverse" />
                          <Label htmlFor="wash-reverse" className="text-xs cursor-pointer">Обратная</Label>
                        </div>
                      </RadioGroup>
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>

            {/* Complications analysis */}
            <Collapsible open={openSections.complications} onOpenChange={() => toggle("complications")}>
              <Card>
                <CollapsibleTrigger className="w-full">
                  <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
                    <CardTitle className="text-sm">⚠️ Осложнения (поглощение / проявление)</CardTitle>
                    <ChevronDown className={`w-4 h-4 transition-transform ${openSections.complications ? "rotate-180" : ""}`} />
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="pt-0">
                    <ComplicationsSection
                      results={results}
                      cement={{ density: cement.density, pv: cement.rheology.pv, yp: cement.rheology.yp, gel10min: cement.gel10min || 0 }}
                      spacer={{ density: spacer.density, pv: spacer.rheology.pv, yp: spacer.rheology.yp, gel10min: spacer.gel10min || 0 }}
                      wellFluid={{ density: wellFluid.density, pv: wellFluid.rheology.pv, yp: wellFluid.rheology.yp, gel10min: wellFluid.gel10min || 0 }}
                      viscousPad={{ density: viscousPadFluid.density, pv: viscousPadFluid.rheology.pv, yp: viscousPadFluid.rheology.yp, gel10min: viscousPadFluid.gel10min || 0 }}
                      hasViscousPad={useViscousPad}
                      spacerVolumeBelow={useViscousPad ? spacerVolumeBelow : 0}
                      thickeningTimeMin={thickeningTime}
                      settingTimeStartMin={settingTimeStartMin}
                      settingTimeEndMin={settingTimeEndMin}
                    />
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>

            {/* Results */}
            {results && (
              <>
                {/* ── Stability analysis card ── */}
                {results.stability && (
                  <Card className={`border-2 ${
                    results.stability.isConfined ? (
                      results.stability.interfaceRisk === 'low' ? 'border-green-500/40' :
                      results.stability.interfaceRisk === 'medium' ? 'border-amber-500/40' :
                      'border-amber-500/40'
                    ) : (
                      results.stability.minStabilityFactor >= 1.5 ? 'border-green-500/40' :
                      results.stability.minStabilityFactor >= 1.0 ? 'border-amber-500/40' :
                      'border-destructive/60'
                    )
                  }`}>
                    <CardHeader className="py-3 px-4">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <ShieldCheck className="w-4 h-4 text-green-500" />
                        Устойчивость моста
                        {results.stability.isConfined ? (
                          <Badge variant="default" className="text-[10px]">
                            Замкнутая система — стабилен
                          </Badge>
                        ) : (
                          <Badge
                            variant={results.stability.minStabilityFactor >= 1.5 ? "default" : results.stability.isStable ? "secondary" : "destructive"}
                            className="text-[10px]"
                          >
                            SF = {results.stability.minStabilityFactor.toFixed(2)}
                          </Badge>
                        )}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0 space-y-3">
                      {/* Confined system: interface analysis */}
                      {results.stability.isConfined && (
                        <div className="rounded-lg border border-border p-3 space-y-2">
                          <p className="text-[10px] font-semibold text-muted-foreground">
                            Анализ интерфейса (критерий Рэлея-Тейлора)
                          </p>
                          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
                            <span className="text-muted-foreground">Dгидр (кольцевое):</span>
                            <span>{((results.stability.hydraulicDiameterM ?? 0) * 1000).toFixed(0)} мм</span>
                            <span className="text-muted-foreground font-semibold">SF интерфейса:</span>
                            <span className={`font-bold ${
                              (results.stability.interfaceSF ?? 0) >= 1.5 ? 'text-green-500' :
                              (results.stability.interfaceSF ?? 0) >= 0.7 ? 'text-amber-400' : 'text-destructive'
                            }`}>
                              {(results.stability.interfaceSF ?? 0).toFixed(2)}
                            </span>
                            <span className="text-muted-foreground">Риск загрязнения:</span>
                            <span className={`font-semibold ${
                              results.stability.interfaceRisk === 'low' ? 'text-green-500' :
                              results.stability.interfaceRisk === 'medium' ? 'text-amber-400' : 'text-destructive'
                            }`}>
                              {results.stability.interfaceRisk === 'low' ? 'Низкий' :
                               results.stability.interfaceRisk === 'medium' ? 'Умеренный' : 'Высокий'}
                            </span>
                            {(results.stability.contaminationDepthM ?? 0) > 0 && (
                              <>
                                <span className="text-muted-foreground">Глубина смешения:</span>
                                <span className="text-amber-400">~{(results.stability.contaminationDepthM ?? 0).toFixed(1)} м</span>
                              </>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Open system: piston model */}
                      {!results.stability.isConfined && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="rounded-lg border border-border p-3 space-y-1">
                            <p className="text-[10px] font-semibold text-muted-foreground">Сценарий 1: мост → через буфер</p>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
                              <span className="text-muted-foreground">Движущее давление:</span>
                              <span>{results.stability.drivingPressure1.toFixed(1)} Па</span>
                              <span className="text-muted-foreground">Удерживающее давление:</span>
                              <span>{results.stability.resistingPressure1.toFixed(1)} Па</span>
                              <span className="text-muted-foreground font-semibold">SF₁ (СНС 10мин):</span>
                              <span className={`font-bold ${results.stability.stabilityFactor1 >= 1.5 ? 'text-green-500' : results.stability.stabilityFactor1 >= 1.0 ? 'text-amber-400' : 'text-destructive'}`}>
                                {results.stability.stabilityFactor1.toFixed(2)}
                              </span>
                            </div>
                          </div>
                          <div className="rounded-lg border border-border p-3 space-y-1">
                            <p className="text-[10px] font-semibold text-muted-foreground">Сценарий 2: мост+буфер → в скв. жидкость</p>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
                              <span className="text-muted-foreground">Движущее давление:</span>
                              <span>{results.stability.drivingPressure2.toFixed(1)} Па</span>
                              <span className="text-muted-foreground">Удерживающее давление:</span>
                              <span>{results.stability.resistingPressure2.toFixed(1)} Па</span>
                              <span className="text-muted-foreground font-semibold">SF₂ (СНС 10мин):</span>
                              <span className={`font-bold ${results.stability.stabilityFactor2 >= 1.5 ? 'text-green-500' : results.stability.stabilityFactor2 >= 1.0 ? 'text-amber-400' : 'text-destructive'}`}>
                                {results.stability.stabilityFactor2.toFixed(2)}
                              </span>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Warnings */}
                      {results.stability.warnings.length > 0 && (
                        <div className="space-y-1.5">
                          {results.stability.warnings.map((w, i) => (
                            <Alert key={i} variant={w.startsWith('⛔') ? 'destructive' : 'default'} className="py-2">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              <AlertDescription className="text-[10px]">{w}</AlertDescription>
                            </Alert>
                          ))}
                        </div>
                      )}

                      {/* Recommendation */}
                      <div className={`rounded-lg p-3 text-xs ${
                        results.stability.isConfined ? (
                          results.stability.interfaceRisk === 'low' ? 'bg-green-500/10 text-green-400' :
                          'bg-amber-500/10 text-amber-400'
                        ) : (
                          results.stability.minStabilityFactor >= 1.5 ? 'bg-green-500/10 text-green-400' :
                          results.stability.isStable ? 'bg-amber-500/10 text-amber-400' :
                          'bg-destructive/10 text-destructive'
                        )
                      }`}>
                        <p className="whitespace-pre-line">{results.stability.recommendation}</p>
                        {(results.stability.requiredSpacerGel ?? 0) > 0 && results.stability.interfaceRisk !== 'low' && (
                          <p className="mt-1 font-semibold text-[11px]">
                            Рекомендуемый СНС 10 мин буфера для чистого интерфейса: ≥ {(results.stability.requiredSpacerGel ?? 0).toFixed(1)} Па
                          </p>
                        )}
                        {!results.stability.usedGelStrength && (
                          <p className="mt-1 text-[10px] opacity-70">
                            ℹ СНС не задан — используется оценка Gel ≈ 3×YP. Введите СНС для точности.
                          </p>
                        )}
                      </div>

                      {/* Pipe sections used */}
                      {results.pipeSectionsUsed && results.pipeSectionsUsed.length > 1 && (
                        <div className="text-[10px] text-muted-foreground">
                          <p className="font-semibold mb-0.5">Компоновка инструмента ({results.pipeSectionsUsed.length} секц.):</p>
                          {results.pipeSectionsUsed.map((s, i) => (
                            <p key={i}>{s.name || `Секция ${i + 1}`}: {s.fromMD}–{s.toMD} м, ∅{s.od}/{s.id} мм</p>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                <Card className="border-primary/30">
                  <CardHeader className="py-3 px-4">
                    <CardTitle className="text-sm flex items-center gap-2">
                      📊 Результаты расчёта
                      <Badge variant={results.isBalanced ? "default" : "destructive"} className="text-[10px]">
                        {results.isBalanced ? "Сбалансировано ✓" : "Дисбаланс ⚠"}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs">
                      <ResultRow label="Длина моста (MD)" value={results.plugLengthMD} unit="м" />
                      <ResultRow label="Длина моста (TVD)" value={results.plugLengthTVD} unit="м" />
                      <ResultRow label="Верх моста TVD" value={results.plugTopTVD} unit="м" />
                      <ResultRow label="Низ моста TVD" value={results.plugBottomTVD} unit="м" />
                      <ResultRow label="Sзатр." value={(results.annArea * 1e4).toFixed(1)} unit="см²" raw />
                      <ResultRow label="Sтруб." value={(results.pipeArea * 1e4).toFixed(1)} unit="см²" raw />
                      {results.isOpenHole && (
                        <ResultRow label="Kкав / эфф.∅" value={`${results.cavernCoeff.toFixed(2)} / ${results.boreDiamUsed.toFixed(1)} мм`} unit="" raw />
                      )}
                      <Separator className="col-span-full my-1" />
                      <ResultRow label="Цемент (затрубье)" value={results.cementVolumeAnn} unit="м³" />
                      <ResultRow label="Цемент (трубы)" value={results.cementVolumePipe} unit="м³" />
                      <ResultRow label="Цемент ИТОГО" value={results.cementVolumeTotal} unit="м³" highlight />
                      <ResultRow label="Высота цем. (затрубье)" value={results.cementHeightAnnMD} unit="м" />
                      <ResultRow label="Высота цем. (трубы)" value={results.cementHeightPipeMD} unit="м" />
                      <div className="col-span-full text-[10px] text-muted-foreground italic mt-1">
                        {results.heightDifferenceExplanation}
                      </div>
                      <Separator className="col-span-full my-1" />
                      <ResultRow label="Буфер сверху" value={results.spacerVolumeAbove} unit="м³" />
                      <ResultRow label="↕ Интервал буфера сверху" value={results.spacerAboveHeightAnnMD} unit="м" />
                      {results.useViscousPad && results.spacerVolumeBelow > 0 && (
                        <>
                          <ResultRow label="Вязкая пачка" value={results.spacerVolumeBelow} unit="м³" />
                          <ResultRow label="↕ Интервал вязкой пачки" value={results.spacerBelowHeightAnnMD} unit="м" />
                        </>
                      )}
                      <ResultRow label="Объём продавки" value={results.displacementVolume} unit="м³" highlight />
                      <Separator className="col-span-full my-1" />
                      <ResultRow label="P_статич. затрубье" value={results.pressureAnnulus} unit="МПа" />
                      <ResultRow label="P_статич. трубы" value={results.pressurePipe} unit="МПа" />
                      <ResultRow label="ΔP" value={Math.abs(results.pressureAnnulus - results.pressurePipe).toFixed(2)} unit="МПа" raw highlight />
                      <Separator className="col-span-full my-1" />
                      <ResultRow label="Подъём на промывку до" value={results.pullOutDepthMD} unit="м MD" />
                      <ResultRow label="Скорость подъёма" value={results.tripSpeedMs.toFixed(2)} unit="м/с" raw />
                      <ResultRow label={`Промывка (${results.washType === 'direct' ? 'прямая' : 'обратная'}, ${results.washCycles} ц.)`} value={results.washVolumeM3} unit="м³" />
                      <Separator className="col-span-full my-1" />
                      <div className="col-span-full text-[10px] font-semibold text-muted-foreground">⏱ Хронометраж операции (от начала закачки цемента)</div>
                      <ResultRow label="Закачка цемента" value={results.pumpTimeCementMin.toFixed(1)} unit="мин" raw />
                      {results.pumpTimeSpacerAboveMin > 0 && (
                        <ResultRow label="Закачка верх. буфера" value={results.pumpTimeSpacerAboveMin.toFixed(1)} unit="мин" raw />
                      )}
                      <ResultRow label="Продавка" value={results.pumpTimeDisplacementMin.toFixed(1)} unit="мин" raw />
                      <ResultRow label="Подъём инструмента" value={results.tripTimeMin.toFixed(1)} unit="мин" raw />
                      <ResultRow label="Промывка" value={results.washTimeMin.toFixed(1)} unit="мин" raw />
                      <Separator className="col-span-full my-1" />
                      <ResultRow label="Итого время операции" value={results.totalOperationTimeMin.toFixed(1)} unit="мин" raw highlight />
                      <ResultRow label="Загустевание (50Bc)" value={results.thickeningTimeMin} unit="мин" />
                      <ResultRow label="Безопасное время (0.75×50Bc)" value={results.safeTimeMin.toFixed(0)} unit="мин" raw highlight />
                      <div className={`col-span-full text-xs font-bold mt-1 ${results.isTimeSafe ? 'text-green-400' : 'text-destructive'}`}>
                        {results.isTimeSafe 
                          ? `✅ Запас: ${(results.safeTimeMin - results.totalOperationTimeMin).toFixed(1)} мин` 
                          : `⛔ Превышение на ${(results.totalOperationTimeMin - results.safeTimeMin).toFixed(1)} мин! Увеличьте производительность или время загустевания`}
                      </div>
                      <Separator className="col-span-full my-1" />
                      <ResultRow label="Время ОЗЦ" value={wocTimeHours} unit="ч" highlight />
                    </div>
                  </CardContent>
                </Card>

                {/* Pumping schedule */}
                <Card>
                  <CardHeader className="py-3 px-4">
                    <CardTitle className="text-sm">📋 Порядок работ</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">№</TableHead>
                            <TableHead className="text-xs">Этап</TableHead>
                            <TableHead className="text-xs">Жидкость</TableHead>
                            <TableHead className="text-xs text-right">Объём, м³</TableHead>
                            <TableHead className="text-xs text-right">Время, мин</TableHead>
                            <TableHead className="text-xs">Описание</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {results.pumpingStages.map((stage, i) => (
                            <TableRow key={i}>
                              <TableCell className="text-xs font-medium">{i + 1}</TableCell>
                              <TableCell className="text-xs font-medium">{stage.name}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{stage.fluid}</TableCell>
                              <TableCell className="text-xs text-right font-medium">{stage.volumeM3 > 0 ? stage.volumeM3.toFixed(3) : "—"}</TableCell>
                              <TableCell className="text-xs text-right font-medium">{stage.timeMin > 0 ? stage.timeMin.toFixed(1) : "—"}</TableCell>
                              <TableCell className="text-xs text-muted-foreground max-w-[200px]">{stage.description}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>

                {/* Materials */}
                {slurryYield > 0 && (
                  <Card>
                    <CardHeader className="py-3 px-4">
                      <CardTitle className="text-sm">🏗️ Материалы</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                      {(() => {
                        const dryMass = results.cementVolumeTotal / slurryYield;
                        const waterMass = dryMass * wcRatio;
                        const spacerTotalVol = results.spacerVolumeAbove + results.spacerVolumeBelow;
                        const spacerMassKg = spacerTotalVol * spacer.density * 1000;
                        return (
                          <div className="space-y-3">
                            <div>
                              <p className="text-[10px] font-semibold text-muted-foreground mb-1">Цемент</p>
                              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                                <ResultRow label="Сухой цемент" value={(dryMass * 1000).toFixed(0)} unit="кг" raw />
                                <ResultRow label="Вода затворения" value={(waterMass * 1000).toFixed(0)} unit="кг" raw />
                                <ResultRow label="В/Ц" value={wcRatio.toFixed(2)} unit="" raw />
                                <ResultRow label="Выход" value={slurryYield.toFixed(2)} unit="м³/т" raw />
                                {additives.filter(a => a.percent > 0).map((add, i) => (
                                  <ResultRow key={i} label={add.name} value={(dryMass * 1000 * add.percent / 100).toFixed(1)} unit={`кг (${add.percent}%)`} raw />
                                ))}
                              </div>
                            </div>
                            {spacerTotalVol > 0 && (
                              <div>
                                <Separator className="mb-2" />
                                <p className="text-[10px] font-semibold text-muted-foreground mb-1">Буфер</p>
                                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                                  <ResultRow label="Объём буфера (всего)" value={spacerTotalVol.toFixed(3)} unit="м³" raw />
                                  <ResultRow label="Масса буфера" value={spacerMassKg.toFixed(0)} unit="кг" raw />
                                  {spacerAdditives.filter(a => a.percent > 0).map((add, i) => (
                                    <ResultRow key={i} label={add.name} value={(spacerMassKg * add.percent / 100).toFixed(1)} unit={`кг (${add.percent}%)`} raw />
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </CardContent>
                  </Card>
                )}

                {/* Process description */}
                <Card>
                  <CardHeader className="py-3 px-4">
                    <CardTitle className="text-sm">📝 Описание процесса</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="space-y-1.5 text-xs text-foreground whitespace-pre-line leading-relaxed">
                      {results.processDescription}
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </div>

          {/* Animation */}
          {results && (
            <CementPlugAnimation inputs={buildInputs()} results={results} />
          )}

          {/* Visualization & Chart — below results */}
          {results && (
            <div className="grid grid-cols-1 gap-4">
              <Card>
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-sm">📈 Совмещённый график давлений</CardTitle>
                </CardHeader>
                <CardContent className="pt-0" ref={chartRef}>
                  <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
                    <div className="min-w-[600px]">
                      <CementPlugPressureChart inputs={buildInputs()} results={results} fracGradient={fracGradient} />
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-sm">🖼️ Продольное сечение</CardTitle>
                </CardHeader>
                <CardContent className="pt-0 flex justify-center" ref={vizRef}>
                  <CementPlugVisualization results={results} inputs={buildInputs()} />
                </CardContent>
              </Card>
            </div>
          )}
          {!results && (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground text-sm">
                Заполните данные и нажмите <strong>Расчёт</strong> для получения результатов и визуализации
              </CardContent>
            </Card>
          )}
        </div>
      </main>
      <TermsFooter />
    </div>
  );
}

function ResultRow({ label, value, unit, highlight, raw }: { label: string; value: number | string; unit: string; highlight?: boolean; raw?: boolean }) {
  const display = raw ? String(value) : typeof value === "number" ? value.toFixed(3) : value;
  return (
    <div className={`flex justify-between ${highlight ? "font-semibold text-primary" : ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <span>{display} {unit}</span>
    </div>
  );
}
