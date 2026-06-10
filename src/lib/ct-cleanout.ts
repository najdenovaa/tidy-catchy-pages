/**
 * Wellbore Cleanout — расчёт промывки песка/проппанта/шлама через ГНКТ.
 *
 * Базовые формулы:
 *   1) Скорость осаждения (slip velocity) — режим зависит от Re_p:
 *      - Stokes (Re < 1):   v_s = g·d²·(ρ_p − ρ_f) / (18·μ)
 *      - Intermediate:      v_s = 0.153·g^0.71·d^1.14·(ρ_p−ρ_f)^0.71 / (ρ_f^0.29·μ^0.43)
 *      - Newton (Re>1000):  v_s = 1.74·sqrt(g·d·(ρ_p−ρ_f)/ρ_f)
 *   2) Скорость в затрубье v_a = Q / A_ann.
 *   3) Transport ratio TR = (v_a − v_s) / v_a. Обычно требуется TR ≥ 0.5
 *      (или v_a / v_s ≥ 1.5–2.0).
 *   4) Мин. расход = расход, при котором TR = TR_min.
 *   5) Время промывки = (объём песчаной пробки) / (расход выноса) + ход ГНКТ.
 *
 * Допущения:
 *   - вертикальная скважина (для горизонталок добавляется бед-эффект — учтён через correctionFactor);
 *   - сферические частицы.
 *
 * Единицы: SI внутри; вход/выход — практические (мм, г/см³, кг/м³, л/мин, мин).
 */

const G = 9.81;

export interface CleanoutInput {
  // Геометрия скважины
  casingID_mm: number;      // ID обсадной/НКТ, в которую спускается ГНКТ
  ctOD_mm: number;          // OD ГНКТ
  sandDepthMD_m: number;    // глубина до верха песчаной пробки (по стволу)
  sandHeightM: number;      // высота пробки, м
  wellInclinationDeg?: number; // макс. угол наклона на интервале промывки (для коррекции)

  // Песок
  particleSizeMm: number;   // средний диаметр частиц
  particleDensityGcc: number; // плотность зерна (песок ~2.65)
  sandConcentrationKgM3?: number; // концентрация в потоке возврата (обычно 200–600)

  // Жидкость
  fluidDensityGcc: number;
  fluidViscosityCp: number; // эффективная динамическая вязкость

  // Режим промывки
  flowRateLpm: number;      // текущий расход (л/мин)
  minTransportRatio?: number; // целевой TR (по умолч. 0.5)
  pillVolumeM3?: number;    // объём вязкой пачки (опц.)
}

export interface CleanoutResult {
  // Геометрия
  annulusAreaM2: number;
  annularVelocityMps: number;

  // Транспорт
  slipVelocityMps: number;
  reParticle: number;
  flowRegime: "Stokes" | "Intermediate" | "Newton";
  transportRatio: number;       // (v_a − v_s) / v_a
  netRiseVelocityMps: number;   // v_a − v_s
  safe: boolean;                // TR ≥ TR_min
  inclinationCorrection: number;

  // Рекомендации по расходу
  minRequiredFlowLpm: number;   // мин. Q для TR_min
  recommendedFlowLpm: number;   // мин × 1.3 (запас 30%)

  // Время и объёмы
  sandVolumeM3: number;         // объём пробки в затрубье
  cleanoutTimeMin: number;      // время полной промывки
  totalFluidVolumeM3: number;   // объём прокачанной жидкости
  sandReturnRateKgMin: number;  // масса выноса в минуту

  // Pill schedule
  pillSchedule?: PillScheduleItem[];

  warnings: string[];
}

export interface PillScheduleItem {
  name: string;
  volumeM3: number;
  pumpTimeMin: number;
  purpose: string;
}

function annulusAreaM2(idMm: number, odMm: number): number {
  const di = idMm / 1000;
  const od = odMm / 1000;
  return (Math.PI / 4) * (di * di - od * od);
}

