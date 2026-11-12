import {useState} from 'react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import FannEditor from './FannEditor';
import type {DrillingFluid,BufferFluid,SlurryInput,DisplacementFluid} from '@/lib/cementing-calculations';
import {FLUID_KINDS,FLUID_BASES,emptyFluidLibrary,fluidProperties,saveFluidRevision,applyFluidRevision,parseFluidLibrary,readFluidLibrary,writeFluidLibrary,fluidReferenceText,type FluidKind,type ProjectFluid,type FluidLibrary as Library,type FluidProperties,type FluidConditions} from '@/lib/fluid-library';
interface Props {
 drillingFluid:DrillingFluid;buffers:BufferFluid[];slurries:SlurryInput[];displacementFluids:DisplacementFluid[];
 onDrillingFluidChange:(f:DrillingFluid)=>void;onBuffersChange:(f:BufferFluid[])=>void;onSlurriesChange:(f:SlurryInput[])=>void;onDisplacementFluidsChange:(f:DisplacementFluid[])=>void;
}
const button='rounded border px-3 py-2 text-xs hover:bg-muted disabled:opacity-40';
const field='w-full rounded border bg-background px-2 py-1 text-sm';
export default function FluidLibrary(p:Props){
 const [open,setOpen]=useState(false),[library,setLibrary]=useState<Library>(emptyFluidLibrary),[raw,setRaw]=useState<string|null>(null),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [kind,setKind]=useState<FluidKind>('mud'),[targetIndex,setTargetIndex]=useState(0),[entryId,setEntryId]=useState(''),[version,setVersion]=useState(1);
 const [draft,setDraft]=useState<FluidProperties|null>(null),[conditions,setConditions]=useState<FluidConditions>({source:'',basis:'user',notes:''});
 const [mode,setMode]=useState<'new'|'revision'|'copy'>('new');
 const targets:Record<FluidKind,ProjectFluid[]>={mud:[p.drillingFluid],buffer:p.buffers,slurry:p.slurries,displacement:p.displacementFluids};
 const target=targets[kind][targetIndex],entries=library.entries.filter(e=>e.kind===kind),entry=entries.find(e=>e.id===entryId),revision=entry?.revisions.find(r=>r.version===version);
 const run=(f:()=>void)=>{setError('');setMessage('');try{f();}catch(e){setError(e instanceof Error?e.message:'Не удалось выполнить действие.');}};
 const reload=()=>run(()=>{const x=readFluidLibrary(localStorage);setLibrary(x.library);setRaw(x.raw);setDraft(null);setEntryId('');});
 const persist=(next:Library)=>{const text=writeFluidLibrary(localStorage,next,raw);setRaw(text);setLibrary(next);};
 const editFromProject=(asRevision:boolean)=>run(()=>{
  if(!target)throw new Error('Сначала добавьте жидкость в проект.');
  setDraft(fluidProperties(kind,target));setMode(asRevision?'revision':'new');
  setConditions(asRevision&&revision?{source:revision.source,basis:revision.basis,notes:revision.notes,temperatureC:revision.temperatureC,pressureMPa:revision.pressureMPa}:{source:'',basis:'user',notes:''});
 });
 const updateTarget=(f:ProjectFluid)=>{
  if(kind==='mud')p.onDrillingFluidChange(f as DrillingFluid);
  if(kind==='buffer')p.onBuffersChange(p.buffers.map((x,i)=>i===targetIndex?f as BufferFluid:x));
  if(kind==='slurry')p.onSlurriesChange(p.slurries.map((x,i)=>i===targetIndex?f as SlurryInput:x));
  if(kind==='displacement')p.onDisplacementFluidsChange(p.displacementFluids.map((x,i)=>i===targetIndex?f as DisplacementFluid:x));
 };
 const download=()=>run(()=>{const blob=new Blob([JSON.stringify(library,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='deallsoft-fluid-library.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
 const changeKind=(k:FluidKind)=>{setKind(k);setTargetIndex(0);setEntryId('');setDraft(null);setError('');setMessage('');};
 const reference=target?fluidReferenceText(kind,target):'';
 return <>
  <button type="button" className={button} onClick={()=>{setOpen(true);reload();}}>Библиотека жидкостей</button>
  <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
   <DialogTitle>Библиотека жидкостей</DialogTitle>
   <DialogDescription>Свойства и рецептуры с историей версий. Применение заменяет свойства выбранной жидкости. Глубины, объёмы и режимы закачки задаются в проекте и сохраняются.</DialogDescription>
   <p className="text-xs text-muted-foreground">Библиотека хранится в этом браузере. Для переноса и резервной копии выгрузите JSON. Лабораторные данные вводятся по протоколу, отметка источника не является проверкой испытаний.</p>
   <div className="flex flex-wrap gap-2">
    <button className={button} onClick={reload}>Обновить список</button>
    <button className={button} onClick={download}>Экспорт JSON</button>
    <label className={button}>Импорт копий<input aria-label="Импорт библиотеки" className="sr-only" type="file" accept=".json,application/json" onChange={async e=>{
     const file=e.target.files?.[0];e.target.value='';if(!file)return;
     setError('');setMessage('');try{if(file.size>5000000)throw new Error('Файл больше 5 МБ.');const incoming=parseFluidLibrary(await file.text());
      // Compare the current storage token again after the asynchronous file read.
      persist({...library,entries:[...library.entries,...incoming.entries.map(x=>({...x,id:crypto.randomUUID()}))]});setMessage(`Импортировано записей: ${incoming.entries.length}. Существующие версии сохранены.`);
     }catch(err){setError(err instanceof Error?err.message:'Ошибка импорта.');}
    }}/></label>
   </div>
   {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}{message&&<p role="status" className="text-sm text-primary">{message}</p>}
   <div className="grid sm:grid-cols-2 gap-3">
    <label className="text-xs">Тип жидкости<select aria-label="Тип жидкости в библиотеке" className={field} value={kind} onChange={e=>changeKind(e.target.value as FluidKind)}>{Object.entries(FLUID_KINDS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
    <label className="text-xs">Жидкость проекта<select aria-label="Жидкость проекта" className={field} value={targetIndex} onChange={e=>{setTargetIndex(Number(e.target.value));setDraft(null);}}>{targets[kind].length?targets[kind].map((f,i)=><option key={i} value={i}>{i+1}. {f.name||'Без названия'}</option>):<option>Сначала добавьте жидкость в проект</option>}</select></label>
   </div>
   {reference&&<p className="text-xs border rounded p-2">{reference}</p>}
   <div className="flex gap-2 flex-wrap">
    <button className={button} onClick={()=>{setDraft(fluidProperties(kind,{name:'',density:0,rheology:{pv:0,yp:0}} as ProjectFluid));setMode('new');setConditions({source:'',basis:'user',notes:''});}}>Создать запись</button>
    <button className={button} disabled={!target} onClick={()=>editFromProject(false)}>Сохранить состав из проекта как новую запись</button>
   </div>
   <div className="grid sm:grid-cols-2 gap-3">
    <label className="text-xs">Запись библиотеки<select aria-label="Запись библиотеки" className={field} value={entryId} onChange={e=>{const en=entries.find(x=>x.id===e.target.value);setEntryId(e.target.value);setVersion(en?.revisions.at(-1)?.version??1);setDraft(null);}}><option value="">Выберите запись ({entries.length})</option>{entries.map(e=><option key={e.id} value={e.id}>{e.revisions.at(-1)!.properties.name}</option>)}</select></label>
    <label className="text-xs">Версия<select aria-label="Версия библиотеки" className={field} value={version} onChange={e=>{setVersion(Number(e.target.value));setDraft(null);}}>{entry?.revisions.map(r=><option key={r.version} value={r.version}>v{r.version} · {new Date(r.createdAt).toLocaleString('ru-RU')}</option>)}</select></label>
   </div>
   {revision&&<>
    <div className="rounded border p-3 text-xs space-y-1">
     <p className="font-semibold">{revision.properties.name} · v{revision.version}</p>
     <p>Плотность {revision.properties.density} кг/м³; PV {revision.properties.rheology.pv} сПз; YP {revision.properties.rheology.yp} Па{revision.properties.rheology.fann?'; показания Fann сохранены':''}.</p>
     <p>{FLUID_BASES[revision.basis]}: {revision.source}; t: {revision.temperatureC??'не задана'} °C; P: {revision.pressureMPa??'не задано'} МПа.</p>
     <p>{revision.notes}</p>
     {revision.properties.additives?.map((a,i)=><p key={i}>{a.name}: {a.percentage}% {a.percentageType}{a.manufacturer?` · ${a.manufacturer}`:''}</p>)}
    </div>
    <div className="flex flex-wrap gap-2">
     <button className={button+' bg-primary text-primary-foreground'} disabled={!target} onClick={()=>run(()=>{updateTarget(applyFluidRevision(kind,target,entry!,version));setMessage(`Версия ${version} применена к выбранной жидкости. Объёмы и режимы сохранены.`);})}>Применить выбранную версию к жидкости</button>
     <button className={button} onClick={()=>{setDraft(structuredClone(revision.properties));setConditions({...revision});setMode('revision');}}>Редактировать как новую версию</button>
     <button className={button} disabled={!target} onClick={()=>editFromProject(true)}>Новая версия из проекта</button>
     <button className={button} onClick={()=>{setDraft({...structuredClone(revision.properties),name:revision.properties.name+' (копия)'});setConditions({...revision});setMode('copy');}}>Копировать запись</button>
     <button className={button} onClick={()=>run(()=>{if(!window.confirm('Удалить запись и её историю из библиотеки? Снимки в проектах сохранятся.'))return;persist({...library,entries:library.entries.filter(x=>x.id!==entryId)});setEntryId('');setDraft(null);setMessage('Запись удалена из библиотеки.');})}>Удалить запись</button>
    </div>
   </>}
   {draft&&<section className="border rounded p-3 space-y-3">
    <h3 className="text-sm font-semibold">{mode==='revision'?'Новая версия записи':mode==='copy'?'Копия записи':'Новая запись из проекта'}</h3>
    <div className="grid sm:grid-cols-2 gap-3">
     <label className="text-xs">Наименование<input aria-label="Название записи" className={field} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
     <label className="text-xs">Плотность, кг/м³<input aria-label="Плотность библиотеки" className={field} type="number" value={Number.isNaN(draft.density)?'':draft.density} onChange={e=>setDraft({...draft,density:e.target.value===''?NaN:Number(e.target.value)})}/></label>
     {(['pv','yp'] as const).map(k=><label className="text-xs" key={k}>{k==='pv'?'PV, сПз':'YP, Па'}<input aria-label={k==='pv'?'PV библиотеки':'YP библиотеки'} className={field} type="number" value={Number.isNaN(draft.rheology[k])?'':draft.rheology[k]} onChange={e=>setDraft({...draft,rheology:{...draft.rheology,[k]:e.target.value===''?NaN:Number(e.target.value),fann:undefined,model:'pvyp'}})}/></label>)}
    </div>
    <FannEditor rheology={draft.rheology} onChange={r=>setDraft({...draft,rheology:r})}/>
    <p className="text-xs text-muted-foreground">Компоненты, В/Ц, выход, времена загустевания и остальные свойства копируются из состава. Для их правки используйте поля проекта и «Новую версию из проекта». Ввод PV/YP вручную очищает показания Fann и выбирает модель заданных PV/YP.</p>
    <div className="grid sm:grid-cols-2 gap-3">
     <label className="text-xs">Основание<select aria-label="Основание свойств" className={field} value={conditions.basis} onChange={e=>setConditions({...conditions,basis:e.target.value as FluidConditions['basis']})}>{Object.entries(FLUID_BASES).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
     <label className="text-xs">Источник / № протокола<input aria-label="Источник свойств" className={field} value={conditions.source} onChange={e=>setConditions({...conditions,source:e.target.value})}/></label>
     <label className="text-xs">Температура измерений, °C<input aria-label="Температура измерений" className={field} type="number" value={conditions.temperatureC??''} onChange={e=>setConditions({...conditions,temperatureC:e.target.value===''?undefined:Number(e.target.value)})}/></label>
     <label className="text-xs">Давление измерений, МПа<input aria-label="Давление измерений" className={field} type="number" value={conditions.pressureMPa??''} onChange={e=>setConditions({...conditions,pressureMPa:e.target.value===''?undefined:Number(e.target.value)})}/></label>
    </div>
    <label className="text-xs block">Примечания<textarea aria-label="Примечания библиотеки" className={field} value={conditions.notes} onChange={e=>setConditions({...conditions,notes:e.target.value})}/></label>
    <button className={button} onClick={()=>run(()=>{const next=saveFluidRevision(library,kind,draft,conditions,mode==='revision'?entryId:undefined);persist(next);const saved=mode==='revision'?next.entries.find(e=>e.id===entryId)!:next.entries.at(-1)!;setEntryId(saved.id);setVersion(saved.revisions.at(-1)!.version);setDraft(null);setMessage('Версия сохранена. Для изменения проекта нажмите «Применить выбранную версию».');})}>Сохранить версию в библиотеку</button>
    <button className={button+' ml-2'} onClick={()=>setDraft(null)}>Отменить правки</button>
   </section>}
  </DialogContent></Dialog>
 </>;
}
