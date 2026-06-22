// ============================================================================
// Сжимаемость газа и допустимый объём кика (Part 3.3 audit)
// Real-gas Z-фактор по корреляции Papay; модель миграции газового пузыря
// при закрытой скважине; расчёт kick tolerance по давлению на башмаке колонны.
// ============================================================================

const G = 9.81;
const R_GAS = 8.314;          // Дж/(моль·К)
const M_AIR = 0.02897;        // кг/моль

export interface GasKickInput {
  tvdBottom: number;          // м
  tvdShoe: number;            // м, TVD предыдущей обсадной колонны (башмак)
  holeDiameter: number;       // мм (открытый ствол ниже башмака)
  prevCasingID: number;       // мм (закрытый интервал — выше башмака)
  drillPipeOD: number;        // мм
  mudDensity: number;         // кг/м³
  porePressureGrad: number;   // МПа/100 м (например 1.05)
  fracPressureGradShoe: number; // МПа/100 м на башмаке
  gasSpecificGravity: number; // γ_g (воздух=1), обычно 0.65–0.85
  surfaceTempC: number;
  bottomTempC: number;
  influxVolumeBhM3?: number;  // фактический объём притока на забое, м³
}

export interface GasKickResult {
  // Базовые параметры
  porePressureMPa: number;
  bhpShutInMPa: number;
  fracPressureShoeMPa: number;
  hydrostaticShoeMPa: number;

  // Псевдо-критические параметры
  ppcMPa: number;
  tpcK: number;

  // Z-факторы (Papay)
  zBottom: number;
  zShoe: number;

  // Плотность газа
  gasDensityBottom: number;   // кг/м³
  gasDensityShoe: number;     // кг/м³

  // Kick tolerance
  maxKickVolumeBhM3: number;  // допустимый объём кика на забое
  maxKickHeightShoeM: number; // высота столба газа у башмака при V_max
  annCapacityBh: number;      // м³/м
  annCapacityShoe: number;    // м³/м

  // Текущий приток (если задан)
  current?: {
    influxVolumeBhM3: number;
    influxHeightBhM: number;
    expandedVolumeShoeM3: number;
    expansionRatio: number;
    influxHeightShoeM: number;
    shoePressureMPa: number;       // P на башмаке при миграции к башмаку
    shoeMarginMPa: number;         // P_frac - P_shoe
    safe: boolean;
  };

  warnings: string[];
}

// Псевдо-критические параметры для природного газа (Sutton, для сухого газа)
function suttonPseudoCritical(gammaG: number) {
  // P в МПа, T в K
  const ppcPsia = 756.8 - 131 * gammaG - 3.6 * gammaG * gammaG;
  const tpcR    = 169.2 + 349.5 * gammaG - 74 * gammaG * gammaG;
  return {
    ppcMPa: ppcPsia * 0.00689476,
    tpcK: tpcR * 5 / 9,
  };
}

// Papay Z-фактор: Z = 1 - 3.52·Ppr / 10^(0.9813·Tpr) + 0.274·Ppr² / 10^(0.8157·Tpr)
export function papayZ(pMPa: number, tK: number, ppcMPa: number, tpcK: number): number {
  const ppr = pMPa / ppcMPa;
  const tpr = tK / tpcK;
  const z = 1
    - 3.52 * ppr / Math.pow(10, 0.9813 * tpr)
    + 0.274 * ppr * ppr / Math.pow(10, 0.8157 * tpr);
  return Math.max(0.3, Math.min(2.0, z));
}

// Плотность газа по уравнению реального газа
// ρ = P·M / (Z·R·T),  M_газа = γ_g · M_воздуха
function gasDensity(pMPa: number, tK: number, gammaG: number, z: number): number {
  const M = gammaG * M_AIR;
  const Pa = pMPa * 1e6;
  return Pa * M / (z * R_GAS * tK);
}

// Площадь кольцевого пространства, м²
function annArea(odMm: number, idInsideMm: number): number {
  const od = odMm / 1000;
  const id = idInsideMm / 1000;
  return Math.PI / 4 * (od * od - id * id);
}

