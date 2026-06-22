// ============================================================================
// GAS MIGRATION SEVERITY (GMS) — Part 6 audit
// Индекс риска газовых перетоков через цементное кольцо.
// Модели: Sutton & Faul (SPE 14282) — индекс GFP (gas flow potential),
//         Rocha-Azar (SPE 26385) — критерий стабильности столба цемента,
//         API 65-2 — таблица риска (low / moderate / high / severe).
//
// Физика: после остановки циркуляции цемент проходит фазу гелирования,
// в которой давление в порах ОБР падает от гидростатического к меньшему,
// и если оно опускается ниже пластового — газ прорывается в кольцо.
// ============================================================================

export interface GMSInput {
  /** TVD продуктивного / газового горизонта, м */
  tvdGasZone: number;
  /** Пластовое давление в газовом горизонте, МПа */
  porePressureMPa: number;
  /** TVD кровли цемента (TOC), м */
  tocTvd: number;
  /** TVD башмака обсадной (низа цемента), м */
  shoeTvd: number;
  /** Плотность бурового раствора над цементом (если TOC ниже устья), кг/м³ */
  mudAboveTOCDensity?: number;
  /** Плотность ведущего (хвостового) цемента у газового горизонта, кг/м³ */
  tailSlurryDensity: number;
  /** Плотность лёгкого/верхнего цемента (если есть), кг/м³ */
  leadSlurryDensity?: number;
  /** TVD границы между лёгким и хвостовым цементом, м (если ступенчатый) */
  leadToTailInterfaceTvd?: number;
  /** API fluid loss цемента у газового горизонта, мл/30мин */
  fluidLossApi: number;
  /** Statиc gel strength @ 10 мин, Па (transition time = от 100 до 500 Па) */
  sgs10minPa?: number;
  /** Время загустевания (thickening time), мин */
  thickeningTimeMin: number;
  /** Гидравлический радиус кольцевого канала: r_h = A_ann / P_w, м */
  hydraulicRadiusM?: number;
  /** Высота столба цемента над газовым горизонтом, м (если уже известна) */
  cementColumnHeightAboveGasM?: number;
  /** Эффективная длина гелирующегося столба, м (обычно от TOC до башмака) */
  gelColumnHeightM?: number;
}

export interface GMSResult {
  /** Гидростатическое давление цементного столба у газового горизонта, МПа */
  hydrostaticAtGasMPa: number;
  /** "Overbalance" перед гелированием: P_гидр − P_пласт, МПа */
  initialOverbalanceMPa: number;
  /** Минимально достижимое давление в гелирующемся цементе у газового горизонта, МПа */
  minPressureDuringGelMPa: number;
  /** Время перехода 100→500 Па, мин (Rocha-Azar transition time) */
  transitionTimeMin: number;
  /** Sutton GFP = overbalance · transitionTime⁻¹ — индекс gas flow potential */
  gasFlowPotential: number;
  /** Категория риска (API 65-2 шкала) */
  riskCategory: "low" | "moderate" | "high" | "severe";
  /** Безразмерный GMS index 0..100 */
  gmsIndex: number;
  /** Доминирующий драйвер риска */
  primaryDriver: string;
  /** Рекомендации */
  recommendations: string[];
  /** Подробные субсчёты */
  scores: {
    hydrostaticDeficit: number;   // 0..1 (1 = нет запаса вообще)
    fluidLoss: number;            // 0..1 (1 = очень высокая водоотдача)
    gelTransition: number;        // 0..1 (1 = долгая опасная фаза)
    columnGeometry: number;       // 0..1 (1 = плохое: длинный узкий столб)
    thickeningRatio: number;      // 0..1 (1 = TT слишком велик относительно TT_оптимум)
  };
}

const G = 9.81;

// ─── Helpers ───────────────────────────────────────────────────────

/**
 * Гидростатическое давление многоступенчатого столба над глубиной zTvd, МПа.
 * Учитывает: ОБР над TOC, лёгкий цемент, хвостовой цемент.
 */
