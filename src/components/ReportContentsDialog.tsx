import { useState } from 'react';
import { Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { REPORT_ITEMS,REPORT_SCOPE_TITLES,defaultReportSelection,type ReportScope,type ReportSelection } from '@/lib/cementing-report-options';
export default function ReportContentsDialog({scope,open,onOpenChange,onConfirm,busy=false,format='word'}:{scope:ReportScope;open:boolean;onOpenChange:(open:boolean)=>void;onConfirm:(selection:ReportSelection)=>void;busy?:boolean;format?:'word'|'xlsx'}) {
 const [choice,setChoice]=useState<ReportSelection>(()=>defaultReportSelection(scope));
 const items=REPORT_ITEMS[scope].filter(([key])=>format==='word'||['chartData','inputs','materials','placement','standoff','loads','runningLoads','broom','forceProfile','torque','measurements'].includes(key));
 const all=(checked:boolean)=>setChoice(Object.fromEntries(items.map(([key])=>[key,checked])));
 const any=items.some(([key])=>choice[key]!==false);
 return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Состав отчёта: {REPORT_SCOPE_TITLES[scope]}</DialogTitle><DialogDescription>{format==='xlsx'?'Выберите числовые разделы. Графики и их полные ряды сохраняются на отдельных листах; 3D и другие иллюстрации доступны в Word. Паспортные документы не вкладываются.':'Отметьте нужные разделы и изображения. Формируется отдельный документ выбранного модуля. Паспорта в отчёт не включаются. Недоступные расчёты будут обозначены в документе.'}</DialogDescription></DialogHeader>
 <div className="flex gap-4"><button className="underline text-sm" onClick={()=>all(true)}>Выбрать всё</button><button className="underline text-sm" onClick={()=>all(false)}>Снять всё</button></div>
 <div className="grid sm:grid-cols-2 gap-3">{items.map(([key,label])=><label key={key} className="flex gap-2 text-sm items-start"><input type="checkbox" checked={choice[key]!==false} onChange={e=>setChoice({...choice,[key]:e.target.checked})}/><span>{label}</span></label>)}</div>
 <DialogFooter><Button variant="outline" onClick={()=>onOpenChange(false)}>Отмена</Button><Button disabled={busy||!any} onClick={()=>{onConfirm(choice);onOpenChange(false);}}>{format==='xlsx'?'Сформировать XLSX':'Сформировать Word'}</Button></DialogFooter></DialogContent></Dialog>;
}
