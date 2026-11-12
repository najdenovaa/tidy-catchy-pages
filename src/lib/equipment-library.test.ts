import {it,expect} from 'vitest';
import {getCementingExample} from './cementing-example';
import {normalizeWellData} from './cementing-normalizers';
import {passportExamples} from './centralizer-passports';
import {calculateCentralization} from './centralization-calculations';
import {equipmentMaterialInventory,centralizerMaterialGeometryKey} from './materials-equipment-inventory';
import {centralizerInventory,type EquipmentSelection} from './cementing-equipment';
import {centralizerSignature,equipmentReferenceText} from './equipment-library-reference';
import {emptyEquipmentLibrary,equipmentProperties,centralizerProperties,saveEquipmentRevision,parseEquipmentLibrary,applyEquipmentRevision,applyCentralizerRevision,equipmentSignature,readEquipmentLibrary,writeEquipmentLibrary} from './equipment-library';
const meta={source:'Паспорт PS-056, ревизия 1',basis:'passport' as const,notes:'Партия 26; ограничения - по паспорту'};
const selected:EquipmentSelection={id:'s1',kind:'shoe',model:'Б-168',manufacturer:'Завод',quantity:2,depthMD:2200,casingOD:168.3,outerDiameter:190,thread:'ОТТМ',backpressureMPa:35,passport:'PS-056'};
const spec=()=>({...structuredClone(passportExamples[0].spec),passport:{...structuredClone(passportExamples[0].spec.passport),manufacturer:'Завод'}});
const library=()=>saveEquipmentRevision(emptyEquipmentLibrary(),equipmentProperties(selected),meta);
it('creates versions and applies a selected revision without changing job quantities or depth',()=>{
 const lib=library(),v2=saveEquipmentRevision(lib,{...lib.entries[0].revisions[0].properties,backpressureMPa:40},meta,lib.entries[0].id);
 expect(lib.entries[0].revisions).toHaveLength(1);const applied=applyEquipmentRevision(selected,v2.entries[0],2);
 expect(applied).toMatchObject({id:'s1',quantity:2,depthMD:2200,backpressureMPa:40});expect(applied.libraryReference.revision).toBe(2);
 expect(lib.entries[0].revisions[0].properties).not.toHaveProperty('quantity');expect(lib.entries[0].revisions[0].properties).not.toHaveProperty('depthMD');
 v2.entries=[];expect(applied.backpressureMPa).toBe(40);expect(parseEquipmentLibrary(JSON.stringify(lib))).toEqual(lib);
 expect(applyEquipmentRevision(applied,lib.entries[0],1).backpressureMPa).toBe(35);
});
it('replaces optional material fields while retaining basket scenario inputs',()=>{
 const lib=saveEquipmentRevision(emptyEquipmentLibrary(),{kind:'basket',model:'К-168',manufacturer:'Завод'},meta);
 const target={...selected,kind:'basket' as const,basketSupportPct:25,basketBridgeMin:10,basketCarrierDensityGcm3:1.1};
 const out=applyEquipmentRevision(target,lib.entries[0],1);expect(out.backpressureMPa).toBeUndefined();expect(out.basketSupportPct).toBe(25);expect(out.basketBridgeMin).toBe(10);expect(out.depthMD).toBe(2200);
});
it('preserves complete centralizer passports, distinct force units and recipe identity',()=>{
 const s=spec(),lib=saveEquipmentRevision(emptyEquipmentLibrary(),centralizerProperties(s),meta),out=applyCentralizerRevision(lib.entries[0],1);
 expect(out.passport).toEqual(s.passport);expect(out.restoringForce).toBe(s.restoringForce);expect(out.passport.restoringForceKgf).toBe(1200);expect(centralizerSignature(out)).toBe(out.libraryReference.signature);
 const w=getCementingExample().wellData,iv={id:'iv',fromMD:0,toMD:w.casingDepthMD,centralizersPerJoint:1,jointLength:12,spec:out};
 const raw={...w,centralizerDesign:{mode:'manual',targetStandoff:67,jointLength:12,autoSpec:out,intervals:[iv]},equipment:[{...selected,kind:'centralizer',centralizerSpec:out}]};
 const restored=normalizeWellData(JSON.parse(JSON.stringify(raw)));expect(restored.centralizerDesign.intervals[0].spec).toEqual(out);expect(restored.equipment[0].centralizerSpec).toEqual(out);
 expect(calculateCentralization(restored,restored.centralizerDesign.intervals,1100)).toEqual(calculateCentralization(restored,[iv],1100));
});
it('flags edits of material properties but ignores installation quantity and depth',()=>{
 const lib=library(),out=applyEquipmentRevision(selected,lib.entries[0],1);
 expect(equipmentSignature({...out,quantity:8,depthMD:1500})).toBe(out.libraryReference.signature);
 expect(equipmentReferenceText(out.libraryReference,equipmentSignature({...out,outerDiameter:200}))).toContain('изменены в проекте');
 const restored=normalizeWellData({...getCementingExample().wellData,equipment:[out]});expect(restored.equipment[0].libraryReference).toEqual(out.libraryReference);
});
it('does not combine same-model centralizers from distinct revisions in the count',()=>{
 const lib=saveEquipmentRevision(emptyEquipmentLibrary(),centralizerProperties(spec()),meta),entry=lib.entries[0];
 const v2=saveEquipmentRevision(lib,{...entry.revisions[0].properties},meta,entry.id);
 const first=applyCentralizerRevision(entry,1),second=applyCentralizerRevision(v2.entries[0],2);
 const intervals=[{id:'a',fromMD:0,toMD:12,centralizersPerJoint:1,jointLength:12,spec:first},{id:'b',fromMD:12,toMD:24,centralizersPerJoint:1,jointLength:12,spec:second}];
 expect(centralizerInventory(24,intervals)).toHaveLength(2);
 const w={...getCementingExample().wellData,casingDepthMD:24},key=centralizerMaterialGeometryKey(w);
 expect(centralizerMaterialGeometryKey({...w,centralizerDesign:{mode:'manual',targetStandoff:67,jointLength:12,autoSpec:first,intervals}})).not.toBe(key);
});
it('rejects corrupt imports, invalid units, unsafe links and unknown fields',()=>{
 const lib=library();expect(()=>parseEquipmentLibrary(JSON.stringify({...lib,schemaVersion:2}))).toThrow();
 for(const change of [{backpressureMPa:-2},{outerDiameter:'190'},{quantity:5},{sourceUrl:'javascript:alert(1)'}])expect(()=>saveEquipmentRevision(emptyEquipmentLibrary(),{...equipmentProperties(selected),...change} as never,meta)).toThrow();
 expect(()=>saveEquipmentRevision(emptyEquipmentLibrary(),equipmentProperties(selected),{...meta,source:''})).toThrow('источник');
 const bad=structuredClone(lib);bad.entries[0].revisions[0].version=3;expect(()=>parseEquipmentLibrary(JSON.stringify(bad))).toThrow('история');
 expect(()=>applyEquipmentRevision({...selected,kind:'basket'},lib.entries[0],1)).toThrow('Тип оснастки');
});
it('does not overwrite another tab, corrupt storage, or data after quota failure',()=>{
 let raw:string|null=null;const storage={getItem:()=>raw,setItem:(_:string,v:string)=>{raw=v;}};
 writeEquipmentLibrary(storage,library(),null);const before=raw;expect(readEquipmentLibrary(storage).library.entries).toHaveLength(1);
 expect(()=>writeEquipmentLibrary(storage,emptyEquipmentLibrary(),null)).toThrow('другой вкладке');expect(raw).toBe(before);
 expect(()=>writeEquipmentLibrary({getItem:()=>raw,setItem:()=>{throw new Error('quota');}},emptyEquipmentLibrary(),raw)).toThrow('quota');expect(raw).toBe(before);
 raw='broken';expect(()=>readEquipmentLibrary(storage)).toThrow();expect(raw).toBe('broken');
});
