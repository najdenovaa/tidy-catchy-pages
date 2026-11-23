import {useEffect,useState} from 'react';
import type {BufferFluid,DrillingFluid} from '@/lib/cementing-calculations';
import {WASH_RECIPES,WASH_RECIPE_NOTE,washComponent,washFamily,recipeBatch,applyChemicalRecipe,chemicalRecipeIssue,confirmChemicalProperties} from '@/lib/chemical-wash-recipes';
import {Button} from './ui/button';
const cls='w-full min-w-0 rounded border bg-background p-2 text-sm';
export function ChemicalPropertyConfirm({buffer:b,mud,onChange}:{buffer:BufferFluid;mud:DrillingFluid;onChange:(b:BufferFluid)=>void}){
 const [error,setError]=useState('');
 if(!b.chemicalRecipe)return null;
 const field=(label:string,value:number|undefined,change:(v:number|undefined)=>void)=><label className="text-xs">{label}<input className={cls} aria-label={label} type="number" step="any" value={value??''} onChange={e=>change(e.target.value===''?undefined:Number(e.target.value))}/></label>;
 return <div className="space-y-2 border rounded p-3" data-chemical-measurements>
  <p className="text-xs font-medium">Расчётные свойства химбуфера · можно изменить</p>
  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
   {field('Плотность химбуфера, кг/м³',b.density,v=>onChange({...b,density:v??0}))}
   {field('PV химбуфера, сПз',b.rheology.pv,v=>onChange({...b,rheology:{...b.rheology,model:'pvyp',pv:v??0}}))}
   {field('YP химбуфера, Па',b.rheology.yp,v=>onChange({...b,rheology:{...b.rheology,model:'pvyp',yp:v??0}}))}
   {field('Температура химбуфера, °C',b.rheology.testTemperatureC,v=>onChange({...b,rheology:{...b.rheology,testTemperatureC:v}}))}
   {field('Давление химбуфера, МПа абс.',b.rheology.testPressureMPaAbs,v=>onChange({...b,rheology:{...b.rheology,testPressureMPaAbs:v}}))}
  </div>
  <p className="text-xs">Ввод PV/YP выбирает модель Бингама. Для аппроксимации Fann используйте редактор реологии в карточке буфера.</p>
  <details><summary>Лабораторные сведения (необязательно)</summary>
  <label className="text-xs block">Вода/рассол и минерализация<input aria-label="Вода химбуфера и минерализация" className={cls} value={b.chemicalRecipe.waterSource??''} onChange={e=>onChange({...b,chemicalRecipe:{...b.chemicalRecipe!,waterSource:e.target.value}})}/></label>
  <label className="text-xs block">Протокол замеров свойств<input aria-label="Протокол замеров свойств химбуфера" className={cls} value={b.chemicalRecipe.propertySource??''} onChange={e=>onChange({...b,chemicalRecipe:{...b.chemicalRecipe!,propertySource:e.target.value}})}/></label>
  <Button variant="outline" onClick={()=>{try{onChange(confirmChemicalProperties(b,b.chemicalRecipe?.propertySource??''));setError('');}catch(e){setError((e as Error).message);}}}>Подтвердить замеры химбуфера</Button>
  <p role="status" className="text-xs text-amber-700">{chemicalRecipeIssue(b,mud)?'Стартовые расчётные свойства; лабораторное подтверждение не требуется для расчёта программы.':'Свойства этого состава подтверждены введённым протоколом. Для цели 85% отдельно требуется испытание смытия.'}</p>
  {error&&<p role="alert" className="text-xs text-destructive">{error}</p>}
  </details>
 </div>;
}
export default function ChemicalWashRecipes({mud,buffers,onMudChange,onBuffersChange}:{mud:DrillingFluid;buffers:BufferFluid[];onMudChange?:(m:DrillingFluid)=>void;onBuffersChange?:(b:BufferFluid[])=>void}){
 const [selected,setSelected]=useState(''),[target,setTarget]=useState(()=>String(buffers.findIndex(b=>b.bufferType==='chemical_wash'))),[doses,setDoses]=useState<Record<string,number>>({}),[mass,setMass]=useState(1000),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const family=washFamily(mud.base??'water'),recipes=WASH_RECIPES.filter(r=>!family||r.family===family),recipe=recipes.find(r=>r.id===selected)??recipes[0];
 useEffect(()=>{setDoses({});setError('');},[recipe.id]);
 const rows=recipe.components.map(x=>{const c=washComponent(x.id)!,pct=doses[x.id]??x.pct;return {...c,pct,massKg:mass*pct/100};});
 const index=Number(target),b=index>=0&&buffers[index]?.bufferType==='chemical_wash'?buffers[index]:undefined;
 let batch:ReturnType<typeof recipeBatch>|undefined,batchError='';
 try{batch=recipeBatch(recipe,doses,mass);}catch(e){batchError=(e as Error).message;}
 const apply=()=>{
  try{
   const old=b??{name:'Химбуфер',density:0,volume:1,rheology:{pv:0,yp:0},additives:[],flowRateSteps:[{volumeM3:1,rateLps:10,volumeMode:'manual' as const}]};
   const next=applyChemicalRecipe(old,recipe,doses,{...mud,base:mud.base??'water'}),all=[...buffers];
   const i=b?index:all.length;if(b)all[i]=next;else all.push(next);
   if(!mud.base)onMudChange?.({...mud,base:'water'});
   onBuffersChange?.(all);setTarget(String(i));setNotice('Рецепт и стартовые расчётные свойства внесены. Программа готова к расчёту; при необходимости поправьте плотность, PV и YP.');setError('');
  }catch(e){setError((e as Error).message);}
 };
 return <details className="border rounded" data-testid="chemical-wash-recipes"><summary>Химия буфера и стартовые рецептуры</summary><div className="p-3 space-y-3">
  <p className="text-xs">Стартовые значения: плотность 1100 кг/м³, PV 20 сПз, YP 5 Па, 40 °C / 0,101325 МПа при отсутствии заданных T/P. Основа БР по умолчанию водная. Все параметры можно изменить; это расчётные допущения, не результаты замеров.</p>
  <details><summary>Основания рецептур</summary><p className="p-3 text-xs">{WASH_RECIPE_NOTE}</p></details>
  <div className="grid sm:grid-cols-2 gap-3">
   <label className="text-xs">Основа БР<select aria-label="Основа БР для подбора химии" className={cls} value={mud.base??'water'} disabled={!onMudChange} onChange={e=>onMudChange?.({...mud,base:e.target.value as DrillingFluid['base']||undefined})}><option value="">Не указана</option><option value="water">Водная</option><option value="oil">Нефтяная / РУО</option><option value="synthetic">Синтетическая</option></select></label>
   <label className="text-xs">Рецептура<select aria-label="Стартовая рецептура химбуфера" className={cls} value={recipe.id} onChange={e=>setSelected(e.target.value)}>{recipes.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
  </div>
  <p className="text-xs">{recipe.purpose}. {recipe.note}</p>
  <p className="text-xs">Не повышаем расчётное смытие по названию ПАВ. Литературные результаты относятся к исследованным образцам и не заполняют ваш протокол.</p>
  <label className="block text-xs">Масса партии для лабораторного расчёта, кг<input aria-label="Масса партии химбуфера, кг" className={cls} type="number" min="0.001" step="any" value={mass} onChange={e=>setMass(Number(e.target.value))}/></label>
  <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr><th>Компонент и функция</th><th>% массы готового буфера</th><th>На партию, кг</th></tr></thead><tbody>{rows.map(c=><tr className="border-t" key={c.id}><td className="p-2"><strong>{c.name}</strong><p>{c.function}</p><a className="underline" target="_blank" rel="noreferrer" href={c.sourceUrl}>Источник о компоненте</a></td><td className="p-2"><input aria-label={'Дозировка '+c.id} className={cls+' !min-w-[80px] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'} type="number" step="any" min="0" value={doses[c.id]??c.pct} onChange={e=>setDoses({...doses,[c.id]:Number(e.target.value)})}/>{(c.pct<c.screeningRange[0]||c.pct>c.screeningRange[1])&&<p className="text-amber-700">Вне стартового диапазона скрининга {c.screeningRange.join('–')}%.</p>}</td><td>{c.massKg.toFixed(3)}</td></tr>)}</tbody></table></div>
  {batch&&<p className="text-xs">Вода/согласованная водная основа — остаток {batch.baseMassKg.toFixed(3)} кг. Сумма с добавками — {batch.massKg.toFixed(3)} кг. Это массы поставляемых продуктов; активность по паспорту партии учитывается отдельно. Полимер для нужной реологии не назначается без испытаний.</p>}
  {batchError&&<p role="alert" className="text-xs text-destructive">{batchError}</p>}
  <label className="text-xs block">Куда внести рецепт<select className={cls} aria-label="Буфер для химической рецептуры" value={b?String(index):'-1'} onChange={e=>setTarget(e.target.value)}><option value="-1">Добавить отдельный химбуфер</option>{buffers.map((x,i)=>x.bufferType==='chemical_wash'?<option key={i} value={i}>{x.name}</option>:null)}</select></label>
  <Button disabled={!family||!!batchError||!onBuffersChange} onClick={apply}>Внести химическую рецептуру</Button>
  {!family&&<p className="text-xs text-amber-700">Выберите основу БР; по одному названию раствора она не определяется.</p>}
  {notice&&<p className="text-xs">{notice}</p>}{error&&<p role="alert" className="text-xs text-destructive">{error}</p>}
  {b?.chemicalRecipe&&onBuffersChange&&<ChemicalPropertyConfirm buffer={b} mud={mud} onChange={next=>onBuffersChange(buffers.map((x,i)=>i===index?next:x))}/>}
 </div></details>;
}
