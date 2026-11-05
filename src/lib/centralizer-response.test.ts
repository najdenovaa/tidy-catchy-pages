import { expect,it } from 'vitest';
import {pcCentralizers} from './pc-centralizers';
import {avroraCentralizers} from './avrora-centralizers';
import {centralizerCalibration,centralizerDeflection,centralizerRadialForce} from './centralizer-response';
import {calculateCentralization} from './centralization-calculations';
import type {WellData} from './cementing-calculations';
const spec=pcCentralizers.find(p=>p.spec.passport?.model==='ПЦ-2-168/222')!.spec;
it('калибрует суммарную реакцию устройства по табличным кН, не по каждой рессоре',()=>{
 const d=(222-168)/2*.33;
 expect(centralizerRadialForce(spec,168,222,d)).toBeCloseTo(4.27,6);
 expect(centralizerRadialForce(spec,168,222,0)).toBeCloseTo(0,8);
 expect(centralizerDeflection(spec,168,222,4270,1,1e6).supportMM).toBeCloseTo(d,5);
});
it('прогиб опоры зависит от нагрузки и жёсткости, прогиб пролёта от расстояния',()=>{
 const low=centralizerDeflection(spec,168,222,200,6,1e6),high=centralizerDeflection(spec,168,222,500,6,1e6);
 expect(high.supportMM).toBeGreaterThan(low.supportMM);
 expect(high.sagMM).toBeGreaterThan(low.sagMM);
 const stiff={...spec,passport:{...spec.passport!,restoringForceKgf:spec.passport!.restoringForceKgf!*2}};
 expect(centralizerDeflection(stiff,168,222,500,6,1e6).supportMM).toBeLessThan(high.supportMM);
});
it('модельные допущения не подменяют данные паспорта',()=>{
 const a=avroraCentralizers[0].spec;
 expect(centralizerCalibration(a)).toMatchObject({forceKN:5,standoff:67,assumedForce:true,assumedStandoff:true});
 expect(a.restoringForce).toBe(0);expect(a.passport?.restoringForceKgf).toBeUndefined();
 expect(centralizerCalibration(spec)).toMatchObject({forceKN:4.27,assumedForce:false,assumedStandoff:true});
 expect(spec.passport?.restoringStandoff).toBeUndefined();
});
it('считает профиль ПЦ без обязательного ввода 67% и передаёт деформацию опоры в 3D',()=>{
 const well:WellData={wellDepthMD:300,wellDepthTVD:200,casingDepthMD:300,casingOD:168,casingWall:8,holeDiameter:222,cavernCoeff:1,prevCasingDepth:0,prevCasingID:0,prevCasingOD:0,ckodDepth:300,cementRiseHeight:0,bottomTempStatic:60,bottomTempCirc:40,pumpZoneTop:0,pumpZoneBottom:0,trajectory:[{md:0,tvd:0,zenith:45,azimuth:0},{md:300,tvd:200,zenith:45,azimuth:0}]};
 const calc=(n:number)=>calculateCentralization(well,[{id:'1',fromMD:0,toMD:300,centralizersPerJoint:n,jointLength:12,spec}],1100);
 const a=calc(1)[10],b=calc(2)[10];
 expect(a.supportEccentricity).toBeGreaterThan(0);expect(a.lateralLoadKN).toBeGreaterThan(0);
 expect(b.supportEccentricity!).toBeLessThan(a.supportEccentricity!);
 expect(b.standoff).toBeGreaterThan(a.standoff);
 expect(a.eccentricity).toBeGreaterThanOrEqual(a.supportEccentricity!-.001);
});
