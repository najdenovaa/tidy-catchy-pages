/** Casing running: each broomstick point is a NEW bottom-to-top equilibrium.
 * Soft-string force balance: Johancsik et al.; survey angles in radians, forces kN.
 * No hard-string, pressure-end force, surge/swab or buckling certification is implied.
 */
import type { WellData, TrajectoryPoint } from './cementing-calculations';
import type { CentralizerInterval, TurbulatorPoint } from './centralization-calculations';
import { buildCentralizerJointSchedule } from './cementing-report-data';

export const RUNNING_SOURCES = [
  'https://repository.tudelft.nl/file/File_c5ba4514-0fe1-422f-ab84-4a265ed9c184?preview=1',
  'https://www.slb.com/resource-library/technical-paper/di/an-innovative-workflow-for-real-time-torque-and-drag-monitoring',
  'https://www.halliburton.com/en/resources/red-x-single-piece-centralizers-improve-casing-run-efficiencies',
];
export interface RunningMeasurement { md: number; mode: 'runIn' | 'pullOut'; hookTF: number; }
export interface CasingRunningSettings {
  frictionCased: number; frictionOpenhole: number; frictionSpread: number;
  speedMps: number; blockWeightKN: number; pipeWeightKgPerM: number;
  centralizerRunningKN: number; turbulatorRunningKN: number;
  maxHookKN: number; grade: 'K-55' | 'N-80' | 'P-110';
  measurements: RunningMeasurement[];
}
export function normalizeRunningSettings(value: unknown, cased = .25, open = .35): CasingRunningSettings {
  const v = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const number = (k: string, fallback: number, max: number) => typeof v[k] === 'number' && Number.isFinite(v[k]) ? Math.max(0, Math.min(max, v[k] as number)) : fallback;
  return { frictionCased: number('frictionCased', cased, 1), frictionOpenhole: number('frictionOpenhole', open, 1),
    frictionSpread: number('frictionSpread', .1, .5), speedMps: number('speedMps', .3, 3), blockWeightKN: number('blockWeightKN', 0, 1000),
    pipeWeightKgPerM: number('pipeWeightKgPerM', 0, 1000),
    centralizerRunningKN: number('centralizerRunningKN', 0, 100), turbulatorRunningKN: number('turbulatorRunningKN', 0, 100),
    maxHookKN: number('maxHookKN', 0, 10000), grade: v.grade === 'K-55' || v.grade === 'P-110' ? v.grade : 'N-80',
    measurements: Array.isArray(v.measurements) ? v.measurements.filter((m): m is RunningMeasurement => !!m && typeof m === 'object' &&
      (m.mode === 'runIn' || m.mode === 'pullOut') && Number.isFinite(m.md) && m.md > 0 && Number.isFinite(m.hookTF) && m.hookTF >= 0).slice(0, 100) : [],
  };
}
export interface CasingRunningInput {
  well: WellData; mudDensity: number; intervals: CentralizerInterval[];
  turbPoints?: TurbulatorPoint[]; pipeWeightKgPerM?: number; pv: number; yp: number;
  settings: CasingRunningSettings;
}
export interface RunningProfilePoint {
  md: number; runInKN: number; pullOutKN: number; freeKN: number;
  normalKNPerM: number; wallDragKN: number; toolDragKN: number; viscousDragKN: number;
  bendingMPa: number; combinedAxialBendingMPa: number; clearanceMM: number;
}
export interface RunningBroomPoint {
  md: number; runIn: number; pullOut: number; free: number;
  runLow: number; runHigh: number; pullLow: number; pullHigh: number;
  noTools: number; torqueKNm: number; toolCount: number;
}
export interface CasingRunningAnalysis {
  valid: boolean; errors: string[]; notes: string[]; broom: RunningBroomPoint[];
  profile: RunningProfilePoint[]; final: RunningBroomPoint | null;
  firstCompressionMD: number | null; firstCapacityMD: number | null; firstPassageConflictMD: number | null;
  maxPullKN: number; maxPullMD: number; maxBendingMPa: number; maxCombinedMPa: number;
  yieldMPa: number; internalVolumeM3: number; steelDisplacementM3: number;
  centralizerCount: number; unknownRunningCount: number;
  calibration: { deltaMu: number; rmseTF: number; count: number; atBoundary: boolean; informative: boolean } | null;
}
const G = 9.80665;
const rad = (v: number) => v * Math.PI / 180;
const deltaAngle = (a: number, b: number) => ((b - a + 540) % 360) - 180;
export function runningSurvey(traj: TrajectoryPoint[], md: number) {
  const pts = traj;
  if (!pts.length) return { zenith: 0, azimuth: 0 };
  if (md <= pts[0].md) return pts[0];
  for (let i=1; i<pts.length; i++) if (md<=pts[i].md) {
    const a=pts[i-1], b=pts[i], f=(md-a.md)/(b.md-a.md);
    return {zenith:a.zenith+f*(b.zenith-a.zenith), azimuth:a.azimuth+f*deltaAngle(a.azimuth,b.azimuth)};
  }
  return pts[pts.length-1];
}
export function runningBore(w: WellData, md: number) {
  if (md < w.prevCasingDepth && w.prevCasingID>0) return w.prevCasingID;
  const k = w.cavernIntervals?.find(x=>md>=x.fromMD&&md<x.toMD)?.coeff ?? w.cavernCoeff ?? 1;
  return w.holeDiameter*Math.sqrt(Math.max(.01,k));
}
interface Tool { targetMD: number; runningKN: number; od: number; rigid: boolean; }
function prepare(input: CasingRunningInput) {
  const {well:w,settings:s}=input;
  const schedule=buildCentralizerJointSchedule(w.casingDepthMD,input.intervals);
  const tools:Tool[]=[];let unknown=0;
  for(const row of schedule) for(const md of row.centralizerDepths) {
    const iv=input.intervals.find(x=>row.topMD>=x.fromMD&&row.topMD<x.toMD);
    if(!iv)continue;
    const p=iv.spec.passport;
    const force=p?.runningForceKgf!==undefined&&Number.isFinite(p.runningForceKgf)&&p.runningForceKgf>=0?p.runningForceKgf:undefined;
    if(force===undefined)unknown++;
    tools.push({targetMD:md,runningKN:force===undefined?s.centralizerRunningKN:force*.00980665,
      od:iv.spec.type==='spring'?(p?.ringOD??w.casingOD):(p?.outerDiameter??w.casingOD+2*iv.spec.bladeHeight),rigid:iv.spec.type!=='spring'});
  }
  const centralizerCount=tools.length;
  for(const p of input.turbPoints??[])if(p.md>0&&p.md<=w.casingDepthMD)tools.push({targetMD:p.md,runningKN:s.turbulatorRunningKN,od:w.casingOD+2*p.bladeHeight,rigid:true});
  return {tools,centralizerCount,unknown};
}
/** Position of each installed item follows the pipe during descent; targetMD is NOT its current well depth. */
function solve(input:CasingRunningInput,shoe:number,tools:Tool[],muDelta=0,profile=false,omitTools=false) {
  const {well:w,settings:s}=input;
  const length=w.casingDepthMD, shift=length-shoe;
  const active=omitTools?[]:tools.map(t=>({...t,md:t.targetMD-shift})).filter(t=>t.md>0&&t.md<=shoe);
  const bounds=new Set<number>([0,shoe]);
  for(let md=10;md<shoe;md+=10)bounds.add(md);
  for(const p of w.trajectory)if(p.md>0&&p.md<shoe)bounds.add(p.md);
  for(let i=1;i<w.trajectory.length;i++){
    const a=w.trajectory[i-1],b=w.trajectory[i];
    const n=Math.ceil(Math.max(Math.abs(b.zenith-a.zenith),Math.abs(deltaAngle(a.azimuth,b.azimuth)))/2);
    for(let j=1;j<n;j++){const md=a.md+(b.md-a.md)*j/n;if(md>0&&md<shoe)bounds.add(md);}
  }
  for(const t of active)bounds.add(t.md);
  for(const md of [w.prevCasingDepth,...(w.cavernIntervals??[]).flatMap(x=>[x.fromMD,x.toMD])])if(md>0&&md<shoe)bounds.add(md);
  for(const section of w.casingSections??[])for(const md of [section.fromMD-shift,section.toMD-shift])if(md>0&&md<shoe)bounds.add(md);
  const depths=[...bounds].sort((a,b)=>a-b);
  let minClearance=Math.min(Infinity,...active.map(t=>(runningBore(w,t.md)-t.od)/2));
  const toolAt=new Map<number,Tool[]>();
  for(const t of active){let lo=0,hi=depths.length-1;while(lo<hi){const m=(lo+hi)>>1;if(depths[m]<t.md)lo=m+1;else hi=m;}const at=depths[lo];toolAt.set(at,[...(toolAt.get(at)??[]),t]);}
  let run=0,pull=0,free=0,wall=0,tool=0,visc=0,torque=0,min=0,internal=0,steel=0,maxBend=0,maxCombined=0;
  const pts:RunningProfilePoint[]=profile?[{md:shoe,runInKN:0,pullOutKN:0,freeKN:0,normalKNPerM:0,wallDragKN:0,toolDragKN:0,viscousDragKN:0,bendingMPa:0,combinedAxialBendingMPa:0,clearanceMM:(runningBore(w,shoe)-w.casingOD)/2}]:[];
  const supports=active.map(t=>t.md).sort((a,b)=>a-b);
  let supportIndex=supports.length-2;
  for(let i=depths.length-2;i>=0;i--){
    const top=depths[i],bottom=depths[i+1],dl=bottom-top,mid=(top+bottom)/2;
    const a=runningSurvey(w.trajectory,top),b=runningSurvey(w.trajectory,bottom);
    const inc=rad((a.zenith+b.zenith)/2),di=rad(b.zenith-a.zenith),da=rad(deltaAngle(a.azimuth,b.azimuth));
    const wallMM=w.casingSections?.find(x=>mid+shift>=x.fromMD&&mid+shift<x.toMD)?.wallThickness??w.casingWall;
    const od=w.casingOD/1000,id=od-2*wallMM/1000,area=Math.PI/4*(od*od-id*id),inertia=Math.PI/64*(od**4-id**4);
    const kg=s.pipeWeightKgPerM>0?s.pipeWeightKgPerM:(input.pipeWeightKgPerM??area*7850);
    const weight=kg*G/1000*(1-input.mudDensity/7850)*dl;
    const axial=weight*Math.cos(inc),lateral=weight*Math.sin(inc);
    const mu=Math.max(0,Math.min(1,(mid<w.prevCasingDepth?s.frictionCased:s.frictionOpenhole)+muDelta));
    const bore=runningBore(w,mid);minClearance=Math.min(minClearance,(bore-w.casingOD)/2);const gap=(bore-w.casingOD)/2000;
    const vd=s.speedMps>0&&gap>0?(Math.max(0,input.yp)+Math.max(0,input.pv)*.001*s.speedMps/gap)*Math.PI*od*dl/1000:0;
    const items=toolAt.get(bottom)??[];
    const td=items.reduce((n,t)=>n+t.runningKN,0);
    // Each mode has its own normal force. Iterate midpoint tension to avoid grid-dependent capstan growth.
    const next=(lower:number,sign:number)=>{let upper=lower+axial;for(let n=0;n<12;n++){
      const mean=(lower+upper)/2,normal=Math.hypot(mean*di+lateral,mean*Math.sin(inc)*da);
      const revised=lower+axial+sign*(mu*normal+vd+td);
      if(Math.abs(revised-upper)<1e-8){upper=revised;break;}upper=revised;
    }return upper;};
    const runNext=next(run,-1),pullNext=next(pull,1);
    const normal=Math.hypot((run+runNext)/2*di+lateral,(run+runNext)/2*Math.sin(inc)*da);
    const freeNormal=Math.hypot((free+axial/2)*di+lateral,(free+axial/2)*Math.sin(inc)*da);
    run=runNext;pull=pullNext;free+=axial;wall+=mu*normal;tool+=td;visc+=vd;
    torque+=mu*freeNormal*od/2;
    min=Math.min(min,run);
    internal+=Math.PI/4*id*id*dl;steel+=area*dl;
    const cosDog=Math.cos(rad(a.zenith))*Math.cos(rad(b.zenith))+Math.sin(rad(a.zenith))*Math.sin(rad(b.zenith))*Math.cos(da);
    const curvature=Math.acos(Math.max(-1,Math.min(1,cosDog)))/dl;
    while(supportIndex>0&&mid<supports[supportIndex])supportIndex--;
    // Unsupported span estimate, capped by current segment ends; not a hard-string contact solution.
    const span=supportIndex>=0 && mid>=supports[0] && mid<=supports[supports.length-1] ? Math.max(0,(supports[supportIndex+1]??supports[supportIndex])-supports[supportIndex]) : 0;
    const bending=210e3*od/2*curvature+(Math.abs(lateral)/dl*1000)*span**2/8*(od/2)/inertia/1e6;
    const combined=Math.max(Math.abs(run),Math.abs(pull))*1000/area/1e6+bending;
    maxBend=Math.max(maxBend,bending);maxCombined=Math.max(maxCombined,combined);
    const clearance=Math.min((bore-w.casingOD)/2,...items.map(t=>(bore-t.od)/2));
    if(profile)pts.push({md:top,runInKN:run,pullOutKN:pull,freeKN:free,normalKNPerM:normal/dl,
      wallDragKN:wall,toolDragKN:tool,viscousDragKN:visc,bendingMPa:bending,combinedAxialBendingMPa:combined,clearanceMM:clearance});
  }
  return {run,pull,free,torque,min,minClearance,pts:pts.reverse(),internal,steel,maxBend,maxCombined,count:active.length};
}
export function calculateCasingRunning(input:CasingRunningInput):CasingRunningAnalysis {
  const {well:w,settings:s}=input,errors:string[]=[],notes:string[]=[];
  if(!Number.isFinite(w.casingDepthMD)||w.casingDepthMD<=0||w.casingDepthMD>20000)errors.push('Глубина колонны должна быть больше 0 и не более 20 000 м.');
  if(!(w.casingOD>0&&w.casingWall>0&&2*w.casingWall<w.casingOD))errors.push('Проверьте наружный диаметр и толщину стенки колонны.');
  if(input.pipeWeightKgPerM!==undefined&&!(Number.isFinite(input.pipeWeightKgPerM)&&input.pipeWeightKgPerM>0))errors.push('Погонная масса трубы должна быть положительной.');
  if(!(input.mudDensity>=0&&input.mudDensity<7850))errors.push('Проверьте плотность раствора в кг/м³.');
  if(!(w.holeDiameter>w.casingOD))errors.push('Диаметр открытого ствола должен быть больше диаметра колонны.');
  if(w.prevCasingDepth>0&&!(w.prevCasingID>w.casingOD))errors.push('Проход предыдущей колонны должен быть больше наружного диаметра спускаемой.');
  if(w.trajectory.some((p,i)=>!Number.isFinite(p.md)||!Number.isFinite(p.zenith)||!Number.isFinite(p.azimuth)||p.md<0||p.zenith<0||p.zenith>180||(i>0&&p.md<=w.trajectory[i-1].md)))errors.push('Инклинометрия: нужны конечные углы и возрастающие MD без дублей.');
  if(w.casingSections?.some(x=>!(x.wallThickness>0&&2*x.wallThickness<w.casingOD)))errors.push('Недопустимая толщина в секциях колонны.');
  const empty:CasingRunningAnalysis={valid:false,errors,notes,broom:[],profile:[],final:null,firstCompressionMD:null,firstCapacityMD:null,firstPassageConflictMD:null,maxPullKN:0,maxPullMD:0,maxBendingMPa:0,maxCombinedMPa:0,yieldMPa:s.grade==='K-55'?379:s.grade==='P-110'?758:552,internalVolumeM3:0,steelDisplacementM3:0,centralizerCount:0,unknownRunningCount:0,calibration:null};
  if(errors.length)return empty;
  if(w.trajectory.length<2)notes.push('Инклинометрия отсутствует: принята вертикальная скважина.');
  else if(w.trajectory[w.trajectory.length-1].md<w.casingDepthMD)notes.push('Ниже последнего замера продолжены последние зенит и азимут.');
  const prepared=prepare(input),{tools}=prepared;
  if(prepared.unknown)notes.push(`У ${prepared.unknown} центраторов нет паспортного сопротивления движению. Принято пользовательское ${s.centralizerRunningKN.toFixed(2)} кН/шт.; это сценарий, не характеристика изделия.`);
  if(input.turbPoints?.length)notes.push(`Турбулизаторы: заданное сопротивление ${s.turbulatorRunningKN.toFixed(2)} кН/шт.; гидравлический эффект отдельно не моделируется.`);
  notes.push(s.pipeWeightKgPerM>0||input.pipeWeightKgPerM?'Использована заданная погонная масса, постоянная по длине. Масса оснастки отдельно не добавляется.':'Погонная масса рассчитана по геометрии трубы и плотности стали 7850 кг/м³; муфты и масса оснастки отдельно не добавлены.');
  notes.push('Полностью заполненная колонна, одинаковая жидкость внутри и снаружи. Давления, ускорение, желобообразование и потеря устойчивости в эту модель не входят.');
  notes.push('На участках без двух заданных опор изгиб пролёта не оценён. Изгиб между опорами - оценка свободно опёртого пролёта без контакта со стенкой; не критерий допуска и не расчёт рессор. Крутящий момент - сухое трение при вращении, без вязкого момента и пуска оснастки.');
  const depthSet=new Set([0,w.casingDepthMD]);const step=Math.max(25,Math.ceil(w.casingDepthMD/120/5)*5);
  for(let d=step;d<w.casingDepthMD;d+=step)depthSet.add(d);
  if(w.prevCasingDepth>0&&w.prevCasingDepth<w.casingDepthMD)depthSet.add(w.prevCasingDepth);
  const broom:RunningBroomPoint[]=[],block=s.blockWeightKN;
  let firstCompressionMD:number|null=null,firstCapacityMD:number|null=null,firstPassageConflictMD:number|null=null,maxPullKN=0,maxPullMD=0;
  for(const md of [...depthSet].sort((a,b)=>a-b)){
    const base=solve(input,md,tools),low=solve(input,md,tools,-s.frictionSpread),high=solve(input,md,tools,s.frictionSpread),bare=solve(input,md,tools,0,false,true);
    const p={md,runIn:(base.run+block)/G,pullOut:(base.pull+block)/G,free:(base.free+block)/G,
      runLow:(low.run+block)/G,runHigh:(high.run+block)/G,pullLow:(low.pull+block)/G,pullHigh:(high.pull+block)/G,
      noTools:(bare.run+block)/G,torqueKNm:base.torque,toolCount:base.count};broom.push(p);
    if(md>0&&base.minClearance<=0&&firstPassageConflictMD===null)firstPassageConflictMD=md;
    if(md>0&&base.min<-.001&&firstCompressionMD===null)firstCompressionMD=md;
    if(s.maxHookKN>0&&base.pull+block>s.maxHookKN&&firstCapacityMD===null)firstCapacityMD=md;
    if(base.pull+block>maxPullKN){maxPullKN=base.pull+block;maxPullMD=md;}
  }
  const end=solve(input,w.casingDepthMD,tools,0,true);
  const validMeasurements=s.measurements.filter(m=>m.md<=w.casingDepthMD);
  let calibration:CasingRunningAnalysis['calibration']=null;
  if(validMeasurements.length){
    let best=Infinity,delta=0;const scores:number[]=[];
    for(let k=-20;k<=20;k++){const d=k*.01;if(s.frictionCased+d<0||s.frictionOpenhole+d<0||s.frictionCased+d>1||s.frictionOpenhole+d>1)continue;
      const score=validMeasurements.reduce((sum,m)=>{const r=solve(input,m.md,tools,d);return sum+(((m.mode==='runIn'?r.run:r.pull)+block)/G-m.hookTF)**2;},0);
      scores.push(score);if(score<best){best=score;delta=d;}
    }
    const informative=Math.max(...scores)-Math.min(...scores)>1e-6;
    calibration={deltaMu:informative?delta:0,rmseTF:Math.sqrt(best/validMeasurements.length),count:validMeasurements.length,atBoundary:Math.abs(delta)>=.2-1e-6||s.frictionCased+delta<=0||s.frictionOpenhole+delta<=0,informative};
  }
  const conflicts=end.pts.filter(p=>p.clearanceMM<=0);
  if(conflicts.length)notes.push(`Геометрический конфликт прохода: от MD ${conflicts[0].md.toFixed(0)} м. Проверьте диаметры трубы, колец и жёсткой оснастки.`);
  return {...empty,valid:true,notes,broom,profile:end.pts,final:broom[broom.length-1],firstCompressionMD,firstCapacityMD,firstPassageConflictMD,maxPullKN,maxPullMD,
    maxBendingMPa:end.maxBend,maxCombinedMPa:end.maxCombined,internalVolumeM3:end.internal,steelDisplacementM3:end.steel,
    centralizerCount:prepared.centralizerCount,unknownRunningCount:prepared.unknown,calibration};
}
