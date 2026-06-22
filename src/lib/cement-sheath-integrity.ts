/**
 * Долговременная целостность цементного камня (Cement Sheath Integrity)
 *
 * Модель: толстостенный цилиндр с тремя слоями (обсадная труба — цемент — порода).
 * Аналитическое решение по Тьерселину-Буа (Thiercelin et al., SPE 28100, 1998)
 * с учётом давленческой и температурной нагрузки.
 *
 * Оценивает 4 режима разрушения цементной оболочки:
 *  1) Радиальное растяжение → ОТРЫВ от ОК (microannulus на интерфейсе)
 *  2) Тангенциальное растяжение → радиальные ТРЕЩИНЫ
 *  3) Радиально-тангенциальное сжатие → ПЛАСТИЧЕСКОЕ разрушение
 *  4) Сдвиг по интерфейсу цемент-порода (debonding)
 *
 * Сценарии:
 *  - Опрессовка (рост Pi)
 *  - Закачка/добыча с горячим флюидом (ΔT > 0)
 *  - Охлаждение (стимуляция, кислотная обработка ΔT < 0)
 *  - Сброс давления (после ГРП)
 */

export interface SheathGeometry {
  /** Внутр. диаметр ОК, мм */
  casingID_mm: number;
  /** Наруж. диаметр ОК, мм */
  casingOD_mm: number;
  /** Диаметр скважины (внешний радиус цемента), мм */
  holeID_mm: number;
}

export interface CementMechProps {
  /** Модуль Юнга цемента, ГПа */
  youngGPa: number;
  /** Коэффициент Пуассона */
  poisson: number;
  /** Прочность на растяжение, МПа */
  tensileMPa: number;
  /** Прочность на сжатие (UCS), МПа */
  compressiveMPa: number;
  /** Коэффициент линейного теплового расширения, 1/°C (≈ 1e-5) */
  thermalExpansion: number;
}

export interface SteelProps {
  youngGPa: number;
  poisson: number;
  thermalExpansion: number; // ≈ 1.2e-5
}

export interface RockProps {
  youngGPa: number;
  poisson: number;
  thermalExpansion: number; // ≈ 1e-5
}

export interface LoadCase {
  name: string;
  /** Изменение внутреннего давления ОК, МПа (Δ от состояния схватывания) */
  deltaPi_MPa: number;
  /** Изменение давления в кольцевом, МПа */
  deltaPo_MPa: number;
  /** Изменение температуры цемента, °C */
  deltaT_C: number;
}

export interface StressResult {
  /** Радиальное напряжение на внутр. радиусе цемента (контакт с ОК), МПа (+растяжение) */
  sigmaR_inner_MPa: number;
  /** Тангенциальное на внутр. радиусе цемента, МПа */
  sigmaT_inner_MPa: number;
  /** Радиальное на внеш. радиусе цемента (контакт с породой), МПа */
  sigmaR_outer_MPa: number;
  /** Тангенциальное на внеш. радиусе, МПа */
  sigmaT_outer_MPa: number;
}

export type FailureMode =
  | "ok"
  | "microannulus_casing"
  | "radial_cracks"
  | "shear_compressive"
  | "debonding_formation";

export interface FailureCheck {
  mode: FailureMode;
  description: string;
  severity: "ok" | "warn" | "critical";
  /** Запас прочности: <1 = разрушение */
  safetyFactor: number;
}

export interface SheathAnalysis {
  loadCase: LoadCase;
  stresses: StressResult;
  failures: FailureCheck[];
  worstSafetyFactor: number;
  riskLevel: "low" | "moderate" | "high" | "critical";
}

/**
 * Упрощённое аналитическое решение для напряжений в цементе.
 * Применяется модель толстостенного цилиндра Ламе с поправкой на тепловое расширение
 * (Тьерселин-Буа) и взаимодействие со сталью и породой через граничные условия.
 *
 * Полная задача нелинейная (3 цилиндра); здесь используется приближение:
 * цемент — толстостенный цилиндр под внутренним и внешним давлением + равномерным ΔT.
 * Эффект стальной обсадной колонны учитывается через эффективное Pi после
 * термического расширения стали; эффект породы — через жёсткость породы (модуль).
 */
