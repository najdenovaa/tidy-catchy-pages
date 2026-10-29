/**
 * Программа работ ГНКТ по результатам расчёта: подготовка и опрессовка, режим спуска по интервалам,
 * контрольные точки индикатора веса, работа на забое, подъём, ограничения, действия при осложнениях, учёт ресурса.
 */
import type { CTStringData, FluidData, ForceResult, HookLoadPoint, HydraulicsResult, LimitResult, PumpData, WellGeometry, CTSurfaceOptions, FatigueResult } from "./coiled-tubing-calculations";
import { CT_SURFACE_DEFAULTS } from "./ct-engine";
import { CT_OPERATIONS } from "./ct-operations";
import type { LifeAnalysis } from "./ct-string-life";

export interface CTProgramSection { title: string; items: string[] }
export interface CTCheckpoint { md: number; rih: string; pooh: string; tol: string; note: string }
export interface CTProgram { title: string; sections: CTProgramSection[]; checkpoints: CTCheckpoint[]; limitsTable: [string, string][] }

const f = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d).replace(".", ",") : "—");

export function buildCTProgram(inp: {
  ct: CTStringData; well: WellGeometry; fluid: FluidData; pump: PumpData; opts: CTSurfaceOptions; friction: number;
  forces: ForceResult; limits: LimitResult; hydraulics: HydraulicsResult; fatigue: FatigueResult;
  hookLoad: HookLoadPoint[]; life?: LifeAnalysis | null; operationType?: string;
}): CTProgram {
  const { ct, well, fluid, pump, forces: F, limits: L, hydraulics: H, hookLoad, life } = inp;
  const o = { ...CT_SURFACE_DEFAULTS, ...inp.opts };
  const op = CT_OPERATIONS.find((x) => x.type === inp.operationType);
  const td = Math.round(F.deployDepth);
  const reach = F.lockUpDepth > 0 ? F.lockUpDepth : td;
  const pTest = Math.min(Math.max(1.2 * H.pumpPressure, H.pumpPressure + 3.5), L.maxWorkingPressure);
  const pullLimit = Math.min(L.maxWorkingTension, o.injectorPullKN - o.reelBackTensionKN);
  const overpull = Math.max(0, pullLimit - F.surfaceLoadPOOH);
  const sections: CTProgramSection[] = [];

  sections.push({ title: "1. Цель и условия", items: [
    `Операция: ${op ? `${op.nameRu} — ${op.description.replace(/\.$/, "")}` : "работы ГНКТ (тип операции не выбран)"}.`,
    `Скважина: глубина по стволу ${well.md} м, по вертикали ${well.tvd} м; колонна Ø внутр. ${well.casingID} мм${well.tubingID > 0 ? `, НКТ Ø внутр. ${well.tubingID} мм${o.tubingShoeMD ? ` до ${o.tubingShoeMD} м` : ""}` : ""}; давление на устье ${f(well.wellheadPressure)} МПа.`,
    `ГНКТ: ${ct.od}×${ct.wall} мм, ${ct.grade}, длина ${ct.length} м${life ? ` (сейчас ${Math.round(life.currentLengthM)} м по журналу)` : ""}; овальность ${ct.ovality}%.`,
    `Рабочая жидкость: ${fluid.name}, ${f(fluid.density, 2)} г/см³; расход ${f(pump.flowRate, 1)} л/с (${f(pump.flowRate * 60, 0)} л/мин).`,
    `Коэффициент трения в расчёте μ = ${inp.friction}. Расчётная глубина работ ${td} м${F.lockUpDepth > 0 ? `; ВНИМАНИЕ: по расчёту запирание на ${F.lockUpDepth} м — до цели не дойти без мероприятий (п. 6)` : ""}.`,
  ] });

  sections.push({ title: "2. Подготовка и опрессовка", items: [
    `Проверить паспорт и ресурс трубы: израсходовано ${f(life ? life.maxDamagePct : inp.fatigue.fatigueLifeUsed, 1)}%${life && Number.isFinite(life.jobsToRetire) ? `, до отбраковки ≈ ${Math.floor(life.jobsToRetire)} таких работ` : ""}. Длина трубы — не менее ${td + 150} м (глубина + 150 м запаса).`,
    `Опрессовать ГНКТ, нагнетательные линии и манифольд на ${f(pTest)} МПа (≈1,2 × ожидаемого давления насоса ${f(H.pumpPressure)} МПа, не выше 80% давления разрыва — ${f(L.maxWorkingPressure)} МПа), выдержка по регламенту, падение давления не допускается.`,
    `Опрессовать превенторный блок и уплотнитель (стриппер) на давление не ниже ${f(Math.max(well.wellheadPressure * 1.1, well.wellheadPressure + 2))} МПа (по регламенту предприятия).`,
    `Установить ограничения инжектора: тяга не более ${f(pullLimit, 0)} кН (меньшее из 80% предела текучести трубы ${f(L.maxWorkingTension, 0)} кН и тяги инжектора за вычетом натяжения барабана), проталкивание не более ${f(o.injectorSnubKN, 0)} кН.`,
    `Трение в уплотнителе принять ${f(F.stripperFriction)} кН; выталкивающая сила давления устья ${f(F.pressureAreaForce)} кН — индикатор веса на устье до спуска ≈ ${f(-F.pressureAreaForce)} кН.`,
    `Установить обратный клапан и разъединитель в КНБК; проверить работу датчиков веса, глубины, давления и расхода.`,
  ] });

  const rihItems: string[] = [];
  if (F.pipeLightDepth > 0) rihItems.push(`0–${F.pipeLightDepth} м: трубу выталкивает давление устья — спуск с проталкиванием инжектором (до ${f(F.maxSnubRequired)} кН), скорость не более 5–10 м/мин, контроль изгиба трубы между инжектором и уплотнителем.`);
  else rihItems.push(`Спуск от устья: скорость до 10 м/мин на первых 50 м, далее до 20–30 м/мин в вертикальной части.`);
  if (F.sinusoidalZone) rihItems.push(`${F.sinusoidalZone[0]}–${F.sinusoidalZone[1]} м: сжатие выше синусоидального изгиба — скорость не более 10–15 м/мин, следить за снижением веса относительно контрольных точек.`);
  if (F.helicalZone) rihItems.push(`${F.helicalZone[0]}–${F.helicalZone[1]} м: спиральный изгиб — скорость не более 10 м/мин, при отклонении веса вниз больше допуска — остановка, расхаживание вверх на 5–10 м, промывка; не допускать резких посадок.`);
  rihItems.push(`Спуск вести с циркуляцией не менее ${f(Math.max(0.3 * pump.flowRate, 0.5), 1)} л/с (поддержание давления в трубе, охлаждение, очистка).`);
  rihItems.push(`Через каждые 250 м — замер веса при подъёме на 5–10 м и спуске (контрольные точки ниже); отклонение больше допуска — остановка и анализ (вкладка «Факт»: подбор трения по замерам).`);
  if (F.lockUpDepth > 0) rihItems.push(`Ожидаемое запирание на ${F.lockUpDepth} м (${F.lockUpReason === "injector" ? "не хватает усилия проталкивания" : "спиральный изгиб"}) — заранее выполнить мероприятия п. 6.`);
  sections.push({ title: "3. Спуск ГНКТ", items: rihItems });

  const bh: string[] = [];
  if (op) bh.push(`Рекомендуемая жидкость: ${op.recommendedFluid}; расход ${op.recommendedFlowRateLpm[0]}–${op.recommendedFlowRateLpm[1]} л/мин; давление ${op.recommendedSurfacePressureMPa[0]}–${op.recommendedSurfacePressureMPa[1]} МПа; КНБК: ${op.typicalBHA.join(", ")}.`);
  bh.push(`Расчётный режим: расход ${f(pump.flowRate * 60, 0)} л/мин, давление насоса ≈ ${f(H.pumpPressure)} МПа (потери: в спущенной ГНКТ ${f(H.dpCTDeployed)}, на барабане и в линиях ${f(H.dpReel + H.dpLines)}, на насадках ${f(H.dpNozzle)}, в затрубье ${f(H.dpAnnulus)} МПа), не более ${f(L.maxWorkingPressure)} МПа.`);
  bh.push(`Забойное давление при циркуляции ≈ ${f(H.bhCircPressure)} МПа — ${f(H.fracSafetyFactor * 100, 0)}% от давления ГРП (${f(H.fracPressureAtTD)} МПа)${H.fracSafetyFactor >= 0.85 ? " — снизить расход/устьевое давление, риск поглощения" : ""}.`);
  bh.push(`Скорость в затрубье ${f(H.velocityAnnulus, 2)} м/с при необходимой ${f(H.minTransportVelocity, 2)} м/с${H.transportOk ? "" : " — недостаточна для выноса шлама: увеличить расход, вязкость (гелевые пачки), промывать с остановками на циркуляцию"}.`);
  bh.push(`Доступная нагрузка на забой: до ${f(F.wobMaxAtTD)} кН при полном проталкивании, ${f(F.wobNoSnubAtTD)} кН — разгрузкой собственного веса.`);
  bh.push(`Не проводить многократное расхаживание в одном интервале — это главный источник местного износа трубы (смещайте точки расхаживания на 3–5 м).`);
  sections.push({ title: "4. Работа на забое", items: bh });

  sections.push({ title: "5. Подъём ГНКТ", items: [
    `Ожидаемый вес при подъёме с ${td} м ≈ ${f(F.surfaceLoadPOOH)} кН; допустимая затяжка сверх расчётного веса — не более ${f(overpull, 0)} кН (до ограничения ${f(pullLimit, 0)} кН).`,
    `Подъём с циркуляцией; скорость в интервалах изгиба и у башмаков — до 10 м/мин, в остальных — до 20–30 м/мин; при затяжке больше 5 кН сверх контрольной точки — остановка, промывка, расхаживание.`,
    `Давление в трубе при прохождении гусака держать минимальным, где это допускает технология: ресурс трубы при давлении ${f(H.pumpPressure)} МПа в ${f(1 / Math.pow(1 - Math.min(0.95, H.pumpPressure / Math.max(1, L.burstPressure)), 3), 1)} раза меньше, чем без давления.`,
  ] });

  sections.push({ title: "6. Осложнения и действия", items: [
    "Запирание / недохождение: снижатель трения или смазка в рабочую жидкость (μ −0,05…−0,10), вибратор или трактор, облегчённая КНБК, увеличение диаметра/стенки трубы; проверить расчёт с фактическим трением (вкладка «Факт»).",
    "Прихват: не превышать допустимую затяжку; циркуляция максимальным расходом, расхаживание в пределах ограничений инжектора, закачка снижателя трения; при неуспехе — разъединитель.",
    "Рост давления выше расчётного: остановка закачки, проверка засорения насадок/трубы, исключить превышение рабочего давления трубы.",
    "Падение давления / утечка: прекратить закачку, оценить место (на барабане или в скважине), подъём без давления в трубе; на устье — закрыть превенторы по плану.",
    `Давление на устье не должно приближаться к давлению смятия трубы с овальностью (${f(L.collapseWithOvality)} МПа; с натяжением ${f(L.collapseAtLoad)} МПа): не стравливать давление в трубе при высоком устьевом.`,
  ] });

  sections.push({ title: "7. После работ", items: [
    `Внести работу в журнал трубы (вкладка «Усталость»): глубина ${td} м, давление ${f(H.pumpPressure)} МПа, число рейсов и расхаживаний с интервалами, среда.`,
    `Расход ресурса за эту работу — до ${life ? f(life.jobDamagePct, 2) : f(100 / Math.max(1, inp.fatigue.estimatedCycles), 2)}% на самом нагруженном участке.`,
    "Сохранить расчёт и фактические замеры в кабинете для калибровки следующих работ.",
  ] });

  // контрольные точки
  const checkpoints: CTCheckpoint[] = [];
  const step = td > 2500 ? 250 : td > 1000 ? 200 : 100;
  for (let d = step; d <= reach + 1; d += step) {
    const p = hookLoad.reduce((b, x) => (Math.abs(x.depth - d) < Math.abs(b.depth - d) ? x : b), hookLoad[0]);
    if (!p) break;
    const tol = Math.max(3, 0.1 * Math.abs(p.hookPOOH_kN));
    const note = F.helicalZone && d >= F.helicalZone[0] && d <= F.helicalZone[1] ? "спиральный изгиб" : F.pipeLightDepth && d <= F.pipeLightDepth ? "проталкивание" : "";
    checkpoints.push({ md: p.depth, rih: p.hookRIH_kN === null ? "запирание" : f(p.hookRIH_kN), pooh: f(p.hookPOOH_kN), tol: `±${f(tol, 0)}`, note });
  }
  const limitsTable: [string, string][] = [
    ["Давление опрессовки ГНКТ", `${f(pTest)} МПа`],
    ["Макс. рабочее давление ГНКТ (80% разрыва)", `${f(L.maxWorkingPressure)} МПа`],
    ["Ожидаемое давление насоса", `${f(H.pumpPressure)} МПа`],
    ["Ограничение тяги инжектора", `${f(pullLimit, 0)} кН`],
    ["Ограничение проталкивания", `${f(o.injectorSnubKN, 0)} кН`],
    ["Допустимая затяжка сверх веса при подъёме с забоя", `${f(overpull, 0)} кН`],
    ["Давление смятия с овальностью", `${f(L.collapseWithOvality)} МПа`],
    ["Забойное давление / давление ГРП", `${f(H.bhCircPressure)} / ${f(H.fracPressureAtTD)} МПа`],
  ];
  return { title: `Программа работ ГНКТ${op ? `: ${op.nameRu}` : ""}`, sections, checkpoints, limitsTable };
}
