import {it,expect} from 'vitest';
import {advanceSwirl,swirlStats,generateSwirl,remapSwirl,type SwirlState} from './swirl-transport';
import {getCementingExample} from './cementing-example';
import {calculateTurbulatorFlow} from './turbulator-flow';
it('matches the independent thin-gap laminar diffusion solution and preserves zero without a vane source',()=>{
 const innerM=10,outerM=10.001,n=40,h=outerM-innerM,q=.001,rho=1200,mu=.01;
 const fluid={density:rho,hb:{tau0:0,K:mu,n:1}};
 let s:SwirlState={innerM,outerM,omega:Array.from({length:n},(_,i)=>Math.sin(Math.PI*(i+.5)/n)/(innerM+(i+.5)*h/n))};
 const initial=swirlStats(s,q),u=q/(Math.PI*(outerM**2-innerM**2)),distance=.5*u*h*h/(Math.PI**2*(mu/rho));
 for(let i=0;i<100;i++)s=advanceSwirl(s,distance/100,q,fluid);
 expect(swirlStats(s,q).meanMs/initial.meanMs).toBeCloseTo(Math.exp(-.5),2);
 expect(swirlStats(s,q).moment).toBeLessThan(initial.moment);
 const zero=advanceSwirl({...s,omega:Array(n).fill(0)},distance,q,fluid);
 expect(swirlStats(zero,q).meanMs).toBe(0);
});
it('generates rotation from the actual guide geometry and increases absolute swirl with pump rate',()=>{
 const g={innerM:.089,outerM:.125},b={count:4,angleDeg:45,heightM:.02,widthM:.008,lengthM:.18,sleeveM:.003};
 const f={density:1200,hb:{tau0:5,K:.025,n:1}};
 const a=generateSwirl(g,b,.01,f),high=generateSwirl(g,b,.02,f);
 expect(swirlStats(a.state,.01).meanMs).toBeGreaterThan(0);
 expect(swirlStats(high.state,.02).meanMs).toBeGreaterThan(swirlStats(a.state,.01).meanMs);
 expect(swirlStats(generateSwirl(g,{...b,angleDeg:0},.01,f).state,.01).meanMs).toBe(0);
 expect(swirlStats(generateSwirl(g,{...b,lengthM:.36},.01,f).state,.01).meanMs).toBeGreaterThan(swirlStats(a.state,.01).meanMs);
 const refined=generateSwirl(g,b,.01,f,40);
 expect(Math.abs(swirlStats(refined.state,.01).moment/swirlStats(a.state,.01).moment-1)).toBeLessThan(.12);
 const expanded=remapSwirl(a.state,{...g,outerM:.15});
 expect(swirlStats(expanded,.01).moment).toBeCloseTo(swirlStats(a.state,.01).moment,12);
 const before=swirlStats(a.state,.01),after=swirlStats(advanceSwirl(a.state,.05,.01,f),.01);
 expect(after.rmsMs).toBeLessThan(before.rmsMs);
 expect(after.moment).toBeLessThan(before.moment);
});
it('reports the calculated wake for a representative cementing annulus',()=>{
 const w={...getCementingExample().wellData,casingOD:178,holeDiameter:250,cavernCoeff:1,prevCasingDepth:0,annularStandoffPct:100,standoffProfile:undefined,casingDepthMD:300};
 const p={id:'a',md:150,bladesCount:4,bladeAngle:45,bladeHeight:20};
 const fluid={id:'mud',name:'БР',density:1200,rheology:{pv:25,yp:5}};
 const values=[10,20,60].map(q=>{const r=calculateTurbulatorFlow(w,p,q,fluid);return {q,v:r.tangentialMs,L:r.lengthM,L90:r.decay90M,L99:r.decay99M,residual:r.residualFraction,steps:r.samples.length};});

 expect(values[1].v).toBeGreaterThan(values[0].v);
 expect(values.every(v=>v.L>0)).toBe(true);
});
