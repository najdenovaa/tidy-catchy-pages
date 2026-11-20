import {it,expect} from 'vitest';
import {getCementingExample} from './cementing-example';
import {calculateTurbulatorFlow,defaultTurbulatorDesign} from './turbulator-flow';
import {turbulatorMeanAt,turbulatorTrace} from './turbulator-streamlines';
const well={...getCementingExample().wellData,casingOD:178,holeDiameter:250,cavernCoeff:1,prevCasingDepth:0,annularStandoffPct:100,standoffProfile:undefined,casingDepthMD:300};
const point={id:'a',md:150,bladesCount:6,bladeAngle:55,bladeHeight:20,bladeWidthMm:15};
const fluid={id:'mud',name:'БР',density:1200,rheology:{pv:25,yp:5}};
it('separates computed mean swirl from schematic turbulent fluctuations and display gain',()=>{
 const result=calculateTurbulatorFlow(well,point,60,fluid),snapshot=JSON.stringify(result);
 const straight=turbulatorTrace({...result,regime:0},178,-.3,1,0,1,true);
 expect(straight.every(v=>JSON.stringify(v.mean)===JSON.stringify(v.particle))).toBe(true);
 const turbulent=turbulatorTrace({...result,regime:1},178,-.3,1,0,1,true);
 expect(turbulent.some((v,i)=>JSON.stringify(v.particle)!==JSON.stringify(straight[i].particle))).toBe(true);
 expect(turbulent.map(v=>v.mean)).toEqual(straight.map(v=>v.mean));
 const enlarged=turbulatorTrace({...result,regime:1},178,-.3,1,0,10,true);
 expect(enlarged.at(-1)!.physicalPhase).toBe(turbulent.at(-1)!.physicalPhase);
 expect(enlarged.at(-1)!.mean).not.toEqual(turbulent.at(-1)!.mean);
 expect(enlarged.at(-1)!.travelS).toBe(turbulent.at(-1)!.travelS);
 expect(JSON.stringify(result)).toBe(snapshot);
 for(const v of turbulent){const r=Math.hypot(v.particle[0],v.particle[1]);expect(r).toBeGreaterThan(178/2000);expect(r).toBeLessThan(250/2000);}
 expect(turbulatorTrace({...result,axialMs:0},178,-.3,1,0)).toEqual([]);
});
it('retains small below-threshold swirl and continues phase smoothly beyond influence cutoff',()=>{
 const r=calculateTurbulatorFlow(well,point,10,fluid,{...defaultTurbulatorDesign(),threshold:.9});
 expect(r.samples).toHaveLength(0);
 expect(turbulatorMeanAt(r,.1,178).phase).toBeGreaterThan(0);
 const full=calculateTurbulatorFlow(well,point,10,fluid),end=full.samples.at(-1)!;
 const tail=turbulatorMeanAt(full,end.distanceM+.01,178);
 expect(tail.phase).toBeGreaterThan(end.phase);
 expect(tail.tangentialMs).toBeLessThan(end.tangentialMs);
 expect(turbulatorMeanAt(full,end.distanceM+1e-7,178).phase).toBeCloseTo(end.phase,6);
 const fast=calculateTurbulatorFlow(well,point,20,fluid);
 expect(turbulatorTrace(fast,178,-.3,1,0).at(-1)!.travelS).toBeCloseTo(turbulatorTrace(full,178,-.3,1,0).at(-1)!.travelS/2,9);
});
