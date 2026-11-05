/** Engineering pre-design for Bradenhead squeeze after spotting and lifting open tubing.
 * Simplified, conservative static envelope - NOT a transient multiphase simulator.
 * Requires confirmed casing/BOP integrity and field injectivity before operation.
 */
export interface SpotSqueezeInput {
  casingIdMm: number; tubingOdMm: number; tubingIdMm: number;
  leakTopMD: number; leakBottomMD: number; wellBottomMD: number;
  initialShoeMD: number; liftedShoeMD: number; slurryBottomMD: number;
  slurryVolumeM3: number; plannedSqueezeM3: number;
  slurryDensityGcm3: number; wellFluidDensityGcm3: number;
  casingAllowableSurfaceMPa: number; tubingAllowableSurfaceMPa: number; bopWorkingMPa: number;
  fracGradientMPaM: number; leakTVD: number;
  zonePressureMPa: number; injectivityM3hMPa: number; pumpRateLs: number;
}
export interface SpotSqueezeResult {
  ok: boolean; errors: string[]; warnings: string[];
  casingAreaM2: number; tubingAreaM2: number; annularAreaM2: number;
  tubingCapacityBeforeM3: number; tubingCapacityAfterM3: number;
  slurryTopBeforeMD: number; slurryTopAfterLiftMD: number;
  lengthBeforeM: number; lengthAfterM: number;
  estimatedSlurryTopAfterSqueezeMD: number;
  placedM3: number; plannedSqueezeM3: number; residualM3: number;
  liquidHydroMPa: number; cementHydroMPa: number;
  conservativeSurfaceLimitMPa: number; fractureLimitBhpMPa: number;
  estimatedMinBhpMPa: number; expectedInjectivityRateM3h: number;
  squeezeMinutes: number;
}

const area = (mm: number) => Math.PI * (mm / 1000) ** 2 / 4;
const round = (x: number) => Number.isFinite(x) ? x : 0;

export const DEFAULT_SPOT_SQUEEZE: SpotSqueezeInput = {
  casingIdMm: 130.7, tubingOdMm: 73, tubingIdMm: 62,
  leakTopMD: 1850, leakBottomMD: 1855, wellBottomMD: 2100,
  initialShoeMD: 1870, liftedShoeMD: 1750, slurryBottomMD: 1870,
  slurryVolumeM3: 1.0, plannedSqueezeM3: 0.35,
  slurryDensityGcm3: 1.65, wellFluidDensityGcm3: 1.1,
  casingAllowableSurfaceMPa: 20, tubingAllowableSurfaceMPa: 30,
  bopWorkingMPa: 21, fracGradientMPaM: 0.019,
  leakTVD: 1852.5, zonePressureMPa: 18,
  injectivityM3hMPa: 0.1, pumpRateLs: 0.5,
};

