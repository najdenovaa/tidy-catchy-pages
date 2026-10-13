/**
 * Осложнения (поглощение / проявление) в итоговом расчёте моста.
 * Те же модели, что в блоке «Осложнения» (calculateComplications + U-tube проседание),
 * сведены к итогам: реальное положение и длина моста, потери цемента, нужная плотность.
 */
import type { PlugInputs, PlugResults } from "./cement-plug-calculations";
import {
  calculateComplications, analyzePlugComplicationFull,
  type ComplicationResult, type FullComplicationAnalysis, type ComplicationType, type LossBehavior, type LossZoneType,
} from "./cement-plug-complications";

export interface PlugComplicationParams {
  type: ComplicationType;
  lossRate: number;
  lossBehavior: LossBehavior;
  zoneDepthMD: number;
  zoneDepthTVD: number;
  zoneThickness: number;
  formationPressure: number;
  fluidType: "gas" | "oil" | "water";
  zoneType: LossZoneType;
  zonePorosity: number;
  drainageRadius: number;
  thick30Bc: number;
  frictionCoeff: number;
  lcmFactor: number;
  bhTempInput: number;
  userBcAtStop: number;
}

export const DEFAULT_COMPL_PARAMS: PlugComplicationParams = {
  type: "loss", lossRate: 10, lossBehavior: "stable", zoneDepthMD: 0, zoneDepthTVD: 0, zoneThickness: 10,
  formationPressure: 0, fluidType: "water", zoneType: "fracture", zonePorosity: 0.15, drainageRadius: 15,
  thick30Bc: 0, frictionCoeff: 0.3, lcmFactor: 1, bhTempInput: 60, userBcAtStop: 0,
};

export function complParamsFrom(raw: Record<string, unknown>, bhctC: number): PlugComplicationParams {
  return { ...DEFAULT_COMPL_PARAMS, bhTempInput: bhctC, ...(raw as Partial<PlugComplicationParams>) };
}

export interface PlugComplicationSummary {
  active: boolean;
  scenario: FullComplicationAnalysis["scenario"] | "loss_simple";
  hasLoss: boolean;
  hasKick: boolean;
  plannedTopMD: number;
  plannedBottomMD: number;
  realTopMD: number;
  realBottomMD: number;
  realLengthM: number;
  topDropM: number;
  cementLostM3: number;
  correctedCementVolumeM3: number;
  reachesLossZone: boolean;
  kickBreakThrough: boolean;
  requiredCementDensity: number | null;
  lossZone: { topMD: number; thicknessM: number } | null;
  risk: "low" | "medium" | "high" | "critical";
  headline: string;
  notes: string[];
  calc: ComplicationResult | null;
  full: FullComplicationAnalysis | null;
}

