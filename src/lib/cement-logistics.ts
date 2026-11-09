import { calculateCement } from './cementing-calculations';
import { FLEET_SCHEMES, type FleetScheme } from './cement-fleet-catalog';
import type { PressureProfileResult, MaterialSummary, SlurryInput } from './cementing-calculations';
export interface LogisticsSettings {
  scheme?:FleetScheme; manufacturer?:string; pumpsPerUnit?:number; passportConfirmed?:boolean; closedMixing?:boolean;
  bulkVolumeM3?:number; bulkPayloadT?:number; bulkDensityTm3?:number; bulkUnloadTmin?:number; maxBulkConnections?:number;
  pumpCurve?:{pressureMPa:number;rateLps:number}[];
  unitName:string;unitPowerKW:number;unitMaxPressureMPa:number;unitMaxRateLps:number;
  mixerName:string;mixerCapacityT:number;mixRatePerPairLps:number;
  tankerM3:number;reserveUnits:number;rigUpMin:number;rigDownMin:number;
  waterSource?:'rig'|'tankers';
  supportUnitName?:string;supportPowerKW?:number;supportMaxPressureMPa?:number;supportMaxRateLps?:number;
  equipmentQuantities?:Record<string,number>;personnelQuantities?:Record<string,number>;
}
export const DEFAULT_LOGISTICS:LogisticsSettings={scheme:'classic',unitName:'ЦА-320',unitPowerKW:100,unitMaxPressureMPa:32,unitMaxRateLps:23,
  mixerName:'СМН-20',mixerCapacityT:20,mixRatePerPairLps:12,pumpsPerUnit:1,bulkVolumeM3:25,bulkPayloadT:30,bulkDensityTm3:1.2,bulkUnloadTmin:1.1,maxBulkConnections:2,
  tankerM3:10,reserveUnits:1,rigUpMin:90,rigDownMin:60,waterSource:'rig',supportUnitName:'ЦА-320',supportPowerKW:100,supportMaxPressureMPa:32,supportMaxRateLps:23};
