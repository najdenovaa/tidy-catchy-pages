// @vitest-environment node
import {it,expect} from 'vitest';
import {qualityInput,qualitySettings} from './__tests__/fixtures/optimizer-cleaning-fixture';
import {compatibleHardware,optimizerHardwareCatalog} from './optimizer-hardware';
import {centralizerPlans} from './cement-optimizer';
import {programTarget} from './optimizer-turnkey';
import {turbulatorGeometryErrors} from './turbulator-flow';
import {buildCentralizerJointSchedule} from './centralizer-layout';
import {placeProgramTurbulators} from './optimizer-tool-layout';
it('places catalogue tools only in locally admissible slots',()=>{
 const input=qualityInput(),available=compatibleHardware(input.wellData,optimizerHardwareCatalog()),plans=centralizerPlans(input,qualitySettings,available.centralizers.map(x=>x.spec));
 const rows=[];
 for(const cp of plans)for(const product of available.turbulators){const out=placeProgramTurbulators(input,cp,programTarget(input),product,input.buffers[1],30,12);for(const t of out.design.points){expect(turbulatorGeometryErrors({...input.wellData,standoffProfile:cp.profile.map(r=>({md:r.md,standoffPct:r.standoff}))},t)).toEqual([]);const centers=buildCentralizerJointSchedule(input.wellData.casingDepthMD,cp.intervals).flatMap(x=>x.placements);expect(centers.some(c=>t.md<c.md+c.spec.passport.length/2000+.01&&t.md+t.lengthMm/1000>c.md-c.spec.passport.length/2000-.01)).toBe(false);}
 rows.push({cp:cp.label,min:cp.minStandoffPct,count:cp.totalCount,product:product.identity.model,height:product.point.bladeHeight,placed:out.design.points.length});}

 expect(rows.some(x=>x.placed>0)).toBe(true);
});
