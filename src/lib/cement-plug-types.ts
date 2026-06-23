/**
 * Типы цементных мостов, набор прочности (UCS), ОЗЦ и
 * проверка соответствия Правилам безопасности нефтяной и газовой
 * промышленности РФ (Приказ Ростехнадзора № 534 от 15.12.2020).
 *
 * Использует логарифмическую модель набора прочности цемента:
 *   UCS(t) = UCS_max · (1 − exp(−k(T) · t))
 *   k(T)   = k_ref · exp(α · (T − 20))
 * Откалибровано по API Spec 10A для тампонажных классов G/H/B/PCT-I-100.
 */

export type PlugPurpose =
  | "abandonment"
  | "kickoff"
  | "lost_circulation"
  | "zonal_isolation"
  | "test_plug"
  | "sidetrack";

export const PLUG_PURPOSE_LABEL: Record<PlugPurpose, string> = {
  abandonment: "Ликвидационный (изоляция)",
  kickoff: "Отклонитель для зарезки (kickoff)",
  lost_circulation: "Борьба с поглощением",
  zonal_isolation: "Изоляция пласта/интервала",
  test_plug: "Опорный (под опрессовку)",
  sidetrack: "Забуривание бокового ствола",
};

export type CementClass = "G" | "H" | "B" | "PCT_I_100" | "PCT_II_50";

export const CEMENT_CLASS_LABEL: Record<CementClass, string> = {
  G: "API класс G (универсальный)",
  H: "API класс H (густой)",
  B: "API класс B (среднеглубинный)",
  PCT_I_100: "ПЦТ-I-100 (тампонажный, ≤100°C)",
  PCT_II_50: "ПЦТ-II-50 (для холодных)",
};

interface CementKinetics {
  ucsMaxMPa: number;       // предельная прочность при референсной T (20°C, 28 сут)
  kRef: number;            // 1/час, константа набора прочности при 20°C
  alpha: number;           // 1/°C, термочувствительность (≈0.02..0.04)
}

const CEMENT_KINETICS: Record<CementClass, CementKinetics> = {
  G:          { ucsMaxMPa: 24, kRef: 0.045, alpha: 0.030 },
  H:          { ucsMaxMPa: 28, kRef: 0.040, alpha: 0.028 },
  B:          { ucsMaxMPa: 20, kRef: 0.038, alpha: 0.030 },
  PCT_I_100:  { ucsMaxMPa: 22, kRef: 0.050, alpha: 0.032 },
  PCT_II_50:  { ucsMaxMPa: 18, kRef: 0.060, alpha: 0.025 },
};

/** Прочность на одноосное сжатие, МПа, в момент времени t (час). */
export function compressiveStrengthVsTime(
  cls: CementClass,
  temperatureC: number,
  hours: number,
): number {
  const p = CEMENT_KINETICS[cls];
  const k = p.kRef * Math.exp(p.alpha * (temperatureC - 20));
  return p.ucsMaxMPa * (1 - Math.exp(-k * Math.max(0, hours)));
}

/** Время (час) до достижения требуемой прочности. */
export function waitOnCementTime(
  requiredStrengthMPa: number,
  cls: CementClass,
  temperatureC: number,
): number {
  const p = CEMENT_KINETICS[cls];
  if (requiredStrengthMPa >= p.ucsMaxMPa) return Infinity;
  const k = p.kRef * Math.exp(p.alpha * (temperatureC - 20));
  return -Math.log(1 - requiredStrengthMPa / p.ucsMaxMPa) / k;
}

/** Полная кривая UCS(t) для графика. */
export function buildUcsCurve(
  cls: CementClass,
  temperatureC: number,
  maxHours = 72,
  steps = 36,
): { hours: number; ucs: number }[] {
  const out: { hours: number; ucs: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const h = (i / steps) * maxHours;
    out.push({ hours: h, ucs: compressiveStrengthVsTime(cls, temperatureC, h) });
  }
  return out;
}

/* ── Требования по назначению моста ─────────────────────────────────── */

export interface PlugDesignRequirements {
  purpose: PlugPurpose;
  minCompressiveStrengthMPa: number;
  minPlugLengthM: number;
  testPressureMPa: number;
  requiresHardBalance: boolean;
  notes: string;
}

