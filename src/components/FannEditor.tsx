import {useState} from 'react';
import {DebouncedInput} from '@/components/DebouncedInput';
import {FANN_RPMS,RHEOLOGY_MODELS,rheologyResolution,rheologyMetrics,rheologyDescription,type FannReadings,type RheologyModel} from '@/lib/cement-rheology';
import {rheologyFigure,rheologyCsv} from '@/lib/rheology-figure';
import type {Rheology} from '@/lib/cementing-calculations';
export default function FannEditor({rheology:r,onChange}:{rheology:Rheology;onChange:(r:Rheology)=>void}){
 const [open,setOpen]=useState(!!r.fann||!!r.model),[residual,setResidual]=useState(false),resolution=rheologyResolution(r),fit=resolution.fit;
 const figure=fit?rheologyFigure(r,residual):undefined;
 const reading=(rpm:number,value:string)=>{
  const next:FannReadings={...r.fann};if(value==='')delete next[`r${rpm}`];else next[`r${rpm}`]=Number(value);
  const upd={...r,fann:Object.keys(next).length?next:undefined};
  if(r.model===undefined&&next.r600>0&&next.r300>0&&next.r600>=next.r300){upd.pv=Math.round((next.r600-next.r300)*10)/10;upd.yp=Math.round(Math.max(0,2*next.r300-next.r600)*.4788*100)/100;}
  onChange(upd);
 };
 return <div className="rounded border border-dashed p-2 space-y-2">
  <button type="button" className="text-xs text-primary underline" onClick={()=>setOpen(!open)}>{open?'▾':'▸'} Реология и показания Fann</button>
  {open&&<>
   <p className="text-xs text-muted-foreground">Fann R1-B1-F1: 1 об/мин = 1,7023 с⁻¹; 1 деление = 0,511 Па. Вводите показания после кондиционирования при условиях испытания. Пусто - не измерено; нулевое показание не участвует в логарифмическом подборе.</p>
   <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">{FANN_RPMS.map(rpm=><label className="text-xs" key={rpm}>{rpm} об/мин<DebouncedInput aria-label={`Fann ${rpm}`} type="number" min="0" step="any" value={r.fann?.[`r${rpm}`]??''} onChange={e=>reading(rpm,e.target.value)}/></label>)}</div>
   <label className="text-xs block">Модель для гидравлики<select aria-label="Модель для гидравлики" className="block w-full rounded border bg-background p-2 mt-1" value={r.model??'legacy'} onChange={e=>onChange({...r,model:e.target.value==='legacy'?undefined:e.target.value as RheologyModel})}>
    <option value="legacy">Прежний автоматический режим</option>{Object.entries(RHEOLOGY_MODELS).map(([k,label])=><option key={k} value={k}>{label}</option>)}</select></label>
   <p className="text-xs font-medium">Применяется: {resolution.label}</p>
   <p className="text-xs">{rheologyDescription(r)}</p>
   {!resolution.valid&&<p role="alert" className="text-xs text-destructive">{resolution.error} Расчёт с подменой модели не выполняется.</p>}
   {r.model===undefined&&<p className="text-xs text-amber-700">Для совместимости сохранён прежний режим: при доступном подборе используется Гершель–Балкли с ограничением n. Нулевые PV/YP без подбора заменяются модельными значениями по типу жидкости. Подсказка лучшей аппроксимации не переключает модель. Для нового расчёта выберите модель явно.</p>}
   {fit?<>
    <p className="text-xs">Подсказка по совпадению с замерами: {RHEOLOGY_MODELS[fit.best]}. Критерий прежнего подбора: R² со штрафом 0,002 для трёхпараметрической модели; это не оценка промысловой точности.</p>
    <div className="overflow-x-auto"><table className="text-xs w-full"><thead><tr><th>Модель</th><th>R²</th><th>RMSE, Па</th><th>Макс. ошибка, Па</th></tr></thead><tbody>{(['bingham','powerLaw','hb'] as const).map(m=>{const a=rheologyMetrics(fit,m);return <tr key={m}><td>{RHEOLOGY_MODELS[m]}</td><td>{a.r2.toFixed(4)}</td><td>{a.rmse.toFixed(3)}</td><td>{a.maxError.toFixed(3)}</td></tr>;})}</tbody></table></div>
    <p className="text-xs">Бингам: PV {fit.bingham.pv.toFixed(3)} сПз, YP {fit.bingham.ypPa.toFixed(3)} Па. Степенная: K {fit.powerLaw.K.toPrecision(5)}, n {fit.powerLaw.n.toFixed(4)}. Гершель–Балкли: τ₀ {fit.hb.tau0.toFixed(3)} Па, K {fit.hb.K.toPrecision(5)}, n {fit.hb.n.toFixed(4)}. K - Па·сⁿ.</p>
    <div className="flex gap-3"><button type="button" className="text-xs text-primary underline" onClick={()=>setResidual(!residual)}>{residual?'Кривые течения':'Остатки аппроксимации'}</button><button type="button" className="text-xs text-primary underline" onClick={()=>{const url=URL.createObjectURL(new Blob(['\uFEFF'+rheologyCsv(r)],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='rheology-comparison.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>Скачать реологию CSV</button></div>
    {figure&&<div role="img" aria-label={figure.title} dangerouslySetInnerHTML={{__html:figure.svg}}/>}
    <p className="text-xs text-muted-foreground">График ограничен диапазоном измерений; вне него применение модели является экстраполяцией. R² не подтверждает совместимость жидкостей, стабильность, тиксотропию или поведение после ОЗЦ.</p>
   </>:<p className="text-xs text-muted-foreground">Для сравнения нужны минимум три положительных показания с изменяющимся напряжением. Модель PV/YP доступна отдельно.</p>}
  </>}
 </div>;
}
