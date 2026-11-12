import type {PlugHydraulics} from './plug-pressure';
/** Reduced horizontal two-chamber sealed-piston benchmark. Not a well-job simulator. */
export interface MovingPlugCase {
 diameterMm:number;totalLengthM:number;initialXM:number;seatXM:number;
 rhoBackKgM3:number;rhoAheadKgM3:number;bulkBackMPa:number;bulkAheadMPa:number;
 outletMPa:number;breakawayMPa:number;dragMPaPerMps:number;outletResistanceMPaPerM3s:number;
 rateLps:number;durationSec:number;stepSec:number;
}
export const MOVING_PLUG_FIELDS:readonly (readonly [keyof MovingPlugCase,string])[]=[['diameterMm','Диаметр стенда, мм'],['totalLengthM','Длина стенда, м'],['initialXM','Начальное положение, м'],['seatXM','Положение упора, м'],['rhoBackKgM3','Плотность сзади при 0 МПа, кг/м³'],['rhoAheadKgM3','Плотность впереди при 0 МПа, кг/м³'],['bulkBackMPa','K сзади, МПа'],['bulkAheadMPa','K впереди, МПа'],['outletMPa','Давление выхода, МПа изб.'],['breakawayMPa','Порог сдвига / трение скольжения, МПа'],['dragMPaPerMps','Вязкое сопротивление поршня, МПа/(м/с)'],['outletResistanceMPaPerM3s','Сопротивление выхода, МПа/(м³/с)'],['rateLps','Подача при 0 МПа, л/с'],['durationSec','Время прогона, с'],['stepSec','Максимальный шаг, с']];
export const movingPlugReference=():MovingPlugCase=>({diameterMm:100,totalLengthM:100,initialXM:5,seatXM:90,rhoBackKgM3:1000,rhoAheadKgM3:1000,bulkBackMPa:2000,bulkAheadMPa:2000,outletMPa:1,breakawayMPa:0,dragMPaPerMps:0,outletResistanceMPaPerM3s:0,rateLps:1,durationSec:670,stepSec:5});
export function normalizeMovingPlugCase(value:unknown):MovingPlugCase|undefined{if(!value||typeof value!=='object'||Array.isArray(value))return undefined;const v=value as Record<string,unknown>;return Object.fromEntries(MOVING_PLUG_FIELDS.map(([key])=>[key,typeof v[key]==='number'&&Number.isFinite(v[key])?v[key]:-1])) as unknown as MovingPlugCase;}
export interface PlugState {timeSec:number;xM:number;backMassKg:number;aheadMassKg:number;backMPa:number;aheadMPa:number;injectedKg:number;returnedKg:number;landed:boolean}
export interface PlugSample extends PlugState {velocityMps:number;massResidualKg:number;forceResidualMPa:number}
export interface PlugSpatialFrame {timeSec:number;xM:number;facesM:number[];massKg:number[];fractions:number[][]}
export interface PlugSpatialResult {status:'complete'|'stopped';reason:string;cellsPerChamber:number;switchSec:number;frames:PlugSpatialFrame[];initialKg:number[];injectedKg:number[];returnedKg:number[];retainedKg:number[];maxComponentResidualKg:number;maxGeometricResidualM3:number;acceptedSteps:number}
export interface MovingPlugResult {hydraulics?:PlugHydraulics;spatial?:PlugSpatialResult;model:'sealed-piston-bench-v1';input:MovingPlugCase;status:'complete'|'stopped';reason:string;landingTimeSec:number|null;samples:PlugSample[];maxMassResidualKg:number;limitations:string[]}
const area=(p:MovingPlugCase)=>Math.PI*(p.diameterMm/1000)**2/4;
function rho(ref:number,k:number,pressure:number){if(!Number.isFinite(pressure)||pressure<0||Math.abs(pressure/k)>.1)throw new Error('Выход за область EOS: P ≥ 0 и P/K ≤ 10%.');return ref*Math.exp(pressure/k);}
function validate(p:MovingPlugCase){const a=area(p);if(![a,a*p.totalLengthM,a*p.initialXM,a*(p.totalLengthM-p.seatXM),a*p.totalLengthM*Math.max(p.rhoBackKgM3,p.rhoAheadKgM3),p.rateLps/1000*p.rhoBackKgM3].every(Number.isFinite)||!(a>0&&a*p.initialXM>0&&a*(p.totalLengthM-p.seatXM)>0))throw new Error('Невыразимая геометрия или масса стенда.');if(MOVING_PLUG_FIELDS.some(([k])=>!Number.isFinite(p[k]))||!(p.diameterMm>0&&p.totalLengthM>0&&p.initialXM>0&&p.seatXM>p.initialXM&&p.seatXM<p.totalLengthM&&p.rhoBackKgM3>0&&p.rhoAheadKgM3>0&&p.bulkBackMPa>0&&p.bulkAheadMPa>0&&p.outletMPa>=0&&p.breakawayMPa>=0&&p.dragMPaPerMps>=0&&p.outletResistanceMPaPerM3s>=0&&p.rateLps>=0&&p.durationSec>0&&p.stepSec>0&&p.durationSec/p.stepSec<=1000))throw new Error('Нужны положительные геометрия/K/плотности, 0 < x₀ < упор < длина, неотрицательные сопротивления/расход/давление и не более 1000 назначенных шагов.');}
export function initializePlug(p:MovingPlugCase):PlugState {validate(p);const a=area(p);return {timeSec:0,xM:p.initialXM,backMassKg:a*p.initialXM*rho(p.rhoBackKgM3,p.bulkBackMPa,p.outletMPa),aheadMassKg:a*(p.totalLengthM-p.initialXM)*rho(p.rhoAheadKgM3,p.bulkAheadMPa,p.outletMPa),backMPa:p.outletMPa,aheadMPa:p.outletMPa,injectedKg:0,returnedKg:0,landed:false};}
/** Backward Euler chamber balance + quasi-static forward-only force complementarity. */
export function advancePlug(p:MovingPlugCase,old:PlugState,requestedDt:number):{sample:PlugSample;dt:number}{
 if(!(requestedDt>0&&Number.isFinite(requestedDt)))throw new Error('Недопустимый шаг поршня.');
 const a=area(p),sourceKgS=p.rateLps/1000*p.rhoBackKgM3;
 const evaluate=(x:number,dt:number)=>{
  const backMassKg=old.backMassKg+sourceKgS*dt,backMPa=p.bulkBackMPa*Math.log(backMassKg/(p.rhoBackKgM3*a*x)),va=a*(p.totalLengthM-x),r=p.outletResistanceMPaPerM3s;
  let aheadMPa=p.outletMPa,returned=0;
  if(r===0)returned=old.aheadMassKg-p.rhoAheadKgM3*Math.exp(aheadMPa/p.bulkAheadMPa)*va;
  else{
   let lo=p.outletMPa,hi=Math.max(lo,p.bulkAheadMPa*Math.log(old.aheadMassKg/(p.rhoAheadKgM3*va)));
   for(let i=0;i<52;i++){const mid=(lo+hi)/2,mass=p.rhoAheadKgM3*Math.exp(mid/p.bulkAheadMPa)*(va+dt*Math.max(0,(mid-p.outletMPa)/r));if(mass>old.aheadMassKg)hi=mid;else lo=mid;}
   aheadMPa=(lo+hi)/2;returned=dt*p.rhoAheadKgM3*Math.exp(aheadMPa/p.bulkAheadMPa)*Math.max(0,(aheadMPa-p.outletMPa)/r);
  }
  const aheadMassKg=p.rhoAheadKgM3*Math.exp(aheadMPa/p.bulkAheadMPa)*va,v=(x-old.xM)/dt,force=backMPa-aheadMPa-p.breakawayMPa-p.dragMPaPerMps*v;
  return {x,dt,backMassKg,aheadMassKg,backMPa,aheadMPa,returned,v,force};
 };
 let dt=requestedDt,hit=old.landed,candidate=evaluate(old.xM,dt);
 if(!old.landed&&candidate.force>1e-12){
  const atSeat=evaluate(p.seatXM,dt);
  if(atSeat.force>=0){let lo=0,hi=dt;for(let i=0;i<52;i++){const mid=(lo+hi)/2;if(evaluate(p.seatXM,mid).force>=0)hi=mid;else lo=mid;}dt=(lo+hi)/2;candidate=evaluate(p.seatXM,dt);hit=true;}
  else{let lo=old.xM,hi=p.seatXM;for(let i=0;i<52;i++){const mid=(lo+hi)/2;if(evaluate(mid,dt).force>0)lo=mid;else hi=mid;}candidate=evaluate((lo+hi)/2,dt);}
 }
 if(!(dt>1e-9))throw new Error('Событие требует шага короче 1 нс; уточните исходный сценарий.');
 const c=candidate;rho(p.rhoBackKgM3,p.bulkBackMPa,c.backMPa);rho(p.rhoAheadKgM3,p.bulkAheadMPa,c.aheadMPa);
 const residual=c.backMassKg+c.aheadMassKg+c.returned-old.backMassKg-old.aheadMassKg-sourceKgS*dt;
 if(c.returned< -1e-7||Math.abs(residual)>1e-7*Math.max(1,old.backMassKg+old.aheadMassKg))throw new Error('Баланс камер поршня не сошёлся.');
 if((!hit&&c.v>1e-9||hit&&!old.landed)&&Math.abs(c.force)>1e-7)throw new Error('Силовой баланс поршня не сошёлся.');
 return {dt,sample:{timeSec:old.timeSec+dt,xM:c.x,backMassKg:c.backMassKg,aheadMassKg:c.aheadMassKg,backMPa:c.backMPa,aheadMPa:c.aheadMPa,injectedKg:old.injectedKg+sourceKgS*dt,returnedKg:old.returnedKg+Math.max(0,c.returned),landed:hit,velocityMps:c.v,massResidualKg:residual,forceResidualMPa:hit?0:c.v>1e-9?c.force:Math.max(0,c.force)}};
}
export function simulateMovingPlug(input:MovingPlugCase,breakpointsSec:number[]=[]):MovingPlugResult {
 const p=normalizeMovingPlugCase(input)??Object.fromEntries(MOVING_PLUG_FIELDS.map(([key])=>[key,-1])) as unknown as MovingPlugCase,r:MovingPlugResult={model:'sealed-piston-bench-v1',input:p,status:'stopped',reason:'',landingTimeSec:null,samples:[],maxMassResidualKg:0,limitations:[
 'Проверочный горизонтальный стенд: постоянный диаметр, две однородные изотермические камеры и герметичный поршень нулевой толщины. Параметры независимы от проекта скважины.',
 'Давления, массы и положение связаны через EOS и силовой баланс. Поршень движется только вперёд; масса/инерция поршня, гравитация, утечки, срез и гидроудар отсутствуют. Трение задано пользователем, не паспортом реальной пробки.',
 'Посадка вычислена как достижение заданного упора. После неё поршень удерживается реакцией упора, подача накапливается сзади; нулевая силовая невязка после посадки означает исключение уравнения свободного движения, не отсутствие реакции.',
 'Это самостоятельная двухкамерная модель для проверки механического ядра. Она не подключена как прогноз посадки к многофазному 1D-переносу или производственной программе цементирования. Упругость труб и проверка допустимых давлений не включены.'
 ]};
 try{if(breakpointsSec.length>2||breakpointsSec.some(t=>!Number.isFinite(t)||t<0||t>p.durationSec))throw new Error('Недопустимый момент смены метки.');let state=initializePlug(p);r.samples.push({...state,velocityMps:0,massResidualKg:0,forceResidualMPa:0});
  while(state.timeSec<p.durationSec-1e-8){if(r.samples.length>1004)throw new Error('Превышен лимит шагов стенда.');const step=advancePlug(p,state,Math.min(p.stepSec,p.durationSec-state.timeSec,...breakpointsSec.filter(t=>t>state.timeSec+1e-8).map(t=>t-state.timeSec)));state=step.sample;if(state.landed&&r.landingTimeSec===null)r.landingTimeSec=state.timeSec;r.samples.push(step.sample);r.maxMassResidualKg=Math.max(r.maxMassResidualKg,Math.abs(step.sample.massResidualKg));}
  r.status='complete';r.reason=r.landingTimeSec===null?'Стенд рассчитан; упор за назначенное время не достигнут.':'Стенд рассчитан; момент достижения упора найден решением движения.';
 }catch(e){r.reason=e instanceof Error?e.message:String(e);}return r;
}
export function movingPlugCsv(r:MovingPlugResult){return 'status;time_s;x_m;velocity_m_s;p_back_mpa;p_ahead_mpa;injected_kg;returned_kg;landed;mass_residual_kg\n'+r.samples.map(p=>[r.status,p.timeSec,p.xM,p.velocityMps,p.backMPa,p.aheadMPa,p.injectedKg,p.returnedKg,p.landed,p.massResidualKg].join(';')).join('\n');}
