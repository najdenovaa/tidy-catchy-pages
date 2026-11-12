/** Local LAS 2.0 import, CWLS January 2017:
 * https://www.cwls.org/wp-content/uploads/2017/02/Las2_Update_Jan2017.pdf */
import { calculateTVDFromSurvey, type TrajectoryPoint, type CavernInterval } from './cementing-calculations';
export const SURVEY_MAX_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 100000;
export type LengthUnit = 'm' | 'ft' | 'mm' | 'cm' | 'in';
export type AngleUnit = 'deg' | 'rad';
export interface ImportTable {
  columns: { name: string; unit: string; description: string }[];
  rows: (number | null)[][];
  warnings: string[];
}
export interface LasTable extends ImportTable { version: number; wrapped: boolean; }
const valueOf = (s: unknown): number | null => {
  const raw = String(s ?? '').trim().replace(/,/g, '.').replace(/[dD]([+-]?\d+)$/, 'e$1');
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw)) return null;
  const n = Number(raw); return Number.isFinite(n) ? n : null;
};
export function lengthFactor(unit: LengthUnit): number { return {m:1,ft:.3048,mm:.001,cm:.01,in:.0254}[unit]; }
export function knownLengthUnit(value:string): LengthUnit | undefined {
  const u=value.trim().toLowerCase().replace(/[.\s]/g,'');
  if(['m','meter','metre','м'].includes(u))return 'm';
  if(['ft','feet','foot','фут'].includes(u))return 'ft';
  if(['mm','мм'].includes(u))return 'mm';
  if(['cm','см'].includes(u))return 'cm';
  if(['in','inch','inches','дюйм'].includes(u))return 'in';
}
export function decodeSurveyText(bytes:ArrayBuffer):string {
  const a=new Uint8Array(bytes);
  if(a.length>SURVEY_MAX_BYTES)throw new Error('Файл больше 10 МБ. Разделите его на интервалы.');
  if(a[0]===0xff&&a[1]===0xfe)return new TextDecoder('utf-16le').decode(a);
  if(a[0]===0xfe&&a[1]===0xff)return new TextDecoder('utf-16be').decode(a);
  try{return new TextDecoder('utf-8',{fatal:true}).decode(a);}catch{return new TextDecoder('windows-1251').decode(a);}
}
export function parseLas(text:string):LasTable {
  const columns:ImportTable['columns']=[],data:{line:number;values:(number|null)[]}[]=[];
  let section='',version=NaN,wrapped:boolean|undefined,nullValue:number|null=null;
  const seen=new Set<string>();
  for(const [i,original] of text.replace(/^\uFEFF/,'').split(/\r?\n|\r/).entries()){
    const line=original.trim();if(!line||line.startsWith('#'))continue;
    if(line.startsWith('~')){
      section=line.slice(1).trim()[0]?.toUpperCase()??'';
      if(['V','W','C','A'].includes(section)){if(seen.has(section))throw new Error(`LAS: повторный раздел ~${section}. Импортируйте один набор данных.`);seen.add(section);}continue;
    }
    if(section==='V'||section==='W'){
      const m=line.match(/^([^\s.]+)\s*\.(.*?)\s*:/);if(!m)continue;
      const key=m[1].toUpperCase(),raw=m[2].trim();
      if(key==='VERS')version=valueOf(raw)??NaN;
      if(key==='WRAP')wrapped=raw.toUpperCase()==='YES'?true:raw.toUpperCase()==='NO'?false:undefined;
      if(key==='NULL')nullValue=valueOf(raw);
      if(key==='DLM'&&!['SPACE','TAB'].includes(raw.toUpperCase()))throw new Error('LAS: экспортируйте LAS 2.0 с разделителем SPACE или TAB.');
    }else if(section==='C'){
      const colon=line.indexOf(':'),head=colon>=0?line.slice(0,colon):line,m=head.match(/^([^\s.]+)\s*\.([^\s]*)/);
      if(!m)throw new Error(`LAS, строка ${i+1}: не распознано описание кривой.`);
      columns.push({name:m[1],unit:m[2],description:colon>=0?line.slice(colon+1).trim():''});
      if(columns.length>128)throw new Error('LAS: больше 128 кривых. Выгрузите нужные кривые отдельным файлом.');
    }else if(section==='A'){
      const values=line.split(/\s+/).map(valueOf);
      if(values.some(v=>v===null))throw new Error(`LAS, строка ${i+1}: ожидались числовые значения; пропуски задаются NULL.`);
      data.push({line:i+1,values});if(data.length>MAX_ROWS*2)throw new Error('LAS: слишком много строк. Разделите файл.');
    }
  }
  if(version!==2)throw new Error('Поддерживается LAS 2.0. Для других версий экспортируйте данные в LAS 2.0.');
  if(wrapped===undefined||!['V','W','C','A'].every(s=>seen.has(s))||nullValue===null)throw new Error('LAS: нужны разделы VERSION, WELL, CURVE, ASCII и значения VERS, WRAP, NULL.');
  if(columns.length<2||!data.length)throw new Error('LAS: нужны глубина, кривая диаметра и числовые данные.');
  const rows:(number|null)[][]=[];
  if(wrapped){let pending:(number|null)[]=[];for(const r of data){pending.push(...r.values);while(pending.length>=columns.length){rows.push(pending.slice(0,columns.length));pending=pending.slice(columns.length);}}if(pending.length)throw new Error('LAS WRAP YES: неполная последняя запись.');}
  else for(const r of data){if(r.values.length!==columns.length)throw new Error(`LAS, строка ${r.line}: ${r.values.length} значений вместо ${columns.length}.`);rows.push(r.values);}
  if(rows.length>MAX_ROWS)throw new Error('LAS: больше 100 000 отсчётов. Разделите файл.');
  return {columns,rows:rows.map(r=>r.map(v=>v===nullValue?null:v)),version,wrapped,warnings:[]};
}
export function parseSurveyText(text:string):ImportTable {
  const lines=text.replace(/^\uFEFF/,'').split(/\r?\n|\r/).map(x=>x.trim()).filter(x=>x&&!x.startsWith('#')&&!x.startsWith('//'));
  if(lines.length<2)throw new Error('Нужно минимум две строки инклинометрии.');
  const delim=lines[0].includes(';')?';':lines[0].includes('\t')?'\t':lines[0].includes(',')&&(!lines[0].includes(' ')||/[A-Za-zА-Яа-я]/.test(lines[0]))?',':'space';
  const split=(line:string)=>{
    if(delim==='space')return line.split(/\s+/);
    const cells:string[]=[];let value='',quoted=false;
    for(let i=0;i<line.length;i++){
      const c=line[i];
      if(c==='"'){if(quoted&&line[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}
      else if(c===delim&&!quoted){cells.push(value.trim());value='';}else value+=c;
    }
    if(quoted)throw new Error('Незакрытая кавычка в TXT/CSV.');
    cells.push(value.trim());return cells;
  };
  const first=split(lines[0]),header=first.some(x=>valueOf(x)===null),names=header?first:first.map((_,i)=>`Колонка ${i+1}`);
  const rows=lines.slice(header?1:0).map((line,i)=>{const cells=split(line);if(cells.length!==names.length)throw new Error(`Строка ${i+(header?2:1)}: число колонок отличается от первой строки.`);return cells.map(valueOf);});
  if(rows.length>MAX_ROWS)throw new Error('Больше 100 000 точек. Разделите файл.');
  const columns=names.map(name=>{const m=name.match(/\[([^\]]+)\]|\(([^)]+)\)/);return {name,unit:m?.[1]??m?.[2]??'',description:''};});
  return {columns,rows,warnings:header?[]:['Нет заголовка: назначьте MD, азимут и зенит вручную.']};
}
export function surveyColumns(t:ImportTable):{md:number;azimuth:number;zenith:number}{
  const n=t.columns.map(c=>c.name.toLowerCase());return {
    md:n.findIndex(x=>!/tvd|вертик|vertical/.test(x)&&/\bmd\b|measured|depth|глубин|ствол/.test(x)),
    azimuth:n.findIndex(x=>/azim|азим|\bazi?\b/.test(x)),zenith:n.findIndex(x=>/zen|зенит|incl|\binc\b/.test(x)),
  };
}
export function buildSurvey(t:ImportTable,m:{md:number;azimuth:number;zenith:number},depthUnit:LengthUnit,angleUnit:AngleUnit,azimuthUnit:AngleUnit=angleUnit):{points:TrajectoryPoint[];warnings:string[]}{
  const ix=Object.values(m);if(new Set(ix).size!==3||ix.some(i=>i<0||i>=t.columns.length))throw new Error('Назначьте три разные колонки: MD, азимут, зенит.');
  const k=lengthFactor(depthUnit),a=angleUnit==='rad'?180/Math.PI:1,azFactor=azimuthUnit==='rad'?180/Math.PI:1;
  const points=t.rows.map((r,i)=>{const md=r[m.md],az=r[m.azimuth],inc=r[m.zenith];
    if(md===null||az===null||inc===null||[md,az,inc].some(n=>!Number.isFinite(n)))throw new Error(`Точка ${i+1}: пропуск или нечисловое значение.`);
    if(md<0||inc*a<0||inc*a>180||az*azFactor<0||az*azFactor>360+1e-8)throw new Error(`Точка ${i+1}: MD ≥ 0, зенит 0–180°, азимут 0–360°.`);
    return {md:md*k,azimuth:(az*azFactor)%360,zenith:inc*a,tvd:0};
  }).sort((x,y)=>x.md-y.md);
  if(points.length<2)throw new Error('Нужно минимум две точки.');
  if(points.some((p,i)=>i>0&&p.md===points[i-1].md))throw new Error('Повторяются глубины MD. Удалите дубли перед импортом.');
  if(points[0].md!==0)throw new Error('Нет привязочной точки MD=0. Добавьте её: абсолютную TVD нельзя определить по этому файлу.');
  const warnings=[...t.warnings];if(t.rows.some((r,i)=>i>0&&(r[m.md]??0)<(t.rows[i-1][m.md]??0)))warnings.push('Точки отсортированы по MD.');
  return {points:calculateTVDFromSurvey(points),warnings};
}
export interface CaliperOptions {depthColumn:number;diameterColumn:number;depthUnit:LengthUnit;diameterUnit:LengthUnit;nominalDiameterMm:number;topMD:number;bottomMD:number;maxGapM:number;intervalStepM?:number;}
export interface CaliperPreview {measurements:{md:number;diameterMm:number|null}[];intervals:CavernInterval[];coveredM:number;minDiameterMm:number;maxDiameterMm:number;missingPairs:number;warnings:string[];}
/** K=(d1²+d2²)/(2*dNom²): mean cross-sectional area between adjacent samples.
 * Nulls and large gaps remain uncovered. No extrapolation beyond the measured log. */
