import {describe,it,expect} from 'vitest';
import {getCementingExample} from './cementing-example';
import {normalizeCementingSnapshot} from './cementing-normalizers';
import {FLUID_LIBRARY_KEY,emptyFluidLibrary,fluidProperties,saveFluidRevision,applyFluidRevision,fluidIsModified,parseFluidLibrary,readFluidLibrary,writeFluidLibrary,fluidReferenceText,type FluidKind,type ProjectFluid} from './fluid-library';
const ex=getCementingExample();
const conditions={source:'Протокол Л-26 от 12.11.2026',basis:'laboratory' as const,temperatureC:58,pressureMPa:25,notes:'Партия G-26; вода скважины'};
const sources:Record<FluidKind,ProjectFluid>={mud:ex.drillingFluid,buffer:ex.buffers[0],slurry:ex.slurries[0],displacement:ex.displacementFluids[0]};
function library(kind:FluidKind='slurry'){return saveFluidRevision(emptyFluidLibrary(),kind,fluidProperties(kind,sources[kind]),conditions);}
describe('versioned fluid properties',()=>{
 for(const kind of Object.keys(sources) as FluidKind[])it(`${kind}: canonical density and explicit application preserve job geometry and schedule`,()=>{
  const lib=library(kind),target=structuredClone(sources[kind]),before=structuredClone(target),e=lib.entries[0],f=applyFluidRevision(kind,target,e,1);
  expect(e.revisions[0].properties.density).toBe(kind==='slurry'?before.density*1000:before.density);
  expect(f.density).toBe(before.density);expect(f.libraryReference?.revision).toBe(1);expect(fluidIsModified(kind,f)).toBe(false);
  for(const key of ['topDepthMD','washVolume','volume','flowRateSteps'])expect(f[key as keyof ProjectFluid]).toEqual(before[key as keyof ProjectFluid]);
  expect(e.revisions[0].properties).not.toHaveProperty('topDepthMD');expect(e.revisions[0].properties).not.toHaveProperty('flowRateSteps');
  expect(parseFluidLibrary(JSON.stringify(lib))).toEqual(lib);
 });
 it('freezes project properties and prior versions across edit, copy and delete',()=>{
  const v1=library(),entry=v1.entries[0],project=applyFluidRevision('slurry',ex.slurries[0],entry,1);
  const v2=saveFluidRevision(v1,'slurry',{...entry.revisions[0].properties,density:1600},conditions,entry.id);
  expect(v1.entries[0].revisions).toHaveLength(1);expect(v2.entries[0].revisions).toHaveLength(2);expect(project.density).toBe(ex.slurries[0].density);
  const updated=applyFluidRevision('slurry',project,v2.entries[0],2);expect(updated.density).toBe(1.6);
  const copy=saveFluidRevision(v2,'slurry',v2.entries[0].revisions[1].properties,conditions);expect(copy.entries[1].id).not.toBe(entry.id);expect(copy.entries[1].revisions[0].version).toBe(1);
  copy.entries=[];expect(project.libraryReference?.source).toBe(conditions.source);
 });
 it('retains provenance on project roundtrip and marks manual changes, excluding volume edits',()=>{
  const lib=library(),s=applyFluidRevision('slurry',ex.slurries[0],lib.entries[0],1);
  const round=normalizeCementingSnapshot(JSON.parse(JSON.stringify({...ex,slurries:[s]}))).slurries[0];
  expect(round.libraryReference).toEqual(s.libraryReference);expect(fluidIsModified('slurry',round)).toBe(false);
  expect(fluidIsModified('slurry',{...round,topDepthMD:15,flowRateSteps:[]})).toBe(false);
  expect(fluidIsModified('slurry',{...round,density:1.5})).toBe(true);
  expect(fluidReferenceText('slurry',{...round,density:1.5})).toContain('свойства изменены в проекте');
  expect(normalizeCementingSnapshot(ex).slurries[0].libraryReference).toBeUndefined();
 });
 it('copies all Fann readings and manufacturer identities without transporting job additive masses',()=>{
  const s={...ex.slurries[0],rheology:{pv:20,yp:3,fann:{r600:55,r300:35,r100:15}},additives:[{name:'IG',percentage:.2,percentageType:'bwoc' as const,massKg:123,manufacturer:'Айсберг',batch:'26'}]};
  const props=fluidProperties('slurry',s);expect(props.rheology.fann).toEqual(s.rheology.fann);expect(props.additives[0]).toMatchObject({manufacturer:'Айсберг',percentage:.2,massKg:0});
 });
 it('does not fabricate missing Fann readings or discard a bottomhole Fann-only dataset',()=>{
  const mud={...ex.drillingFluid,rheologyBottomhole:{pv:0,yp:0,fann:{r600:50,r300:30,r100:15}}};
  const round=normalizeCementingSnapshot({...ex,drillingFluid:mud}).drillingFluid;
  expect(round.rheologyBottomhole).toEqual(mud.rheologyBottomhole);
  const props=fluidProperties('mud',mud);expect(props.rheologyBottomhole.fann).not.toHaveProperty('r3');
 });
 it('blocks absolute-only additive doses instead of silently dropping the recipe',()=>{
  const p=fluidProperties('slurry',{...ex.slurries[0],additives:[{name:'Доза',percentage:0,percentageType:'bwoc',massKg:100}]});
  expect(()=>saveFluidRevision(emptyFluidLibrary(),'slurry',p,conditions)).toThrow('Переведите её в проценты');
 });
 it('clears optional properties from a different material and rejects kind mismatch',()=>{
  const lib=library('mud'),target={...ex.drillingFluid,rheologyBottomhole:{pv:100,yp:30}};
  const entry=structuredClone(lib.entries[0]);delete entry.revisions[0].properties.rheologyBottomhole;
  expect(applyFluidRevision('mud',target,entry,1).rheologyBottomhole).toBeUndefined();
  expect(()=>applyFluidRevision('slurry',ex.slurries[0],entry,1)).toThrow('Тип жидкости');
 });
 it('requires laboratory conditions and prevents invalid or nonfinite physical values',()=>{
  const props=fluidProperties('mud',ex.drillingFluid);
  expect(()=>saveFluidRevision(emptyFluidLibrary(),'mud',props,{...conditions,temperatureC:undefined})).toThrow('температуру');
  for(const density of [0,-1,NaN,Infinity,6000])expect(()=>saveFluidRevision(emptyFluidLibrary(),'mud',{...props,density},conditions)).toThrow();
  expect(()=>saveFluidRevision(emptyFluidLibrary(),'mud',{...props,rheology:{pv:-1,yp:5}},conditions)).toThrow();
 });
 it('rejects corrupt files, mixed units, duplicate ids and changed histories',()=>{
  const lib=library();expect(()=>parseFluidLibrary('{')).toThrow();expect(()=>parseFluidLibrary(JSON.stringify({...lib,schemaVersion:2}))).toThrow();
  const dup={...lib,entries:[...lib.entries,...lib.entries]};expect(()=>parseFluidLibrary(JSON.stringify(dup))).toThrow();
  const bad=structuredClone(lib);bad.entries[0].revisions[0].properties.density='1.85' as unknown as number;expect(()=>parseFluidLibrary(JSON.stringify(bad))).toThrow();
  bad.entries[0].revisions[0].properties.density=1850;bad.entries[0].revisions[0].version=3;expect(()=>parseFluidLibrary(JSON.stringify(bad))).toThrow();
 });
 it('persists atomically and rejects stale writes and storage failures',()=>{
  let raw:string|null=null;const storage={getItem:()=>raw,setItem:(_:string,v:string)=>{raw=v;}};
  const token=writeFluidLibrary(storage,library(),null);expect(readFluidLibrary(storage).library.entries).toHaveLength(1);
  expect(()=>writeFluidLibrary(storage,emptyFluidLibrary(),null)).toThrow('другой вкладке');expect(raw).toBe(token);
  expect(()=>writeFluidLibrary({getItem:()=>raw,setItem:()=>{throw new Error('quota');}},emptyFluidLibrary(),raw)).toThrow('quota');expect(raw).toBe(token);
  expect(FLUID_LIBRARY_KEY).toContain('v1');
 });
});
