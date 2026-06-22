// Силы при спуске колонны и изгибные напряжения в местах посадки центраторов
// Источники: Johansik (soft-string), API RP 96, Mitchell (Casing Design)

import type { WellData } from "./cementing-calculations";
import type { CentralizationResult, CentralizerInterval } from "./centralization-calculations";

const STEEL_E = 210e9;                   // Па
const STEEL_DENSITY = 7850;              // кг/м³
const STEEL_YIELD_K55 = 379e6;           // Па (K-55 yield)
const STEEL_YIELD_N80 = 552e6;           // N-80
const STEEL_YIELD_P110 = 758e6;          // P-110

export interface RunningForceInput {
  wellData: WellData;
  mudDensity: number;        // кг/м³
  frictionCoeff: number;     // μ steel/rock (~0.20–0.35), centralizer reduces ~0.15
  centralizerIntervals: CentralizerInterval[];
  centralization: CentralizationResult[];
  casingGrade?: "K-55" | "N-80" | "P-110";
}

export interface RunningForceResult {
  /** Расчётная сила на крюке при спуске (slack-off), кН (положит. = тянет вниз) */
  hookloadDryKN: number;
  hookloadBuoyKN: number;        // с учётом выталкивающей силы
  hookloadRunningKN: number;     // slack-off (вес минус трение)
  hookloadPickupKN: number;      // pickup (вес плюс трение)
  /** Сможет ли колонна пройти под собственным весом */
  willRunFreely: boolean;
  minSlackOffMargin: number;     // мин. запас веса по длине (если <0 — застрянет)
  /** Изгибные напряжения */
  maxBendingStressMPa: number;
  bendingUtilization: number;    // σ / yield, 0..1+
  yieldStrengthMPa: number;
  /** Bow-spring деформация */
  avgSpringCompression: number;  // % от исходной свободной длины
  maxSpringCompression: number;
  warnings: string[];
}

function buoyancyFactor(mudDensity: number): number {
  return 1 - mudDensity / STEEL_DENSITY;
}

function casingWeightPerMeter(odMm: number, wallMm: number): number {
  const od = odMm / 1000;
  const wall = wallMm / 1000;
  const id = od - 2 * wall;
  const area = (Math.PI / 4) * (od * od - id * id);
  return area * STEEL_DENSITY;
}

function casingMomentOfInertia(odMm: number, wallMm: number): number {
  const od = odMm / 1000;
  const id = (odMm - 2 * wallMm) / 1000;
  return (Math.PI / 64) * (Math.pow(od, 4) - Math.pow(id, 4));
}

function yieldStrength(grade: "K-55" | "N-80" | "P-110"): number {
  if (grade === "N-80") return STEEL_YIELD_N80;
  if (grade === "P-110") return STEEL_YIELD_P110;
  return STEEL_YIELD_K55;
}

/**
 * Расчёт усилий установки колонны и изгибных напряжений.
 * Использует упрощённую soft-string модель: интегрирует осевое натяжение
 * сверху вниз с учётом веса, плавучести, трения и боковой силы от DLS.
 */
