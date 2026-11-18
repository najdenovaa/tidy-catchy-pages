import {describe,it,expect} from 'vitest';
import * as XLSX from 'xlsx';
import {sectionFixture} from './__tests__/fixtures/displacement-section-fixture';
import {displacementSection,sectionState} from './displacement-section';
import {displacementSectionWorkbook} from './displacement-section-workbook';
import {displacementSectionFigures} from './displacement-section-figures';
import {distinctDisplacementColors,mixtureColor} from './displacement-colors';
import {sectionBufferGeometry} from '@/components/displacement/D2Section3D';
import {allowedReportFigure} from './cementing-report-options';
const valid=()=>{const s=sectionState(sectionFixture(),15,1);if('error' in s)throw Error(s.error);return s;};
describe('common pipe/annulus section from saved results',()=>{
 it('selects the same time and depth cells and preserves volume-weighted fractions',()=>{
  const s=valid();expect(s.timeS).toBe(10);expect(s.annulusFrame).toBe(1);expect(s.pipeBounds).toEqual([10,20,15]);expect(s.annulusBounds).toEqual([10,20,15]);
  expect(s.pipeFractions[0]).toBeCloseTo(.5,12);expect(s.annulusFractions[1]).toBeCloseTo(.75,7);
  expect(s.sectors.map(x=>x.sourceCell)).toEqual([0,1,1,0]);expect(s.sectors.reduce((v,x)=>v+x.weight,0)).toBeCloseTo(1,12);
 });
 it('maps displayed cell areas conservatively and retains exact circular boundaries',()=>{
  const s=valid(),total=Math.PI*(s.geometry.rh**2-s.geometry.ro**2),front=s.faces.filter(f=>f.points.every(p=>p[2]===s.geometry.thickness/2));
  const triangleArea=(p:number[][])=>Math.abs((p[1][0]-p[0][0])*(p[2][1]-p[0][1])-(p[2][0]-p[0][0])*(p[1][1]-p[0][1]))/2;
  const cementArea=front.filter(f=>f.space==='annulus'&&f.color===s.colors[1]).reduce((v,f)=>v+triangleArea(f.points),0);
  // Count annular front faces only; the steel may share a palette color.
  const cap=(z:number)=>s.faces.filter(f=>f.space==='metal'&&f.points.every(p=>p[2]===z)).reduce((v,f)=>v+triangleArea(f.points),0);
  expect(cap(s.geometry.thickness/2)).toBeGreaterThan(0);expect(cap(-s.geometry.thickness/2)).toBeCloseTo(cap(s.geometry.thickness/2),8);
  expect(cementArea/total).toBeCloseTo(s.annulusFractions[1]!,4);
  expect(s.geometry.minGapMm/s.geometry.maxGapMm).toBeCloseTo(1/3,7);
  expect(s.sectors.reduce((v,x)=>v+x.areaMm2,0)).toBeCloseTo(total,8);
  for(const p of s.faces.flatMap(f=>f.points))expect(Math.hypot(p[0],p[1])).toBeLessThanOrEqual(s.geometry.rh+1e-6);
 });
 it('does not fill disabled/out-of-grid spaces with invented zeroes or mud',()=>{
  const d=sectionFixture();d.result=null;const s=displacementSection(d,15,1);expect('error' in s).toBe(false);if('error' in s)return;
  expect(s.annulusFractions).toEqual([null,null]);expect(s.annulusStatus).toContain('отключён');expect(s.pipeFractions[1]).toBeCloseTo(.5,12);
  d.result=sectionFixture().result;d.pipe=null;const other=displacementSection(d,15,1);if('error' in other)throw Error(other.error);expect(other.pipeFractions).toEqual([null,null]);
  for(const md of [-1,21,NaN])expect(displacementSection(d,md,1)).toHaveProperty('error');expect(displacementSection(d,15,99)).toHaveProperty('error');
 });
 it('handles missing angular composition as missing, and honors the full-circle grid without mirroring',()=>{
  const d=sectionFixture(),r=d.result!;r.full=true;r.nTheta=4;r.gap=new Float32Array([.03,.02,.01,.02,.03,.02,.01,.02]);r.snapshots[1].frac=new Uint8Array([0,255,255,0,0,255,255,0,255,0,0,255,255,0,0,255]);
  const s=displacementSection(d,15,1);if('error' in s)throw Error(s.error);expect(s.sectors.map(x=>x.sourceCell)).toEqual([0,1,2,3]);expect(s.sectors[3].fractions).toEqual([0,1]);
  r.snapshots[1].frac[4]=0;r.snapshots[1].frac[12]=0;const missing=displacementSection(d,15,1);if('error' in missing)throw Error(missing.error);expect(missing.annulusFractions).toEqual([null,null]);expect(missing.sectors[0].color).toBe('#cbd5e1');
 });
 it('uses immutable model geometry and the same data in 3D, top view, XLSX and freshness key',()=>{
  const d=sectionFixture(),s=valid(),wb=displacementSectionWorkbook(s),rows=XLSX.utils.sheet_to_json(wb.Sheets['Состав сечения'],{header:1}) as unknown[][];
  expect(rows[2][4]).toBe(s.annulusFractions[1]!*100);const figures=displacementSectionFigures(d,15,1);expect(figures).toHaveLength(2);expect(figures.every(f=>f.sourceKey===s.sourceKey)).toBe(true);
  expect(allowedReportFigure('cementing',undefined,figures[0])).toBe(true);expect(allowedReportFigure('running',undefined,figures[0])).toBe(false);expect(allowedReportFigure('cementing',{displacementSection:false},figures[0])).toBe(false);
  expect(displacementSectionFigures(d,15,0)[0].sourceKey).not.toBe(s.sourceKey);d.meta.sectionWell!.casingWall=10;expect(displacementSectionFigures(d,15,1)[0].sourceKey).toBe(s.sourceKey); // Pipe ID is taken from its cached capacity.
  delete d.meta.sectionWell;expect(displacementSectionFigures(d,15,1)).toEqual([]);
  const g=sectionBufferGeometry(s);for(const key of ['position','normal','color'])for(const value of g.getAttribute(key).array)expect(Number.isFinite(value)).toBe(true);g.dispose();
 });
 it('gives repeated fluid palette entries distinct deterministic colors and mixes without extra layers',()=>{
  const colors=distinctDisplacementColors(['#387d55','#387d55','#64748b','#387d55']);expect(new Set(colors).size).toBe(4);expect(colors).toEqual(distinctDisplacementColors(['#387d55','#387d55','#64748b','#387d55']));
  expect(mixtureColor([1,0],colors)).toBe(colors[0]);expect(mixtureColor([null,null],colors)).toBe('#cbd5e1');
 });
});