export function evaluatePlugComplications(inp: PlugInputs, r: PlugResults, p: PlugComplicationParams): PlugComplicationSummary {
  const hasLoss = (p.type === "loss" || p.type === "both") && p.lossRate > 0 && p.zoneDepthMD > 0;
  const hasKick = (p.type === "kick" || p.type === "both") && p.formationPressure > 0;
  const plannedTopMD = r.plugTopMD, plannedBottomMD = r.plugBottomMD;
  const base: PlugComplicationSummary = {
    active: false, scenario: "none", hasLoss, hasKick, plannedTopMD, plannedBottomMD,
    realTopMD: plannedTopMD, realBottomMD: plannedBottomMD, realLengthM: r.plugLengthMD, topDropM: 0, cementLostM3: 0,
    correctedCementVolumeM3: r.cementVolumeTotal, reachesLossZone: false, kickBreakThrough: false, requiredCementDensity: null,
    lossZone: hasLoss ? { topMD: p.zoneDepthMD, thicknessM: p.zoneThickness } : null,
    risk: "low", headline: "", notes: [], calc: null, full: null,
  };
  if (!hasLoss && !hasKick) {
    return { ...base, headline: "Осложнения включены, но не заданы: укажите глубину и интенсивность поглощения или пластовое давление проявления." };
  }
  const fp = (f: { density: number; rheology: { pv: number; yp: number }; gel10min?: number }) => ({
    densityGcm3: f.density, pvMPas: f.rheology.pv, ypPa: f.rheology.yp, gel10minPa: f.gel10min && f.gel10min > 0 ? f.gel10min : f.rheology.yp * 3,
  });
  const pad = inp.useViscousPad && inp.viscousPadFluid ? inp.viscousPadFluid : inp.spacer;
  const traj = (inp.well.trajectory.length > 1 ? inp.well.trajectory : [{ md: 0, zenith: 0, tvd: 0, azimuth: 0 }, { md: plannedBottomMD + 200, zenith: 0, tvd: plannedBottomMD + 200, azimuth: 0 }])
    .map((t) => ({ md: t.md, zenithDeg: t.zenith, tvd: t.tvd }));

  const calc = calculateComplications(
    { type: p.type, lossRateM3h: p.lossRate, lossBehavior: p.lossBehavior, zoneDepthMD: p.zoneDepthMD, zoneDepthTVD: p.zoneDepthTVD || p.zoneDepthMD,
      zoneThicknessM: p.zoneThickness, formationPressureMPa: p.formationPressure, formationFluidType: p.fluidType },
    {
      annAreaM2: r.annArea, pipeAreaM2: r.pipeArea, boreDiamMm: r.boreDiamUsed, pipeODMm: r.pipeSectionsUsed?.[0]?.od ?? 89,
      plugLengthMD: r.plugLengthMD, plugTopMD: plannedTopMD, plugBottomMD: plannedBottomMD, cementVolumeTotalM3: r.cementVolumeTotal,
      totalOperationTimeMin: r.totalOperationTimeMin, spacerVolumeBelowM3: inp.useViscousPad ? inp.spacerVolumeBelowM3 : 0, plugBottomTVD: r.plugBottomTVD,
      thickeningTimeMin: inp.thickeningTimeMin, settingTimeStartMin: 0, settingTimeEndMin: 0, hasViscousPad: !!inp.useViscousPad,
      cement: fp(inp.cement), spacer: fp(inp.spacer), wellFluid: fp(inp.wellFluid), viscousPad: fp(pad),
    },
  );

  const t50 = inp.thickeningTimeMin > 0 ? inp.thickeningTimeMin : 120;
  const t30 = p.thick30Bc > 0 ? p.thick30Bc : t50 * 0.6;
  const toFull = (f: ReturnType<typeof fp>, isCement = false) => ({ ...f, gel10sPa: 0, thickeningTime30Bc: isCement ? t30 : 0, thickeningTime50Bc: isCement ? t50 : 0 });
  const padHeight = inp.useViscousPad && inp.spacerVolumeBelowM3 > 0 && r.annArea > 0 ? inp.spacerVolumeBelowM3 / r.annArea : 0;
  const full = analyzePlugComplicationFull(
    plannedTopMD, plannedBottomMD,
    hasLoss ? { topMD: p.zoneDepthMD, thicknessM: Math.max(0.5, p.zoneThickness), zoneType: p.zoneType, porosity: p.zonePorosity, initialLossRateM3h: p.lossRate, drainageRadiusM: p.drainageRadius } : null,
    toFull(fp(inp.cement), true), toFull(fp(inp.wellFluid)), inp.useViscousPad ? toFull(fp(pad)) : null, padHeight,
    traj, r.annArea, r.boreDiamUsed / 1000, p.frictionCoeff, r.totalOperationTimeMin || 60, p.lcmFactor, p.bhTempInput || r.temperatures?.bhctC || 60,
    hasKick ? p.formationPressure : 0, p.fluidType === "gas", p.fluidType, r.plugBottomTVD, p.userBcAtStop,
  );

  const notes: string[] = [];
  let realTop = calc.realPlugTopMD, realBottom = calc.realPlugBottomMD, realLen = calc.realPlugLengthM, cementLost = calc.cementLostM3;
  let reaches = false;
  const s = full.settlement;
  if (full.scenario === "zone_below" && s) {
    realTop = s.finalHeadMD; realBottom = s.finalBottomMD;
    const annA = Math.max(r.annArea, 1e-6);
    cementLost = s.layerBreakdown.cementLostM3;
    realLen = Math.max(0, r.plugLengthMD - cementLost / annA);
    reaches = s.reachesLossZone;
    notes.push(s.willSettle ? `Поглощение ниже моста (${p.zoneDepthMD} м): мост опустится на ${s.settlementM.toFixed(1)} м${reaches ? " и дойдёт до зоны поглощения — цемент уйдёт в пласт" : ""}.` : "Поглощение ниже моста: проседания не ожидается.");
  } else if (hasLoss) {
    notes.push(`Зона поглощения ${full.scenario === "zone_inside" ? "в интервале моста" : "выше моста"}: потери цемента при установке ${calc.cementLostM3.toFixed(2)} м³.`);
  }
  if (hasKick) {
    if (calc.kickCanBreakThrough) notes.push(`Проявление: пластовое давление ${p.formationPressure} МПа может прорвать мост — нужна плотность цемента ≥ ${calc.requiredCementDensityGcm3.toFixed(2)} г/см³.`);
    else notes.push(`Проявление: гидростатика моста удерживает пласт (запас ${(-calc.pressureDifferenceMPa).toFixed(1)} МПа).`);
    if (full.kickInvasionM > 0.1) notes.push(`Внедрение флюида в подошву до ${full.kickInvasionM.toFixed(1)} м.`);
  }
  const risk = reaches || calc.kickCanBreakThrough ? "critical" : calc.riskLevel;
  const drop = Math.max(0, realTop - plannedTopMD);
  const headline = risk === "critical"
    ? "С осложнениями мост в проекте не держится — нужна корректировка (см. рекомендации и автоподбор)."
    : `С осложнениями: мост ${realTop.toFixed(0)}–${realBottom.toFixed(0)} м, длина ${realLen.toFixed(0)} м${drop > 0.5 ? `, кровля ниже плана на ${drop.toFixed(1)} м` : ""}.`;
  return {
    ...base, active: true, scenario: full.scenario === "none" && hasLoss ? "loss_simple" : full.scenario,
    realTopMD: realTop, realBottomMD: realBottom, realLengthM: realLen, topDropM: drop, cementLostM3: cementLost,
    correctedCementVolumeM3: calc.correctedCementVolumeM3, reachesLossZone: reaches, kickBreakThrough: calc.kickCanBreakThrough,
    requiredCementDensity: hasKick ? calc.requiredCementDensityGcm3 : null,
    risk, headline, notes: [...notes, ...calc.recommendations.slice(0, 4)], calc, full,
  };
}
