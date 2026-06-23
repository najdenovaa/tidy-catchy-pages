/**
 * Часть 3: Несущая способность цементного моста после ОЗЦ.
 *
 * Все величины — из физики/корреляций цементного камня, без подгонки:
 *   tensile ≈ 0.10 · UCS                          (корреляция API/SPE)
 *   shearBond = roughness · tensile               (трение цемент-стенка)
 *   weightCapacity = shearBond · π·D·L            (срез по боковой поверхности)
 *   sideLoad (kickoff) = UCS · A_cross · 0.5      (теория балки, 0.5 — фактор боковой нагрузки)
 *   maxTestPressure = min(bondLimit, UCS) · 0.8   (запас прочности 0.8)
 *
 * UCS берётся из кинетики класса цемента и времени ОЗЦ (см. cement-plug-types.ts).
 */

import { compressiveStrengthVsTime, type CementClass } from "./cement-plug-types";

export interface PlugLoadCapacityInput {
  cementClass: CementClass;
  /** Температура цемента (для UCS на момент ОЗЦ), °C */
  temperatureC: number;
  /** Время ОЗЦ к моменту операции, ч */
  wocHours: number;
  /** Диаметр ствола (или ВД ОК), мм */
  boreDiameterMm: number;
  /** Длина моста, м */
  plugLengthM: number;
  /** Шероховатость стенки: открытый ствол ≈ 1.0..1.5; гладкая ОК ≈ 0.4..0.6 */
  roughnessFactor: number;
  /** Планируемое давление опрессовки, МПа (для проверки) */
  designTestPressureMPa: number;
  /** Вес инструмента сверху (для проверки несущей способности), кН */
  toolWeightKN?: number;
}

export interface PlugLoadCapacity {
  /** Текущая UCS на момент операции, МПа */
  ucsMPa: number;
  /** Прочность на растяжение цементного камня, МПа */
  tensileMPa: number;
  /** Прочность сцепления цемент-стенка, МПа */
  shearBondMPa: number;

  /* — Для kickoff/sidetrack — */
  /** Боковая нагрузка, которую выдерживает мост, кН */
  sideLoadCapacityKN: number;
  /** Можно ли зарезать боковой ствол (UCS ≥ 14 МПа) */
  canKickoff: boolean;
  /** Минимально требуемая UCS для kickoff, МПа */
  minUCSForKickoff: number;

  /* — Для опрессовки/опорного моста — */
  /** Максимально допустимое давление опрессовки, МПа */
  maxTestPressureMPa: number;
  /** Выдержит ли мост заданную опрессовку */
  hydraulicSeal: boolean;
  /** Запас по опрессовке */
  pressureSafetyFactor: number;

  /* — Несущая способность (вес инструмента) — */
  /** Полная несущая способность по боковому сцеплению, кН */
  weightCapacityKN: number;
  /** Запас по весу */
  weightSafetyFactor: number;

  /* — Время готовности — */
  /** Время до готовности к разбуриванию (UCS ≥ 14 МПа), ч (Infinity если недостижимо) */
  readyForKickoffHours: number;
  /** Время до готовности к плановой опрессовке, ч */
  readyForTestHours: number;
}

const UCS_KICKOFF_MIN = 14;   // МПа ≈ 2000 psi — практика API/Halliburton для отклонителя
const TENSILE_RATIO = 0.10;   // корреляция σt ≈ 0.10·UCS
const SIDE_LOAD_FACTOR = 0.5; // теория балки на сжатие при боковом нагружении долотом
const TEST_SAFETY = 0.8;      // запас прочности при опрессовке

/** Внутреннее: время до UCS=target при заданных классе и T. */
function timeToReachUcs(target: number, cls: CementClass, T: number): number {
  // Подбор: UCS(t) монотонно растёт; используем числовое обращение по 1‑часовой сетке.
  if (target <= 0) return 0;
  // Быстрая верхняя оценка — 168 ч (неделя). Если за это время не достигли — Infinity.
  const limit = 240;
  let lo = 0, hi = limit;
  if (compressiveStrengthVsTime(cls, T, hi) < target) return Infinity;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (compressiveStrengthVsTime(cls, T, mid) >= target) hi = mid;
    else lo = mid;
  }
  return hi;
}

