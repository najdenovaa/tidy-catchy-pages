/** The same SqueezePoint contract drives shared graphs, 3D and 2D for Bradenhead.
 * This is a simple measurable-rate / volume-balance model, not a fracture-fluid solver.
 */
import type {RirInputs,RirResult} from "./rir-calculations";
import type {CompositionDesign} from "./rir-compositions";
import type {SqueezeSimResult,SqueezePoint} from "./rir-squeeze-sim";

export function simulateBradenhead(inp:RirInputs,res:RirResult,design:CompositionDesign|null):SqueezeSimResult {
 const spot=res.spotResult;
 const warnings:string[]=["Объём в заколонном канале показан как сценарная оценка по приёмистости, а не гарантированная изоляция. Подтверждение только промысловым контролем."];
 const points:SqueezePoint[]=[];
 const stages:SqueezeSimResult["stages"]=[];
 const holds:SqueezeSimResult["holds"]=[];
 if(!spot) throw new Error("Для режима без пакера требуется расчёт размещения цемента");
 const cap=Math.min(res.maxSurfaceMPa,spot.conservativeSurfaceLimitMPa);
 const placed=spot.placedM3;
 const rho=design?.densityGcm3 ?? res.compositionDensity;
 const hyd=spot.liquidHydroMPa;
 const g=9.81;
 const fracLimit=spot.fractureLimitBhpMPa;
 const workingLife=design?.workLifeAtBhctMin ?? 240;
 const qSet=Math.max(0.01,inp.pumpRateLs)/1000*60; // m3 / min
 const j=Math.max(0,inp.injectivity.length&&res.fit?res.fit.J:0);
 const pOpen=res.fit?.openingBhpMPa ?? spot.estimatedMinBhpMPa;
 let t=0, vPump=0, vChannel=0, vCement=0,pSurface=0;
 const point=(name:string,q=0)=>{
   const remaining=Math.max(0,placed-vCement);
   const belowFrac=placed>0?(t <= placed/qSet + 0.001 ? Math.min(1,vPump/placed) : remaining/placed):0;
   const allowance=Math.max(0,cap);
   points.push({t:Math.round(t*100)/100,stage:name,qLs:q,surfaceMPa:pSurface,bhpMPa:pSurface+hyd,
    vPumped:vPump,vChannel,vCompChannel:vCement,compTop:-1,compBottom:-1,belowComp:Math.min(1,belowFrac),
    channelFill:spot.plannedSqueezeM3>0?vCement/spot.plannedSqueezeM3:0,
    mobility:Math.max(0.001,1-vCement/Math.max(0.01,placed))*Math.max(.05,1-t/Math.max(1,workingLife)),
    allowSurfaceMPa:allowance});
 };
 const phase=(name:string,minutes:number,kind:"pump"|"hold"|"squeeze",onTick?:(step:number)=>void)=>{
   const t0=t,steps=Math.max(1,Math.ceil(minutes/0.5)),dt=minutes/steps;
   for(let k=0;k<steps;k++){if(onTick)onTick(dt);t+=dt;point(name,kind==="hold"?0:inp.pumpRateLs);}
   stages.push({name,t0,t1:t,kind});
 };
 point("Начало");
 if(!spot.ok||cap<=0||!res.fit){
   warnings.push(...spot.errors);
   if(!res.fit) warnings.push("Нужны результаты фактического определения приёмистости до задавливания.");
   point("Блокировка: неполные или недопустимые данные");
   return {points,stages,holds,outcome:"no_squeeze",
     outcomeText:"Окно задавливания не подтверждено. Проверить геометрию, ПВО, колонну, гидростатику и приёмистость.",
     finalSurfaceMPa:0,compInChannelM3:0,totalTimeMin:t,workLifeUsedPct:0,warnings};
 }
 phase("Размещение цементной пачки",Math.max(1,placed/qSet),"pump",dt=>{vPump=Math.min(placed,vPump+qSet*dt);});
 phase("Подъём НКТ выше пачки",5,"hold");
 phase("Закрытие и проверка ПВО",3,"hold");
 const n=Math.max(1,Math.min(30,Math.round(inp.hesitationStages)));
 let noFlow=false;
 for(let k=1;k<=n;k++){
   const target=spot.plannedSqueezeM3/n;
   let pumped=0;
   const start=t, steps=Math.max(1,Math.ceil(target/qSet/0.5));
   for(let si=0;si<steps;si++){
     const remaining=target-pumped;
     if(remaining<=1e-9) break;
     const mobility=Math.max(0.03,1-0.85*vCement/Math.max(.01,spot.plannedSqueezeM3));
     // Use water injectivity as an upper bound. Cement mobility is not known without a lab.
     const rateMaxM3min=Math.max(0,j*(Math.max(0,cap+hyd-pOpen)))*mobility/60;
     const dv=Math.min(remaining,qSet*0.5,rateMaxM3min*0.5);
     if(dv<=1e-9){noFlow=true;break;}
     pumped+=dv;vPump+=dv;vChannel+=dv;vCement+=dv;
     pSurface=Math.max(0,Math.min(cap,pOpen+dv*120/Math.max(j*mobility,1e-9)-hyd));
     t+=0.5;point(`Ступень ${k}`,dv/0.5*1000/60);
   }
   stages.push({name:`Ступень ${k}`,t0:start,t1:t,kind:"squeeze"});
   const pStart=pSurface,h0=t;const holdSteps=Math.ceil(Math.max(0,inp.hesitationHoldMin)/0.5);
   for(let h=0;h<holdSteps;h++){pSurface=Math.max(0,pSurface*(1-0.002));t+=0.5;point(`Выдержка ${k}`,0);}
   stages.push({name:`Выдержка ${k}`,t0:h0,t1:t,kind:"hold"});
   const decay=pStart>0?(pStart-pSurface)/pStart*100:100;
   holds.push({stage:k,pStart,pEnd:pSurface,decayPct:decay});
   if(noFlow)break;
 }
 const share=spot.plannedSqueezeM3>0?vCement/spot.plannedSqueezeM3:0;
 const outcome: SqueezeSimResult["outcome"]=vCement<=0?"no_squeeze":"partial";
 const outcomeText=vCement<=0?"В принятом окне состав не поступает в нарушение. Требуется уточнение приёмистости и свойств смеси."
  :`По предварительному сценарию в заколонный дефект поступило ${vCement.toFixed(3)} м³ из плановых ${spot.plannedSqueezeM3.toFixed(3)} м³ (${(share*100).toFixed(0)}%). Герметичность не подтверждена, необходимы контрольные испытания.`;
 return {points,stages,holds,outcome,outcomeText,finalSurfaceMPa:pSurface,compInChannelM3:vCement,
  totalTimeMin:t,workLifeUsedPct:t/Math.max(1,workingLife)*100,warnings};
}
