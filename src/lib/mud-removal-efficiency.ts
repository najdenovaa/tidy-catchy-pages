// ============================================================================
// MUD REMOVAL EFFICIENCY INDEX (MREI) — Part 5 audit
// Количественный индекс качества вытеснения бурового раствора в кольцевом
// пространстве, по модели Brice & Holmes / Tartaglione / Tehrani с поправками.
//
// Учитывает (per Jiao & Sharma, Pigott, API Tech 10TR4):
//   • иерархия плотности      ρ_disp / ρ_disp-out
//   • иерархия реологии       τy_disp / τy_disp-out
//   • центрирование (standoff)
//   • режим потока (Re)
//   • вращение/реципрокация колонны
//   • время контакта
//   • зенитный угол / эксцентриситет
//   • тип жидкости (буфер: chemical wash > spacer > weighted)
// ============================================================================

import type { CentralizationResult } from "@/lib/centralization-calculations";

export interface FluidProps {
  /** кг/м³ */
  density: number;
  /** Па, динамическое напряжение сдвига (YP) */
  yp: number;
  /** Па·с, пластическая вязкость */
  pv: number;
  /** Тип жидкости */
  kind: "mud" | "spacer" | "chemical_wash" | "cement" | "weighted_spacer" | "elastic_spacer";
  /** Объём, м³ (для расчёта времени контакта) */
  volumeM3?: number;
  /** Метка для отчёта */
  label?: string;
}

export interface MREIInput {
  /** Последовательность жидкостей в порядке закачки: [mud, spacer, cement, ...] */
  fluidChain: FluidProps[];
  /** Профиль центрирования по глубине */
  centralization: CentralizationResult[];
  /** Расход закачки, л/с */
  flowRateLps: number;
  /** Диаметр ствола/предыдущей колонны (для расчёта Re и контактного времени) */
  holeDiameterMm: number;
  /** OD обсадной колонны */
  casingODmm: number;
  /** Вращение колонны, об/мин (0 = нет) */
  rotationRpm?: number;
  /** Реципрокация, м/мин (0 = нет) */
  reciprocationMpm?: number;
}

export interface MREISegment {
  md: number;
  tvd: number;
  zenithDeg: number;
  standoff: number;
  /** MREI спейсер→ОБР, % */
  spacerMud: number;
  /** MREI цемент→спейсер, % */
  cementSpacer: number;
  /** Итоговый MREI цемент→ОБР (произведение по цепочке), % */
  overallMREI: number;
  /** Доминирующий ограничивающий фактор */
  limitingFactor: string;
}

export interface MREIResult {
  segments: MREISegment[];
  averageMREI: number;
  weakIntervals: Array<{ topMd: number; bottomMd: number; minMREI: number; avgStandoff: number }>;
  globalScores: {
    densityHierarchyScore: number;     // 0..1
    rheologyHierarchyScore: number;    // 0..1
    standoffScore: number;             // 0..1
    flowRegimeScore: number;           // 0..1
    rotationScore: number;             // 0..1
    contactTimeScore: number;          // 0..1
  };
  contactTimeMinutes: {
    spacerMin: number;
    cementHeadMin: number;
  };
  recommendations: string[];
}

// ─── Sub-scores (0..1) ──────────────────────────────────────────────

/** Density hierarchy: оптимально ρ_disp / ρ_disp-out ≥ 1.10 (API 10TR4) */
function densityScore(rDisp: number, rOut: number): number {
  if (rOut <= 0) return 0;
  const ratio = rDisp / rOut;
  if (ratio < 1.0) return Math.max(0, 0.3 + (ratio - 0.85) * 2.0); // обратная иерархия — плохо
  if (ratio >= 1.10) return 1.0;
  return 0.5 + (ratio - 1.0) * 5.0;
}

/** YP hierarchy: τy_disp / τy_disp-out > 1 даёт устойчивое вытеснение */
function rheologyScore(ypDisp: number, ypOut: number): number {
  if (ypOut <= 0.1) return 1.0;
  const ratio = ypDisp / ypOut;
  if (ratio < 0.5) return 0.2;
  if (ratio >= 1.2) return 1.0;
  return 0.4 + (ratio - 0.5) * 0.857;
}