export function calculatePlugLoadCapacity(input: PlugLoadCapacityInput): PlugLoadCapacity {
  const {
    cementClass, temperatureC, wocHours,
    boreDiameterMm, plugLengthM, roughnessFactor,
    designTestPressureMPa, toolWeightKN = 0,
  } = input;

  const ucs = compressiveStrengthVsTime(cementClass, temperatureC, Math.max(0, wocHours));
  const tensile = TENSILE_RATIO * ucs;
  const shearBond = Math.max(0, roughnessFactor) * tensile;

  const D = Math.max(0, boreDiameterMm) / 1000;          // м
  const L = Math.max(0, plugLengthM);
  const lateralArea = Math.PI * D * L;                    // м²
  const crossArea = (Math.PI / 4) * D * D;                // м²

  // shearBond [МПа] · A [м²] = МН → ·1000 = кН
  const weightCapacityKN = shearBond * lateralArea * 1000;

  // Боковая нагрузка от долота
  const sideLoadCapacityKN = ucs * crossArea * 1000 * SIDE_LOAD_FACTOR;

  // Опрессовка: предел по сцеплению (давление, выталкивающее мост)
  //   F_давл = P · A_cross   должен быть ≤ shearBond · A_lateral
  //   P_bond = shearBond · A_lateral / A_cross
  const bondLimit = crossArea > 0 ? (shearBond * lateralArea) / crossArea : 0;
  const bodyLimit = ucs;
  const maxTestPressureMPa = Math.min(bondLimit, bodyLimit) * TEST_SAFETY;

  const pressureSafetyFactor = designTestPressureMPa > 0
    ? maxTestPressureMPa / designTestPressureMPa
    : Infinity;

  const weightSafetyFactor = toolWeightKN > 0
    ? weightCapacityKN / toolWeightKN
    : Infinity;

  return {
    ucsMPa: ucs,
    tensileMPa: tensile,
    shearBondMPa: shearBond,
    sideLoadCapacityKN,
    canKickoff: ucs >= UCS_KICKOFF_MIN,
    minUCSForKickoff: UCS_KICKOFF_MIN,
    maxTestPressureMPa,
    hydraulicSeal: maxTestPressureMPa >= designTestPressureMPa && designTestPressureMPa > 0,
    pressureSafetyFactor,
    weightCapacityKN,
    weightSafetyFactor,
    readyForKickoffHours: timeToReachUcs(UCS_KICKOFF_MIN, cementClass, temperatureC),
    readyForTestHours: timeToReachUcs(
      // обратная задача для опрессовки: нужно UCS такая, чтобы maxTestPressure(UCS) ≥ designTest
      // т.к. maxTestPressure = min(bondLimit, UCS)·0.8, и bondLimit пропорционален UCS,
      // достаточно UCS ≥ designTest/0.8 (по телу) и shearBond·L/D·4 ≥ designTest/0.8 (по сцеплению).
      // Берём ограничивающий: max(UCS_body, UCS_bond).
      (() => {
        const ucsBody = designTestPressureMPa / TEST_SAFETY;
        // shearBond = roughness · 0.10 · UCS  →  bondLimit = roughness·0.10·UCS · 4L/D
        const k = roughnessFactor * TENSILE_RATIO * (4 * L / Math.max(1e-6, D));
        const ucsBond = k > 0 ? (designTestPressureMPa / TEST_SAFETY) / k : Infinity;
        return Math.max(ucsBody, ucsBond);
      })(),
      cementClass, temperatureC
    ),
  };
}

/** Рекомендации текстом — для UI. */
export function loadCapacityRecommendations(r: PlugLoadCapacity, design: { designTestPressureMPa: number; toolWeightKN?: number }): string[] {
  const out: string[] = [];
  if (r.canKickoff) {
    out.push(`UCS ${r.ucsMPa.toFixed(1)} МПа ≥ ${r.minUCSForKickoff} МПа — зарезка бокового ствола допустима.`);
  } else {
    out.push(`UCS ${r.ucsMPa.toFixed(1)} МПа < ${r.minUCSForKickoff} МПа. Для kickoff выдержать ещё ≈ ${isFinite(r.readyForKickoffHours) ? r.readyForKickoffHours.toFixed(1) + " ч" : "недостижимо для этого класса"}.`);
  }
  if (design.designTestPressureMPa > 0) {
    if (r.hydraulicSeal) {
      out.push(`Опрессовка до ${design.designTestPressureMPa.toFixed(1)} МПа безопасна (предел ${r.maxTestPressureMPa.toFixed(1)} МПа, запас ×${r.pressureSafetyFactor.toFixed(2)}).`);
    } else {
      out.push(`Опрессовка ${design.designTestPressureMPa.toFixed(1)} МПа превышает предел моста (${r.maxTestPressureMPa.toFixed(1)} МПа). Готовность к опрессовке через ≈ ${isFinite(r.readyForTestHours) ? r.readyForTestHours.toFixed(1) + " ч" : "недостижимо"}.`);
    }
  }
  if (design.toolWeightKN && design.toolWeightKN > 0) {
    if (r.weightSafetyFactor >= 1.5) {
      out.push(`Несущая способность ${r.weightCapacityKN.toFixed(0)} кН (запас ×${r.weightSafetyFactor.toFixed(2)}).`);
    } else if (r.weightSafetyFactor >= 1) {
      out.push(`Несущая способность ${r.weightCapacityKN.toFixed(0)} кН достаточна, но запас ×${r.weightSafetyFactor.toFixed(2)} мал.`);
    } else {
      out.push(`Несущая способность ${r.weightCapacityKN.toFixed(0)} кН < вес инструмента ${design.toolWeightKN.toFixed(0)} кН. Увеличить длину моста или выждать ОЗЦ.`);
    }
  }
  return out;
}
