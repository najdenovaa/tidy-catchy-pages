import type {CementingSnapshot} from './cementing-normalizers';
import {buildProcessContract} from './cementing-process';
import {getCasingIDAtDepth,getEffectiveTrajectory,interpolateTVD} from './cementing-calculations';
import {boreDiameterAtDepth} from './well-geometry';

export const THERMAL_FIELDS=[['surfaceC','Температура на поверхности, °C'],['initialBottomC','Начальная температура жидкости у забоя, °C'],['rockK','Теплопроводность породы, Вт/(м К)'],['rockRhoCp','Объёмная теплоёмкость породы, Дж/(м³ К)'],['outerRadiusM','Внешний радиус породы, м'],['steelK','Теплопроводность стали, Вт/(м К)'],['steelRhoCp','Объёмная теплоёмкость стали, Дж/(м³ К)'],['hPipe','Труба-стенка, Вт/(м² К)'],['hAnnulus','Стенка-затрубье, Вт/(м² К)'],['hFormation','Затрубье-порода, эффективный h, Вт/(м² К)'],['circulationMin','Циркуляция перед цементажем, мин'],['circulationLps','Расход циркуляции, л/с'],['preHoldMin','Остановка после циркуляции, мин'],['wocMin','Наблюдение ОЗЦ после Стоп, мин'],['cells','Осевые ячейки, шт.'],['maxStepS','Максимальный шаг, с'],['frameMin','Интервал кадров, мин']]as const;
export const THERMAL_SPACE={pipe:'Труба',annulus:'Затрубье',outside:'Вне скважины','not-injected':'Не закачано'};
export interface ThermalFluid {id:string;cp:number;inletC:number}
export interface ThermalSettings {
 source:string;surfaceC:number;initialBottomC:number;rockK:number;rockRhoCp:number;outerRadiusM:number;
 steelK:number;steelRhoCp:number;hPipe:number;hAnnulus:number;hFormation:number;
 circulationMin:number;circulationLps:number;preHoldMin:number;wocMin:number;cells:number;maxStepS:number;frameMin:number;
 fluids:ThermalFluid[];
}
export const THERMAL_NOTE='Осесимметричная несжимаемая тепловая модель: поршневое направление потока вниз по трубе и вверх по затрубью, консервативная upwind-схема, местное тепловое равновесие жидкостей в ячейке. Стенка колонны имеет теплоёмкость; порода - шесть радиальных слоёв и заданная дальняя температура по TVD. Коэффициенты теплоотдачи заданы пользователем, включая эффективное сопротивление внешней крепи. Нет тепла гидратации, трения, осевой теплопроводности, потерь в пласт, свободного падения или температурной коррекции гидравлики. ОЗЦ здесь - заданное время наблюдения, не прогноз прочности. Обязательны контроль сетки и независимая инженерная проверка.';
const valid=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x);
export function normalizeThermal(v:unknown):ThermalSettings|undefined {
 if(!v||typeof v!=='object')return undefined;const x=v as ThermalSettings;
 const out={source:typeof x.source==='string'?x.source.slice(0,3000):'',fluids:Array.isArray(x.fluids)?x.fluids.slice(0,100).map(f=>({id:String(f.id??'').slice(0,100),cp:valid(f.cp)?f.cp:NaN,inletC:valid(f.inletC)?f.inletC:NaN})):[]} as ThermalSettings;
 for(const k of ['surfaceC','initialBottomC','rockK','rockRhoCp','outerRadiusM','steelK','steelRhoCp','hPipe','hAnnulus','hFormation','circulationMin','circulationLps','preHoldMin','wocMin','cells','maxStepS','frameMin']as const)out[k]=valid(x[k])?x[k]:NaN;
 return out;
}
export function thermalDraft(s:CementingSnapshot):ThermalSettings {
 const c=buildProcessContract(s);return {source:'Типовой сценарий - требует подтверждения исходных свойств',surfaceC:20,initialBottomC:s.wellData.bottomTempStatic,rockK:2.5,rockRhoCp:2400000,outerRadiusM:5,steelK:45,steelRhoCp:3800000,hPipe:200,hAnnulus:150,hFormation:100,circulationMin:60,circulationLps:10,preHoldMin:0,wocMin:1440,cells:60,maxStepS:5,frameMin:30,fluids:c.fluids.filter(f=>f.kind!=='serviceWater').map(f=>({id:f.id,cp:f.kind==='cement'?1800:4000,inletC:20}))};
}
export function thermalKey(s:CementingSnapshot){const w={...s.wellData};delete w.depthChartSettings;delete w.chartPresentations;return JSON.stringify(['thermal-v1',{...s,wellData:w}],(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);}
export interface ThermalFrame {timeS:number;phase:string;pipeC:number[];annulusC:number[];wallC:number[];fractions:number[][];balance:{storedJ:number;inJ:number;outJ:number;farFieldJ:number;residualJ:number}}
export interface ThermalTag {id:string;name:string;fluidId:string;injectedM3:number;history:{timeS:number;md:number|null;space:'pipe'|'annulus'|'outside'|'not-injected';temperatureC:number|null}[]}
export interface ThermalResult {key:string;settings:ThermalSettings;names:string[];ids:string[];densitiesKgM3:number[];geometry:{bhstC:number;bottomTVDM:number;shoeMD:number;cells:{topMD:number;bottomMD:number;innerRadiusM:number;casingRadiusM:number;boreRadiusM:number;pipeM3:number;annulusM3:number}[]};md:number[];tvd:number[];frames:ThermalFrame[];tags:ThermalTag[];jobStartS:number;stopS:number;steps:number;minStepS:number;maxStepS:number;energyScaleJ:number;notes:string[]}

/** Conservative finite-volume energy network. Each internal exchange is added with opposite signs. */
export function simulateThermal(s:CementingSnapshot):ThermalResult {
 const cfg=s.wellData.thermal?structuredClone(s.wellData.thermal):undefined;if(!cfg)throw Error('Не заданы тепловые исходные данные');
 const c=buildProcessContract(s),w=s.wellData;if(!c.canRun)throw Error(c.issues.map(i=>i.message).join('; '));
 if(!cfg.source.trim())throw Error('Укажите источник тепловых исходных данных');
 for(const k of ['surfaceC','initialBottomC']as const)if(!valid(cfg[k])||cfg[k]<=-273.15)throw Error('Недопустимая температура');
 for(const k of ['rockK','rockRhoCp','outerRadiusM','steelK','steelRhoCp','maxStepS','frameMin']as const)if(!valid(cfg[k])||cfg[k]<=0)throw Error('Нужен положительный тепловой параметр '+k);
 for(const k of ['hPipe','hAnnulus','hFormation','circulationMin','circulationLps','preHoldMin','wocMin']as const)if(!valid(cfg[k])||cfg[k]<0)throw Error('Недопустимый тепловой параметр '+k);
 if(!Number.isInteger(cfg.cells)||cfg.cells<10||cfg.cells>240||cfg.maxStepS>60||cfg.frameMin<.1)throw Error('Сетка: 10-240 ячеек, шаг до 60 с, кадр не чаще 0.1 мин');
 if(cfg.circulationMin>0&&cfg.circulationLps<=0)throw Error('Для циркуляции нужен расход');
 const fluids=c.fluids.filter(f=>f.kind!=='serviceWater'),props=fluids.map(f=>{const a=cfg.fluids.filter(x=>x.id===f.id);if(a.length!==1||!valid(a[0].cp)||a[0].cp<=0||!valid(a[0].inletC)||a[0].inletC<=-273.15||!(f.densityKgM3>0))throw Error('Нужны теплоёмкость и температура входа: '+f.name);return {...a[0],rhoCp:a[0].cp*f.densityKgM3};});
 if(!valid(w.bottomTempStatic)||w.bottomTempStatic<=-273.15)throw Error('Недопустимая BHST');
 const n=cfg.cells,nf=fluids.length,L=w.casingDepthMD;if(!(L>0&&w.wellDepthTVD>0))throw Error('Нужна корректная глубина скважины');
 const boundaries=[...new Set([0,L,...Array.from({length:n+1},(_,i)=>L*i/n),...(w.casingSections??[]).flatMap(x=>[x.fromMD,x.toMD]),...(w.cavernIntervals??[]).flatMap(x=>[x.fromMD,x.toMD]),w.prevCasingDepth].filter(x=>x>=0&&x<=L))].sort((a,b)=>a-b).filter((x,i,a)=>i===0||x-a[i-1]>1e-6),nz=boundaries.length-1,N=2*nz,R=6;
 if(nz>500)throw Error('Слишком много границ геометрии для тепловой сетки');
 const traj=getEffectiveTrajectory(w),md=boundaries.slice(1).map((b,i)=>(b+boundaries[i])/2),tvd=md.map(z=>interpolateTVD(z,traj));
 const volumes=new Float64Array(N),wallCap=new Float64Array(nz),rockCap=new Float64Array(R*nz),temp=new Float64Array(N),wall=new Float64Array(nz),rock=new Float64Array(R*nz),far=tvd.map(z=>cfg.surfaceC+(w.bottomTempStatic-cfg.surfaceC)*z/w.wellDepthTVD);
 const geometry:ThermalResult['geometry']={bhstC:w.bottomTempStatic,bottomTVDM:w.wellDepthTVD,shoeMD:L,cells:[]};
 const edges:{a:number;b:number;g:number}[]=[],reservoir:{a:number;g:number;t:number}[]=[],caps=new Float64Array(N+nz+R*nz),prefix=[0];
 for(let j=0;j<nz;j++){
  const dz=boundaries[j+1]-boundaries[j],ri=getCasingIDAtDepth(md[j],w.casingOD,w.casingWall,w.casingSections)/2000,ro=w.casingOD/2000,rh=boreDiameterAtDepth(w,md[j])/2000;
  if(!(ri>0&&ro>ri&&rh>ro&&cfg.outerRadiusM>rh))throw Error('Недопустимые диаметры или радиус тепловой области');
  const a=N+j,rs=Array.from({length:R+1},(_,i)=>rh*(cfg.outerRadiusM/rh)**(i/R)),rc=rs.slice(1).map((r,i)=>Math.sqrt(r*rs[i]));
  volumes[j]=Math.PI*ri*ri*dz;volumes[N-1-j]=Math.PI*(rh*rh-ro*ro)*dz;wallCap[j]=Math.PI*(ro*ro-ri*ri)*dz*cfg.steelRhoCp;caps[a]=wallCap[j];geometry.cells.push({topMD:boundaries[j],bottomMD:boundaries[j+1],innerRadiusM:ri,casingRadiusM:ro,boreRadiusM:rh,pipeM3:volumes[j],annulusM3:volumes[N-1-j]});
  const g=(h:number,r:number)=>h===0?0:1/(1/(h*2*Math.PI*r*dz)+Math.log(ro/ri)/(4*Math.PI*cfg.steelK*dz));
  edges.push({a:j,b:a,g:g(cfg.hPipe,ri)},{a:N-1-j,b:a,g:g(cfg.hAnnulus,ro)});
  const init=cfg.surfaceC+(cfg.initialBottomC-cfg.surfaceC)*tvd[j]/w.wellDepthTVD;temp[j]=temp[N-1-j]=wall[j]=init;
  for(let k=0;k<R;k++){const p=N+nz+j*R+k;rock[j*R+k]=far[j];rockCap[j*R+k]=Math.PI*(rs[k+1]**2-rs[k]**2)*dz*cfg.rockRhoCp;caps[p]=rockCap[j*R+k];if(k===0)edges.push({a:N-1-j,b:p,g:cfg.hFormation===0?0:1/(1/(cfg.hFormation*2*Math.PI*rh*dz)+Math.log(rc[0]/rh)/(2*Math.PI*cfg.rockK*dz))});else edges.push({a:p-1,b:p,g:2*Math.PI*cfg.rockK*dz/Math.log(rc[k]/rc[k-1])});}
  reservoir.push({a:N+nz+j*R+R-1,g:2*Math.PI*cfg.rockK*dz/Math.log(cfg.outerRadiusM/rc[R-1]),t:far[j]});
 }
 for(const v of volumes)prefix.push(prefix[prefix.length-1]+v);
 const fractions=Array.from({length:nf},(_,f)=>new Float64Array(N).fill(f===0?1:0)),E=new Float64Array(caps.length),T=new Float64Array(caps.length),dE=new Float64Array(caps.length),sumG=new Float64Array(caps.length);
 edges.forEach(e=>{sumG[e.a]+=e.g;sumG[e.b]+=e.g;});reservoir.forEach(e=>sumG[e.a]+=e.g);
 const capacities=()=>{for(let k=0;k<N;k++){let r=0;for(let f=0;f<nf;f++)r+=fractions[f][k]*props[f].rhoCp;caps[k]=volumes[k]*r;if(!Number.isFinite(caps[k])||caps[k]<=0)throw Error('Некорректная теплоёмкость ячейки');}};
 capacities();for(let k=0;k<N;k++)E[k]=caps[k]*temp[k];for(let j=0;j<nz;j++){E[N+j]=wallCap[j]*wall[j];for(let k=0;k<R;k++)E[N+nz+j*R+k]=rockCap[j*R+k]*rock[j*R+k];}
 if(E.some(v=>!Number.isFinite(v))||caps.some(v=>!Number.isFinite(v)||v<=0))throw Error('Нечисловое начальное тепловое поле');
 const total=()=>E.reduce((a,b)=>a+b,0),initial=total();if(!Number.isFinite(initial))throw Error('Начальная энергия вышла за численный диапазон');let inJ=0,outJ=0,farJ=0,energyScale=0,time=0,pumped=0,steps=0,minStep=Infinity,maxStep=0;
 const preS=(cfg.circulationMin+cfg.preHoldMin)*60,stopS=preS+(c.totalTimeMin??0)*60,end=stopS+cfg.wocMin*60;
 if(!Number.isFinite(end)||end>14*86400||Math.ceil(end/(cfg.frameMin*60))+c.stages.length+6>1000)throw Error('Тепловой расчёт: до 14 суток и до 1000 кадров; увеличьте интервал кадров');
 if((Math.ceil(end/(cfg.frameMin*60))+c.stages.length+6)*(N*(nf+2)+nz)*8>64*1024*1024)throw Error('Слишком много тепловых полей: увеличьте интервал кадров или сократите сетку');
 const stages=[{end:cfg.circulationMin*60,q:cfg.circulationLps/1000,f:0,phase:'Циркуляция',job:false},{end:preS,q:0,f:0,phase:'Подготовка',job:false},...c.stages.map(st=>({end:preS+(st.endMin??0)*60,q:st.destination==='well'?st.rateLps/1000:0,f:fluids.findIndex(f=>f.id===st.fluidId),phase:st.name,job:true})),{end,q:0,f:0,phase:'ОЗЦ',job:false}];
 const cem=c.stages.filter(st=>st.kind==='cement'&&st.volumeM3>0),first=cem[0]?.fluidId,last=cem.at(-1)?.fluidId;
 const volumeBounds=(id:string)=>{let v=0,a=Infinity,b=0;for(const st of c.stages){if(st.destination!=='well')continue;if(st.fluidId===id){a=Math.min(a,v);b=v+st.volumeM3;}v+=st.volumeM3;}return {a,b};};
 const tags:ThermalTag[]=[];for(const [id,label,tail]of [[first,'Первая порция первого цемента',false],[first,'Последняя порция первого цемента',true],[last,'Последняя порция последнего цемента',true]]as const){if(!id)continue;const {a,b}=volumeBounds(id),epsilon=Math.min(1e-6,(b-a)*1e-6);tags.push({id:'tag-'+tags.length,name:label,fluidId:id,injectedM3:tail?b-epsilon:a+epsilon,history:[]});}
 const frames:ThermalFrame[]=[];let nextFrame=0;
 const save=(phase:string)=>{
  if(frames.at(-1)?.timeS===time)return;const stored=total()-initial;frames.push({timeS:time,phase,pipeC:Array.from(E.slice(0,nz),(v,i)=>v/caps[i]),annulusC:md.map((_,j)=>E[N-1-j]/caps[N-1-j]),wallC:md.map((_,j)=>E[N+j]/caps[N+j]),fractions:fractions.map(f=>Array.from(f)),balance:{storedJ:stored,inJ,outJ,farFieldJ:farJ,residualJ:stored-inJ+outJ-farJ}});
  for(const tag of tags){const x=pumped-tag.injectedM3;let k=0;while(k<N&&prefix[k+1]<=x)k++;if(time<preS||x<0)tag.history.push({timeS:time,md:null,space:'not-injected',temperatureC:null});else if(k>=N)tag.history.push({timeS:time,md:null,space:'outside',temperatureC:null});else{const j=k<nz?k:N-1-k,u=(x-prefix[k])/volumes[k],z=k<nz?boundaries[j]+u*(boundaries[j+1]-boundaries[j]):boundaries[j+1]-u*(boundaries[j+1]-boundaries[j]);tag.history.push({timeS:time,md:z,space:k<nz?'pipe':'annulus',temperatureC:E[k]/caps[k]});}}
 };
 save('Начальное состояние');nextFrame=cfg.frameMin*60;
 for(const stage of stages){while(time<stage.end-1e-7){if(++steps>500000)throw Error('Превышен бюджет тепловых шагов - укрупните сетку или сократите время');capacities();for(let k=0;k<E.length;k++)T[k]=E[k]/caps[k];
   let dt=Math.min(cfg.maxStepS,stage.end-time);for(let k=0;k<E.length;k++)if(sumG[k]>0)dt=Math.min(dt,.45*caps[k]/sumG[k]);if(stage.q>0)for(const v of volumes)dt=Math.min(dt,.45*v/stage.q);if(!(dt>0))throw Error('Нулевой тепловой шаг');minStep=Math.min(minStep,dt);maxStep=Math.max(maxStep,dt);dE.fill(0);
   for(const e of edges){const q=e.g*(T[e.b]-T[e.a])*dt;dE[e.a]+=q;dE[e.b]-=q;}for(const e of reservoir){const q=e.g*(e.t-T[e.a])*dt;dE[e.a]+=q;farJ+=q;energyScale+=Math.abs(q);}
   if(stage.q>0){const f=stage.f;if(f<0)throw Error('Не определена закачиваемая жидкость');const inlet=stage.q*props[f].rhoCp*props[f].inletC*dt;inJ+=inlet;energyScale+=Math.abs(inlet);let upstream=inlet;for(let k=0;k<N;k++){let capacity=0;for(let f=0;f<nf;f++)capacity+=fractions[f][k]*props[f].rhoCp;const out=stage.q*capacity*T[k]*dt;dE[k]+=upstream-out;upstream=out;}outJ+=upstream;energyScale+=Math.abs(upstream);
    for(let f0=0;f0<nf;f0++){const old=fractions[f0];for(let k=N-1;k>=0;k--)old[k]+=stage.q*dt/volumes[k]*((k===0?(f0===f?1:0):old[k-1])-old[k]);}
   }
   for(let k=0;k<E.length;k++){E[k]+=dE[k];if(!Number.isFinite(E[k]))throw Error('Тепловое поле вышло за численный диапазон');}capacities();time+=dt;if(stage.job)pumped+=stage.q*dt;
   if(time>=nextFrame-1e-7){save(stage.phase);while(nextFrame<=time+1e-7)nextFrame+=cfg.frameMin*60;}
  }save(stage.phase);}
 const notes=[THERMAL_NOTE,...c.issues.map(i=>i.message),'Метки представляют точки на 1 мл или менее от границ порции; температура берётся из пересекаемой тепловой ячейки. Численная дисперсия температуры/долей и чувствительность к сетке должны проверяться. Состав тепловой осесимметричной модели не заменяет секторное 2D/3D-замещение.'];
 return {key:thermalKey(s),settings:cfg,geometry,densitiesKgM3:fluids.map(f=>f.densityKgM3),names:fluids.map(f=>f.name),ids:fluids.map(f=>f.id),md,tvd,frames,tags,jobStartS:preS,stopS,steps,minStepS:steps?minStep:0,maxStepS:maxStep,energyScaleJ:energyScale,notes};
}
