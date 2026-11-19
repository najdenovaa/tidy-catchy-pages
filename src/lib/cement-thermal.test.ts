import {it,expect} from 'vitest';
import {getCementingExample} from './cementing-example';
import {thermalDraft,simulateThermal} from './cement-thermal';
import {normalizeCementingSnapshot} from './cementing-normalizers';
import {thermalFixture} from './__tests__/fixtures/thermal-fixture';

it('conserves energy with differing fluid capacities without inventing temperature changes in an isothermal well',()=>{const s=thermalFixture(),r=simulateThermal(s);for(const f of r.frames){expect(Math.max(...f.pipeC,...f.annulusC,...f.wallC).toFixed(7)).toBe('20.0000000');expect(Math.min(...f.pipeC,...f.annulusC,...f.wallC).toFixed(7)).toBe('20.0000000');expect(Math.abs(f.balance.residualJ)/Math.max(1,r.energyScaleJ)).toBeLessThan(1e-10);}expect(r.tags).toHaveLength(3);expect(r.tags[0].history.some(x=>x.space==='annulus')).toBe(true);expect(r.tags[1].history.at(-1)!.space).toBe('pipe');});
it('tracks heating, stopping and temperature recovery; keeps numerical results independent of saved frames',()=>{const s=thermalFixture();s.wellData.bottomTempStatic=90;const cfg=s.wellData.thermal!;cfg.initialBottomC=40;cfg.wocMin=15;const a=simulateThermal(s);expect(a.frames.at(-1)!.annulusC.at(-1)!).toBeGreaterThan(a.frames.find(f=>Math.abs(f.timeS-a.stopS)<1e-6)!.annulusC.at(-1)!);for(const f of a.frames)expect(Math.abs(f.balance.residualJ)/a.energyScaleJ).toBeLessThan(1e-9);cfg.frameMin=.25;const b=simulateThermal(s);expect(b.frames.at(-1)!.pipeC).toEqual(a.frames.at(-1)!.pipeC);expect(b.steps).toBe(a.steps);expect(a.tags[0].history.find(x=>x.space==='pipe')!.temperatureC).not.toBeNull();});
it('persists explicit assumptions and rejects unknown properties instead of guessing',()=>{const s=thermalFixture();expect(normalizeCementingSnapshot(s).wellData.thermal).toEqual(s.wellData.thermal);s.wellData.thermal!.fluids[0].cp=NaN;expect(()=>simulateThermal(s)).toThrow('теплоёмкость');});
it('converges to the analytical exponential heating of stationary annular fluid against an effectively fixed rock boundary',()=>{
 const s=thermalFixture();s.buffers=[];s.slurries=[];s.displacementFluids=[];s.flushTimeMin=0;s.wellData.ckodDepth=0;
 const p=s.wellData.thermal!;Object.assign(p,{initialBottomC:0,hPipe:0,hAnnulus:0,rockRhoCp:1e25,circulationMin:0,wocMin:10,maxStepS:.5});
 const r=simulateThermal(s),j=r.md.length-1,dz=6,ro=s.wellData.casingOD/2000,rh=s.wellData.holeDiameter*Math.sqrt(s.wellData.cavernCoeff)/2000;
 const rc=rh*(p.outerRadiusM/rh)**(1/12),g=1/(1/(p.hFormation*2*Math.PI*rh*dz)+Math.log(rc/rh)/(2*Math.PI*p.rockK*dz)),C=Math.PI*(rh*rh-ro*ro)*dz*s.drillingFluid.density*p.fluids[0].cp;
 const initial=p.surfaceC+(p.initialBottomC-p.surfaceC)*r.tvd[j]/60,expected=20+(initial-20)*Math.exp(-600*g/C);
 expect(r.frames.at(-1)!.annulusC[j]).toBeCloseTo(expected,2);
});
it('keeps distinct first/tail cement marker identities across several cements and preserves the surface-flush pause',()=>{
 const s=thermalFixture();s.slurries.push({...s.slurries[0],name:'Второй цемент',topDepthMD:40});s.wellData.thermal!.fluids=thermalDraft(s).fluids;const r=simulateThermal(s);
 expect(r.tags.map(t=>t.fluidId)).toEqual(['cement:0','cement:0','cement:1']);expect(r.tags[0].injectedM3).toBeLessThan(r.tags[1].injectedM3);expect(r.tags[1].injectedM3).toBeLessThan(r.tags[2].injectedM3);
 const hold=r.frames.filter(f=>f.phase==='Промывка ЛВД');expect(hold.length).toBeGreaterThan(0);expect(r.tags[0].history.length).toBe(r.frames.length);
});

it('initializes the thermal scenario from the entered surface temperature, including zero',()=>{const s=thermalFixture();s.wellData.surfaceTemp=0;const p=thermalDraft(s);expect(p.surfaceC).toBe(0);expect(p.fluids.every(f=>f.inletC===0)).toBe(true);});