export function getPlugRequirements(
  purpose: PlugPurpose,
  reservoirPressureMPa: number,
): PlugDesignRequirements {
  // Опрессовка обычно 1.1..1.5 × Pпл (или ≥ перепада)
  const baseTest = Math.max(7, reservoirPressureMPa * 1.1);

  switch (purpose) {
    case "abandonment":
      return {
        purpose,
        minCompressiveStrengthMPa: 3.5,    // ПБ НГП: достаточно для герметичности изоляции
        minPlugLengthM: 50,                // ПБ НГП п.288: ≥ 50 м над кровлей пласта
        testPressureMPa: Math.max(7, reservoirPressureMPa + 1.5),
        requiresHardBalance: true,
        notes: "Ликвидация скважины. Высота моста ≥ 50 м, опрессовка водой ≥ Pпл+1.5 МПа.",
      };
    case "kickoff":
    case "sidetrack":
      return {
        purpose,
        minCompressiveStrengthMPa: 14,    // достаточно для удержания whipstock и набора зенита
        minPlugLengthM: 60,
        testPressureMPa: baseTest,
        requiresHardBalance: true,
        notes: "Зарезка бокового ствола. UCS ≥ 14 МПа обязательна для отклонителя.",
      };
    case "lost_circulation":
      return {
        purpose,
        minCompressiveStrengthMPa: 2.0,
        minPlugLengthM: 30,
        testPressureMPa: Math.max(5, reservoirPressureMPa * 0.8),
        requiresHardBalance: false,
        notes: "Перекрытие зоны поглощения. Применяется быстросхватывающийся состав.",
      };
    case "zonal_isolation":
      return {
        purpose,
        minCompressiveStrengthMPa: 7,
        minPlugLengthM: 30,
        testPressureMPa: baseTest,
        requiresHardBalance: true,
        notes: "Изоляция отдельного интервала/пласта. Опрессовка на расчётный перепад.",
      };
    case "test_plug":
      return {
        purpose,
        minCompressiveStrengthMPa: 10,
        minPlugLengthM: 20,
        testPressureMPa: Math.max(10, reservoirPressureMPa * 1.25),
        requiresHardBalance: true,
        notes: "Опорный мост под опрессовку колонны/устья.",
      };
  }
}

/* ── Проверка по ПБ НГП РФ ─────────────────────────────────────────── */

export interface ComplianceCheck {
  requirement: string;
  passed: boolean;
  message: string;
  reference?: string;
}

export interface ComplianceInput {
  purpose: PlugPurpose;
  plugLengthMD: number;
  plugTopMD: number;
  reservoirTopMD?: number;
  cementClass: CementClass;
  bhctC: number;
  wocHours: number;
  testPressureMPa: number;
  designTestPressureMPa: number;
  reservoirPressureMPa: number;
}

export function checkCompliance(input: ComplianceInput): {
  checks: ComplianceCheck[];
  passed: boolean;
  requirements: PlugDesignRequirements;
  achievedStrengthMPa: number;
} {
  const req = getPlugRequirements(input.purpose, input.reservoirPressureMPa);
  const achieved = compressiveStrengthVsTime(input.cementClass, input.bhctC, input.wocHours);
  const checks: ComplianceCheck[] = [];

  // 1. Длина моста
  checks.push({
    requirement: `Длина моста ≥ ${req.minPlugLengthM} м`,
    passed: input.plugLengthMD >= req.minPlugLengthM,
    message:
      input.plugLengthMD >= req.minPlugLengthM
        ? `Фактически ${input.plugLengthMD.toFixed(0)} м ≥ ${req.minPlugLengthM} м`
        : `Фактически ${input.plugLengthMD.toFixed(0)} м < ${req.minPlugLengthM} м — увеличить объём цемента`,
    reference:
      input.purpose === "abandonment"
        ? "ПБ НГП РФ п. 288 (ликвидация — мост ≥ 50 м над кровлей)"
        : undefined,
  });

  // 2. Высота над кровлей пласта для ликвидации
  if (input.purpose === "abandonment" && input.reservoirTopMD !== undefined) {
    const heightAboveReservoir = input.reservoirTopMD - input.plugTopMD;
    checks.push({
      requirement: "Перекрытие кровли пласта ≥ 50 м",
      passed: heightAboveReservoir >= 50,
      message:
        heightAboveReservoir >= 50
          ? `Кровля моста на ${heightAboveReservoir.toFixed(0)} м выше кровли пласта`
          : `Перекрытие ${heightAboveReservoir.toFixed(0)} м < 50 м — поднять верх моста`,
      reference: "ПБ НГП РФ п. 288",
    });
  }

  // 3. Прочность UCS
  checks.push({
    requirement: `UCS ≥ ${req.minCompressiveStrengthMPa.toFixed(1)} МПа за ОЗЦ`,
    passed: achieved >= req.minCompressiveStrengthMPa,
    message:
      achieved >= req.minCompressiveStrengthMPa
        ? `За ${input.wocHours} ч при ${input.bhctC}°C достигнуто ${achieved.toFixed(1)} МПа`
        : `За ${input.wocHours} ч достигнуто только ${achieved.toFixed(1)} МПа — увеличить ОЗЦ`,
    reference: "API Spec 10A / ГОСТ 1581-2019",
  });

  // 4. Давление опрессовки
  checks.push({
    requirement: `Опрессовка ≥ ${req.testPressureMPa.toFixed(1)} МПа`,
    passed: input.designTestPressureMPa >= req.testPressureMPa,
    message:
      input.designTestPressureMPa >= req.testPressureMPa
        ? `Запланировано ${input.designTestPressureMPa.toFixed(1)} МПа`
        : `Запланировано ${input.designTestPressureMPa.toFixed(1)} МПа < требуемых ${req.testPressureMPa.toFixed(1)} МПа`,
    reference: "ПБ НГП РФ п. 290 (опрессовка моста ≥ Pпл + 10–15%)",
  });

  // 5. Прочность под опрессовку (UCS ≥ 0.5·Pопр в инженерной практике)
  const requiredForTest = input.designTestPressureMPa * 0.5;
  if (requiredForTest > 0) {
    checks.push({
      requirement: `UCS ≥ ½·P_опр (${requiredForTest.toFixed(1)} МПа)`,
      passed: achieved >= requiredForTest,
      message:
        achieved >= requiredForTest
          ? `Достигнуто ${achieved.toFixed(1)} МПа — выдержит опрессовку`
          : `${achieved.toFixed(1)} МПа недостаточно для опрессовки ${input.designTestPressureMPa.toFixed(1)} МПа`,
    });
  }

  return { checks, passed: checks.every((c) => c.passed), requirements: req, achievedStrengthMPa: achieved };
}

