import {describe,it,expect} from 'vitest';
import * as XLSX from 'xlsx';
import {displacementPlacement} from './displacement-placement';
import {buildPipeTransport} from './displacement-pipe';
import {sectionState} from './displacement-section';
import {placementBufferGeometry,placementMesh} from './displacement-placement-mesh';
import {displacementPlacementWorkbook} from './displacement-placement-workbook';
import {sectionFixture} from './__tests__/fixtures/displacement-section-fixture';
describe('F09/F25 common final placement',()=>{
 it('uses every row of both spaces at the same frame and agrees with section composition',()=>{
  const d=sectionFixture(),s=displacementPlacement(d);if('error'in s)throw Error(s.error);
  expect(s.rows[0].annulusFractions[0]).toBeCloseTo(.25);
  expect(s.timeS).toBe(10);expect(s.isLast).toBe(true);expect(s.rows).toHaveLength(2);
  for(const row of s.rows){const section=sectionState(d,row.md,s.frame);if('error'in section)throw Error(section.error);expect(row.pipeFractions).toEqual(section.pipeFractions);expect(row.annulusFractions).toEqual(section.annulusFractions);}
  for(let i=0;i<s.fluids.length;i++)expect(s.pipeInventory![i]).toBeCloseTo(s.pipeLedger![i].insideM3,10);
 });
 it('retains fluid changes and validates inventory with multiple portions and a hold',()=>{
  const d=sectionFixture();const p=d.pipe!;p.stages.push({...p.stages[0],fluid:0,volumeM3:0,rateM3s:0,holdS:30,startS:10,endS:40,startM3:p.stages[0].endM3,endM3:p.stages[0].endM3});p.pumpTimeS=40;d.timeline!.push({timeS:40,annulusFrame:1});
  const a=displacementPlacement(d,1),b=displacementPlacement(d);if('error'in a||'error'in b)throw Error('state');expect(b.timeS).toBe(40);expect(b.pipeInventory).toEqual(a.pipeInventory);expect(b.annulusInventory).toEqual(a.annulusInventory);
 });
 it('preserves stored trajectory TVD, variable pipe sections, and finite 3D geometry',()=>{
  const d=sectionFixture(),w=d.meta.sectionWell!;w.trajectory=[{md:0,tvd:0,zenith:0,azimuth:0},{md:10,tvd:8,zenith:30,azimuth:90},{md:20,tvd:14,zenith:60,azimuth:90}];
  const s=displacementPlacement(d);if('error'in s)throw Error(s.error);expect(s.positions.at(-1)![1]).toBe(-14);expect(s.positions.at(-1)![0]).toBeGreaterThan(0);
  const g=placementBufferGeometry(s);expect(Array.from(g.attributes.position.array).every(Number.isFinite)).toBe(true);expect(g.attributes.position.count).toBe(g.attributes.color.count);expect(placementMesh(s).faces.some(f=>f.space==='pipe')).toBe(true);g.dispose();
 });
 it('integrates variable pipe capacities against the independent per-fluid ledger',()=>{
  const d=sectionFixture(),p=d.pipe!,v=p.segments[0].endM3;
  d.pipe=buildPipeTransport(p.fluids,[{topMD:0,bottomMD:10,startM3:0,endM3:v},{topMD:10,bottomMD:20,startM3:v,endM3:1.5*v}],p.stages);
  const s=displacementPlacement(d);if('error'in s)throw Error(s.error);
  expect(s.rows[1].ri).toBeLessThan(s.rows[0].ri);
  for(let i=0;i<s.fluids.length;i++)expect(s.pipeInventory![i]).toBeCloseTo(s.pipeLedger![i].insideM3,10);
 });
 it('does not invent composition for disabled and uncovered spaces',()=>{
  const d=sectionFixture();d.pipe=null;let s=displacementPlacement(d);if('error'in s)throw Error(s.error);expect(s.pipeInventory).toBeNull();expect(s.rows.every(r=>r.pipeFractions.every(x=>x===null))).toBe(true);expect(placementMesh(s).faces.every(f=>f.space==='annulus')).toBe(true);
  d.result=null;s=displacementPlacement(d);if('error'in s)throw Error(s.error);expect(s.annulusInventory).toBeNull();expect(placementMesh(s).faces).toHaveLength(0);
 });
 it('exports every interval and null, keeps cached geometry and detects stale final fields',()=>{
  const d=sectionFixture(),s=displacementPlacement(d);if('error'in s)throw Error(s.error);const book=displacementPlacementWorkbook(s);expect(XLSX.utils.sheet_to_json(book.Sheets['Размещение'])).toHaveLength(s.rows.length);
  d.meta.sectionWell!.casingOD+=1;const changed=displacementPlacement(d);if('error'in changed)throw Error(changed.error);expect(changed.sourceKey).not.toBe(s.sourceKey);
  delete d.meta.sectionWell;expect(displacementPlacement(d)).toHaveProperty('error');
 });
 it('labels an incomplete run and rejects mismatched fluid identities',()=>{
  const d=sectionFixture();d.result!.summary={timing:{complete:false}} as any;const s=displacementPlacement(d);if('error'in s)throw Error(s.error);expect(s.completed).toBe(false);
  d.pipe={...d.pipe!,fluids:d.pipe!.fluids.map(f=>({...f,name:'other'}))};expect(displacementPlacement(d)).toHaveProperty('error');
 });
});
