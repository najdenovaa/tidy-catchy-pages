export interface DisplacementTimingSettings {maxTimeStepS?:number;frameIntervalS?:number;playbackMs?:number}
export interface DisplacementTimingStats {
 requestedMaxStepS:number|null;requestedFrameIntervalS:number|null;targetFrameIntervalS:number;
 minStepS:number;maxStepS:number;meanStepS:number;frames:number;complete:boolean;actualSettleS:number;plannedTotalS:number;
}
export const MAX_DISPLACEMENT_FRAMES=2000;
export function normalizeDisplacementTiming(s:DisplacementTimingSettings={}){
 const positive=(v:number|undefined,max:number,name:string)=>{
  if(v===undefined||v===0)return undefined;
  if(!Number.isFinite(v)||v<.01||v>max)throw new Error(`${name}: введите 0 (авто) или число от 0.01 до ${max} с.`);
  return v;
 };
 return {maxTimeStepS:positive(s.maxTimeStepS,60,'Максимальный шаг'),frameIntervalS:positive(s.frameIntervalS,86400,'Интервал кадров')};
}
export function timingRows(settings:DisplacementTimingSettings={},stats?:DisplacementTimingStats):[string,string|number][] {
 const rows:[string,string|number][]=[['Максимальный шаг решателя, с',settings.maxTimeStepS||'Авто'],['Заданный интервал кадров, с',settings.frameIntervalS||'Авто'],['Метод сохранения','Первое рассчитанное состояние после очередного срока; фактическое время записано. Сохранение кадров не меняет шаг решателя.']];
 if(stats)rows.push(['Фактический минимум шага, с',stats.minStepS],['Фактический максимум шага, с',stats.maxStepS],['Средний шаг, с',stats.meanStepS],['Целевой интервал кадров, с',stats.targetFrameIntervalS],['Сохранено затрубных кадров',stats.frames],['Расчёт завершён',stats.complete?'Да':'Нет, результат обрезан'],['Выполненная выдержка, с',stats.actualSettleS],['Плановое время затрубного расчёта, с',stats.plannedTotalS]);
 return rows;
}
/** Preflight bound only; stability can require still smaller steps. */
export function validateTimingBudget(pumpS:number,totalS:number,maxStepS?:number){
 if(maxStepS&&(Math.ceil(pumpS/maxStepS)>200000||Math.ceil(totalS/maxStepS)>260000))throw new Error('Заданный шаг потребует больше допустимого числа шагов. Увеличьте максимальный шаг или сократите интервал расчёта.');
}
export function validateFrameBudget(totalS:number,intervalS:number,extra=3,limit=MAX_DISPLACEMENT_FRAMES){
 if(intervalS>0&&Math.ceil(totalS/intervalS)+extra>limit)throw new Error(`Интервал кадров слишком мал: допускается до ${limit} кадров. Увеличьте интервал кадров.`);
}
