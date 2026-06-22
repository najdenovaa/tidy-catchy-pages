// ============================================================================
// Расширенный трекер усталости ГНКТ (Part 4 audit)
// Модель Halal–Tipton: Nf = A·ε_a^(-b) с коррекцией по давлению (1-P/Pb)^c
// Депт-распределённое суммирование повреждений по правилу Майнера.
//
// Каждый рейс на глубину D создаёт 4 цикла пластического изгиба для участка
// ГНКТ длиной D от низа: 2 — на барабане (намотка-размотка), 2 — на направ-
// ляющей дуге (gooseneck). Чем глубже рейс, тем большая часть трубы цикли-
// руется. Накопленное повреждение наибольшее у KOP (нижний конец).
// ============================================================================

import { GRADE_YIELD, REEL_DIAMETERS, GUIDE_ARCH_DIAMETER } from "@/lib/coiled-tubing-calculations";
import type { CTStringData } from "@/lib/coiled-tubing-calculations";

export interface CTTripEvent {
  /** Идентификатор/имя рейса */
  label?: string;
  /** Целевая глубина рейса, м */
  depthM: number;
  /** Среднее рабочее давление в трубе, МПа */
  pressureMPa: number;
  /** Количество одинаковых рейсов */
  count: number;
}

export interface CTFatigueAdvancedInput {
  ct: CTStringData;
  reelSize: "small" | "medium" | "large";
  /** Полная длина ГНКТ на барабане, м (для распределения по длине) */
  totalLengthM: number;
  /** История рейсов */
  trips: CTTripEvent[];
  /** Шаг депт-сетки, м */
  step?: number;
}

export interface CTDamagePoint {
  /** Расстояние от низа (BHA-end) ГНКТ, м */
  position: number;
  /** Кумулятивное повреждение (0..1+, по Майнеру) */
  damage: number;
  /** Оставшийся ресурс в эквивалентных циклах */
  remainingCycles: number;
}

export interface CTFatigueAdvancedResult {
  /** Деформация на барабане, доли (не %) */
  strainReel: number;
  /** Деформация на направляющей дуге, доли */
  strainGuideArch: number;
  /** Эквивалентная амплитуда деформации (Halal) */
  equivalentStrainAmplitude: number;
  /** Базовое Nf при нулевом давлении */
  baseNfZeroPressure: number;
  /** Профиль повреждений по длине трубы */
  damageProfile: CTDamagePoint[];
  /** Максимальное повреждение */
  maxDamage: number;
  /** Положение максимального повреждения, м от BHA-end */
  maxDamagePosition: number;
  /** Длина "горячей зоны" (D > 50%) */
  hotZoneLengthM: number;
  /** Снижение допустимого давления, % */
  pressureDeratePct: number;
  /** Эффективное давление разрыва, МПа */
  effectiveBurstMPa: number;
  /** Оставшийся ресурс по самому повреждённому метру, эквивалентных циклов */
  remainingTripsToFailure: number;
  warnings: string[];
}

// Halal–Tipton эмпирические константы для CT-сталей QT-сортамента
// (характерные значения, подобраны под отраслевые кривые S-N)
const HALAL_A = 0.085;
const HALAL_B = 2.20;
const PRESSURE_EXPONENT_C = 1.6;

/**
 * Базовое число циклов до разрушения (P=0)
 *  Nf0 = A / ε_a^b
 */
function baseNf(strainAmplitude: number): number {
  if (strainAmplitude <= 0) return Infinity;
  return HALAL_A / Math.pow(strainAmplitude, HALAL_B);
}

/**
 * Коррекция Nf по внутреннему давлению (увеличивает осевое + окружное напряжение)
 *   Nf(P) = Nf0 · (1 − P/Pb)^c     ;  при P→Pb  Nf→0
 */
function pressureFactor(pressureMPa: number, burstMPa: number): number {
  if (burstMPa <= 0) return 0;
  const ratio = Math.min(0.95, Math.max(0, pressureMPa / burstMPa));
  return Math.pow(1 - ratio, PRESSURE_EXPONENT_C);
}

