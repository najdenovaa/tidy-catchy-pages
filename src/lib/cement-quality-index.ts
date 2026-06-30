// Cement Quality Index (CQI) — расчёт качества цементирования по глубине
import type { WellData, SlurryInput, BufferFluid, DrillingFluid, PressurePoint } from "./cementing-calculations";
import { getCavernCoeffAtDepth } from "./cementing-calculations";
import type { CentralizationResult } from "./centralization-calculations";

export type BondGrade = 'A' | 'B' | 'C' | 'D' | 'F';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface CementQualityPoint {
  depthMD: number;
  tvd: number;
  zenith: number;
  standoff: number;          // %
  eccentricity: number;      // 0..1
  cavernCoeff: number;
  isOpenHole: boolean;
  hasTurbulizer: boolean;
  annularVelocity: number;   // м/с
  reynolds: number;
  flowRegime: 'laminar' | 'transitional' | 'turbulent';
  densityRatio: number;      // ρ_cem / ρ_mud
  ypRatio: number;
  pvRatio: number;
  contactTimeMin: number;    // время контакта буфера
  displacementEfficiency: number; // 0..100 %
  cementQualityIndex: number;     // 0..100
  bondGrade: BondGrade;
  mudChannelRisk: RiskLevel;
}

export interface CQISummary {
  avgCQI: number;
  minCQI: number;
  maxCQI: number;
  avgGrade: BondGrade;
  badZonesCount: number;          // грейд D/F
  badZonesLength: number;         // м
  avgStandoff: number;
  avgContact: number;
  avgFlowRegime: 'laminar' | 'transitional' | 'turbulent';
  densityHierarchyOK: boolean;
  rheologyHierarchyOK: boolean;   // YP_mud < YP_buf < YP_cem (API RP 65)
  bufDensity: number;             // kg/m³ (volume-weighted)
  bufYP: number;                  // lbf/100ft²
  bufPV: number;                  // cp
  criticalZones: { fromMD: number; toMD: number; cqi: number; reason: string }[];
}

export function getBondGrade(cqi: number): BondGrade {
  if (cqi >= 85) return 'A';
  if (cqi >= 70) return 'B';
  if (cqi >= 55) return 'C';
  if (cqi >= 40) return 'D';
  return 'F';
}

export function gradeColor(g: BondGrade): string {
  switch (g) {
    case 'A': return 'hsl(140, 60%, 45%)';
    case 'B': return 'hsl(90, 55%, 45%)';
    case 'C': return 'hsl(45, 85%, 50%)';
    case 'D': return 'hsl(20, 85%, 50%)';
    case 'F': return 'hsl(0, 75%, 50%)';
  }
}

export function cqiColor(cqi: number): string {
  return gradeColor(getBondGrade(cqi));
}

function riskFromCQI(cqi: number): RiskLevel {
  if (cqi >= 75) return 'low';
  if (cqi >= 55) return 'medium';
  if (cqi >= 40) return 'high';
  return 'critical';
}

function calcCQI(args: {
  standoff: number;
  densityRatio: number;
  ypRatio: number;
  isOpenHole: boolean;
  cavernCoeff: number;
  annularVelocity: number;
  reynolds: number;
  contactTimeMin: number;
  hasTurbulizer: boolean;
  densityHierarchyOK: boolean;
  rheologyHierarchyOK: boolean;
  bufYpVsMud: number;   // YP_buf / YP_mud — должно быть > 1
}): number {
  const { standoff, densityRatio, ypRatio, isOpenHole, cavernCoeff,
    annularVelocity, reynolds, contactTimeMin, hasTurbulizer,
    densityHierarchyOK, rheologyHierarchyOK, bufYpVsMud } = args;

  let score = 0;
  // 1. Standoff (30%)
  score += 30 * Math.min(1, Math.max(0, standoff / 80));
  // 2. Density hierarchy ρ_cem > ρ_buf > ρ_mud (20%)
  score += 20 * Math.min(1, Math.max(0, (densityRatio - 0.9) / 0.5));
  // 3. Rheology cement vs mud (10%)
  score += 10 * Math.min(1, Math.max(0, ypRatio / 2));
  // 4. Flow regime (20%)
  if (reynolds > 3000) score += 20;
  else if (reynolds > 2100) score += 15;
  else score += 20 * Math.min(1, annularVelocity / 0.5);
  // 5. Contact time (10%)
  score += 10 * Math.min(1, contactTimeMin / 10);
  // 6. Buffer/spacer rheology vs mud (10%) — API RP 65: YP_буф > YP_бр для эфф. вытеснения
  score += 10 * Math.min(1, Math.max(0, (bufYpVsMud - 1) / 1.5));

  // Жёсткие штрафы за нарушение иерархии
  if (!densityHierarchyOK) score *= 0.85;
  if (!rheologyHierarchyOK) score *= 0.88;

  if (isOpenHole) score *= 0.93;
  if (cavernCoeff > 1.3) score *= Math.max(0.5, 1 - (cavernCoeff - 1.3) * 0.5);
  if (hasTurbulizer) score *= 1.05;

  return Math.max(0, Math.min(100, score));
}

