import type { KillInput, KillResult } from './workover-calculations';

export interface KillSchedulePoint { v:number; p:number; stage:string }
/** Reference schedule, not transient influx migration. IWCF: driller's method has two circulations.
 * https://www.iwcf.org/glossary/drillers-method-2/
 * https://www.iwcf.org/glossary/initial-circulating-pressure-icp/
 */
export function buildKillSchedule(input: KillInput, result: KillResult): KillSchedulePoint[] {
  if(input.method==='volumetric' || result.valid===false) return [];
  const points:KillSchedulePoint[]=[];
  const phase=(start:number,volume:number,p0:number,p1:number,stage:string)=>{
    for(let i=0;i<=20;i++) points.push({v:start+volume*i/20,p:p0+(p1-p0)*i/20,stage});
  };
  if(input.method==='bullhead') {
    phase(0,result.tubingVolumeM3,result.bullheadSurfacePressureMPa,result.bullheadEndPressureMPa,'Заполнение НКТ (без прогноза приёмистости)');
    return points;
  }
  let offset=0;
  if(input.method==='driller') {
    phase(0,result.killVolumeM3,result.initialCircPressureMPa,result.initialCircPressureMPa,'1-й цикл: текущая жидкость');
    offset=result.killVolumeM3;
  }
  phase(offset,result.tubingVolumeM3,result.initialCircPressureMPa,result.finalCircPressureMPa,input.method==='driller'?'2-й цикл: замещение в НКТ':'Замещение в НКТ');
  phase(offset+result.tubingVolumeM3,result.annulusVolumeM3,result.finalCircPressureMPa,result.finalCircPressureMPa,'Замещение в затрубье');
  return points;
}
