// ============================================================
// Coiled Tubing — Nitrogen Kickoff (Освоение азотом)
// ============================================================
// Модель: ступенчатое снижение гидростатического давления столба
// жидкости путём закачки N₂ через ГНКТ. Газ поднимается по затрубу
// (или смешивается с жидкостью) → плотность смеси падает →
// забойное давление падает ниже Рпласт → приток.
//
// Физика:
//   - PV = ZnRT (уравнение состояния реального газа)
//   - Z-фактор по Papay (как в foam-cement)
//   - Объёмный коэффициент газа Bg = (Psc·Z·T) / (P·Tsc)
//   - Газосодержание по сечению: αg = Qg(P,T) / (Qg + Ql)
//   - Плотность смеси: ρmix = ρl·(1-αg) + ρg·αg
//   - Забойное давление: Pbh = Pwh + ρmix·g·TVD - ΔPfric
// ============================================================

const R_GAS = 8.314;          // J/(mol·K)
const M_N2 = 0.028014;        // kg/mol
const P_SC = 0.101325;        // MPa (atmospheric)
const T_SC = 288.15;          // K (15°C, standard)
const G = 9.81;               // m/s²

// Z-factor для N₂ по Papay (упрощённо, как для N2 при умеренных P,T)
// Tpc ≈ 126 K, Ppc ≈ 3.39 MPa для N₂
const T_PC_N2 = 126.2;
const P_PC_N2 = 3.39;

function zFactorPapay(P_MPa: number, T_K: number): number {
  const Pr = Math.max(0.01, P_MPa / P_PC_N2);
  const Tr = Math.max(1.0, T_K / T_PC_N2);
  const z = 1 - (3.52 * Pr) / Math.pow(10, 0.9813 * Tr) +
                (0.274 * Pr * Pr) / Math.pow(10, 0.8157 * Tr);
  return Math.max(0.3, Math.min(1.5, z));
}

// Плотность газа при P,T (кг/м³)
export function gasDensity(P_MPa: number, T_K: number): number {
  const z = zFactorPapay(P_MPa, T_K);
  // ρ = P·M / (z·R·T), перевод MPa→Pa
  return (P_MPa * 1e6 * M_N2) / (z * R_GAS * T_K);
}

// Объёмный коэффициент газа Bg (м³ в пласте / нм³)
export function gasFVF(P_MPa: number, T_K: number): number {
  const z = zFactorPapay(P_MPa, T_K);
  return (P_SC * z * T_K) / (P_MPa * T_SC);
}

// ────────────────────────────────────────────────────────────
// Inputs
// ────────────────────────────────────────────────────────────
export interface N2KickoffInputs {
  tvd: number;             // м
  md: number;              // м
  reservoirPressure: number; // MPa (Pпл)
  wellheadPressure: number;  // MPa (Pустья при освоении, обычно 0-2)
  fluidDensity: number;    // г/см³ (жидкость в скважине)
  bhct: number;            // °C
  whTemp: number;          // °C
  csgID: number;           // мм
  ctOD: number;            // мм
  ctID: number;            // мм
  n2RateSm3min: number;    // ст.м³/мин (расход N₂ на поверхности)
  liquidRateLpm: number;   // л/мин (жидкость по ГНКТ, может быть 0)
  ctRunDepth: number;      // м (глубина спуска ГНКТ в скважине)
  drawdownTarget: number;  // MPa (целевая депрессия = Pпл - Pзаб)
}

// ────────────────────────────────────────────────────────────
// Step Results
// ────────────────────────────────────────────────────────────
export interface N2KickoffStep {
  depth: number;           // м (текущая глубина точки расчёта)
  pressure: number;        // MPa в этой точке
  temperature: number;     // °C
  zFactor: number;
  gasDensity: number;      // кг/м³
  gasFVF: number;          // м³/нм³
  gasFraction: number;     // αg (доля газа по объёму)
  mixtureDensity: number;  // кг/м³
  hydroGradient: number;   // MPa/м
}

export interface N2KickoffResult {
  steps: N2KickoffStep[];
  bottomholePressure: number;  // MPa (рассчитанное Pзаб)
  drawdown: number;            // MPa (Pпл - Pзаб)
  surfacePressure: number;     // MPa (на устье ГНКТ для подачи)
  n2VolumeTotal: number;       // нм³ за весь цикл
  liquidUnloaded: number;      // м³ жидкости вытеснено
  avgMixDensity: number;       // кг/м³
  feasible: boolean;           // достигнута ли целевая депрессия
  recommendations: string[];
  // Sensitivity: depression vs N2 rate
  sensitivity: { rate: number; bhp: number; drawdown: number }[];
}