/** Slip velocity со автоопределением режима. Итерация по Re_p. */
function calcSlipVelocity(
  particleSizeMm: number,
  particleDensityGcc: number,
  fluidDensityGcc: number,
  fluidViscosityCp: number,
): { vs: number; rep: number; regime: "Stokes" | "Intermediate" | "Newton" } {
  const d = particleSizeMm / 1000;
  const rhoP = particleDensityGcc * 1000;
  const rhoF = fluidDensityGcc * 1000;
  const mu = fluidViscosityCp * 1e-3;
  const dr = Math.max(0, rhoP - rhoF);

  if (dr === 0) return { vs: 0, rep: 0, regime: "Stokes" };

  // 1) первая итерация — Stokes
  let vs = (G * d * d * dr) / (18 * mu);
  let rep = (rhoF * vs * d) / Math.max(1e-9, mu);

  // 2) переход в Intermediate
  if (rep >= 1) {
    vs =
      (0.153 * Math.pow(G, 0.71) * Math.pow(d, 1.14) * Math.pow(dr, 0.71)) /
      (Math.pow(rhoF, 0.29) * Math.pow(mu, 0.43));
    rep = (rhoF * vs * d) / Math.max(1e-9, mu);
  }
  // 3) Newton
  if (rep > 1000) {
    vs = 1.74 * Math.sqrt((G * d * dr) / rhoF);
    rep = (rhoF * vs * d) / Math.max(1e-9, mu);
  }

  const regime: "Stokes" | "Intermediate" | "Newton" =
    rep < 1 ? "Stokes" : rep > 1000 ? "Newton" : "Intermediate";
  return { vs, rep, regime };
}

/** Коэффициент коррекции на угол наклона (бед-эффект). 0° → 1.0; 60° → ~1.5; 90° → 1.7. */
function inclinationFactor(incDeg: number): number {
  // эмпирическая параболическая аппроксимация Larsen-Pilehvari / Tomren
  const a = Math.max(0, Math.min(90, incDeg)) * (Math.PI / 180);
  return 1 + 0.7 * Math.sin(a) * Math.sin(a);
}

export function calculateCleanout(input: CleanoutInput): CleanoutResult {
  const warnings: string[] = [];
  const TR_min = input.minTransportRatio ?? 0.5;
  const incCorrection = inclinationFactor(input.wellInclinationDeg ?? 0);

  // Геометрия
  const annA = annulusAreaM2(input.casingID_mm, input.ctOD_mm);
  if (annA <= 0) {
    warnings.push("OD ГНКТ ≥ ID обсадной — невозможен затрубный поток.");
  }

  // м³/с из л/мин
  const Q_m3s = input.flowRateLpm / 60000;
  const va = Q_m3s / Math.max(1e-9, annA);

  // Slip velocity
  const { vs: vsRaw, rep, regime } = calcSlipVelocity(
    input.particleSizeMm,
    input.particleDensityGcc,
    input.fluidDensityGcc,
    input.fluidViscosityCp,
  );
  const vs = vsRaw * incCorrection;
  const netRise = va - vs;
  const tr = va > 0 ? netRise / va : 0;
  const safe = tr >= TR_min && netRise > 0;

  // Минимально требуемый расход для TR_min: va_min = vs / (1 − TR_min)
  const vaMin = vs / Math.max(1e-9, 1 - TR_min);
  const minRequiredFlowLpm = vaMin * annA * 60000;
  const recommendedFlowLpm = minRequiredFlowLpm * 1.3;

  // Объёмы и время
  const sandVol = annA * input.sandHeightM;
  const conc = input.sandConcentrationKgM3 ?? 400; // типично
  const particleDensityKgM3 = input.particleDensityGcc * 1000;
  const sandMassKg = sandVol * particleDensityKgM3;
  // Время выноса = масса песка / (концентрация × расход возврата)
  const Q_lpm = Math.max(1, input.flowRateLpm);
  const sandReturnRateKgMin = (conc / 1000) * Q_lpm; // кг/мин при возврате
  const transportTimeMin = sandMassKg / Math.max(1, sandReturnRateKgMin);
  // Время хода ГНКТ через пробку (RIH со скоростью ~10 м/мин)
  const cleanoutTimeMin = transportTimeMin + input.sandHeightM / 10;
  const totalFluidVolumeM3 = (Q_lpm / 1000) * cleanoutTimeMin;

  // Warnings
  if (!safe) {
    warnings.push(
      `Транспортное отношение TR=${tr.toFixed(2)} < ${TR_min.toFixed(2)} — частицы оседают, прихват вероятен. Увеличить расход до ${recommendedFlowLpm.toFixed(0)} л/мин.`,
    );
  }
  if ((input.wellInclinationDeg ?? 0) > 50) {
    warnings.push(
      `Угол ${input.wellInclinationDeg}° — формируется песчаная подушка на нижней стенке. Применить ротацию ГНКТ или вязкую пачку.`,
    );
  }
  if (input.particleSizeMm > 3) {
    warnings.push("Размер частиц > 3 мм — расход и вязкость должны быть на верхнем пределе.");
  }
  if (input.fluidViscosityCp < 5 && input.particleSizeMm > 1) {
    warnings.push("Низкая вязкость жидкости (<5 cP) при крупных частицах — рекомендуется загуститель / гель.");
  }

  // Pill schedule (если указан pillVolume)
  let pillSchedule: PillScheduleItem[] | undefined;
  if (input.pillVolumeM3 && input.pillVolumeM3 > 0) {
    const pillTime = (input.pillVolumeM3 * 1000) / Q_lpm;
    pillSchedule = [
      { name: "Пред-промывка (вода)", volumeM3: 1.0, pumpTimeMin: (1000 / Q_lpm), purpose: "Смачивание стенок, охлаждение" },
      { name: "Вязкая пачка (гель)", volumeM3: input.pillVolumeM3, pumpTimeMin: pillTime, purpose: "Захват песка, повышение TR" },
      { name: "Основная промывка", volumeM3: totalFluidVolumeM3, pumpTimeMin: cleanoutTimeMin, purpose: "Вынос песка из затрубья" },
      { name: "Финишная промывка", volumeM3: 0.5, pumpTimeMin: (500 / Q_lpm), purpose: "Очистка ствола" },
    ];
  }

  return {
    annulusAreaM2: annA,
    annularVelocityMps: va,
    slipVelocityMps: vs,
    reParticle: rep,
    flowRegime: regime,
    transportRatio: tr,
    netRiseVelocityMps: netRise,
    safe,
    inclinationCorrection: incCorrection,
    minRequiredFlowLpm,
    recommendedFlowLpm,
    sandVolumeM3: sandVol,
    cleanoutTimeMin,
    totalFluidVolumeM3,
    sandReturnRateKgMin,
    pillSchedule,
    warnings,
  };
}