function hydrostaticAt(zTvd: number, input: GMSInput): number {
  const { tocTvd, mudAboveTOCDensity = 1100, leadSlurryDensity,
    leadToTailInterfaceTvd, tailSlurryDensity } = input;
  if (zTvd <= 0) return 0;

  let p = 0;
  let top = 0;

  // 1) От устья до TOC — ОБР (или жидкость над цементом)
  const topToTOC = Math.min(zTvd, tocTvd);
  if (topToTOC > top) {
    p += mudAboveTOCDensity * G * (topToTOC - top) / 1e6;
    top = topToTOC;
  }
  if (top >= zTvd) return p;

  // 2) От TOC до интерфейса (если есть лёгкий цемент)
  if (leadSlurryDensity && leadToTailInterfaceTvd && leadToTailInterfaceTvd > tocTvd) {
    const interfaceTvd = Math.min(zTvd, leadToTailInterfaceTvd);
    if (interfaceTvd > top) {
      p += leadSlurryDensity * G * (interfaceTvd - top) / 1e6;
      top = interfaceTvd;
    }
  }
  if (top >= zTvd) return p;

  // 3) Остальное — хвостовой цемент
  p += tailSlurryDensity * G * (zTvd - top) / 1e6;
  return p;
}

/**
 * Rocha-Azar gel transition time:
 * Δp = 4·SGS·L / d_h    (Па)
 * время от 100 до 500 Па — линейная интерполяция для оценки длительности
 * критической фазы. Берём упрощ.: TT_gel ≈ (SGS_500 − SGS_100) / SGS_rate,
 * где SGS_rate ≈ SGS_10 / 10 (Па/мин), как первое приближение.
 */
function transitionTimeMin(sgs10Pa: number): number {
  if (sgs10Pa <= 0) return 30;
  const rate = sgs10Pa / 10; // Па/мин
  return Math.min(120, Math.max(5, (500 - 100) / rate));
}

/**
 * Падение давления в гелирующемся цементе по Rocha-Azar:
 * Δp = 4·SGS·L / d_h, где L — высота гелирующейся колонны, d_h — гидр. диаметр.
 * Это полное падение, когда SGS достигает критического значения (≈500 Па).
 */
function pressureLossInGelMPa(sgs500Pa: number, columnLengthM: number, hydrRadiusM: number): number {
  if (hydrRadiusM <= 0 || columnLengthM <= 0) return 0;
  const dh = 4 * hydrRadiusM;
  return 4 * sgs500Pa * columnLengthM / dh / 1e6;
}

