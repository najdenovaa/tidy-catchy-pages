import { expect, it } from 'vitest';
import {avroraCentralizers} from './avrora-centralizers';
import {passportExamples,passportWarnings,passportAssumptions} from './centralizer-passports';
import {inspectCentralizer} from './centralizer-clearance';
import {centralizerMesh} from './centralizer-mesh';
it('сохраняет все 40 исполнений и уникальные ключи',()=>{
 expect(avroraCentralizers).toHaveLength(40);expect(passportExamples).toHaveLength(74);
 expect(new Set(passportExamples.map(p=>p.id)).size).toBe(74);
});
it('переносит размеры 205 и различает два исполнения ОК 508',()=>{
 const spec=avroraCentralizers.find(p=>p.id==='avrora205-178-240')!.spec;
 expect(spec.passport).toMatchObject({boreDiameter:220.7,innerDiameter:181,outerDiameter:240,length:520,springLength:400,bladeWidth:38});
 expect(spec.bladesCount).toBe(6);
 expect(avroraCentralizers.filter(p=>p.id.startsWith('avrora205-508')).map(p=>p.spec.passport?.length)).toEqual([625,620]);
 expect(centralizerMesh(spec,178,162,220.7,0,0).length).toBeGreaterThan(1000);
});
it('не превращает диапазон или отсутствие усилий в точное число',()=>{
 const spec=avroraCentralizers.find(p=>p.id==='avrora200-114-138')!.spec;
 expect(spec.passport?.length).toBeUndefined();expect(spec.passport?.lengthRange).toContain('160-320');
 expect(spec.passport?.bladeWidth).toBeUndefined();expect(spec.passport?.bladeWidthRange).toBe('32-38');
 expect(avroraCentralizers.every(p=>!p.spec.passport?.restoringForceKgf&&p.spec.restoringForce===0)).toBe(true);
 expect(passportWarnings(spec,114)).toEqual([]);
 expect(passportAssumptions(spec).some(w=>w.includes('5.00'))).toBe(true);
});
it('сохраняет ошибку источника 146/146 и блокирует силовой расчёт',()=>{
 const spec=avroraCentralizers.find(p=>p.id==='avrora200-146-146')!.spec;
 expect(spec.passport?.innerDiameter).toBe(149);
 expect(inspectCentralizer(spec,146,216,0)).toBeNull();
 expect(passportWarnings(spec,146)).toContain('Наружный диаметр изделия должен быть больше наружного диаметра трубы.');
});