export function calculateCTFatigueAdvanced(input: CTFatigueAdvancedInput): CTFatigueAdvancedResult {
  const { ct, reelSize, totalLengthM, trips } = input;
  const step = input.step ?? Math.max(25, Math.round(totalLengthM / 100));
  const warnings: string[] = [];

  const odM = ct.od / 1000;
  const reelD = REEL_DIAMETERS[reelSize];
  const archD = GUIDE_ARCH_DIAMETER;

  // Деформация изгиба ε = OD / D_bend  (для пластического диапазона)
  const strainReel = odM / reelD;
  const strainArch = odM / archD;

  // Эквивалентная амплитуда: 4 пластических цикла за рейс
  // Берём максимум как доминирующий (плюс контрибуция арки усреднена)
  const strainAmplitude = strainReel * 0.5 + strainArch * 0.5;
  const equivalentStrainAmplitude = strainAmplitude;

  const yieldMPa = GRADE_YIELD[ct.grade] || 552;
  const burstMPa = (2 * yieldMPa * ct.wall) / ct.od;

  const Nf0 = baseNf(strainAmplitude);

  // Депт-распределение: метр на позиции p (от BHA-end) циклируется в каждом
  // рейсе, чья глубина ≥ p. Каждый такой рейс = 4 цикла (in + out, reel + arch).
  const CYCLES_PER_TRIP = 4;

  const damageProfile: CTDamagePoint[] = [];
  let maxDamage = 0;
  let maxDamagePos = 0;
  let hotZoneLen = 0;

  const positions = Math.max(2, Math.ceil(totalLengthM / step));
  for (let i = 0; i <= positions; i++) {
    const p = Math.min(totalLengthM, i * step);
    let damage = 0;
    for (const trip of trips) {
      if (trip.depthM < p || trip.count <= 0) continue;
      const Nf = Nf0 * pressureFactor(trip.pressureMPa, burstMPa);
      if (Nf <= 0) {
        damage += 1; // мгновенное разрушение при P ≥ Pb
        continue;
      }
      damage += (trip.count * CYCLES_PER_TRIP) / Nf;
    }
    const remainingCycles = damage < 1
      ? Math.max(0, (1 - damage) * Nf0) // оценка по базовому Nf
      : 0;
    damageProfile.push({ position: p, damage, remainingCycles });

    if (damage > maxDamage) {
      maxDamage = damage;
      maxDamagePos = p;
    }
    if (damage > 0.5) hotZoneLen += step;
  }

  // Снижение допустимого рабочего давления — линейно от 0 при D=0 до 30% при D=1
  const pressureDeratePct = Math.min(40, Math.max(0, maxDamage * 30));
  const effectiveBurstMPa = burstMPa * (1 - pressureDeratePct / 100);

  // Оставшийся ресурс — сколько ещё рейсов на ту же макс. глубину при том же P
  const lastTrip = trips[trips.length - 1];
  let remainingTrips = Infinity;
  if (lastTrip && lastTrip.depthM > 0) {
    const Nf = Nf0 * pressureFactor(lastTrip.pressureMPa, burstMPa);
    const damagePerTrip = (CYCLES_PER_TRIP / Nf);
    remainingTrips = damagePerTrip > 0 ? Math.max(0, (1 - maxDamage) / damagePerTrip) : Infinity;
  }

  if (maxDamage >= 1) {
    warnings.push(`Кумулятивное повреждение ≥ 100% на позиции ${maxDamagePos.toFixed(0)} м от BHA. Труба подлежит выбраковке.`);
  } else if (maxDamage >= 0.8) {
    warnings.push(`Повреждение ${(maxDamage * 100).toFixed(0)}% — критическая зона. Запланируйте замену ГНКТ.`);
  } else if (maxDamage >= 0.5) {
    warnings.push(`Повреждение свыше 50% (горячая зона ${hotZoneLen.toFixed(0)} м). Снижайте рабочее давление и ограничьте число глубоких рейсов.`);
  }
  if (effectiveBurstMPa < (lastTrip?.pressureMPa ?? 0)) {
    warnings.push(`Эффективное давление разрыва (${effectiveBurstMPa.toFixed(1)} МПа) ниже текущего рабочего давления.`);
  }

  return {
    strainReel,
    strainGuideArch: strainArch,
    equivalentStrainAmplitude,
    baseNfZeroPressure: Nf0,
    damageProfile,
    maxDamage,
    maxDamagePosition: maxDamagePos,
    hotZoneLengthM: hotZoneLen,
    pressureDeratePct,
    effectiveBurstMPa,
    remainingTripsToFailure: isFinite(remainingTrips) ? Math.round(remainingTrips) : 99999,
    warnings,
  };
}
