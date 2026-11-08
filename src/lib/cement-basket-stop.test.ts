import { describe,it,expect } from 'vitest';
import { evaluateBasketStop, type StopColumnSegment } from './cement-basket-stop';
import { normalizeWellData } from './cementing-normalizers';
import { getCementingExample } from './cementing-example';
import { calculatePressureProfile, calculateVolumes } from './cementing-calculations';
const base=normalizeWellData({casingDepthMD:1000,wellDepthMD:1000,wellDepthTVD:1000,casingOD:168,casingWall:8,holeDiameter:216,cavernCoeff:1,prevCasingDepth:0,trajectory:[{md:0,tvd:0,zenith:0,azimuth:0},{md:1000,tvd:1000,zenith:0,azimuth:0}],reservoirLayers:[{name:'Пласт',topMD:800,bottomMD:1000,porePressureGrad:17,fracGrad:22,absorbGrad:21,fluidType:'газ'}]});
const col:StopColumnSegment[]=[{top:0,bot:1000,rho:1.9,fluidType:'cement'}];
const basket={id:'b',kind:'basket' as const,model:'AVRORA 500S',manufacturer:'Аврора',quantity:1,depthMD:700,basketBridgeMin:5,basketSupportPct:50,basketCarrierDensityGcm3:1};
describe('корзина после Стоп',()=>{
 it('never unloads the instantaneous stop or an unparameterized basket',()=>{
  for(const time of [0,4])expect(evaluateBasketStop({...base,equipment:[basket],basketEvaluationMin:time},col,23).rows.at(-1)!.reductionMPa).toBe(0);
  expect(evaluateBasketStop({...base,equipment:[{...basket,basketBridgeMin:undefined}]},col,23).rows.at(-1)!.reductionMPa).toBe(0);
 });
 it('integrates only supported excess cement weight with a separate formation-pressure check',()=>{
  const r=evaluateBasketStop({...base,equipment:[basket],basketEvaluationMin:5},col,23);
  const end=r.rows.at(-1)!;
  expect(end.withoutMPa).toBeCloseTo(18.639);
  expect(end.reductionMPa).toBeCloseTo(.5*.9*.00981*700);
  expect(r.rows.find(x=>x.md===700-.01)!.reductionMPa).toBe(0);
  expect(end.scenarioMPa).toBeLessThan(end.poreMPa!);
 });
 it('does not treat a basket or quantity as a seal or multiply the column load',()=>{
  const r=evaluateBasketStop({...base,equipment:[{...basket,quantity:5}]},col,23);
  const ordinary=evaluateBasketStop({...base,equipment:[basket]},col,23);
  expect(r.rows).toEqual(ordinary.rows);
  expect(evaluateBasketStop({...base,equipment:[basket]},[{...col[0],fluidType:'mud'}],23).rows.at(-1)!.reductionMPa).toBe(0);
 });
 it('uses TVD and caps load by support capacity',()=>{
  const horizontal={...base,trajectory:[{md:0,tvd:0,zenith:90,azimuth:0},{md:1000,tvd:100,zenith:90,azimuth:0}],equipment:[basket]};
  expect(evaluateBasketStop(horizontal,col,23).baskets[0].potentialMPa).toBeCloseTo(.9*.00981*70);
  const r=evaluateBasketStop({...base,equipment:[{...basket,basketCapacityKN:1}]},col,23);
  expect(r.baskets[0].reactionKN).toBeCloseTo(1);expect(r.baskets[0].limited).toBe(true);
 });
 it('does not count the same weight twice across multiple baskets',()=>{
  const r=evaluateBasketStop({...base,equipment:[{...basket,depthMD:500,basketSupportPct:100},{...basket,id:'b2',depthMD:800,basketSupportPct:100}]},col,23);
  expect(r.rows.at(-1)!.reductionMPa).toBeCloseTo(.9*.00981*800);
 });
 it('retains the conservative pumping and Stop pressures in the main solver',()=>{
  const e=getCementingExample(),v=calculateVolumes(e.wellData,e.slurries,1);
  const run=(withBasket:boolean)=>calculatePressureProfile({...e.wellData,...(withBasket?{equipment:[{...basket,depthMD:1000}]}:{})},e.slurries,e.buffers,e.drillingFluid,e.displacementFluids,e.fractureGradient,v.displacementVolumeWithCompression,0,0);
  const without=run(false),withBasket=run(true);
  expect(withBasket.points).toEqual(without.points);expect(withBasket.basketStop?.baskets).toHaveLength(1);
 });
});
