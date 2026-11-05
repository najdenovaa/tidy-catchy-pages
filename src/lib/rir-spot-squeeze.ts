/** Open-tubing placement and Bradenhead pressure reference. All pressures are gauge MPa.
 * Geometry is a volume balance, not a prediction of mixing, settling or U-tubing.
 */
import { interpolateTVD, type TrajectoryPoint } from "./cementing-calculations";
export interface SpotSqueezeInput {
  casingIdMm: number;
  tubingOdMm: number;
  tubingIdMm: number;
  leakTopMD: number;
  leakBottomMD: number;
  wellBottomMD: number;
  initialShoeMD: number;
  liftedShoeMD: number;
  slurryBottomMD: number;
  slurryVolumeM3: number;
  plannedSqueezeM3: number;
  slurryDensityGcm3: number;
  wellFluidDensityGcm3: number;
  casingAllowableSurfaceMPa: number;
  tubingAllowableSurfaceMPa: number;
  bopWorkingMPa: number;
  fracGradientMPaM: number;
  leakTVD: number;
  zonePressureMPa: number;
  injectivityM3hMPa: number;
  pumpRateLs: number;
  placementMode?: "displaced" | "balanced";
  trajectory?: TrajectoryPoint[];
}
export interface SpotSqueezeResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  casingAreaM2: number;
  tubingAreaM2: number;
  annularAreaM2: number;
  tubingCapacityBeforeM3: number;
  tubingCapacityAfterM3: number;
  slurryTopBeforeMD: number;
  slurryTopAfterLiftMD: number;
  lengthBeforeM: number;
  lengthAfterM: number;
  estimatedSlurryTopAfterSqueezeMD: number;
  placedM3: number;
  plannedSqueezeM3: number;
  residualM3: number;
  liquidHydroMPa: number;
  cementHydroMPa: number;
  conservativeSurfaceLimitMPa: number;
  fractureLimitBhpMPa: number;
  estimatedMinBhpMPa: number;
  expectedInjectivityRateM3h: number;
  squeezeMinutes: number;
  recommendedLiftedShoeMD: number;
  slurryTopFullyWithdrawnMD: number;
  minimumLiftM: number;
  slurryInTubingBeforeM3: number;
  placementDisplacementM3: number;
  placementMode: "displaced" | "balanced";
}
const area = (d: number) => (Math.PI / 4) * (d / 1000) ** 2;
export const DEFAULT_SPOT_SQUEEZE: SpotSqueezeInput = {
  casingIdMm: 130.7,
  tubingOdMm: 73,
  tubingIdMm: 62,
  leakTopMD: 1850,
  leakBottomMD: 1855,
  wellBottomMD: 2100,
  initialShoeMD: 1870,
  liftedShoeMD: 1750,
  slurryBottomMD: 1870,
  slurryVolumeM3: 1,
  plannedSqueezeM3: 0.35,
  slurryDensityGcm3: 1.65,
  wellFluidDensityGcm3: 1.1,
  casingAllowableSurfaceMPa: 20,
  tubingAllowableSurfaceMPa: 30,
  bopWorkingMPa: 21,
  fracGradientMPaM: 0.019,
  leakTVD: 1852.5,
  zonePressureMPa: 18,
  injectivityM3hMPa: 0.1,
  pumpRateLs: 0.5,
  placementMode: "displaced",
};
export function spotTVD(i: SpotSqueezeInput, md: number): number {
  return i.trajectory && i.trajectory.length > 1
    ? interpolateTVD(Math.max(0, Math.min(i.wellBottomMD, md)), i.trajectory)
    : (Math.max(0, md) * i.leakTVD) / ((i.leakTopMD + i.leakBottomMD) / 2);
}
/** Total cement includes the tubing interior only in balanced placement. */
export function spotGeometry(
  i: SpotSqueezeInput,
  shoeMD: number,
  volumeM3: number,
  mode = i.placementMode ?? "displaced",
) {
  const a = area(i.casingIdMm),
    at = area(i.tubingIdMm),
    ao = area(i.tubingOdMm),
    occupied = mode === "balanced" ? ao - at : ao;
  const below = a * Math.max(0, i.slurryBottomMD - shoeMD),
    v = Math.max(0, volumeM3);
  const top =
    v <= below
      ? i.slurryBottomMD - v / Math.max(a, 1e-12)
      : shoeMD - (v - below) / Math.max(1e-12, a - occupied);
  const immersed = Math.max(
    0,
    Math.min(shoeMD, i.slurryBottomMD) - Math.max(0, top),
  );
  return {
    topMD: top,
    slurryInTubingM3: mode === "balanced" ? at * immersed : 0,
    volumeM3: v,
  };
}
/** Mixed well-fluid/cement column; uses TVD increments, never full-depth cement density. */
export function spotHydrostatic(
  i: SpotSqueezeInput,
  md: number,
  slurryTopMD: number,
): number {
  const z = spotTVD(i, md),
    zc = Math.max(
      0,
      spotTVD(i, Math.min(md, i.slurryBottomMD)) -
        spotTVD(i, Math.min(md, Math.max(0, slurryTopMD))),
    );
  return (
    (9.81 / 1000) *
    (i.wellFluidDensityGcm3 * z +
      (i.slurryDensityGcm3 - i.wellFluidDensityGcm3) * zc)
  );
}
export function calculateSpotSqueeze(i: SpotSqueezeInput): SpotSqueezeResult {
  const errors: string[] = [],
    warnings: string[] = [];
  if (i.placementMode && !["displaced", "balanced"].includes(i.placementMode))
    errors.push("Неизвестный способ размещения.");
  const numeric = Object.entries(i).filter(
    ([k]) => k !== "trajectory" && k !== "placementMode",
  );
  if (numeric.some(([, v]) => typeof v !== "number" || !Number.isFinite(v)))
    errors.push("Все числовые параметры должны быть конечными.");
  if (!(
    i.casingIdMm > i.tubingOdMm &&
    i.tubingOdMm > i.tubingIdMm &&
    i.tubingIdMm > 0
  ))
    errors.push("Проверьте внутренний диаметр колонны и диаметры НКТ.");
  if (!(
    i.leakTopMD > 0 &&
    i.leakBottomMD > i.leakTopMD &&
    i.wellBottomMD >= i.slurryBottomMD &&
    i.slurryBottomMD >= i.leakBottomMD
  ))
    errors.push("Проверьте глубины нарушения, нижней границы цемента и забоя.");
  if (!(
    i.initialShoeMD >= i.leakBottomMD && i.initialShoeMD <= i.slurryBottomMD
  ))
    errors.push(
      "При размещении конец НКТ должен быть у подошвы или ниже нарушения, но не ниже нижней границы пачки.",
    );
  if (!(i.liftedShoeMD >= 0 && i.liftedShoeMD < i.initialShoeMD))
    errors.push("После подъёма конец НКТ должен быть выше исходной глубины.");
  if (!(
    i.slurryVolumeM3 > 0 &&
    i.plannedSqueezeM3 >= 0 &&
    i.plannedSqueezeM3 <= i.slurryVolumeM3
  ))
    errors.push(
      "Плановое задавливание не может превышать объём размещённой смеси.",
    );
  if (!(
    i.slurryDensityGcm3 >= 0.8 &&
    i.slurryDensityGcm3 <= 3 &&
    i.wellFluidDensityGcm3 >= 0.6 &&
    i.wellFluidDensityGcm3 <= 2.5
  ))
    errors.push("Проверьте плотности состава и скважинной жидкости.");
  if (
    ![
      i.casingAllowableSurfaceMPa,
      i.tubingAllowableSurfaceMPa,
      i.bopWorkingMPa,
      i.fracGradientMPaM,
    ].every((v) => v > 0)
  )
    errors.push(
      "Нужны положительные ограничения колонны, НКТ, ПВО и градиента ГРП.",
    );
  if (!(
    i.leakTVD > 0 &&
    i.leakTVD <= i.leakBottomMD &&
    i.zonePressureMPa >= 0 &&
    i.injectivityM3hMPa >= 0 &&
    i.pumpRateLs > 0
  ))
    errors.push("Проверьте TVD, давление зоны, приёмистость и расход.");
  const casingAreaM2 = area(i.casingIdMm),
    tubingAreaM2 = area(i.tubingIdMm),
    annularAreaM2 = casingAreaM2 - area(i.tubingOdMm);
  const placementMode = i.placementMode ?? "displaced",
    before = spotGeometry(i, i.initialShoeMD, i.slurryVolumeM3),
    after = spotGeometry(i, i.liftedShoeMD, i.slurryVolumeM3);
  const fullTop =
      i.slurryBottomMD - i.slurryVolumeM3 / Math.max(1e-12, casingAreaM2),
    recommended = Math.max(0, Math.min(i.initialShoeMD - 1, fullTop - 10));
  const residualM3 = Math.max(0, i.slurryVolumeM3 - i.plannedSqueezeM3),
    remaining = spotGeometry(i, i.liftedShoeMD, residualM3);
  if (before.topMD < 0 || after.topMD < 0 || fullTop < 0)
    errors.push("Объём цемента превышает вместимость колонны до устья.");
  if (i.liftedShoeMD >= after.topMD)
    errors.push(
      `Конец НКТ ${i.liftedShoeMD.toFixed(1)} м остаётся в пачке (кровля ${after.topMD.toFixed(1)} м). Для выхода с запасом 10 м требуется глубина не более ${recommended.toFixed(1)} м; дополнительный подъём не менее ${Math.max(0, i.liftedShoeMD - recommended).toFixed(1)} м.`,
    );
  else if (after.topMD - i.liftedShoeMD < 10 - 1e-6)
    warnings.push(
      "До кровли смеси менее 10 м; учтите смешение, свабирование и точность глубины.",
    );
  if (after.topMD > i.leakTopMD)
    errors.push("После подъёма смесь не перекрывает кровлю нарушения.");
  if (remaining.topMD > i.leakTopMD)
    warnings.push(
      "После планового задавливания смесь может перестать полностью перекрывать интервал нарушения.",
    );
  const mid = (i.leakTopMD + i.leakBottomMD) / 2;
  const liquidHydroMPa = (i.wellFluidDensityGcm3 * 9.81 * i.leakTVD) / 1000;
  // This is the ACTUAL mixed column, not a counterfactual full cement column.
  const cementHydroMPa = spotHydrostatic(i, mid, after.topMD),
    fractureLimitBhpMPa = 0.95 * i.fracGradientMPaM * i.leakTVD;
  const conservativeSurfaceLimitMPa = Math.max(
    0,
    Math.min(
      i.casingAllowableSurfaceMPa,
      i.tubingAllowableSurfaceMPa,
      i.bopWorkingMPa,
      fractureLimitBhpMPa - Math.max(liquidHydroMPa, cementHydroMPa),
    ),
  );
  if (conservativeSurfaceLimitMPa <= 0)
    errors.push(
      "Нет положительного окна давлений по смешанному столбу и ограничениям оборудования.",
    );
  const expectedInjectivityRateM3h =
    i.injectivityM3hMPa *
    Math.max(
      0,
      conservativeSurfaceLimitMPa + cementHydroMPa - i.zonePressureMPa,
    );
  if (i.injectivityM3hMPa <= 0)
    warnings.push(
      "Приёмистость не задана: проникновение смеси в пласт не прогнозируется.",
    );
  warnings.push(
    "Геометрия рассчитана по объёмному балансу без смешения, оседания и потерь при размещении. Уровни и объёмы требуют промыслового контроля.",
  );
  warnings.push(
    placementMode === "displaced"
      ? "Размещение полной продавкой: весь состав выведен из НКТ. Перетоки при разности гидростатик (U-tubing) отдельно не моделируются."
      : "Сбалансированное размещение: учтён цемент внутри НКТ и в затрубье; при подъёме принят переток цемента из открытых НКТ в пачку без потери состава.",
  );
  return {
    ok: !errors.length,
    errors,
    warnings,
    casingAreaM2,
    tubingAreaM2,
    annularAreaM2,
    tubingCapacityBeforeM3: tubingAreaM2 * i.initialShoeMD,
    tubingCapacityAfterM3: tubingAreaM2 * i.liftedShoeMD,
    slurryTopBeforeMD: before.topMD,
    slurryTopAfterLiftMD: after.topMD,
    lengthBeforeM: i.slurryBottomMD - before.topMD,
    lengthAfterM: i.slurryBottomMD - after.topMD,
    estimatedSlurryTopAfterSqueezeMD: remaining.topMD,
    placedM3: i.slurryVolumeM3,
    plannedSqueezeM3: i.plannedSqueezeM3,
    residualM3,
    liquidHydroMPa,
    cementHydroMPa,
    conservativeSurfaceLimitMPa,
    fractureLimitBhpMPa,
    estimatedMinBhpMPa: i.zonePressureMPa,
    expectedInjectivityRateM3h,
    squeezeMinutes:
      (i.plannedSqueezeM3 * 1000) / Math.max(i.pumpRateLs, 1e-12) / 60,
    recommendedLiftedShoeMD: recommended,
    slurryTopFullyWithdrawnMD: fullTop,
    minimumLiftM: Math.max(0, i.liftedShoeMD - recommended),
    slurryInTubingBeforeM3: before.slurryInTubingM3,
    placementDisplacementM3: Math.max(
      0,
      tubingAreaM2 * i.initialShoeMD - before.slurryInTubingM3,
    ),
    placementMode,
  };
}
