import {it,expect} from 'vitest';
import {evaluateStopStorage,steelVolumeCompliance,normalizeStopStorage,stopStorageCsv,type StopStorageSettings} from './stop-storage';
import {getCementingExample} from './cementing-example';
import {totalPipeVolumeForRange,calculateVolumes,calculatePressureProfile,type WellData,type PressurePoint} from './cementing-calculations';
import {normalizeCementingSnapshot} from './cementing-normalizers';
import {stopStorageReportCharts} from './cementing-report-charts';
import {allowedReportFigure} from './cementing-report-options';
const settings:StopStorageSettings={enabled:true,pressureRiseMPa:5,rateLps:.2,youngModulusMPa:200000,poissonRatio:.3,restraint:'fixedLength',bulkModuliMPa:{displacement:2200},source:'PVT sample'};
function fixture(){
 const w:WellData={...getCementingExample().wellData,casingDepthMD:10,ckodDepth:10,casingOD:200,casingWall:10,casingSections:[],stopStorage:structuredClone(settings)};
 const volume=totalPipeVolumeForRange(0,10,200,10),columns:PressurePoint['transportColumns']={pipe:[{fluidId:'displacement:0',fluidType:'displacement',topMD:0,botMD:10,volumeM3:volume}],annulus:[]};
 const fluids=[{id:'displacement:0',kind:'displacement' as const,index:0,name:'Water',densityKgM3:1000,rheology:{pv:1,yp:0}}];return {w,columns,fluids,volume};
}
it('matches the independent ADINA/Timoshenko thick-cylinder plane-strain benchmark',()=>{
 const compliance=steelVolumeCompliance(1,2000,500,200000,.3,'fixedLength');
 const displacementAtInnerRadius=.5*compliance/2*10;
 expect(displacementAtInnerRadius).toBeCloseTo(4.766666666666667e-5,12);
 expect(steelVolumeCompliance(1,2000,500,200000,.3,'closedEnds')).toBeGreaterThan(compliance);
});
it('matches exact constant-bulk-modulus storage in the rigid single-fluid limit',()=>{
 const {w,columns,fluids,volume}=fixture();w.stopStorage.youngModulusMPa=1e30;
 const r=evaluateStopStorage(w,columns,fluids,'displacement:0',true);expect(r.status).toBe('ready');const p=r.curve.at(-1);
 expect(p.injectedReferenceM3).toBeCloseTo(volume*Math.expm1(5/2200),12);expect(p.steelExpansionReferenceM3).toBeLessThan(1e-20);
 expect(p.timeMin).toBeCloseTo(p.injectedReferenceM3/(.2*.06),12);
});
it('closes volume and mass with different bulk moduli and pump density, and accounts for pipe sections',()=>{
 const {w,columns,fluids}=fixture();w.casingSections=[{fromMD:0,toMD:5,wallThickness:20}];w.stopStorage.bulkModuliMPa.cement=1000;
 columns.pipe=[{fluidId:'displacement:0',fluidType:'displacement',topMD:0,botMD:5,volumeM3:0},{fluidId:'cement:0',fluidType:'cement',topMD:5,botMD:10,volumeM3:0}];
 const f=[...fluids,{id:'cement:0',kind:'cement' as const,index:0,name:'Cement',densityKgM3:1850,rheology:{pv:80,yp:8}}];
 const r=evaluateStopStorage(w,columns,f,'displacement:0',true);expect(r.status).toBe('ready');
 const expected=steelVolumeCompliance(totalPipeVolumeForRange(0,5,200,20),200,20,200000,.3,'fixedLength')+steelVolumeCompliance(totalPipeVolumeForRange(5,10,200,10),200,10,200000,.3,'fixedLength');expect(r.steelComplianceM3PerMPa).toBeCloseTo(expected,12);
 for(const [i,p]of r.curve.entries()){expect(Math.abs(p.residualM3)).toBeLessThan(1e-12);expect(Math.abs(p.residualKg)).toBeLessThan(1e-10);if(i)expect(p.injectedReferenceM3).toBeGreaterThan(r.curve[i-1].injectedReferenceM3);expect(p.fluidCompressionReferenceM3+p.steelExpansionReferenceM3).toBeCloseTo(p.injectedReferenceM3,12);}
 const v1=r.fluids[0].volumeM3,v2=r.fluids[1].volumeM3,dp=5;
 const predicted=((v1*(1-Math.exp(-dp/2200))+v2*(1-Math.exp(-dp/1000)))+expected*dp)*Math.exp(dp/2200);
 expect(r.curve.at(-1).injectedReferenceM3).toBeCloseTo(predicted,12);
});
it('never substitutes volume allowance for missing PVT, and rejects a void or unconfirmed landing',()=>{
 const {w,columns,fluids}=fixture();w.stopStorage.bulkModuliMPa={};expect(evaluateStopStorage(w,columns,fluids,'displacement:0',true).status).toBe('unavailable');
 w.stopStorage=structuredClone(settings);expect(evaluateStopStorage(w,columns,fluids,'displacement:0',false).curve).toHaveLength(0);
 columns.pipe[0].fluidType='void';expect(evaluateStopStorage(w,columns,fluids,'displacement:0',true).issues.join(' ')).toContain('незаполненный');
});
it('rejects invalid elasticity and excursions beyond the incremental model',()=>{
 const {w,columns,fluids}=fixture();w.stopStorage.poissonRatio=.5;expect(evaluateStopStorage(w,columns,fluids,'displacement:0',true).status).toBe('unavailable');
 w.stopStorage=structuredClone(settings);w.stopStorage.pressureRiseMPa=200;expect(evaluateStopStorage(w,columns,fluids,'displacement:0',true).issues.join(' ')).toContain('малых приращений');
 expect(()=>steelVolumeCompliance(1,200,100,200000,.3,'fixedLength')).toThrow();
});
it('preserves explicit properties in the project and leaves legacy calculations disabled',()=>{
 const {w}=fixture();const s=normalizeCementingSnapshot({...getCementingExample(),wellData:w});expect(s.wellData.stopStorage).toEqual(w.stopStorage);expect(s.wellData.stopStorage).not.toBe(w.stopStorage);
 expect(normalizeStopStorage(undefined)).toBeUndefined();expect(evaluateStopStorage({...w,stopStorage:undefined},undefined,[],undefined,false)).toBeUndefined();
});
it('adds a separate phase without changing the geometric stop, returns, or main transport',()=>{
 const p=getCementingExample(),v=calculateVolumes(p.wellData,p.slurries,p.displacementFluids[0].compressionCoeff);
 const run=(well:WellData)=>calculatePressureProfile(well,p.slurries,p.buffers,p.drillingFluid,p.displacementFluids,p.fractureGradient,v.displacementVolumeWithCompression,2.5,3);
 const base=run(p.wellData),r=run({...p.wellData,stopStorage:settings});expect(r.stopStorage.status).toBe('ready');expect(r.points).toEqual(base.points);expect(r.inventory).toEqual(base.inventory);expect(r.stopTime).toBe(base.stopTime);
 expect(r.stopStorage.baselineCapacityM3).toBeCloseTo(v.displacementVolume,7);expect(r.stopStorage.curve.at(-1).injectedReferenceM3).toBeGreaterThan(0);
 expect(stopStorageCsv(r.stopStorage)).toContain('additional_reference_m3');const figures=stopStorageReportCharts(r.stopStorage);expect(figures).toHaveLength(1);expect(allowedReportFigure('cementing',{stopStorage:false},figures[0])).toBe(false);expect(allowedReportFigure('running',undefined,figures[0])).toBe(false);
});
