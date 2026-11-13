import type { CentralizerInterval } from './centralization-calculations';
import { buildCentralizerJointSchedule, centralizerLayoutErrors, type CentralizerPlacement } from './centralizer-layout';
import { centralizerDeflection, centralizerModelNotes } from './centralizer-response';

/** Articulated spans: no moment transfer between supports; reactions qL/2 from
 * each adjacent span. Support settlement uses the individual A/B force curve.
 * Wall contacts cap displacement but do not redistribute reactions. */
export function buildMixedSupportProfile(depth:number,intervals:CentralizerInterval[],casingOD:number,EI:number,boreAt:(md:number)=>number,qAt:(md:number)=>number) {
  const errors=centralizerLayoutErrors(depth,intervals);if(errors.length)throw new Error(errors.join(' '));
  const installed=buildCentralizerJointSchedule(depth,intervals).flatMap(r=>r.placements).sort((a,b)=>a.md-b.md);
  const gap=(md:number)=>Math.max(0,(boreAt(md)-casingOD)/2);
  type Node={md:number;placement?:CentralizerPlacement;offset:number;loadKN:number;exceeded:boolean;notes:string[]};
  const nodes:Node[]=installed.map(p=>({md:p.md,placement:p,offset:0,loadKN:0,exceeded:false,notes:[]}));
  const spans=nodes.slice(1).map((b,i)=>{const a=nodes[i],L=b.md-a.md,q=Math.max(0,qAt((a.md+b.md)/2));a.loadKN+=q*L/2000;b.loadKN+=q*L/2000;return {a,b,L,q};});
  // Tributary overhang weight enters the end support; its bending moment is outside this reduced model.
  if(nodes.length){const a=nodes[0],b=nodes[nodes.length-1];a.loadKN+=Math.max(0,qAt(a.md/2))*a.md/1000;b.loadKN+=Math.max(0,qAt((b.md+depth)/2))*(depth-b.md)/1000;}
  for(const n of nodes)if(n.placement){
    const s=n.placement.spec,g=gap(n.md),bore=boreAt(n.md);
    if(s.type==='spring'&&s.passport?.outerDiameter){
      const r=centralizerDeflection(s,casingOD,bore,n.loadKN*1000,1,EI);
      n.offset=r.supportMM;n.exceeded=r.exceeded;n.notes=centralizerModelNotes(s);
    }else if(s.type==='spring'){
      const fraction=1-(s.passport?.restoringStandoff??67)/100;
      n.offset=s.restoringForce>0?n.loadKN/s.restoringForce*g*Math.max(.01,fraction):g;
      n.exceeded=n.offset>g;n.notes=['Нет наружного диаметра пружин: линейная оценка по восстанавливающей силе; 67% при отсутствии стендового standoff.'];
    }else n.offset=Math.max(0,(bore-(s.passport?.outerDiameter??casingOD+2*s.bladeHeight))/2);
    n.offset=Math.min(g,Math.max(0,n.offset));
  }
  const sag=(s:typeof spans[number],x:number)=>EI>0?s.q*x*(s.L**3-2*s.L*x*x+x**3)/(24*EI)*1000:gap(s.a.md+x);
  const offset=(s:typeof spans[number],x:number)=>s.a.offset+(s.b.offset-s.a.offset)*x/s.L+sag(s,x);
  const depths=installed.map(p=>p.md);
  // Include each analytical span extremum: a 5 m grid alone can miss a weak B.
  for(const s of spans)if(s.L>0&&EI>0){
    const derivative=(x:number)=>(s.b.offset-s.a.offset)/s.L+s.q*(s.L**3-6*s.L*x*x+4*x**3)/(24*EI)*1000;
    if(derivative(0)>0&&derivative(s.L)<0){let lo=0,hi=s.L;for(let k=0;k<40;k++){const x=(lo+hi)/2;if(derivative(x)>0)lo=x;else hi=x;}depths.push(s.a.md+(lo+hi)/2);}
  }
  return {depths,at(md:number){
    if(!nodes.length||md<nodes[0].md-1e-7||md>nodes[nodes.length-1].md+1e-7)return null;
    if(nodes.length===1){const n=nodes[0];return {placement:n.placement,eccentricity:gap(md)>0?n.offset/gap(md):1,supportEccentricity:gap(md)>0?n.offset/gap(md):1,sagMM:0,spanM:0,loadKN:n.loadKN,exceeded:n.exceeded,notes:[...n.notes,'Одна опора: прогиб трубы между опорами не определён.']};}
    let lo=0,hi=spans.length-1;
    while(lo<hi){const mid=(lo+hi)>>1;if(spans[mid].b.md<md)lo=mid+1;else hi=mid;}
    const s=spans[lo],x=md-s.a.md;
    const nearest=!s.a.placement?s.b:!s.b.placement?s.a:md-s.a.md<=s.b.md-md?s.a:s.b;
    const g=gap(md),raw=offset(s,x),placement=nearest.placement;
    const notes=[...nearest.notes,'А/Б: отдельные реакции опор и шарнирно опёртые пролёты; передача изгибающего момента между пролётами не учитывается.',
      'А/Б: профиль только между крайними изделиями. Вес концевых свесов отнесён к крайним опорам, их изгибающие моменты и прогибы не рассчитаны. Контакты ограничивают смещение без перераспределения реакций.'];
    if(raw>g)notes.push('В пролёте достигнута стенка; нужна контактная модель для уточнения реакций.');
    return {placement,eccentricity:g>0?Math.min(1,Math.max(0,raw/g)):1,supportEccentricity:gap(nearest.md)>0?nearest.offset/gap(nearest.md):1,
      sagMM:sag(s,x),spanM:s.L,loadKN:nearest.loadKN,exceeded:nearest.exceeded,notes};
  }};
}
