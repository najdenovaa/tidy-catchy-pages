import {normalizeDisplacementTiming,type DisplacementTimingSettings} from '@/lib/displacement-timing';
export default function D2TimingControls({settings,onChange,annulusEnabled}:{settings:DisplacementTimingSettings;onChange:(s:DisplacementTimingSettings)=>void;annulusEnabled:boolean}){
 let error='';try{normalizeDisplacementTiming(settings);}catch(e){error=(e as Error).message;}
 return <div className="rounded border p-2 space-y-2">
 <div className="flex flex-wrap gap-3 items-center">
 <label>Максимальный шаг решателя, с <input aria-label="Максимальный шаг решателя, с" type="number" min={0} max={60} step="any" disabled={!annulusEnabled} value={settings.maxTimeStepS??0} onChange={e=>onChange({...settings,maxTimeStepS:Number(e.target.value)})} className="w-24 rounded border bg-background px-2 py-1"/></label>
 <label>Интервал кадров, с <input aria-label="Интервал кадров, с" type="number" min={0} max={86400} step="any" value={settings.frameIntervalS??0} onChange={e=>onChange({...settings,frameIntervalS:Number(e.target.value)})} className="w-24 rounded border bg-background px-2 py-1"/></label>
 <label>Скорость просмотра <select aria-label="Скорость просмотра" value={settings.playbackMs??90} onChange={e=>onChange({...settings,playbackMs:+e.target.value})} className="rounded border bg-background p-1"><option value={180}>0.5×</option><option value={90}>1×</option><option value={45}>2×</option></select></label>
 </div>
 <p className="text-muted-foreground">0 - автоматический выбор. Шаг относится к затрубному решателю; устойчивость может потребовать меньшего шага. Интервал кадров меняет частоту сохранения, скорость просмотра - только анимацию. Для трубы используется аналитический перенос без временного шага.</p>
 {error&&<p role="alert" className="text-destructive">{error}</p>}
 </div>;
}
