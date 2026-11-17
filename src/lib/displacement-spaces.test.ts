import {it,expect,vi,afterEach} from 'vitest';
import * as engine from './displacement-2d';
import {buildDisplacementInput} from './displacement-2d-input';
import {calculateDisplacementSpaces} from './displacement-spaces';
import {getCementingExample} from './cementing-example';
import {calculateVolumes} from './cementing-calculations';
import {pipeBalance,pipeDepthComposition} from './displacement-pipe';
import {displacementReportKey} from './cementing-report-data';
const data=()=>{const ex=getCementingExample(),wellData={...ex.wellData,wellDepthMD:260,casingDepthMD:250,ckodDepth:235,prevCasingDepth:60,casingSections:[]},slurries=ex.slurries.slice(0,1).map(s=>({...s,topDepthMD:70,bottomDepthMD:250,flowRateSteps:[{rateLps:5,volumeM3:1.5}]}));return {...ex,wellData,slurries,volumes:calculateVolumes(wellData,slurries)};};
afterEach(()=>vi.restoreAllMocks());
it('actually skips the annular solver in pipe-only mode and exports no annular state',()=>{
 const spy=vi.spyOn(engine,'simulateDisplacement2D'),r=calculateDisplacementSpaces(data(),{annulusEnabled:false,pipeEnabled:true,settleMin:1});
 expect(spy).not.toHaveBeenCalled();expect(r.result).toBeNull();expect(r.pipe).not.toBeNull();expect(r.timeline[0].timeS).toBe(0);
 expect(pipeDepthComposition(r.pipe!,100,0)!.fractions[0]).toBe(1);
});
it('uses the same shoe schedule with the detailed pipe output disabled and synchronizes saved annular frames',()=>{
 const p=data(),settings={settleMin:0,rotationRpm:0,fine:false},both=calculateDisplacementSpaces(p,settings),ann=calculateDisplacementSpaces(p,{...settings,pipeEnabled:false});
 expect(ann.pipe).toBeNull();expect(both.stages).toEqual(ann.stages);expect(both.result!.snapshots.at(-1)!.frac).toEqual(ann.result!.snapshots.at(-1)!.frac);
 for(let i=0;i<both.result!.snapshots.length;i++)expect(both.timeline.some(f=>f.annulusFrame===i&&Math.abs(f.timeS-both.meta.annulusStartS-both.result!.snapshots[i].t)<1e-8)).toBe(true);
 const ledger=pipeBalance(both.pipe!,both.pipe!.pumpTimeS);
 for(const row of ledger.filter(x=>x.fluid!==0))expect(both.stages.filter(s=>s.fluid===row.fluid).reduce((n,s)=>n+s.volumeM3,0)).toBeCloseTo(row.outletM3,9);
},60000);
it('rejects both disabled, invalidates mode changes and normalizes implicit defaults',()=>{
 const p=data(),settings={fine:false,settleMin:0,rotationRpm:0};expect(()=>calculateDisplacementSpaces(p,{pipeEnabled:false,annulusEnabled:false})).toThrow('хотя бы одно');
 expect(displacementReportKey(p,settings)).toBe(displacementReportKey(p,{...settings,pipeEnabled:true,annulusEnabled:true}));
 expect(displacementReportKey(p,settings)).not.toBe(displacementReportKey(p,{...settings,annulusEnabled:false}));
});

it('passes overdisplaced water through the actual program builder rather than truncating at the last cement slug',()=>{
 const p=data();p.displacementFluids=p.displacementFluids.slice(0,1).map(f=>({...f,compressionCoeff:2,flowRateSteps:[{rateLps:5,volumeM3:20,volumeMode:'manual' as const}]}));
 p.volumes=calculateVolumes(p.wellData,p.slurries,2);
 const d=buildDisplacementInput(p),water=d.input.fluids.findIndex(f=>f.kind==='other');
 expect(water).toBeGreaterThan(0);expect(d.input.stages.some(s=>s.fluid===water&&s.volumeM3>0)).toBe(true);
 const end=pipeBalance(d.pipe,d.pipe.pumpTimeS)[water].outletM3;
 expect(d.input.stages.filter(s=>s.fluid===water).reduce((n,s)=>n+s.volumeM3,0)).toBeCloseTo(end,10);
});
