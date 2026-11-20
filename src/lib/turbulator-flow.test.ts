import {describe,it,expect} from 'vitest';
import {calculateTurbulatorFlow,defaultTurbulatorDesign,swirlRatioAt,turbulatorFluidProperties,turbulatorVelocityAt,turbulatorLossBetween,normalizeTurbulatorDesign,turbulatorRegimeThresholds,turbulatorOutlet} from './turbulator-flow';
import {getCementingExample} from './cementing-example';
import {normalizeWellData} from './cementing-normalizers';
import {calculatePressureProfile,calculateVolumes} from './cementing-calculations';
const well={...getCementingExample().wellData,casingOD:178,holeDiameter:250,cavernCoeff:1,prevCasingDepth:0,annularStandoffPct:100,standoffProfile:undefined,casingDepthMD:300};
const point={id:'a',md:150,bladesCount:6,bladeAngle:55,bladeHeight:20,lengthMm:180,bladeWidthMm:15,sleeveThicknessMm:3};
const fluid={id:'mud',name:'БР',density:1200,rheology:{pv:25,yp:5,model:'pvyp' as const}};
const settings={...defaultTurbulatorDesign(),points:[point]};
describe('common turbulator model',()=>{
 it('inverts the shared regime boundaries, with an independent Newtonian annulus solution',()=>{
  const f={...fluid,rheology:{pv:25,yp:0,model:'pvyp' as const}};
  const t=turbulatorRegimeThresholds(well,point.md,f);
  const area=Math.PI/4*(.25**2-.178**2),dh=.25-.178;
  expect(t.transitionLps).toBeCloseTo(1.5*2100*.025*area/(1200*dh)*1000,8);
  expect(t.turbulentLps).toBeCloseTo(1.5*2900*.025*area/(1200*dh)*1000,8);
  const properties=turbulatorFluidProperties(f);
  expect(turbulatorOutlet(well,point,t.transitionLps!*.999,properties).regime).toBe(0);
  expect(turbulatorOutlet(well,point,(t.transitionLps!+t.turbulentLps!)/2,properties).regime).toBe(.5);
  expect(turbulatorOutlet(well,point,t.turbulentLps!*1.001,properties).regime).toBe(1);
  const viscous=turbulatorRegimeThresholds(well,point.md,{...f,rheology:{pv:50,yp:0}});
  expect(viscous.turbulentLps).toBeCloseTo(2*t.turbulentLps!,8);
 });
 it('uses selected Fann rheology and local diameter for the operating thresholds',()=>{
  const f={...fluid,rheology:{pv:35,yp:6,model:'hb' as const,fann:{r600:70,r300:44,r200:33,r100:23,r6:9,r3:8}}};
  const t=turbulatorRegimeThresholds(well,point.md,f),props=turbulatorFluidProperties(f);
  expect(turbulatorOutlet(well,point,t.turbulentLps!,props).reynolds).toBeCloseTo(t.reTurbulent,7);
  expect(t.reTurbulent).not.toBe(2900);
  const local={...well,cavernIntervals:[{fromMD:100,toMD:200,coeff:1,diameterMm:280}]};
  expect(turbulatorRegimeThresholds(local,point.md,f).turbulentLps).not.toBe(t.turbulentLps);
  expect(()=>turbulatorRegimeThresholds(well,point.md,{...fluid,rheology:{pv:25,yp:5,model:'hb'}})).toThrow();
 });
 it('has no swirl or pressure loss at zero Q or straight ribs',()=>{
  for(const [p,q,s] of [[point,0,settings],[{...point,bladeAngle:0},10,settings]] as const){const r=calculateTurbulatorFlow(well,p,q,fluid,s);expect(r.valid).toBe(true);expect(r.lengthM).toBe(0);expect(r.tangentialMs).toBe(0);if(q===0)expect(r.pressureLossMPa).toBe(0);}
 });
 it('propagates exclusively upward, decays monotonically, reaches exact threshold',()=>{
  const r=calculateTurbulatorFlow(well,point,10,fluid,settings);expect(r.valid).toBe(true);expect(r.lengthM).toBeGreaterThan(0);expect(r.reachedThreshold).toBe(true);expect(swirlRatioAt(r,151)).toBe(0);
  r.samples.forEach((p,i)=>{expect(p.md).toBeLessThanOrEqual(point.md);if(i)expect(p.tangentialMs).toBeLessThanOrEqual(r.samples[i-1].tangentialMs);});
  expect(r.samples.at(-1)!.remainingFraction).toBeCloseTo(.001,8);
  expect(r.decay90M).toBeLessThan(r.decay99M!);expect(r.decay99M).toBeLessThan(r.decay999M!);
  const f=turbulatorFluidProperties(fluid);const md=150-r.lengthM/2;expect(turbulatorVelocityAt(well,point,md,10,f,settings)).toBeCloseTo(swirlRatioAt(r,md)*r.axialMs,7);
 });
 it('responds to Q, viscosity, yield stress, Fann model, local caliper and geometry conflicts',()=>{
  const a=calculateTurbulatorFlow(well,point,10,fluid,settings);
  const high=calculateTurbulatorFlow(well,point,20,fluid,settings);expect(high.axialMs).toBeCloseTo(a.axialMs*2);expect(high.lengthM).toBeGreaterThan(a.lengthM);expect(high.pressureLossMPa).toBeGreaterThan(a.pressureLossMPa);
  expect(calculateTurbulatorFlow(well,point,10,{...fluid,rheology:{pv:100,yp:5}},settings).lengthM).toBeLessThan(a.lengthM);
  expect(calculateTurbulatorFlow(well,point,10,{...fluid,rheology:{pv:25,yp:30}},settings).lengthM).toBeLessThan(a.lengthM);
  expect(calculateTurbulatorFlow(well,point,10,{...fluid,rheology:{pv:25,yp:5,model:'hb'}},settings).valid).toBe(false);
  const local={...well,cavernIntervals:[{fromMD:100,toMD:200,coeff:1,diameterMm:280}]};expect(calculateTurbulatorFlow(local,point,10,fluid,settings).boreMm).toBe(280);
  expect(calculateTurbulatorFlow({...well,holeDiameter:200},point,10,fluid,settings).valid).toBe(false);
  expect(calculateTurbulatorFlow({...well,annularStandoffPct:20},point,10,fluid,settings).valid).toBe(false);
 });
 it('clips at the surface, validates dimensions and round-trips project inputs',()=>{
  const p={...point,md:.001};const r=calculateTurbulatorFlow(well,p,10,fluid,settings);expect(r.lengthM).toBeCloseTo(.001);expect(r.reachedThreshold).toBe(false);
  expect(calculateTurbulatorFlow(well,{...point,lengthMm:-1},10,fluid,settings).valid).toBe(false);
  expect(normalizeWellData(JSON.parse(JSON.stringify({...well,turbulatorDesign:settings}))).turbulatorDesign).toEqual(settings);
  expect(normalizeTurbulatorDesign({points:[{id:'bad',md:NaN}]})!.points).toHaveLength(0);
  expect(normalizeTurbulatorDesign({...settings,threshold:.9,turningEfficiency:0})).toEqual(settings);
  expect(calculateTurbulatorFlow(well,point,10,fluid,{threshold:.9,turningEfficiency:0}).tangentialMs).toBe(calculateTurbulatorFlow(well,point,10,fluid,settings).tangentialMs);
 });
 it('adds each local loss once across segmented intervals and none during a stop',()=>{
  const w={...well,turbulatorDesign:settings},f=turbulatorFluidProperties(fluid);
  const total=turbulatorLossBetween(w,0,300,10,f);expect(total).toBeGreaterThan(0);
  expect(turbulatorLossBetween(w,0,150,10,f)+turbulatorLossBetween(w,150,300,10,f)).toBeCloseTo(total,12);
  expect(turbulatorLossBetween(w,0,300,0,f)).toBe(0);
 });
 it('feeds main cementing hydraulic pressure without altering hydrostatic stop',()=>{
  const e=getCementingExample();const w={...e.wellData,annularStandoffPct:100,standoffProfile:undefined};const p={...point,md:w.casingDepthMD*.5,bladeHeight:5};
  const v=calculateVolumes(w,e.slurries);
  const run=(points:typeof p[])=>calculatePressureProfile({...w,turbulatorDesign:{...settings,points}},e.slurries,e.buffers,e.drillingFluid,e.displacementFluids,e.fractureGradient,v.displacementVolumeWithCompression,0,0);
  const base=run([]),tools=run([p]);expect(tools.points.length).toBe(base.points.length);
  expect(tools.points.some((r,i)=>r.surfacePressure>base.points[i].surfacePressure+1e-9)).toBe(true);
 });
});
