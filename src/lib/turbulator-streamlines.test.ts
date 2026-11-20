import {it,expect} from 'vitest';
import {getCementingExample} from './cementing-example';
import {calculateTurbulatorFlow} from './turbulator-flow';
import {turbulatorMeanAt,turbulatorTrace} from './turbulator-streamlines';
const well={...getCementingExample().wellData,casingOD:178,holeDiameter:250,cavernCoeff:1,prevCasingDepth:0,annularStandoffPct:100,standoffProfile:undefined,casingDepthMD:300};
const point={id:'a',md:150,bladesCount:6,bladeAngle:55,bladeHeight:20,bladeWidthMm:15};
const fluid={id:'mud',name:'БР',density:1200,rheology:{pv:25,yp:5}};
it('traces only the computed radial field, with no added pulsations or display gain',()=>{
 const result=calculateTurbulatorFlow(well,point,60,fluid),snapshot=JSON.stringify(result);
 const trace=turbulatorTrace(result,178,-.36,1,0);
 expect(trace.every(v=>JSON.stringify(v.mean)===JSON.stringify(v.particle))).toBe(true);
 expect(trace.at(-1)!.physicalPhase).toBeGreaterThan(0);
 const noRibs=calculateTurbulatorFlow(well,{...point,bladeAngle:0},60,fluid);
 expect(turbulatorTrace(noRibs,178,-.36,1,0).at(-1)!.physicalPhase).toBe(0);
 const other=turbulatorTrace(result,178,-.36,1,1);
 expect(other.at(-1)!.physicalPhase).not.toBe(trace.at(-1)!.physicalPhase);
 expect(JSON.stringify(result)).toBe(snapshot);
 for(const v of trace){const r=Math.hypot(v.particle[0],v.particle[1]);expect(r).toBeGreaterThan(178/2000);expect(r).toBeLessThan(250/2000);}
 expect(turbulatorTrace({...result,axialMs:0},178,-.36,1,0)).toEqual([]);
});
it('uses the vane-region solution continuously into the wake and stops displaying sub-0.1% residuals',()=>{
 const r=calculateTurbulatorFlow(well,point,10,fluid);
 expect(turbulatorMeanAt(r,-.1,178).tangentialMs).toBeGreaterThan(0);
 expect(turbulatorMeanAt(r,.1,178).tangentialMs).toBeGreaterThan(0);
 const left=turbulatorMeanAt(r,-1e-7,178),right=turbulatorMeanAt(r,1e-7,178);
 // Sleeve exit expands the flow section; specific angular momentum is conserved by remapping.
 expect(left.tangentialMs*left.radiusM).toBeCloseTo(right.tangentialMs*right.radiusM,2);
 expect(turbulatorMeanAt(r,r.lengthM+.1,178).tangentialMs).toBe(0);
 const slow=turbulatorTrace(r,178,-.36,1,0),fast=turbulatorTrace(calculateTurbulatorFlow(well,point,20,fluid),178,-.36,1,0);
 expect(fast.at(-1)!.travelS).toBeCloseTo(slow.at(-1)!.travelS/2,8);
 expect(fast.at(-1)!.physicalPhase).toBeGreaterThan(slow.at(-1)!.physicalPhase);
});
