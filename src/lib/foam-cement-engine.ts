import {
  getCasingID,
  getCasingIDAtDepth,
  getCavernCoeffAtDepth,
  interpolateTVD,
} from "./cementing-calculations";
import {
  FOAM_ATM,
  FOAM_G,
  nitrogenDensity,
  nitrogenVolumeFactor,
  mixtureAt,
  ratioFromQuality,
  qualityFromDensity,
  homogeneousFriction,
} from "./foam-cement-physics";
import type {
  FoamJobInput,
  FoamSettings,
  FoamDesign,
  FoamStage,
  FoamDesignPoint,
  FoamCellState,
  FoamFluidKind,
  FoamFrame,
  FoamSimulation,
  FoamLabRow,
  FoamCandidate,
} from "./foam-cement-types";
export const FOAM_MODEL_VERSION = "foam-2.0-conservative-homogeneous";
const area = (d: number) => (Math.PI / 4) * (d / 1000) ** 2;
export function defaultFoamSettings(input: {
  wellData: FoamJobInput["wellData"];
  baseDensity?: number;
  rate?: number;
  top?: number;
  fractureGradient?: number;
}): FoamSettings {
  const w = input.wellData;
  return {
    foamVolumeMultiplier: 1,
    recipeId: "custom",
    baseDensity: input.baseDensity ?? 1.88,
    waterCementRatio: 0.44,
    yieldM3PerTon: 0.78,
    foamerPctBWOC: 0.5,
    liquidPV: 42,
    liquidYP: 7,
    mudPV: 25,
    mudYP: 5,
    pumpRateLps: input.rate ?? 10,
    targetFoamQuality: 25,
    controlMode: "reference-quality",
    targetDensity: 1.4,
    referenceMode: "depth",
    referenceMD: w.casingDepthMD,
    referencePressureMPa: 5,
    referenceTemperatureC: 20,
    standardTemperatureC: 20,
    backPressure: 0.5,
    surfaceTemperature: 20,
    bottomTemperature: w.bottomTempStatic,
    temperatureMode: "static",
    thermalResponseMin: 30,
    cementTopMD: Math.max(0, input.top ?? 0),
    buffers: [{ name: "Буфер", volumeM3: 3, density: 1.1, pvCp: 10, ypPa: 2 }],
    zones: [],
    formations: [],
    fractureGradient: input.fractureGradient ?? 18,
    poreGradient: null,
    limitsSource: "Проектные значения; подтвердить по скважине",
    maxPumpPressureMPa: 40,
    maxN2RateStdM3Min: 120,
    maxN2PressureMPa: 40,
    maxSlurryRateLps: 25,
    n2AvailableStdM3: 20000,
    pauseAfterFoamMin: 0,
    finalHoldMin: 5,
    frictionMultiplier: 1,
    roughnessMm: 0.05,
    spatialCells: 48,
    timeStepMin: 0.5,
    lab: [],
  };
}
export function validateFoamJob(input: FoamJobInput): string[] {
  const errors: string[] = [];
  if (!input?.wellData || !input?.settings)
    return ["Нет конструкции скважины или параметров пеноцементирования."];
  const w = input.wellData,
    s = input.settings;
  if (
    !Number.isFinite(s.foamVolumeMultiplier) ||
    s.foamVolumeMultiplier < 0.2 ||
    s.foamVolumeMultiplier > 5
  )
    errors.push("Множитель объёма базы: 0,2-5.");
  if (
    !["reference-quality", "constant-density"].includes(s.controlMode) ||
    !["depth", "generator"].includes(s.referenceMode) ||
    !["static", "circulating"].includes(s.temperatureMode)
  )
    errors.push("Неизвестный режим расчёта.");
  for (const [label, val] of Object.entries({
    MD: w.casingDepthMD,
    OD: w.casingOD,
    стенка: w.casingWall,
    ствол: w.holeDiameter,
    плотность_бурового: input.mudDensity,
    плотность_базы: s.baseDensity,
    расход: s.pumpRateLps,
    время_теплообмена: s.thermalResponseMin,
    выход: s.yieldM3PerTon,
  }))
    if (!Number.isFinite(val) || val <= 0)
      errors.push(`${label}: требуется число больше нуля.`);
  if (
    Array.isArray(w.trajectory) &&
    w.trajectory.length &&
    (w.trajectory[0].md !== 0 ||
      w.trajectory.at(-1)!.md < w.casingDepthMD ||
      interpolateTVD(w.casingDepthMD, w.trajectory) <= 0)
  )
    errors.push(
      "Траектория должна начинаться на устье, покрывать башмак и иметь положительный забойный TVD.",
    );
  const id = getCasingID(w.casingOD, w.casingWall);
  if (id <= 0 || id >= w.casingOD)
    errors.push("Некорректная толщина обсадной колонны.");
  if (!Number.isFinite(w.cavernCoeff) || w.cavernCoeff <= 0)
    errors.push("Коэффициент кавернозности должен быть больше нуля.");
  if (w.holeDiameter * Math.sqrt(w.cavernCoeff || 1) <= w.casingOD)
    errors.push("Ствол должен быть шире наружного диаметра колонны.");
  if (w.prevCasingDepth > 0 && w.prevCasingID <= w.casingOD)
    errors.push("ID предыдущей колонны должен быть больше OD спускаемой.");
  if (
    !Number.isFinite(s.cementTopMD) ||
    s.cementTopMD < 0 ||
    s.cementTopMD >= w.casingDepthMD
  )
    errors.push(
      "Кровля цемента должна находиться выше башмака и не выше устья.",
    );
  for (const [label, val] of Object.entries({
    FQ: s.targetFoamQuality,
    плотность: s.targetDensity,
    опорное_давление: s.referencePressureMPa,
    опорная_глубина: s.referenceMD,
  }))
    if (!Number.isFinite(val)) errors.push(`${label}: недопустимое число.`);
  if (s.targetFoamQuality < 0 || s.targetFoamQuality >= 90)
    errors.push("Целевое FQ: от 0 до менее 90%.");
  if (
    s.controlMode === "constant-density" &&
    (s.targetDensity <= 0 || s.targetDensity > s.baseDensity)
  )
    errors.push(
      "Целевая плотность должна быть положительной и не превышать плотность базы.",
    );
  if (
    s.referencePressureMPa < 0 ||
    s.referenceMD < 0 ||
    s.referenceMD > w.casingDepthMD
  )
    errors.push("Проверьте давление и глубину опорной точки FQ.");
  for (const t of [
    s.surfaceTemperature,
    s.bottomTemperature,
    s.referenceTemperatureC,
    s.standardTemperatureC,
  ])
    if (!Number.isFinite(t) || t < -30 || t > 250)
      errors.push("Температура вне области расчёта -30…250 °C.");
  for (const key of [
    "backPressure",
    "liquidPV",
    "liquidYP",
    "mudPV",
    "mudYP",
    "pauseAfterFoamMin",
    "finalHoldMin",
    "roughnessMm",
    "foamerPctBWOC",
    "waterCementRatio",
  ] as const)
    if (!Number.isFinite(s[key]) || s[key] < 0)
      errors.push(`${key}: требуется неотрицательное число.`);
  if (s.liquidPV <= 0 || s.mudPV <= 0)
    errors.push("PV жидкостей должна быть положительной.");
  for (const key of [
    "frictionMultiplier",
    "maxPumpPressureMPa",
    "maxN2RateStdM3Min",
    "maxN2PressureMPa",
    "maxSlurryRateLps",
    "n2AvailableStdM3",
    "fractureGradient",
  ] as const)
    if (!Number.isFinite(s[key]) || s[key] <= 0)
      errors.push(`${key}: требуется положительное число.`);
  if (
    s.poreGradient !== null &&
    (!Number.isFinite(s.poreGradient) || s.poreGradient < 0)
  )
    errors.push("Некорректный градиент пластового давления.");
  if (
    !Number.isInteger(s.spatialCells) ||
    s.spatialCells < 16 ||
    s.spatialCells > 120 ||
    s.timeStepMin < 0.1 ||
    s.timeStepMin > 2 ||
    !Number.isFinite(s.timeStepMin)
  )
    errors.push("Сетка: 16-120 ячеек на ветвь, шаг времени 0,1-2 мин.");
  if (w.prevCasingDepth < 0 || w.prevCasingDepth > w.casingDepthMD)
    errors.push("Глубина предыдущей колонны вне интервала.");
  if (!Array.isArray(w.trajectory) || w.trajectory.length < 2)
    errors.push("Для расчёта нужна траектория минимум из двух точек.");
  else
    for (let i = 0; i < w.trajectory.length; i++) {
      const p = w.trajectory[i];
      if (
        !p ||
        ![p.md, p.tvd, p.zenith, p.azimuth].every(Number.isFinite) ||
        p.md < 0 ||
        p.tvd < 0 ||
        p.tvd > p.md + 0.1 ||
        (i > 0 &&
          (p.md <= w.trajectory[i - 1].md || p.tvd < w.trajectory[i - 1].tvd))
      )
        errors.push(
          "Траектория должна иметь возрастающий MD и неубывающий физический TVD.",
        );
    }
  if (
    !Array.isArray(s.buffers) ||
    !Array.isArray(s.zones) ||
    !Array.isArray(s.formations) ||
    !Array.isArray(s.lab)
  )
    return [
      ...errors,
      "Некорректный формат буферов, зон или лабораторных данных.",
    ];
  for (const b of s.buffers)
    if (
      !b ||
      ![b.volumeM3, b.density, b.pvCp, b.ypPa].every(Number.isFinite) ||
      b.volumeM3 < 0 ||
      b.density <= 0 ||
      b.pvCp <= 0 ||
      b.ypPa < 0
    )
      errors.push("Некорректные свойства буфера.");
  if (s.zones.some((z) => !z)) errors.push("Пустая зона FQ.");
  const zones = [...s.zones].filter(Boolean).sort((a, b) => a.topMD - b.topMD);
  zones.forEach((z, i) => {
    if (
      !z ||
      ![z.topMD, z.bottomMD, z.targetFQ].every(Number.isFinite) ||
      z.topMD < s.cementTopMD ||
      z.bottomMD > w.casingDepthMD ||
      z.bottomMD <= z.topMD ||
      z.targetFQ < 0 ||
      z.targetFQ >= 90 ||
      (i > 0 && z.topMD < zones[i - 1].bottomMD)
    )
      errors.push(
        "Зоны FQ должны быть внутри цементируемого интервала и не перекрываться.",
      );
  });
  for (const f of s.formations)
    if (
      !f ||
      !Number.isFinite(f.md) ||
      f.md < 0 ||
      f.md > w.casingDepthMD ||
      (f.poreMPa !== undefined &&
        (!Number.isFinite(f.poreMPa) || f.poreMPa < 0)) ||
      (f.fractureMPa !== undefined &&
        (!Number.isFinite(f.fractureMPa) || f.fractureMPa <= 0)) ||
      (f.poreMPa !== undefined &&
        f.fractureMPa !== undefined &&
        f.poreMPa >= f.fractureMPa)
    )
      errors.push("Некорректные давления или глубина контрольного пласта.");
  for (const row of s.lab)
    if (
      !row ||
      !row.source ||
      !["pressurized", "atmospheric", "unknown"].includes(row.preparation) ||
      ![
        row.pressureMPaAbs,
        row.temperatureC,
        row.qualityPct,
        row.pvCp,
        row.ypPa,
      ].every(Number.isFinite) ||
      row.pressureMPaAbs <= 0 ||
      row.temperatureC < -30 ||
      row.temperatureC > 250 ||
      row.qualityPct < 0 ||
      row.qualityPct >= 90 ||
      row.pvCp <= 0 ||
      row.ypPa < 0 ||
      [
        row.stabilityMin,
        row.thickeningMin,
        row.compressiveMPa,
        row.permeabilityMd,
      ].some((v) => v !== undefined && (!Number.isFinite(v) || v < 0))
    )
      errors.push(
        "Лабораторная строка: проверьте источник, Pабс, T, FQ и положительные свойства.",
      );
  return [...new Set(errors)];
}
function assertInput(input: FoamJobInput) {
  const errors = validateFoamJob(input);
  if (errors.length) throw new Error(errors.join("\n"));
}
interface GeometryCell {
  leg: "pipe" | "annulus";
  mdTop: number;
  mdBottom: number;
  md: number;
  tvd: number;
  dTVD: number;
  areaM2: number;
  capacityM3: number;
  D: number;
  outer: number;
  inner: number;
}
function geometry(input: FoamJobInput): GeometryCell[] {
  const w = input.wellData,
    s = input.settings,
    depth = w.casingDepthMD,
    id = getCasingID(w.casingOD, w.casingWall);
  const breaks = [
    0,
    depth,
    s.cementTopMD,
    ...w.trajectory.map((p) => p.md),
    ...(w.casingSections ?? []).flatMap((x) => [x.fromMD, x.toMD]),
    ...(w.cavernIntervals ?? []).flatMap((x) => [x.fromMD, x.toMD]),
    w.prevCasingDepth,
    ...s.zones.flatMap((z) => [z.topMD, z.bottomMD]),
    ...Array.from(
      { length: s.spatialCells + 1 },
      (_, i) => (i * depth) / s.spatialCells,
    ),
  ]
    .filter((m) => m >= 0 && m <= depth)
    .sort((a, b) => a - b)
    .filter((m, i, a) => i === 0 || m - a[i - 1] > 1e-7);
  const leg = (kind: "pipe" | "annulus") =>
    breaks.slice(0, -1).map((top, i) => {
      const bottom = breaks[i + 1],
        md = (top + bottom) / 2;
      const outer =
        kind === "pipe"
          ? getCasingIDAtDepth(md, w.casingOD, w.casingWall, w.casingSections)
          : md <= w.prevCasingDepth
            ? w.prevCasingID
            : w.holeDiameter *
              Math.sqrt(
                getCavernCoeffAtDepth(md, w.cavernCoeff, w.cavernIntervals),
              );
      const inner = kind === "pipe" ? 0 : w.casingOD;
      const a = area(outer) - area(inner);
      if (!Number.isFinite(a) || a <= 0)
        throw new Error(`Несовместимая геометрия на MD ${md.toFixed(1)} м.`);
      return {
        leg: kind,
        mdTop: top,
        mdBottom: bottom,
        md,
        tvd: interpolateTVD(md, w.trajectory),
        dTVD:
          (interpolateTVD(bottom, w.trajectory) -
            interpolateTVD(top, w.trajectory)) *
          (kind === "pipe" ? 1 : -1),
        areaM2: a,
        capacityM3: a * (bottom - top),
        D: (outer - inner) / 1000,
        outer: outer / 1000,
        inner: inner / 1000,
      };
    });
  return [...leg("pipe"), ...leg("annulus").reverse()];
}
function temperature(input: FoamJobInput, md: number, time: number) {
  const w = input.wellData,
    s = input.settings,
    depthTVD = interpolateTVD(w.casingDepthMD, w.trajectory);
  const bh =
    s.temperatureMode === "circulating"
      ? w.bottomTempStatic +
        (s.bottomTemperature - w.bottomTempStatic) *
          (1 - Math.exp(-time / s.thermalResponseMin))
      : s.bottomTemperature;
  return (
    s.surfaceTemperature +
    ((bh - s.surfaceTemperature) * interpolateTVD(md, w.trajectory)) /
      Math.max(1, depthTVD)
  );
}
function zoneFQ(input: FoamJobInput, md: number) {
  return (
    input.settings.zones.find((z) => md >= z.topMD && md < z.bottomMD)
      ?.targetFQ ?? input.settings.targetFoamQuality
  );
}
export function designFoamJob(input: FoamJobInput): FoamDesign {
  assertInput(input);
  const w = input.wellData,
    s = input.settings,
    cells = geometry(input),
    ann = cells.filter((c) => c.leg === "annulus").reverse(),
    std = s.standardTemperatureC;
  const referenceMode =
    s.controlMode === "constant-density" ? "depth" : s.referenceMode;
  let refP =
    FOAM_ATM +
    s.backPressure +
    (s.baseDensity * FOAM_G * interpolateTVD(s.referenceMD, w.trajectory)) /
      1000;
  let points: FoamDesignPoint[] = [];
  let refT = temperature(input, s.referenceMD, 0);
  for (let outer = 0; outer < 30; outer++) {
    let p = FOAM_ATM + s.backPressure;
    points = [];
    const boundaries: { md: number; p: number }[] = [{ md: 0, p }];
    for (const c of ann) {
      const t = temperature(input, c.md, 0);
      let pMid = p + (s.baseDensity * FOAM_G * Math.abs(c.dTVD)) / 2000;
      let ratio = 0,
        mix = mixtureAt(input.mudDensity, 0, pMid, t, std);
      const foam = c.md >= s.cementTopMD;
      for (let iter = 0; iter < 16; iter++) {
        if (foam) {
          const fq = zoneFQ(input, c.md);
          ratio =
            s.controlMode === "constant-density"
              ? ratioFromQuality(
                  Math.max(
                    0,
                    qualityFromDensity(s.baseDensity, s.targetDensity, pMid, t),
                  ),
                  pMid,
                  t,
                  std,
                )
              : ratioFromQuality(
                  fq,
                  referenceMode === "generator"
                    ? FOAM_ATM + s.referencePressureMPa
                    : refP,
                  referenceMode === "generator"
                    ? s.referenceTemperatureC
                    : refT,
                  std,
                );
        }
        mix = mixtureAt(
          foam ? s.baseDensity : input.mudDensity,
          ratio,
          pMid,
          t,
          std,
        );
        const next = p + (mix.density * FOAM_G * Math.abs(c.dTVD)) / 2000;
        if (Math.abs(next - pMid) < 1e-7) {
          pMid = next;
          break;
        }
        pMid = (pMid + next) / 2;
      }
      p += (mix.density * FOAM_G * Math.abs(c.dTVD)) / 1000;
      boundaries.push({ md: c.mdBottom, p });
      if (foam)
        points.push({
          md: c.md,
          tvd: c.tvd,
          pressureMPaAbs: pMid,
          temperatureC: t,
          qualityPct: mix.qualityPct,
          density: mix.density,
          z: mix.z,
          localVolumeM3: c.capacityM3,
          baseVolumeM3: c.capacityM3 / mix.volumeFactor,
          n2StdM3: (c.capacityM3 / mix.volumeFactor) * ratio,
          gasStdPerBase: ratio,
        });
    }
    const pAt = (md: number) => {
      const i = boundaries.findIndex((p) => p.md >= md);
      if (i <= 0) return boundaries[Math.max(0, i)].p;
      const a = boundaries[i - 1],
        b = boundaries[i];
      return a.p + ((b.p - a.p) * (md - a.md)) / (b.md - a.md);
    };
    const next = pAt(s.referenceMD);
    if (
      referenceMode === "generator" ||
      s.controlMode === "constant-density" ||
      Math.abs(next - refP) < 1e-6
    ) {
      refP = next;
      break;
    }
    refP = (refP + next) / 2;
  }
  const base =
      points.reduce((n, p) => n + p.baseVolumeM3, 0) * s.foamVolumeMultiplier,
    gas = points.reduce((n, p) => n + p.n2StdM3, 0) * s.foamVolumeMultiplier,
    pipe = cells
      .filter((c) => c.leg === "pipe")
      .reduce((n, c) => n + c.capacityM3, 0);
  const stages: FoamStage[] = [];
  s.buffers
    .filter((b) => b.volumeM3 > 0)
    .forEach((b, i) =>
      stages.push({
        id: `buffer-${i}`,
        name: b.name || `Буфер ${i + 1}`,
        kind: "buffer",
        liquidVolumeM3: b.volumeM3,
        liquidRateLps: s.pumpRateLps,
        gasStdPerBase: 0,
        density: b.density,
        pvCp: b.pvCp,
        ypPa: b.ypPa,
        durationMin: b.volumeM3 / (s.pumpRateLps * 0.06),
        backPressureMPa: s.backPressure,
      }),
    );
  points.forEach((p, i) => {
    const previous = stages[stages.length - 1];
    if (
      previous?.kind === "foam" &&
      Math.abs(previous.gasStdPerBase - p.gasStdPerBase) < 1e-7
    ) {
      previous.liquidVolumeM3 += p.baseVolumeM3 * s.foamVolumeMultiplier;
      previous.durationMin = previous.liquidVolumeM3 / (s.pumpRateLps * 0.06);
    } else
      stages.push({
        id: `foam-${i}`,
        name: `Пеноцемент · проект MD ${p.md.toFixed(0)} м`,
        kind: "foam",
        liquidVolumeM3: p.baseVolumeM3 * s.foamVolumeMultiplier,
        liquidRateLps: s.pumpRateLps,
        gasStdPerBase: p.gasStdPerBase,
        density: s.baseDensity,
        pvCp: s.liquidPV,
        ypPa: s.liquidYP,
        durationMin:
          (p.baseVolumeM3 * s.foamVolumeMultiplier) / (s.pumpRateLps * 0.06),
        backPressureMPa: s.backPressure,
      });
  });
  if (s.pauseAfterFoamMin > 0)
    stages.push({
      id: "pause",
      name: "Остановка после пены",
      kind: "pause",
      liquidVolumeM3: 0,
      liquidRateLps: 0,
      gasStdPerBase: 0,
      density: input.mudDensity,
      pvCp: s.mudPV,
      ypPa: s.mudYP,
      durationMin: s.pauseAfterFoamMin,
      backPressureMPa: s.backPressure,
    });
  stages.push({
    id: "displacement",
    name: "Продавка до башмака",
    kind: "displacement",
    liquidVolumeM3: pipe,
    liquidRateLps: s.pumpRateLps,
    gasStdPerBase: 0,
    density: input.mudDensity,
    pvCp: s.mudPV,
    ypPa: s.mudYP,
    durationMin: pipe / (s.pumpRateLps * 0.06),
    backPressureMPa: s.backPressure,
  });
  if (s.finalHoldMin > 0)
    stages.push({
      id: "hold",
      name: "Остановка · статический срез",
      kind: "pause",
      liquidVolumeM3: 0,
      liquidRateLps: 0,
      gasStdPerBase: 0,
      density: input.mudDensity,
      pvCp: s.mudPV,
      ypPa: s.mudYP,
      durationMin: s.finalHoldMin,
      backPressureMPa: s.backPressure,
    });
  const cement = base / s.yieldM3PerTon,
    water = cement * s.waterCementRatio,
    foamer = (cement * 1000 * s.foamerPctBWOC) / 100;
  const mismatch =
    100 *
    ((cement * (1 + s.waterCementRatio) * 1000 + foamer) /
      Math.max(1e-9, base * s.baseDensity * 1000) -
      1);
  const ref = points.reduce((a, b) =>
    Math.abs(a.md - s.referenceMD) < Math.abs(b.md - s.referenceMD) ? a : b,
  );
  return {
    points,
    annulusVolumeM3: ann.reduce((n, c) => n + c.capacityM3, 0),
    plannedFoamVolumeM3: points.reduce((n, p) => n + p.localVolumeM3, 0),
    pipeCapacityM3: pipe,
    baseSlurryM3: base,
    n2StdM3: gas,
    stages,
    reference: {
      md: referenceMode === "depth" ? s.referenceMD : null,
      pressureMPaAbs:
        referenceMode === "generator"
          ? FOAM_ATM + s.referencePressureMPa
          : refP,
      temperatureC:
        referenceMode === "generator" ? s.referenceTemperatureC : refT,
      qualityPct:
        s.controlMode === "constant-density"
          ? qualityFromDensity(s.baseDensity, s.targetDensity, refP, refT)
          : zoneFQ(
              input,
              s.referenceMD === w.casingDepthMD
                ? s.referenceMD - 1e-6
                : s.referenceMD,
            ),
      density:
        s.controlMode === "constant-density"
          ? s.targetDensity
          : mixtureAt(
              s.baseDensity,
              ratioFromQuality(
                zoneFQ(
                  input,
                  s.referenceMD === w.casingDepthMD
                    ? s.referenceMD - 1e-6
                    : s.referenceMD,
                ),
                referenceMode === "generator"
                  ? FOAM_ATM + s.referencePressureMPa
                  : refP,
                referenceMode === "generator" ? s.referenceTemperatureC : refT,
                std,
              ),
              referenceMode === "generator"
                ? FOAM_ATM + s.referencePressureMPa
                : refP,
              referenceMode === "generator" ? s.referenceTemperatureC : refT,
              std,
            ).density,
    },
    cementTonnes: cement,
    waterM3: water,
    foamerKg: foamer,
    recipeMassMismatchPct: mismatch,
    notes: [
      "План размещения рассчитан по статической PVT-модели; фактическая динамическая кровля показана отдельно.",
      `Объём базы и азота умножен на ${s.foamVolumeMultiplier.toFixed(3)} относительно статического плана; расход N₂ на единицу базы сохранён.`,
      "Продавка рассчитана до башмака без оставления цементного стакана; потери, утечки и размыв не включены.",
      "N₂: Peng–Robinson, газовая ветвь; точность не приравнивается к эталонной EOS NIST.",
      "Совместное движение фаз без проскальзывания, растворения газа, коалесценции и модели разрушения пены.",
      "Температура задана профилем; циркуляционное изменение экспоненциальное, не решение теплопереноса.",
      ...(s.recipeId !== "custom"
        ? [
            "Выбрана демонстрационная рецептура: необходим протокол конкретной партии.",
          ]
        : []),
      ...(Math.abs(mismatch) > 5
        ? [
            "Выход, В/Ц и плотность рецептуры не согласованы по массе более чем на 5%; материальная ведомость ориентировочная.",
          ]
        : []),
    ],
  };
}
interface Parcel {
  kind: FoamFluidKind;
  liquid: number;
  ratio: number;
  density: number;
  pv: number;
  yp: number;
}
function labRheology(lab: FoamLabRow[], p: number, t: number, fq: number) {
  const eligible = lab.filter(
    (r) =>
      r.preparation === "pressurized" &&
      Math.abs(r.temperatureC - t) <= 10 &&
      Math.abs(r.pressureMPaAbs - p) <= Math.max(1, p * 0.2) &&
      Math.abs(r.qualityPct - fq) <= 5,
  );
  return eligible.sort(
    (a, b) =>
      Math.abs(a.temperatureC - t) +
      Math.abs(a.qualityPct - fq) +
      Math.abs(a.pressureMPaAbs - p) -
      Math.abs(b.temperatureC - t) -
      Math.abs(b.qualityPct - fq) -
      Math.abs(b.pressureMPaAbs - p),
  )[0];
}
export function simulateFoamJob(input: FoamJobInput): FoamSimulation {
  assertInput(input);
  const design = designFoamJob(input),
    s = input.settings,
    w = input.wellData,
    geo = geometry(input),
    N = geo.length,
    pipeN = geo.filter((c) => c.leg === "pipe").length;
  const totalCapacity = geo.reduce((n, c) => n + c.capacityM3, 0),
    stdRho = nitrogenDensity(FOAM_ATM, s.standardTemperatureC);
  let parcels: Parcel[] = [
    {
      kind: "mud",
      liquid: totalCapacity,
      ratio: 0,
      density: input.mudDensity,
      pv: s.mudPV,
      yp: s.mudYP,
    },
  ];
  let pGuess = geo.map(
    (c) =>
      FOAM_ATM + s.backPressure + (input.mudDensity * FOAM_G * c.tvd) / 1000,
  );
  let time = 0,
    baseInjected = 0,
    gasInjected = 0,
    liquidInjected = 0,
    returnedBase = 0,
    returnedGas = 0,
    backflow = 0;
  const frames: FoamFrame[] = [];
  let anyLabMissing = false;
  let maxFQ = 0;
  function snapshot(stage: string, rate: number, n2Rate: number) {
    let mapped: FoamCellState[] = [],
      kept: number[] = [],
      virtual = 0,
      residual = Infinity,
      iterations = 0,
      pressureBounds: number[] = [],
      dp: number[] = [],
      freeFall = false;
    const map = () => {
      let cursor = 0,
        used = 0;
      kept = parcels.map(() => 0);
      virtual = 0;
      mapped = geo.map((c, j) => {
        let remaining = c.capacityM3,
          mass = 0,
          gasV = 0,
          baseV = 0,
          n2 = 0,
          pv = 0,
          yp = 0;
        const fractions: Record<FoamFluidKind, number> = {
            mud: 0,
            buffer: 0,
            foam: 0,
            displacement: 0,
          },
          t = temperature(input, c.md, time),
          p = Math.max(FOAM_ATM, pGuess[j]);
        while (remaining > 1e-10) {
          const parcel = parcels[cursor];
          if (!parcel) {
            virtual += remaining;
            mass += remaining * input.mudDensity * 1000;
            pv += remaining * s.mudPV;
            yp += remaining * s.mudYP;
            fractions.mud += remaining / c.capacityM3;
            remaining = 0;
            break;
          }
          const mix = mixtureAt(
              parcel.density,
              parcel.ratio,
              p,
              t,
              s.standardTemperatureC,
            ),
            liquid = Math.min(
              parcel.liquid - used,
              remaining / mix.volumeFactor,
            ),
            volume = liquid * mix.volumeFactor;
          if (liquid < 1e-12) {
            cursor++;
            used = 0;
            continue;
          }
          kept[cursor] += liquid;
          used += liquid;
          remaining = Math.max(0, remaining - volume);
          mass +=
            liquid * parcel.density * 1000 + liquid * parcel.ratio * stdRho;
          gasV += volume - liquid;
          n2 += liquid * parcel.ratio;
          fractions[parcel.kind] += volume / c.capacityM3;
          if (parcel.kind === "foam") baseV += liquid;
          let effectivePV = parcel.pv,
            effectiveYP = parcel.yp;
          if (parcel.kind === "foam") {
            const row = labRheology(s.lab, p, t, mix.qualityPct);
            if (row) {
              effectivePV = row.pvCp;
              effectiveYP = row.ypPa;
            } else {
              anyLabMissing = true;
              const phi = mix.qualityPct / 100;
              effectivePV *= 1 + 2.5 * phi + 10 * phi * phi;
              effectiveYP *= 1 + 3 * phi;
            }
          }
          pv += volume * effectivePV;
          yp += volume * effectiveYP;
          if (used >= parcel.liquid - 1e-10) {
            cursor++;
            used = 0;
          }
        }
        const quality = (gasV / c.capacityM3) * 100,
          velocity =
            rate / 1000 / (Math.max(0.01, 1 - quality / 100) * c.areaM2);
        maxFQ = Math.max(maxFQ, quality);
        return {
          ...c,
          pressureMPaAbs: p,
          temperatureC: t,
          density: mass / c.capacityM3 / 1000,
          qualityPct: quality,
          z: mixtureAt(1, 0, p, t, s.standardTemperatureC).z,
          velocityMps: velocity,
          fractions,
          baseFoamM3: baseV,
          n2StdM3: n2,
          foamVolumeM3: fractions.foam * c.capacityM3,
          _pv: pv / c.capacityM3,
          _yp: yp / c.capacityM3,
        };
      });
    };
    function pressures(friction: boolean) {
      const bounds = Array(N + 1).fill(0);
      bounds[N] = FOAM_ATM + s.backPressure;
      const losses = Array(N).fill(0);
      for (let j = N - 1; j >= 0; j--) {
        const c = geo[j],
          state = mapped[j] as FoamCellState & { _pv: number; _yp: number };
        const loss = friction
          ? homogeneousFriction({
              length: c.mdBottom - c.mdTop,
              hydraulicD: c.D,
              velocity: state.velocityMps,
              density: state.density * 1000,
              pvCp: state._pv,
              ypPa: state._yp,
              roughnessMm: s.roughnessMm,
              annularOuter: c.leg === "annulus" ? c.outer : undefined,
              annularInner: c.leg === "annulus" ? c.inner : undefined,
            }) * s.frictionMultiplier
          : 0;
        losses[j] = loss;
        bounds[j] =
          bounds[j + 1] - (state.density * FOAM_G * c.dTVD) / 1000 + loss;
      }
      return { bounds, losses };
    }
    for (let it = 0; it < 70; it++) {
      map();
      const next = pressures(true);
      pressureBounds = next.bounds;
      dp = next.losses;
      const target = geo.map((_, j) =>
        Math.max(FOAM_ATM, (pressureBounds[j] + pressureBounds[j + 1]) / 2),
      );
      residual = Math.max(...target.map((p, j) => Math.abs(p - pGuess[j])));
      iterations = it + 1;
      if (residual < 0.002) {
        pGuess = target;
        break;
      }
      pGuess = pGuess.map((p, j) => p * 0.45 + target[j] * 0.55);
    }
    map();
    const dynamic = pressures(true),
      hydro = pressures(false);
    pressureBounds = dynamic.bounds;
    dp = dynamic.losses;
    freeFall =
      pressureBounds[0] < FOAM_ATM - 1e-5 ||
      pressureBounds.some((p) => p < 0.02);
    // Keep only parcel material physically in the well. Excess is returned at the outlet, never re-injected.
    const retained = parcels.map((p, i) => ({ ...p, liquid: kept[i] ?? 0 }));
    parcels.forEach((p, i) => {
      const out = Math.max(0, p.liquid - (kept[i] ?? 0));
      if (p.kind === "foam") returnedBase += out;
      returnedGas += out * p.ratio;
    });
    parcels = retained.filter((p) => p.liquid > 1e-9);
    if (virtual > 1e-9) {
      backflow += virtual;
      parcels.push({
        kind: "mud",
        liquid: virtual,
        ratio: 0,
        density: input.mudDensity,
        pv: s.mudPV,
        yp: s.mudYP,
      });
    }
    const retainedGas = mapped.reduce((n, c) => n + c.n2StdM3, 0),
      retainedBase = mapped.reduce((n, c) => n + c.baseFoamM3, 0),
      ann = mapped.filter((c) => c.leg === "annulus");
    const foam = ann.filter((c) => c.foamVolumeM3 > 1e-7),
      top = foam.length
        ? Math.min(
            ...foam.map(
              (c) => c.mdBottom - (c.mdBottom - c.mdTop) * c.fractions.foam,
            ),
          )
        : null;
    const bhp = pressureBounds[pipeN] - FOAM_ATM,
      staticBHP = hydro.bounds[pipeN] - FOAM_ATM,
      bottomTVD = interpolateTVD(w.casingDepthMD, w.trajectory);
    const pressureAt = (md: number) => {
      const c = ann.find((c) => md >= c.mdTop && md <= c.mdBottom);
      if (!c) return s.backPressure;
      const j = mapped.indexOf(c);
      const f = (md - c.mdTop) / (c.mdBottom - c.mdTop);
      return pressureBounds[j + 1] * (1 - f) + pressureBounds[j] * f - FOAM_ATM;
    };
    const margins: FoamFrame["formationMargins"] = s.formations.map((f) => ({
      name: f.name || `MD ${f.md}`,
      md: f.md,
      pressureMPa: pressureAt(f.md),
      poreMarginMPa:
        f.poreMPa === undefined ? null : pressureAt(f.md) - f.poreMPa,
      fractureMarginMPa:
        f.fractureMPa === undefined ? null : f.fractureMPa - pressureAt(f.md),
    }));
    const open = ann.filter((c) => c.md >= w.prevCasingDepth && c.tvd > 0);
    if (open.length) {
      const weak = open.reduce((a, b) =>
        (s.fractureGradient * a.tvd) / 1000 - pressureAt(a.md) <
        (s.fractureGradient * b.tvd) / 1000 - pressureAt(b.md)
          ? a
          : b,
      );
      margins.push({
        name: "Минимум до ГРП по открытому стволу",
        md: weak.md,
        pressureMPa: pressureAt(weak.md),
        poreMarginMPa: null,
        fractureMarginMPa:
          (s.fractureGradient * weak.tvd) / 1000 - pressureAt(weak.md),
      });
      if (s.poreGradient !== null) {
        const low = open.reduce((a, b) =>
          pressureAt(a.md) - (s.poreGradient! * a.tvd) / 1000 <
          pressureAt(b.md) - (s.poreGradient! * b.tvd) / 1000
            ? a
            : b,
        );
        margins.push({
          name: "Минимум над пластовым по открытому стволу",
          md: low.md,
          pressureMPa: pressureAt(low.md),
          poreMarginMPa: pressureAt(low.md) - (s.poreGradient * low.tvd) / 1000,
          fractureMarginMPa: null,
        });
      }
    }
    frames.push({
      time,
      stage,
      liquidRateLps: rate,
      n2RateStdM3Min: n2Rate,
      foamerRateKgMin:
        rate > 0 && n2Rate >= 0 && stage.startsWith("Пеноцемент")
          ? (((s.foamerPctBWOC / 100) * rate * 0.06) / s.yieldM3PerTon) * 1000
          : 0,
      pumpPressureMPa: Math.max(0, pressureBounds[0] - FOAM_ATM),
      hydroPumpPressureMPa: hydro.bounds[0] - FOAM_ATM,
      annulusBHPMPa: bhp,
      staticBHPMPa: staticBHP,
      dynamicECD: bhp / ((FOAM_G * bottomTVD) / 1000),
      staticECD: staticBHP / ((FOAM_G * bottomTVD) / 1000),
      frictionMPa: dp.reduce((n, v) => n + v, 0),
      cumulativeBaseM3: baseInjected,
      cumulativeN2StdM3: gasInjected,
      cumulativeInjectedLiquidM3: liquidInjected,
      retainedN2StdM3: retainedGas,
      returnedN2StdM3: returnedGas,
      retainedBaseM3: retainedBase,
      returnedBaseM3: returnedBase,
      foamInAnnulusM3: ann.reduce((n, c) => n + c.foamVolumeM3, 0),
      foamTopMD: top,
      baseBalanceErrorPct:
        (100 * Math.abs(baseInjected - retainedBase - returnedBase)) /
        Math.max(1, baseInjected),
      gasBalanceErrorPct:
        (100 * Math.abs(gasInjected - retainedGas - returnedGas)) /
        Math.max(1, gasInjected),
      formationMargins: margins,
      converged: residual < 0.002,
      residualMPa: residual,
      iterations,
      freeFall,
      boundaryBackflowM3: backflow,
      cells: mapped.map(({ ...c }) => c),
    });
  }
  snapshot("Исходное состояние", 0, 0);
  for (const stage of design.stages) {
    const count = Math.max(1, Math.ceil(stage.durationMin / s.timeStepMin));
    if (count > 3000)
      throw new Error(
        "Слишком длинная операция для выбранного шага времени. Увеличьте шаг или расход.",
      );
    const dt = stage.durationMin / count;
    for (let step = 0; step < count; step++) {
      const v = stage.liquidVolumeM3 / count;
      time += dt;
      if (v > 0 && stage.kind !== "pause") {
        const p: Parcel = {
          kind: stage.kind,
          liquid: v,
          ratio: stage.gasStdPerBase,
          density: stage.density,
          pv: stage.pvCp,
          yp: stage.ypPa,
        };
        const first = parcels[0];
        if (
          first &&
          first.kind === p.kind &&
          first.ratio === p.ratio &&
          first.density === p.density
        )
          first.liquid += v;
        else parcels.unshift(p);
        liquidInjected += v;
        if (stage.kind === "foam") baseInjected += v;
        gasInjected += v * stage.gasStdPerBase;
      }
      snapshot(
        stage.name,
        stage.liquidRateLps,
        stage.gasStdPerBase * stage.liquidRateLps * 0.06,
      );
    }
  }
  const last = frames[frames.length - 1];
  const max = (
    key:
      | "pumpPressureMPa"
      | "dynamicECD"
      | "n2RateStdM3Min"
      | "gasBalanceErrorPct"
      | "baseBalanceErrorPct",
  ) => Math.max(...frames.map((f) => f[key]));
  const allMargins = frames.flatMap((f) => f.formationMargins),
    minFrac = Math.min(
      ...allMargins.map((m) => m.fractureMarginMPa ?? Infinity),
    ),
    minPore = Math.min(...allMargins.map((m) => m.poreMarginMPa ?? Infinity));
  const constraints = [
    {
      label: "Кадры вне модели полного заполнения",
      actual: frames.filter((f) => f.freeFall).length,
      limit: 0,
      unit: "кадров",
    },
    {
      label: "Несошедшиеся расчётные кадры",
      actual: frames.filter((f) => !f.converged).length,
      limit: 0,
      unit: "кадров",
    },
    {
      label: "Невязка материального баланса",
      actual: Math.max(max("gasBalanceErrorPct"), max("baseBalanceErrorPct")),
      limit: 0.1,
      unit: "%",
    },
    {
      label: "Неразрешённый обратный объём на границе",
      actual: backflow,
      limit: 0.001,
      unit: "м³",
    },
    {
      label: "Недостижение плановой кровли",
      actual: Math.max(0, (last.foamTopMD ?? w.casingDepthMD) - s.cementTopMD),
      limit: Math.max(5, w.casingDepthMD / s.spatialCells / 2),
      unit: "м MD",
    },
    {
      label: "Давление насоса",
      actual: max("pumpPressureMPa"),
      limit: s.maxPumpPressureMPa,
      unit: "МПа",
    },
    {
      label: "Расход азота",
      actual: max("n2RateStdM3Min"),
      limit: s.maxN2RateStdM3Min,
      unit: "м³ст/мин",
    },
    {
      label: "Давление подачи азота (насос + 1 МПа запаса)",
      actual: max("pumpPressureMPa") + 1,
      limit: s.maxN2PressureMPa,
      unit: "МПа",
    },
    {
      label: "Расход жидкой фазы",
      actual: s.pumpRateLps,
      limit: s.maxSlurryRateLps,
      unit: "л/с",
    },
    {
      label: "Запас азота",
      actual: gasInjected,
      limit: s.n2AvailableStdM3,
      unit: "м³ст",
    },
  ].map((c) => ({ ...c, pass: c.actual <= c.limit }));
  if (Number.isFinite(minFrac))
    constraints.push({
      label: "Минимальный запас до ГРП",
      actual: minFrac,
      limit: 0,
      unit: "МПа",
      pass: minFrac >= 0,
    });
  if (Number.isFinite(minPore))
    constraints.push({
      label: "Минимальный запас над пластовым",
      actual: minPore,
      limit: 0,
      unit: "МПа",
      pass: minPore >= 0,
    });
  const warnings = [
    ...design.notes,
    "Гидравлика: однородная квазистационарная модель, Darcy–Weisbach с эффективной вязкостью и геометрической поправкой затрубья. Гидроудар, free-fall и раздельное движение фаз не моделируются.",
    "Остановки показывают PVT-перераспределение и статический срез, а не полную переходную динамику после остановки насоса.",
    ...(anyLabMissing
      ? [
          "Не для всех состояний есть близкий протокол пены под давлением. Там используется эмпирическое усиление PV/YP, не лабораторная характеристика.",
        ]
      : []),
    ...(s.lab.some((l) => l.preparation !== "pressurized")
      ? [
          "Атмосферные и неидентифицированные протоколы показаны в базе, но не используются для подстановки реологии пены под давлением.",
        ]
      : []),
    ...(s.poreGradient === null &&
    !s.formations.some((f) => f.poreMPa !== undefined)
      ? ["Пластовое давление не задано: нижняя граница окна не проверена."]
      : []),
    ...(frames.some((f) => !f.converged)
      ? [
          "Есть несошедшиеся шаги: результаты этих кадров не подтверждены численно.",
        ]
      : []),
    ...(frames.some((f) => f.freeFall)
      ? [
          "Требуемое давление в части кадров ниже атмосферного: вероятен свободный сток или неполное заполнение. Эти режимы вне принятой модели.",
        ]
      : []),
    ...(maxFQ > 85
      ? [
          "Локальное FQ превышает 85%: область крайне высокого газосодержания; необходима подтверждённая модель и испытания. Это не универсальный порог стабильности.",
        ]
      : []),
    ...(backflow > 1e-4
      ? [
          `При перераспределении возник обратный объём на границе ${backflow.toFixed(3)} м³; динамика обратного течения не разрешается, результат оценочный.`,
        ]
      : []),
  ];
  return {
    modelVersion: FOAM_MODEL_VERSION,
    createdAt: new Date().toISOString(),
    input: structuredClone(input),
    design,
    frames,
    summary: {
      durationMin: time,
      maxPumpPressureMPa: max("pumpPressureMPa"),
      maxECD: max("dynamicECD"),
      maxN2RateStdM3Min: max("n2RateStdM3Min"),
      finalTOCMD: last.foamTopMD,
      maxGasBalanceErrorPct: max("gasBalanceErrorPct"),
      maxBaseBalanceErrorPct: max("baseBalanceErrorPct"),
      finalFoamAnnulusM3: last.foamInAnnulusM3,
      nonConvergedFrames: frames.filter((f) => !f.converged).length,
      freeFallFrames: frames.filter((f) => f.freeFall).length,
    },
    constraints,
    warnings,
  };
}
export function optimiseFoamJob(
  input: FoamJobInput,
  objective: "nitrogen" | "time" = "nitrogen",
): FoamCandidate[] {
  const candidates: FoamCandidate[] = [];
  const rates = [0.7, 1, 1.3]
    .map((k) =>
      Math.min(
        input.settings.maxSlurryRateLps,
        Math.max(1, input.settings.pumpRateLps * k),
      ),
    )
    .filter((v, i, a) => a.indexOf(v) === i);
  for (const rate of rates)
    for (const back of [
      input.settings.backPressure,
      input.settings.backPressure + 1,
      input.settings.backPressure + 2,
    ]) {
      const variant = structuredClone(input);
      variant.settings.pumpRateLps = rate;
      variant.settings.backPressure = back;
      variant.settings.spatialCells = Math.min(32, input.settings.spatialCells);
      variant.settings.timeStepMin = Math.max(0.8, input.settings.timeStepMin);
      try {
        const result = simulateFoamJob(variant),
          reasons = result.constraints
            .filter((c) => !c.pass)
            .map((c) => c.label);
        if (result.summary.freeFallFrames)
          reasons.push("Свободный сток вне модели");
        if (result.summary.nonConvergedFrames) reasons.push("Несходимость");
        if (
          result.summary.maxGasBalanceErrorPct > 0.1 ||
          result.summary.maxBaseBalanceErrorPct > 0.1
        )
          reasons.push("Невязка баланса");
        const margins = result.frames.flatMap((f) =>
          f.formationMargins.flatMap(
            (m) =>
              [m.fractureMarginMPa, m.poreMarginMPa].filter(
                (v) => v !== null,
              ) as number[],
          ),
        );
        candidates.push({
          input: variant,
          feasible: !reasons.length,
          n2StdM3: result.design.n2StdM3,
          durationMin: result.summary.durationMin,
          maxPressureMPa: result.summary.maxPumpPressureMPa,
          minMarginMPa: margins.length ? Math.min(...margins) : null,
          score:
            objective === "nitrogen"
              ? result.design.n2StdM3
              : result.summary.durationMin,
          reasons,
        });
      } catch (e) {
        candidates.push({
          input: variant,
          feasible: false,
          n2StdM3: 0,
          durationMin: 0,
          maxPressureMPa: 0,
          minMarginMPa: null,
          score: Infinity,
          reasons: [String(e)],
        });
      }
    }
  return candidates.sort(
    (a, b) => Number(b.feasible) - Number(a.feasible) || a.score - b.score,
  );
}

