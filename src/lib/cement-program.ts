/**
 * Программа цементирования: температурный режим (BHCT), программа лабораторных испытаний
 * тампонажных растворов (API RP 10B-2 / ГОСТ 26798.1) и рецептура по абсолютным объёмам.
 */
import type { Additive, SlurryInput, WellData, PressureProfileResult, VolumeResults } from "./cementing-calculations";
import { calculateAdditiveMass, getEffectiveTrajectory, interpolateTVD } from "./cementing-calculations";

// ═══════════════════════ Температура ═══════════════════════

export interface BhctResult {
  bhctC: number;
  gradientCper100m: number;
  method: "Kutasov–Targhi" | "приближённая (вне диапазона корреляции)";
  inRange: boolean;
  note?: string;
}

/**
 * BHCT по корреляции Kutasov–Targhi (регрессия по 79 замерам, база данных API RP 10B, точность ±4.6 °C):
 * Tc = d1 + d2·Γ + (d3 − d4·Γ)·Ts, d1 = −50.64 °C, d2 = 804.9 м, d3 = 1.342, d4 = 12.22 м/°C, Γ — °C/м.
 * Применима при 74.4 ≤ Ts ≤ 212.2 °C и 1.51 ≤ Γ ≤ 4.45 °C/100 м; вне диапазона — приближённая схема.
 */
export function bhctKutasovTarghi(bhstC: number, surfaceC: number, tvdM: number): BhctResult {
  const G = tvdM > 0 ? (bhstC - surfaceC) / tvdM : 0;
  const G100 = G * 100;
  const inRange = bhstC >= 74.4 && bhstC <= 212.2 && G100 >= 1.51 && G100 <= 4.45;
  if (inRange) {
    const t = -50.64 + 804.9 * G + (1.342 - 12.22 * G) * bhstC;
    return { bhctC: Math.min(bhstC, Math.max(surfaceC, t)), gradientCper100m: G100, method: "Kutasov–Targhi", inRange };
  }
  // Приближённая схема: доля прогрева растёт с глубиной (0.7 у устья → 1.0 на 4570 м)
  const ratio = Math.min(1, 0.7 + 0.3 * (tvdM / 4572));
  const t = surfaceC + (bhstC - surfaceC) * ratio;
  return {
    bhctC: t, gradientCper100m: G100, method: "приближённая (вне диапазона корреляции)", inRange,
    note: bhstC < 74.4
      ? "BHST ниже 74 °C — корреляции API не откалиброваны. Для точности — замер термометром при промывке или моделирование теплообмена."
      : "Градиент или BHST вне диапазона корреляции — уточнить замером при промывке.",
  };
}

/** Статическая температура на глубине TVD (линейный геотермический градиент). */
export function staticTempAt(tvdM: number, bhstC: number, surfaceC: number, bottomTvdM: number): number {
  if (bottomTvdM <= 0) return bhstC;
  return surfaceC + ((bhstC - surfaceC) * tvdM) / bottomTvdM;
}

// ═══════════════════════ Программа лабиспытаний ═══════════════════════

export type LabStatus = "ok" | "fail" | "todo" | "info";

export interface LabTest {
  test: string;
  conditions: string;
  criterion: string;
  /** Что известно сейчас (введённое значение), если есть */
  actual?: string;
  status: LabStatus;
  reference: string;
}

export interface SlurryLabProgram {
  slurryName: string;
  topMD: number;
  bottomMD: number;
  bhctC: number;
  tTopStaticC: number;
  tBottomStaticC: number;
  testPressureMPa: number;
  rampMin: number;
  jobTimeMin: number;
  requiredThickeningMin: number;
  tests: LabTest[];
  warnings: string[];
}

export interface LabProgramResult {
  bhct: BhctResult;
  bhctUsedC: number;
  bhctEnteredC: number;
  surfaceC: number;
  slurries: SlurryLabProgram[];
  notes: string[];
}

/**
 * Программа испытаний для каждого раствора, условия — из симуляции закачки:
 * время работы раствора = от начала его закачки до посадки пробки; время выхода на BHCT = пока раствор
 * проходит колонну; давление испытания — максимальное забойное за операцию.
 */