// Простая оценка displacement efficiency (для отображения)
function calcDisplacementEfficiency(
  standoff: number, reynolds: number, ypRatio: number, hasTurbulizer: boolean,
  bufYpVsMud: number = 1, densityHierarchyOK: boolean = true, rheologyHierarchyOK: boolean = true,
): number {
  let eff = 50 + (standoff - 50) * 0.6;
  if (reynolds > 3000) eff += 15;
  else if (reynolds > 2100) eff += 8;
  eff += Math.min(10, ypRatio * 5 - 5);
  // Буфер с YP > YP_бр улучшает срыв глинистой корки
  eff += Math.min(8, Math.max(-5, (bufYpVsMud - 1) * 6));
  if (hasTurbulizer) eff += 5;
  if (!densityHierarchyOK) eff *= 0.9;
  if (!rheologyHierarchyOK) eff *= 0.92;
  return Math.max(0, Math.min(100, eff));
}

export interface CQIInput {
  wellData: WellData;
  slurries: SlurryInput[];
  buffers: BufferFluid[];
  drillingFluid: DrillingFluid;
  centralization: CentralizationResult[] | undefined;
  pressureData: PressurePoint[];
  casingDepthMD: number;
  annVPM: number;                  // m³/m (== m²)
  prevCasingDepth: number;
  contactTimeByDepth: { depthMD: number; bufferContactMin: number }[];
}