/** Standoff: ≥70% хорошо, <50% — каналы ОБР неизбежны (Jakobsen) */
function standoffScore(standoffPct: number): number {
  if (standoffPct >= 80) return 1.0;
  if (standoffPct >= 70) return 0.85;
  if (standoffPct >= 60) return 0.65;
  if (standoffPct >= 50) return 0.45;
  if (standoffPct >= 30) return 0.25;
  return 0.10;
}

/** Reynolds (упрощ.): турбулентность кратно улучшает очистку */
function flowRegimeScore(reAnn: number): number {
  if (reAnn >= 3000) return 1.0;
  if (reAnn >= 2100) return 0.85;
  if (reAnn >= 1000) return 0.55;
  if (reAnn >= 500) return 0.40;
  return 0.30;
}

/** Rotation: +15 rpm = критический порог для очистки узкого зазора */
function rotationScore(rpm: number): number {
  if (rpm <= 0) return 0.55;
  if (rpm >= 20) return 1.0;
  return 0.55 + (rpm / 20) * 0.45;
}

/** Contact time: API рекомендует ≥7 мин для химических промывок, ≥10 для спейсеров */
function contactTimeScore(min: number, kind: FluidProps["kind"]): number {
  const target = kind === "chemical_wash" ? 7 : 10;
  if (min >= target) return 1.0;
  if (min >= target * 0.7) return 0.75;
  if (min >= target * 0.4) return 0.5;
  return 0.25;
}

/** Buffer type multiplier — chemical wash ↔ spacer ↔ weighted */
function bufferTypeMultiplier(kind: FluidProps["kind"]): number {
  switch (kind) {
    case "chemical_wash":  return 1.05;
    case "elastic_spacer": return 1.00;
    case "weighted_spacer":return 0.95;
    case "spacer":         return 0.90;
    case "cement":         return 0.95;
    default:               return 0.85;
  }
}

// ─── Reynolds в кольцевом пространстве, упрощ. Hershel-Bulkley → Bingham ──
function annularReynolds(
  flowRateLps: number, holeDmm: number, casingODmm: number,
  density: number, pv: number, yp: number,
): number {
  const Dh = (holeDmm - casingODmm) / 1000;            // гидр. диаметр, м
  if (Dh <= 0) return 0;
  const annAreaM2 = Math.PI / 4 * (Math.pow(holeDmm / 1000, 2) - Math.pow(casingODmm / 1000, 2));
  if (annAreaM2 <= 0) return 0;
  const v = (flowRateLps / 1000) / annAreaM2;         // м/с
  // Эффективная вязкость по Bingham (Mooney): μ_eff = PV + (YP·Dh) / (6·v)
  const muEff = Math.max(0.001, pv + (yp * Dh) / Math.max(6 * v, 1e-3));
  return density * v * Dh / muEff;
}

// ─── Парный MREI между двумя жидкостями ────────────────────────────
function pairMREI(
  disp: FluidProps, out: FluidProps,
  standoffPct: number, zenithDeg: number,
  reAnn: number, rpm: number, recipMpm: number,
  contactMin: number,
): { mrei: number; limiting: string } {
  const dS = densityScore(disp.density, out.density);
  const rS = rheologyScore(disp.yp, out.yp);
  const sS = standoffScore(standoffPct);
  const fS = flowRegimeScore(reAnn);
  const rotS = rotationScore(rpm);
  const ctS = contactTimeScore(contactMin, disp.kind);
  const bm = bufferTypeMultiplier(disp.kind);

  // Inclination penalty: горизонталь хуже вертикали (gravity не помогает выводить ОБР)
  const incPenalty = 1 - 0.20 * Math.pow(Math.sin(zenithDeg * Math.PI / 180), 2);
  // Reciprocation bonus
  const recipBonus = recipMpm > 0 ? Math.min(0.10, recipMpm * 0.02) : 0;

  // Multiplicative aggregation (слабое звено доминирует)
  let mrei = dS * 0.18 + rS * 0.12 + sS * 0.22 + fS * 0.18 + rotS * 0.18 + ctS * 0.12;
  mrei = mrei * bm * incPenalty + recipBonus;
  mrei = Math.max(0, Math.min(1, mrei));

  // Доминирующий ограничивающий фактор
  const scores = [
    { name: "Стэндофф", v: sS },
    { name: "Режим потока (Re)", v: fS },
    { name: "Вращение", v: rotS },
    { name: "Иерархия плотности", v: dS },
    { name: "Иерархия τy", v: rS },
    { name: "Время контакта", v: ctS },
  ];
  scores.sort((a, b) => a.v - b.v);
  return { mrei: mrei * 100, limiting: scores[0].name };
}