export function calcSheathStresses(
  geo: SheathGeometry,
  cement: CementMechProps,
  steel: SteelProps,
  rock: RockProps,
  load: LoadCase
): StressResult {
  const a = geo.casingOD_mm / 2; // внутр. радиус цемента, мм
  const b = geo.holeID_mm / 2;   // внеш. радиус цемента, мм
  const tCasing = (geo.casingOD_mm - geo.casingID_mm) / 2;

  if (b <= a || a <= 0) {
    return { sigmaR_inner_MPa: 0, sigmaT_inner_MPa: 0, sigmaR_outer_MPa: 0, sigmaT_outer_MPa: 0 };
  }

  // --- 1) Термическая нагрузка ---
  // Цемент стиснут между сталью и породой. Если ΔT > 0 (нагрев), цемент расширяется
  // больше стали (αc ≈ αs), но сжимается жёсткой породой → возникает доп. давление.
  // Эффективное доп. внутр. давление от термоэффекта (Тьерселин, упрощ.):
  const Ec = cement.youngGPa * 1000;   // в МПа
  const nuC = cement.poisson;
  const Er = rock.youngGPa * 1000;
  const nuR = rock.poisson;

  // Тепловое расширение цемента, ограниченное породой
  // ΔP_thermal ≈ Ec·αc·ΔT / [(1 - 2ν_c) + Ec(1+ν_r) / Er]
  const denomTh = (1 - 2 * nuC) + (Ec * (1 + nuR)) / Math.max(Er, 1);
  const dPthermal = (Ec * cement.thermalExpansion * load.deltaT_C) / denomTh;

  // --- 2) Передача давления через сталь ---
  // Тонкостенная труба: радиальное смещение ≈ Pi·R²/(E·t). Это смещение переносится
  // на цемент как доп. наружное расширение, эквивалентное доп. внутреннему давлению.
  const Es = steel.youngGPa * 1000;
  const Rcasing = (geo.casingID_mm + geo.casingOD_mm) / 4; // средний радиус, мм
  // Коэф. передачи давления через сталь к цементу (упрощ.)
  const transferCoeff = 1 / (1 + (Ec * tCasing) / (Es * Rcasing));
  const dPi_eff = load.deltaPi_MPa * transferCoeff;

  // --- 3) Эффективное внутр. давление на цемент ---
  const Pi = dPi_eff + dPthermal;
  // Внешнее давление: на породу действует Po (мало меняется), плюс реакция породы.
  // Для упрощения берём Po как заданный delta (часто близок к 0 в эксплуатации).
  const Po = load.deltaPo_MPa;

  // --- 4) Уравнения Ламе для толстостенного цилиндра ---
  const a2 = a * a;
  const b2 = b * b;
  const denom = b2 - a2;

  // На внутр. радиусе r = a:
  const sigmaR_in = (Pi * a2 * (b2 - b2) - Po * b2 * (a2 - a2)) / (denom * a2) - Pi;
  // Стандартные формулы Ламе:
  //   σr(r) = (Pi·a² - Po·b²)/(b²-a²) - (Pi-Po)·a²·b²/[(b²-a²)·r²]
  //   σθ(r) = (Pi·a² - Po·b²)/(b²-a²) + (Pi-Po)·a²·b²/[(b²-a²)·r²]
  const A = (Pi * a2 - Po * b2) / denom;
  const B = ((Pi - Po) * a2 * b2) / denom;

  const sigmaR_inner = A - B / a2;       // = -Pi (при Po=0)
  const sigmaT_inner = A + B / a2;
  const sigmaR_outer = A - B / b2;
  const sigmaT_outer = A + B / b2;       // = -Po (при Pi=0)

  // Знак: в этой постановке сжатие отрицательно, растяжение положительно.
  // Pi > 0 даёт σθ_inner > 0 (растяжение), что вызывает радиальные трещины.
  return {
    sigmaR_inner_MPa: sigmaR_inner,
    sigmaT_inner_MPa: sigmaT_inner,
    sigmaR_outer_MPa: sigmaR_outer,
    sigmaT_outer_MPa: sigmaT_outer,
  };
}

