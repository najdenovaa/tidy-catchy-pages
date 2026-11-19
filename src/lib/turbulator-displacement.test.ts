import {it,expect} from 'vitest';
import {simulateDisplacement2D,type D2Input} from './displacement-2d';
import {buildDisplacementInput} from './displacement-2d-input';
import {getCementingExample} from './cementing-example';
import {calculateVolumes} from './cementing-calculations';
it('adds circumferential flux on the full annulus and preserves the displacement volume balance',()=>{
 const input:D2Input={zTop:0,zBot:20,geom:()=>({rHole:.12,rCasing:.09,standoff:1,inclDeg:0}),fluids:[{name:'mud',density:1100,pv:.025,yp:2,kind:'mud'},{name:'cement',density:1800,pv:.05,yp:4,kind:'cement'}],stages:[{fluid:1,rateM3s:.005,volumeM3:.1}],nZ:20,nTheta:6,maxTimeStepS:1,swirlVelocity:(md,q)=>md<10&&q>0?.1:0};
 const r=simulateDisplacement2D(input);
 expect(r.nTheta).toBe(12);
 expect(JSON.stringify(r)).not.toContain('NaN');
 expect(Math.abs(r.summary.massBalanceErrPct)).toBeLessThan(.01);
 const balance=r.snapshots.at(-1)!.balance!;expect(balance.unexplainedM3.every(v=>Math.abs(v)<1e-6)).toBe(true);
});
it('builds the same rate- and fluid-dependent swirl field for the actual 2D worker input',()=>{
 const e=getCementingExample();const w={...e.wellData,annularStandoffPct:100,standoffProfile:undefined,turbulatorDesign:{points:[{id:'a',md:1000,bladesCount:6,bladeAngle:55,bladeHeight:15,bladeWidthMm:15}],fluidId:'mud',rateLps:null,threshold:.001,turningEfficiency:.5}};
 const out=buildDisplacementInput({...e,wellData:w,volumes:calculateVolumes(w,e.slurries)});
 expect(out.input.swirlVelocity).toBeTypeOf('function');
 expect(out.input.swirlVelocity!(1001,.01,0)).toBe(0);
 expect(out.input.swirlVelocity!(999,0,0)).toBe(0);
 expect(out.meta.notes.join(' ')).toContain('Перекрытие зон');
});
