import { useState } from "react";
import { DebouncedInput } from "@/components/DebouncedInput";
import { FANN_RPMS, fitRheology, type FannReadings } from "@/lib/cement-rheology";
import type { Rheology } from "@/lib/cementing-calculations";

interface Props {
  rheology: Rheology;
  onChange: (r: Rheology) => void;
}

const MODEL_LABEL = { bingham: "Бингам", powerLaw: "Степенная", hb: "Гершель–Балкли" } as const;

/**
 * Показания вискозиметра Fann 600/300/200/100/6/3. При вводе 600 и 300 PV/YP пересчитываются автоматически,
 * а гидравлика переходит на модель Гершеля–Балкли, подобранную по всем показаниям.
 */
export default function FannEditor({ rheology, onChange }: Props) {
  const fann = rheology.fann;
  const [open, setOpen] = useState(!!fann);
  const fit = fitRheology(fann);

  const setReading = (rpm: number, value: string) => {
    const next: FannReadings = { ...(fann ?? {}), [`r${rpm}`]: parseFloat(value) || 0 };
    const any = Object.values(next).some((v) => (v ?? 0) > 0);
    const r600 = next.r600 ?? 0, r300 = next.r300 ?? 0;
    const upd: Rheology = { ...rheology, fann: any ? next : undefined };
    if (r600 > 0 && r300 > 0 && r600 >= r300) {
      upd.pv = Math.round((r600 - r300) * 10) / 10;
      upd.yp = Math.round(Math.max(0, 2 * r300 - r600) * 0.4788 * 100) / 100;
    }
    onChange(upd);
  };

  return (
    <div className="rounded-md border border-dashed border-border/70 px-2 py-1.5 space-y-1.5">
      <button type="button" onClick={() => setOpen(!open)} className="text-xs text-primary hover:underline">
        {open ? "▾" : "▸"} Показания вискозиметра Fann {fit ? `· ${MODEL_LABEL[fit.best]}, R² ${fit.hb.r2.toFixed(3)}` : "(точнее, чем PV/YP)"}
      </button>
      {open && (
        <>
          <div className="grid grid-cols-6 gap-1">
            {FANN_RPMS.map((rpm) => (
              <div key={rpm} className="space-y-0.5">
                <div className="text-[10px] text-muted-foreground text-center">{rpm}</div>
                <DebouncedInput
                  type="number" step="0.5"
                  value={fann?.[`r${rpm}` as keyof FannReadings] || ""}
                  onChange={(e) => setReading(rpm, e.target.value)}
                  className="h-7 text-xs px-1 text-center"
                />
              </div>
            ))}
          </div>
          {fit ? (
            <div className="text-[11px] text-muted-foreground space-y-0.5">
              <div>
                <span className="font-medium text-foreground">Гершель–Балкли:</span> τ₀ {fit.hb.tau0.toFixed(2)} Па · K {fit.hb.K.toFixed(3)} Па·сⁿ · n {fit.hb.n.toFixed(2)} · R² {fit.hb.r2.toFixed(4)}
              </div>
              <div>
                Бингам R² {fit.bingham.r2.toFixed(3)} · степенная R² {fit.powerLaw.r2.toFixed(3)} · PV/YP по 600/300: {fit.pv600300.toFixed(0)} сПз / {fit.yp600300Pa.toFixed(1)} Па
              </div>
              {fit.binghamLowShearErrorPct > 30 && (
                <div className="text-amber-600">
                  Бингам завышает напряжение на 3 об/мин на {fit.binghamLowShearErrorPct.toFixed(0)}% — при малых расходах трение по PV/YP было бы сильно завышено. Гидравлика считается по Гершелю–Балкли.
                </div>
              )}
            </div>
          ) : (
            <div className="text-[11px] text-muted-foreground">Введите минимум 600, 300 и ещё одно показание (лучше все шесть). Делений шкалы, после кондиционирования при BHCT.</div>
          )}
        </>
      )}
    </div>
  );
}
