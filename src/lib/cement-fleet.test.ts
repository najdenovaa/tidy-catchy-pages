import { it,expect } from 'vitest';
import { planLogistics,DEFAULT_LOGISTICS,normalizeLogisticsSettings } from './cement-logistics';
import { fleetTemplate } from './cement-fleet-catalog';
import { normalizeCementingSnapshot } from './cementing-normalizers';
import { getCementingExample } from './cementing-example';
import type { PressureProfileResult,MaterialSummary,SlurryInput } from './cementing-calculations';
const pressure=(q:number,p:number)=>({points:[{time:1,pumpRateLps:q,surfacePressure:p,stage:'цемент'}]} as PressureProfileResult);
const mats={cementItems:[{name:'Сухая смесь',amount:60,unit:'т'},{name:'В составе сухой смеси',amount:6000,unit:'кг'}],waterTotal:20} as MaterialSummary;
const slurries=[{...getCementingExample().slurries[0],yieldPerTon:1,flowRateSteps:[{rateLps:20,volumeM3:60}]}] as SlurryInput[];
it('adds a second single-pump machine for Q-P, not just for manufacturer name',()=>{
 const s={...fleetTemplate('single',DEFAULT_LOGISTICS),unitPowerKW:100,unitMaxRateLps:30,unitMaxPressureMPa:70,mixRatePerPairLps:40};
 expect(planLogistics(pressure(15,10),mats,slurries,s).peakUnitsHydraulic).toBe(2);
 expect(planLogistics(pressure(15,5),mats,slurries,s).peakUnitsHydraulic).toBe(1);
});
it('counts two pumps as one vehicle and keeps mixer capacity independent',()=>{
 const s={...fleetTemplate('twin',DEFAULT_LOGISTICS),unitPowerKW:1000,unitMaxRateLps:60,mixRatePerPairLps:10,maxBulkConnections:2};
 const r=planLogistics(pressure(20,10),mats,slurries,s);
 expect(r.peakUnitsHydraulic).toBe(1);expect(r.unitsWorking).toBe(2);expect(r.workingPumps).toBe(4);expect(r.mixers).toBe(0);
});
it('separates standalone mixers, pumping CA, dry feed and truck payload',()=>{
 const s={...fleetTemplate('mixer-ca',DEFAULT_LOGISTICS),unitPowerKW:300,unitMaxRateLps:30,mixRatePerPairLps:30,bulkDensityTm3:.8,bulkUnloadTmin:.3,maxBulkConnections:2};
 const r=planLogistics(pressure(20,10),mats,slurries,s);
 expect(r.blendT).toBe(60);expect(r.bulkPayloadT).toBe(20);expect(r.bulkStockCount).toBe(3);expect(r.bulkFeedCount).toBe(4);expect(r.bulkTrucks).toBe(4);expect(r.mixers).toBe(2);expect(r.unitsWorking).toBe(1);
 expect(r.equipment.find(x=>x.name.includes('тягач'))?.count).toBe(4);
});
it('does not solve a pressure limit by adding parallel machines or extrapolate a pump curve',()=>{
 const s={...fleetTemplate('single',DEFAULT_LOGISTICS),unitMaxPressureMPa:32,pumpCurve:[{pressureMPa:20,rateLps:15},{pressureMPa:30,rateLps:8}]};
 const r=planLogistics(pressure(20,40),mats,slurries,s);
 expect(r.feasible).toBe(false);expect(r.unitRateAt(40)).toBe(0);expect(r.unitRateAt(31)).toBe(0);expect(r.unitRateAt(25)).toBe(8);
});
it('checks loss of one pump without counting an unstarted reserve as instantaneous capacity',()=>{
 const s={...fleetTemplate('twin',DEFAULT_LOGISTICS),unitPowerKW:400,unitMaxRateLps:30,mixRatePerPairLps:40};
 const r=planLogistics(pressure(20,10),mats,slurries,s);
 expect(r.unitsWorking).toBe(1);expect(r.onePumpOutRateLps).toBe(15);expect(r.onePumpOutMeetsPeak).toBe(false);
});
it('persists fleet settings and basket hypotheses with the well snapshot',()=>{
 const snap=normalizeCementingSnapshot({...getCementingExample(),wellData:{...getCementingExample().wellData,logistics:fleetTemplate('single',DEFAULT_LOGISTICS),basketEvaluationMin:12,equipment:[{id:'b',kind:'basket',model:'500S',manufacturer:'Аврора',quantity:1,depthMD:1200,basketSupportPct:40,basketBridgeMin:10,basketCapacityKN:20}]}});
 expect(snap.wellData.logistics?.scheme).toBe('single');expect(snap.wellData.basketEvaluationMin).toBe(12);expect(snap.wellData.equipment?.[0].basketSupportPct).toBe(40);
 const invalid=normalizeLogisticsSettings({unitPowerKW:0,bulkPayloadT:NaN,maxBulkConnections:-1});
 expect(invalid.unitPowerKW).toBeGreaterThan(0);expect(invalid.bulkPayloadT).toBeGreaterThan(0);expect(invalid.maxBulkConnections).toBeGreaterThan(0);
});
