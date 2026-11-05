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