/* ─────────── Мульти-флюидная гидравлика (упрощённая модель) ─────────── */

export interface FluidSlug {
  name: string;
  densityGcc: number;
  viscosityCp: number;
  volumeM3: number;
}

export interface MultiFluidPumpingSchedule {
  slugs: FluidSlug[];
  pumpRateLpm: number;
}

export interface MultiFluidScheduleResult {
  totalVolumeM3: number;
  totalTimeMin: number;
  stages: Array<{
    name: string;
    startMin: number;
    endMin: number;
    durationMin: number;
    volumeM3: number;
    cumVolumeM3: number;
    cumMassKg: number;
    densityGcc: number;
    viscosityCp: number;
  }>;
  avgDensityGcc: number;
  avgViscosityCp: number;
}

export function calcMultiFluidSchedule(
  schedule: MultiFluidPumpingSchedule,
): MultiFluidScheduleResult {
  const Q = Math.max(1, schedule.pumpRateLpm);
  const stages: MultiFluidScheduleResult["stages"] = [];
  let cumVol = 0;
  let cumMass = 0;
  let t = 0;
  let totalDensityProduct = 0;
  let totalViscosityProduct = 0;
  let totalVol = 0;

  for (const s of schedule.slugs) {
    const dur = (s.volumeM3 * 1000) / Q;
    cumVol += s.volumeM3;
    const massKg = s.volumeM3 * s.densityGcc * 1000;
    cumMass += massKg;
    totalDensityProduct += s.densityGcc * s.volumeM3;
    totalViscosityProduct += s.viscosityCp * s.volumeM3;
    totalVol += s.volumeM3;
    stages.push({
      name: s.name,
      startMin: t,
      endMin: t + dur,
      durationMin: dur,
      volumeM3: s.volumeM3,
      cumVolumeM3: cumVol,
      cumMassKg: cumMass,
      densityGcc: s.densityGcc,
      viscosityCp: s.viscosityCp,
    });
    t += dur;
  }

  return {
    totalVolumeM3: cumVol,
    totalTimeMin: t,
    stages,
    avgDensityGcc: totalVol > 0 ? totalDensityProduct / totalVol : 0,
    avgViscosityCp: totalVol > 0 ? totalViscosityProduct / totalVol : 0,
  };
}
