import {useMemo} from 'react';
import {createAnnularGeometry} from '@/lib/well-geometry';
import type {WellData} from '@/lib/cementing-calculations';
export default function WellGeometrySummary({wellData:w}:{wellData:WellData}){
 const summary=useMemo(()=>{
  const g=createAnnularGeometry(w,w.wellDepthMD),open=g.cells.filter(c=>c.topMD>=w.prevCasingDepth);
  return {measured:open.filter(c=>c.source==='measured').reduce((n,c)=>n+c.bottomMD-c.topMD,0),estimated:open.filter(c=>c.source!=='measured').reduce((n,c)=>n+c.bottomMD-c.topMD,0),conflict:g.cells.find(c=>c.areaM2<=0)};
 },[w]);
 if(!w.caliperLog&&!w.cavernIntervals?.length)return null;
 const log=w.caliperLog;
 return <div className="border border-border rounded-lg p-3 text-xs space-y-2" data-testid="well-geometry-summary">
  <p className="font-semibold">Единый профиль геометрии ствола</p>
  {log&&<><p>Источник LAS: {log.fileName}; кривая {log.curve}; исходных отсчётов {log.samples.length}. Единицы файла: {log.depthUnit} / {log.diameterUnit}. Шаг интервалов {log.intervalStepM} м.</p>
   <p>Эквивалентный диаметр из измерений сохраняется при изменении номинального диаметра. Коэффициент K пересчитывается относительно текущего номинала.</p>
   {log.intervalsEdited&&<p className="text-amber-700 dark:text-amber-400">Расчётные интервалы изменены вручную после импорта; исходные отсчёты сохранены отдельно.</p>}
   <button type="button" className="text-primary underline" onClick={()=>{
    const text='MD_m;diameter_mm\n'+log.samples.map(r=>`${r.md};${r.diameterMm??''}`).join('\n');
    const url=URL.createObjectURL(new Blob(['\uFEFF'+text],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='caliper-measurements.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
   }}>Скачать исходные отсчёты CSV</button></>}
  {!log&&summary.measured===0&&<p className="text-muted-foreground">В проекте сохранены относительные коэффициенты. Повторный импорт LAS сохранит независимые диаметры и исходные отсчёты.</p>}
  <p>Открытый ствол: измеренный диаметр — {summary.measured.toFixed(1)} м; геометрия по коэффициентам — {summary.estimated.toFixed(1)} м.</p>
  {summary.estimated>0&&<p className="text-muted-foreground">На участках без измеренного диаметра используются интервальные коэффициенты или коэффициент по умолчанию. Измерения на пропуски не продлеваются.</p>}
  {summary.conflict&&<p role="alert" className="text-destructive">Геометрический конфликт на MD {summary.conflict.topMD}–{summary.conflict.bottomMD} м: проход {summary.conflict.diameterMm.toFixed(1)} мм не больше диаметра колонны {w.casingOD} мм. Проверьте профиль до расчёта.</p>}
 </div>;
}