export function buildLabProgram(
  wellData: WellData, slurries: SlurryInput[], pressure: PressureProfileResult | null, vols: VolumeResults | null,
): LabProgramResult {
  const surfaceC = wellData.surfaceTemp ?? 15;
  const traj = getEffectiveTrajectory(wellData);
  const bottomTVD = interpolateTVD(wellData.casingDepthMD, traj);
  const bhct = bhctKutasovTarghi(wellData.bottomTempStatic, surfaceC, bottomTVD);
  const bhctEnteredC = wellData.bottomTempCirc || 0;
  const bhctUsedC = bhctEnteredC > 0 ? bhctEnteredC : bhct.bhctC;
  const notes: string[] = [];
  if (bhctEnteredC > 0 && Math.abs(bhctEnteredC - bhct.bhctC) > 8) {
    notes.push(`Введённая BHCT ${bhctEnteredC.toFixed(0)} °C отличается от расчётной (${bhct.bhctC.toFixed(0)} °C, ${bhct.method}) более чем на 8 °C. Время загустевания чувствительно к температуре: +10 °C сокращают его ориентировочно на 25–40%.`);
  }
  if (bhct.note) notes.push(bhct.note);

  const points = pressure?.points ?? [];
  const endTime = points.length ? points[points.length - 1].time : 0;
  const maxBhp = points.reduce((m, p) => Math.max(m, p.bottomholePressure), 0);
  const maxZenith = traj.reduce((m, p) => Math.max(m, p.zenith || 0), 0);
  const hasGas = (wellData.reservoirLayers ?? []).some((l) => /газ/i.test(l.fluidType || ""));
  const hasProductive = (wellData.reservoirLayers ?? []).length > 0;
  const pipeVol = vols?.totalPipeVolume ?? 0;

  const result: SlurryLabProgram[] = slurries.map((s, idx) => {
    const lastIdx = slurries.length - 1;
    const topMD = s.topDepthMD;
    const bottomMD = idx === lastIdx ? wellData.casingDepthMD : slurries[idx + 1].topDepthMD;
    const tTop = staticTempAt(interpolateTVD(topMD, traj), wellData.bottomTempStatic, surfaceC, bottomTVD);
    const tBot = staticTempAt(interpolateTVD(bottomMD, traj), wellData.bottomTempStatic, surfaceC, bottomTVD);

    // Время работы: от первой точки закачки этого раствора до конца операции
    const firstIdx = points.findIndex((p) => p.stage === s.name);
    const startT = firstIdx >= 0 ? points[Math.max(0, firstIdx - 1)].time : (pressure?.cementStartTime ?? 0);
    const jobTimeMin = Math.max(0, endTime - startT);
    // Выход на BHCT: пока голова раствора проходит объём колонны
    let rampMin = 0;
    if (firstIdx >= 0 && pipeVol > 0) {
      const v0 = points[Math.max(0, firstIdx - 1)].cumulativeVolume;
      const reach = points.find((p, i) => i >= firstIdx && p.cumulativeVolume - v0 >= pipeVol);
      rampMin = reach ? reach.time - startT : jobTimeMin;
    }
    // ПБ НГП: расчётная продолжительность цементирования ≤ 75% времени начала загустевания; плюс не менее 30 мин запаса
    const requiredThickeningMin = Math.ceil(Math.max(jobTimeMin / 0.75, jobTimeMin + 30));
    const tt30 = s.thickeningTime30Bc || 0;
    const warnings: string[] = [];

    const tests: LabTest[] = [];
    tests.push({
      test: "Плотность раствора",
      conditions: "Атм. давление, после затворения (рычажные весы под давлением)",
      criterion: `${s.density.toFixed(2)} ± 0.02 г/см³`,
      status: "todo",
      reference: "API RP 10B-2 §6",
    });
    tests.push({
      test: "Время загустевания (консистометр под давлением)",
      conditions: `BHCT ${bhctUsedC.toFixed(0)} °C, ${maxBhp.toFixed(1)} МПа; выход на режим за ${rampMin.toFixed(0)} мин`,
      criterion: `до 30 Вс ≥ ${requiredThickeningMin} мин (время работы ${jobTimeMin.toFixed(0)} мин ≤ 75% времени загустевания, запас не менее 30 мин)`,
      actual: tt30 > 0 ? `${tt30} мин` : undefined,
      status: tt30 > 0 ? (tt30 >= requiredThickeningMin ? "ok" : "fail") : "todo",
      reference: "API RP 10B-2 §9; ПБ НГП — работа ≤ 75% времени загустевания",
    });
    if (tt30 > 0 && tt30 < requiredThickeningMin) {
      warnings.push(`Время загустевания ${tt30} мин меньше требуемого ${requiredThickeningMin} мин — увеличить дозировку замедлителя или сократить время операции.`);
    }
    if (tt30 > 0 && tt30 > requiredThickeningMin * 2.5 && tTop < 40) {
      warnings.push(`Время загустевания в ${(tt30 / Math.max(1, requiredThickeningMin)).toFixed(1)} раза больше требуемого при холодной кровле (${tTop.toFixed(0)} °C) — риск долгого набора прочности и миграции газа. Рассмотреть снижение замедлителя.`);
    }
    tests.push({
      test: "Прочность на сжатие (УЗ-анализатор UCA или кубы)",
      conditions: `Кровля: ${tTop.toFixed(0)} °C; подошва: ${tBot.toFixed(0)} °C (статические), давление ${maxBhp.toFixed(1)} МПа; 12/24/48 ч`,
      criterion: "≥ 3.5 МПа к разбуриванию (ОЗЦ); ≥ 0.35 МПа — момент начала набора прочности",
      status: "todo",
      reference: "API RP 10B-2 §7–8; ГОСТ 1581",
    });
    if (tTop < 25) warnings.push(`На кровле раствора статическая температура ${tTop.toFixed(0)} °C — набор прочности ПЦТ сильно замедлен. Испытать прочность именно при ${tTop.toFixed(0)} °C, рассмотреть ускоритель для верхней пачки.`);
    const flCrit = hasGas ? 50 : hasProductive ? 100 : 250;
    tests.push({
      test: "Водоотдача (фильтр-пресс)",
      conditions: `BHCT ${Math.min(bhctUsedC, 88).toFixed(0)} °C${bhctUsedC > 88 ? " (выше 88 °C — динамическая/шприцевая ячейка)" : ""}, ΔP 6.9 МПа, сетка 325 mesh`,
      criterion: `≤ ${flCrit} мл/30 мин${hasGas ? " (газовые пласты)" : hasProductive ? " (продуктивные пласты)" : ""}`,
      status: "todo",
      reference: "API RP 10B-2 §10",
    });
    tests.push({
      test: "Свободная вода (водоотделение)",
      conditions: `BHCT, кондиционирование; цилиндр ${maxZenith > 30 ? "под углом 45°" : "вертикально"}, 2 ч`,
      criterion: maxZenith > 30 || hasGas ? "0% (наклонная скважина / газ)" : "≤ 0.5%",
      status: "todo",
      reference: "API RP 10B-2 §15",
    });
    if (maxZenith > 30) {
      tests.push({
        test: "Седиментационная устойчивость (BP settling)",
        conditions: "BHCT, твердение в вертикальной трубке; плотность по сегментам",
        criterion: "Разница плотности верх/низ ≤ 0.05 г/см³",
        status: "todo",
        reference: "API RP 10B-2 §15",
      });
    }
    tests.push({
      test: "Реология (вискозиметр Fann 600…3 об/мин)",
      conditions: `27 °C (поверхность) и BHCT ${bhctUsedC.toFixed(0)} °C после кондиционирования`,
      criterion: "Ввести показания — гидравлика пересчитается по Гершелю–Балкли",
      actual: s.rheology.fann ? "показания введены" : undefined,
      status: s.rheology.fann ? "ok" : "todo",
      reference: "API RP 10B-2 §12",
    });
    if (hasGas) {
      tests.push({
        test: "Статическое напряжение сдвига (SGS-анализатор)",
        conditions: `BHCT → BHST, ${maxBhp.toFixed(1)} МПа`,
        criterion: "Переходный период 48 → 240 Па (100 → 500 lbf/100ft²) ≤ 45 мин",
        status: "todo",
        reference: "API RP 10B-6, API RP 65-2",
      });
    }
    if (idx === 0) {
      tests.push({
        test: "Совместимость: раствор / буфер / цемент",
        conditions: "Смеси 95/5, 75/25, 50/50, 25/75, 5/95 при 27 °C и BHCT",
        criterion: "Нет резкого роста реологии; время загустевания смеси не короче, чем у чистого цемента",
        status: "todo",
        reference: "API RP 10B-2 §16",
      });
    }
    return {
      slurryName: s.name, topMD, bottomMD, bhctC: bhctUsedC, tTopStaticC: tTop, tBottomStaticC: tBot,
      testPressureMPa: maxBhp, rampMin, jobTimeMin, requiredThickeningMin, tests, warnings,
    };
  });

  return { bhct, bhctUsedC, bhctEnteredC, surfaceC, slurries: result, notes };
}

