import type { CentralizerInterval, CentralizerSpec } from './centralization-calculations';

export const CENTRALIZER_PATTERNS = ['AB', 'AAB', 'ABAB', 'AAAB'] as const;
export type CentralizerPattern = typeof CENTRALIZER_PATTERNS[number];
export interface CentralizerPlacement { md:number; intervalId:string; role:'A'|'B'; spec:CentralizerSpec }
export interface CentralizerJointRow { jointNum:number; topMD:number; bottomMD:number; centralizerDepths:number[]; placements:CentralizerPlacement[] }
export const centralizerPlacementText = (p:CentralizerPlacement) => `${p.role === 'A' ? 'А' : 'Б'}: ${p.spec.passport?.model || p.spec.type}, MD ${Number(p.md.toFixed(3))} м`;

/** Errors are surfaced by the form, calculation and running analysis, never repaired silently. */
export function centralizerLayoutErrors(depth:number, intervals:CentralizerInterval[]):string[] {
  if(!intervals.some(x=>x.pattern))return [];
  const errors:string[]=[];
  if(!intervals.some(x=>x.centralizersPerJoint>0))errors.push('Расстановка А/Б пуста: задайте количество изделий больше нуля.');
  if(!Number.isFinite(depth)||depth<=0||depth>20000)errors.push('Для А/Б глубина колонны должна быть больше 0 и не более 20 000 м.');
  if(new Set(intervals.map(x=>x.id)).size!==intervals.length)errors.push('Идентификаторы интервалов не должны повторяться.');
  const sorted=[...intervals].sort((a,b)=>a.fromMD-b.fromMD);
  for(const [i,x] of sorted.entries()) {
    const label=`Интервал ${x.id}`;
    if(!Number.isFinite(x.fromMD)||!Number.isFinite(x.toMD)||x.fromMD<0||x.toMD<=x.fromMD||x.toMD>depth)errors.push(`${label}: границы должны находиться в пределах колонны.`);
    if(i&&x.fromMD<sorted[i-1].toMD)errors.push(`${label}: интервалы А/Б не должны пересекаться.`);
    if(!Number.isFinite(x.jointLength)||x.jointLength<=0||!Number.isFinite(x.centralizersPerJoint)||x.centralizersPerJoint<0||x.centralizersPerJoint>20)errors.push(`${label}: проверьте длину трубы и число центраторов (0-20 на трубу).`);
    if(x.centralizersPerJoint>=1&&!Number.isInteger(x.centralizersPerJoint))errors.push(`${label}: число изделий на трубу должно быть целым; для редкой расстановки задайте 1/N.`);
    if(x.pattern&&!CENTRALIZER_PATTERNS.includes(x.pattern))errors.push(`${label}: неизвестная последовательность А/Б.`);
    if(x.pattern&&!x.specB)errors.push(`${label}: выберите изделие Б.`);
  }
  if(intervals.reduce((n,x)=>n+Math.ceil((x.toMD-x.fromMD)/Math.max(x.jointLength,.001)),0)>50000)errors.push('Слишком много участков установки: предел 50 000.');
  if(intervals.reduce((n,x)=>n+Math.ceil((x.toMD-x.fromMD)/Math.max(x.jointLength,.001))*Math.max(1,x.centralizersPerJoint),0)>100000)errors.push('Слишком много центраторов: предел 100 000 изделий.');
  return errors;
}

/** One authoritative installation list for mechanics, materials and exports.
 * Legacy projects retain their rounded positions. A/B projects split rows at interval
 * boundaries, retaining exact coordinates; such rows are installation segments, not a pipe tally.
 * The pattern restarts at each interval and advances per installed item in increasing MD.
 */
export function buildCentralizerJointSchedule(depth:number,intervals:CentralizerInterval[]):CentralizerJointRow[] {
  if(centralizerLayoutErrors(depth,intervals).length)return [];
  const mixed=intervals.some(x=>x.pattern), rows:CentralizerJointRow[]=[];
  const counters=new Map<string,number>();
  const localJoints=new Map<string,number>();
  let md=0,jointNum=1,total=0;
  while(md<depth&&rows.length<50000) {
    const iv=intervals.find(x=>md>=x.fromMD&&md<x.toMD);
    const jl=iv?.jointLength&&iv.jointLength>0?iv.jointLength:12;
    const nextBoundary=mixed?Math.min(...intervals.flatMap(x=>[x.fromMD,x.toMD]).filter(x=>x>md),depth):depth;
    const bottom=Math.min(md+jl,depth,nextBoundary);
    if(!(bottom>md))break;
    const cpj=iv?.centralizersPerJoint??0, points:number[]=[];
    const localJoint=iv?(localJoints.get(iv.id)??0):0;
    if(cpj>=1)for(let j=1;j<=Math.min(20,Math.floor(cpj));j++)points.push(md+(bottom-md)*j/(Math.floor(cpj)+1));
    else if(cpj>0&&((mixed?localJoint:jointNum-1)%Math.max(1,Math.round(1/cpj))===0))points.push((md+bottom)/2);
    if(iv)localJoints.set(iv.id,localJoint+1);
    const placements:CentralizerPlacement[]=points.map(p=> {
      const index=counters.get(iv!.id)??0; counters.set(iv!.id,index+1);
      const role=iv!.pattern?.[index%iv!.pattern.length]==='B'?'B':'A';
      return {md:mixed?p:Math.round(p),role,intervalId:iv!.id,spec:role==='B'?iv!.specB!:iv!.spec};
    });
    total+=placements.length;
    if(total>100000)throw new Error('Слишком много центраторов: предел 100 000 изделий.');
    rows.push({jointNum:jointNum++,topMD:mixed?md:Math.round(md),bottomMD:mixed?bottom:Math.round(bottom),centralizerDepths:placements.map(p=>p.md),placements});
    md=bottom;
  }
  return rows;
}
export function centralizerAtResult(intervals:CentralizerInterval[],result:{intervalId:string|null;centralizerRole?:'A'|'B'}) {
  const iv=intervals.find(x=>x.id===result.intervalId);
  return result.centralizerRole==='B'?iv?.specB:iv?.spec;
}
