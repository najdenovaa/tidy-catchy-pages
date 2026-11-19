import {it,expect} from 'vitest';
import {getCementingExample} from './cementing-example';
import {calculateCentralization,autoPlaceCentralizers,type CentralizerInterval} from './centralization-calculations';
import {calculateCasingRunning,normalizeRunningSettings} from './casing-running-analysis';
import {calculateRunningForces} from './casing-running-forces';
import {mechanicalSurvey,normalLineLoad,surveyCurvature,freeAxialWeight} from './casing-survey-mechanics';
import {buildCentralizerJointSchedule} from './centralizer-layout';
const rad=Math.PI/180,G=9.80665;
const well=()=>({...getCementingExample().wellData,casingDepthMD:120,wellDepthMD:120,wellDepthTVD:100,casingOD:168.3,casingWall:8.9,holeDiameter:215.9,prevCasingDepth:0,prevCasingID:244.5,cavernCoeff:1,cavernIntervals:[],casingSections:[],trajectory:[{md:0,tvd:0,zenith:30,azimuth:0},{md:120,tvd:120*Math.cos(30*rad),zenith:30,azimuth:0}]});
const spec={type:'spring' as const,bladesCount:6,bladeHeight:30,restoringForce:8,maxAxialLoad:0,passport:{model:'Analytical control',outerDiameter:240,restoringForceKgf:8/.00980665,restoringStandoff:67,ringOD:185,runningForceKgf:0}};
const intervals=():CentralizerInterval[]=>[{id:'control',fromMD:0,toMD:120,jointLength:12,centralizersPerJoint:1,spec}];
function buoyantWeight(){const od=.1683,id=.1683-2*.0089;return Math.PI/4*(od*od-id*id)*(7850-1100)*G;}

it('F17: an azimuth turn produces the analytical extra side load and reduces standoff at unchanged inclination',()=>{
 const w=well(),plain=calculateCentralization(w,intervals(),1100).find(p=>p.md===60)!;
 w.trajectory[1].azimuth=30;
 const turn=calculateCentralization(w,intervals(),1100).find(p=>p.md===60)!;
 const q=buoyantWeight()*.5*Math.hypot(1,60*Math.cos(30*rad)*30*rad/120);
 expect(turn.lateralLoadKN).toBeCloseTo(q*12/1000,9);
 expect(turn.lateralLoadKN).toBeGreaterThan(plain.lateralLoadKN!);
 expect(turn.standoff).toBeLessThan(plain.standoff);
});
it('F17: build and drop loads retain direction and use the weight of the actual lower trajectory',()=>{
 for(const angles of [[20,40],[40,20]]){
  const w=well();w.trajectory[0].zenith=angles[0];w.trajectory[1].zenith=angles[1];
  // Independent fine midpoint quadrature of the remaining buoyed weight.
  let T=0;for(let j=0;j<6000;j++)T+=buoyantWeight()*.01*Math.cos((angles[0]+(angles[1]-angles[0])*(60+(j+.5)*.01)/120)*rad);
  const expected=Math.abs(buoyantWeight()*.5+T*(angles[1]-angles[0])*rad/120)*12/1000;
  expect(calculateCentralization(w,intervals(),1100).find(p=>p.md===60)!.lateralLoadKN).toBeCloseTo(expected,7);
 }
 const c={inclinationPerM:-.01,azimuthPerM:0,dlsDegPer30m:0};
 expect(normalLineLoad(100,30,5000,c)).toBeCloseTo(0,10);
});
it('F17: shortest azimuth interpolation preserves north crossing in both profile and automatic placement',()=>{
 const w=well();w.trajectory[0].azimuth=359;w.trajectory[1].azimuth=1;
 expect(mechanicalSurvey(w.trajectory,60).azimuth).toBe(360);
 expect(surveyCurvature(w.trajectory,60,120).dlsDegPer30m).toBeLessThan(.3);
 const a=calculateCentralization(w,intervals(),1100),p=autoPlaceCentralizers(w,spec,12,67,1100);
 w.trajectory[0].azimuth=-1;
 const b=calculateCentralization(w,intervals(),1100);b.forEach((v,j)=>{expect(v.standoff).toBe(a[j].standoff);expect(v.lateralLoadKN).toBeCloseTo(a[j].lateralLoadKN!,10);});
 expect(autoPlaceCentralizers(w,spec,12,67,1100)).toEqual(p);
});
it('F17: axial weight is an integral, with continued terminal inclination and TVD',()=>{
 const t=[{md:0,tvd:0,zenith:0,azimuth:0},{md:100,tvd:90,zenith:60,azimuth:0}];
 expect(freeAxialWeight(t,0,100,100)).toBeCloseTo(10000*Math.sin(Math.PI/3)/(Math.PI/3),9);
 expect(mechanicalSurvey(t,120).tvd).toBeCloseTo(100,10);
});