// ═══════════════════════ Рецептура по абсолютным объёмам ═══════════════════════

const SG_LIBRARY: [RegExp, number, string][] = [
  [/микрокремнез|silica fume|мк-?\d/i, 2.2, "микрокремнезём"],
  [/микросфер|алюмосиликат|аспм|полые сфер/i, 0.7, "микросферы"],
  [/барит/i, 4.2, "барит"],
  [/гематит/i, 5.0, "гематит"],
  [/ильменит/i, 4.6, "ильменит"],
  [/бентонит|глинопорош|гель/i, 2.65, "бентонит"],
  [/кварц|песок|кремнез|silica/i, 2.65, "кварцевая мука"],
  [/cacl|хлорид кальция|хлористый кальций|хк/i, 1.96, "хлорид кальция"],
  [/kcl|хлорид калия/i, 1.98, "хлорид калия"],
  [/nacl|хлорид натрия|соль/i, 2.17, "хлорид натрия"],
  [/перлит/i, 2.4, "перлит"],
  [/зола|летуч|fly ?ash/i, 2.4, "зола-унос"],
  [/шлак/i, 2.9, "шлак"],
  [/гипс/i, 2.7, "гипс"],
  [/mgo|оксид магния|расширя|ррд|пр-?\d/i, 3.3, "расширяющая добавка"],
  [/волокн|фибр/i, 1.3, "фибра"],
  [/латекс/i, 1.0, "латекс"],
  [/пеногас|антивспен|дефоам/i, 1.0, "пеногаситель"],
  [/пластиф|диспер|суперпласт|с-3|нтф/i, 1.35, "пластификатор"],
  [/водоотд|пво|кмц|оэц|hec|fluid loss/i, 1.3, "понизитель водоотдачи"],
  [/замедл|ретард|retard/i, 1.3, "замедлитель"],
  [/ускор/i, 1.9, "ускоритель"],
];
const DEFAULT_ADDITIVE_SG = 1.5;

