// @vitest-environment node
import {expect,it} from 'vitest';
import {qualityInput} from './__tests__/fixtures/optimizer-cleaning-fixture';
import {calculatePressureProfile,calculateVolumes} from './cementing-calculations';
import {createTurbulatorLossCalculator,turbulatorLossBetween} from './turbulator-flow';
it('groups identical tools without changing local losses, interval boundaries or invalid-tool exclusions',()=>{
 const input=qualityInput(),well={...input.wellData,annularStandoffPct:100,standoffProfile:undefined};
 const template=well.turbulatorDesign.points[0];
 well.turbulatorDesign={...well.turbulatorDesign,points:[{...template,id:'a',md:200},{...template,id:'b',md:250},{...template,id:'bad',md:270,bladeHeight:500},{...template,id:'different',md:300,bladeAngle:35}]};
 const loss=createTurbulatorLossCalculator(well),fluid={density:1200,pv:20,yp:5};
 for(const [top,bottom] of [[0,200],[200,250],[250,300],[0,600],[300,600]])for(const rate of [0,10,22])expect(loss(top,bottom,rate,fluid)).toBeCloseTo(turbulatorLossBetween(well,top,bottom,rate,fluid),12);
 // A newly calculated program builds a new index after geometry/point edits.
 well.turbulatorDesign.points[0].md=400;
 expect(createTurbulatorLossCalculator(well)(0,250,10,fluid)).toBeCloseTo(turbulatorLossBetween(well,0,250,10,fluid),12);
});
it('optimizer native confirmation keeps the full forward simulation and every safety check',()=>{
 const p=qualityInput(),v=calculateVolumes(p.wellData,p.slurries,p.displacementFluids[0].compressionCoeff);
 const args=[p.wellData,p.slurries,p.buffers,p.drillingFluid,p.displacementFluids,p.fractureGradient,v.displacementVolumeWithCompression,0,0] as const;
 const full=calculatePressureProfile(...args,{fast:false}),selection=calculatePressureProfile(...args,{fast:false,optimizer:true});
 expect(selection.zoneChecks).toEqual(full.zoneChecks);
 expect(selection.points.map(x=>[x.time,x.surfacePressure,x.bottomholePressure,x.annularReturnRate,x.transportColumns])).toEqual(full.points.map(x=>[x.time,x.surfacePressure,x.bottomholePressure,x.annularReturnRate,x.transportColumns]));
 expect(selection.safeWorkingTimeMin).toBe(full.safeWorkingTimeMin);
 expect(selection.envelope).toHaveLength(0);expect(full.envelope.length).toBeGreaterThan(0);
});
