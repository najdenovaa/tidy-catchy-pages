import {it,expect} from 'vitest';
import {pickVariants,DEFAULT_OPTIMIZER_SETTINGS,runOptimizer,evaluateProgram,cementIntervalCentralization,type VariantEval} from './cement-optimizer';
import {qualityInput,qualitySettings} from './__tests__/fixtures/optimizer-cleaning-fixture';
import {calculateCementQuality,qualityContactTimeByDepth} from './cement-quality-index';
import {calculateVolumes} from './cementing-calculations';
const candidate=(cqi:number,mrei:number,extra:Partial<VariantEval>={}):VariantEval=>({variant:{q1:20,q2:cqi,bufferVolumeM3:null,bufferDensity:null},feasible:true,violations:[],mrei,cqi,minCqi:60,badQualityLengthM:0,channelLengthM:0,minMarginMPa:3,minMarginAt:'Пласт',underbalanceMPa:0,maxSurfaceMPa:10,jobTimeMin:100,thickeningReserveMin:60,effAnnRateLps:20,limitingFactor:'—',recommendations:[],...extra});
it('selects overall CQI rather than maximum displacement and never chooses an infeasible candidate',()=>{
 const displacement=candidate(65,99),quality=candidate(90,75),unsafe=candidate(99,100,{feasible:false,violations:['ГРП/поглощение']});
 const r=pickVariants([displacement,quality,unsafe],DEFAULT_OPTIMIZER_SETTINGS);
 expect(r[0].label).toBe('Лучшее качество');expect(r[0].ev).toBe(quality);
});
it('does not trade away CQI for fewer centralizers within the old two-percent tolerance',()=>{
 const high=candidate(90,80,{centralization:{countInCement:150} as VariantEval['centralization']}),cheap=candidate(89,99,{centralization:{countInCement:10} as VariantEval['centralization']});
 expect(pickVariants([cheap,high],DEFAULT_OPTIMIZER_SETTINGS)[0].ev).toBe(high);
 const weak=candidate(90,99,{minCqi:40,badQualityLengthM:100});
 expect(pickVariants([weak,high],DEFAULT_OPTIMIZER_SETTINGS)[0].ev).toBe(high);
});
it('uses exactly the quality analysis model and contact estimate for each native program',()=>{
 const p=qualityInput(),variant={q1:20,q2:30,bufferVolumeM3:null,bufferDensity:null};
 evaluateProgram(p,variant,qualitySettings,undefined,undefined,{onPressure:r=>{
  const volumes=calculateVolumes(p.wellData,p.slurries,p.displacementFluids[0].compressionCoeff);
  const ev=evaluateProgram(p,variant,qualitySettings);
  const flows={...p,slurries:p.slurries.map(s=>({...s,flowRateSteps:s.flowRateSteps.map(st=>({...st,rateLps:20}))})),buffers:p.buffers.map(b=>({...b,flowRateSteps:b.flowRateSteps.map(st=>({...st,rateLps:20}))}))};
  const q=calculateCementQuality({...flows,centralization:cementIntervalCentralization(p),pressureData:r.points,casingDepthMD:p.wellData.casingDepthMD,annVPM:volumes.annularVolumePerMeter,prevCasingDepth:p.wellData.prevCasingDepth,contactTimeByDepth:qualityContactTimeByDepth(r.points,p.wellData.casingDepthMD)}).summary;
  expect(ev.cqi).toBeCloseTo(q.avgCQI,8);expect(ev.minCqi).toBeCloseTo(q.minCQI,8);
 }});
});
it('keeps best-quality selection with buffer boost disabled and uses one selected full program when boost improves CQI',async()=>{
 const p=qualityInput(),settings={...qualitySettings,minRateLps:30,maxRateLps:30,maxCementRateLps:30,optimizeCentralizers:false};
 const plain=await runOptimizer(p,{...settings,optimizeBuffer:false}),boost=await runOptimizer(p,{...settings,optimizeBuffer:true});
 expect(plain.best[0].label).toBe('Лучшее качество');expect(plain.highQuality).toBeUndefined();
 expect(boost.best[0].label).toBe('Лучшее качество');expect(boost.best[0].ev.cqi).toBeGreaterThanOrEqual(plain.best[0].ev.cqi!);
 if(boost.best[0].cleaning)expect(boost.best[0].cleaning).toBe(boost.highQuality);
},60000);
