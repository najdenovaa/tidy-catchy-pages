import {describe,it,expect} from 'vitest';
import {validateWorkoverPart} from './workover-validation';
import {calculateCleanout,checkCasing} from './workover-operations';
import {calculateKill,type KillInput,type WorkoverWellData} from './workover-calculations';
import {buildKillSchedule} from './workover-kill-schedule';
import {restoreWorkoverDraft} from '../hooks/use-workover-draft';
const well:WorkoverWellData={wellDepthMD:2500,trajectory:[{md:0,tvd:0,zenith:0,azimuth:0},{md:2500,tvd:2500,zenith:0,azimuth:0}],casingID_mm:152,holeDiameter_mm:215.9,pipeOD_mm:73,pipeID_mm:62,pipeWeight_kgm:9.67,pipeGrade:'Е',pipeYieldMPa:552,pipeYoungModulusGPa:210,fluidDensity_gcm3:1.1,fluidPV_cP:15,fluidYP_Pa:5};
const clean={plugTopMD:2000,plugBottomMD:2100,method:'direct' as const,rateLs:8,grainDiameter_mm:.25,feedRate_mh:6,plugPorosity:.4};
const kill:KillInput={method:'wait_weight',formationPressureMPa:28,reservoirDepthTVD:2200,fracturePressureMPa:42,currentMudDensity:1.1,wellDepthMD:2500,casingID_mm:152,tubingOD_mm:73,tubingID_mm:62,killFluidPV_cP:20,killFluidYP_Pa:6,pumpRateLs:8,safetyMarginPct:5};
describe('Блокировка недопустимых расчётов',()=>{
 it('не подтверждает вынос при НКТ 73 в ID 60',()=>{const r=calculateCleanout(clean,{...well,casingID_mm:60});expect(r.ok).toBe(false);expect(r.warnings.length).toBeGreaterThan(0);expect(r.minRateLs).toBeGreaterThanOrEqual(0);expect(r.upflowVelocityMs).toBe(0);});
 it.each([1.2,-.1,NaN,Infinity])('не рассчитывает массу при пористости %s',porosity=>{const r=calculateCleanout({...clean,plugPorosity:porosity},well);expect(r.ok).toBe(false);expect(r.sandMassKg).toBe(0);});
 it('блокирует обратный интервал и глубины ниже забоя',()=>{expect(calculateCleanout({...clean,plugTopMD:2200},well).ok).toBe(false);expect(calculateCleanout({...clean,plugBottomMD:3000},well).ok).toBe(false);});
 it('при ошибках глушения не строит график',()=>{const input={...kill,tubingID_mm:80};const r=calculateKill(input);expect(r.valid).toBe(false);expect(buildKillSchedule(input,r)).toEqual([]);});
 it('блокирует отрицательную стенку',()=>{const r=checkCasing({casingOD_mm:168,casingWall_mm:-1,casingYieldMPa:552,wearPct:0,bottomMD:2500,testPressureMPa:15,insideDensity:1,outsideDensity:1,levelMD:0,sfBurst:1.15,sfCollapse:1.1},well);expect(r.burstOk).toBe(false);expect(r.collapseOk).toBe(false);});
 it('сохраняет отрицательное изменение температуры, запрещает отрицательные давления',()=>{expect(validateWorkoverPart('packer',{avgTempChangeC:-20})).toEqual([]);expect(validateWorkoverPart('packer',{tubingSurfaceMPa1:-2}).length).toBeGreaterThan(0);});
});
describe('Разные сценарии глушения',()=>{
 it('бурильщик имеет первый цикл и второе замещение',()=>{const input={...kill,method:'driller' as const};const r=calculateKill(input),p=buildKillSchedule(input,r);expect(p[0].p).toBe(r.initialCircPressureMPa);expect(p.filter(x=>x.stage.startsWith('1-й')).every(x=>x.p===r.initialCircPressureMPa)).toBe(true);expect(p.at(-1)!.v).toBeCloseTo(2*r.killVolumeM3);expect(p.at(-1)!.p).toBeCloseTo(r.finalCircPressureMPa);});
 it('ожидание занимает один цикл, объёмный метод не имеет графика циркуляции',()=>{const r=calculateKill(kill);expect(buildKillSchedule(kill,r).at(-1)!.v).toBeCloseTo(r.killVolumeM3);expect(buildKillSchedule({...kill,method:'volumetric'},r)).toEqual([]);});
 it('задавка ограничена объёмом заполнения НКТ, не обещает проникновение',()=>{const input={...kill,method:'bullhead' as const};const r=calculateKill(input);const p=buildKillSchedule(input,r);expect(p.at(-1)!.v).toBeCloseTo(r.tubingVolumeM3);expect(p.at(-1)!.p).toBeCloseTo(r.bullheadEndPressureMPa);});
});
describe('Восстановление черновика',()=>{
 it('восстанавливает допустимые данные и добавляет отсутствующие поля',()=>{expect(restoreWorkoverDraft(JSON.stringify({rateLs:10}),clean,'cleanout').rateLs).toBe(10);});
 it('повреждённый JSON, неправильные типы и физически невозможные значения не попадают в расчёт',()=>{for(const raw of ['{',JSON.stringify({...clean,rateLs:'8'}),JSON.stringify({...clean,plugPorosity:1.2})]) expect(restoreWorkoverDraft(raw,clean,'cleanout')).toEqual(clean);});
 it('план не принимает неизвестные и повторяющиеся операции',()=>{expect(restoreWorkoverDraft('["unknown"]',[],'selectedOperations')).toEqual([]);expect(restoreWorkoverDraft('["kill","kill"]',[],'selectedOperations')).toEqual([]);expect(restoreWorkoverDraft('["kill","rig"]',[],'selectedOperations')).toEqual(['kill','rig']);});
});
