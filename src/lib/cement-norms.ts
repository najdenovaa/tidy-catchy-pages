/**
 * Проверка программы цементирования по требованиям ПБ НГП (ФНП «Правила безопасности в нефтяной и газовой
 * промышленности», приказ Ростехнадзора № 534) и отраслевым рекомендациям.
 *
 * Тип требования указан явно: «норма ПБ» — требование, текст которого подтверждён (формулировки раздела
 * о креплении скважин совпадают с РД 08-200-98 п. 2.6.x); «по аналогии» — норма для бурового раствора,
 * применённая к затрубью при цементировании; «рекомендация» — отраслевая практика / API.
 * Номера пунктов действующей редакции ФНП технолог сверяет по своему экземпляру Правил.
 */
import {
  type WellData, type SlurryInput, type DrillingFluid, type BufferFluid, type PressureProfileResult,
} from "./cementing-calculations";
import type { LabProgramResult } from "./cement-program";

export type CasingType = NonNullable<WellData["casingType"]>;
export const CASING_TYPE_LABEL: Record<CasingType, string> = {
  direction: "Направление", conductor: "Кондуктор", intermediate: "Промежуточная (техническая)",
  production: "Эксплуатационная", liner: "Хвостовик",
};

export type NormStatus = "ok" | "fail" | "warn" | "manual" | "na";
export type NormKind = "норма ПБ" | "по аналогии" | "рекомендация";

export interface NormCheck {
  id: string;
  title: string;
  requirement: string;
  actual: string;
  status: NormStatus;
  kind: NormKind;
  reference: string;
}

export interface NormsInput {
  wellData: WellData;
  slurries: SlurryInput[];
  buffers: BufferFluid[];
  drillingFluid: DrillingFluid;
  pressure: PressureProfileResult | null;
  lab: LabProgramResult | null;
  casingType: CasingType;
  /** В составе техники есть станция контроля цементирования */
  hasSkc: boolean;
}

const f = (v: number, d = 0) => (Number.isFinite(v) ? v.toFixed(d).replace(".", ",") : "—");
const PB = "ПБ НГП (ФНП № 534), крепление скважин";

/** Минимальное требуемое превышение давления над пластовым, МПа (норма для бурового раствора). */
export function requiredOverbalanceMPa(porePressureMPa: number, depthTVD: number): number {
  return depthTVD <= 1200 ? Math.min(0.1 * porePressureMPa, 1.5) : Math.min(0.05 * porePressureMPa, 2.5);
}

export function inferCasingType(w: WellData): CasingType {
  if ((w.reservoirLayers ?? []).length > 0) return "production";
  if (w.casingDepthMD <= 60) return "direction";
  if (w.prevCasingDepth <= 60 || w.casingDepthMD <= 1000) return "conductor";
  return "intermediate";
}