export function calculateRunningForces(input: RunningForceInput): RunningForceResult {
  const { wellData, mudDensity, frictionCoeff, centralization, casingGrade = "N-80" } = input;

  const wpm = casingWeightPerMeter(wellData.casingOD, wellData.casingWall);  // Н/м (вес = m·g, g=9.81)
  const wpmN = wpm * 9.81;
  const bf = buoyancyFactor(mudDensity);
  const I = casingMomentOfInertia(wellData.casingOD, wellData.casingWall);
  const od = wellData.casingOD / 1000;
  const yield_Pa = yieldStrength(casingGrade);

  // Сортировка точек по MD
  const pts = [...centralization].sort((a, b) => a.md - b.md);
  if (pts.length < 2) {
    return {
      hookloadDryKN: 0, hookloadBuoyKN: 0, hookloadRunningKN: 0, hookloadPickupKN: 0,
      willRunFreely: false, minSlackOffMargin: 0,
      maxBendingStressMPa: 0, bendingUtilization: 0,
      yieldStrengthMPa: yield_Pa / 1e6,
      avgSpringCompression: 0, maxSpringCompression: 0,
      warnings: ["Недостаточно точек траектории для расчёта"],
    };
  }

  // Сухой вес и вес с плавучестью
  const totalLen = wellData.casingDepthMD;
  const hookloadDryN = wpmN * totalLen;
  const hookloadBuoyN = hookloadDryN * bf;

  // Интегрируем slack-off / pickup снизу вверх
  // T(L) = вес ниже × bf × cos(α) ± Σ μ·N
  // Боковая сила N на сегмент = (w·sin(α) + |T·κ|) · dL
  let T_slackoff = 0;    // натяжение на крюке при спуске (сверху положительное)
  let T_pickup = 0;      // при подъёме (трение обратно)
  let minMargin = Infinity;
  let maxBendingPa = 0;
  let springCompressions: number[] = [];

  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dL = b.md - a.md;
    if (dL <= 0) continue;

    const alphaRad = ((a.zenith + b.zenith) / 2) * Math.PI / 180;
    const dAlphaRad = (b.zenith - a.zenith) * Math.PI / 180;
    const kappa = Math.abs(dAlphaRad / dL); // кривизна 1/м

    const w = wpmN * bf;                         // плавающий вес на метр
    const T_avg = (T_slackoff + T_pickup) / 2 + w * dL * 0.5; // средняя в сегменте
    const lateralLine = w * Math.sin(alphaRad) + Math.abs(T_avg * kappa); // Н/м
    const N = lateralLine * dL;                  // нормальная сила, Н

    // Эффективное трение: ниже там, где есть центратор (роликовая опора)
    const muLocal = a.hasCentralizer || b.hasCentralizer ? frictionCoeff * 0.6 : frictionCoeff;
    const Ffric = muLocal * N;

    // Осевая компонента веса
    const Faxial = w * dL * Math.cos(alphaRad);

    // slack-off: вес тянет вниз, трение тормозит → ΔT = Faxial - Ffric
    const dT_slack = Faxial - Ffric;
    T_slackoff += dT_slack;
    if (dT_slack < minMargin) minMargin = dT_slack;

    // pickup: трение помогает весу удерживать → ΔT = Faxial + Ffric
    T_pickup += Faxial + Ffric;

    // Bending stress в точке: σ = E · (OD/2) · κ_total
    // κ_total = κ от DLS + локальный прогиб между центраторами
    const sigmaDLS = STEEL_E * (od / 2) * kappa; // Па
    // Прогиб между центраторами: M = w·L²/8 → σ = M·c/I
    const span = a.hasCentralizer ? 12 / Math.max(1, 2) : 12; // оценка
    const M_bending = w * Math.sin(alphaRad) * span * span / 8;
    const sigmaSag = (M_bending * (od / 2)) / I;
    const sigmaTotal = sigmaDLS + sigmaSag;
    if (sigmaTotal > maxBendingPa) maxBendingPa = sigmaTotal;

    // Bow-spring compression: насколько сжата пружина в стволе
    // gap_actual = clearance · (1 - eccentricity)
    // compression = (clearance - gap_actual) / clearance = eccentricity (для bow)
    if (a.hasCentralizer) {
      springCompressions.push(a.eccentricity * 100);
    }
  }

  const avgComp = springCompressions.length
    ? springCompressions.reduce((s, v) => s + v, 0) / springCompressions.length
    : 0;
  const maxComp = springCompressions.length ? Math.max(...springCompressions) : 0;

  const warnings: string[] = [];
  if (minMargin < 0) warnings.push(`Колонна может застрять при спуске (мин. ΔT/dL = ${(minMargin / 1000).toFixed(1)} кН/м)`);
  if (maxBendingPa / yield_Pa > 0.8) warnings.push(`Изгибное напряжение близко к пределу текучести (${(maxBendingPa / yield_Pa * 100).toFixed(0)}% от σ_T)`);
  if (maxComp > 90) warnings.push("Bow-spring почти полностью сжат — возможна потеря восстанавливающей силы");
  if (warnings.length === 0) warnings.push("Все параметры в пределах допустимого");

  return {
    hookloadDryKN: hookloadDryN / 1000,
    hookloadBuoyKN: hookloadBuoyN / 1000,
    hookloadRunningKN: T_slackoff / 1000,
    hookloadPickupKN: T_pickup / 1000,
    willRunFreely: minMargin >= 0,
    minSlackOffMargin: minMargin,
    maxBendingStressMPa: maxBendingPa / 1e6,
    bendingUtilization: maxBendingPa / yield_Pa,
    yieldStrengthMPa: yield_Pa / 1e6,
    avgSpringCompression: avgComp,
    maxSpringCompression: maxComp,
    warnings,
  };
}