/** Удельный вес добавки: заданный пользователем → по названию → 1.5 (с флагом «уточнить»). */
export function additiveSG(a: Additive): { sg: number; source: "user" | "library" | "default"; matched?: string } {
  if (a.specificGravity && a.specificGravity > 0) return { sg: a.specificGravity, source: "user" };
  for (const [re, sg, label] of SG_LIBRARY) if (re.test(a.name || "")) return { sg, source: "library", matched: label };
  return { sg: DEFAULT_ADDITIVE_SG, source: "default" };
}

export interface RecipeLine { name: string; kgPerM3: number; litersPerM3: number; sg: number; sgSource: "user" | "library" | "default"; totalKg: number }

export interface SlurryRecipe {
  slurryName: string;
  designDensity: number;
  cementSG: number;
  wcEntered: number;
  /** В/С (к массе сухой смеси), обеспечивающее проектную плотность */
  wcForDesign: number;
  /** Плотность при введённом В/С */
  densityAtEntered: number;
  densityMismatch: number;
  yieldM3perT: number;
  yieldEntered: number;
  perM3: { cementKg: number; waterL: number; additives: RecipeLine[] };
  slurryVolumeM3: number;
  totals: { cementT: number; blendT: number; waterM3: number; waterWithReserveM3: number; blendWithReserveT: number };
  warnings: string[];
}

/**
 * Абсолютные объёмы на 1 т цемента: V = Mц/ρц + Σmi/ρi + Mв.
 * Плотность = (Mц + Σmi + Mв)/V; выход = V/(Mц + Σmi).
 * В/С для проектной плотности ρ: Mв = (Mсм − ρ·Vсух)/(ρ − 1).
 */
