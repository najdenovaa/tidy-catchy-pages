import {it,expect} from 'vitest';
import {getCementingExample} from './cementing-example';
import {calculatePressureProfile,calculateVolumes} from './cementing-calculations';
function run(flushTimeMin=2.5){const p=getCementingExample(),v=calculateVolumes(p.wellData,p.slurries,p.displacementFluids[0].compressionCoeff);return {p,v,r:calculatePressureProfile(p.wellData,p.slurries,p.buffers,p.drillingFluid,p.displacementFluids,p.fractureGradient,v.displacementVolumeWithCompression,flushTimeMin,flushTimeMin>0?3:0)};}
it('closes component and geometry balances at every frame; return integral matches retained inventory',()=>{
 const {r}=run(),a=r.inventory;expect(a.maxStepResidualKg).toBeLessThan(1e-5);expect(a.maxStepResidualM3).toBeLessThan(1e-8);
 let returned=0,pumped=0;for(let i=1;i<r.points.length;i++){const q=r.points[i],prev=r.points[i-1],dt=q.time-prev.time;returned+=q.annularReturnRate*dt*.06;pumped+=q.pumpRateLps*dt*.06;
  expect(q.cumulativeReturnM3).toBeCloseTo(returned,7);expect(q.cumulativeVolume).toBeCloseTo(pumped,7);expect(q.inventoryResidualKg).toBeLessThan(1e-5);
  expect(q.transportColumns.pipe.reduce((n,b)=>n+b.volumeM3,0)).toBeCloseTo(a.pipeCapacityM3,7);expect(q.transportColumns.annulus.reduce((n,b)=>n+b.volumeM3,0)).toBeCloseTo(a.annulusCapacityM3,7);
 }
 expect(a.returnedM3).toBeCloseTo(returned,7);expect(a.injectedM3).toBeCloseTo(pumped,7);expect(a.injectedM3+a.pipeVoidM3).toBeCloseTo(a.returnedM3,7);
 const initialMass=a.fluids.reduce((n,f)=>n+f.initialM3*f.densityKgM3,0),inputMass=a.fluids.reduce((n,f)=>n+f.injectedM3*f.densityKgM3,0);expect(initialMass+inputMass-a.retainedMassKg-a.returnedMassKg).toBeCloseTo(0,5);
});
it('uses geometry for the incompressible plug stop and keeps compression allowance out of annular inventory',()=>{
 const {r,v}=run(0);expect(r.inventory.fluids.filter(f=>f.fluidType==='displacement').reduce((n,f)=>n+f.injectedM3,0)).toBeCloseTo(v.displacementVolume,7);
 expect(r.processAudit.differenceM3).toBeLessThan(0);expect(r.inventory.fluids.filter(f=>f.fluidType==='displacement').every(f=>f.annulusM3<1e-8&&f.returnedM3<1e-8)).toBe(true);
 expect(r.points.filter(p=>p.time>r.stopTime).every(p=>p.pumpRateLps===0&&p.annularReturnRate===0)).toBe(true);
});
it('tracks pause drainage without surface input and makes fractional catch-up returns conservative',()=>{
 const {r}=run(2.5),pause=r.points.filter(p=>p.processKind==='surfaceFlush');expect(pause.length).toBe(3);expect(pause.at(-1).pipeVoidM3).toBeGreaterThan(0);expect(pause.every(p=>p.pumpRateLps===0)).toBe(true);
 expect(pause.at(-1).pipeVoidM3).toBeCloseTo(pause.at(-1).freefallSettledM3,8);
 const catchup=r.points.filter(p=>p.processKind==='displacement'&&p.pipeVoidM3>1e-7);expect(catchup.length).toBeGreaterThan(0);expect(catchup.every(p=>p.annularReturnRate<1e-7&&p.surfacePressure===0)).toBe(true);
});

it('never injects service wash into the well even for invalid legacy zero-duration input',()=>{
 const p=getCementingExample(),v=calculateVolumes(p.wellData,p.slurries,p.displacementFluids[0].compressionCoeff);
 const r=calculatePressureProfile(p.wellData,p.slurries,p.buffers,p.drillingFluid,p.displacementFluids,p.fractureGradient,v.displacementVolumeWithCompression,0,3);
 expect(r.processContract.canRun).toBe(false);expect(r.inventory.fluids.some(f=>f.fluidId==='serviceWater:0')).toBe(false);
 expect(r.inventory.injectedM3).toBeCloseTo(r.processContract.wellVolumeM3-(v.displacementVolumeWithCompression-v.displacementVolume),6);
});
