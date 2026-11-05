import { expect, it } from 'vitest';
import {pcCentralizers} from './pc-centralizers';
import {passportExamples,passportWarnings,kgfToKN} from './centralizer-passports';
it('содержит отдельные серии ПЦ-1 и ПЦ-2, не смешивая их с AVRORA',()=>{
 expect(pcCentralizers).toHaveLength(30);
 expect(pcCentralizers.filter(p=>p.spec.passport?.series==='ПЦ-1')).toHaveLength(13);
 expect(pcCentralizers.filter(p=>p.spec.passport?.series==='ПЦ-2')).toHaveLength(17);
 expect(new Set(passportExamples.map(p=>p.id)).size).toBe(passportExamples.length);
});
it('переносит исходные усилия в кН и размеры ПЦ-2-178/216',()=>{
 const spec=pcCentralizers.find(p=>p.spec.passport?.model==='ПЦ-2-178/216')!.spec;
 expect(spec.passport).toMatchObject({casingOD:178,boreDiameter:216,innerDiameter:182,outerDiameter:270,length:580,massKg:10.8,restoringForceSourceKN:4.626,startingForceSourceKN:4.626});
 expect(kgfToKN(spec.passport!.restoringForceKgf!)).toBeCloseTo(4.626,8);
 expect(spec.passport?.restoringStandoff).toBeUndefined();
 expect(passportWarnings(spec,178).some(w=>w.includes('степень центрирования'))).toBe(true);
});
it('не усредняет диапазон ствола и сохраняет различие сил между таблицами',()=>{
 const first=pcCentralizers.find(p=>p.spec.passport?.model==='ПЦ-178/216-245')!.spec.passport!;
 expect(first.boreDiameter).toBeUndefined();expect(first.boreDiameterRange).toBe('216-245');
 const forces=pcCentralizers.filter(p=>p.spec.passport?.casingOD===273).map(p=>p.spec.passport);
 expect(forces.map(p=>p?.restoringForceSourceKN)).toEqual([4.537,4.534]);
});
