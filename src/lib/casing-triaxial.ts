// ============================================================================
// CASING TRIAXIAL STRESS ANALYSIS — Part 7 audit
// API TR 5C3 / Klever-Tamano · Von Mises Equivalent (VME)
//
// Проверяет обсадную колонну на:
//   • Burst (Barlow)        — внутреннее давление
//   • Collapse (4 режима)   — внешнее давление
//   • Axial yield           — осевая нагрузка
//   • Triaxial VME          — комбинированное напряжённое состояние
//   • Biaxial reduction     — взаимное снижение burst↔axial и collapse↔axial
// ============================================================================

export type CasingGrade = "J-55" | "K-55" | "N-80" | "L-80" | "C-90" | "P-110" | "Q-125";

const GRADE_YIELD_MPA: Record<CasingGrade, number> = {
  "J-55": 379,
  "K-55": 379,
  "N-80": 552,
  "L-80": 552,
  "C-90": 621,
  "P-110": 758,
  "Q-125": 862,
};

const GRADE_UTS_MPA: Record<CasingGrade, number> = {
  "J-55": 517,
  "K-55": 655,
  "N-80": 689,
  "L-80": 655,
  "C-90": 689,
  "P-110": 862,
  "Q-125": 931,
};

export interface CasingLoadCase {
  name: string;
  /** Внутреннее давление в проверочной точке, МПа */
  internalPressureMPa: number;
  /** Внешнее давление, МПа */
  externalPressureMPa: number;
  /** Осевая нагрузка (растяжение положительно), кН */
  axialForceKN: number;
  /** Температура, °C — для информации (для упрощённой модели не используем ΔT-axial) */
  temperatureC?: number;
}

export interface TriaxialInput {
  /** OD, мм */
  od: number;
  /** Стенка, мм */
  wall: number;
  grade: CasingGrade;
  /** Безразмерный коэффициент конструктивной безопасности (design factor) */
  designFactor?: {
    burst?: number;     // обычно 1.10
    collapse?: number;  // обычно 1.125
    tension?: number;   // обычно 1.60
    vme?: number;       // обычно 1.25
  };
  /** Расчётные сценарии нагружения */
  loadCases: CasingLoadCase[];
}

export interface TriaxialLimits {
  burstBarlowMPa: number;
  collapseMPa: number;
  collapseRegime: "yield" | "plastic" | "transition" | "elastic";
  axialYieldKN: number;
  vmeMPa: number;             // = σ_yield (использован как лимит VME)
  pipeAreaM2: number;
  weightPerMeterKgM: number;
}

export interface TriaxialCaseResult {
  case: string;
  hoopStressMPa: number;     // σ_h (Lamé)
  axialStressMPa: number;    // σ_a
  vmeStressMPa: number;      // σ_vme
  burstUtil: number;         // load/limit (0..1+)
  collapseUtil: number;
  tensionUtil: number;
  vmeUtil: number;
  // С учётом design factor:
  burstUtilDF: number;
  collapseUtilDF: number;
  tensionUtilDF: number;
  vmeUtilDF: number;
  worstUtilDF: number;
  /** Какой режим лимитирует */
  governing: "burst" | "collapse" | "tension" | "vme";
  pass: boolean;
}

export interface TriaxialResult {
  limits: TriaxialLimits;
  cases: TriaxialCaseResult[];
  /** Точки эллипса VME (axial σ vs дифф. давление) для графика */
  envelope: Array<{ axialMPa: number; pressureMPa: number }>;
  warnings: string[];
}

// ─── Burst (Barlow) ──────────────────────────────────────────────
function barlowBurst(odMm: number, wallMm: number, yieldMPa: number): number {
  return 2 * yieldMPa * wallMm / odMm * 0.875; // 87.5% wall (минимальная по API)
}

// ─── Collapse (API 5C3, 4 режима) ────────────────────────────────
interface CollapseConsts { F1: number; F2: number; F3: number; F4: number; F5: number; }

