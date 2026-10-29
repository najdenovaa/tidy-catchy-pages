import { useMemo, useState, type RefObject } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Line, LineChart, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, ReferenceLine, ReferenceArea } from "recharts";
import { Plus, Trash2, Download, Upload, CloudDownload, Briefcase, RotateCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import CopyImageButton from "@/components/CopyImageButton";
import {
  analyzeStringLife, ENV_LABEL, WELD_LABEL,
  type CTStringPassport, type JournalEntry, type JournalEnv, type JournalKind, type PlannedJob, type StringWeld,
} from "@/lib/ct-string-life";

const uid = () => Math.random().toString(36).slice(2, 9);
const f = (v: number, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : "∞");
const KIND_LABEL: Record<JournalKind, string> = { trip: "Рейс", recip: "Расхаживание", cut: "Обрезка" };
const STATUS: Record<string, { label: string; cls: string }> = {
  ok: { label: "в норме", cls: "bg-green-600" },
  watch: { label: "наблюдать", cls: "bg-amber-500" },
  critical: { label: "близко к отбраковке", cls: "bg-orange-600" },
  retire: { label: "к отбраковке", cls: "bg-red-600" },
};

interface Props {
  passport: CTStringPassport;
  onChange: (p: CTStringPassport) => void;
  ct: { od: number; wall: number; grade: string; length: number };
  /** текущая работа: глубина и давление в трубе */
  currentDepthM: number;
  currentPressureMPa: number;
  wellLabel: string;
  userId: string | null;
  chartRef?: RefObject<HTMLDivElement | null>;
}

interface CabinetRow { id: string; title: string; created_at: string; depth: number; pressure: number; passport: CTStringPassport | null }

function NumIn({ value, onCommit, w = "w-20", step = "any", testid }: { value: number | undefined; onCommit: (v: number | undefined) => void; w?: string; step?: string; testid?: string }) {
  return (
    <input type="number" step={step} inputMode="decimal" key={String(value)} defaultValue={value ?? ""} data-testid={testid}
      onBlur={(e) => { const s = e.target.value.trim().replace(",", "."); const v = parseFloat(s); onCommit(s === "" ? undefined : Number.isFinite(v) ? v : undefined); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className={`h-7 ${w} rounded border border-border bg-background px-1.5 text-right text-xs`} />
  );
}

export default function CTStringLifeCard({ passport: p, onChange, ct, currentDepthM, currentPressureMPa, wellLabel, userId, chartRef }: Props) {
  const [job, setJob] = useState<PlannedJob>({ depthM: Math.round(currentDepthM), pressureMPa: Math.round(currentPressureMPa * 10) / 10, env: "normal" });
  const [cabinetOpen, setCabinetOpen] = useState(false);
  const [cabinetRows, setCabinetRows] = useState<CabinetRow[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const set = (patch: Partial<CTStringPassport>) => onChange({ ...p, ...patch });
  const setEntry = (id: string, patch: Partial<JournalEntry>) => set({ journal: p.journal.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
  const addEntry = (e: Partial<JournalEntry>) => set({ journal: [...p.journal, { id: uid(), date: new Date().toISOString().slice(0, 10), kind: "trip", depthM: Math.round(currentDepthM), count: 1, pressureMPa: Math.round(currentPressureMPa * 10) / 10, env: "normal", label: wellLabel, ...e }] });

  const requiredLength = job.depthM + 150;
  const a = useMemo(() => analyzeStringLife(p, ct.od, ct.wall, ct.grade, job, requiredLength), [p, ct.od, ct.wall, ct.grade, job, requiredLength]);
  const st = STATUS[a.status];
  const chart = useMemo(() => a.profile.filter((_, i) => i % Math.max(1, Math.floor(a.profile.length / 300)) === 0), [a.profile]);
  const hot = a.profile.filter((x) => x.damagePct >= p.retireAtPct * 0.75);

  const openCabinet = async () => {
    if (!userId) { toast.error("Войдите в кабинет, чтобы подтянуть работы"); return; }
    setCabinetOpen(true); setCabinetRows(null); setPicked(new Set());
    const { data, error } = await supabase.from("saved_calculations").select("id,title,created_at,well_data,results").eq("user_id", userId).eq("module", "coiled-tubing").order("created_at", { ascending: true });
    if (error) { toast.error("Не удалось загрузить расчёты из кабинета"); setCabinetRows([]); return; }
    setCabinetRows((data ?? []).map((r) => {
      type Saved = { well?: { md?: number; wellheadPressure?: number }; ct?: { length?: number }; stringPassport?: CTStringPassport };
      const wd = (r.well_data ?? {}) as Saved;
      const res = (r.results ?? {}) as { hydraulics?: { pumpPressure?: number; dpTotal?: number } };
      const md = Number(wd.well?.md ?? 0), len = Number(wd.ct?.length ?? md);
      const whp = Number(wd.well?.wellheadPressure ?? 0);
      const h = res.hydraulics ?? {};
      const pressure = Number(h.pumpPressure ?? (Number(h.dpTotal ?? 0) + whp));
      return { id: r.id, title: r.title, created_at: r.created_at, depth: Math.min(md, len || md), pressure: Number.isFinite(pressure) ? pressure : 0, passport: wd.stringPassport ?? null };
    }));
  };
  const importPicked = () => {
    const rows = (cabinetRows ?? []).filter((r) => picked.has(r.id));
    if (!rows.length) return;
    set({ journal: [...p.journal, ...rows.map((r) => ({ id: uid(), date: r.created_at.slice(0, 10), label: r.title, kind: "trip" as const, depthM: Math.round(r.depth), count: 1, pressureMPa: Math.round(r.pressure * 10) / 10, env: "normal" as const }))] });
    toast.success(`Добавлено работ: ${rows.length}`);
    setCabinetOpen(false);
  };

  const exportXlsx = () => {
    const rows = p.journal.map((e) => ({
      "Дата": e.date ?? "", "Описание": e.label ?? "", "Тип": KIND_LABEL[e.kind],
      "Глубина / низ интервала, м": e.kind === "cut" ? "" : e.depthM, "Верх интервала, м": e.kind === "recip" ? e.fromM ?? "" : "",
      "Количество": e.kind === "cut" ? "" : e.count, "Давление, МПа": e.kind === "cut" ? "" : e.pressureMPa,
      "Среда": e.kind === "cut" ? "" : ENV_LABEL[e.env ?? "normal"], "Обрезка, м": e.kind === "cut" ? e.cutM ?? 0 : "",
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Журнал");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(a.profile.map((x) => ({ "От нижнего конца, м": x.pos, "От барабана, м": x.s, "Ресурс израсходован, %": x.damagePct, "Деформация на барабане, %": x.reelStrainPct }))), "Ресурс по длине");
    XLSX.writeFile(wb, `Журнал_ГНКТ_${p.serial || p.name || "труба"}.xlsx`);
  };
  const importXlsx = (file: File) => {
    const rd = new FileReader();
    rd.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target?.result, { type: "array" });
        const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
        const get = (r: Record<string, unknown>, keys: string[]) => { for (const k of Object.keys(r)) if (keys.some((s) => k.toLowerCase().includes(s))) return r[k]; return undefined; };
        const num = (x: unknown) => { const v = parseFloat(String(x ?? "").replace(",", ".")); return Number.isFinite(v) ? v : 0; };
        const out: JournalEntry[] = rows.map((r) => {
          const t = String(get(r, ["тип", "type"]) ?? "рейс").toLowerCase();
          const kind: JournalKind = t.startsWith("обр") || t.startsWith("cut") ? "cut" : t.startsWith("рас") || t.startsWith("rec") ? "recip" : "trip";
          const envS = String(get(r, ["сред", "env"]) ?? "").toLowerCase();
          return {
            id: uid(), date: String(get(r, ["дата", "date"]) ?? ""), label: String(get(r, ["опис", "скваж", "label"]) ?? ""), kind,
            depthM: num(get(r, ["глубина", "низ", "depth"])), fromM: num(get(r, ["верх", "from"])) || undefined,
            count: num(get(r, ["колич", "count"])) || 1, pressureMPa: num(get(r, ["давлен", "pressure"])),
            env: (envS.includes("h2s") || envS.includes("серо") ? "h2s" : envS.includes("кисл") || envS.includes("acid") ? "acid" : "normal") as JournalEnv,
            cutM: num(get(r, ["обрез", "cut"])) || undefined,
          };
        }).filter((e) => e.kind === "cut" ? (e.cutM ?? 0) > 0 : e.depthM > 0);
        set({ journal: [...p.journal, ...out] });
        toast.success(`Импортировано записей: ${out.length}`);
      } catch { toast.error("Не удалось прочитать файл"); }
    };
    rd.readAsArrayBuffer(file);
  };

  return (
    <Card data-testid="ct-string-life">
      <CardHeader className="py-3 px-4 flex-row items-center justify-between gap-2 flex-wrap">
        <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
          🔄 Ресурс трубы по длине — журнал работ
          <Badge className={`${st.cls} text-white text-[10px]`}>{st.label}</Badge>
        </CardTitle>
        {chartRef && <CopyImageButton targetRef={chartRef} label="📋" />}
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-4 text-xs">
        {/* Паспорт */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <label className="space-y-1"><span className="text-muted-foreground">Барабан / № трубы</span>
            <input defaultValue={p.serial} key={p.serial} onBlur={(e) => set({ serial: e.target.value })} className="h-7 w-full rounded border border-border bg-background px-1.5" placeholder="напр. Б-12 / 44.45-0417" /></label>
          <label className="space-y-1 block"><span className="text-muted-foreground block">Длина при поставке, м</span><NumIn value={p.initialLengthM} onCommit={(v) => set({ initialLengthM: v ?? ct.length })} w="w-full" /></label>
          <label className="space-y-1 block"><span className="text-muted-foreground block">Сердечник барабана Ø, м</span><NumIn value={p.reelCoreD} onCommit={(v) => set({ reelCoreD: v && v > 0.5 ? v : 2.13 })} w="w-full" /></label>
          <label className="space-y-1 block"><span className="text-muted-foreground block">Ширина барабана, м</span><NumIn value={p.reelWidthM} onCommit={(v) => set({ reelWidthM: v && v > 0.2 ? v : 1.7 })} w="w-full" /></label>
          <label className="space-y-1 block"><span className="text-muted-foreground block">Радиус гусака, м</span><NumIn value={p.gooseneckRadiusM} onCommit={(v) => set({ gooseneckRadiusM: v && v > 0.3 ? v : 1.83 })} w="w-full" /></label>
          <label className="space-y-1 block"><span className="text-muted-foreground block">Порог отбраковки, %</span><NumIn value={p.retireAtPct} onCommit={(v) => set({ retireAtPct: v && v > 10 ? Math.min(100, v) : 80 })} w="w-full" /></label>
          <label className="space-y-1 block"><span className="text-muted-foreground block">Планируемая работа: глубина, м</span><NumIn value={job.depthM} onCommit={(v) => setJob((j) => ({ ...j, depthM: v ?? Math.round(currentDepthM) }))} w="w-full" /></label>
          <label className="space-y-1 block"><span className="text-muted-foreground block">давление в трубе, МПа · среда</span>
            <div className="flex gap-1"><NumIn value={job.pressureMPa} onCommit={(v) => setJob((j) => ({ ...j, pressureMPa: v ?? 0 }))} w="w-16" />
              <select value={job.env} onChange={(e) => setJob((j) => ({ ...j, env: e.target.value as JournalEnv }))} className="h-7 flex-1 min-w-0 rounded border border-border bg-background px-1">{(Object.keys(ENV_LABEL) as JournalEnv[]).map((k) => <option key={k} value={k}>{ENV_LABEL[k]}</option>)}</select></div></label>
        </div>

        {/* KPI */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            ["Израсходовано (макс.)", `${f(a.maxDamagePct, 1)}%`, a.maxDamagePct > 0 ? `на ${Math.round(a.maxAtPos)} м от низа` : "журнал пуст — новая труба", a.status !== "ok"],
            ["Работ до отбраковки", Number.isFinite(a.jobsToRetire) ? String(Math.floor(a.jobsToRetire)) : "∞", `${Math.round(job.depthM)} м · ${job.pressureMPa} МПа · ${f(a.jobDamagePct, 2)}% за работу`, a.jobsToRetire < 10],
            ["Длина сейчас", `${Math.round(a.currentLengthM)} м`, a.removedM > 0 ? `обрезано ${Math.round(a.removedM)} м · рейсов ${a.tripsCount}` : `рейсов в журнале ${a.tripsCount}`, a.currentLengthM < requiredLength],
            ["Деформация изгиба", `${f(a.strainReelMinPct, 2)}–${f(a.strainReelMaxPct, 2)}%`, `барабан (наруж.–внутр. слой); гусак ${f(a.strainGooseneckPct, 2)}%`, false],
          ].map(([n, v, sub, warn]) => (
            <div key={n as string} className={`rounded-md border p-2 ${warn ? "border-destructive/50 bg-destructive/5" : "border-border/60"}`}>
              <p className="text-[10px] text-muted-foreground">{n}</p><p className="text-base font-semibold">{v}</p><p className="text-[10px] text-muted-foreground">{sub}</p>
            </div>
          ))}
        </div>

        {/* График */}
        <div ref={chartRef} className="bg-card rounded-lg">
          <p className="text-xs font-semibold text-center mb-1">📊 Израсходованный ресурс по длине трубы</p>
          <p className="text-[10px] text-muted-foreground text-center mb-1">0 — нижний конец (КНБК), справа — конец у сердечника барабана. Пунктир — после планируемой работы; серая зона — участок, который работает в этой работе.</p>
          <div className="overflow-x-auto -mx-2 px-2">
            <div className="min-w-[560px]">
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chart} margin={{ top: 10, right: 20, bottom: 22, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="pos" type="number" domain={[0, Math.ceil(a.currentLengthM / 100) * 100]} tick={{ fontSize: 10 }} label={{ value: "От нижнего конца, м", position: "insideBottom", offset: -8, style: { fontSize: 10 } }} />
                  <YAxis tick={{ fontSize: 10 }} domain={[0, (max: number) => Math.max(p.retireAtPct * 1.15, Math.ceil(max / 10) * 10)]} label={{ value: "Ресурс израсходован, %", angle: -90, position: "insideLeft", style: { fontSize: 10 } }} />
                  <Tooltip contentStyle={{ fontSize: 11 }} labelFormatter={(x) => `${x} м от низа`} formatter={(v: number, n: string) => [n.includes("Деформ") ? `${v}%` : `${v}%`, n]} />
                  <Legend wrapperStyle={{ fontSize: 10 }} verticalAlign="top" />
                  <ReferenceArea x1={0} x2={Math.min(job.depthM, a.currentLengthM)} fill="#94a3b8" fillOpacity={0.12} />
                  <Line type="monotone" dataKey="damagePct" name="Сейчас" stroke="#ef4444" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="afterJobPct" name="После планируемой работы" stroke="#f97316" strokeWidth={1.4} strokeDasharray="5 3" dot={false} isAnimationActive={false} />
                  <ReferenceLine y={p.retireAtPct} stroke="#dc2626" strokeDasharray="6 3" label={{ value: `отбраковка ${p.retireAtPct}%`, position: "insideTopRight", style: { fontSize: 10, fill: "#dc2626" } }} />
                  {a.recommendedCutM > 0 && <ReferenceLine x={a.recommendedCutM} stroke="#7c3aed" strokeDasharray="4 3" label={{ value: `обрезка ${a.recommendedCutM} м`, position: "insideTopLeft", style: { fontSize: 10, fill: "#7c3aed" } }} />}
                  {p.welds.map((w) => <ReferenceLine key={w.id} x={Math.round(a.currentLengthM - w.sFromCoreM)} stroke="#0ea5e9" strokeDasharray="2 3" label={{ value: "шов", position: "top", style: { fontSize: 9, fill: "#0284c7" } }} />)}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Рекомендации */}
        {a.recommendations.length > 0 && (
          <div className="rounded-md border border-border/60 p-2 space-y-1" data-testid="ct-life-recs">
            <p className="font-semibold">Рекомендации</p>
            {a.recommendations.map((r) => <p key={r}>• {r}</p>)}
            {hot.length > 0 && <p className="text-muted-foreground">Зона износа ≥ {Math.round(p.retireAtPct * 0.75)}%: {hot[0].pos}–{hot[hot.length - 1].pos} м от нижнего конца.</p>}
          </div>
        )}

        {/* Журнал */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="font-semibold mr-auto">Журнал работ ({p.journal.length})</p>
            <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => addEntry({})} data-testid="ct-life-add-current"><Briefcase className="w-3.5 h-3.5 mr-1" />Текущая работа</Button>
            <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => addEntry({ kind: "recip", depthM: Math.round(currentDepthM), fromM: Math.max(0, Math.round(currentDepthM - 30)), count: 10 })}><Plus className="w-3.5 h-3.5 mr-1" />Расхаживание</Button>
            <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => addEntry({ kind: "cut", cutM: 30, depthM: 0, count: 0, pressureMPa: 0, label: "обрезка нижнего конца" })}><Plus className="w-3.5 h-3.5 mr-1" />Обрезка</Button>
            <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={openCabinet}><CloudDownload className="w-3.5 h-3.5 mr-1" />Из кабинета</Button>
            <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={exportXlsx}><Download className="w-3.5 h-3.5 mr-1" />Excel</Button>
            <label className="inline-flex h-7 items-center rounded-md border border-input px-2 text-[11px] cursor-pointer hover:bg-accent"><Upload className="w-3.5 h-3.5 mr-1" />Импорт
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const fl = e.target.files?.[0]; if (fl) importXlsx(fl); e.target.value = ""; }} /></label>
          </div>
          {p.journal.length === 0 ? (
            <p className="text-muted-foreground">Журнал пуст — труба считается новой. Добавляйте каждую работу: глубину спуска, давление в трубе при спуске/подъёме, число рейсов; расхаживания в одном интервале и обрезки нижнего конца. Работы можно подтянуть из расчётов, сохранённых в кабинете, или загрузить из Excel.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-[11px]" data-testid="ct-life-journal">
                <thead className="bg-muted/50"><tr>
                  <th className="p-1 text-left">Дата</th><th className="p-1 text-left">Описание</th><th className="p-1 text-left">Тип</th>
                  <th className="p-1 text-right">Глубина, м</th><th className="p-1 text-right">Кол-во</th><th className="p-1 text-right">P, МПа</th><th className="p-1 text-left">Среда</th><th className="w-6" />
                </tr></thead>
                <tbody>
                  {p.journal.map((e) => (
                    <tr key={e.id} className="border-t border-border/40">
                      <td className="p-1"><input type="date" defaultValue={e.date} onBlur={(ev) => setEntry(e.id, { date: ev.target.value })} className="h-7 w-[118px] rounded border border-border bg-background px-1" /></td>
                      <td className="p-1"><input defaultValue={e.label} key={e.label} onBlur={(ev) => setEntry(e.id, { label: ev.target.value })} className="h-7 w-full min-w-[120px] rounded border border-border bg-background px-1" /></td>
                      <td className="p-1"><select value={e.kind} onChange={(ev) => setEntry(e.id, { kind: ev.target.value as JournalKind, ...(ev.target.value === "cut" ? { cutM: e.cutM ?? 30 } : {}) })} className="h-7 rounded border border-border bg-background px-1">{(Object.keys(KIND_LABEL) as JournalKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></td>
                      {e.kind === "cut" ? (
                        <td className="p-1 text-right" colSpan={4}><span className="text-muted-foreground mr-1">отрезано снизу, м</span><NumIn value={e.cutM} onCommit={(v) => setEntry(e.id, { cutM: v ?? 0 })} /></td>
                      ) : (
                        <>
                          <td className="p-1 text-right whitespace-nowrap">{e.kind === "recip" && <><NumIn value={e.fromM} onCommit={(v) => setEntry(e.id, { fromM: v })} w="w-16" /><span className="mx-0.5">–</span></>}<NumIn value={e.depthM} onCommit={(v) => setEntry(e.id, { depthM: v ?? 0 })} w="w-16" /></td>
                          <td className="p-1 text-right"><NumIn value={e.count} onCommit={(v) => setEntry(e.id, { count: Math.max(0, Math.round(v ?? 1)) })} w="w-14" /></td>
                          <td className="p-1 text-right"><NumIn value={e.pressureMPa} onCommit={(v) => setEntry(e.id, { pressureMPa: v ?? 0 })} w="w-14" /></td>
                          <td className="p-1"><select value={e.env ?? "normal"} onChange={(ev) => setEntry(e.id, { env: ev.target.value as JournalEnv })} className="h-7 rounded border border-border bg-background px-1">{(Object.keys(ENV_LABEL) as JournalEnv[]).map((k) => <option key={k} value={k}>{ENV_LABEL[k]}</option>)}</select></td>
                        </>
                      )}
                      <td className="p-1"><button aria-label="Удалить" onClick={() => set({ journal: p.journal.filter((x) => x.id !== e.id) })} className="text-muted-foreground hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Швы */}
        <div className="space-y-1">
          <div className="flex items-center gap-2"><p className="font-semibold mr-auto">Сварные швы ({p.welds.length})</p>
            <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => set({ welds: [...p.welds, { id: uid(), sFromCoreM: Math.round(a.currentLengthM / 2), type: "butt" }] })}><Plus className="w-3 h-3 mr-1" />шов</Button></div>
          {p.welds.map((w) => (
            <div key={w.id} className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">от конца у барабана, м</span><NumIn value={w.sFromCoreM} onCommit={(v) => set({ welds: p.welds.map((x) => (x.id === w.id ? { ...x, sFromCoreM: v ?? 0 } : x)) })} />
              <select value={w.type} onChange={(e) => set({ welds: p.welds.map((x) => (x.id === w.id ? { ...x, type: e.target.value as StringWeld["type"] } : x)) })} className="h-7 rounded border border-border bg-background px-1">{(Object.keys(WELD_LABEL) as StringWeld["type"][]).map((k) => <option key={k} value={k}>{WELD_LABEL[k]}</option>)}</select>
              <span className="text-muted-foreground">= {Math.round(a.currentLengthM - w.sFromCoreM)} м от низа</span>
              <button aria-label="Удалить шов" onClick={() => set({ welds: p.welds.filter((x) => x.id !== w.id) })} className="text-muted-foreground hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>
        {p.journal.length > 0 && <Button size="sm" variant="ghost" className="h-6 text-[11px] text-muted-foreground" onClick={() => { if (window.confirm("Очистить журнал работ этой трубы?")) set({ journal: [] }); }}><RotateCcw className="w-3 h-3 mr-1" />Очистить журнал</Button>}

        <p className="text-[10px] text-muted-foreground">
          Модель: малоцикловая усталость (Коффин–Мэнсон) по каждому участку трубы; за рейс — 1 цикл на барабане (деформация по слою намотки) и 2 цикла на гусаке;
          внутреннее давление резко снижает ресурс (до ×6 при 40% от давления разрыва); швы и агрессивная среда увеличивают повреждение; суммирование по Майнеру.
          Журнал сохраняется вместе с расчётом в кабинете («Сохранить»). Решение об отбраковке — по паспорту производителя и данным мониторинга.
        </p>
      </CardContent>

      <Dialog open={cabinetOpen} onOpenChange={setCabinetOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Работы ГНКТ из кабинета</DialogTitle>
            <DialogDescription>Отметьте сохранённые расчёты, выполненные этой трубой, — они добавятся в журнал как рейсы (глубина и давление насоса из расчёта). Или загрузите сохранённый журнал трубы целиком.</DialogDescription>
          </DialogHeader>
          {cabinetRows === null ? <p className="text-sm text-muted-foreground">Загрузка…</p> : cabinetRows.length === 0 ? <p className="text-sm text-muted-foreground">В кабинете нет сохранённых расчётов ГНКТ.</p> : (
            <div className="space-y-1 text-xs">
              {cabinetRows.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-2 rounded border border-border/60 p-2">
                  <input type="checkbox" checked={picked.has(r.id)} onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} />
                  <div className="flex-1 min-w-[160px]"><p className="font-medium">{r.title}</p><p className="text-muted-foreground">{new Date(r.created_at).toLocaleDateString("ru-RU")} · {Math.round(r.depth)} м · {r.pressure.toFixed(1)} МПа</p></div>
                  {r.passport && <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => { onChange(r.passport!); setCabinetOpen(false); toast.success(`Загружен журнал трубы${r.passport!.serial ? ` ${r.passport!.serial}` : ""}: ${r.passport!.journal.length} записей`); }}>Загрузить журнал трубы ({r.passport.journal.length})</Button>}
                </div>
              ))}
              <div className="flex justify-end pt-2"><Button size="sm" onClick={importPicked} disabled={!picked.size}>Добавить отмеченные ({picked.size})</Button></div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
