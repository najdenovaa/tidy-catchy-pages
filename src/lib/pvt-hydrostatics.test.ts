import {it,expect} from 'vitest';
import {liquidHydrostaticStep,evaluatePvtHydrostatics,pvtHydrostaticsCsv,pvtProfileCsv} from './pvt-hydrostatics';
import {getCementingExample} from './cementing-example';
import {calculatePressureProfile,calculateVolumes} from './cementing-calculations';
import {normalizeCementingSnapshot} from './cementing-normalizers';
import {pvtHydrostaticReportCharts} from './cementing-report-charts';
import {allowedReportFigure} from './cementing-report-options';
import type {StopStorageSettings} from './stop-storage';
const pvt:StopStorageSettings={enabled:false,hydrostaticsEnabled:true,referencePressureMPa:0,surfaceBackpressureMPa:0,pressureRiseMPa:0,rateLps:0,youngModulusMPa:0,poissonRatio:0,restraint:'fixedLength',bulkModuliMPa:{mud:2000,buffer:2200,cement:3000,displacement:2200},source:'PVT QA'};
it('matches compressible hydrostatics, the rigid limit and dP/dz = rho g',()=>{
 const r=liquidHydrostaticStep(1000,2000,0,0,3000,30);expect(r.bottomPressureMPa).toBeCloseTo(-2000*Math.log(1-1000*9.81*3000/(2000e6)),11);
 expect(r.massKg).toBeCloseTo(r.bottomPressureMPa*1e6/9.81*.01,7);
 expect(liquidHydrostaticStep(1000,1e20,0,0,3000,30).bottomPressureMPa).toBeCloseTo(29.43,10);
 const epsilon=1e-3,extra=liquidHydrostaticStep(1000,2000,0,r.bottomPressureMPa,epsilon,.01*epsilon);expect((extra.bottomPressureMPa-r.bottomPressureMPa)/epsilon*1e6).toBeCloseTo(r.bottomDensityKgM3*9.81,2);
});
it('is invariant under subdivision and a consistent change of pressure reference',()=>{
 const whole=liquidHydrostaticStep(1100,2500,0,3,2000,40);let p=3,mass=0;
 for(let i=0;i<100;i++){const r=liquidHydrostaticStep(1100,2500,0,p,20,.4);p=r.bottomPressureMPa;mass+=r.massKg;}
 expect(p).toBeCloseTo(whole.bottomPressureMPa,10);expect(mass).toBeCloseTo(whole.massKg,6);
 const ref=liquidHydrostaticStep(1100*Math.exp(5/2500),2500,5,3,2000,40);expect(ref.bottomPressureMPa).toBeCloseTo(p,10);expect(ref.massKg).toBeCloseTo(mass,6);
});
it('handles horizontal and upgoing segments without losing mass sign',()=>{
 const horizontal=liquidHydrostaticStep(1000,2000,0,20,0,10);expect(horizontal.bottomPressureMPa).toBe(20);expect(horizontal.massKg).toBeCloseTo(10000*Math.exp(.01),8);
 const down=liquidHydrostaticStep(1000,2000,0,3,100,10),up=liquidHydrostaticStep(1000,2000,0,down.bottomPressureMPa,-100,10);expect(up.bottomPressureMPa).toBeCloseTo(3,10);expect(up.massKg).toBeGreaterThan(0);
});
it('rejects missing/invalid K, unsupported excursion and singular columns',()=>{
 expect(()=>liquidHydrostaticStep(1000,0,0,0,10,1)).toThrow();expect(()=>liquidHydrostaticStep(1000,1,0,0,10000,1)).toThrow(/Сингулярность/);expect(()=>liquidHydrostaticStep(1000,10,0,2,0,1)).toThrow(/10%/);expect(()=>liquidHydrostaticStep(1000,2000,0,0,-10,1)).toThrow(/Отрицательное/);
});
function example(){const input=getCementingExample(),v=calculateVolumes(input.wellData,input.slurries,input.displacementFluids[0].compressionCoeff);const run=(settings?:StopStorageSettings)=>calculatePressureProfile({...input.wellData,stopStorage:settings},input.slurries,input.buffers,input.drillingFluid,input.displacementFluids,input.fractureGradient,v.displacementVolumeWithCompression,2.5,3);return {input,run};}
it('evaluates every frame with common geometry while leaving main mass, return, and stop unchanged',()=>{
 const {run}=example(),base=run(),r=run(pvt),a=r.pvtHydrostatics;expect(a.status).toBe('ready');expect(a.curve.length).toBe(r.points.length);expect(a.maxPressureDifferenceMPa).toBeGreaterThan(0);expect(a.maxDensityChangePct).toBeGreaterThan(0);expect(r.points).toEqual(base.points);expect(r.inventory).toEqual(base.inventory);expect(r.stopTime).toBe(base.stopTime);expect(r.stopStorage).toBeUndefined();
 for(const c of [...a.finalAnnulus,...a.finalPipe])expect(c.massKg).toBeGreaterThan(0);
 expect(a.finalAnnulus.reduce((n,c)=>n+c.volumeM3,0)).toBeCloseTo(r.inventory.annulusCapacityM3,6);
 expect(pvtHydrostaticsCsv(a)).toContain('ann_equilibrium_mass_kg');expect(pvtProfileCsv(a)).toContain('bulk_modulus_mpa');expect(pvtProfileCsv(a)).toContain('PVT QA');const figures=pvtHydrostaticReportCharts(a);expect(figures).toHaveLength(2);expect(figures.every(f=>!(/NaN|Infinity/.test(f.svg)))).toBe(true);expect(allowedReportFigure('cementing',{pvtHydrostatics:false},figures[0])).toBe(false);expect(allowedReportFigure('running',undefined,figures[0])).toBe(false);
});
it('persists optional settings and makes missing properties visible without partial success',()=>{
 const {input,run}=example(),normalized=normalizeCementingSnapshot({...input,wellData:{...input.wellData,stopStorage:pvt}});expect(normalized.wellData.stopStorage).toEqual(pvt);
 const r=run({...pvt,bulkModuliMPa:{}}).pvtHydrostatics;expect(r.status).toBe('unavailable');expect(r.curve).toEqual([]);expect(r.issues.join(' ')).toContain('K');
 expect(evaluatePvtHydrostatics(input.wellData,[],[])).toBeUndefined();expect(evaluatePvtHydrostatics({...input.wellData,stopStorage:pvt},[],[]).status).toBe('unavailable');
});
