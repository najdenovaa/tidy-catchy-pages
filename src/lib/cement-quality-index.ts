// Cement Quality Index (CQI) — расчёт качества цементирования по глубине
import type { WellData, SlurryInput, BufferFluid, DrillingFluid, PressurePoint } from "./cementing-calculations";
import { resolveFlowRateSteps, slurryDesignVolume, getCavernCoeffAtDepth } from "./cementing-calculations";
import { boreDiameterAtDepth } from "./well-geometry";
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
  bufYP: number;                  // Pa
  bufPV: number;                  // cp
  standoffSource: 'centralization' | 'profile' | 'input' | 'assumed';
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
  const mudYP = drillingFluid.rheology?.yp ?? 20;
  const mudPV = drillingFluid.rheology?.pv ?? 25;

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
  const densityHierarchyOK = buffers.length > 0 && buffers.every(b => b.density > mudDensity)
    && slurries.length > 0 && slurries.every(c => buffers.every(b => c.density * 1000 > b.density));
  const rheologyHierarchyOK = buffers.length > 0 && buffers.every(b => (b.rheology?.yp ?? 25) > mudYP)
    && slurries.length > 0 && slurries.every(c => buffers.every(b => (c.rheology?.yp ?? 30) > (b.rheology?.yp ?? 25)));
  const bufYpVsMud = bufYP / Math.max(1, mudYP);
  const standoffProfile = [...(wellData.standoffProfile ?? [])].sort((a,b) => a.md-b.md);
  const standoffSource: CQISummary['standoffSource'] = centralization?.length ? 'centralization'
    : standoffProfile.length ? 'profile' : wellData.annularStandoffPct != null ? 'input' : 'assumed';
  const standoffAt = (md: number) => {
    if (!standoffProfile.length) return wellData.annularStandoffPct ?? 67;
    if (md <= standoffProfile[0].md) return standoffProfile[0].standoffPct;
    for(let i=1;i<standoffProfile.length;i++) {
      const a=standoffProfile[i-1], b=standoffProfile[i];
      if(md<=b.md) return a.standoffPct+(b.standoffPct-a.standoffPct)*(md-a.md)/Math.max(1e-9,b.md-a.md);
    }
    return standoffProfile[standoffProfile.length-1].standoffPct;
  };
  // Screening rate uses total pumped volume / pumping time for this slurry.
  // It is not the instantaneous rate or the transient displacement solution.
  const rateOf = (c: SlurryInput | undefined) => {
    const steps=c ? resolveFlowRateSteps(c.flowRateSteps,slurryDesignVolume(wellData,slurries,slurries.indexOf(c))).filter(x=>x.rateLps>0 && x.volumeM3>0) : [];
    if(steps.length) return steps.reduce((v,x)=>v+x.volumeM3,0)/steps.reduce((t,x)=>t+x.volumeM3/x.rateLps,0);
    return c?.flowRateSteps?.find(x=>x.rateLps>0)?.rateLps ?? 0;
  };

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
      steps.push({ md, tvd: md, zenith: 0, standoff: standoffAt(md), ecc: 1-standoffAt(md)/100, hasTurbulizer: false });
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

  const cementTop = Math.min(casingDepthMD, ...slurries.map(c => c.topDepthMD));
  // Include material/geometry boundaries so short intervals are not skipped.
  if(steps.length) for(const md of [cementTop,casingDepthMD,prevCasingDepth,...slurries.map(c=>c.topDepthMD),...(wellData.cavernIntervals ?? []).flatMap(c=>[c.fromMD,c.toMD])]) {
    if(md<cementTop || md>casingDepthMD || steps.some(s=>s.md===md)) continue;
    const sorted=[...steps].sort((a,b)=>a.md-b.md);
    const a=[...sorted].reverse().find(s=>s.md<=md) ?? sorted[0], b=sorted.find(s=>s.md>=md) ?? sorted[sorted.length-1];
    const t=b.md>a.md ? (md-a.md)/(b.md-a.md) : 0;
    const standoff=a.standoff+(b.standoff-a.standoff)*t;
    steps.push({...a,md,tvd:a.tvd+(b.tvd-a.tvd)*t,standoff,ecc:a.ecc+(b.ecc-a.ecc)*t});
  }
  const points: CementQualityPoint[] = steps.filter(s=>slurries.length>0 && s.md>=cementTop && s.md<=casingDepthMD).sort((a,b)=>a.md-b.md).map(s => {
    const slurry = slurries.filter(c=>c.topDepthMD<=s.md).reduce<SlurryInput | undefined>((best,c)=>!best || c.topDepthMD>best.topDepthMD ? c : best, undefined);
    const cemDensity=(slurry?.density ?? 1.85)*1000;
    const cemYP=slurry?.rheology?.yp ?? 30, cemPV=slurry?.rheology?.pv ?? 50;
    const densityRatio=cemDensity/mudDensity, ypRatio=cemYP/Math.max(1,mudYP), pvRatio=cemPV/Math.max(1,mudPV);
    const dHole=boreDiameterAtDepth(wellData,s.md)/1000, dCas=wellData.casingOD/1000;
    const area=Math.PI/4*Math.max(0,dHole*dHole-dCas*dCas);
    const vMs=area>0 ? rateOf(slurry)/1000/area : 0;
    const dHyd=Math.max(.01,dHole-dCas);
    // Same Bingham apparent-viscosity convention as the hydraulic calculation: PV in cP, YP in Pa.
    const muEff=mudPV/1000+mudYP*dHyd/(6*Math.max(.001,vMs));
    const reynolds=mudDensity*vMs*dHyd/Math.max(1e-4,muEff);
    const isOpenHole = s.md > prevCasingDepth;
    const cavern = getCavernCoeffAtDepth(s.md, wellData.cavernCoeff, wellData.cavernIntervals,wellData.holeDiameter);
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
  const span=points.length>1 ? points[points.length-1].depthMD-points[0].depthMD : 0;
  const depthMean=(value:(p:CementQualityPoint)=>number) => span>0
    ? points.slice(1).reduce((sum,p,i)=>sum+value(points[i])*(p.depthMD-points[i].depthMD),0)/span
    : points.length ? value(points[0]) : 0;
  const avgCQI = depthMean(p=>p.cementQualityIndex);
  const minCQI = cqis.length ? Math.min(...cqis) : 0;
  const maxCQI = cqis.length ? Math.max(...cqis) : 0;
  const badZonesLength = points.slice(1).reduce((length,p,i)=>length+(points[i].cementQualityIndex<55 ? p.depthMD-points[i].depthMD : 0),0);
  const avgStandoff = depthMean(p=>p.standoff);
  const avgContact = depthMean(p=>p.contactTimeMin);

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
      if (p.cementQualityIndex <= curMinCqi) {
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
    avgFlowRegime: points.some(p=>p.flowRegime==='laminar') ? 'laminar' : points.some(p=>p.flowRegime==='transitional') ? 'transitional' : 'turbulent',
    standoffSource,
    densityHierarchyOK,
    rheologyHierarchyOK,
    bufDensity,
    bufYP,
    bufPV,
    criticalZones,
  };

  // Recommendations
  const recs: string[] = [];
  if(standoffSource==='assumed') recs.push('Центрирование не задано: для предварительного CQI принято условное standoff 67%. Задайте профиль или выполните расчёт центрирования.');
  if (criticalZones.length > 0) {
    const worst = criticalZones.reduce((a, b) => a.cqi < b.cqi ? a : b);
    recs.push(`Критическая зона ${worst.fromMD.toFixed(0)}–${worst.toMD.toFixed(0)} м (CQI=${worst.cqi.toFixed(0)}%): ${worst.reason}`);
  }
  const worstStandoff = points.length ? points.reduce((a, b) => a.standoff < b.standoff ? a : b) : undefined;
  if (worstStandoff && worstStandoff.standoff < 60) {
    recs.push(`Добавить центраторы возле ${worstStandoff.depthMD.toFixed(0)} м (standoff ${worstStandoff.standoff.toFixed(0)}%)`);
  }
  if (summary.avgFlowRegime === 'laminar') {
    recs.push('Ламинарный режим учитывается в балльной оценке. Сам по себе он не доказывает плохое вытеснение; проверьте распределение жидкостей в модели замещения и допустимые давления.');
  }
  if (!densityHierarchyOK) {
    recs.push(`Плотностная иерархия не подтверждена для всех пачек: буровой ${(mudDensity/1000).toFixed(2)} г/см³; буферы ${buffers.map(b=>(b.density/1000).toFixed(2)).join(', ') || 'нет'}; цементы ${slurries.map(c=>c.density.toFixed(2)).join(', ') || 'нет'}.`);
  }
  if (!rheologyHierarchyOK) {
    recs.push('Реологическая иерархия не подтверждена для всех пачек; сопоставьте свойства каждой жидкости и результаты модели замещения.');
  } else if (bufYpVsMud < 1.2) {
    recs.push(`Буфер слабо отличается по YP от бурраствора (${bufYpVsMud.toFixed(2)}×) — увеличить YP буфера для эффективного срыва глинистой корки`);
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
