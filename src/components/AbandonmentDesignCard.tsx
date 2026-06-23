import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Layers, CheckCircle2, AlertTriangle, ShieldCheck } from "lucide-react";
import {
  buildAbandonmentDesign, CEMENT_CLASS_LABEL,
  type CementClass,
} from "@/lib/cement-plug-types";

interface Props {
  defaultReservoirTopMD?: number;
  defaultCasingShoeMD?: number;
  defaultWellTVD?: number;
  defaultOpenHoleDiameterMm?: number;
  defaultCasingIDmm?: number;
  defaultBhctC?: number;
  defaultClass?: CementClass;
}

export default function AbandonmentDesignCard({
  defaultReservoirTopMD = 2500,
  defaultCasingShoeMD = 2400,
  defaultWellTVD = 2700,
  defaultOpenHoleDiameterMm = 215.9,
  defaultCasingIDmm = 152,
  defaultBhctC = 80,
  defaultClass = "G",
}: Props) {
  const [reservoirTop, setReservoirTop] = useState(defaultReservoirTopMD);
  const [casingShoe, setCasingShoe] = useState(defaultCasingShoeMD);
  const [wellTVD, setWellTVD] = useState(defaultWellTVD);
  const [openHoleD, setOpenHoleD] = useState(defaultOpenHoleDiameterMm);
  const [casingID, setCasingID] = useState(defaultCasingIDmm);
  const [bhct, setBhct] = useState(defaultBhctC);
  const [gradient, setGradient] = useState(2.5);
  const [cementClass, setCementClass] = useState<CementClass>(defaultClass);
  const [plugLen, setPlugLen] = useState(50);

  const design = useMemo(() => {
    if (wellTVD <= 0 || reservoirTop <= 0) return null;
    return buildAbandonmentDesign({
      reservoirTopMD: reservoirTop,
      casingShoeMD: casingShoe,
      wellTVD,
      openHoleDiameterMm: openHoleD,
      casingIDmm: casingID,
      plugLengthM: plugLen,
      cementClass,
      bhctC: bhct,
      geothermalGradientCPer100m: gradient,
    });
  }, [reservoirTop, casingShoe, wellTVD, openHoleD, casingID, bhct, gradient, cementClass, plugLen]);

  return (
    <Card>
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm flex items-center gap-2">
          <Layers className="w-4 h-4" />
          Проект ликвидации скважины — мосты, нормы РФ и NORSOK D-010
          {design && (
            <div className="ml-auto flex gap-1">
              <Badge variant={design.passedRF ? "default" : "destructive"} className="text-[10px]">
                РФ {design.passedRF ? "✓" : "✗"}
              </Badge>
              <Badge variant={design.passedNORSOK ? "default" : "destructive"} className="text-[10px]">
                NORSOK {design.passedNORSOK ? "✓" : "✗"}
              </Badge>
            </div>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        {/* Параметры */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <NumField label="Кровля пласта, м MD" value={reservoirTop} onChange={setReservoirTop} step={10} />
          <NumField label="Башмак ОК, м MD" value={casingShoe} onChange={setCasingShoe} step={10} />
          <NumField label="Забой TVD, м" value={wellTVD} onChange={setWellTVD} step={10} />
          <NumField label="Длина моста, м" value={plugLen} onChange={setPlugLen} step={10} />
          <NumField label="D ствола (OH), мм" value={openHoleD} onChange={setOpenHoleD} step={1} />
          <NumField label="ВД ОК, мм" value={casingID} onChange={setCasingID} step={1} />
          <NumField label="BHCT забой, °C" value={bhct} onChange={setBhct} step={1} />
          <NumField label="Градиент, °C/100м" value={gradient} onChange={setGradient} step={0.1} />
          <div className="space-y-1 col-span-2 sm:col-span-4">
            <Label className="text-xs">Класс цемента (для всех мостов)</Label>
            <Select value={cementClass} onValueChange={(v) => setCementClass(v as CementClass)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(CEMENT_CLASS_LABEL) as CementClass[]).map((k) => (
                  <SelectItem key={k} value={k}>{CEMENT_CLASS_LABEL[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {design && (
          <>
            {/* Сводка */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <Mini k="Мостов" v={`${design.plugs.length}`} />
              <Mini k="Σ цемент" v={`${design.totalCementM3.toFixed(2)} м³`} />
              <Mini k="Σ ОЗЦ" v={`${design.totalWOCHours.toFixed(1)} ч`} />
              <Mini k="Соответствие" v={design.passedRF && design.passedNORSOK ? "обе нормы" : design.passedRF ? "только РФ" : design.passedNORSOK ? "только NORSOK" : "не соотв."} good={design.passedRF && design.passedNORSOK} />
            </div>

            {/* Таблица мостов */}
            <div className="rounded border border-border/60 overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left px-2 py-1">№</th>
                    <th className="text-left px-2 py-1">Мост</th>
                    <th className="text-left px-2 py-1">Барьер</th>
                    <th className="text-right px-2 py-1">Верх, м</th>
                    <th className="text-right px-2 py-1">Низ, м</th>
                    <th className="text-right px-2 py-1">L, м</th>
                    <th className="text-right px-2 py-1">V цем., м³</th>
                    <th className="text-right px-2 py-1">ОЗЦ, ч</th>
                  </tr>
                </thead>
                <tbody>
                  {design.plugs.map(p => (
                    <tr key={p.index} className="border-t border-border/40">
                      <td className="px-2 py-1">{p.index}</td>
                      <td className="px-2 py-1">
                        <div className="font-medium">{p.name}</div>
                        <div className="text-[10px] text-muted-foreground">{p.purpose}</div>
                      </td>
                      <td className="px-2 py-1">
                        <Badge variant="outline" className="text-[10px] capitalize">{p.barrierType}</Badge>
                      </td>
                      <td className="px-2 py-1 text-right">{p.topMD.toFixed(0)}</td>
                      <td className="px-2 py-1 text-right">{p.bottomMD.toFixed(0)}</td>
                      <td className="px-2 py-1 text-right font-medium">{p.lengthM.toFixed(0)}</td>
                      <td className="px-2 py-1 text-right">{p.cementVolumeM3.toFixed(2)}</td>
                      <td className="px-2 py-1 text-right">{p.recommendedWOCHours.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* ASCII-схема */}
            <AbandonmentDiagram design={design} wellTVD={wellTVD} reservoirTop={reservoirTop} casingShoe={casingShoe} />

            {/* Проверки */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <ComplianceList title="РФ ПБ НГП №534" checks={design.complianceRF} icon={<ShieldCheck className="w-4 h-4" />} passed={design.passedRF} />
              <ComplianceList title="NORSOK D-010" checks={design.complianceNORSOK} icon={<ShieldCheck className="w-4 h-4" />} passed={design.passedNORSOK} />
            </div>

            <div className="text-[10px] text-muted-foreground italic">
              ОЗЦ каждого моста рассчитано по локальной температуре (геотермический градиент от BHCT забоя)
              и кинетике класса цемента. Объём — π/4·D²·L при выбранном D в зоне моста.
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function NumField({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input type="number" step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-8 text-xs" />
    </div>
  );
}

function Mini({ k, v, good }: { k: string; v: string; good?: boolean }) {
  return (
    <div className="rounded border border-border/60 px-2 py-1">
      <div className="text-[10px] text-muted-foreground">{k}</div>
      <div className={`font-semibold ${good === true ? "text-emerald-600 dark:text-emerald-400" : good === false ? "text-destructive" : ""}`}>{v}</div>
    </div>
  );
}

function ComplianceList({
  title, checks, icon, passed,
}: {
  title: string;
  checks: { requirement: string; passed: boolean; message: string; reference?: string }[];
  icon: React.ReactNode;
  passed: boolean;
}) {
  return (
    <div className={`rounded border p-2 ${passed ? "border-emerald-500/40 bg-emerald-500/5" : "border-destructive/40 bg-destructive/5"}`}>
      <div className="flex items-center gap-2 text-xs font-semibold mb-2">
        {icon}{title}
        <Badge variant={passed ? "default" : "destructive"} className="ml-auto text-[10px]">
          {passed ? "соответствует" : "несоответствие"}
        </Badge>
      </div>
      <div className="space-y-1">
        {checks.map((c, i) => (
          <div key={i} className="flex items-start gap-2 text-[11px] border-t border-border/40 pt-1">
            {c.passed
              ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
              : <AlertTriangle className="w-3.5 h-3.5 text-destructive mt-0.5 shrink-0" />}
            <div className="flex-1">
              <div className="font-medium">{c.requirement}</div>
              <div className="text-muted-foreground">{c.message}</div>
              {c.reference && <div className="text-[10px] text-muted-foreground italic">{c.reference}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AbandonmentDiagram({
  design, wellTVD, reservoirTop, casingShoe,
}: {
  design: ReturnType<typeof buildAbandonmentDesign>;
  wellTVD: number;
  reservoirTop: number;
  casingShoe: number;
}) {
  const totalDepth = Math.max(wellTVD, reservoirTop + 100);
  const H = 220; // px
  const pxPerM = H / totalDepth;
  const colors: Record<string, string> = {
    primary: "hsl(0 80% 55%)",
    secondary: "hsl(40 85% 55%)",
    surface: "hsl(150 70% 45%)",
  };
  return (
    <div className="rounded border border-border/60 p-3 bg-background/40">
      <div className="text-xs font-medium mb-2">Схема расстановки мостов</div>
      <div className="flex gap-4">
        <svg width="140" height={H + 30} className="shrink-0">
          {/* ствол */}
          <rect x="55" y="10" width="30" height={H} fill="hsl(var(--muted))" stroke="hsl(var(--border))" />
          {/* башмак ОК */}
          <line x1="50" y1={10 + casingShoe * pxPerM} x2="90" y2={10 + casingShoe * pxPerM}
                stroke="hsl(var(--foreground))" strokeWidth="2" strokeDasharray="2 2" />
          <text x="95" y={10 + casingShoe * pxPerM + 3} fontSize="9" fill="hsl(var(--muted-foreground))">башмак</text>
          {/* кровля пласта */}
          <rect x="55" y={10 + reservoirTop * pxPerM} width="30" height={Math.max(8, (totalDepth - reservoirTop) * pxPerM)} fill="hsl(45 90% 50% / 0.25)" />
          <text x="95" y={10 + reservoirTop * pxPerM + 8} fontSize="9" fill="hsl(45 90% 50%)">пласт</text>
          {/* мосты */}
          {design.plugs.map(p => (
            <g key={p.index}>
              <rect
                x="55"
                y={10 + p.topMD * pxPerM}
                width="30"
                height={Math.max(2, p.lengthM * pxPerM)}
                fill={colors[p.barrierType]}
                opacity={0.85}
              />
              <text x="20" y={10 + (p.topMD + p.lengthM / 2) * pxPerM + 3} fontSize="9" fill={colors[p.barrierType]} fontWeight="bold">
                №{p.index}
              </text>
            </g>
          ))}
        </svg>
        <div className="flex-1 space-y-1 text-[11px]">
          {design.plugs.map(p => (
            <div key={p.index} className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm" style={{ background: colors[p.barrierType] }} />
              <div className="font-medium">№{p.index}</div>
              <div className="text-muted-foreground">{p.name}</div>
              <div className="ml-auto text-muted-foreground">{p.topMD.toFixed(0)}–{p.bottomMD.toFixed(0)} м</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
