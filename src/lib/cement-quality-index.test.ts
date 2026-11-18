import {describe,it,expect} from 'vitest';
import {calculateCementQuality,type CQIInput} from './cement-quality-index';
import {defaultCementingSnapshot} from './cementing-normalizers';
const fixture=():CQIInput=>{
 const d=structuredClone(defaultCementingSnapshot);
 const wellData={...d.wellData,casingDepthMD:1000,wellDepthMD:1000,holeDiameter:216,casingOD:146,prevCasingDepth:400,prevCasingID:200,cavernCoeff:1,annularStandoffPct:80};
 const base={...d.slurries[0],rheology:{pv:30,yp:10},flowRateSteps:[{rateLps:10,volumeM3:10}]};
 return {wellData,slurries:[{...base,topDepthMD:200,density:1.5},{...base,topDepthMD:700,density:1.85}],buffers:[{...d.buffers[0],name:'Вода',volume:5,density:1000,rheology:{pv:1,yp:0}}],drillingFluid:{...d.drillingFluid,density:1130,rheology:{pv:20,yp:0}},centralization:undefined,pressureData:[],casingDepthMD:1000,annVPM:.02,prevCasingDepth:400,contactTimeByDepth:[{depthMD:0,bufferContactMin:15}]};
};
describe('CQI screening uses interval inputs',()=>{
 it('does not call water lighter than mud a valid hierarchy',()=>{
  const r=calculateCementQuality(fixture());expect(r.summary.densityHierarchyOK).toBe(false);expect(r.summary.bufYP).toBe(0);expect(r.points[0].ypRatio).toBe(10);
 });
 it('uses the slurry at depth, excludes uncemented interval and includes boundaries',()=>{
  const r=calculateCementQuality(fixture());expect(r.points[0].depthMD).toBe(200);expect(r.points.at(-1)?.depthMD).toBe(1000);
  expect(r.points.find(p=>p.depthMD===200)?.densityRatio).toBeCloseTo(1500/1130);expect(r.points.find(p=>p.depthMD===700)?.densityRatio).toBeCloseTo(1850/1130);
  expect(r.summary.badZonesLength).toBeLessThanOrEqual(800);
 });
 it('accounts for all steps by pumping time and local annular area',()=>{
  const f=fixture();f.slurries[0].flowRateSteps=[{rateLps:5,volumeM3:10},{rateLps:20,volumeM3:10}];
  const r=calculateCementQuality(f),p=r.points.find(p=>p.depthMD===200)!;
  expect(p.annularVelocity).toBeCloseTo(.008/(Math.PI/4*(.2**2-.146**2)));
  expect(r.points.find(p=>p.depthMD===400)?.annularVelocity).toBeLessThan(p.annularVelocity);
 });
 it('resolves automatic step volumes before averaging rates',()=>{
  const f=fixture();f.slurries[0].flowRateSteps=[{rateLps:5,volumeM3:0},{rateLps:20,volumeM3:0}];
  const p=calculateCementQuality(f).points[0];expect(p.annularVelocity).toBeCloseTo(.008/(Math.PI/4*(.2**2-.146**2)));
 });
 it('uses the entered standoff profile, and explicitly reports an assumed fallback',()=>{
  const f=fixture();f.wellData.standoffProfile=[{md:0,standoffPct:40},{md:1000,standoffPct:80}];
  let r=calculateCementQuality(f);expect(r.summary.standoffSource).toBe('profile');expect(r.points[0].standoff).toBeCloseTo(48);
  delete f.wellData.standoffProfile;delete f.wellData.annularStandoffPct;r=calculateCementQuality(f);
  expect(r.summary.standoffSource).toBe('assumed');expect(r.recommendations.join(' ')).toContain('условное standoff 67%');
 });
 it('does not let a heavy spacer conceal a lighter spacer',()=>{
  const f=fixture();f.buffers.push({...f.buffers[0],density:1400,volume:100});expect(calculateCementQuality(f).summary.densityHierarchyOK).toBe(false);
 });
 it('keeps empty intervals finite and avoids phantom bad-zone metres',()=>{
  const f=fixture();f.slurries=[];const r=calculateCementQuality(f);expect(r.summary.minCQI).toBe(0);expect(r.summary.badZonesLength).toBe(0);
 });
});
