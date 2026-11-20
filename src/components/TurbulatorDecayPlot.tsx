import type {TurbulatorFlowResult} from '@/lib/turbulator-flow';
export default function TurbulatorDecayPlot({result:r}:{result:TurbulatorFlowResult}){
 if(!r.valid||r.samples.length<2)return null;
 const width=520,height=210,left=52,right=20,top=26,bottom=56,max=Math.max(.0001,r.lengthM);
 const x=(d:number)=>left+d/max*(width-left-right);
 const y=(f:number)=>top-Math.log10(Math.max(.001,Math.min(1,f)))/3*(height-top-bottom);
 const path=r.samples.map((s,i)=>`${i?'L':'M'} ${x(s.distanceM).toFixed(2)} ${y(s.remainingFraction??0).toFixed(2)}`).join(' ');
 return <div className="rounded border p-2 space-y-1"><b className="text-xs">Вся рассчитанная зона затухания</b><svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Расчётный профиль затухания вращательного момента">
  <title>Остаток вращательного момента по расстоянию выше турбулизатора</title>
  {[1,.1,.01,.001].map(f=><g key={f}><line x1={left} x2={width-right} y1={y(f)} y2={y(f)} stroke="currentColor" opacity=".12"/><text x={left-6} y={y(f)+4} textAnchor="end" fill="currentColor" fontSize="11">{f*100}%</text></g>)}
  <path data-calculated-decay="true" d={path} stroke="#0891b2" strokeWidth="2.5" fill="none"/>
  {[0,max/2,max].map(d=><g key={d}><text x={x(d)} y={height-bottom+18} textAnchor="middle" fontSize="11" fill="currentColor">{d.toFixed(2)} м</text><text x={x(d)} y={height-bottom+34} textAnchor="middle" fontSize="10" fill="currentColor">MD {(r.point.md-d).toFixed(2)}</text></g>)}
  <text x={left} y="14" fontSize="11" fill="currentColor">Остаток момента · логарифмическая шкала</text>
  <text x={width/2} y={height-3} fontSize="11" textAnchor="middle" fill="currentColor">Расстояние вверх от турбулизатора</text>
 </svg><p className="text-[10px] text-muted-foreground">{r.reachedThreshold?'На конце осталось 0,1% начального момента.':'Длина ограничена устьем или границей выполненного расчёта.'}</p></div>;
}
