import {describe,it,expect} from 'vitest';
import * as XLSX from 'xlsx';
import {rheologyHierarchy,rheologyHierarchyFigures} from './rheology-hierarchy';
import {cementingChartsWorkbook,numericChartRows} from './cementing-chart-data';
import {getCementingExample} from './cementing-example';
import {normalizeCementingSnapshot} from './cementing-normalizers';
import {fluidProperties,saveFluidRevision,emptyFluidLibrary,parseFluidLibrary,applyFluidRevision} from './fluid-library';
import type {Rheology} from './cementing-calculations';
import type {RheologyReportInput} from './rheology-fluids';
import {RPM_TO_SHEAR,DIAL_TO_PA} from './cement-rheology';
const r=(pv:number,yp:number):Rheology=>({pv,yp,model:'pvyp',testTemperatureC:50,testPressureMPaAbs:20,testSource:'Протокол 17'});
const input=():RheologyReportInput=>{const ex=getCementingExample();return {drillingFluid:{...ex.drillingFluid,name:'Повтор',rheology:r(20,8),rheologyBottomhole:r(500,100)},buffers:[{...ex.buffers[0],name:'Повтор',rheology:r(80,2)}],slurries:[],displacementFluids:[]};};
const empty={points:[],envelope:[],stageBoundaries:[],observation:undefined,stopStorage:undefined};
describe('F20 rheological hierarchy',()=>{
 it('uses selected PV/YP on a common positive grid, preserves duplicate names and detects a sign reversal',()=>{
  const p=input(),before=JSON.stringify(p),h=rheologyHierarchy(p);expect(h.fluids.map(f=>f.id)).toEqual(['mud','buffer-1']);expect(h.x[0]).toBeCloseTo(3*RPM_TO_SHEAR,12);
  h.x.forEach((g,i)=>{expect(h.fluids[0].tau[i]).toBeCloseTo(8+.02*g,12);expect(h.fluids[1].tau[i]).toBeCloseTo(2+.08*g,12);expect(h.pairs[0].delta[i]).toBeCloseTo(-6+.06*g,12);});
  expect(h.pairs[0].ordering).toBe('Меняется знак Δτ');expect(h.pairs[0].comparable).toBe(true);expect(h.pairs[0].signChanges).toHaveLength(1);expect(h.pairs[0].signChanges[0][0]).toBeLessThanOrEqual(100);expect(h.pairs[0].signChanges[0][1]).toBeGreaterThanOrEqual(100);
  expect(rheologyHierarchyFigures(p)[1].data.series[0].values[0]).toBeCloseTo(1000*h.fluids[0].tau[0]!/h.x[0],12);expect(JSON.stringify(p)).toBe(before);
 });
 it('does not assume T/P or approve defaults; zero differs from unknown and metadata never changes coefficients',()=>{
  const p=input(),a=rheologyHierarchy(p);p.buffers[0].rheology.testPressureMPaAbs=undefined;const b=rheologyHierarchy(p);expect(b.pairs[0].comparable).toBe(false);expect(b.pairs[0].conditions).toContain('не подтверждены');expect(a.fluids[1].tau).toEqual(b.fluids[1].tau);
  p.buffers[0].rheology={...r(80,2),testTemperatureC:0,testPressureMPaAbs:0};p.drillingFluid.rheology={...r(20,8),testTemperatureC:0,testPressureMPaAbs:0};expect(rheologyHierarchy(p).pairs[0].comparable).toBe(true);
  p.buffers[0].rheology.testTemperatureC=20;expect(rheologyHierarchy(p).pairs[0].conditions).toContain('различаются');p.buffers[0].rheology={pv:0,yp:0,testTemperatureC:0,testPressureMPaAbs:0};expect(rheologyHierarchy(p).pairs[0].conditions).toContain('Модельные');expect(rheologyHierarchy(p).pairs[0].comparable).toBe(false);
 });
 it('intersects measured domains without extrapolation and leaves invalid models empty',()=>{
  const p=input(),f=(rpms:number[])=>({pv:30,yp:5,model:'bingham' as const,fann:Object.fromEntries(rpms.map(rpm=>['r'+rpm,(4+.03*rpm*RPM_TO_SHEAR)/DIAL_TO_PA]))});
  p.drillingFluid.rheology=f([3,6,100]);p.buffers[0].rheology=f([200,300,600]);const h=rheologyHierarchy(p);expect(h.x).toEqual([]);expect(h.issues.join(' ')).toContain('Нет общего диапазона');expect(rheologyHierarchyFigures(p)).toEqual([]);
  p.buffers[0].rheology={...f([3,6,100]),model:'hb',fann:{r600:5}};const bad=rheologyHierarchy(p);expect(bad.fluids[1].tau.every(v=>v===null)).toBe(true);expect(bad.pairs[0].ordering).toBe('Нет сравнения');expect(bad.pairs[0].comparable).toBe(false);
 });
 it('uses actual positive pumping volumes, including manual overrides, and excludes surface flush and bottomhole duplicate',()=>{
  const ex=getCementingExample(),p={...ex,buffers:[{...ex.buffers[0],volume:0,flowRateSteps:[{rateLps:5,volumeM3:0,volumeMode:'auto' as const}]},{...ex.buffers[0],name:'Активный',volume:3}],flushTimeMin:5,flushVolumeM3:4,drillingFluid:{...ex.drillingFluid,rheologyBottomhole:r(999,999)}};
  const h=rheologyHierarchy(p);expect(h.fluids[0].id).toBe('mud');expect(h.fluids[1].id).toBe('buffer-2');expect(h.fluids.some(f=>f.id==='buffer-1'||f.id==='mud-bottomhole')).toBe(false);expect(h.sequenceSource).toContain('Промывка ЛВД');expect(h.fluids.at(-1)!.id).toContain('displacement');
  p.buffers[0].flowRateSteps=[{rateLps:5,volumeM3:2,volumeMode:'manual'}];expect(rheologyHierarchy(p).fluids[1].id).toBe('buffer-1');
 });
 it('round trips exact arrays and conditions through XLSX and obeys the rheology checkbox',()=>{
  const p=input(),plots=rheologyHierarchyFigures(p),book=cementingChartsWorkbook({...empty,rheologyInput:p}),read=XLSX.read(XLSX.write(book,{type:'array',bookType:'xlsx'}),{type:'array'});
  plots.forEach((p,i)=>expect(XLSX.utils.sheet_to_json(read.Sheets['График '+String(i+1).padStart(2,'0')],{header:1,defval:null})).toEqual(numericChartRows(p)));
  expect(read.SheetNames).toContain('Иерархия - пары');expect(JSON.stringify(read.Sheets['Иерархия - жидкости'])).toContain('Протокол 17');expect(JSON.stringify(read.Sheets['Иерархия - пары'])).toContain('Меняется знак');expect(cementingChartsWorkbook({...empty,rheologyInput:p},undefined,{rheology:false}).SheetNames.some(n=>n.startsWith('Иерархия'))).toBe(false);
 });
 it('preserves metadata in project and library snapshots and changes figure provenance when conditions change',()=>{
  const ex=getCementingExample(),slurry={...ex.slurries[0],rheology:r(80,8)},snapshot=normalizeCementingSnapshot(JSON.parse(JSON.stringify({...ex,slurries:[slurry]})));expect(snapshot.slurries[0].rheology).toEqual(slurry.rheology);
  const lib=saveFluidRevision(emptyFluidLibrary(),'slurry',fluidProperties('slurry',slurry),{source:'Протокол 17',basis:'laboratory',temperatureC:50,pressureMPa:20,notes:''}),restored=parseFluidLibrary(JSON.stringify(lib));expect(applyFluidRevision('slurry',slurry,restored.entries[0],1).rheology).toEqual(slurry.rheology);
  const p=input(),a=rheologyHierarchyFigures(p),reordered={...p,buffers:p.buffers.map(f=>({...f,rheology:Object.fromEntries(Object.entries(f.rheology).reverse()) as unknown as Rheology}))};expect(rheologyHierarchyFigures(reordered)[0].sourceKey).toBe(a[0].sourceKey);p.buffers[0].rheology.testTemperatureC=60;const b=rheologyHierarchyFigures(p);expect(a[0].data.series).toEqual(b[0].data.series);expect(a[0].sourceKey).not.toBe(b[0].sourceKey);expect(a[2].data.series[0].name).not.toBe(b[2].data.series[0].name);
 });
});
