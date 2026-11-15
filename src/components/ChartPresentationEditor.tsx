import {useEffect,useMemo,useState} from 'react';
import {Button} from './ui/button';
import {Input} from './ui/input';
import {normalizeChartPresentations,resolveChartPresentation,validChartRange,type ChartPresentations,type ChartPresentation,type PresentationPlotId} from '@/lib/chart-presentation';
import type {NumericChart} from '@/lib/cementing-chart-data';
interface Draft {title:string;fontFamily:string;fontSize:string;xMin:string;xMax:string;leftMin:string;leftMax:string;rightMin:string;rightMax:string}
function makeDraft(plot:NumericChart|undefined,stored:ChartPresentation|undefined):Draft{
 const p=resolveChartPresentation(stored,{x:plot?.data.xLabel??'',left:plot?.data.leftLabel??'',right:plot?.data.rightLabel});
 return {title:p.presentation?.title??'',fontFamily:p.presentation?.fontFamily??'sans-serif',fontSize:String(p.presentation?.fontSize??13),xMin:p.ranges.x?String(p.ranges.x.min):'',xMax:p.ranges.x?String(p.ranges.x.max):'',leftMin:p.ranges.left?String(p.ranges.left.min):'',leftMax:p.ranges.left?String(p.ranges.left.max):'',rightMin:p.ranges.right?String(p.ranges.right.min):'',rightMax:p.ranges.right?String(p.ranges.right.max):''};
}
export default function ChartPresentationEditor({plots,presentations,onChange}:{plots:NumericChart[];presentations?:ChartPresentations;onChange?:(s:ChartPresentations)=>void}){
 const [selected,setSelected]=useState(''),p=plots.find(p=>p.plotId===selected)??plots[0];
 const stored=p?presentations?.[p.plotId as PresentationPlotId]:undefined,signature=JSON.stringify(stored??{}),context=JSON.stringify([p?.data.xLabel,p?.data.leftLabel,p?.data.rightLabel,p?.data.sourceTitle]);
 const [draft,setDraft]=useState<Draft>(()=>makeDraft(p,stored));
 useEffect(()=>{setDraft(makeDraft(p,stored));},[p?.plotId,signature,context]);
 const parsed=useMemo(()=>{
  if(!p)return {errors:['Нет актуального графика для оформления.'],value:{} as ChartPresentation};
  const errors:string[]=[],value:ChartPresentation={...(draft.title.trim()?{title:draft.title.trim()}:{}),fontFamily:draft.fontFamily as ChartPresentation['fontFamily'],fontSize:Number(draft.fontSize),basis:{x:p.data.xLabel,left:p.data.leftLabel,right:p.data.rightLabel}};
  if(!Number.isInteger(value.fontSize)||value.fontSize!<10||value.fontSize!>20)errors.push('Размер шрифта: целое число от 10 до 20 px.');
  if(draft.title.length>120)errors.push('Заголовок: не больше 120 символов.');
  for(const key of ['x','left','right'] as const){if(key==='right'&&!p.data.rightLabel)continue;
   const a=draft[`${key}Min`],b=draft[`${key}Max`];if(!a.trim()&&!b.trim())continue;
   const r={min:Number(a),max:Number(b)};
   if(!a.trim()||!b.trim()||!validChartRange(r))errors.push(`${key==='x'?p.data.xLabel:key==='left'?p.data.leftLabel:p.data.rightLabel}: задайте оба конечных предела, максимум больше минимума. Допустимо ±10⁹, ширина окна не меньше 10⁻⁶.`);else value[key]=r;
  }
  return {errors,value};
 },[draft,p]);
 if(!p)return null;
 const rangeFields=(key:'x'|'left'|'right',label:string)=><fieldset className="border rounded p-2 space-y-1"><legend className="text-xs">{label}</legend><div className="grid grid-cols-2 gap-2">{(['Min','Max'] as const).map(suffix=><label key={suffix} className="text-xs">{suffix==='Min'?'Минимум':'Максимум'}<Input aria-label={`${key} ${suffix}`} type="number" step="any" placeholder="Авто" value={draft[`${key}${suffix}`]} onChange={e=>setDraft({...draft,[`${key}${suffix}`]:e.target.value})}/></label>)}</div><p className="text-[11px] text-muted-foreground">Оба поля пусты - автоматический диапазон.</p></fieldset>;
 return <details className="border rounded p-3 space-y-3" data-testid="chart-presentation-editor"><summary className="text-sm font-medium cursor-pointer">Оформление графиков и масштаб</summary>
  <p className="text-xs text-muted-foreground">Настройки применяются к предпросмотру ниже и изображениям Word, сохраняются в проекте. Интерактивные графики выше/ниже сохраняют своё стандартное оформление. XLSX содержит полный ряд и параметры оформления, включая скрытые окном значения.</p>
  <label className="block text-xs">График<select aria-label="График для оформления" className="block w-full border rounded bg-background p-2" value={p.plotId} onChange={e=>setSelected(e.target.value)}>{plots.map(p=><option key={p.plotId} value={p.plotId}>{p.data.sourceTitle}</option>)}</select></label>
  <label className="block text-xs">Заголовок<Input aria-label="Заголовок графика" maxLength={120} placeholder={p.data.sourceTitle} value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})}/></label>
  <div className="grid grid-cols-2 gap-2"><label className="text-xs">Шрифт<select aria-label="Шрифт графика" className="block w-full border rounded bg-background p-2" value={draft.fontFamily} onChange={e=>setDraft({...draft,fontFamily:e.target.value})}><option value="sans-serif">Без засечек</option><option value="serif">С засечками</option><option value="monospace">Моноширинный</option></select></label><label className="text-xs">Размер, px<Input aria-label="Размер шрифта графика" type="number" min={10} max={20} step={1} value={draft.fontSize} onChange={e=>setDraft({...draft,fontSize:e.target.value})}/></label></div>
  <div className="grid sm:grid-cols-2 gap-2">{rangeFields('x',(p.data.depth?'Вертикальная координата: ':'Ось X: ')+p.data.xLabel)}{rangeFields('left',(p.data.depth?'Горизонтальная шкала: ':'Левая шкала: ')+p.data.leftLabel)}{p.data.rightLabel&&rangeFields('right','Правая шкала: '+p.data.rightLabel)}</div>
  {parsed.errors.map(e=><p role="alert" className="text-xs text-destructive" key={e}>{e}</p>)}
  <div className="flex gap-2 flex-wrap"><Button disabled={!onChange||!!parsed.errors.length} onClick={()=>onChange?.({...normalizeChartPresentations(presentations),[p.plotId]:parsed.value})}>Применить оформление</Button><Button variant="outline" disabled={!onChange} onClick={()=>{const next={...normalizeChartPresentations(presentations)};delete next[p.plotId as PresentationPlotId];onChange?.(next);setDraft(makeDraft(p,undefined));}}>Сбросить оформление графика</Button></div>
  {p.data.ignoredRanges.length>0&&<p role="status" className="text-xs text-amber-700">Координата или единицы изменились. Прежние пределы соответствующих шкал не применены.</p>}
  {p.data.outsideCount>0&&<p role="status" className="text-xs text-amber-700">За пределами окна: {p.data.outsideCount} значений. Полный ряд сохранён для XLSX.</p>}
  <div className="overflow-auto border rounded bg-white"><div aria-label="Предпросмотр оформленного графика" className="min-w-[700px] [&_svg]:w-full [&_svg]:h-auto" dangerouslySetInnerHTML={{__html:p.svg}}/></div>
 </details>;
}