/* ── Многомостовая компоновка для ликвидации ────────────────────────── */

export interface AbandonmentPlugSpec {
  index: number;
  name: string;
  topMD: number;
  bottomMD: number;
  lengthM: number;
  purpose: string;
}

/**
 * Стандартная схема ликвидации по ПБ НГП: мост над продуктивным пластом,
 * мост в башмаке эксплуатационной колонны, устьевой мост.
 */
export function buildAbandonmentString(opts: {
  reservoirTopMD: number;
  casingShoeMD: number;
  surfaceMD?: number;       // обычно 0; учитываем устьевой мост 20–50 м
  plugLengthM?: number;     // длина каждого моста, по умолч. 50
}): AbandonmentPlugSpec[] {
  const len = opts.plugLengthM ?? 50;
  const surfTop = opts.surfaceMD ?? 0;
  const out: AbandonmentPlugSpec[] = [];

  // 1. Мост над пластом (низ — 30 м ниже кровли пласта внутрь, верх — выше кровли)
  out.push({
    index: 1,
    name: "Мост над продуктивным пластом",
    topMD: Math.max(0, opts.reservoirTopMD - len),
    bottomMD: opts.reservoirTopMD + 30,
    lengthM: len + 30,
    purpose: "Изоляция пласта от вышележащих горизонтов",
  });

  // 2. Мост в башмаке эксплуатационной колонны
  if (opts.casingShoeMD > opts.reservoirTopMD - len) {
    out.push({
      index: 2,
      name: "Мост в башмаке эксплуатационной колонны",
      topMD: opts.casingShoeMD - len,
      bottomMD: opts.casingShoeMD + 10,
      lengthM: len + 10,
      purpose: "Изоляция башмака, перекрытие возможных межколонных перетоков",
    });
  }

  // 3. Устьевой мост
  out.push({
    index: 3,
    name: "Устьевой мост",
    topMD: surfTop,
    bottomMD: surfTop + Math.min(50, len),
    lengthM: Math.min(50, len),
    purpose: "Перекрытие устья перед демонтажем оборудования",
  });

  return out;
}

/* ── Часть 2: Температурная карта твердения по длине моста ──────────────
 *
 * В реальном мосту длиной 30–100 м температура отличается между низом и
 * верхом из-за геотермического градиента. Низ горячее → твердеет быстрее;
 * верх холоднее → твердеет медленнее. ОЗЦ должен определяться по самой
 * холодной (=медленной) точке.
 *
 * Все величины — из физики:
 *   T(z)   = BHCT − grad · (TVDbot − TVD(z))
 *   k(T)   = k_ref · exp(α · (T − 20))                   (Arrhenius-like)
 *   UCS(t) = UCS_max · (1 − exp(−k(T) · t))               (логистика API 10A)
 *   t_req  = −ln(1 − UCSтреб/UCS_max) / k(T)              (обращение)
 *
 * Никаких подгоночных коэффициентов: только паспортные kRef, alpha, UCS_max
 * выбранного класса цемента + вводимые BHCT и градиент.
 */