// ─── Main ──────────────────────────────────────────────────────────
export function calculateGMS(input: GMSInput): GMSResult {
  const {
    tvdGasZone, porePressureMPa, tocTvd, shoeTvd,
    fluidLossApi, sgs10minPa = 200, thickeningTimeMin,
    hydraulicRadiusM = 0.02,
  } = input;

  // 1) Гидростатика у газового горизонта (до гелирования)
  const hydrostaticAtGasMPa = hydrostaticAt(tvdGasZone, input);
  const initialOverbalanceMPa = hydrostaticAtGasMPa - porePressureMPa;

  // 2) Время перехода (transition time)
  const ttMin = transitionTimeMin(sgs10minPa);

  // 3) Длина гелирующейся колонны над газовым горизонтом
  const gelLen = input.gelColumnHeightM
    ?? input.cementColumnHeightAboveGasM
    ?? Math.max(0, tvdGasZone - tocTvd);

  // 4) Потеря давления в гелирующемся столбе (Rocha-Azar) при SGS = 500 Па
  const pLossGel = pressureLossInGelMPa(500, gelLen, hydraulicRadiusM);

  // 5) Минимальное давление у газового горизонта во время transition
  const minPressureMPa = hydrostaticAtGasMPa - pLossGel;

  // 6) Sutton Gas Flow Potential
  const gfp = ttMin > 0 ? initialOverbalanceMPa / (ttMin / 30) : initialOverbalanceMPa;
  // GFP < ~3 МПа·(30/мин) часто соответствует severe (Sutton & Faul)

  // ─── Sub-scores ──────────────────────────────────────────────
  // (a) Гидростатический дефицит после гелирования
  const deficit = Math.max(0, porePressureMPa - minPressureMPa);
  const hydrostaticDeficit = deficit > 0
    ? Math.min(1, deficit / Math.max(porePressureMPa, 1))
    : Math.max(0, 0.5 - initialOverbalanceMPa / 10);

  // (b) Fluid loss (>200 мл = высокий риск, <50 мл = низкий)
  const fluidLoss = Math.min(1, Math.max(0, (fluidLossApi - 50) / 200));

  // (c) Transition time — короче лучше; >30 мин — опасно
  const gelTransition = Math.min(1, Math.max(0, (ttMin - 15) / 45));

  // (d) Геометрия: длинный столб + узкий канал
  const columnGeometry = Math.min(1, (gelLen / 1000) * (0.02 / Math.max(hydraulicRadiusM, 0.005)));

  // (e) TT-ratio: TT слишком велик относительно ожидаемого (~120 мин для нормы)
  const thickeningRatio = Math.min(1, Math.max(0, (thickeningTimeMin - 120) / 240));

  // ─── Aggregate GMS index (0..100) ─────────────────────────────
  const gmsIndex = Math.round(
    (hydrostaticDeficit * 0.35 +
      fluidLoss          * 0.20 +
      gelTransition      * 0.20 +
      columnGeometry     * 0.15 +
      thickeningRatio    * 0.10) * 100,
  );

  const riskCategory: GMSResult["riskCategory"] =
    gmsIndex >= 75 ? "severe"
    : gmsIndex >= 55 ? "high"
    : gmsIndex >= 30 ? "moderate"
    : "low";

  // ─── Primary driver ──────────────────────────────────────────
  const drivers = [
    { name: "Дефицит гидростатики после гелирования", v: hydrostaticDeficit },
    { name: "Высокая водоотдача цемента", v: fluidLoss },
    { name: "Длинная фаза гелирования (transition time)", v: gelTransition },
    { name: "Геометрия столба (длинный/узкий канал)", v: columnGeometry },
    { name: "Избыточное время загустевания", v: thickeningRatio },
  ].sort((a, b) => b.v - a.v);

  const primaryDriver = drivers[0].name;

  // ─── Recommendations ─────────────────────────────────────────
  const recommendations: string[] = [];
  if (initialOverbalanceMPa < 2) {
    recommendations.push(`Гидростатика лишь на ${initialOverbalanceMPa.toFixed(2)} МПа выше пластового — увеличить плотность tail-цемента или ECP-пакер у газового горизонта.`);
  }
  if (deficit > 0.5) {
    recommendations.push(`После гелирования давление у газа на ${deficit.toFixed(2)} МПа НИЖЕ пластового — гарантированный приток. Применить компенсацию объёма (compressive cement, газоблокирующие добавки).`);
  }
  if (fluidLossApi > 100) {
    recommendations.push(`Снизить API fluid loss до ≤50 мл/30мин (полимерные регуляторы, латекс).`);
  }
  if (ttMin > 30) {
    recommendations.push(`Transition time > 30 мин — добавить акселератор гелирования или ZoneSealant-цемент.`);
  }
  if (columnGeometry > 0.6) {
    recommendations.push(`Длинный гелирующийся столб (${gelLen.toFixed(0)} м) — рассмотреть двухступенчатое цементирование или ECP.`);
  }
  if (thickeningTimeMin > 200) {
    recommendations.push(`TT = ${thickeningTimeMin.toFixed(0)} мин избыточен — оптимизировать рецептуру под фактический pump-time + 25% запас.`);
  }
  if (gmsIndex >= 55) {
    recommendations.push(`GMS=${gmsIndex} (${riskCategory}) — обязательная пресс-тест и CBL/USIT каротаж после WOC.`);
  }
  if (recommendations.length === 0) {
    recommendations.push(`GMS=${gmsIndex} (низкий риск). Стандартная процедура WOC и CBL после ${(thickeningTimeMin * 1.5).toFixed(0)} мин.`);
  }

  return {
    hydrostaticAtGasMPa,
    initialOverbalanceMPa,
    minPressureDuringGelMPa: minPressureMPa,
    transitionTimeMin: ttMin,
    gasFlowPotential: gfp,
    riskCategory,
    gmsIndex,
    primaryDriver,
    recommendations,
    scores: {
      hydrostaticDeficit,
      fluidLoss,
      gelTransition,
      columnGeometry,
      thickeningRatio,
    },
  };
}
