import { expect, it } from 'vitest';
import { centralizerMesh, surveyTransform, trajectoryAzimuth } from './centralizer-mesh';
import { passportExamples } from './centralizer-passports';
it('наклоняет физическую ось по зениту и азимуту',()=>{
 expect(surveyTransform([0,0,100],0,0)).toEqual([0,0,100]);
 const horizontal=surveyTransform([0,0,100],90,90);
 expect(horizontal[0]).toBeCloseTo(0);expect(horizontal[1]).toBeCloseTo(-100);expect(horizontal[2]).toBeCloseTo(0);
 const inclined=surveyTransform([0,0,100],45,0);expect(inclined[0]).toBeCloseTo(-70.7107);expect(Math.hypot(...inclined)).toBeCloseTo(100);
});
it('интерполирует азимут через север по короткой дуге',()=>{
 expect(trajectoryAzimuth([{md:0,azimuth:350},{md:100,azimuth:10}],50)).toBe(0);
 expect(trajectoryAzimuth([{md:0,azimuth:35}],150)).toBe(35);
});
it('строит объёмные рессоры и кольца с конечными координатами',()=>{
 const faces=centralizerMesh(passportExamples[0].spec,244.48,224,295.3,.1,2);
 expect(faces.length).toBeGreaterThan(1000);
 expect(faces.some(f=>f.kind==='selected')).toBe(true);
 expect(faces.every(f=>f.points.every(p=>p.every(Number.isFinite)))).toBe(true);
});
it('направляет смещение оси к низу под действием веса при любом азимуте',()=>{
 for(const zenith of [25,60,90])for(const azimuth of [0,113,270]){
  const low=surveyTransform([1,0,0],zenith,azimuth),up=surveyTransform([0,0,1],zenith,azimuth);
  expect(low[2]).toBeLessThan(0);
  expect(low.reduce((n,v,i)=>n+v*up[i],0)).toBeCloseTo(0,10);
  const x=low,y=surveyTransform([0,1,0],zenith,azimuth);
  const cross=[x[1]*y[2]-x[2]*y[1],x[2]*y[0]-x[0]*y[2],x[0]*y[1]-x[1]*y[0]];
  expect(cross.reduce((n,v,i)=>n+v*up[i],0)).toBeCloseTo(1,10);
 }
});
it('связывает более сильное сжатие рессоры с физически нижней стороной',async()=>{
 const {inspectCentralizer}=await import('./centralizer-clearance');
 const g=inspectCentralizer(passportExamples[2].spec,178,216,.5)!;
 expect(g.blades[0].compression).toBeGreaterThan(g.blades[3].compression);
 const low=surveyTransform([g.offset,0,0],25,113);
 expect(low[2]).toBeLessThan(0);
});