/** Bounded scalar volume search. Gas per base remains fixed, full simulation checks placement. */
export function sizeFoamPlacement(input: FoamJobInput): FoamSimulation {
  assertInput(input);
  let lo = 0.2,
    hi = 5;
  const target = input.settings.cementTopMD;
  const simulate = (factor: number) => {
    const j = structuredClone(input);
    j.settings.foamVolumeMultiplier = factor;
    return simulateFoamJob(j);
  };
  let best = simulate(hi);
  if (
    best.summary.finalTOCMD === null ||
    best.summary.finalTOCMD >
      target +
        Math.max(
          5,
          input.wellData.casingDepthMD / input.settings.spatialCells / 2,
        )
  )
    throw new Error(
      "В пределах множителя объёма 0,2-5 кровля не достигнута. Проверьте исходные данные и режим.",
    );
  for (let i = 0; i < 9; i++) {
    const mid = (lo + hi) / 2,
      r = simulate(mid);
    if (r.summary.finalTOCMD !== null && r.summary.finalTOCMD <= target) {
      best = r;
      hi = mid;
    } else lo = mid;
  }
  best.warnings.push(
    "Объём подобран скалярным поиском по расчётной кровле. Ограничения давления, оборудование и устойчивость проверяйте отдельно. Зональное соответствие FQ после масштабирования требует контроля профиля.",
  );
  return best;
}