export function calculateGasKick(input: GasKickInput): GasKickResult {
  const warnings: string[] = [];
  const {
    tvdBottom, tvdShoe, holeDiameter, prevCasingID, drillPipeOD,
    mudDensity, porePressureGrad, fracPressureGradShoe,
    gasSpecificGravity, surfaceTempC, bottomTempC,
  } = input;

  // Температуры
  const tBottomK = bottomTempC + 273.15;
  // Средняя температура между башмаком и забоем (линейная интерполяция)
  const tShoeC = surfaceTempC + (bottomTempC - surfaceTempC) * (tvdShoe / Math.max(tvdBottom, 1));
  const tShoeK = tShoeC + 273.15;

  // Давления (МПа)
  const porePressureMPa = porePressureGrad * tvdBottom / 100;
  const bhpShutInMPa = porePressureMPa; // принимаем равным пластовому при стабильной закрытой скважине
  const fracPressureShoeMPa = fracPressureGradShoe * tvdShoe / 100;
  const hydrostaticShoeMPa = mudDensity * G * tvdShoe / 1e6;

  // Псевдо-критические
  const { ppcMPa, tpcK } = suttonPseudoCritical(gasSpecificGravity);

  // Z и плотность на забое
  const zBottom = papayZ(bhpShutInMPa, tBottomK, ppcMPa, tpcK);
  const gasDensityBottom = gasDensity(bhpShutInMPa, tBottomK, gasSpecificGravity, zBottom);

  // На башмаке: P_shoe(после миграции газа) ≈ BHP - ρ_mud·g·(TVD_bottom - TVD_shoe)
  // (упрощение: газ полностью у башмака, ниже — буровой раствор)
  const pShoeAfterMigrMPa = bhpShutInMPa - mudDensity * G * (tvdBottom - tvdShoe) / 1e6;
  const zShoe = papayZ(Math.max(pShoeAfterMigrMPa, 0.5), tShoeK, ppcMPa, tpcK);
  const gasDensityShoe = gasDensity(Math.max(pShoeAfterMigrMPa, 0.5), tShoeK, gasSpecificGravity, zShoe);

  // Площади / ёмкости кольцевого пространства
  const annAreaBh = annArea(holeDiameter, drillPipeOD);
  const annAreaShoe = annArea(prevCasingID, drillPipeOD);
  const annCapacityBh = annAreaBh;     // м²·1м = м³/м
  const annCapacityShoe = annAreaShoe;

  // ────────────── KICK TOLERANCE ──────────────
  // Условие безопасности у башмака:
  //   P_shoe = P_gas_top + ρ_mud·g·h_mud_above_gas
  // где P_gas_top = P_gas_bottom_of_slug - ρ_gas·g·h_gas
  // P должно быть ≤ P_frac_shoe.
  //
  // Допустимый объём кика V_max ищем итерационно:
  //   при миграции газа к башмаку → V_shoe = V_bh · (P_bh/P_shoe)·(Z_shoe·T_shoe)/(Z_bh·T_bh)
  //   h_gas_shoe = V_shoe / annCapacityShoe
  //   P_top_of_gas = P_shoe - ρ_gas_shoe·g·h_gas_shoe
  //   условие: P_shoe ≤ P_frac_shoe (по верхней границе)
  // Берём наибольшее V_bh, при котором ограничение выполняется.

  const findMaxKick = (): { vBh: number; hShoe: number } => {
    let lo = 0;
    let hi = annCapacityShoe * (tvdShoe * 0.5); // верхняя оценка — газ занимает полствола до башмака
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      const exp = expandToShoe(mid, bhpShutInMPa, tBottomK, zBottom, pShoeAfterMigrMPa, tShoeK, zShoe);
      const hShoe = exp.vShoe / annCapacityShoe;
      // Давление на башмаке (низ газового столба у башмака):
      // газ полностью выше башмака → у башмака давление = P_top_gas + ρ_gas·g·h_gas
      // но "башмак" — нижняя точка обсадки. После миграции газ может быть и ВЫШЕ башмака.
      // Условие: P на башмаке = P_top_gas + ρ_gas·g·h_gas; должно ≤ P_frac
      const pTop = pShoeAfterMigrMPa; // приблизим: давление у башмака равно P_shoe_after_migr
      const pShoeWithGas = pTop + gasDensityShoe * G * hShoe / 1e6;
      if (pShoeWithGas > fracPressureShoeMPa) {
        hi = mid;
      } else {
        lo = mid;
      }
    }
    const exp = expandToShoe(lo, bhpShutInMPa, tBottomK, zBottom, pShoeAfterMigrMPa, tShoeK, zShoe);
    return { vBh: lo, hShoe: exp.vShoe / annCapacityShoe };
  };

  const { vBh: maxKickVolumeBhM3, hShoe: maxKickHeightShoeM } = findMaxKick();

  if (pShoeAfterMigrMPa >= fracPressureShoeMPa) {
    warnings.push(
      `Гидростатика выше башмака ниже забойного давления настолько, что даже нулевой кик ведёт к ГРП у башмака. ` +
      `Требуется снижение пластового давления или увеличение MAASP.`
    );
  }
  if (maxKickVolumeBhM3 < 1) {
    warnings.push(`Очень низкая толерантность к киоку (< 1 м³). Контроль скважины крайне чувствителен.`);
  }

  // Текущий приток
  let current: GasKickResult["current"] | undefined;
  if (input.influxVolumeBhM3 !== undefined && input.influxVolumeBhM3 > 0) {
    const v = input.influxVolumeBhM3;
    const exp = expandToShoe(v, bhpShutInMPa, tBottomK, zBottom, pShoeAfterMigrMPa, tShoeK, zShoe);
    const hBh = v / annCapacityBh;
    const hShoe = exp.vShoe / annCapacityShoe;
    const pShoeWithGas = pShoeAfterMigrMPa + gasDensityShoe * G * hShoe / 1e6;
    const margin = fracPressureShoeMPa - pShoeWithGas;
    current = {
      influxVolumeBhM3: v,
      influxHeightBhM: hBh,
      expandedVolumeShoeM3: exp.vShoe,
      expansionRatio: exp.vShoe / Math.max(v, 1e-6),
      influxHeightShoeM: hShoe,
      shoePressureMPa: pShoeWithGas,
      shoeMarginMPa: margin,
      safe: margin >= 0,
    };
    if (!current.safe) {
      warnings.push(`Текущий приток ${v.toFixed(1)} м³ превышает MAASP у башмака — риск ГРП.`);
    }
  }

  return {
    porePressureMPa,
    bhpShutInMPa,
    fracPressureShoeMPa,
    hydrostaticShoeMPa,
    ppcMPa, tpcK,
    zBottom, zShoe,
    gasDensityBottom, gasDensityShoe,
    maxKickVolumeBhM3, maxKickHeightShoeM,
    annCapacityBh, annCapacityShoe,
    current,
    warnings,
  };
}