// ─── Main ──────────────────────────────────────────────────────────
export function calculateMREI(input: MREIInput): MREIResult {
  const {
    fluidChain, centralization, flowRateLps,
    holeDiameterMm, casingODmm,
    rotationRpm = 0, reciprocationMpm = 0,
  } = input;

  const mud = fluidChain.find(f => f.kind === "mud");
  const cement = [...fluidChain].reverse().find(f => f.kind === "cement");
  const spacer = fluidChain.find(f =>
    f.kind === "spacer" || f.kind === "chemical_wash" || f.kind === "weighted_spacer" || f.kind === "elastic_spacer",
  );

  if (!mud || !cement) {
    return {
      segments: [], averageMREI: 0, weakIntervals: [],
      globalScores: { densityHierarchyScore: 0, rheologyHierarchyScore: 0, standoffScore: 0,
        flowRegimeScore: 0, rotationScore: 0, contactTimeScore: 0 },
      contactTimeMinutes: { spacerMin: 0, cementHeadMin: 0 },
      recommendations: ["Не заданы базовые жидкости (буровой раствор и цемент)"],
    };
  }

  // Контактное время = volume / flow_in_annulus
  const annAreaM2 = Math.PI / 4 * (Math.pow(holeDiameterMm / 1000, 2) - Math.pow(casingODmm / 1000, 2));
  const flowM3s = flowRateLps / 1000;
  const vAnn = annAreaM2 > 0 ? flowM3s / annAreaM2 : 0;

  const spacerCT = spacer?.volumeM3 && vAnn > 0
    ? (spacer.volumeM3 / annAreaM2) / vAnn / 60
    : 0;
  const cementCT = cement.volumeM3 && vAnn > 0
    ? Math.min(15, (cement.volumeM3 / annAreaM2) / vAnn / 60)
    : 0;

  // Re для спейсера и цемента (общий, без депт-вариации)
  const reSpacer = spacer ? annularReynolds(flowRateLps, holeDiameterMm, casingODmm, spacer.density, spacer.pv, spacer.yp) : 0;
  const reCement = annularReynolds(flowRateLps, holeDiameterMm, casingODmm, cement.density, cement.pv, cement.yp);

  const segments: MREISegment[] = centralization.map(c => {
    const spacerMud = spacer
      ? pairMREI(spacer, mud, c.standoff, c.zenith, reSpacer, rotationRpm, reciprocationMpm, spacerCT)
      : { mrei: 30, limiting: "Нет спейсера" };
    const cementSpacer = spacer
      ? pairMREI(cement, spacer, c.standoff, c.zenith, reCement, rotationRpm, reciprocationMpm, cementCT)
      : pairMREI(cement, mud, c.standoff, c.zenith, reCement, rotationRpm, reciprocationMpm, cementCT);

    const overall = (spacerMud.mrei / 100) * (cementSpacer.mrei / 100) * 100;
    const limiting = spacerMud.mrei < cementSpacer.mrei ? spacerMud.limiting : cementSpacer.limiting;

    return {
      md: c.md, tvd: c.tvd, zenithDeg: c.zenith, standoff: c.standoff,
      spacerMud: spacerMud.mrei,
      cementSpacer: cementSpacer.mrei,
      overallMREI: overall,
      limitingFactor: limiting,
    };
  });

  const averageMREI = segments.length
    ? segments.reduce((s, x) => s + x.overallMREI, 0) / segments.length
    : 0;

  // Weak intervals: contiguous depth ranges with MREI < 50%
  const weakIntervals: MREIResult["weakIntervals"] = [];
  let curr: { topMd: number; bottomMd: number; mins: number[]; standoffs: number[] } | null = null;
  for (const s of segments) {
    if (s.overallMREI < 50) {
      if (!curr) curr = { topMd: s.md, bottomMd: s.md, mins: [s.overallMREI], standoffs: [s.standoff] };
      else { curr.bottomMd = s.md; curr.mins.push(s.overallMREI); curr.standoffs.push(s.standoff); }
    } else if (curr) {
      weakIntervals.push({
        topMd: curr.topMd, bottomMd: curr.bottomMd,
        minMREI: Math.min(...curr.mins),
        avgStandoff: curr.standoffs.reduce((a, b) => a + b, 0) / curr.standoffs.length,
      });
      curr = null;
    }
  }
  if (curr) weakIntervals.push({
    topMd: curr.topMd, bottomMd: curr.bottomMd,
    minMREI: Math.min(...curr.mins),
    avgStandoff: curr.standoffs.reduce((a, b) => a + b, 0) / curr.standoffs.length,
  });

  const avgStandoff = centralization.length ? centralization.reduce((s, c) => s + c.standoff, 0) / centralization.length : 0;

  const globalScores = {
    densityHierarchyScore: spacer ? densityScore(spacer.density, mud.density) * 0.5
      + densityScore(cement.density, spacer.density) * 0.5
      : densityScore(cement.density, mud.density),
    rheologyHierarchyScore: spacer ? rheologyScore(spacer.yp, mud.yp) * 0.5
      + rheologyScore(cement.yp, spacer.yp) * 0.5
      : rheologyScore(cement.yp, mud.yp),
    standoffScore: standoffScore(avgStandoff),
    flowRegimeScore: flowRegimeScore(Math.max(reSpacer, reCement)),
    rotationScore: rotationScore(rotationRpm),
    contactTimeScore: contactTimeScore(spacerCT, spacer?.kind ?? "spacer"),
  };

  const recommendations: string[] = [];
  if (globalScores.standoffScore < 0.65) recommendations.push("Поднять средний стэндофф ≥ 70% (добавить центраторы в наклонных интервалах).");
  if (globalScores.rotationScore < 0.7) recommendations.push("Включить вращение колонны ≥ 15 об/мин — критично для очистки узкой стороны затрубья.");
  if (globalScores.flowRegimeScore < 0.7) recommendations.push("Поднять расход для достижения Re ≥ 2100 (турбулентный режим вытеснения).");
  if (globalScores.densityHierarchyScore < 0.7) recommendations.push("Восстановить иерархию плотности ρ_след > 1.10 · ρ_предыд.");
  if (globalScores.rheologyHierarchyScore < 0.7) recommendations.push("Восстановить иерархию реологии τy_след > τy_предыд (загущение спейсера/цемента).");
  if (globalScores.contactTimeScore < 0.7) recommendations.push("Увеличить объём спейсера для контактного времени ≥ 10 мин.");
  if (weakIntervals.length > 0) {
    recommendations.push(`Слабые зоны (MREI<50%): ${weakIntervals.length} интервал(а), суммарно ${weakIntervals.reduce((s, w) => s + (w.bottomMd - w.topMd), 0).toFixed(0)} м.`);
  }
  if (recommendations.length === 0) recommendations.push("Качество вытеснения соответствует API 10TR4. Дополнительных мер не требуется.");

  return {
    segments, averageMREI, weakIntervals, globalScores,
    contactTimeMinutes: { spacerMin: spacerCT, cementHeadMin: cementCT },
    recommendations,
  };
}
