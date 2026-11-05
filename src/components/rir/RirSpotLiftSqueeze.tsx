import { useMemo, useState } from "react";
import { AlertTriangle, Gauge, Layers, ShieldAlert, Info } from "lucide-react";
import { calculateSpotSqueeze, DEFAULT_SPOT_SQUEEZE, type SpotSqueezeInput } from "@/lib/rir-spot-squeeze";
import type { RirInputs } from "@/lib/rir-calculations";

const LS_KEY = "rir_spot_squeeze_v1";
const fmt = (x:number, n=2) => Number.isFinite(x) ? x.toFixed(n) : "—";
function getInitial(base:RirInputs):SpotSqueezeInput {
  const prior = (()=>{ try {return JSON.parse(localStorage.getItem(LS_KEY)||"null") as Partial<SpotSqueezeInput> | null;}catch{return null;} })();
  if(prior) return {...DEFAULT_SPOT_SQUEEZE,...prior};
  const leakTopMD=base.leak.topMD,leakBottomMD=base.leak.bottomMD;
  const casingIdMm=base.casing.odMm-2*base.casing.wallMm,tubingIdMm=base.tubing.odMm-2*base.tubing.wallMm;
  const initialShoeMD=leakBottomMD+15,slurryBottomMD=initialShoeMD;
  const shoeLift=leakTopMD-100;
  return {...DEFAULT_SPOT_SQUEEZE,casingIdMm,tubingOdMm:base.tubing.odMm,tubingIdMm,
    leakTopMD,leakBottomMD,wellBottomMD:base.wellDepthMD,
    initialShoeMD,slurryBottomMD,liftedShoeMD:Math.max(0,shoeLift),
    slurryDensityGcm3:base.compositionDensity||1.65,wellFluidDensityGcm3:base.wellFluidDensity,
    fracGradientMPaM:base.fracGradientMPaM,
    zonePressureMPa:base.zonePressureMPa||base.wellFluidDensity*9.81*((leakTopMD+leakBottomMD)/2)/1000,
    leakTVD:(leakTopMD+leakBottomMD)/2,
    pumpRateLs:Math.max(0.2,base.pumpRateLs/4),
  };
}
const schema: {title:string;key:keyof SpotSqueezeInput;unit:string;desc?:string}[][]=[
 [{title:"Кровля негерметичности",key:"leakTopMD",unit:"м"},{title:"Подошва негерметичности",key:"leakBottomMD",unit:"м"},
  {title:"Глубина забоя",key:"wellBottomMD",unit:"м"},{title:"TVD интервала нарушения",key:"leakTVD",unit:"м"}],
 [{title:"Внутренний диаметр колонны",key:"casingIdMm",unit:"мм"},{title:"Наружный диаметр НКТ",key:"tubingOdMm",unit:"мм"},
  {title:"Внутренний диаметр НКТ",key:"tubingIdMm",unit:"мм"}],
 [{title:"Конец НКТ при размещении",key:"initialShoeMD",unit:"м"},
  {title:"Нижняя граница цемента",key:"slurryBottomMD",unit:"м"},
  {title:"Конец НКТ после подъёма",key:"liftedShoeMD",unit:"м"},
  {title:"Приготовленный объём цемента",key:"slurryVolumeM3",unit:"м³"},
  {title:"Плановый объём задавливания",key:"plannedSqueezeM3",unit:"м³"}],
 [{title:"Плотность цемента",key:"slurryDensityGcm3",unit:"г/см³"},
  {title:"Плотность скважинной жидкости",key:"wellFluidDensityGcm3",unit:"г/см³"},
  {title:"Давление зоны",key:"zonePressureMPa",unit:"МПа"},
  {title:"Приёмистость по замерам",key:"injectivityM3hMPa",unit:"м³/(ч·МПа)"},
  {title:"Градиент ГРП",key:"fracGradientMPaM",unit:"МПа/м"},
  {title:"Допустимо по колонне на устье",key:"casingAllowableSurfaceMPa",unit:"МПа"},
  {title:"Допустимо по НКТ на устье",key:"tubingAllowableSurfaceMPa",unit:"МПа"},
  {title:"Рабочее давление ПВО",key:"bopWorkingMPa",unit:"МПа"},
  {title:"Расход при задавливании",key:"pumpRateLs",unit:"л/с"}],
];
function NumberControl({p,value,onChange}:{p:typeof schema[number][number];value:number;onChange:(n:number)=>void}){
 const [draft,setDraft]=useState(String(value));
 return <label className="space-y-1 block text-xs" title={p.desc}>
   <span className="text-muted-foreground">{p.title}, {p.unit}</span>
   <input key={p.key} type="number" step="any" value={draft} onChange={e=>setDraft(e.target.value)}
      onBlur={()=>{const n=Number(draft.replace(",","."));if(draft.trim()!==""&&Number.isFinite(n))onChange(n);else setDraft(String(value));}}
      onKeyDown={e=>{if(e.key==="Enter")(e.target as HTMLInputElement).blur();}}
      className="h-9 w-full rounded-md border border-border bg-background px-2 font-medium tabular-nums" />
 </label>;
}
function LayoutStage({label,topMD,shoeMD,bottomMD,leakTopMD,leakBottomMD,index}:{label:string;topMD:number;shoeMD:number;bottomMD:number;leakTopMD:number;leakBottomMD:number;index:number}){
 const y=(d:number)=>36+Math.max(0,Math.min(1,(d-Math.max(0,shoeMD-180))/Math.max(1,bottomMD-Math.max(0,shoeMD-180)+60)))*235;
 const yTop=y(topMD),yBot=y(bottomMD),yShoe=y(shoeMD);
 return <div className="min-w-0 rounded-lg border border-border p-2">
   <div className="text-xs font-semibold mb-1">{label}</div>
   <svg viewBox="0 0 250 300" className="w-full h-52" role="img" aria-label={label}>
     <rect x="64" y="20" width="75" height="262" fill="#9ac3e1" opacity=".16"/>
     <line x1="64" y1="20" x2="64" y2="282" stroke="#64748b" strokeWidth="4"/>
     <line x1="139" y1="20" x2="139" y2="282" stroke="#64748b" strokeWidth="4"/>
     <rect x="67" y={Math.max(20,yTop)} width="69" height={Math.max(0,Math.min(282,yBot)-Math.max(20,yTop))} fill="#d6a94e" opacity=".82"/>
     <line x1="83" y1="20" x2="83" y2={Math.max(20,Math.min(282,yShoe))} stroke="#276d9a" strokeWidth="3"/>
     <line x1="107" y1="20" x2="107" y2={Math.max(20,Math.min(282,yShoe))} stroke="#276d9a" strokeWidth="3"/>
     <line x1="83" y1={yShoe} x2="107" y2={yShoe} stroke="#276d9a" strokeWidth="4"/>
     <rect x="134" y={y(leakTopMD)} width="11" height={Math.max(5,y(leakBottomMD)-y(leakTopMD))} fill="#dc2626"/>
     <text x="149" y={Math.max(22,y(leakTopMD))} fontSize="10" className="fill-foreground">Нарушение</text>
     <text x="149" y={Math.min(286,yShoe+3)} fontSize="10" className="fill-foreground">НКТ {fmt(shoeMD,0)} м</text>
     <text x="149" y={Math.max(30,yTop-3)} fontSize="10" className="fill-foreground">Цемент от</text>
     <text x="149" y={Math.max(43,yTop+9)} fontSize="10" className="fill-foreground">{fmt(topMD,0)} м</text>
     {index===1&&<text x="10" y="17" fontSize="11" className="fill-foreground">ПВО закрыто</text>}
   </svg>
   <div className="text-[11px] text-muted-foreground">Схема условная, без масштаба по оси глубины</div>
 </div>;
}
export default function RirSpotLiftSqueeze({base}:{base:RirInputs}){
 const [input,setInput]=useState<SpotSqueezeInput>(()=>getInitial(base));
 const [manualOpen,setManualOpen]=useState(false);
 const calculated=useMemo(()=>calculateSpotSqueeze(input),[input]);
 const patch=(key:keyof SpotSqueezeInput,value:number)=>setInput(s=>{
   const next={...s,[key]:value};try{localStorage.setItem(LS_KEY,JSON.stringify(next));}catch{/* optional */}
   return next;
 });
 const sections=["Интервал работ","Колонна и НКТ","Размещение и подъём","Жидкости, давление и приёмистость"];
 const summary=[
  ["Вместимость НКТ до размещения",calculated.tubingCapacityBeforeM3,"м³"],
  ["Расчётная кровля до подъёма",calculated.slurryTopBeforeMD,"м"],
  ["Расчётная кровля после подъёма",calculated.slurryTopAfterLiftMD,"м"],
  ["Остаток цемента после задавливания",calculated.residualM3,"м³"],
  ["Кровля остатка цемента",calculated.estimatedSlurryTopAfterSqueezeMD,"м"],
  ["Консервативный потолок на устье",calculated.conservativeSurfaceLimitMPa,"МПа"],
 ];
 return <section className="space-y-4" data-testid="rir-spot-lift-squeeze">
  <div className="rounded-xl border border-primary/40 bg-card p-4 space-y-2">
   <h3 className="font-semibold flex items-center gap-2"><Layers className="w-4 h-4"/>РИР без пакера: размещение, подъём НКТ, задавливание</h3>
   <p className="text-xs text-muted-foreground">Отдельная расчётная схема Bradenhead squeeze. Состав размещается напротив негерметичности, трубы поднимаются выше расчётной кровли, устье герметизируется ПВО, затем давление подаётся через трубы. В отличие от пакерной схемы вся эксплуатационная колонна воспринимает давление.</p>
   <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400"><ShieldAlert className="w-4 h-4 shrink-0"/>Предварительный инженерный расчёт. Без подтверждённой опрессовки колонны, оборудования, данных приёмистости и утверждённого плана к полевой реализации не допускается.</div>
  </div>
  <div className="grid gap-3 lg:grid-cols-2">
   {schema.map((group,idx)=><div key={idx} className="rounded-xl border border-border p-3 space-y-3">
      <h4 className="font-semibold text-sm">{sections[idx]}</h4>
      <div className="grid grid-cols-2 gap-2">{group.map(p=><NumberControl key={p.key} p={p} value={input[p.key] as number} onChange={v=>patch(p.key,v)} />)}</div>
   </div>)}
  </div>
  {calculated.errors.length>0&&<div role="alert" className="rounded-lg border border-destructive/60 p-3 space-y-1 text-sm text-destructive">
    <strong>Расчёт требует исправления параметров:</strong>
    {calculated.errors.map(s=><p key={s}>• {s}</p>)}
  </div>}
  <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
    {summary.map(([label,value,unit])=><div key={label} className="rounded-xl border border-border p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{calculated.ok ? fmt(value as number) : "—"} <span className="text-xs font-normal">{unit}</span></p>
    </div>)}
  </div>
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
    <LayoutStage label="1. Цемент размещён" topMD={calculated.slurryTopBeforeMD} shoeMD={input.initialShoeMD} bottomMD={input.slurryBottomMD} leakTopMD={input.leakTopMD} leakBottomMD={input.leakBottomMD} index={0}/>
    <LayoutStage label="2. НКТ подняты, ПВО закрыто" topMD={calculated.slurryTopAfterLiftMD} shoeMD={input.liftedShoeMD} bottomMD={input.slurryBottomMD} leakTopMD={input.leakTopMD} leakBottomMD={input.leakBottomMD} index={1}/>
  </div>
  <div className="rounded-xl border border-border p-4 space-y-2">
    <h4 className="font-semibold text-sm flex items-center gap-2"><Gauge className="w-4 h-4"/>Контроль давлений и объёмов</h4>
    <p className="text-xs">Гидростатика у интервала: скважинная жидкость <b>{fmt(calculated.liquidHydroMPa)} МПа</b>, цемент <b>{fmt(calculated.cementHydroMPa)} МПа</b>. Предел на глубине по заданному градиенту (95%): <b>{fmt(calculated.fractureLimitBhpMPa)} МПа</b>.</p>
    <p className="text-xs">Плановое задавливание <b>{fmt(input.plannedSqueezeM3)} м³</b>; ориентировочное время при заданном расходе <b>{fmt(calculated.squeezeMinutes,1)} мин</b>. Индекс приёмистости введён для справочной оценки, <b>не</b> для прогнозирования точного распределения цемента по трещинам.</p>
    <p className="text-xs font-medium">Расчётный максимум устьевого давления: {fmt(calculated.conservativeSurfaceLimitMPa)} МПа. Это верхняя оценка для проверки проекта, не команда установки давления на агрегате.</p>
  </div>
  {calculated.warnings.map((w,idx)=><p key={idx} className="flex gap-2 text-xs text-amber-700 dark:text-amber-400"><AlertTriangle className="w-4 h-4 shrink-0"/>{w}</p>)}
  <button type="button" onClick={()=>setManualOpen(v=>!v)} className="text-xs text-primary underline flex gap-1 items-center"><Info className="h-4 w-4"/>Допущения и ограничения модели</button>
  {manualOpen&&<p className="text-xs text-muted-foreground border rounded-lg p-3">Объём в размещённой пачке рассчитан по кольцевой площади там, где находится НКТ, и по полному сечению колонны ниже конца НКТ. После подъёма принимается статическое перераспределение цемента по полному сечению колонны. Вынос цемента в канал задан плановым объёмом, не предсказывается физической моделью фильтрации. Динамические потери, газ, смесь двух жидкостей, изменение уровня при извлечении труб, кольцевые утечки и давление по всей длине колонны потребуют промысловых измерений и отдельного динамического расчёта. Рекомендуется считать программу только после подтверждения целостности колонны, допустимых давлений ПВО и наличия гидравлической связи с целью изоляции.</p>}
 </section>;
}
