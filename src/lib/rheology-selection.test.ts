import {it,expect} from 'vitest';
import {fitRheology,rheologyResolution,selectedRheology,rheologyMetrics,RPM_TO_SHEAR,DIAL_TO_PA,type FannReadings} from './cement-rheology';
import {hbOf,calculatePressureProfile,calculateVolumes} from './cementing-calculations';
import {normalizeCementingSnapshot} from './cementing-normalizers';
import {getCementingExample} from './cementing-example';
import {rheologyFigure,rheologyCsv} from './rheology-figure';
import {fluidProperties,saveFluidRevision,emptyFluidLibrary,parseFluidLibrary,applyFluidRevision} from './fluid-library';
import {buildDisplacementInput} from './displacement-2d-input';
const synth=(fn:(g:number)=>number):FannReadings=>Object.fromEntries([600,300,200,100,6,3].map(rpm=>['r'+rpm,fn(rpm*RPM_TO_SHEAR)/DIAL_TO_PA]));
const fann=synth(g=>4+.4*g**.6),r={pv:80,yp:8,fann};
it('recovers Bingham from SI measurements with physical nonnegative constraints',()=>{
 const f=fitRheology(synth(g=>8+.05*g));expect(f.bingham.pv).toBeCloseTo(50,6);expect(f.bingham.ypPa).toBeCloseTo(8,6);expect(rheologyMetrics(f,'bingham').rmse).toBeLessThan(1e-8);
});
it('fits power-law and HB and resolves exactly the chosen coefficients',()=>{
 const pl=selectedRheology({...r,model:'powerLaw'});expect(pl.tau0).toBe(0);expect(pl).toEqual({tau0:0,K:fitRheology(fann).powerLaw.K,n:fitRheology(fann).powerLaw.n});
 const hb=selectedRheology({...r,model:'hb'});expect(hb.tau0).toBeCloseTo(4,1);expect(hb.n).toBeCloseTo(.6,2);
 expect(hbOf({...r,model:'bingham'}).n).toBe(1);expect(hbOf({...r,model:'pvyp'})).toBeUndefined();
});
it('supports any three measured speeds for explicit fits, preserving historical 600/300 availability',()=>{
 const three={r300:fann.r300,r200:fann.r200,r100:fann.r100};expect(fitRheology(three)).not.toBeNull();
 expect(selectedRheology({...r,fann:three,model:'hb'})).toBeDefined();expect(selectedRheology({...r,fann:three})).toBeUndefined();
});
it('blocks invalid, insufficient or out-of-range selections without clipping or fallback',()=>{
 expect(()=>selectedRheology({...r,fann:{r600:50},model:'hb'})).toThrow('три');
 expect(()=>selectedRheology({...r,fann:{...fann,r3:-1},model:'hb'})).toThrow('отрицательные');
 expect(()=>selectedRheology({...r,fann:synth(g=>g**1.6),model:'powerLaw'})).toThrow('не обрезаются');
 expect(()=>selectedRheology({...r,model:'unknown' as never})).toThrow('Неизвестная');
 expect(()=>selectedRheology({pv:0,yp:2,model:'pvyp'})).toThrow('PV');
 expect(fitRheology({r600:1,r300:1,r200:1})).toBeNull();
});
it('has finite plots/CSV from the same fits and does not extrapolate the plotted range',()=>{
 const input={...r,model:'hb' as const},fit=fitRheology(fann),figure=rheologyFigure(input,false,'<script>'),residual=rheologyFigure(input,true);
 expect(figure.svg).not.toMatch(/NaN|Infinity|<script>/);expect(figure.svg).toContain('&lt;script>');expect(residual.svg).toContain('Модель минус замер');
 const lines=rheologyCsv(input).split('\n');expect(lines).toHaveLength(9);const row=lines[3].split(';').map(Number);expect(row[5]).toBeCloseTo(rheologyMetrics(fit,'hb').pred(row[1]),10);expect(row[8]).toBeCloseTo(row[5]-row[2],10);
});
it('persists the model and source measurements through project and immutable library snapshots',()=>{
 const ex=getCementingExample(),s={...ex.slurries[0],rheology:{...r,model:'hb' as const}},snapshot=normalizeCementingSnapshot(JSON.parse(JSON.stringify({...ex,slurries:[s]})));
 expect(snapshot.slurries[0].rheology).toEqual(s.rheology);
 const lib=saveFluidRevision(emptyFluidLibrary(),'slurry',fluidProperties('slurry',s),{source:'Протокол 56',basis:'laboratory',temperatureC:58,pressureMPa:25,notes:''});
 const restored=parseFluidLibrary(JSON.stringify(lib));expect(applyFluidRevision('slurry',s,restored.entries[0],1).rheology.model).toBe('hb');
 expect(()=>saveFluidRevision(emptyFluidLibrary(),'slurry',{...fluidProperties('slurry',s),rheology:{...r,model:'powerLaw',fann:undefined}},{source:'Источник',basis:'user',notes:''})).toThrow();
});
it('changes the main pressure trace when the selected model changes, and blocks an invalid run',()=>{
 const ex=getCementingExample();const run=(model:'pvyp'|'hb')=>calculatePressureProfile(ex.wellData,ex.slurries.map(s=>({...s,rheology:{...r,model}})),ex.buffers,ex.drillingFluid,ex.displacementFluids,ex.fractureGradient,calculateVolumes(ex.wellData,ex.slurries).displacementVolumeWithCompression);
 const a=run('pvyp'),b=run('hb');expect(a.points.every(p=>Number.isFinite(p.surfacePressure))).toBe(true);expect(a.points.map(p=>p.surfacePressure)).not.toEqual(b.points.map(p=>p.surfacePressure));
 expect(()=>calculatePressureProfile(ex.wellData,ex.slurries.map(s=>({...s,rheology:{pv:0,yp:0,model:'hb'}})),ex.buffers,ex.drillingFluid,ex.displacementFluids,ex.fractureGradient,1)).toThrow('три');
});
it('uses fitted Bingham in 2D and explicitly rejects unsupported nonlinear models',()=>{
 const ex=getCementingExample(),p={...ex,volumes:calculateVolumes(ex.wellData,ex.slurries)};
 const slurries=ex.slurries.map(s=>({...s,rheology:{...r,model:'bingham' as const}}));const d=buildDisplacementInput({...p,slurries});expect(d.input.fluids.find(f=>f.kind==='cement').pv).toBeCloseTo(fitRheology(fann).bingham.pv/1000,10);
 expect(()=>buildDisplacementInput({...p,slurries:slurries.map(s=>({...s,rheology:{...r,model:'hb'}}))})).toThrow('не поддерживает');
});
