import {it,expect} from 'vitest';
import {getCementingExample} from './cementing-example';
import {buildProcessContract,processContractCsv} from './cementing-process';
import {calculatePressureProfile,calculateVolumes} from './cementing-calculations';
import {buildDisplacementInput} from './displacement-2d-input';
const ex=getCementingExample();
const input=()=>({...ex,flushTimeMin:2.5,flushVolumeM3:3});
it('reconciles rate-time volume and density-based mass separately from LVD service water',()=>{
 const c=buildProcessContract(input());expect(c.canRun).toBe(true);expect(c.volumeResidualM3).toBeCloseTo(0,8);expect(c.massResidualKg).toBeCloseTo(0,6);
 const surface=c.stages.find(s=>s.kind==='surfaceFlush');expect(surface.durationMin).toBe(2.5);expect(surface.volumeM3).toBe(3);expect(surface.rateLps).toBe(20);expect(c.surfaceMassKg).toBe(3000);
 expect(c.wellVolumeM3).toBeCloseTo(c.stages.filter(s=>s.destination==='well').reduce((n,s)=>n+s.volumeM3,0),10);
 expect(c.fluids.find(f=>f.id===surface.fluidId).kind).toBe('serviceWater');
});
it('produces contiguous events and unique IDs for identically named fluids and modes',()=>{
 const p=input();p.buffers=[...p.buffers,{...p.buffers[0]}].map(f=>({...f,name:'Одинаковое имя'}));p.slurries=p.slurries.map(f=>({...f,name:'Одинаковое имя'}));
 const c=buildProcessContract(p);expect(new Set(c.stages.map(s=>s.id)).size).toBe(c.stages.length);expect(new Set(c.events.map(s=>s.id)).size).toBe(c.events.length);
 for(let i=1;i<c.stages.length;i++)expect(c.stages[i].startMin).toBe(c.stages[i-1].endMin);
 expect(c.events.at(-1).timeMin).toBe(c.totalTimeMin);expect(c.fluids.filter(f=>f.name==='Одинаковое имя').map(f=>f.id)).toContain('buffer:1');
});
it('keeps hand-set volumes, identifies design overrides, and responds to changed geometry',()=>{
 const p=input();p.slurries=p.slurries.map(s=>({...s,flowRateSteps:[{rateLps:5,volumeM3:0,volumeMode:'auto'}]}));p.buffers=[{...p.buffers[0],volume:3,flowRateSteps:[{rateLps:5,volumeM3:4,volumeMode:'manual'}]}];
 const a=buildProcessContract(p);expect(a.issues.some(x=>x.code==='DESIGN_VOLUME_OVERRIDE')).toBe(true);expect(a.stages.find(s=>s.kind==='buffer').volumeM3).toBe(4);
 const b=buildProcessContract({...p,wellData:{...p.wellData,holeDiameter:p.wellData.holeDiameter+10}});expect(b.wellVolumeM3).not.toBe(a.wellVolumeM3);expect(b.inputKey).not.toBe(a.inputKey);
});
it('marks missing buffer rate instead of inventing a duration; preserves legacy displacement fallback explicitly',()=>{
 const p=input();p.buffers=[{...p.buffers[0],flowRateSteps:[{rateLps:0,volumeM3:1,volumeMode:'manual'}]}];const c=buildProcessContract(p);expect(c.canRun).toBe(false);expect(c.totalTimeMin).toBeNull();expect(c.issues.some(x=>x.code==='MISSING_RATE')).toBe(true);
 p.buffers=[];p.displacementFluids=p.displacementFluids.map(f=>({...f,flowRateSteps:[{rateLps:0,volumeM3:0}]}));const legacy=buildProcessContract(p);expect(legacy.stages.filter(s=>s.kind==='displacement').every(s=>s.rateLps===5&&s.assumedRate)).toBe(true);expect(legacy.issues.some(x=>x.code==='LEGACY_RATE')).toBe(true);
});
it('does not create service volumes when they were not entered and does not accept an instantaneous positive wash',()=>{
 const c=buildProcessContract({...input(),flushVolumeM3:0,flushTimeMin:0});expect(c.stages.some(s=>s.kind==='surfaceFlush')).toBe(false);expect(c.surfaceVolumeM3).toBe(0);
 expect(buildProcessContract({...input(),flushVolumeM3:3,flushTimeMin:0}).canRun).toBe(false);
});
it('owns source rheology and keeps selection IDs independent of names within the snapshot',()=>{
 const p=input(),c=buildProcessContract(p);p.slurries[0].rheology={pv:999,yp:999};expect(c.fluids.find(f=>f.kind==='cement').rheology.pv).not.toBe(999);
 const renamed=buildProcessContract({...input(),slurries:input().slurries.map(s=>({...s,name:'Другое имя'}))});expect(renamed.stages.filter(s=>s.kind==='cement').map(s=>s.id)).toEqual(c.stages.filter(s=>s.kind==='cement').map(s=>s.id));
});
it('makes the pressure engine consume the same schedule and tags frames by role instead of label',()=>{
 const p=input();p.buffers=p.buffers.map(f=>({...f,name:'Продавка'}));const c=buildProcessContract(p),v=calculateVolumes(p.wellData,p.slurries,p.displacementFluids[0]?.compressionCoeff??1),r=calculatePressureProfile(p.wellData,p.slurries,p.buffers,p.drillingFluid,p.displacementFluids,p.fractureGradient,v.displacementVolumeWithCompression,p.flushTimeMin,p.flushVolumeM3);
 expect(r.processContract).toEqual(c);expect(r.points.find(x=>x.processKind==='buffer').fluidId).toBe('buffer:0');expect(r.points.filter(x=>x.pumpRateLps>0).every(x=>!!x.stageId&&!!x.fluidId)).toBe(true);
 const flush=c.stages.find(x=>x.kind==='surfaceFlush');expect(r.points.some(x=>x.stageId===flush.id&&Math.abs(x.time-flush.endMin)<1e-8)).toBe(true);
 expect(r.points.every(point=>r.processEvents.some(event=>event.id===point.eventId))).toBe(true);
 expect(r.processAudit.pumpedVolumeM3).toBe(r.points.at(-1).cumulativeVolume);expect(r.processAudit.differenceM3).toBeCloseTo(r.processAudit.pumpedVolumeM3-c.wellVolumeM3,10);
});
it('passes pause duration and common driving stages to 2D while preserving its separate shoe clock',()=>{
 const p=input(),volumes=calculateVolumes(p.wellData,p.slurries),d=buildDisplacementInput({...p,volumes}),c=buildProcessContract(p);
 const hold=d.input.stages.find(s=>s.holdS>0);expect(hold?.holdS).toBe(150);expect(hold.drivingStageId).toBe(c.stages.find(s=>s.kind==='surfaceFlush').id);
 expect(d.input.stages.every(s=>c.stages.some(x=>x.id===s.drivingStageId))).toBe(true);expect(d.meta.notes.join(' ')).toContain('Свободное падение и сжатие');
});
it('exports stable trace columns and quotes fluid names safely',()=>{
 const p=input();p.buffers=p.buffers.map(s=>({...s,name:'Состав; "A"'}));const csv=processContractCsv(buildProcessContract(p));expect(csv).toContain('stage_id;fluid_id');expect(csv).toContain('"Состав; ""A"""');
});