export interface PlugCuringPoint {
  /** глубина по стволу, м */
  md: number;
  /** вертикальная глубина, м */
  tvd: number;
  /** температура цемента в этой точке, °C */
  temperatureC: number;
  /** UCS через 8 ч, МПа */
  ucsAt8h: number;
  /** UCS через 12 ч, МПа */
  ucsAt12h: number;
  /** UCS через 24 ч, МПа */
  ucsAt24h: number;
  /** время до достижения требуемой прочности, ч */
  readyTimeHours: number;
}

export interface PlugCuringMap {
  points: PlugCuringPoint[];
  /** MD самой медленной (холодной) точки */
  slowestPointMD: number;
  /** температура в самой медленной точке, °C */
  slowestTemperatureC: number;
  /** Рекомендуемое ОЗЦ — по самой медленной точке, ч */
  recommendedWOCHours: number;
  /** разница между самой быстрой и самой медленной точками, ч */
  spreadHours: number;
  /** требуемая прочность, использованная при расчёте ОЗЦ, МПа */
  requiredUcsMPa: number;
}

interface TrajPoint { md: number; tvd: number; }

/** Линейная интерполяция TVD по MD. Если данных нет — TVD = MD. */
function tvdAtMD(md: number, traj?: TrajPoint[]): number {
  if (!traj || traj.length === 0) return md;
  const sorted = [...traj].sort((a, b) => a.md - b.md);
  if (md <= sorted[0].md) return sorted[0].tvd;
  if (md >= sorted[sorted.length - 1].md) return sorted[sorted.length - 1].tvd;
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1], b = sorted[i];
    if (md >= a.md && md <= b.md) {
      const f = (md - a.md) / Math.max(1e-9, b.md - a.md);
      return a.tvd + f * (b.tvd - a.tvd);
    }
  }
  return md;
}

export function buildPlugCuringMap(opts: {
  cementClass: CementClass;
  /** BHCT в нижней точке моста, °C */
  bhctBottomC: number;
  /** Геотермический градиент, °C на 100 м TVD */
  gradientCPer100m: number;
  plugTopMD: number;
  plugBottomMD: number;
  trajectory?: TrajPoint[];
  /** Требуемая прочность (по назначению), МПа */
  requiredUcsMPa: number;
  /** Количество узлов по длине моста (минимум 5) */
  nodes?: number;
}): PlugCuringMap {
  const {
    cementClass, bhctBottomC, gradientCPer100m,
    plugTopMD, plugBottomMD, trajectory, requiredUcsMPa,
  } = opts;
  const N = Math.max(5, opts.nodes ?? 9);

  const p = CEMENT_KINETICS[cementClass];
  const tvdBot = tvdAtMD(plugBottomMD, trajectory);

  const points: PlugCuringPoint[] = [];
  for (let i = 0; i < N; i++) {
    const f = i / (N - 1);
    const md = plugBottomMD + f * (plugTopMD - plugBottomMD); // от низа к верху
    const tvd = tvdAtMD(md, trajectory);
    // Температура: T(z) = BHCT − grad·(TVDbot − TVD)/100
    const T = bhctBottomC - gradientCPer100m * (tvdBot - tvd) / 100;
    const k = p.kRef * Math.exp(p.alpha * (T - 20));
    const ucsAt = (h: number) => p.ucsMaxMPa * (1 - Math.exp(-k * h));
    const readyTime = requiredUcsMPa >= p.ucsMaxMPa
      ? Infinity
      : -Math.log(1 - requiredUcsMPa / p.ucsMaxMPa) / k;

    points.push({
      md, tvd, temperatureC: T,
      ucsAt8h: ucsAt(8),
      ucsAt12h: ucsAt(12),
      ucsAt24h: ucsAt(24),
      readyTimeHours: readyTime,
    });
  }

  // Самая медленная = с максимальным readyTime (=минимальной T)
  let slow = points[0];
  let fast = points[0];
  for (const pt of points) {
    if (pt.readyTimeHours > slow.readyTimeHours) slow = pt;
    if (pt.readyTimeHours < fast.readyTimeHours) fast = pt;
  }

  return {
    points,
    slowestPointMD: slow.md,
    slowestTemperatureC: slow.temperatureC,
    recommendedWOCHours: slow.readyTimeHours,
    spreadHours: slow.readyTimeHours - fast.readyTimeHours,
    requiredUcsMPa,
  };
}