/** Independent RK4 integration of the differential soft-string balance, not the production midpoint iteration. */
function referenceLoad(L:number,w:number,mu:number,sign:number,angle:(z:number)=>number,di:number,da:number){
 const dx=.05,n=Math.round(L/dx);let T=0;
 const f=(x:number,t:number)=>{const i=angle(L-x);return w*Math.cos(i)+sign*mu*Math.hypot(w*Math.sin(i)+t*di,t*Math.sin(i)*da);};
 for(let j=0;j<n;j++){const x=j*dx,k1=f(x,T),k2=f(x+dx/2,T+k1*dx/2),k3=f(x+dx/2,T+k2*dx/2),k4=f(x+dx,T+k3*dx);T+=dx*(k1+2*k2+2*k3+k4)/6;}
 return T/1000;
}
it('F14: build/drop/azimuth running and pickup agree with independent fine-step RK4 balances',()=>{
 for(const [ia,ib,az]of [[10,50,0],[50,10,0],[40,40,60]]){
  const w=well();w.casingDepthMD=w.wellDepthMD=500;w.trajectory=[{md:0,tvd:0,zenith:ia,azimuth:0},{md:500,tvd:400,zenith:ib,azimuth:az}];
  const mu=.2,a=calculateCasingRunning({well:w,mudDensity:1100,intervals:[],pv:0,yp:0,settings:normalizeRunningSettings({frictionCased:mu,frictionOpenhole:mu,speedMps:0})});
  for(const [sign,value]of [[-1,a.final!.runIn*G],[1,a.final!.pullOut*G]]){
   const ref=referenceLoad(500,buoyantWeight(),mu,sign,z=>(ia+(ib-ia)*z/500)*rad,(ib-ia)*rad/500,az*rad/500);
   expect(Math.abs(value-ref)/ref).toBeLessThan(1e-4);
  }
 }
});
it('F14: compatibility status cannot call an oversized rigid centralizer free-running',()=>{
 const w=well();w.trajectory.forEach(p=>p.zenith=0);const iv=intervals();iv[0].spec={...spec,type:'rigid',passport:{...spec.passport,outerDiameter:230}};
 const r=calculateRunningForces({wellData:w,mudDensity:1100,frictionCoeff:.2,centralizerIntervals:iv,centralization:[]});
 expect(r.willRunFreely).toBe(false);
});
it('F14: a short caliper restriction is detected along the whole tool path between broomstick samples',()=>{
 const w=well();w.holeDiameter=300;w.trajectory.forEach(p=>p.zenith=0);w.cavernIntervals=[{fromMD:31.1,toMD:31.3,coeff:1,diameterMm:200}];
 const iv=intervals();iv[0].spec={...spec,type:'rigid',passport:{...spec.passport,outerDiameter:230}};
 const r=calculateCasingRunning({well:w,mudDensity:1100,intervals:iv,pv:0,yp:0,settings:normalizeRunningSettings({speedMps:0})});
 const deepest=Math.max(...buildCentralizerJointSchedule(120,iv).flatMap(row=>row.placements.map(p=>p.md)));
 expect(r.firstPassageConflictMD).toBeCloseTo(120-deepest+31.1,10);
 expect(r.notes.join(' ')).toContain('Непрерывный геометрический контроль');
});