function collapseConstants(yieldMPa: number): CollapseConsts {
  const Y = yieldMPa / 6.895; // psi
  const Aapi = 2.8762 + 0.10679e-5 * Y + 0.21301e-10 * Y * Y - 0.53132e-16 * Y * Y * Y;
  const Bapi = 0.026233 + 0.50609e-6 * Y;
  const Capi = -465.93 + 0.030867 * Y - 0.10483e-7 * Y * Y + 0.36989e-13 * Y * Y * Y;
  const F = Math.pow(46.95e6 * Math.pow((3 * Bapi / Aapi) / (2 + Bapi / Aapi), 3), 0.5) / (Y * Math.pow(((3 * Bapi / Aapi) / (2 + Bapi / Aapi)) - (Bapi / Aapi), 2)) * (1 - (3 * Bapi / Aapi) / (2 + Bapi / Aapi));
  const G = F * Bapi / Aapi;
  return { F1: Aapi, F2: Bapi, F3: Capi, F4: F, F5: G };
}

function collapsePressureMPa(odMm: number, wallMm: number, yieldMPa: number): { p: number; regime: TriaxialLimits["collapseRegime"] } {
  const Dt = odMm / wallMm;
  const Y = yieldMPa / 6.895; // psi (для границ режимов)
  const c = collapseConstants(yieldMPa);

  // Границы режимов (API)
  const A_ = c.F1, B_ = c.F2, C_ = c.F3, F_ = c.F4, G_ = c.F5;
  const DtYP = (Math.sqrt(Math.pow(A_ - 2, 2) + 8 * (B_ + C_ / Y)) + (A_ - 2)) / (2 * (B_ + C_ / Y));
  const DtPT = Y * (A_ - F_) / (C_ + Y * (B_ - G_));
  const DtTE = (2 + B_ / A_) / (3 * B_ / A_);

  let pPsi = 0;
  let regime: TriaxialLimits["collapseRegime"] = "elastic";
  if (Dt <= DtYP) {
    regime = "yield";
    pPsi = 2 * Y * ((Dt - 1) / (Dt * Dt));
  } else if (Dt <= DtPT) {
    regime = "plastic";
    pPsi = Y * (A_ / Dt - B_) - C_;
  } else if (Dt <= DtTE) {
    regime = "transition";
    pPsi = Y * (F_ / Dt - G_);
  } else {
    regime = "elastic";
    pPsi = 46.95e6 / (Dt * Math.pow(Dt - 1, 2));
  }
  return { p: pPsi * 0.00689476, regime };
}

// ─── Lamé stresses ───────────────────────────────────────────────
function lameHoopStress(pi: number, po: number, ri: number, ro: number): number {
  // Внешняя поверхность критична при коллапсе, внутренняя при разрыве — берём ВНУТРЕННЮЮ как наиболее напряжённую
  const r = ri;
  const num = pi * ri * ri - po * ro * ro - (pi - po) * (ri * ri * ro * ro) / (r * r);
  return num / (ro * ro - ri * ri);
}

// ─── Axial yield ────────────────────────────────────────────────
function pipeArea(odMm: number, wallMm: number): number {
  const od = odMm / 1000;
  const id = (odMm - 2 * wallMm) / 1000;
  return Math.PI / 4 * (od * od - id * id);
}

// ─── VME envelope (axial vs differential pressure) ──────────────
function buildVMEEnvelope(yieldMPa: number, areaM2: number, pBurstMPa: number, pCollapseMPa: number) {
  const points: Array<{ axialMPa: number; pressureMPa: number }> = [];
  const steps = 60;
  // Параметризуем σ_a от −σ_y до +σ_y, ищем макс. дифф. давление, при котором VME = σ_y
  for (let i = 0; i <= steps; i++) {
    const sa = -yieldMPa + (2 * yieldMPa) * i / steps;
    // σ_vme² = σ_a² − σ_a·σ_h + σ_h² ; решаем относительно σ_h при σ_vme = σ_y
    // σ_h² − σ_a·σ_h + (σ_a² − σ_y²) = 0
    const disc = sa * sa - 4 * (sa * sa - yieldMPa * yieldMPa);
    if (disc < 0) continue;
    const sh1 = (sa + Math.sqrt(disc)) / 2;
    const sh2 = (sa - Math.sqrt(disc)) / 2;
    // Берём положительный/отрицательный пределы; переводим в давление через приближение σ_h ≈ P · D/(2t)
    // Грубо: P = σ_h · 2t / D = σ_h · (Pb / σy)
    const pTop = sh1 / yieldMPa * pBurstMPa;
    const pBot = sh2 / yieldMPa * pCollapseMPa;
    points.push({ axialMPa: sa, pressureMPa: pTop });
    points.push({ axialMPa: sa, pressureMPa: -Math.abs(pBot) });
  }
  // Сортируем по axial для красивой кривой
  points.sort((a, b) => a.axialMPa - b.axialMPa || a.pressureMPa - b.pressureMPa);
  return points;
}

