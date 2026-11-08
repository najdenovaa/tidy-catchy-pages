import { calculateCement } from "./cementing-calculations";
import { FLEET_SCHEMES, type FleetScheme } from "./cement-fleet-catalog";
/**
 * Техника и логистика цементирования по расчёту закачки.
 * Число цементировочных агрегатов — по фактическим расходу и давлению в каждый момент операции
 * (ограничение гидравлической мощности насоса), смесительные машины — по массе сухой смеси и темпу затворения,
 * автоцистерны — по объёму воды, состав бригады и график работ.
 */
import type { PressureProfileResult, MaterialSummary, SlurryInput } from "./cementing-calculations";

export interface LogisticsSettings {
  scheme?: FleetScheme;
  manufacturer?: string;
  pumpsPerUnit?: number;
  passportConfirmed?: boolean;
  closedMixing?: boolean;
  bulkVolumeM3?: number; bulkPayloadT?: number; bulkDensityTm3?: number; bulkUnloadTmin?: number;
  maxBulkConnections?: number;
  /** Flow envelope points for the whole machine, never one pump. Conservative step envelope. */
  pumpCurve?: { pressureMPa: number; rateLps: number }[];
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
  scheme: "classic", pumpsPerUnit: 1, bulkVolumeM3:25, bulkPayloadT:30, bulkDensityTm3:1.2, bulkUnloadTmin:1.1, maxBulkConnections:2,
  tankerM3: 10, reserveUnits: 1, rigUpMin: 90, rigDownMin: 60,
};