export function checkNorms(n: NormsInput): NormCheck[] {
  const w = n.wellData;
  const out: NormCheck[] = [];
  const toc = n.slurries.length ? Math.min(...n.slurries.map((s) => s.topDepthMD)) : w.casingDepthMD;
  const layers = w.reservoirLayers ?? [];
  const gas = layers.some((l) => /газ/i.test(l.fluidType || ""));

  // 1. Подъём над кровлей продуктивных горизонтов
  if (n.casingType === "production" || n.casingType === "liner" || layers.length) {
    if (layers.length) {
      const topPay = Math.min(...layers.map((l) => l.topMD));
      const above = topPay - toc;
      out.push({
        id: "rise-pay", title: "Высота подъёма тампонажного раствора над кровлей продуктивных горизонтов",
        requirement: "не менее 150–300 м", actual: `${f(above)} м (кровля ${f(topPay)} м, верх цемента ${f(toc)} м)`,
        status: above >= 150 ? (gas && above < 300 ? "warn" : "ok") : "fail", kind: "норма ПБ",
        reference: `${PB} (РД 08-200-98 п. 2.6.7)${gas && above >= 150 && above < 300 ? "; для газовых пластов принимать верхнюю границу 300 м" : ""}`,
      });
    } else {
      out.push({ id: "rise-pay", title: "Высота подъёма над кровлей продуктивных горизонтов", requirement: "не менее 150–300 м", actual: "пласты не заданы", status: "manual", kind: "норма ПБ", reference: `${PB} (РД 08-200-98 п. 2.6.7)` });
    }
  }

  // 2. Направления и кондукторы — до устья
  if (n.casingType === "direction" || n.casingType === "conductor") {
    out.push({
      id: "rise-surface", title: `${CASING_TYPE_LABEL[n.casingType]}: цементирование до устья`,
      requirement: "тампонажный раствор до устья", actual: toc <= 1 ? "до устья" : `верх цемента ${f(toc)} м`,
      status: toc <= 1 ? "ok" : "fail", kind: "норма ПБ", reference: `${PB} (РД 08-200-98 п. 2.6.6)`,
    });
  }

  // 3. Перекрытие башмака предыдущей колонны
  if ((n.casingType === "intermediate" || n.casingType === "production") && w.prevCasingDepth > 0) {
    const overlap = w.prevCasingDepth - toc;
    out.push({
      id: "overlap", title: "Перекрытие башмака предыдущей колонны цементом",
      requirement: "не менее 150 м выше башмака (или до устья)", actual: toc <= 1 ? "до устья" : `${f(overlap)} м`,
      status: toc <= 1 || overlap >= 150 ? "ok" : overlap > 0 ? "warn" : "fail", kind: "рекомендация",
      reference: "отраслевая практика; герметичность межколонного пространства",
    });
  }

  // 4. Плотность тампонажного раствора не ниже плотности бурового
  n.slurries.forEach((s) => {
    const ok = s.density * 1000 >= n.drillingFluid.density - 1;
    out.push({
      id: `dens-${s.name}`, title: `Плотность раствора «${s.name}» не ниже плотности бурового раствора`,
      requirement: `≥ ${f(n.drillingFluid.density / 1000, 2)} г/см³ (как правило)`, actual: `${f(s.density, 2)} г/см³`,
      status: ok ? "ok" : "warn", kind: "норма ПБ", reference: `${PB} (РД 08-200-98 п. 2.6.12); допускается облегчённый при обосновании`,
    });
  });

  // 5. Продолжительность цементирования ≤ 75% времени загустевания
  n.lab?.slurries.forEach((ls, i) => {
    const tt = n.slurries[i]?.thickeningTime30Bc || 0;
    out.push({
      id: `tt-${ls.slurryName}`, title: `Время загустевания раствора «${ls.slurryName}»`,
      requirement: `продолжительность цементирования ≤ 75% времени загустевания: ≥ ${f(ls.jobTimeMin / 0.75)} мин`,
      actual: tt > 0 ? `${f(tt)} мин; работа ${f(ls.jobTimeMin)} мин (${f((ls.jobTimeMin / tt) * 100)}%)` : "время загустевания не задано",
      status: tt > 0 ? (ls.jobTimeMin <= 0.75 * tt ? "ok" : "fail") : "manual", kind: "норма ПБ",
      reference: `${PB} (РД 08-200-98 п. 2.6.15)`,
    });
  });

  // 6. Исключение гидроразрыва / поглощения
  const zc = n.pressure?.zoneChecks ?? [];
  if (zc.length) {
    const worst = [...zc].sort((a, b) => a.marginMPa - b.marginMPa)[0];
    out.push({
      id: "frac", title: "Давление при цементировании не вызывает гидроразрыв / поглощение",
      requirement: "макс. давление в затрубье < давления ГРП/поглощения в каждой точке",
      actual: `мин. запас ${f(worst.marginMPa, 2)} МПа — ${worst.name}`, status: worst.marginMPa >= 0 ? (worst.marginMPa < 0.5 ? "warn" : "ok") : "fail",
      kind: "норма ПБ", reference: `${PB} (РД 08-200-98 п. 2.6.8)`,
    });
  }

  // 7. Превышение гидростатики над пластовым
  const pore = zc.filter((z) => z.porePressureMPa > 0);
  if (pore.length) {
    const rows = pore.map((z) => {
      const req = requiredOverbalanceMPa(z.porePressureMPa, z.depthTVD);
      return { z, req, ob: z.minPressureMPa - z.porePressureMPa };
    });
    const worst = rows.sort((a, b) => (a.ob - a.req) - (b.ob - b.req))[0];
    out.push({
      id: "overbalance", title: "Превышение давления в затрубье над пластовым за всю операцию",
      requirement: "до 1200 м — 10% (≤ 1,5 МПа); глубже — 5% (≤ 2,5 МПа)",
      actual: `мин. превышение ${f(worst.ob, 2)} МПа при требуемом ${f(worst.req, 2)} — ${worst.z.name}`,
      status: worst.ob < 0 ? "fail" : worst.ob < worst.req ? "warn" : "ok", kind: "по аналогии",
      reference: "ПБ НГП — требование к плотности бурового раствора, применено к затрубью при цементировании",
    });
  }

  // 8. Лабораторный анализ
  out.push({
    id: "lab", title: "Лабораторный анализ тампонажного материала перед применением",
    requirement: "применение тампонажных материалов без лабораторного анализа не допускается",
    actual: n.slurries.every((s) => (s.thickeningTime30Bc || 0) > 0) ? "время загустевания задано — подтвердите протоколом испытаний на партии" : "нет данных испытаний (расчётный протокол не заменяет анализ)",
    status: "manual", kind: "норма ПБ", reference: `${PB} (РД 08-200-98 п. 2.6.14)`,
  });

  // 9. Температурный диапазон
  const bhst = w.bottomTempStatic;
  const hasSilica = n.slurries.some((s) => s.additives.some((a) => /кварц|кремнез|silica/i.test(a.name)));
  out.push({
    id: "temp", title: "Тампонажный материал соответствует диапазону статических температур",
    requirement: "камень работоспособен от кровли до забоя; при T > 110 °C — стабилизация кремнезёмом",
    actual: `${n.lab ? `${f(Math.min(...n.lab.slurries.map((s) => s.tTopStaticC)))}–${f(bhst)} °C` : `до ${f(bhst)} °C`}${bhst > 110 ? (hasSilica ? "; кремнезём есть" : "; кремнезём НЕ добавлен") : ""}`,
    status: bhst > 110 && !hasSilica ? "fail" : "manual", kind: "норма ПБ", reference: `${PB} (РД 08-200-98 п. 2.6.12)`,
  });

  // 10. Регистрация параметров
  out.push({
    id: "record", title: "Регистрация параметров процесса цементирования",
    requirement: "давление, расход, плотность регистрируются в процессе", actual: n.hasSkc ? "СКЦ в составе техники" : "станция контроля не предусмотрена",
    status: n.hasSkc ? "ok" : "fail", kind: "норма ПБ", reference: `${PB} (РД 08-200-98 п. 2.6.11)`,
  });

  // 11. Центрирование
  const prof = w.standoffProfile?.filter((p) => p.md >= toc && p.md <= w.casingDepthMD) ?? [];
  out.push({
    id: "standoff", title: "Центрирование колонны в интервале цементирования",
    requirement: "отступ от стенки не менее 67%", actual: prof.length ? `минимум ${f(Math.min(...prof.map((p) => p.standoffPct)))}%, средний ${f(prof.reduce((t, p) => t + p.standoffPct, 0) / prof.length)}%` : "расчёт центрирования не выполнен",
    status: prof.length ? (Math.min(...prof.map((p) => p.standoffPct)) >= 67 ? "ok" : "warn") : "manual", kind: "рекомендация", reference: "API RP 10D-2",
  });

  // 12. Иерархия плотности буфера
  if (n.buffers.length && n.slurries.length) {
    const b = n.buffers[n.buffers.length - 1];
    const mud = n.drillingFluid.density, lead = n.slurries[0].density * 1000;
    const ok = b.density >= mud && b.density <= lead;
    out.push({
      id: "buffer", title: "Плотность буфера между плотностями бурового и тампонажного растворов",
      requirement: `${f(mud)} ≤ ρ буфера ≤ ${f(lead)} кг/м³`, actual: `${f(b.density)} кг/м³`,
      status: ok ? "ok" : "warn", kind: "рекомендация", reference: "API TR 10TR4 (вытеснение бурового раствора)",
    });
  }

  // 13. Опрессовка колонны
  const maxSurf = n.pressure?.points.reduce((m, p) => Math.max(m, p.surfacePressure), 0) ?? 0;
  out.push({
    id: "pt", title: "Испытание колонны на герметичность после ОЗЦ",
    requirement: "опрессовка обязательна; давление — по проекту, рекомендуется ≥ 1,1 × максимального рабочего",
    actual: maxSurf > 0 ? `макс. давление на устье при цементировании ${f(maxSurf, 1)} МПа → опрессовка не ниже ${f(maxSurf * 1.1, 1)} МПа` : "—",
    status: "manual", kind: "норма ПБ", reference: `${PB} (РД 08-200-98 п. 2.6.18); значение давления — рекомендация`,
  });

  return out;
}

export function normsSummary(checks: NormCheck[]) {
  return {
    fail: checks.filter((c) => c.status === "fail").length,
    warn: checks.filter((c) => c.status === "warn").length,
    ok: checks.filter((c) => c.status === "ok").length,
    manual: checks.filter((c) => c.status === "manual").length,
  };
}