// ────────────────────────────────────────────────────────────
// Core Calculation
// ────────────────────────────────────────────────────────────
function calcBHP(inp: N2KickoffInputs, n2Rate: number): {
  bhp: number;
  avgRhoMix: number;
  steps: N2KickoffStep[];
} {
  const STEPS = 30;
  const dz = inp.tvd / STEPS;
  const rhoLiquid = inp.fluidDensity * 1000; // кг/м³
  const Tgrad = (inp.bhct - inp.whTemp) / Math.max(1, inp.tvd); // °C/м

  // Площади
  const A_csg = Math.PI * Math.pow(inp.csgID / 2000, 2);
  const A_ct  = Math.PI * Math.pow(inp.ctOD  / 2000, 2);
  const A_ann = Math.max(1e-6, A_csg - A_ct); // м² (затруб)

  // Объёмные расходы (нормальные условия)
  const Qg_sc = n2Rate / 60;       // нм³/с
  const Ql    = inp.liquidRateLpm / 60000; // м³/с

  let P = inp.wellheadPressure;    // начинаем с устья
  const steps: N2KickoffStep[] = [];
  let rhoSum = 0;

  for (let i = 0; i <= STEPS; i++) {
    const depth = i * dz;
    const T_C = inp.whTemp + Tgrad * depth;
    const T_K = T_C + 273.15;
    const P_calc = Math.max(0.1, P);
    const z = zFactorPapay(P_calc, T_K);
    const Bg = gasFVF(P_calc, T_K);
    const rhoG = gasDensity(P_calc, T_K);

    // Расход газа в текущих условиях
    const Qg_local = Qg_sc * Bg;          // м³/с в пласте
    const Qtot = Qg_local + Ql;
    const alphaG = Qtot > 0 ? Qg_local / Qtot : 0;

    // Если газ поднимается по затрубу — используем A_ann
    const rhoMix = rhoLiquid * (1 - alphaG) + rhoG * alphaG;
    const grad = (rhoMix * G) / 1e6;      // MPa/м

    steps.push({
      depth, pressure: P_calc, temperature: T_C,
      zFactor: z, gasDensity: rhoG, gasFVF: Bg,
      gasFraction: alphaG, mixtureDensity: rhoMix, hydroGradient: grad,
    });
    rhoSum += rhoMix;

    // Шаг вниз
    if (i < STEPS) P = P_calc + grad * dz;
  }

  return {
    bhp: P,
    avgRhoMix: rhoSum / (STEPS + 1),
    steps,
  };
}

export function calculateN2Kickoff(inp: N2KickoffInputs): N2KickoffResult {
  const main = calcBHP(inp, inp.n2RateSm3min);
  const drawdown = inp.reservoirPressure - main.bhp;
  const feasible = drawdown >= inp.drawdownTarget;

  // Sensitivity: 0.5..3.0 × n2RateSm3min
  const sensitivity: { rate: number; bhp: number; drawdown: number }[] = [];
  const baseRate = inp.n2RateSm3min;
  for (let k = 0.25; k <= 3.0; k += 0.25) {
    const rate = Math.max(1, baseRate * k);
    const r = calcBHP(inp, rate);
    sensitivity.push({
      rate: +rate.toFixed(1),
      bhp: +r.bhp.toFixed(2),
      drawdown: +(inp.reservoirPressure - r.bhp).toFixed(2),
    });
  }

  // Оценка времени и объёма — упрощённо: цикл = вытеснение объёма жидкости в скважине
  const wellVolume = (Math.PI * Math.pow(inp.csgID / 2000, 2)) * inp.tvd; // м³
  const Qg_actual_at_BHP_per_min = inp.n2RateSm3min * gasFVF(Math.max(main.bhp, 1), inp.bhct + 273.15);
  const timeMin = Qg_actual_at_BHP_per_min > 0 ? wellVolume / Qg_actual_at_BHP_per_min : 0;
  const n2VolumeTotal = inp.n2RateSm3min * timeMin;

  // Surface pressure ≈ BHP - градиент газа от устья до глубины + потери (упрощённо)
  // Для оценки давления нагнетания возьмём P_inj ≈ BHP - rhoN2_avg·g·ctRunDepth
  const rhoN2avg = main.steps.reduce((s, x) => s + x.gasDensity, 0) / main.steps.length;
  const surfaceP = Math.max(0, main.bhp - (rhoN2avg * G * inp.ctRunDepth) / 1e6);

  const recs: string[] = [];
  if (!feasible) {
    const needed = sensitivity.find(s => s.drawdown >= inp.drawdownTarget);
    if (needed) {
      recs.push(`⚠ Целевая депрессия не достигнута. Увеличьте расход N₂ до ≥ ${needed.rate} ст.м³/мин`);
    } else {
      recs.push(`✖ Целевая депрессия недостижима даже при 3× расходе. Рассмотрите: снижение ρж, заглубление ГНКТ, многоступенчатое освоение`);
    }
  } else {
    recs.push(`✅ Целевая депрессия ${inp.drawdownTarget} MPa достигнута`);
  }
  if (main.avgRhoMix < 200) recs.push("ℹ Очень лёгкая смесь — контроль выноса флюидов, риск гидратообразования при дросселировании");
  if (main.avgRhoMix > 700) recs.push("ℹ Смесь тяжёлая — увеличьте расход N₂ или снизьте подачу жидкости");
  if (inp.ctRunDepth < inp.tvd * 0.6) recs.push("ℹ Рекомендуется спуск ГНКТ на ≥60% TVD для эффективного газлифта");
  if (surfaceP > 35) recs.push(`⚠ Давление нагнетания ~${surfaceP.toFixed(1)} MPa — проверьте паспорт ГНКТ и азотной установки`);

  return {
    steps: main.steps,
    bottomholePressure: +main.bhp.toFixed(2),
    drawdown: +drawdown.toFixed(2),
    surfacePressure: +surfaceP.toFixed(2),
    n2VolumeTotal: +n2VolumeTotal.toFixed(0),
    liquidUnloaded: +wellVolume.toFixed(1),
    avgMixDensity: +main.avgRhoMix.toFixed(0),
    feasible,
    recommendations: recs,
    sensitivity,
  };
}