export interface LogisticsResult {
  scheme: FleetScheme; feasible: boolean; mixingSystems: number; workingPumps: number;
  dryFeedTmin: number; bulkPayloadT: number; bulkStockCount: number; bulkFeedCount: number; bulkTrucks: number;
  onePumpOutRateLps: number; onePumpOutMeetsPeak: boolean;
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
  const s = normalizeLogisticsSettings(settings);
  const scheme = s.scheme ?? 'classic', classic = scheme === 'classic', separateMixer = scheme === 'mixer-ca';
  const unitRateAt = (p: number) => {
    if(p > s.unitMaxPressureMPa || !(s.unitPowerKW > 0) || !(s.unitMaxRateLps > 0)) return 0;
    let q = Math.min(s.unitMaxRateLps, p > .1 ? s.unitPowerKW/p : s.unitMaxRateLps);
    if(s.pumpCurve?.length) {
      // A published duty point is available below its pressure; never extrapolate beyond the last point.
      const available=s.pumpCurve.filter(x=>x.pressureMPa>=p);
      q=Math.min(q,available.length?Math.max(...available.map(x=>x.rateLps)):0);
    }
    return q;
  };
  let peak = 0, peakAt = { stage: "—", time: 0, rateLps: 0, pressureMPa: 0 }, peakPower = 0, maxSurf = 0, peakRatio = 0;
  const unitsProfile: LogisticsResult["unitsProfile"] = [];
  let unavailable = false;
  for (const pt of pressure.points) {
    const q = pt.pumpRateLps, p = Math.max(0, pt.surfacePressure);
    maxSurf = Math.max(maxSurf, p);
    if (q <= 0) { unitsProfile.push({ time: pt.time, units: 0, stage: pt.stage }); continue; }
    const capacity=unitRateAt(p);
    if(capacity<=0) unavailable=true;
    const n = capacity>0 ? Math.ceil(q / capacity - 1e-9) : 0;
    unitsProfile.push({ time: pt.time, units: n, stage: pt.stage });
    peakPower = Math.max(peakPower, p * q);
    if (n > peak || (n === peak && capacity > 0 && q/capacity > peakRatio)) { peakRatio = capacity > 0 ? q/capacity : 0; peak = n; peakAt = { stage: pt.stage, time: pt.time, rateLps: q, pressureMPa: p }; }
  }
  const cementRate = Math.max(0, ...slurries.flatMap((sl) => sl.flowRateSteps.map((st) => st.rateLps)));
  const unitsForMixing = Math.ceil(cementRate / s.mixRatePerPairLps - 1e-9);
  // The tonnes in the material table are already total dry blend; ingredient kg are a breakdown.
  const blendT = materials.cementItems.filter(c=>c.unit==='т').reduce((t,c)=>t+c.amount,0);
  const dryFeedTmin=Math.max(0,...slurries.map(sl=>{
    const yieldM3T=calculateCement(1,sl.density,sl.waterRatio,sl.yieldPerTon).yieldPerTon;
    const q=Math.max(0,...sl.flowRateSteps.map(x=>x.rateLps));
    return yieldM3T>0?q*.06/yieldM3T:0;
  }));
  const bulkPayloadT=Math.min(s.bulkPayloadT!,s.bulkVolumeM3!*s.bulkDensityTm3!);
  const bulkStockCount=!classic&&blendT>0?Math.ceil(blendT/bulkPayloadT-1e-9):0;
  const bulkFeedCount=!classic?Math.ceil(dryFeedTmin/s.bulkUnloadTmin!-1e-9):0;
  const feedMixers=!classic?Math.ceil(bulkFeedCount/s.maxBulkConnections!-1e-9):0;
  const mixingSystems=classic?unitsForMixing:Math.max(unitsForMixing,feedMixers);
  const unitsWorking=Math.max(peak,separateMixer?0:mixingSystems,1);
  const unitsTotal=unitsWorking+s.reserveUnits;
  const mixers=classic?Math.max(Math.ceil(blendT/s.mixerCapacityT-1e-9),unitsForMixing):separateMixer?mixingSystems:0;
  const bulkTrucks=classic?0:Math.max(bulkStockCount,bulkFeedCount);
  const waterM3=materials.waterTotal, tankers=Math.ceil(waterM3/s.tankerM3-1e-9);
  const overPressure=maxSurf>s.unitMaxPressureMPa;
  const lineTestMPa=Math.min(s.unitMaxPressureMPa,Math.ceil(maxSurf*1.5));
  const pumps=s.pumpsPerUnit!;
  const peakCapacity=unitRateAt(peakAt.pressureMPa);
  const onePumpOutRateLps=Math.max(0,(unitsWorking*pumps-1)/pumps)*peakCapacity;
  const onePumpOutMeetsPeak=onePumpOutRateLps>=peakAt.rateLps-1e-6;
  const feasible=!unavailable&&!overPressure;
  const equipment=[
    {name:`Цементировочный агрегат ${s.manufacturer && !classic && !separateMixer?s.manufacturer+' ':''}${s.unitName}`,count:unitsTotal,note:`${unitsWorking} машин в работе + ${s.reserveUnits} резерв; ${pumps} насос(а) на машину. ${unavailable?'Режим недостижим по введённой характеристике.':`Пик ${peak} машин при ${peakAt.rateLps.toFixed(1)} л/с и ${peakAt.pressureMPa.toFixed(1)} МПа.`}`},
    {name:classic?`Смесительная машина ${s.mixerName}`:`Миксер ${s.mixerName}`,count:mixers,note:classic?`Сухая смесь ${blendT.toFixed(1)} т; затворение ${cementRate.toFixed(1)} л/с`:`Автономных миксеров ${mixers}; непрерывная производительность одного ${s.mixRatePerPairLps} л/с; пневмовходов ${s.maxBulkConnections}`},
    {name:`Цементовоз ЦТ-25 (${s.bulkVolumeM3} м³)`,count:bulkTrucks,note:`Одна загрузка: не более ${bulkPayloadT.toFixed(1)} т; по запасу ${bulkStockCount}, по темпу ${bulkFeedCount} линий; сухая смесь ${blendT.toFixed(1)} т`},
    {name:'Седельный тягач для ЦТ-25',count:bulkTrucks,note:'По одному тягачу на полуприцеп; повторные рейсы и отцепка в этой схеме не предполагаются'},
    {name:`Встроенная смесительная система ${s.mixerName}`,count:!classic&&!separateMixer?mixingSystems:0,note:'В составе интегрированных агрегатов; отдельные СМН и отдельное шасси не добавляются'},
    {name:'Станция контроля цементирования (СКЦ)',count:1,note:'Регистрация давления, расхода, плотности; встроенная система может заменить отдельную станцию по комплектации'},
    {name:'Блок манифольдов',count:1,note:`Рабочий класс давления не ниже ${maxSurf.toFixed(1)} МПа; подтвердить по паспорту`},
    {name:`Автоцистерна ${s.tankerM3} м³ (вода затворения и буферов)`,count:tankers,note:`${waterM3.toFixed(1)} м³, включая запас в ведомости материалов`},
    {name:'Осреднительная ёмкость',count:slurries.length>1?1:0,note:'Потребность и полезный объём проверить; не заменяет непрерывный темп смешивания'},
  ].filter(e=>e.count>0);