// Расширение газа от забоя к башмаку: P1·V1/(Z1·T1) = P2·V2/(Z2·T2)
function expandToShoe(
  vBh: number, p1: number, t1: number, z1: number,
  p2: number, t2: number, z2: number,
) {
  const vShoe = vBh * (p1 / Math.max(p2, 0.1)) * (z2 * t2) / (z1 * t1);
  return { vShoe };
}

// График: положение газового пузыря на разных глубинах миграции
export function kickMigrationProfile(input: GasKickInput, influxVolumeBhM3: number, steps = 20) {
  const { tvdBottom, tvdShoe, holeDiameter, prevCasingID, drillPipeOD,
    mudDensity, porePressureGrad, fracPressureGradShoe,
    gasSpecificGravity, surfaceTempC, bottomTempC } = input;

  const tBottomK = bottomTempC + 273.15;
  const ppcTpc = suttonPseudoCritical(gasSpecificGravity);
  const bhpMPa = porePressureGrad * tvdBottom / 100;
  const zBottom = papayZ(bhpMPa, tBottomK, ppcTpc.ppcMPa, ppcTpc.tpcK);

  const fracPressureShoeMPa = fracPressureGradShoe * tvdShoe / 100;

  const points: Array<{
    tvdTop: number; pTopMPa: number; volumeM3: number;
    heightM: number; pShoeMPa: number; safe: boolean;
  }> = [];

  for (let i = 0; i <= steps; i++) {
    const tvdTop = tvdBottom - (tvdBottom - tvdShoe * 0.3) * (i / steps);
    // Давление в верхней точке газового пузыря (приближение: пузырь идёт вверх,
    // снизу столб воды/раствора держит P = pPore - ρ·g·(tvdBottom - tvdTop))
    const pTop = Math.max(0.5, bhpMPa - mudDensity * G * (tvdBottom - tvdTop) / 1e6);
    const tTopC = surfaceTempC + (bottomTempC - surfaceTempC) * (tvdTop / tvdBottom);
    const tTopK = tTopC + 273.15;
    const zTop = papayZ(pTop, tTopK, ppcTpc.ppcMPa, ppcTpc.tpcK);
    const volume = influxVolumeBhM3 * (bhpMPa / pTop) * (zTop * tTopK) / (zBottom * tBottomK);

    // Площадь сечения зависит от того, выше или ниже башмака
    const isAboveShoe = tvdTop <= tvdShoe;
    const cap = isAboveShoe ? annArea(prevCasingID, drillPipeOD) : annArea(holeDiameter, drillPipeOD);
    const height = volume / cap;

    // Давление на башмаке: если пузырь ниже башмака — P_shoe = pTop + ρ·g·(tvdShoe - tvdTop)
    // если выше — нижняя граница пузыря у/ниже башмака:
    const pShoeMPa = isAboveShoe
      ? pTop + gasDensity(pTop, tTopK, gasSpecificGravity, zTop) * G * Math.min(height, tvdShoe) / 1e6
      : pTop + mudDensity * G * (tvdShoe - tvdTop) / 1e6;

    points.push({
      tvdTop,
      pTopMPa: pTop,
      volumeM3: volume,
      heightM: height,
      pShoeMPa,
      safe: pShoeMPa <= fracPressureShoeMPa,
    });
  }

  return { points, fracPressureShoeMPa };
}
