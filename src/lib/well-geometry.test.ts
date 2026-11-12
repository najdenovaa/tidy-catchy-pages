import {describe,it,expect} from 'vitest';
import {boreDiameterAtDepth,cavernIntervalCoeff,createAnnularGeometry,scaleCavernInterval} from './well-geometry';
import {annularVolumeForInterval,openHoleVolumeForInterval,calculateVolumes,calculatePressureProfile,calculateHydraulics} from './cementing-calculations';
import {getCementingExample} from './cementing-example';
import {normalizeWellData} from './cementing-normalizers';
import {calculateCentralization,type CentralizerSpec} from './centralization-calculations';
import {runningBore} from './casing-running-analysis';
import {localBore} from './cementing-report-sections';
import {buildDisplacementInput} from './displacement-2d-input';
import {defaultFoamSettings,designFoamJob} from './foam-cement-engine';
const well=()=>({...getCementingExample().wellData,wellDepthMD:100,wellDepthTVD:100,casingDepthMD:100,ckodDepth:100,casingOD:168,casingWall:8,holeDiameter:200,prevCasingDepth:20,prevCasingID:250,cavernCoeff:1,trajectory:[{md:0,tvd:0,azimuth:0,zenith:0},{md:100,tvd:100,azimuth:0,zenith:0}],cavernIntervals:[{fromMD:20,toMD:40,coeff:1.21,diameterMm:220},{fromMD:60,toMD:100,coeff:1.96,diameterMm:280}]});
const area=(d:number)=>Math.PI/4*((d/1000)**2-.168**2);
describe('shared measured bore geometry',()=>{
 it('uses casing, measured intervals, and the default only in gaps with consistent boundaries',()=>{
  const w=well(),g=createAnnularGeometry(w,100);
  expect(g.cells.map(x=>[x.topMD,x.bottomMD,x.diameterMm,x.source])).toEqual([[0,20,250,'previous-casing'],[20,40,220,'measured'],[40,60,200,'coefficient'],[60,100,280,'measured']]);
  expect(boreDiameterAtDepth(w,20)).toBe(220);expect(boreDiameterAtDepth(w,40)).toBe(200);expect(boreDiameterAtDepth(w,100)).toBe(280);
  expect(g.totalVolume).toBeCloseTo(area(250)*20+area(220)*20+area(200)*20+area(280)*40,12);
  expect(g.volume(10,70)).toBeCloseTo(annularVolumeForInterval(10,70,200,168,250,20,1,w.cavernIntervals),12);
 });
 it('inverts partial volumes across interval boundaries without assuming a constant section',()=>{
  const g=createAnnularGeometry(well(),100);
  for(const from of [0,3,20,35,40,55,60,83])for(const to of [90,100]){
    const v=g.volume(from,to);expect(g.depthAboveVolume(to,v)).toBeCloseTo(from,9);
  }
  expect(g.depthAboveVolume(100,g.totalVolume+1)).toBe(0);
  expect(g.depthAboveVolume(60,0)).toBe(60);
 });
 it('preserves measured diameter and changes relative K when the nominal diameter changes',()=>{
  const w=well(),other={...w,holeDiameter:180};
  expect(cavernIntervalCoeff(w.cavernIntervals[0],180)).toBeCloseTo((220/180)**2,12);
  expect(boreDiameterAtDepth(other,30)).toBe(220);expect(boreDiameterAtDepth(other,50)).toBe(180);
  expect(openHoleVolumeForInterval(60,100,180,1,other.cavernIntervals)).toBeCloseTo(Math.PI/4*.280**2*40,12);
  expect(annularVolumeForInterval(60,100,180,168,250,20,1,other.cavernIntervals)).toBeCloseTo(area(280)*40,12);
 });
 it('keeps legacy K relative and deterministic first-interval priority for overlapping legacy data',()=>{
  const w={...well(),cavernIntervals:[{fromMD:20,toMD:60,coeff:1.21},{fromMD:30,toMD:80,coeff:1.96}]};
  expect(boreDiameterAtDepth(w,40)).toBeCloseTo(220,10);
  expect(createAnnularGeometry(w,100).at(40)?.diameterMm).toBeCloseTo(220,10);
  expect(boreDiameterAtDepth({...w,holeDiameter:180},40)).toBeCloseTo(198,10);
 });
 it('uses the same measured section in running, centralizer report and displacement view',()=>{
  const w=well();expect(runningBore(w,70)).toBe(280);expect(localBore(w,70)).toBe(280);
  const ex=getCementingExample(),volumes=calculateVolumes(w,[]);
  const d=buildDisplacementInput({wellData:w,slurries:[],buffers:[],drillingFluid:ex.drillingFluid,displacementFluids:ex.displacementFluids,volumes});
  expect(d.input.geom(70).rHole).toBe(.14);
 });
 it('centralization responds to the measured passage, not the nominal bit diameter',()=>{
  const w={...well(),trajectory:[{md:0,tvd:0,zenith:30,azimuth:0},{md:100,tvd:86.6,zenith:30,azimuth:0}]};
  const spec:CentralizerSpec={type:'spring',bladesCount:6,bladeHeight:40,restoringForce:5,maxAxialLoad:100};
  const iv=[{id:'1',fromMD:0,toMD:100,jointLength:12,centralizersPerJoint:1,spec}];
  const a=calculateCentralization(w,iv,1100).find(x=>x.md===70)!,b=calculateCentralization({...w,holeDiameter:180},iv,1100).find(x=>x.md===70)!;
  expect(a).toBeDefined();expect(b.standoff).toBe(a.standoff);expect(b.supportEccentricity).toBe(a.supportEccentricity);
 });
 it('foam design uses the same measured capacities after a nominal diameter change',()=>{
  const w={...well(),prevCasingDepth:0,cavernIntervals:[{fromMD:0,toMD:100,coeff:1.96,diameterMm:280}]};
  const settings={...defaultFoamSettings({wellData:w}),buffers:[],spatialCells:24};
  const a=designFoamJob({wellData:w,mudDensity:1.1,settings});
  const b=designFoamJob({wellData:{...w,holeDiameter:180},mudDensity:1.1,settings});
  expect(b).toEqual(a);
 });
 it('retains measurement provenance and raw NULLs through save/load without inventing them for old projects',()=>{
  const w={...well(),caliperLog:{fileName:'field.las',curve:'CALI',importedAt:'2026-11-12T00:00:00Z',depthUnit:'ft',diameterUnit:'in',nominalDiameterMm:200,intervalStepM:5,maxGapM:2,samples:[{md:0,diameterMm:220},{md:1,diameterMm:null}]}};
  const saved=normalizeWellData(JSON.parse(JSON.stringify(w)));
  expect(saved.caliperLog).toEqual(w.caliperLog);expect(saved.cavernIntervals?.[0].diameterMm).toBe(220);
  expect(normalizeWellData({}).caliperLog).toBeUndefined();
 });
 it('applies uncertainty to the actual measured diameter instead of changing an ignored K field',()=>{
  const iv=well().cavernIntervals[0],scaled=scaleCavernInterval(iv,1.44,200);
  expect(scaled.diameterMm).toBeCloseTo(264,10);expect(cavernIntervalCoeff(scaled,200)).toBeCloseTo(cavernIntervalCoeff(iv,200)*1.44,10);
 });
 it('annular fluid heights and dynamic/static pressures are invariant to nominal changes in a fully measured hole',()=>{
  const ex=getCementingExample(),w={...well(),prevCasingDepth:0,cavernIntervals:[{fromMD:0,toMD:40,coeff:1.21,diameterMm:220},{fromMD:40,toMD:100,coeff:1.96,diameterMm:280}]};
  const slurry={...ex.slurries[0],topDepthMD:0,washVolume:0,flowRateSteps:[{rateLps:5,volumeM3:0,volumeMode:'auto' as const}]};
  const other={...w,holeDiameter:180};
  const va=calculateVolumes(w,[slurry],1),vb=calculateVolumes(other,[slurry],1);expect(vb.totalSlurryVolume).toBeCloseTo(va.totalSlurryVolume,12);
  const h=(wellData:typeof w)=>calculateHydraulics(wellData,[slurry],1.1,30,ex.drillingFluid.rheology,ex.displacementFluids[0].rheology,5);
  expect(h(other).frictionAnn).toBeCloseTo(h(w).frictionAnn,12);
  const run=(wellData:typeof w)=>calculatePressureProfile(wellData,[slurry],[],ex.drillingFluid,[{...ex.displacementFluids[0],compressionCoeff:1,flowRateSteps:[{rateLps:5,volumeM3:0}]}],30,va.displacementVolume,0,0,{fast:true});
  const a=run(w),b=run(other);expect(b.points.length).toBe(a.points.length);
  a.points.forEach((p,i)=>{expect(b.points[i].bottomholePressure).toBeCloseTo(p.bottomholePressure,10);expect(b.points[i].annCementHeightM).toBeCloseTo(p.annCementHeightM,10);});
  expect(a.points[a.points.length-1].annCementHeightM).toBeCloseTo(100,5);
 });
});