export function calculateSpotSqueeze(i: SpotSqueezeInput): SpotSqueezeResult {
  const errors: string[] = [], warnings: string[] = [];
  const finite = Object.entries(i).every(([, v]) => typeof v === "number" && Number.isFinite(v));
  if (!finite) errors.push("Все числовые параметры должны быть конечными.");
  if (!(i.casingIdMm > i.tubingOdMm && i.tubingOdMm > i.tubingIdMm && i.tubingIdMm > 0))
    errors.push("Проверьте внутренний диаметр колонны и диаметры труб.");
  if (!(i.leakTopMD > 0 && i.leakBottomMD > i.leakTopMD && i.wellBottomMD >= i.slurryBottomMD && i.slurryBottomMD >= i.leakBottomMD))
    errors.push("Проверьте глубины интервала нарушения, нижней границы цемента и забоя.");
  if (!(i.initialShoeMD >= i.leakBottomMD && i.initialShoeMD <= i.slurryBottomMD))
    errors.push("Башмак НКТ при размещении должен находиться у подошвы или ниже интервала нарушения, но не ниже границы цементной пачки.");
  if (!(i.liftedShoeMD >= 0 && i.liftedShoeMD < i.initialShoeMD))
    errors.push("После подъёма конец НКТ должен располагаться выше исходной глубины.");
  if (!(i.slurryVolumeM3 > 0 && i.plannedSqueezeM3 >= 0 && i.plannedSqueezeM3 <= i.slurryVolumeM3))
    errors.push("Объём задавливания не может превышать объём размещённой смеси.");
  if (!(i.slurryDensityGcm3 >= 0.8 && i.slurryDensityGcm3 <= 3 && i.wellFluidDensityGcm3 >= 0.6 && i.wellFluidDensityGcm3 <= 2.5))
    errors.push("Проверьте плотности состава и скважинной жидкости.");
  if (!(i.casingAllowableSurfaceMPa > 0 && i.tubingAllowableSurfaceMPa > 0 && i.bopWorkingMPa > 0 && i.fracGradientMPaM > 0))
    errors.push("Нужны подтверждённые допустимые давления по колонне, НКТ, ПВО и градиенту ГРП.");
  if (!(i.leakTVD > 0 && i.leakTVD <= i.leakBottomMD && i.zonePressureMPa >= 0 && i.injectivityM3hMPa >= 0 && i.pumpRateLs > 0))
    errors.push("Проверьте TVD, давление зоны, приёмистость и расход.");

  const casingAreaM2 = area(Math.max(0,i.casingIdMm));
  const tubingAreaM2 = area(Math.max(0,i.tubingIdMm));
  const annularAreaM2 = Math.max(0,casingAreaM2 - area(Math.max(0,i.tubingOdMm)));
  const capacityBelowShoe = casingAreaM2 * Math.max(0, i.slurryBottomMD - i.initialShoeMD);
  const aboveShoeVolume = Math.max(0,i.slurryVolumeM3 - capacityBelowShoe);
  const slurryTopBeforeMD = i.slurryVolumeM3 <= capacityBelowShoe
    ? i.slurryBottomMD - i.slurryVolumeM3 / Math.max(1e-12,casingAreaM2)
    : i.initialShoeMD - aboveShoeVolume / Math.max(1e-12,annularAreaM2);
  const slurryTopAfterLiftMD = i.slurryBottomMD - i.slurryVolumeM3 / Math.max(1e-12,casingAreaM2);
  const residualM3 = Math.max(0,i.slurryVolumeM3 - i.plannedSqueezeM3);
  const estimatedSlurryTopAfterSqueezeMD = i.slurryBottomMD - residualM3 / Math.max(1e-12,casingAreaM2);
  if (slurryTopBeforeMD < 0 || slurryTopAfterLiftMD < 0) errors.push("Объём цемента превышает геометрическую вместимость интервала.");
  if (i.liftedShoeMD >= slurryTopAfterLiftMD)
    errors.push("После подъёма конец НКТ остаётся в цементной пачке. Поднимите его выше расчётной кровли с запасом.");
  else if (slurryTopAfterLiftMD - i.liftedShoeMD < 10)
    warnings.push("Зазор между концом НКТ и кровлей цемента менее 10 м. Учтите перемешивание, свабирование и точность глубины.");
  if (slurryTopAfterLiftMD > i.leakTopMD)
    warnings.push("После извлечения НКТ верх смеси ниже кровли нарушения: интервал может быть перекрыт не полностью.");
  if (estimatedSlurryTopAfterSqueezeMD > i.leakBottomMD)
    warnings.push("По объёмному балансу после задавливания цемента не остаётся напротив интервала нарушения.");
  if (i.slurryVolumeM3 > casingAreaM2*Math.max(0,i.slurryBottomMD))
    errors.push("Цемента больше вместимости ствола до устья.");
  const liquidHydroMPa = i.wellFluidDensityGcm3*9.81*i.leakTVD/1000;
  const cementHydroMPa = i.slurryDensityGcm3*9.81*i.leakTVD/1000;
  const fractureLimitBhpMPa = 0.95*i.fracGradientMPaM*i.leakTVD;
  // Bound by both possible fluid-column states during the displacement;
  // no precise hydrostatic profile can be claimed without transient tracking.
  const conservativeSurfaceLimitMPa = Math.max(0,Math.min(i.casingAllowableSurfaceMPa,i.tubingAllowableSurfaceMPa,i.bopWorkingMPa, fractureLimitBhpMPa-Math.max(liquidHydroMPa,cementHydroMPa)));
  if (conservativeSurfaceLimitMPa <= 0)
    errors.push("Нет положительного окна давлений: гидростатика или ограничения оборудования превышают безопасный предел.");
  const estimatedMinBhpMPa = i.zonePressureMPa;
  if (i.injectivityM3hMPa <= 0) warnings.push("Приёмистость не задана: не прогнозируем фактическое проникновение смеси в трещину.");
  const expectedInjectivityRateM3h = i.injectivityM3hMPa > 0
    ? i.injectivityM3hMPa*Math.max(0,conservativeSurfaceLimitMPa+liquidHydroMPa-i.zonePressureMPa)
    : 0;
  if (expectedInjectivityRateM3h <= 0 && i.injectivityM3hMPa > 0) warnings.push("По заданной приёмистости и оценке давления зона не принимает жидкость в расчётном окне.");
  warnings.push("Глубина цемента после подъёма и после задавливания рассчитана по идеализированному статическому балансу; фактические смешение, объёмный эффект подъёма труб и проникновение в пласт определяются по замерам.");
  warnings.push("ПВО закрывается на трубах только по утверждённой процедуре; нужны опрессовки НКТ, колонны, ПВО и обвязки, контроль трубного/затрубного давлений и защита от ГНВП.");
  return {
    ok:errors.length===0,errors,warnings,casingAreaM2, tubingAreaM2,annularAreaM2,
    tubingCapacityBeforeM3:tubingAreaM2*i.initialShoeMD,
    tubingCapacityAfterM3:tubingAreaM2*i.liftedShoeMD,
    slurryTopBeforeMD:round(slurryTopBeforeMD),
    slurryTopAfterLiftMD:round(slurryTopAfterLiftMD),
    lengthBeforeM:round(i.slurryBottomMD-slurryTopBeforeMD),
    lengthAfterM:round(i.slurryBottomMD-slurryTopAfterLiftMD),
    estimatedSlurryTopAfterSqueezeMD:round(estimatedSlurryTopAfterSqueezeMD),
    placedM3:i.slurryVolumeM3,plannedSqueezeM3:i.plannedSqueezeM3,residualM3,
    liquidHydroMPa,cementHydroMPa,conservativeSurfaceLimitMPa,fractureLimitBhpMPa,
    estimatedMinBhpMPa,expectedInjectivityRateM3h,
    squeezeMinutes:i.plannedSqueezeM3*1000/Math.max(i.pumpRateLs,1e-12)/60,
  };
}
