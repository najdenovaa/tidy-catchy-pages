/**
 * Техника и логистика цементирования по расчёту закачки.
 * Число цементировочных агрегатов — по фактическим расходу и давлению в каждый момент операции
 * (ограничение гидравлической мощности насоса), смесительные машины — по массе сухой смеси и темпу затворения,
 * автоцистерны — по объёму воды, состав бригады и график работ.
 */
import type { PressureProfileResult, MaterialSummary, SlurryInput } from "./cementing-calculations";

export interface LogisticsSettings {
  /** Агрегат: наименование, гидравлическая мощность (кВт), макс. давление (МПа), макс. подача (л/с) */
  unitName: string;
  unitPowerKW: number;
  unitMaxPressureMPa: number;
  unitMaxRateLps: number;
  /** Смесительная машина: наименование, вместимость бункера (т), темп затворения на пару «СМН + ЦА» (л/с) */
  mixerName: string;
  mixerCapacityT: number;
  mixRatePerPairLps: number;
  /** Автоцистерна, м³ */
  tankerM3: number;
  reserveUnits: number;
  rigUpMin: number;
  rigDownMin: number;
}

export const DEFAULT_LOGISTICS: LogisticsSettings = {
  unitName: "ЦА-320", unitPowerKW: 100, unitMaxPressureMPa: 32, unitMaxRateLps: 23,
  mixerName: "СМН-20", mixerCapacityT: 20, mixRatePerPairLps: 12,
  tankerM3: 10, reserveUnits: 1, rigUpMin: 90, rigDownMin: 60,
};

export interface LogisticsResult {
  /** Подача одного агрегата при давлении P, л/с */
  unitRateAt: (pMPa: number) => number;
  peakUnitsHydraulic: number;
  peakAt: { stage: string; time: number; rateLps: number; pressureMPa: number };
  unitsForMixing: number;
  unitsWorking: number;
  unitsTotal: number;
  mixers: number;
  blendT: number;
  peakHydPowerKW: number;
  overPressure: boolean;
  maxSurfaceMPa: number;
  waterM3: number;
  tankers: number;
  equipment: { name: string; count: number; note: string }[];
  personnel: { role: string; count: number }[];
  timeline: { step: string; durationMin: number; startMin: number }[];
  /** Профиль требуемого числа агрегатов по времени */
  unitsProfile: { time: number; units: number; stage: string }[];
  /** Испытание нагнетательных линий, МПа */
  lineTestMPa: number;
  notes: string[];
}

