import {it,expect} from 'vitest';
import * as XLSX from 'xlsx';
import {labFixture} from './__tests__/fixtures/fluid-lab-fixture';
import {labFluids} from './fluid-interaction-lab';
import {fluidLabReport,fluidLabFigures} from './fluid-lab-report';
import {fluidLabWorkbook} from './fluid-lab-workbook';
import {buildPipeTransport} from './displacement-pipe';
import type {DisplacementReportData} from './cementing-report-data';
export function removalFixture(){
 const {ex,lab}=labFixture();const w={...ex.wellData,casingDepthMD:20,wellDepthMD:20,wellDepthTVD:15,trajectory:[{md:0,tvd:0,zenith:0,azimuth:0},{md:20,tvd:15,zenith:40,azimuth:0}]};
 const fluids=labFluids(ex);lab.removal=[{id:'W1',source:'Erosion-cell test',temperatureC:50,pressureMPaAbs:5,cleanerId:fluids[1].id,cleanerKey:fluids[1].key,mudKey:fluids[0].key,fromMD:0,toMD:20,criticalPa:8,exposureS:60,notes:'Steel / conditioned deposit'}];
 const input={...ex,wellData:w},d={inputKey:'lab-test',pipe:null,settings:{fine:false,rotationRpm:0,settleMin:0},stages:[],meta:{sectionWell:structuredClone(w),labFluids:fluids,colors:fluids.map(()=> '#4f46e5'),annulusStartS:60,designCementTopMD:0,shoeMD:20,notes:[]},timeline:[{timeS:70,annulusFrame:0}],result:{nZ:2,nTheta:2,full:false,zCenters:new Float64Array([5,15]),gap:new Float32Array([.03,.01,.03,.01]),fluids:fluids.map(f=>({name:f.name,kind:f.id==='mud:0'?'mud':'spacer',density:1200,pv:.02,yp:2})),snapshots:[{t:10,stage:0,frac:new Uint8Array(fluids.length*4),wallShearTimeS:9.8,wallShearPa:new Float32Array([10,5,20,15]),wallShearFluid:new Uint16Array([2,0,2,2])}],pumpEndSnap:0}} as DisplacementReportData;
 return {input,d};
}
it('compares a measured threshold only with the same pure cleaner and hydraulic time',()=>{
 const {input,d}=removalFixture(),r=fluidLabReport(input,d),rows=r.profiles[0].rows;
 expect(r.shearTimeS).toBe(69.8);expect(r.timeS).toBe(70);expect(rows[0].requiredPa).toBe(8);expect(rows[0].availableMinPa).toBe(10);expect(rows[0].pureCoveragePct).toBeCloseTo(75);expect(rows.find(r=>r.md===15)!.availableMinPa).toBe(15);
 const figures=fluidLabFigures(input,d);expect(figures).toHaveLength(3);expect(figures.every(f=>f.sourceKey===r.sourceKey)).toBe(true);
 const book=fluidLabWorkbook(input,d);expect(XLSX.utils.sheet_to_json(book.Sheets['Кривые сдвига'])).toHaveLength(4);
});
it('preserves MD/TVD and unit selection without changing measured thresholds',()=>{
 const {input,d}=removalFixture();input.wellData.depthChartSettings={coordinate:'TVD',depthUnit:'ft',pressureUnit:'MPa',densityUnit:'gcm3'};const r=fluidLabReport(input,d);expect(r.axisLabel).toBe('TVD, ft');expect(r.profiles[0].rows.find(x=>x.md===5)!.depth).toBeCloseTo(3.75/.3048);expect(r.profiles[0].rows[0].requiredPa).toBe(8);
});
it('leaves missing protocols and shear fields unknown and rejects stale materials',()=>{
 const {input,d}=removalFixture();delete d.result!.snapshots[0].wallShearPa;let r=fluidLabReport(input,d);expect(r.profiles[0].rows[0].availableMinPa).toBeNull();expect(r.issues.join(' ')).toContain('Нет сохранённого поля');
 input.buffers[0].density+=1;r=fluidLabReport(input,d);expect(r.fresh).toBe(false);expect(r.profiles[0].error).toContain('изменён');expect(r.profiles[0].rows.every(x=>x.requiredPa===null&&x.availableMinPa===null)).toBe(true);
});
