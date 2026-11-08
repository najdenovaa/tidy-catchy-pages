import { it,expect } from 'vitest';
import { getCementingExample } from './cementing-example';
import { calculateMaterials } from './cementing-calculations';
import { normalizeWellData } from './cementing-normalizers';
import { equipmentMaterialInventory,centralizerMaterialGeometryKey } from './materials-equipment-inventory';
import { centralizerInventory } from './cementing-equipment';
const ex=getCementingExample();
const well={...ex.wellData,casingDepthMD:25,equipment:[{id:'shoe',kind:'shoe' as const,model:'AVRORA 112ПБ',manufacturer:'ООО «Аврора»',quantity:1,passport:'PS-26'},{id:'center',kind:'centralizer' as const,model:'Ручной центратор',manufacturer:'Аврора',quantity:99}]};
const intervals=[{id:'c',fromMD:0,toMD:25,jointLength:12,centralizersPerJoint:1,spec:{type:'spring' as const,bladesCount:6,bladeHeight:25,restoringForce:2,maxAxialLoad:0,passport:{model:'AVRORA 205',manufacturer:'ООО «Аврора»'}}}];
it('uses selected equipment instead of hard-coded shoe, collar and plug placeholders',()=>{
 const rows=equipmentMaterialInventory({...well,equipment:well.equipment.slice(0,1)});
 expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({name:'Башмак / AVRORA 112ПБ',amount:1,manufacturer:'ООО «Аврора»'});
 expect(calculateMaterials(ex.slurries,ex.buffers,{...ex.wellData,equipment:[]}).equipmentItems).toEqual([]);
});
it('adds actual placement counts and replaces manual center totals without double counting',()=>{
 const w={...well,centralizerMaterials:{geometryKey:centralizerMaterialGeometryKey(well),items:centralizerInventory(well.casingDepthMD,intervals)}};
 const rows=equipmentMaterialInventory(w);
 expect(rows).toHaveLength(2);expect(rows.find(e=>e.calculated)).toMatchObject({name:'Центратор / AVRORA 205',amount:3});
 expect(rows.some(e=>e.amount===99)).toBe(false);
 const restored=normalizeWellData(JSON.parse(JSON.stringify(w)));
 expect(equipmentMaterialInventory(restored)).toEqual(rows);
});
it('does not use a calculated count for a different well geometry',()=>{
 const w={...well,centralizerMaterials:{geometryKey:centralizerMaterialGeometryKey(well),items:centralizerInventory(25,intervals)}};
 expect(equipmentMaterialInventory({...w,casingDepthMD:50}).some(e=>e.calculated)).toBe(false);
});