export function checkFailures(stresses: StressResult, cement: CementMechProps): FailureCheck[] {
  const T = cement.tensileMPa;
  const C = cement.compressiveMPa;
  const checks: FailureCheck[] = [];

  // 1) Microannulus на интерфейсе ОК-цемент: σr_inner > 0 (растяжение по радиусу)
  // означает, что цемент отрывается от ОК. SF = T / σr_inner.
  if (stresses.sigmaR_inner_MPa > 0) {
    const sf = T / stresses.sigmaR_inner_MPa;
    checks.push({
      mode: "microannulus_casing",
      description: `Отрыв цемента от ОК (микрозазор): σr = ${stresses.sigmaR_inner_MPa.toFixed(2)} МПа`,
      severity: sf < 1 ? "critical" : sf < 1.5 ? "warn" : "ok",
      safetyFactor: sf,
    });
  }

  // 2) Радиальные трещины: σθ_inner > T
  if (stresses.sigmaT_inner_MPa > 0) {
    const sf = T / stresses.sigmaT_inner_MPa;
    checks.push({
      mode: "radial_cracks",
      description: `Радиальные трещины (растяжение тангенциальное): σθ = ${stresses.sigmaT_inner_MPa.toFixed(2)} МПа`,
      severity: sf < 1 ? "critical" : sf < 1.5 ? "warn" : "ok",
      safetyFactor: sf,
    });
  }

  // 3) Сдвиговое/сжимающее разрушение: σθ_inner < -C (сильное сжатие)
  if (stresses.sigmaT_inner_MPa < 0) {
    const sf = C / Math.abs(stresses.sigmaT_inner_MPa);
    if (sf < 2) {
      checks.push({
        mode: "shear_compressive",
        description: `Сжимающее разрушение: |σθ| = ${Math.abs(stresses.sigmaT_inner_MPa).toFixed(2)} МПа`,
        severity: sf < 1 ? "critical" : sf < 1.5 ? "warn" : "ok",
        safetyFactor: sf,
      });
    }
  }

  // 4) Отслоение цемент-порода: σr_outer > 0
  if (stresses.sigmaR_outer_MPa > 0) {
    const sf = T / stresses.sigmaR_outer_MPa;
    checks.push({
      mode: "debonding_formation",
      description: `Отслоение цемента от породы: σr_outer = ${stresses.sigmaR_outer_MPa.toFixed(2)} МПа`,
      severity: sf < 1 ? "critical" : sf < 1.5 ? "warn" : "ok",
      safetyFactor: sf,
    });
  }

  if (checks.length === 0) {
    checks.push({
      mode: "ok",
      description: "Все режимы разрушения в норме",
      severity: "ok",
      safetyFactor: 999,
    });
  }
  return checks;
}

export function analyzeSheath(
  geo: SheathGeometry,
  cement: CementMechProps,
  steel: SteelProps,
  rock: RockProps,
  load: LoadCase
): SheathAnalysis {
  const stresses = calcSheathStresses(geo, cement, steel, rock, load);
  const failures = checkFailures(stresses, cement);
  const worst = Math.min(...failures.map((f) => f.safetyFactor));
  const riskLevel: SheathAnalysis["riskLevel"] =
    worst < 1 ? "critical" : worst < 1.25 ? "high" : worst < 1.75 ? "moderate" : "low";
  return { loadCase: load, stresses, failures, worstSafetyFactor: worst, riskLevel };
}

/** Стандартные сценарии нагружения */
export function defaultLoadCases(
  pressTestMPa: number,
  prodTempDelta: number,
  stimTempDelta: number
): LoadCase[] {
  return [
    { name: "Опрессовка ОК", deltaPi_MPa: pressTestMPa, deltaPo_MPa: 0, deltaT_C: 0 },
    { name: "Эксплуатация (нагрев)", deltaPi_MPa: pressTestMPa * 0.4, deltaPo_MPa: 0, deltaT_C: prodTempDelta },
    { name: "Стимуляция (охлаждение)", deltaPi_MPa: pressTestMPa * 0.7, deltaPo_MPa: 0, deltaT_C: stimTempDelta },
    { name: "Сброс давления после ГРП", deltaPi_MPa: -pressTestMPa * 0.5, deltaPo_MPa: 0, deltaT_C: 0 },
  ];
}

/** Пресеты механических свойств цемента */
export const CEMENT_PRESETS: Record<string, CementMechProps> = {
  conventional: { youngGPa: 12, poisson: 0.18, tensileMPa: 3, compressiveMPa: 30, thermalExpansion: 1.0e-5 },
  flexible: { youngGPa: 4, poisson: 0.25, tensileMPa: 4, compressiveMPa: 25, thermalExpansion: 1.2e-5 },
  highStrength: { youngGPa: 18, poisson: 0.16, tensileMPa: 5, compressiveMPa: 60, thermalExpansion: 0.9e-5 },
  foamCement: { youngGPa: 6, poisson: 0.22, tensileMPa: 2.5, compressiveMPa: 18, thermalExpansion: 1.1e-5 },
};

export const STEEL_DEFAULT: SteelProps = {
  youngGPa: 210,
  poisson: 0.28,
  thermalExpansion: 1.2e-5,
};

export const ROCK_DEFAULT: RockProps = {
  youngGPa: 20,
  poisson: 0.25,
  thermalExpansion: 1.0e-5,
};