export function planLogistics(
  pressure: PressureProfileResult, materials: MaterialSummary, slurries: SlurryInput[],
  settings: LogisticsSettings = DEFAULT_LOGISTICS,
): LogisticsResult {
  const s = settings;
  const unitRateAt = (p: number) => Math.min(s.unitMaxRateLps, p > 0.1 ? (s.unitPowerKW / p) : s.unitMaxRateLps);
  let peak = 0, peakAt = { stage: "—", time: 0, rateLps: 0, pressureMPa: 0 }, peakPower = 0, maxSurf = 0;
  const unitsProfile: LogisticsResult["unitsProfile"] = [];
  for (const pt of pressure.points) {
    const q = pt.pumpRateLps, p = Math.max(0, pt.surfacePressure);
    maxSurf = Math.max(maxSurf, p);
    if (q <= 0) { unitsProfile.push({ time: pt.time, units: 0, stage: pt.stage }); continue; }
    const n = Math.ceil(q / unitRateAt(p) - 1e-9);
    unitsProfile.push({ time: pt.time, units: n, stage: pt.stage });
    peakPower = Math.max(peakPower, p * q);
    if (n > peak) { peak = n; peakAt = { stage: pt.stage, time: pt.time, rateLps: q, pressureMPa: p }; }
  }
  const cementRate = Math.max(0, ...slurries.flatMap((sl) => sl.flowRateSteps.map((st) => st.rateLps)));
  const unitsForMixing = Math.ceil(cementRate / s.mixRatePerPairLps - 1e-9);
  const unitsWorking = Math.max(peak, unitsForMixing, 1);
  const unitsTotal = unitsWorking + s.reserveUnits;

  const blendT = materials.cementItems.filter((c) => c.unit === "т").reduce((t, c) => t + c.amount, 0)
    + materials.cementItems.filter((c) => c.unit === "кг").reduce((t, c) => t + c.amount, 0) / 1000;
  const mixers = Math.max(Math.ceil(blendT / s.mixerCapacityT - 1e-9), unitsForMixing);

  const waterM3 = materials.waterTotal;
  const tankers = Math.ceil(waterM3 / s.tankerM3 - 1e-9);

  const overPressure = maxSurf > s.unitMaxPressureMPa;
  const lineTestMPa = Math.min(s.unitMaxPressureMPa, Math.ceil(maxSurf * 1.5));

  const equipment = [
    { name: `Цементировочный агрегат ${s.unitName}`, count: unitsTotal, note: `${unitsWorking} в работе + ${s.reserveUnits} резерв; пик ${peak} шт. при ${peakAt.rateLps.toFixed(0)} л/с и ${peakAt.pressureMPa.toFixed(1)} МПа` },
    { name: `Смесительная машина ${s.mixerName}`, count: mixers, note: `сухая смесь ${blendT.toFixed(1)} т; темп затворения ${cementRate.toFixed(0)} л/с` },
    { name: "Станция контроля цементирования (СКЦ)", count: 1, note: "регистрация давления, расхода, плотности" },
    { name: "Блок манифольдов (БМ-700)", count: 1, note: "обвязка агрегатов с устьем" },
    { name: `Автоцистерна ${s.tankerM3} м³ (вода затворения и буферов)`, count: tankers, note: `${waterM3.toFixed(1)} м³ с запасом 10%` },
    { name: "Осреднительная ёмкость", count: slurries.length > 1 ? 1 : 0, note: "для хвостовой пачки — стабильная плотность" },
  ].filter((e) => e.count > 0);

  const personnel = [
    { role: "Мастер по цементированию", count: 1 },
    { role: "Инженер-технолог", count: 1 },
    { role: `Машинист ${s.unitName}`, count: unitsTotal },
    { role: `Помощник машиниста ${s.unitName}`, count: unitsWorking },
    { role: `Машинист ${s.mixerName}`, count: mixers },
    { role: "Оператор СКЦ", count: 1 },
    { role: "Водитель автоцистерны", count: tankers },
  ];

  const pts = pressure.points;
  const jobMin = pts.length ? pts[pts.length - 1].time : 0;
  const timeline: LogisticsResult["timeline"] = [];
  let t = 0;
  const push = (step: string, d: number) => { timeline.push({ step, durationMin: d, startMin: t }); t += d; };
  push("Расстановка техники, обвязка, инструктаж", s.rigUpMin);
  push(`Испытание нагнетательных линий на ${lineTestMPa} МПа`, 15);
  push("Закачка буферов, затворение и закачка цемента, продавка (по расчёту)", jobMin);
  push("Проверка обратного клапана, сброс давления", 15);
  push("Промывка и демонтаж обвязки", s.rigDownMin);

  const notes: string[] = [];
  if (overPressure) notes.push(`Давление на устье ${maxSurf.toFixed(1)} МПа выше паспортного для ${s.unitName} (${s.unitMaxPressureMPa} МПа) — нужен агрегат более высокого давления или снижение расхода.`);
  if (peak > 4) notes.push(`Требуется ${peak} агрегатов одновременно — проверить возможность обвязки и места на кустовой площадке; рассмотреть снижение расхода продавки.`);
  if (cementRate > unitsForMixing * s.mixRatePerPairLps * 0.95) notes.push("Темп затворения на пределе возможностей смесительных пар — контролировать плотность особенно тщательно.");
  notes.push("Испытание нагнетательных линий — на полуторакратное ожидаемое рабочее давление (практика; уточнить по регламенту предприятия).");

  return {
    unitRateAt, peakUnitsHydraulic: peak, peakAt, unitsForMixing, unitsWorking, unitsTotal, mixers, blendT,
    peakHydPowerKW: peakPower, overPressure, maxSurfaceMPa: maxSurf, waterM3, tankers,
    equipment, personnel, timeline, unitsProfile, lineTestMPa, notes,
  };
}