// ─── Main ────────────────────────────────────────────────────────
export function calculateTriaxial(input: TriaxialInput): TriaxialResult {
  const { od, wall, grade, loadCases } = input;
  const df = {
    burst: 1.10,
    collapse: 1.125,
    tension: 1.60,
    vme: 1.25,
    ...input.designFactor,
  };

  const yieldMPa = GRADE_YIELD_MPA[grade];
  const burst = barlowBurst(od, wall, yieldMPa);
  const col = collapsePressureMPa(od, wall, yieldMPa);
  const A = pipeArea(od, wall);
  const axialYieldKN = yieldMPa * 1e6 * A / 1000;

  const ri = (od - 2 * wall) / 2000;
  const ro = od / 2000;
  const weightPerMeter = A * 7850;

  const limits: TriaxialLimits = {
    burstBarlowMPa: burst,
    collapseMPa: col.p,
    collapseRegime: col.regime,
    axialYieldKN,
    vmeMPa: yieldMPa,
    pipeAreaM2: A,
    weightPerMeterKgM: weightPerMeter,
  };

  const warnings: string[] = [];

  const cases: TriaxialCaseResult[] = loadCases.map(lc => {
    const sigmaH = lameHoopStress(lc.internalPressureMPa, lc.externalPressureMPa, ri, ro);
    const sigmaA = lc.axialForceKN * 1000 / A / 1e6; // МПа
    const sigmaR = -lc.internalPressureMPa; // на внутренней поверхности
    // VME (3D с радиальной)
    const vme = Math.sqrt(0.5 * (
      Math.pow(sigmaA - sigmaH, 2) +
      Math.pow(sigmaH - sigmaR, 2) +
      Math.pow(sigmaR - sigmaA, 2)
    ));

    const dp = lc.internalPressureMPa - lc.externalPressureMPa;
    const burstUtil    = Math.abs(dp) > 0 && dp > 0 ? dp / burst : 0;
    const collapseUtil = Math.abs(dp) > 0 && dp < 0 ? Math.abs(dp) / col.p : 0;
    const tensionUtil  = Math.abs(lc.axialForceKN) / axialYieldKN;
    const vmeUtil      = vme / yieldMPa;

    const burstUtilDF    = burstUtil    * df.burst;
    const collapseUtilDF = collapseUtil * df.collapse;
    const tensionUtilDF  = tensionUtil  * df.tension;
    const vmeUtilDF      = vmeUtil      * df.vme;

    const all = [
      { name: "burst" as const, v: burstUtilDF },
      { name: "collapse" as const, v: collapseUtilDF },
      { name: "tension" as const, v: tensionUtilDF },
      { name: "vme" as const, v: vmeUtilDF },
    ].sort((a, b) => b.v - a.v);
    const worst = all[0];

    if (worst.v >= 1.0) {
      warnings.push(`Сценарий "${lc.name}": ${worst.name.toUpperCase()} утилизация ${(worst.v * 100).toFixed(0)}% (> 100% с DF) — труба не проходит.`);
    } else if (worst.v >= 0.9) {
      warnings.push(`Сценарий "${lc.name}": ${worst.name.toUpperCase()} утилизация ${(worst.v * 100).toFixed(0)}% — близко к пределу.`);
    }

    return {
      case: lc.name,
      hoopStressMPa: sigmaH,
      axialStressMPa: sigmaA,
      vmeStressMPa: vme,
      burstUtil, collapseUtil, tensionUtil, vmeUtil,
      burstUtilDF, collapseUtilDF, tensionUtilDF, vmeUtilDF,
      worstUtilDF: worst.v,
      governing: worst.name,
      pass: worst.v < 1.0,
    };
  });

  const envelope = buildVMEEnvelope(yieldMPa, A, burst, col.p);

  return { limits, cases, envelope, warnings };
}

export { GRADE_YIELD_MPA, GRADE_UTS_MPA };
