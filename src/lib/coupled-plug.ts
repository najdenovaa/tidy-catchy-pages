import {compileBenchGeometry,benchGeometryKey,type BenchGeometry} from './bench-geometry';
import {initializeGeometryPressure} from './geometry-pressure';
import {resolveBenchLaws,rheologyPairKey,type BenchRheologyPair} from './bench-rheology';
import {advanceAle,type AleState} from './ale-transport';
import {initializePlug,normalizeMovingPlugCase,type MovingPlugCase} from './moving-plug';
import {pressureAleStep,pistonFaces,type PlugHydraulics,type HydraulicFrame} from './plug-pressure';

export interface CoupledFrame extends HydraulicFrame {
  velocityMps:number; mode:'stuck'|'moving'|'seated'; forceResidualMPa:number; seatReactionMPa:number;
}
export interface CoupledTracePoint {timeSec:number;xM:number;inletMPa:number;backWallMPa:number;aheadWallMPa:number;phase:'approach'|'seated';region?:number;minCellM?:number;maxCellM?:number}
export function coupledCaseKey(input:MovingPlugCase,n:number,mu:number,switchSec:number,rheology?:BenchRheologyPair,geometry?:BenchGeometry){return JSON.stringify(['coupled-piston-pressure-v1',normalizeMovingPlugCase(input),n,mu,switchSec,rheologyPairKey(rheology),benchGeometryKey(geometry)]);}
export interface CoupledPlugResult extends Omit<PlugHydraulics,'model'|'frames'> {
  model:'coupled-piston-pressure-v1'; inputKey:string; trace:CoupledTracePoint[]; frames:CoupledFrame[]; landingTimeSec:number|null;
  geometryEvents?:{timeSec:number;mdM:number}[]; maxForceResidualMPa:number; rejectedSteps:number;
}
const sum=(a:number[])=>a.reduce((v,x)=>v+x,0);
const forceTolerance=1e-6;
/** Nested, converged pressure/position solve; candidates never mutate the old state. */
export function simulateCoupledPlug(input:MovingPlugCase,n=8,mu=10,switchSec=0,rheology?:BenchRheologyPair,geometry?:BenchGeometry):CoupledPlugResult{
  const p=normalizeMovingPlugCase(input)!,r:CoupledPlugResult={model:'coupled-piston-pressure-v1',inputKey:coupledCaseKey(input,n,mu,switchSec,rheology,geometry),rheology,geometry,geometryEvents:[],trace:[],status:'stopped',reason:'',viscosityMpas:mu,cellsPerChamber:n,switchSec,frames:[],initialKg:[0,0,0],injectedKg:[0,0,0],returnedKg:[0,0,0],retainedKg:[0,0,0],acceptedSteps:0,maxMassResidualKg:0,maxComponentResidualKg:0,maxGeometricResidualM3:0,maxReynolds:0,landingTimeSec:null,maxForceResidualMPa:0,rejectedSteps:0};
  let last:CoupledFrame|undefined;
  try{
    resolveBenchLaws(rheology,mu);
    if(!p||!Number.isInteger(n)||n<1||n>60||!Number.isFinite(mu)||!rheology&&mu<=0||!Number.isFinite(switchSec)||switchSec<0||switchSec>p.durationSec)throw new Error('Нужны 1-60 ячеек, положительная вязкость и корректный момент метки.');
    initializePlug(p); // Shared case validation; no two-chamber trajectory is used.
    const geo=geometry?compileBenchGeometry(p,geometry):undefined,initial=geo?initializeGeometryPressure(p,n,geo):undefined;
    const a=Math.PI*(p.diameterMm/1000)**2/4,source=p.rateLps/1000*p.rhoBackKgM3,faces=geo?geo.faces(p.initialXM,n):pistonFaces(p,n,p.initialXM);
    let pressure=Array(2*n).fill(p.outletMPa),state:AleState={facesM:faces,massKg:faces.slice(1).map((x,i)=>a*(x-faces[i])*(i<n?p.rhoBackKgM3:p.rhoAheadKgM3)*Math.exp(p.outletMPa/(i<n?p.bulkBackMPa:p.bulkAheadMPa))),fractions:Array.from({length:2*n},(_,i)=>i<n?[1,0,0]:[0,0,1])},time=0,x=p.initialXM,landed=false;
    if(initial){state=initial.state;pressure=initial.pressures;r.capacityM3=geo!.capacityM3;}
    advanceAle(state,faces,state.massKg,Array(2*n+1).fill(0),1,a,[1,0,0],undefined,n);
    const cellRange=(f:number[])=>{const d=f.slice(1).map((v,i)=>v-f[i]);return {minCellM:Math.min(...d),maxCellM:Math.max(...d)};};
    r.initialKg=[sum(state.massKg.slice(0,n)),0,sum(state.massKg.slice(n))];r.retainedKg=[...r.initialKg];
    last={timeSec:0,xM:x,facesM:geo?faces.map(geo.fromLogical):faces,pressuresMPa:pressure,massesKg:state.massKg,fractions:state.fractions,relativeFluxKgS:Array(2*n+1).fill(0),laboratoryVelocityMps:Array(2*n+1).fill(0),inletMPa:initial?.inletMPa??p.outletMPa,backWallMPa:initial?.wallMPa??p.outletMPa,aheadWallMPa:initial?.wallMPa??p.outletMPa,movingForceMismatchMPa:null,maxReynolds:0,velocityMps:0,mode:'stuck',forceResidualMPa:0,seatReactionMPa:0};r.frames.push(last);r.trace.push({timeSec:0,xM:x,inletMPa:initial?.inletMPa??p.outletMPa,backWallMPa:initial?.wallMPa??p.outletMPa,aheadWallMPa:initial?.wallMPa??p.outletMPa,phase:'approach',region:geo?.region(x)??0,...cellRange(last.facesM)});
    while(time<p.durationSec-1e-8){
      if(r.acceptedSteps>=4000)throw new Error('Превышен лимит 4000 принятых шагов связанного стенда.');
      const injection=time>=switchSec-1e-8?[0,1,0]:[1,0,0];
      const region=geo?.region(x)??0,stop=geo?.cuts.find(c=>c>x+1e-8&&c<p.seatXM)??p.seatXM;
      const at=(target:number,dt:number,trial=true)=>{
        const step=pressureAleStep(p,n,mu,state,pressure,geo?geo.faces(target,n):pistonFaces(p,n,target),dt,source,injection,trial,rheology,geo),v=(target-x)/dt;
        return {step,x:target,dt,v,force:step.backWallMPa-step.aheadWallMPa-p.breakawayMPa-p.dragMPaPerMps*v,crosses:false};
      };
      const motion=(dt:number)=>{
        if(landed)return at(p.seatXM,dt);
        const low=at(x,dt);if(low.force<=(rheology||geo?forceTolerance/20:0))return low;
        // At zero mean rear pressure this bound exhausts the rear mass supply.
        // It is a numerical bracket, never an accepted vacuum state.
        let lo=x,hi=Math.min(stop,geo?geo.mdAtVolume(Math.min(geo.capacityM3,(sum(state.massKg.slice(0,n))+source*dt)/p.rhoBackKgM3)):(sum(state.massKg.slice(0,n))+source*dt)/(p.rhoBackKgM3*a));
        if(!(hi>lo))throw new Error('Не найден положительный интервал движения.');
        const high=at(hi,dt);
        if(high.force>=0){if(hi!==stop)throw new Error('Не удалось ограничить корень силового баланса.');return {...high,crosses:true};}
        let candidate=low;
        for(let j=0;j<60;j++){
          candidate=at((lo+hi)/2,dt);
          if(Math.abs(candidate.force)<forceTolerance/20)return candidate;
          if(candidate.force>0)lo=candidate.x;else hi=candidate.x;
        }
        if(Math.abs(candidate.force)>forceTolerance)throw new Error('Положение и локальные давления не сошлись совместно.');
        return candidate;
      };
      let dt=Math.min(p.stepSec,p.durationSec-time,switchSec>time+1e-8?switchSec-time:Infinity),candidate:ReturnType<typeof at>|undefined,seatEvent=false,geometryEvent=false,lastError='';
      for(let retry=0;retry<20;retry++){
        try{
          let solved=motion(dt),event=false;
          if(solved.crosses){
            let lo=0,hi=dt;
            for(let j=0;j<44;j++){const mid=(lo+hi)/2;if(mid<=1e-9)break;const probe=motion(mid);if(probe.crosses){hi=mid;solved=probe;}else lo=mid;}
            dt=hi;solved=at(stop,dt);event=true;
            if(Math.abs(solved.force)>forceTolerance)throw new Error('Момент посадки не сошёлся по силовому балансу.');
          }
          const physical=at(solved.x,dt,false);
          if(!landed&&(physical.v>1e-10||event)&&Math.abs(physical.force)>forceTolerance)throw new Error('Физический шаг не подтвердил силовой корень.');
          if(!landed&&physical.v<=1e-10&&!event&&physical.force>forceTolerance)throw new Error('Не выполнено условие покоя поршня.');
          candidate=physical;seatEvent=event&&stop===p.seatXM;geometryEvent=event&&stop!==p.seatXM;break;
        }catch(e){lastError=e instanceof Error?e.message:String(e);r.rejectedSteps++;dt/=2;if(dt<=1e-8)break;}
      }
      if(!candidate)throw new Error('Шаг связанного стенда отклонён: '+lastError);
      const step=candidate.step,injected=r.injectedKg.map((m,j)=>m+step.injectedKg[j]),returned=r.returnedKg.map((m,j)=>m+step.returnedKg[j]),retained=[0,1,2].map(j=>sum(step.state.massKg.map((m,i)=>m*step.state.fractions[i][j]))),residuals=retained.map((m,j)=>Math.abs(r.initialKg[j]+injected[j]-returned[j]-m));
      if(residuals.some((e,j)=>e>1e-7*Math.max(1,r.initialKg[j]+injected[j],returned[j]+retained[j])))throw new Error('Накопленный баланс связанного стенда не сошёлся.');
      const wasLanded=landed,forceResidual=wasLanded?0:candidate.v>1e-10||seatEvent?Math.abs(candidate.force):Math.max(0,candidate.force);
      state=step.state;pressure=step.pressures;time+=dt;x=candidate.x;landed=landed||seatEvent;
      if(seatEvent)r.landingTimeSec=time;if(geometryEvent)r.geometryEvents!.push({timeSec:time,mdM:x});
      r.acceptedSteps++;r.injectedKg=injected;r.returnedKg=returned;r.retainedKg=retained;
      r.maxMassResidualKg=Math.max(r.maxMassResidualKg,step.maxContinuityResidualKg);r.maxComponentResidualKg=Math.max(r.maxComponentResidualKg,step.maxMassResidualKg,...residuals);r.maxGeometricResidualM3=Math.max(r.maxGeometricResidualM3,step.maxGeometricResidualM3);r.maxReynolds=Math.max(r.maxReynolds,step.maxReynolds);r.maxReynoldsBack=Math.max(r.maxReynoldsBack??0,step.maxReynoldsBack);r.maxReynoldsAhead=Math.max(r.maxReynoldsAhead??0,step.maxReynoldsAhead);r.maxForceResidualMPa=Math.max(r.maxForceResidualMPa,forceResidual);
      last={timeSec:time,xM:x,facesM:geo?state.facesM.map(geo.fromLogical):state.facesM,massesKg:state.massKg,fractions:state.fractions,pressuresMPa:pressure,relativeFluxKgS:step.relativeFluxKgS,laboratoryVelocityMps:step.laboratoryVelocityMps,inletMPa:step.inletMPa,backWallMPa:step.backWallMPa,aheadWallMPa:step.aheadWallMPa,movingForceMismatchMPa:null,maxReynolds:step.maxReynolds,maxReynoldsBack:step.maxReynoldsBack,maxReynoldsAhead:step.maxReynoldsAhead,velocityMps:candidate.v,mode:landed?'seated':candidate.v>1e-10?'moving':'stuck',forceResidualMPa:forceResidual,seatReactionMPa:wasLanded?Math.max(0,candidate.force):0};
      r.trace.push({timeSec:time,xM:x,inletMPa:step.inletMPa,backWallMPa:step.backWallMPa,aheadWallMPa:step.aheadWallMPa,phase:wasLanded?'seated':'approach',region,...cellRange(last.facesM)});
      if(time-r.frames.at(-1)!.timeSec>=p.durationSec/150||seatEvent||geometryEvent||Math.abs(time-switchSec)<1e-8||time>=p.durationSec-1e-8)r.frames.push(last);
    }
    r.status='complete';r.reason=r.landingTimeSec===null?'Связанный стенд рассчитан; упор за назначенное время не достигнут.':'Связанный стенд рассчитан; движение и посадка найдены по локальным давлениям.';
  }catch(e){r.reason=e instanceof Error?e.message:String(e);}
  if(last&&r.frames.at(-1)?.timeSec!==last.timeSec)r.frames.push(last);return r;
}
export function coupledPlugCsv(r:CoupledPlugResult){return 'model;status;time_s;x_m;step_mean_velocity_m_s;mode;inlet_mpa;back_wall_mpa;ahead_wall_mpa;force_residual_mpa;seat_reaction_mpa\n'+r.frames.map(f=>[r.model,r.status,f.timeSec,f.xM,f.velocityMps,f.mode,f.inletMPa,f.backWallMPa,f.aheadWallMPa,f.forceResidualMPa,f.seatReactionMPa].join(';')).join('\n');}