export function calculateCementQuality(input: CQIInput): {
  points: CementQualityPoint[];
  summary: CQISummary;
  recommendations: string[];
} {
  const { wellData, slurries, buffers, drillingFluid, centralization,
    casingDepthMD, annVPM, prevCasingDepth, contactTimeByDepth } = input;

  const mudDensity = drillingFluid.density || 1100;
  const mudYP = drillingFluid.rheology?.yp || 20;
  const mudPV = drillingFluid.rheology?.pv || 25;

  // Repr. cement (нижний — ближайший к забою)
  const repCem = slurries.length > 0 ? slurries[slurries.length - 1] : undefined;
  const cemDensity = repCem?.density ? repCem.density * 1000 : 1850;
  const cemYP = repCem?.rheology?.yp || 30;
  const cemPV = repCem?.rheology?.pv || 50;

  // Volume-weighted buffer rheology (несколько пачек)
  const bufTotalVol = buffers.reduce((s, b) => s + (b.volume || 0), 0);
  const bufDensity = bufTotalVol > 0
    ? buffers.reduce((s, b) => s + (b.volume || 0) * (b.density || 0), 0) / bufTotalVol
    : (buffers[0]?.density || 1200);
  const bufYP = bufTotalVol > 0
    ? buffers.reduce((s, b) => s + (b.volume || 0) * (b.rheology?.yp ?? 25), 0) / bufTotalVol
    : (buffers[0]?.rheology?.yp ?? 25);
  const bufPV = bufTotalVol > 0
    ? buffers.reduce((s, b) => s + (b.volume || 0) * (b.rheology?.pv ?? 25), 0) / bufTotalVol
    : (buffers[0]?.rheology?.pv ?? 25);
  const densityHierarchyOK = cemDensity > bufDensity && bufDensity > mudDensity;
  const rheologyHierarchyOK = cemYP > bufYP && bufYP > mudYP;
  const bufYpVsMud = bufYP / Math.max(1, mudYP);

  const densityRatio = cemDensity / mudDensity;
  const ypRatio = cemYP / Math.max(1, mudYP);
  const pvRatio = cemPV / Math.max(1, mudPV);

  // Flow rate (берём первый шаг закачки)
  const flowLps = slurries[0]?.flowRateSteps?.[0]?.rateLps || 10;
  const qM3s = flowLps / 1000;
  const vMs = annVPM > 0 ? qM3s / annVPM : 0;

  // Гидравл. диаметр (грубо)
  const dHole = wellData.holeDiameter / 1000; // m
  const dCas = wellData.casingOD / 1000;
  const dHyd = Math.max(0.01, dHole - dCas);
  // Эффективная вязкость (Bingham approx)
  const muEff = (mudPV + mudYP * dHyd / Math.max(0.001, vMs)) / 1000; // Pa·s
  const reynolds = mudDensity * vMs * dHyd / Math.max(1e-4, muEff);

  // Build CQI points using centralization steps when available
  let steps: { md: number; tvd: number; zenith: number; standoff: number; ecc: number; hasTurbulizer: boolean }[] = [];
  if (centralization && centralization.length > 0) {
    steps = centralization.map(c => ({
      md: c.md, tvd: c.tvd, zenith: c.zenith,
      standoff: c.standoff, ecc: c.eccentricity, hasTurbulizer: c.hasTurbulizer,
    }));
  } else {
    const N = 50;
    for (let i = 0; i <= N; i++) {
      const md = (i / N) * casingDepthMD;
      steps.push({ md, tvd: md, zenith: 0, standoff: 70, ecc: 0.3, hasTurbulizer: false });
    }
  }

  // Map for fast contact lookup
  const contactSorted = [...contactTimeByDepth].sort((a, b) => a.depthMD - b.depthMD);
  const lookupContact = (md: number): number => {
    if (contactSorted.length === 0) return 5;
    let nearest = contactSorted[0];
    let best = Math.abs(nearest.depthMD - md);
    for (const c of contactSorted) {
      const d = Math.abs(c.depthMD - md);
      if (d < best) { best = d; nearest = c; }
    }
    return nearest.bufferContactMin;
  };

  const points: CementQualityPoint[] = steps.map(s => {
    const isOpenHole = s.md > prevCasingDepth;
    const cavern = getCavernCoeffAtDepth(s.md, wellData.cavernCoeff, wellData.cavernIntervals);
    const contactMin = lookupContact(s.md);
    const cqi = calcCQI({
      standoff: s.standoff,
      densityRatio,
      ypRatio,
      isOpenHole,
      cavernCoeff: cavern,
      annularVelocity: vMs,
      reynolds,
      contactTimeMin: contactMin,
      hasTurbulizer: s.hasTurbulizer,
      densityHierarchyOK,
      rheologyHierarchyOK,
      bufYpVsMud,
    });
    const disp = calcDisplacementEfficiency(s.standoff, reynolds, ypRatio, s.hasTurbulizer, bufYpVsMud, densityHierarchyOK, rheologyHierarchyOK);
    const regime: 'laminar' | 'transitional' | 'turbulent' =
      reynolds > 3000 ? 'turbulent' : reynolds > 2100 ? 'transitional' : 'laminar';
    return {
      depthMD: s.md,
      tvd: s.tvd,
      zenith: s.zenith,
      standoff: s.standoff,
      eccentricity: s.ecc,
      cavernCoeff: cavern,
      isOpenHole,
      hasTurbulizer: s.hasTurbulizer,
      annularVelocity: vMs,
      reynolds,
      flowRegime: regime,
      densityRatio,
      ypRatio,
      pvRatio,
      contactTimeMin: contactMin,
      displacementEfficiency: disp,
      cementQualityIndex: cqi,
      bondGrade: getBondGrade(cqi),
      mudChannelRisk: riskFromCQI(cqi),
    };
  });

  // Summary
  const cqis = points.map(p => p.cementQualityIndex);
  const avgCQI = cqis.reduce((s, v) => s + v, 0) / Math.max(1, cqis.length);
  const minCQI = Math.min(...cqis);
  const maxCQI = Math.max(...cqis);
  const badPoints = points.filter(p => p.bondGrade === 'D' || p.bondGrade === 'F');
  const stepLen = points.length > 1 ? (points[points.length - 1].depthMD - points[0].depthMD) / (points.length - 1) : 10;
  const badZonesLength = badPoints.length * stepLen;
  const avgStandoff = points.reduce((s, p) => s + p.standoff, 0) / Math.max(1, points.length);
  const avgContact = points.reduce((s, p) => s + p.contactTimeMin, 0) / Math.max(1, points.length);

  // Critical zones — group consecutive bad points
  const criticalZones: CQISummary['criticalZones'] = [];
  let curStart: number | null = null;
  let curMinCqi = 100;
  let curReason = '';
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const isBad = p.cementQualityIndex < 55;
    if (isBad) {
      if (curStart === null) { curStart = p.depthMD; curMinCqi = p.cementQualityIndex; }
      if (p.cementQualityIndex < curMinCqi) {
        curMinCqi = p.cementQualityIndex;
        const reasons: string[] = [];
        if (p.standoff < 50) reasons.push('низкий standoff');
        if (p.cavernCoeff > 1.3) reasons.push('каверна');
        if (p.zenith > 30) reasons.push(`зенит ${p.zenith.toFixed(0)}°`);
        if (p.flowRegime === 'laminar') reasons.push('ламин. режим');
        curReason = reasons.join(', ') || 'комбинация факторов';
      }
    } else if (curStart !== null) {
      criticalZones.push({ fromMD: curStart, toMD: p.depthMD, cqi: curMinCqi, reason: curReason });
      curStart = null; curMinCqi = 100; curReason = '';
    }
  }
  if (curStart !== null) {
    criticalZones.push({
      fromMD: curStart,
      toMD: points[points.length - 1].depthMD,
      cqi: curMinCqi, reason: curReason,
    });
  }

  const summary: CQISummary = {
    avgCQI, minCQI, maxCQI,
    avgGrade: getBondGrade(avgCQI),
    badZonesCount: criticalZones.length,
    badZonesLength,
    avgStandoff,
    avgContact,
    avgFlowRegime: reynolds > 3000 ? 'turbulent' : reynolds > 2100 ? 'transitional' : 'laminar',
    densityHierarchyOK,
    rheologyHierarchyOK,
    bufDensity,
    bufYP,
    bufPV,
    criticalZones,
  };

  // Recommendations
  const recs: string[] = [];
  if (criticalZones.length > 0) {
    const worst = criticalZones.reduce((a, b) => a.cqi < b.cqi ? a : b);
    recs.push(`Критическая зона ${worst.fromMD.toFixed(0)}–${worst.toMD.toFixed(0)} м (CQI=${worst.cqi.toFixed(0)}%): ${worst.reason}`);
  }
  const worstStandoff = points.reduce((a, b) => a.standoff < b.standoff ? a : b, points[0]);
  if (worstStandoff && worstStandoff.standoff < 60) {
    recs.push(`Добавить центраторы возле ${worstStandoff.depthMD.toFixed(0)} м (standoff ${worstStandoff.standoff.toFixed(0)}%)`);
  }
  if (summary.avgFlowRegime === 'laminar') {
    recs.push('Увеличить расход закачки или установить турбулизаторы — текущий режим ламинарный');
  }
  if (!densityHierarchyOK) {
    recs.push(`Нарушена плотностная иерархия: ρ_цем=${(cemDensity/1000).toFixed(2)}, ρ_буф=${(bufDensity/1000).toFixed(2)}, ρ_бр=${(mudDensity/1000).toFixed(2)} г/см³`);
  }
  if (avgContact < 7) {
    recs.push(`Среднее время контакта буфера ${avgContact.toFixed(1)} мин — увеличить объём буфера (рекомендация API: ≥10 мин)`);
  }
  if (avgCQI < 70) {
    recs.push('Рассмотреть двухступенчатое цементирование или дополнительную промывку');
  }
  if (points.some(p => p.cavernCoeff > 1.4)) {
    recs.push('Зоны с каверной k>1.4 — увеличить объём буфера/цемента, оптимизировать реологию');
  }

  return { points, summary, recommendations: recs };
}

// Геометрия канала: на каждом угле сечения оцениваем эффективность вытеснения
export function efficiencyAtAngle(eccentricity: number, baseStandoff: number, angleRad: number): number {
  // angle 0 = верх (high side), PI = низ (low side, бур. остатки)
  // эксцентриситет толкает колонну вниз => зазор на низу меньше
  const cosA = Math.cos(angleRad); // 1 верх, -1 низ
  // нормализованный зазор: 1 + ecc * cos (больше наверху, меньше внизу)
  const gap = 1 + eccentricity * cosA;
  const effGap = Math.max(0.05, gap);
  // эффективность пропорциональна зазору^0.7 и standoff
  const eff = Math.min(100, baseStandoff * Math.pow(effGap, 0.7) * 1.0);
  // на самом low side при ecc>0.5 — провал замещения
  if (cosA < -0.3 && eccentricity > 0.5) {
    return Math.max(0, eff * (1 - (eccentricity - 0.5) * 1.2));
  }
  return Math.max(0, Math.min(100, eff));
}
