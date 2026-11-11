import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { buildCaliper, buildSurvey, decodeSurveyText, knownLengthUnit, parseLas, parseSurveyText, surveyColumns, SURVEY_MAX_BYTES, type ImportTable, type LengthUnit, type AngleUnit } from '@/lib/well-survey-import';
import { interpolateTVD, type WellData } from '@/lib/cementing-calculations';

type Props={kind:'trajectory'|'caliper';wellData:WellData;onChange:(w:WellData)=>void};
const unitNames:Record<LengthUnit,string>={m:'м',ft:'фут',mm:'мм',cm:'см',in:'дюйм'};
const selectClass='h-8 rounded border border-input bg-background px-2 text-xs w-full';
export default function WellSurveyImport({kind,wellData,onChange}:Props){
  const [table,setTable]=useState<ImportTable|null>(null),[name,setName]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const [md,setMd]=useState(-1),[az,setAz]=useState(-1),[inc,setInc]=useState(-1),[cal,setCal]=useState(-1);
  const [depthUnit,setDepthUnit]=useState<LengthUnit|''>(''),[diameterUnit,setDiameterUnit]=useState<LengthUnit|''>(''),[angleUnit,setAngleUnit]=useState<AngleUnit>('deg'),[azimuthUnit,setAzimuthUnit]=useState<AngleUnit>('deg'),[maxGap,setMaxGap]=useState(2),[intervalStep,setIntervalStep]=useState(5);
  const [appliedDiameter,setAppliedDiameter]=useState<number|null>(null);
  const title=kind==='caliper'?'Импорт кавернометрии LAS 2.0':'Импорт инклинометрии TXT / CSV';
  const preview=useMemo(()=>{
    if(!table)return null;
    try{
      if(!depthUnit)throw new Error('Выберите единицы глубины.');
      if(kind==='caliper'){
        if(!diameterUnit)throw new Error('Выберите единицы диаметра.');
        return {caliper:buildCaliper(table,{depthColumn:md,diameterColumn:cal,depthUnit,diameterUnit,nominalDiameterMm:wellData.holeDiameter,topMD:Math.max(0,wellData.prevCasingDepth),bottomMD:wellData.wellDepthMD,maxGapM:maxGap,intervalStepM:intervalStep})};
      }
      const survey=buildSurvey(table,{md,azimuth:az,zenith:inc},depthUnit,angleUnit,azimuthUnit);
      if(survey.points[survey.points.length-1].md<wellData.wellDepthMD)survey.warnings.push('Инклинометрия не покрывает всю глубину скважины. До расчёта дополните профиль; конечная TVD скважины не изменена.');
      return {survey};
    }catch(e){return {error:e instanceof Error?e.message:String(e)};}
  },[table,md,az,inc,cal,depthUnit,diameterUnit,angleUnit,azimuthUnit,maxGap,intervalStep,kind,wellData.holeDiameter,wellData.prevCasingDepth,wellData.wellDepthMD]);
  const load=async(file:File)=>{
    setError('');setNotice('');setTable(null);setBusy(true);
    try{
      if(file.size>SURVEY_MAX_BYTES)throw new Error('Файл больше 10 МБ. Разделите его на интервалы.');
      const text=decodeSurveyText(await file.arrayBuffer()),t=kind==='caliper'?parseLas(text):parseSurveyText(text);
      setName(file.name);setTable(t);
      if(kind==='caliper'){
        const d=t.columns.findIndex(c=>/^(DEPT|DEPTH|MD)$/i.test(c.name));
        const c=t.columns.findIndex(c=>/^(CALI|CAL|CALIPER|HCAL|DCAL|DHC|КАВ|ДС)$/i.test(c.name));
        setMd(d);setCal(c);setDepthUnit(d>=0?knownLengthUnit(t.columns[d].unit)??'':'');setDiameterUnit(c>=0?knownLengthUnit(t.columns[c].unit)??'':'');
      }else{
        const m=surveyColumns(t);setMd(m.md);setAz(m.azimuth);setInc(m.zenith);
        setDepthUnit(m.md>=0?knownLengthUnit(t.columns[m.md].unit)??'':'');
        setAngleUnit(m.zenith>=0&&/rad|рад/i.test(t.columns[m.zenith].unit)?'rad':'deg');
        setAzimuthUnit(m.azimuth>=0&&/rad|рад/i.test(t.columns[m.azimuth].unit)?'rad':'deg');
      }
    }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  };
  const column=(label:string,value:number,set:(n:number)=>void,unitSetter?:(u:LengthUnit|'')=>void)=> <label className="space-y-1 text-xs">{label}<select aria-label={label} className={selectClass} value={value} onChange={e=>{const n=Number(e.target.value);set(n);if(unitSetter)unitSetter(n>=0?knownLengthUnit(table!.columns[n].unit)??'':'');}}><option value={-1}>Выберите колонку</option>{table!.columns.map((c,i)=><option key={i} value={i}>{c.name}{c.unit?` (${c.unit})`:''}</option>)}</select></label>;
  const units=(label:string,value:LengthUnit|'',set:(u:LengthUnit)=>void,options:LengthUnit[])=> <label className="space-y-1 text-xs">{label}<select aria-label={label} value={value} className={selectClass} onChange={e=>set(e.target.value as LengthUnit)}><option value="" disabled>Выберите единицы</option>{options.map(u=><option key={u} value={u}>{unitNames[u]}</option>)}</select></label>;
  const warnings=preview?.caliper?.warnings??preview?.survey?.warnings??[];
  return <details className="border border-border rounded-lg p-3 space-y-3" data-testid={`import-${kind}`}>
    <summary className="text-sm font-medium cursor-pointer">{title}</summary>
    <p className="text-xs text-muted-foreground">Файл обрабатывается на вашем устройстве. Данные скважины изменятся только после проверки и нажатия «Применить».</p>
    <label className="block text-xs">{title}<Input aria-label={title} className="mt-1 text-xs" type="file" disabled={busy} accept={kind==='caliper'?'.las':'.txt,.csv,.tsv'} onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void load(f);}}/></label>
    {busy&&<p role="status">Читаем файл…</p>}{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    {notice&&<p role="status" className="text-xs text-primary">{notice}</p>}
    {appliedDiameter!==null&&appliedDiameter!==wellData.holeDiameter&&<p role="alert" className="text-xs text-destructive">Номинальный диаметр изменился после импорта LAS. Повторите импорт и замените коэффициенты для нового диаметра.</p>}
    {table&&<>
      <p className="text-xs font-medium">{name}: {table.rows.length} отсчётов, {table.columns.length} колонок</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {column('Колонка MD',md,setMd,setDepthUnit)}{units('Единицы глубины',depthUnit,setDepthUnit,['m','ft','cm','mm','in'])}
        {kind==='caliper'?<>{column('Кривая диаметра',cal,setCal,setDiameterUnit)}{units('Единицы диаметра',diameterUnit,setDiameterUnit,['mm','cm','m','in','ft'])}
          <label className="space-y-1 text-xs">Максимальный разрыв, м<Input aria-label="Максимальный разрыв, м" type="number" min="0.001" step="0.1" value={maxGap} onChange={e=>setMaxGap(Number(e.target.value))}/></label><label className="space-y-1 text-xs">Шаг интервалов, м<Input aria-label="Шаг интервалов, м" type="number" min="0.1" step="0.1" value={intervalStep} onChange={e=>setIntervalStep(Number(e.target.value))}/></label></>:<>
          {column('Колонка азимута',az,setAz)}{column('Колонка зенита',inc,setInc)}
          <label className="space-y-1 text-xs">Единицы зенита<select aria-label="Единицы зенита" className={selectClass} value={angleUnit} onChange={e=>setAngleUnit(e.target.value as AngleUnit)}><option value="deg">Градусы</option><option value="rad">Радианы</option></select></label><label className="space-y-1 text-xs">Единицы азимута<select aria-label="Единицы азимута" className={selectClass} value={azimuthUnit} onChange={e=>setAzimuthUnit(e.target.value as AngleUnit)}><option value="deg">Градусы</option><option value="rad">Радианы</option></select></label></>}
      </div>
      <div className="overflow-auto max-h-36 text-[11px]"><table className="w-full"><thead><tr>{table.columns.map((c,i)=><th className="text-left px-2" key={i}>{c.name}{c.unit?` (${c.unit})`:''}</th>)}</tr></thead><tbody>{table.rows.slice(0,5).map((r,i)=><tr key={i}>{r.map((v,j)=><td className="px-2" key={j}>{v??'NULL'}</td>)}</tr>)}</tbody></table></div>
      {preview?.error&&<p role="alert" className="text-xs text-destructive">{preview.error}</p>}
      {preview?.caliper&&<div className="text-xs space-y-1"><p>Открытый ствол: {wellData.prevCasingDepth}–{wellData.wellDepthMD} м MD. Номинальный диаметр: {wellData.holeDiameter} мм.</p><p>Интервалов: {preview.caliper.intervals.length}; покрытие: {preview.caliper.coveredM.toFixed(2)} м; диаметр: {preview.caliper.minDiameterMm.toFixed(1)}–{preview.caliper.maxDiameterMm.toFixed(1)} мм.</p><p>Будут заменены все текущие интервалы кавернозности. K рассчитан по средней площади; объём сохраняется при усреднении по шагу, локальные пики и сужения сглаживаются; при изменении номинального диаметра импорт следует повторить.</p></div>}
      {preview?.survey&&<p className="text-xs">Будет заменена текущая инклинометрия. Точек: {preview.survey.points.length}; конечная MD: {preview.survey.points[preview.survey.points.length-1].md.toFixed(2)} м; TVD: {preview.survey.points[preview.survey.points.length-1].tvd.toFixed(2)} м (минимальная кривизна). Глубина скважины по стволу не изменяется.</p>}
      {warnings.map((w,i)=><p key={i} className="text-xs text-amber-700 dark:text-amber-400">{w}</p>)}
      <div className="flex gap-2"><Button size="sm" disabled={!preview||!!preview.error} onClick={()=>{
        if(preview?.caliper){onChange({...wellData,cavernIntervals:preview.caliper.intervals});setAppliedDiameter(wellData.holeDiameter);setNotice(`LAS применён: ${preview.caliper.intervals.length} интервалов. Пересчитайте программу.`);}
        if(preview?.survey){onChange({...wellData,trajectory:preview.survey.points,...(preview.survey.points[preview.survey.points.length-1].md>=wellData.wellDepthMD?{wellDepthTVD:interpolateTVD(wellData.wellDepthMD,preview.survey.points)}:{})});setNotice('Инклинометрия применена. TVD пересчитана по точкам; глубина скважины по стволу не изменена. Пересчитайте программу.');}
      }}>Применить {kind==='caliper'?'кавернометрию':'инклинометрию'}</Button><Button variant="outline" size="sm" onClick={()=>{setTable(null);setError('');}}>Закрыть предпросмотр</Button></div>
    </>}
  </details>;
}