export interface FleetEquipment {id:string;name:string;count:number;recommendedCount:number;note:string;vehicle:boolean;}
export interface FleetPersonnel {id:string;role:string;count:number;recommendedCount:number;}
export interface LogisticsResult {
  scheme:FleetScheme;feasible:boolean;mixingSystems:number;workingPumps:number;
  dryFeedTmin:number;bulkPayloadT:number;bulkStockCount:number;bulkFeedCount:number;bulkTrucks:number;
  onePumpOutRateLps:number;onePumpOutMeetsPeak:boolean;unitRateAt:(p:number)=>number;
  peakUnitsHydraulic:number;peakAt:{stage:string;time:number;rateLps:number;pressureMPa:number};
  unitsForMixing:number;unitsWorking:number;unitsTotal:number;mixers:number;blendT:number;peakHydPowerKW:number;overPressure:boolean;maxSurfaceMPa:number;
  waterM3:number;tankers:number;equipment:FleetEquipment[];personnel:FleetPersonnel[];
  timeline:{step:string;durationMin:number;startMin:number}[];unitsProfile:{time:number;units:number;stage:string}[];lineTestMPa:number;notes:string[];
  mainUnits:number;supportUnits:number;mixingCA:number;dischargeUnits:number;requiresManifold:boolean;reserveCA:number;totalVehicles:number;totalPeople:number;
}
const ceil=(v:number)=>Math.max(0,Math.ceil(v-1e-9));
export function normalizeLogisticsSettings(value:unknown):LogisticsSettings {
  const o=value&&typeof value==='object'?value as Record<string,unknown>:{},r={...DEFAULT_LOGISTICS};
  for(const key of ['unitName','mixerName','manufacturer','supportUnitName'] as const)if(typeof o[key]==='string')r[key]=o[key] as string;
  for(const key of ['unitPowerKW','unitMaxPressureMPa','unitMaxRateLps','mixerCapacityT','mixRatePerPairLps','tankerM3','bulkVolumeM3','bulkPayloadT','bulkDensityTm3','bulkUnloadTmin','maxBulkConnections','supportPowerKW','supportMaxPressureMPa','supportMaxRateLps'] as const){const v=o[key];if(typeof v==='number'&&Number.isFinite(v)&&v>0)r[key]=v;}
  for(const key of ['reserveUnits','rigUpMin','rigDownMin'] as const){const v=o[key];if(typeof v==='number'&&Number.isFinite(v)&&v>=0)r[key]=key==='reserveUnits'?Math.ceil(v):v;}
  r.scheme=typeof o.scheme==='string'&&o.scheme in FLEET_SCHEMES?o.scheme as FleetScheme:'classic';
  if(r.scheme==='single'||r.scheme==='twin')r.reserveUnits=Math.max(1,r.reserveUnits);
  r.pumpsPerUnit=r.scheme==='twin'?2:1;r.maxBulkConnections=Math.max(1,Math.floor(r.maxBulkConnections!));
  r.waterSource=o.waterSource==='tankers'?'tankers':'rig';r.passportConfirmed=o.passportConfirmed===true;r.closedMixing=o.closedMixing===true;
  if(Array.isArray(o.pumpCurve))r.pumpCurve=o.pumpCurve.filter((x):x is {pressureMPa:number;rateLps:number}=>!!x&&typeof x==='object'&&Number.isFinite(x.pressureMPa)&&x.pressureMPa>0&&Number.isFinite(x.rateLps)&&x.rateLps>0).map(x=>({...x}));
  const counts=(v:unknown)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).filter(([k,n])=>/^[a-z][a-z0-9-]*$/.test(k)&&typeof n==='number'&&Number.isFinite(n)&&n>=0).map(([k,n])=>[k,Math.min(500,Math.round(n as number))])):{};
  r.equipmentQuantities=counts(o.equipmentQuantities);r.personnelQuantities=counts(o.personnelQuantities);
  return r;
}
export function planLogistics(pressure:PressureProfileResult,materials:MaterialSummary,slurries:SlurryInput[],settings:LogisticsSettings=DEFAULT_LOGISTICS):LogisticsResult {
  const s=normalizeLogisticsSettings(settings),scheme=s.scheme!,classic=scheme==='classic',integrated=scheme==='single'||scheme==='twin';
  const envelope=(power:number,limit:number,rate:number,p:number)=>p>limit?0:Math.min(rate,p>.1?power/p:rate);
  const unitRateAt=(p:number)=>{let q=envelope(s.unitPowerKW,s.unitMaxPressureMPa,s.unitMaxRateLps,p);if(s.pumpCurve?.length){const available=s.pumpCurve.filter(x=>x.pressureMPa>=p);q=Math.min(q,available.length?Math.max(...available.map(x=>x.rateLps)):0);}return q;};
  const supportAt=(p:number)=>envelope(s.supportPowerKW!,s.supportMaxPressureMPa!,s.supportMaxRateLps!,p);
  const qty=(id:string,n:number,min=0)=>Math.max(min,s.equipmentQuantities?.[id]??n);
  const cementRate=Math.max(0,...slurries.flatMap(sl=>sl.flowRateSteps.map(st=>st.rateLps)));
  const unitsForMixing=ceil(cementRate/s.mixRatePerPairLps);
  const blendT=materials.cementItems.filter(c=>c.unit==='т').reduce((t,c)=>t+c.amount,0);
  const dryFeedTmin=Math.max(0,...slurries.map(sl=>{const y=calculateCement(1,sl.density,sl.waterRatio,sl.yieldPerTon).yieldPerTon;return y>0?Math.max(0,...sl.flowRateSteps.map(x=>x.rateLps))*.06/y:0;}));
  const bulkPayloadT=Math.min(s.bulkPayloadT!,s.bulkVolumeM3!*s.bulkDensityTm3!);
  const bulkStockCount=!classic&&blendT>0?ceil(blendT/bulkPayloadT):0,bulkFeedCount=classic?0:ceil(dryFeedTmin/s.bulkUnloadTmin!);
  const recommendedMixing=classic?unitsForMixing:Math.max(unitsForMixing,ceil(bulkFeedCount/s.maxBulkConnections!));
  let peak=0,maxSurf=0,peakPower=0,peakRatio=0,peakAt={stage:'-',time:0,rateLps:0,pressureMPa:0};
  for(const p of pressure.points){const pressureMPa=Math.max(0,p.surfacePressure),cap=unitRateAt(pressureMPa);maxSurf=Math.max(maxSurf,pressureMPa);peakPower=Math.max(peakPower,p.pumpRateLps*pressureMPa);
    const n=p.pumpRateLps>0&&cap>0?ceil(p.pumpRateLps/cap):0,ratio=cap>0?p.pumpRateLps/cap:Infinity;
    if(p.pumpRateLps>0&&(n>peak||ratio>peakRatio)){peak=Math.max(peak,n);peakRatio=ratio;peakAt={stage:p.stage,time:p.time,rateLps:p.pumpRateLps,pressureMPa};}}
  const mainRecommended=integrated?Math.max(1,recommendedMixing):Math.max(1,peak);
  const mainUnits=qty('main',mainRecommended);
  let supportRecommended=0,unavailable=false;
  for(const p of pressure.points){if(p.pumpRateLps<=0)continue;const deficit=Math.max(0,p.pumpRateLps-mainUnits*unitRateAt(Math.max(0,p.surfacePressure)));
    if(deficit>1e-6){const cap=supportAt(Math.max(0,p.surfacePressure));if(!integrated||cap<=0)unavailable=true;else supportRecommended=Math.max(supportRecommended,ceil(deficit/cap));}}
  const supportUnits=integrated?qty('support-ca',supportRecommended):0;
  const reserveCA=qty('reserve-ca',s.reserveUnits,integrated?1:0);
  const mixersRecommended=integrated?0:classic?ceil(blendT/s.mixerCapacityT):recommendedMixing;
  const mixingCA=classic?qty('blend-ca',Math.max(cementRate>0?1:0,unitsForMixing)):0;
  const mixers=integrated?0:qty('mixer',mixersRecommended),mixingSystems=integrated?mainUnits:classic?(mixers>0?mixingCA:0):mixers;
  const dischargeUnits=mainUnits+supportUnits,requiresManifold=classic||dischargeUnits>1;
  const manifoldCount=qty('manifold',requiresManifold?1:0),averagingCount=qty('averaging',classic?1:0);
  const bulkTrucks=classic?0:qty('bulk',Math.max(bulkStockCount,bulkFeedCount));
  const waterM3=materials.waterTotal,tankers=s.waterSource==='tankers'?qty('water',ceil(waterM3/s.tankerM3)):0;
  const unitsProfile=pressure.points.map(p=>{const cap=unitRateAt(Math.max(0,p.surfacePressure)),deficit=Math.max(0,p.pumpRateLps-mainUnits*cap),aux=supportAt(Math.max(0,p.surfacePressure));return{time:p.time,stage:p.stage,units:p.pumpRateLps<=0?0:integrated?mainUnits+(aux>0?ceil(deficit/aux):0):cap>0?ceil(p.pumpRateLps/cap):0};});
  for(const p of pressure.points)if(p.pumpRateLps>mainUnits*unitRateAt(Math.max(0,p.surfacePressure))+supportUnits*supportAt(Math.max(0,p.surfacePressure))+1e-6)unavailable=true;
  const mixingOK=cementRate<=mixingSystems*s.mixRatePerPairLps+1e-6;
  const bulkOK=classic?mixers*s.mixerCapacityT>=blendT-1e-6:(bulkTrucks>=bulkStockCount&&bulkTrucks*s.bulkUnloadTmin!>=dryFeedTmin-1e-6&&mixingSystems*s.maxBulkConnections!>=bulkFeedCount);
  const waterOK=s.waterSource!=='tankers'||tankers*s.tankerM3>=waterM3-1e-6;
  const processOK=(!classic||averagingCount>0)&&(!requiresManifold||manifoldCount>0);
  const feasible=!unavailable&&mixingOK&&bulkOK&&waterOK&&processOK;
  const mainCapacity=unitRateAt(peakAt.pressureMPa),auxCapacity=supportAt(peakAt.pressureMPa);
  const onePumpOutRateLps=Math.max(0,mainUnits*mainCapacity+supportUnits*auxCapacity-Math.max(mainUnits>0?mainCapacity/s.pumpsPerUnit!:0,supportUnits>0?auxCapacity:0));
  const equipment:FleetEquipment[]=[];
  const add=(id:string,name:string,count:number,recommendedCount:number,note:string,vehicle=true)=>equipment.push({id,name,count,recommendedCount,note,vehicle});
  add('main',`${integrated?'Цементировочный агрегат со встроенным миксером':'Цементировочный агрегат'} ${integrated?(s.manufacturer??'')+' ':''}${s.unitName}`,mainUnits,mainRecommended,integrated?`${s.pumpsPerUnit} насос(а) и встроенный миксер на одном шасси; экипаж 2 человека, они же водители.`:'Нагнетательные ЦА: откачка готового раствора, отдельно от ЦА затворения и резерва.');
  if(classic)add('blend-ca',`ЦА затворения ${s.unitName}`,mixingCA,Math.max(cementRate>0?1:0,unitsForMixing),'Отдельные ЦА подают воду через штуцер воронки и затворяют раствор в осреднительную ёмкость; в нагнетательную подачу на скважину не включаются.');
  if(integrated)add('support-ca',`Дополнительный рабочий ЦА ${s.supportUnitName}`,supportUnits,supportRecommended,'Добавляется при недостатке насосной подачи. Не увеличивает производительность встроенного миксера.');
  add('reserve-ca',`Резервный ЦА ${integrated?s.supportUnitName:s.unitName}`,reserveCA,s.reserveUnits>0?s.reserveUnits:integrated?1:0,integrated?'Обязателен минимум один отдельный ЦА; в текущую рабочую подачу не включается.':'Отдельная резервная машина; не включается в рабочую подачу.');
  if(!integrated)add('mixer',classic?`Смесительная машина ${s.mixerName}`:`Автономный миксер ${s.mixerName}`,mixers,mixersRecommended,classic?'СМН перевозят и подают сухой цемент в воронку. Вода к СМН не подводится. Число СМН определяется запасом цемента, а не числом ЦА затворения.':'Беспылевой миксер принимает сухой цемент из цементовозов и воду; готовый раствор откачивают отдельные ЦА.');
  if(!classic)add('bulk',`Цементовоз ЦТ-25 (${s.bulkVolumeM3} м³) с тягачом`,bulkTrucks,Math.max(bulkStockCount,bulkFeedCount),`Автопоезд: полуприцеп и тягач считаются одной единицей; один водитель-оператор. Загрузка до ${bulkPayloadT.toFixed(1)} т; по запасу ${bulkStockCount}, по темпу ${bulkFeedCount}.`);
  add('skc','СКЦ - бортовой автомобиль с будкой',qty('skc',1,1),1,'Обязательная отдельная машина во всех схемах. Встроенная регистрация агрегата её не заменяет.');
  add('manifold','Блок манифольдов на автомобиле',manifoldCount,requiresManifold?1:0,requiresManifold?'Объединяет нагнетательные линии ЦА в одну линию к цементировочной головке.':'У одной интегрированной машины манифольд встроен; отдельный блок не требуется.',true);
  if(s.waterSource==='tankers')add('water',`Автоцистерна воды ${s.tankerM3} м³`,tankers,ceil(waterM3/s.tankerM3),'Доставка воды; не подача цемента в скважину.');
  add('averaging','Осреднительная ёмкость на автомобиле',averagingCount,classic?1:0,'Принимает раствор после воронки затворения; нагнетательные ЦА откачивают из неё. Отдельная транспортная единица.',true);
  const personnel:FleetPersonnel[]=[];
  const person=(id:string,role:string,n:number)=>personnel.push({id,role,count:Math.max((integrated&&(id==='main-operator'||id==='main-helper'))||id==='bulk-operator'?n:0,s.personnelQuantities?.[id]??n),recommendedCount:n});
  person('master','Мастер по цементированию',1);person('engineer','Инженер-технолог',1);
  person('main-operator',integrated?'Оператор агрегата / водитель':'Оператор рабочего ЦА / водитель',mainUnits);
  person('main-helper',integrated?'Помощник оператора агрегата / водитель':'Помощник оператора рабочего ЦА / водитель',mainUnits);
  if(classic){person('blend-operator','Оператор ЦА затворения / водитель',mixingCA);person('blend-helper','Помощник оператора ЦА затворения / водитель',mixingCA);}
  if(manifoldCount>0)person('manifold-operator','Оператор блока манифольдов / водитель',manifoldCount);
  if(averagingCount>0)person('averaging-operator','Оператор осреднительной ёмкости / водитель',averagingCount);
  person('ca-operator','Оператор дополнительного и резервного ЦА / водитель',supportUnits+reserveCA);
  person('ca-helper','Помощник оператора дополнительного и резервного ЦА / водитель',supportUnits+reserveCA);
  if(!integrated)person('mixer-operator','Оператор отдельного смесителя / водитель',mixers);
  if(!classic)person('bulk-operator','Водитель-оператор цементовоза с тягачом',bulkTrucks);
  person('skc-operator','Оператор СКЦ / водитель',qty('skc',1,1));
  if(s.waterSource==='tankers')person('water-driver','Водитель автоцистерны',tankers);
  const notes:string[]=[];
  if(unavailable)notes.push('Выбранное количество рабочих машин не обеспечивает Q-P. Параллельное включение не повышает допустимое давление; резервный ЦА в текущую подачу не включён.');
  if(!mixingOK)notes.push(classic?'Не хватает производительности ЦА затворения через воронку. Увеличьте их количество или снизьте темп затворения.':'Не хватает производительности смешивания. Дополнительный ЦА не заменяет миксер: увеличьте число основных машин / миксеров либо снизьте темп затворения.');
  if(!processOK)notes.push('Неполная технологическая цепочка: для классики нужна осреднительная ёмкость; для объединения нагнетательных линий нужен блок манифольдов.');
  if(!bulkOK)notes.push(classic?'Не хватает запаса сухого цемента в выбранных СМН.':'Не обеспечен запас или непрерывная пневмоподача сухого материала: проверьте число автопоездов и входов смесителя.');
  if(!waterOK)notes.push('Выбранные автоцистерны не обеспечивают рассчитанный запас воды.');
  if(!s.passportConfirmed&&!classic)notes.push('Q-P - редактируемый расчётный шаблон. Для подтверждения режима внесите характеристики фактической машины.');
  if(integrated)notes.push('У одно- и двухнасосного агрегата миксер встроен: отдельная смесительная машина, шасси и её экипаж не добавляются. Минимум один резервный ЦА обязателен.');
  if(integrated&&supportRecommended>0)notes.push(`Для повышения насосной подачи требуется ${supportRecommended} рабочий ЦА ${s.supportUnitName} дополнительно к обязательному резерву.`);
  if(integrated&&maxSurf>s.supportMaxPressureMPa!)notes.push('Предел давления резервного ЦА ниже максимального давления операции; он не заменяет основную машину на всех режимах.');
  for(const p of personnel)if(p.count<p.recommendedCount)notes.push(`${p.role}: вручную принято ${p.count}, расчётная потребность ${p.recommendedCount}; подтвердите распределение обязанностей.`);
  if(!onePumpOutRateLps||onePumpOutRateLps<peakAt.rateLps-1e-6)notes.push('При отказе одного нагнетательного насоса пиковая подача не сохраняется; включение резервной машины требует переключения обвязки.');
  if(s.pumpsPerUnit===2)notes.push('Два насоса на общем шасси не являются независимым резервом при отказе миксера, питания или общего манифольда.');
  if(classic)notes.push('Классика: СМН подают только сухой цемент в воронку. ЦА затворения подают воду через штуцер воронки в осреднительную ёмкость. Отдельные нагнетательные ЦА откачивают из ёмкости в блок манифольдов, далее одна линия идёт к скважине.');
  else notes.push(s.waterSource==='rig'?`Вода ${waterM3.toFixed(1)} м³ поступает с буровой в смесительную систему. Готовый раствор откачивается нагнетательными машинами; отдельный блок манифольдов нужен при объединении нескольких рабочих машин.`:'Вода поступает из выбранных автоцистерн в смеситель; цементный раствор закачивается через манифольд в скважину.');
  const lineTestMPa=Math.min(s.unitMaxPressureMPa,Math.ceil(maxSurf*1.5));
  if(maxSurf*1.5>s.unitMaxPressureMPa)notes.push('Полуторакратное рабочее давление выше предела основного агрегата: ограниченное значение испытания не подтверждает достаточность опрессовки обвязки.');
  const timeline:LogisticsResult['timeline']=[];let t=0;
  for(const [step,d] of [['Расстановка техники, обвязка, инструктаж',s.rigUpMin],[`Испытание нагнетательных линий на ${lineTestMPa} МПа`,15],['Закачка буферов, затворение цемента и продавка',pressure.points.at(-1)?.time??0],['Проверка обратного клапана, сброс давления',15],['Промывка и демонтаж обвязки',s.rigDownMin]] as [string,number][]){timeline.push({step,durationMin:d,startMin:t});t+=d;}
  const unitsWorking=mainUnits+supportUnits+mixingCA;
  return{scheme,feasible,mixingSystems,workingPumps:mainUnits*s.pumpsPerUnit!+supportUnits+mixingCA,dryFeedTmin,bulkPayloadT,bulkStockCount,bulkFeedCount,bulkTrucks,onePumpOutRateLps,onePumpOutMeetsPeak:onePumpOutRateLps>=peakAt.rateLps-1e-6,unitRateAt,peakUnitsHydraulic:peak,peakAt,unitsForMixing,unitsWorking,unitsTotal:unitsWorking+reserveCA,mixers,blendT,peakHydPowerKW:peakPower,overPressure:maxSurf>s.unitMaxPressureMPa,maxSurfaceMPa:maxSurf,waterM3,tankers,equipment,personnel,timeline,unitsProfile,lineTestMPa,notes,mainUnits,supportUnits,mixingCA,dischargeUnits,requiresManifold,reserveCA,totalVehicles:equipment.filter(x=>x.vehicle).reduce((sum,x)=>sum+x.count,0),totalPeople:personnel.reduce((sum,x)=>sum+x.count,0)};
}
