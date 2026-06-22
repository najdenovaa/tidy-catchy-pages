import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import WOCAnimation from "@/components/WOCAnimation";
import type { WellData, SlurryInput } from "@/lib/cementing-calculations";

interface Props {
  wellData: WellData;
  slurries: SlurryInput[];
}

/**
 * Симулятор ОЗЦ, привязанный к данным программы цементирования.
 * BHCT/BHST/TVD берутся из wellData, плотность раствора — из хвостовой пачки (самой глубокой).
 * Пользователь может выбрать другую пачку и/или скорректировать класс цемента и окно времени.
 */
export default function WOCFromProgram({ wellData, slurries }: Props) {
  // По умолчанию — последняя (хвостовая) пачка цемента
  const defaultIdx = Math.max(0, slurries.length - 1);
  const [slurryIdx, setSlurryIdx] = useState<number>(defaultIdx);
  const [cls, setCls] = useState<"G" | "H">("G");
  const [totalHours, setTotalHours] = useState<number>(48);
  const [overrideBhct, setOverrideBhct] = useState<number | "">("");
  const [overrideBhst, setOverrideBhst] = useState<number | "">("");

  const safeIdx = Math.min(slurryIdx, Math.max(0, slurries.length - 1));
  const slurry = slurries[safeIdx];

  const bhct = useMemo(
    () => (overrideBhct === "" ? (wellData.bottomTempCirc || 60) : Number(overrideBhct)),
    [overrideBhct, wellData.bottomTempCirc],
  );
  const bhst = useMemo(
    () => (overrideBhst === "" ? (wellData.bottomTempStatic || bhct + 15) : Number(overrideBhst)),
    [overrideBhst, wellData.bottomTempStatic, bhct],
  );
  const tvd = wellData.wellDepthTVD || wellData.wellDepthMD || 0;
  const slurryDensity = slurry ? slurry.density : 1900;

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Параметры ОЗЦ — из программы цементирования
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <ReadOnly label="TVD скважины, м" value={tvd.toFixed(0)} />
            <ReadOnly label="BHCT (из программы), °C" value={(wellData.bottomTempCirc || 0).toFixed(1)} />
            <ReadOnly label="BHST (из программы), °C" value={(wellData.bottomTempStatic || 0).toFixed(1)} />
            <ReadOnly
              label="ρ раствора, кг/м³"
              value={slurry ? slurry.density.toFixed(0) : "—"}
              hint={slurry ? `пачка ${safeIdx + 1}: ${slurry.name ?? ""}` : "нет данных"}
            />
            <ReadOnly
              label="Кровля пачки, м MD"
              value={slurry ? slurry.topDepthMD.toFixed(0) : "—"}
            />
            <ReadOnly
              label="Название пачки"
              value={slurry?.name ?? "—"}
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 pt-2 border-t border-border/60">
            <div>
              <Label className="text-xs">Расчётная пачка</Label>
              <select
                value={safeIdx}
                onChange={(e) => setSlurryIdx(+e.target.value)}
                className="w-full px-2 py-1.5 rounded bg-background border border-input text-sm"
                disabled={slurries.length === 0}
              >
                {slurries.length === 0 && <option>— нет пачек —</option>}
                {slurries.map((s, i) => (
                  <option key={i} value={i}>
                    {i + 1}. {s.name} · {s.density} кг/м³
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-xs">Класс цемента</Label>
              <select
                value={cls}
                onChange={(e) => setCls(e.target.value as "G" | "H")}
                className="w-full px-2 py-1.5 rounded bg-background border border-input text-sm"
              >
                <option value="G">Class G</option>
                <option value="H">Class H</option>
              </select>
            </div>
            <div>
              <Label className="text-xs">Окно ОЗЦ, ч</Label>
              <Input
                type="number"
                value={totalHours}
                onChange={(e) => setTotalHours(+e.target.value || 1)}
                className="h-9"
              />
            </div>
            <div>
              <Label className="text-xs">BHCT, переопр. °C</Label>
              <Input
                type="number"
                placeholder={String(wellData.bottomTempCirc || 0)}
                value={overrideBhct}
                onChange={(e) => setOverrideBhct(e.target.value === "" ? "" : +e.target.value)}
                className="h-9"
              />
            </div>
            <div>
              <Label className="text-xs">BHST, переопр. °C</Label>
              <Input
                type="number"
                placeholder={String(wellData.bottomTempStatic || 0)}
                value={overrideBhst}
                onChange={(e) => setOverrideBhst(e.target.value === "" ? "" : +e.target.value)}
                className="h-9"
              />
            </div>
          </div>

          {slurries.length === 0 && (
            <div className="text-xs text-amber-600 dark:text-amber-400">
              На вкладке «Данные» не задано ни одной пачки цемента — используется плотность по умолчанию 1900 кг/м³.
            </div>
          )}
        </CardContent>
      </Card>

      <WOCAnimation
        bhct={bhct}
        bhst={bhst}
        slurryDensity={slurryDensity}
        tvd={tvd}
        cementClass={cls}
        totalHours={totalHours}
      />
    </div>
  );
}

function ReadOnly({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/10 p-2">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="text-sm font-semibold font-mono tabular-nums">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{hint}</div>}
    </div>
  );
}
