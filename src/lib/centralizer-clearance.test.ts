import { expect, it } from 'vitest';
import { inspectCentralizer } from './centralizer-clearance';
import { passportExamples } from './centralizer-passports';
it('считает зазоры и площадь в мм без изменения при повороте лопасти',()=>{
 const g=inspectCentralizer(passportExamples[1].spec,178,220,0)!;
 expect(g.minPipeGap).toBe(21); expect(g.maxPipeGap).toBe(21);
 expect(g.blades[0].gap).toBe(4); expect(g.rigidConflict).toBe(false);
 expect(g.annularArea).toBeCloseTo(Math.PI*(110**2-89**2));
});
it('показывает пересечение жёсткого изделия вместо выдуманного прогиба',()=>{
 const g=inspectCentralizer(passportExamples[1].spec,178,220,1)!;
 expect(g.rigidConflict).toBe(true); expect(g.blades[0].gap).toBe(-17);
 expect(g.blades[0].compression).toBe(0);
});
it('ограничивает рессору стенкой и сохраняет дальний зазор',()=>{
 const g=inspectCentralizer(passportExamples[2].spec,178,216,0.5)!;
 expect(g.offset).toBe(9.5); expect(g.blades[0].compression).toBe(9.5);
 expect(g.blades[0].gap).toBe(0); expect(g.blades[3].gap).toBeCloseTo(9.5);
});
it('не выдумывает размеры отсутствующего паспорта или непроходимый ствол',()=>{
 expect(inspectCentralizer({...passportExamples[0].spec,passport:undefined},178,216,0)).toBeNull();
 expect(inspectCentralizer(passportExamples[0].spec,178,175,0)).toBeNull();
});