export function buildCaliper(t:ImportTable,o:CaliperOptions):CaliperPreview {
  if(o.depthColumn<0||o.diameterColumn<0||o.depthColumn===o.diameterColumn||Math.max(o.depthColumn,o.diameterColumn)>=t.columns.length)throw new Error('Выберите разные колонки глубины и диаметра.');
  if(![o.nominalDiameterMm,o.bottomMD,o.maxGapM].every(v=>Number.isFinite(v)&&v>0)||!Number.isFinite(o.topMD)||o.topMD<0||o.bottomMD<=o.topMD)throw new Error('Проверьте диаметр, границы открытого ствола и допустимый разрыв.');
  const dk=lengthFactor(o.depthUnit),ck=lengthFactor(o.diameterUnit)*1000;
  const samples=t.rows.map((r,i)=>{const d=r[o.depthColumn],diam=r[o.diameterColumn];if(d===null||!Number.isFinite(d)||d<0)throw new Error(`LAS: отсчёт ${i+1} без корректной глубины.`);return {md:d*dk,diam:diam!==null&&Number.isFinite(diam)&&diam>0?diam*ck:null};}).sort((a,b)=>a.md-b.md);
  if(samples.some((p,i)=>i>0&&p.md===samples[i-1].md))throw new Error('LAS: повторяются глубины. Выберите файл без дублей.');
  const intervals:CavernInterval[]=[],diameters:number[]=[];let missingPairs=0,belowNominal=0;
  for(let i=1;i<samples.length;i++){
    const l=samples[i-1],r=samples[i],from=Math.max(o.topMD,l.md),to=Math.min(o.bottomMD,r.md);if(to<=from)continue;
    if(l.diam===null||r.diam===null||r.md-l.md>o.maxGapM){missingPairs++;continue;}
    const sq=(md:number)=>l.diam!**2+(r.diam!**2-l.diam!**2)*(md-l.md)/(r.md-l.md),coeff=(sq(from)+sq(to))/(2*o.nominalDiameterMm**2);
    if(coeff<1)belowNominal++;intervals.push({fromMD:from,toMD:to,coeff});diameters.push(Math.sqrt(sq(from)),Math.sqrt(sq(to)));
  }
  if(!intervals.length)throw new Error('Нет пригодных пар отсчётов в открытом стволе. Проверьте кривую, единицы, границы и разрывы.');
  const grouped = o.intervalStepM ? aggregateCaliperIntervals(intervals,o.intervalStepM) : intervals;
  if(grouped.length>5000)throw new Error('Больше 5000 интервалов. Увеличьте шаг усреднения или разделите файл по глубине.');
  const warnings=[...t.warnings];if(missingPairs)warnings.push(`Пропущено участков с NULL/некорректным диаметром или разрывом: ${missingPairs}. Там останется коэффициент по умолчанию.`);
  if(belowNominal)warnings.push(`Участков с диаметром ниже номинального: ${belowNominal}. Проверьте сужения и единицы; измерения не увеличены до номинала.`);
  warnings.push('Вне измеренного диапазона используется коэффициент по умолчанию. Последний отсчёт не продлевается до забоя.');
  let min=Infinity,max=-Infinity;for(const d of diameters){min=Math.min(min,d);max=Math.max(max,d);}
  return {measurements:t.rows.map(r=>({md:r[o.depthColumn]!*dk,diameterMm:r[o.diameterColumn]===null?null:r[o.diameterColumn]!*ck})),intervals:grouped,coveredM:grouped.reduce((s,v)=>s+v.toMD-v.fromMD,0),minDiameterMm:min,maxDiameterMm:max,missingPairs,warnings};
}

/** Area-preserving depth bins. Never merge across an unmeasured gap. */
export function aggregateCaliperIntervals(source:CavernInterval[],stepM:number):CavernInterval[]{
  if(!Number.isFinite(stepM)||stepM<.1)throw new Error('Шаг интервалов должен быть не меньше 0,1 м.');
  const out:CavernInterval[]=[];
  for(const iv of source){
    let from=iv.fromMD;
    while(from<iv.toMD-1e-8){
      const bin=Math.floor((from+1e-8)/stepM),to=Math.min(iv.toMD,(bin+1)*stepM),last=out[out.length-1];
      if(last&&Math.abs(last.toMD-from)<1e-8&&Math.floor((last.fromMD+1e-8)/stepM)===bin){
        last.coeff=(last.coeff*(last.toMD-last.fromMD)+iv.coeff*(to-from))/(to-last.fromMD);last.toMD=to;
      }else out.push({fromMD:from,toMD:to,coeff:iv.coeff});
      from=to;if(out.length>5000)throw new Error('Больше 5000 интервалов. Увеличьте шаг усреднения или разделите файл.');
    }
  }
  return out;
}
