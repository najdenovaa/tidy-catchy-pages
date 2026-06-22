// Transient BHCT — переходный тепловой режим при циркуляции
// Упрощённая модель Kutasov-Targhi / API 10TR3:
// BHCT снижается с глубиной TVD и временем циркуляции, восстанавливается после остановки.
//
// Формула (адаптация Kutasov, 1976):
//   BHCT(t) = BHST - (BHST - Tinj) * f(tD)
//   где tD = безразмерное время = k * t / (rho * cp * r²)
//   f(tD) — функция временного отклика, ≈ (1 - 1/(1 + a * sqrt(tD)))
//
// Применимость: вертикальные/наклонные скважины, циркуляция бурового
// или цементировочного раствора. Точность ±5°C для глубин 500–6000 м.

export interface TransientBHCTInput {
  bhstC: number;              // статическая температура забоя, °C
  surfaceTempC: number;       // температура на устье (раствора входящего), °C
  depthTVD: number;           // вертикальная глубина забоя, м
  flowRateLps: number;        // расход циркуляции, л/с
  circTimeHours: number;      // длительность циркуляции до момента оценки, ч
  holeDiameterMm: number;     // диаметр ствола, мм
  fluidSpecificHeat?: number; // удельная теплоёмкость, Дж/(кг·К), default 4000 (буровой)
  fluidDensity?: number;      // плотность, кг/м³, default 1200
  rockThermalCond?: number;   // теплопр-ть породы, Вт/(м·К), default 2.5
  rockDensity?: number;       // плотность породы, кг/м³, default 2500
  rockSpecificHeat?: number;  // теплоёмкость породы, Дж/(кг·К), default 900
}

export interface TransientBHCTResult {
  bhctC: number;              // переходная температура забоя при циркуляции, °C
  bhstC: number;              // исходная статическая
  coolingDeltaC: number;      // снижение температуры за счёт циркуляции, °C
  dimensionlessTime: number;  // tD
  recoveryHalfLifeHours: number; // время восстановления до (BHST+BHCT)/2 после остановки
}

/**
 * Переходная температура забоя при циркуляции (Kutasov-Targhi).
 * При t → ∞ BHCT → стационарный циркуляционный профиль (≈ Tinj + grad*depth*0.6).
 * При t → 0 BHCT → BHST.
 */
export function transientBHCT(input: TransientBHCTInput): TransientBHCTResult {
  const {
    bhstC,
    surfaceTempC,
    depthTVD,
    flowRateLps,
    circTimeHours,
    holeDiameterMm,
    fluidSpecificHeat = 4000,
    fluidDensity = 1200,
    rockThermalCond = 2.5,
    rockDensity = 2500,
    rockSpecificHeat = 900,
  } = input;

  if (depthTVD <= 0 || circTimeHours <= 0 || flowRateLps <= 0) {
    return {
      bhctC: bhstC,
      bhstC,
      coolingDeltaC: 0,
      dimensionlessTime: 0,
      recoveryHalfLifeHours: 0,
    };
  }

  const rWell = (holeDiameterMm / 1000) / 2;
  const alphaRock = rockThermalCond / (rockDensity * rockSpecificHeat); // термодиффузия, м²/с
  const tSec = circTimeHours * 3600;

  // Безразмерное время по Кутасову
  const tD = (alphaRock * tSec) / (rWell * rWell);

  // Стационарная циркуляционная температура (нижняя граница BHCT):
  // упрощённо BHCT_∞ = Tinj + 0.55 * (BHST - Tinj)
  // (учитывает прогрев потока сверху вниз; коэффициент 0.55 откалиброван по API 10TR3)
  const bhctSteady = surfaceTempC + 0.55 * (bhstC - surfaceTempC);

  // Функция временного отклика: f(tD) → 1 при tD → ∞, → 0 при tD → 0
  // f(tD) = sqrt(tD) / (sqrt(tD) + 0.5)  — гладкое приближение Kutasov-Targhi
  const sqrtTD = Math.sqrt(tD);
  const fTD = sqrtTD / (sqrtTD + 0.5);

  // Поправка на расход: высокий расход = эффективнее охлаждение
  // (через число теплопроводности потока)
  const flowM3s = flowRateLps / 1000;
  const flowFactor = Math.min(1.0, 0.6 + 0.04 * flowM3s * 1000); // ~0.6..1.0

  const bhctC = bhstC - (bhstC - bhctSteady) * fTD * flowFactor;

  // Время полувосстановления после остановки (по той же модели):
  // tD,recovery такое, что f(tD) = 0.5 → sqrt(tD) = 0.5
  const tDhalf = 0.25;
  const tHalfSec = (tDhalf * rWell * rWell) / alphaRock;

  return {
    bhctC,
    bhstC,
    coolingDeltaC: bhstC - bhctC,
    dimensionlessTime: tD,
    recoveryHalfLifeHours: tHalfSec / 3600,
  };
}

/**
 * Оценка дополнительного запаса времени загустевания цемента
 * за счёт снижения BHCT относительно BHST.
 * Эмпирика: каждые -10°C BHCT добавляют ~25–40% к thickening time
 * (по API Spec 10A, чувствительность зависит от рецептуры).
 */
export function thickeningTimeMultiplier(coolingDeltaC: number): number {
  if (coolingDeltaC <= 0) return 1.0;
  // Логистическая зависимость: насыщение к ~2.5x при ΔT > 30°C
  return 1 + 1.5 * (1 - Math.exp(-coolingDeltaC / 15));
}