  const personnel = [
    { role: "Мастер по цементированию", count: 1 },
    { role: "Инженер-технолог", count: 1 },
    { role: `Машинист ${s.unitName}`, count: unitsTotal },
    { role: `Помощник машиниста ${s.unitName}`, count: unitsWorking },
    { role: `Машинист ${s.mixerName}`, count: mixers },
    { role: "Водитель тягача / оператор ЦТ-25", count: bulkTrucks },
    { role: "Оператор СКЦ", count: 1 },
    { role: "Водитель автоцистерны", count: tankers },
  ].filter(p=>p.count>0);

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
  if(unavailable) notes.push('Указанные Q-P недостижимы: параллельное добавление машин не повышает паспортный предел давления. Измените насос, плунжер или режим. Число машин для недостижимой точки не выдаётся как подтверждённое.');
  if(!s.passportConfirmed&&!classic) notes.push('Характеристики - расчётный шаблон, не подтверждённый паспортом. Бренд сам по себе не задаёт Q-P: внесите модель, исполнение, доступную гидравлическую мощность и рабочие точки.');
  if(!classic) {
    notes.push(`Схема: ${FLEET_SCHEMES[scheme]}. ${s.closedMixing?'Закрытая подача сухого материала к смесителю выбрана.':'Беспылевая подача не подтверждена.'} Число насосов не умножает производительность общей смесительной системы.`);
    notes.push(`Пиковая подача сухой смеси ${dryFeedTmin.toFixed(2)} т/мин. Нужны ${bulkFeedCount} одновременно подключённых линий по ${s.bulkUnloadTmin} т/мин; темп и давление разгрузки подтвердить с учётом рукавов, высоты и компрессора. Сухие химические добавки, перевозимые отдельно, требуют отдельной ведомости.`);
  }
  if(!onePumpOutMeetsPeak) notes.push(`При отказе одного насоса рабочая группа даст около ${onePumpOutRateLps.toFixed(1)} л/с вместо ${peakAt.rateLps.toFixed(1)} л/с в критической точке. Резервные машины показаны отдельно; переключение не считается мгновенным.`);
  if(pumps===2) notes.push('Два насоса на одном шасси не являются независимым резервом при отказе общей смесительной системы, питания или манифольда.');
  if (maxSurf*1.5 > s.unitMaxPressureMPa) notes.push("Полуторакратное ожидаемое давление выше предела выбранного агрегата. Показанное ограниченное давление испытания не подтверждает достаточную опрессовку; нужен отдельный насос / согласованный регламент и паспорт обвязки.");
  if (overPressure) notes.push(`Давление на устье ${maxSurf.toFixed(1)} МПа выше паспортного для ${s.unitName} (${s.unitMaxPressureMPa} МПа) — нужен агрегат более высокого давления или снижение расхода.`);
  if (peak > 4) notes.push(`Требуется ${peak} агрегатов одновременно — проверить возможность обвязки и места на кустовой площадке; рассмотреть снижение расхода продавки.`);
  if (cementRate > mixingSystems * s.mixRatePerPairLps * 0.95) notes.push("Темп затворения на пределе возможностей смесительных пар — контролировать плотность особенно тщательно.");
  notes.push("Испытание нагнетательных линий — на полуторакратное ожидаемое рабочее давление (практика; уточнить по регламенту предприятия).");

  return {
    scheme, feasible, mixingSystems, workingPumps: unitsWorking*pumps, dryFeedTmin, bulkPayloadT, bulkStockCount, bulkFeedCount, bulkTrucks, onePumpOutRateLps, onePumpOutMeetsPeak,
    unitRateAt, peakUnitsHydraulic: peak, peakAt, unitsForMixing, unitsWorking, unitsTotal, mixers, blendT,
    peakHydPowerKW: peakPower, overPressure, maxSurfaceMPa: maxSurf, waterM3, tankers,
    equipment, personnel, timeline, unitsProfile, lineTestMPa, notes,
  };
}

/** Strict finite values prevent Infinity quantities and broken restored jobs. */
export function normalizeLogisticsSettings(value: unknown): LogisticsSettings {
 const o=value&&typeof value==='object'?value as Record<string,unknown>:{};
 const r={...DEFAULT_LOGISTICS} as LogisticsSettings;
 for(const key of ['unitName','mixerName','manufacturer'] as const)if(typeof o[key]==='string')r[key]=o[key] as string;
 for(const key of ['unitPowerKW','unitMaxPressureMPa','unitMaxRateLps','mixerCapacityT','mixRatePerPairLps','tankerM3','bulkVolumeM3','bulkPayloadT','bulkDensityTm3','bulkUnloadTmin','maxBulkConnections'] as const){const v=o[key];if(typeof v==='number'&&Number.isFinite(v)&&v>0)r[key]=v;}
 for(const key of ['reserveUnits','rigUpMin','rigDownMin'] as const){const v=o[key];if(typeof v==='number'&&Number.isFinite(v)&&v>=0)r[key]=key==='reserveUnits'?Math.ceil(v):v;}
 r.scheme=typeof o.scheme==='string'&&o.scheme in FLEET_SCHEMES?o.scheme as FleetScheme:'classic';
 r.pumpsPerUnit=o.pumpsPerUnit===2?2:1;
 if(r.scheme==='twin')r.pumpsPerUnit=2;
 if(r.scheme==='single'||r.scheme==='mixer-ca')r.pumpsPerUnit=1;
 r.maxBulkConnections=Math.max(1,Math.floor(r.maxBulkConnections!));
 r.passportConfirmed=o.passportConfirmed===true;r.closedMixing=o.closedMixing===true;
 if(Array.isArray(o.pumpCurve))r.pumpCurve=o.pumpCurve.filter((x): x is {pressureMPa:number;rateLps:number}=>!!x&&typeof x==='object'&&Number.isFinite(x.pressureMPa)&&x.pressureMPa>0&&Number.isFinite(x.rateLps)&&x.rateLps>0).map(x=>({pressureMPa:x.pressureMPa,rateLps:x.rateLps}));
 return r;
}