export function buildRecipe(s: SlurryInput, slurryVolumeM3: number, reservePct = 5): SlurryRecipe {
  const cementSG = s.cementSG && s.cementSG > 0 ? s.cementSG : 3.15;
  const Mc = 1000;
  const adds = (s.additives || []).filter((a) => a.percentage > 0).map((a) => {
    const m = calculateAdditiveMass(a.percentage, a.percentageType || "bwoc", Mc);
    const sg = additiveSG(a);
    return { a, m, ...sg };
  });
  const Mb = Mc + adds.reduce((t, x) => t + x.m, 0);
  const Vdry = Mc / cementSG + adds.reduce((t, x) => t + x.m / x.sg, 0); // л
  const rho = s.density;
  const warnings: string[] = [];

  const MwDesign = rho > 1 ? (Mb - rho * Vdry) / (rho - 1) : 0;
  const wcForDesign = MwDesign / Mb;
  if (MwDesign <= 0) warnings.push(`Плотность ${rho.toFixed(2)} г/см³ недостижима для этой сухой смеси (средний удельный вес ${(Mb / Vdry).toFixed(2)}) — нужен утяжелитель.`);

  const wcEntered = s.waterRatio || 0;
  const MwEntered = wcEntered * Mb;
  const densityAtEntered = wcEntered > 0 ? (Mb + MwEntered) / (Vdry + MwEntered) : 0;
  const densityMismatch = wcEntered > 0 ? densityAtEntered - rho : 0;
  if (wcEntered > 0 && Math.abs(densityMismatch) > 0.02) {
    warnings.push(`Введённое В/С ${wcEntered.toFixed(3)} даёт плотность ${densityAtEntered.toFixed(3)} г/см³, а проектная ${rho.toFixed(2)} (расхождение ${densityMismatch > 0 ? "+" : ""}${densityMismatch.toFixed(3)}). Для проектной плотности В/С = ${wcForDesign.toFixed(3)}.`);
  }

  const Mw = MwDesign > 0 ? MwDesign : MwEntered;
  const Vtot = Vdry + Mw; // л на 1 т цемента
  const yieldM3perT = Vtot / Mb; // м³ на 1 т сухой смеси (л/кг = м³/т)
  const k = Vtot > 0 ? 1000 / Vtot : 0; // масштаб на 1 м³

  const wcCement = Mw / Mc;
  const hasExtender = adds.some((x) => /бентонит|микросфер|перлит|зола|микрокремнез/.test(x.matched || "") || x.sg < 1.2 && x.m > 50);
  if (wcCement > 0.6 && !hasExtender && MwDesign > 0) warnings.push(`В/Ц ${wcCement.toFixed(2)} — больше ~0.6 без облегчающей добавки: высокое водоотделение и низкая прочность. Нужен бентонит/микросферы или стабилизатор.`);
  if (wcCement > 0 && wcCement < 0.35 && MwDesign > 0) warnings.push(`В/Ц ${wcCement.toFixed(2)} ниже ~0.35 — раствор плохо прокачивается без пластификатора.`);
  const defaults = adds.filter((x) => x.source === "default");
  if (defaults.length) warnings.push(`Удельный вес не определён для: ${defaults.map((x) => x.a.name || "без названия").join(", ")} — принят 1.5 г/см³. Уточните в карточке добавки.`);

  const additives: RecipeLine[] = adds.map((x) => ({
    name: x.a.name || "Добавка", kgPerM3: x.m * k, litersPerM3: (x.m / x.sg) * k, sg: x.sg, sgSource: x.source,
    totalKg: x.m * k * slurryVolumeM3,
  }));
  const cementKgPerM3 = Mc * k;
  const blendKgPerM3 = Mb * k;
  const waterLPerM3 = Mw * k;
  const r = 1 + reservePct / 100;
  return {
    slurryName: s.name, designDensity: rho, cementSG, wcEntered, wcForDesign, densityAtEntered, densityMismatch,
    yieldM3perT, yieldEntered: s.yieldPerTon || 0,
    perM3: { cementKg: cementKgPerM3, waterL: waterLPerM3, additives },
    slurryVolumeM3,
    totals: {
      cementT: (cementKgPerM3 * slurryVolumeM3) / 1000,
      blendT: (blendKgPerM3 * slurryVolumeM3) / 1000,
      waterM3: (waterLPerM3 * slurryVolumeM3) / 1000,
      waterWithReserveM3: (waterLPerM3 * slurryVolumeM3 * r) / 1000,
      blendWithReserveT: (blendKgPerM3 * slurryVolumeM3 * r) / 1000,
    },
    warnings,
  };
}
