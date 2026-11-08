import type { CasingRunningAnalysis, CasingRunningSettings } from './casing-running-analysis';
/** Printable vector figure shared by screen and Word. Inputs contain only validated numbers. */
export function runningBroomSVG(a:CasingRunningAnalysis,s:CasingRunningSettings) {
  if(!a.final)return '';
  const width=820,height=510,left=66,right=width-28,top=40,bottom=height-76;
  const values=a.broom.flatMap(p=>[p.runIn,p.pullOut,p.runLow,p.runHigh,p.pullLow,p.pullHigh,p.noTools,p.free]);
  values.push(...s.measurements.map(m=>m.hookTF));if(s.maxHookKN>0)values.push(s.maxHookKN/9.80665);
  const min=Math.min(0,...values),max=Math.max(1,...values),pad=(max-min)*.06;
  const xmin=min-pad,xmax=max+pad,x=(n:number)=>left+(n-xmin)/(xmax-xmin)*(right-left),y=(n:number)=>top+n/a.final!.md*(bottom-top);
  const colors=['#15803d','#dc2626','#0369a1','#64748b'];
  let out=`<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Веник: нагрузка на крюке по глубине башмака" width="${width}" height="${height}" style="display:block;width:100%;height:auto;font-family:Arial,sans-serif" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="white"/>`;
  out+=`<text x="${left}" y="20" font-size="12" fill="#334155">μ колонна / ствол: ${s.frictionCased.toFixed(2)} / ${s.frictionOpenhole.toFixed(2)}; штриховые ±${s.frictionSpread.toFixed(2)}; скорость ${s.speedMps.toFixed(2)} м/с</text>`;
  for(let i=0;i<=5;i++){const d=a.final.md*i/5,load=xmin+(xmax-xmin)*i/5;
    out+=`<path d="M${left} ${y(d)}H${right} M${x(load)} ${top}V${bottom}" stroke="#e2e8f0"/><text x="${left-9}" y="${y(d)+4}" text-anchor="end" font-size="12" fill="#334155">${d.toFixed(0)}</text><text x="${x(load)}" y="${bottom+18}" text-anchor="middle" font-size="12" fill="#334155">${load.toFixed(1)}</text>`;
  }
  const lines:[keyof CasingRunningAnalysis['broom'][number],string,string][]=[['runLow',colors[0],'5 4'],['runHigh',colors[0],'2 4'],['pullLow',colors[1],'5 4'],['pullHigh',colors[1],'2 4'],['runIn',colors[0],''],['pullOut',colors[1],''],['free',colors[2],''],['noTools',colors[3],'7 3']];
  for(const [key,color,dash]of lines){const path=a.broom.map((p,i)=>`${i?'L':'M'}${x(p[key])} ${y(p.md)}`).join(' ');out+=`<path d="${path}" fill="none" stroke="${color}" stroke-width="${dash?1.5:2.5}" stroke-dasharray="${dash}"><title>${key}</title></path>`;}
  if(s.maxHookKN>0)out+=`<path d="M${x(s.maxHookKN/9.80665)} ${top}V${bottom}" stroke="#991b1b" stroke-dasharray="9 4"/><text x="${x(s.maxHookKN/9.80665)-4}" y="${top-9}" text-anchor="end" font-size="12" fill="#991b1b">Предел крюка</text>`;
  for(const m of s.measurements.filter(m=>m.md<=a.final!.md))out+=`<circle cx="${x(m.hookTF)}" cy="${y(m.md)}" r="5" fill="${m.mode==='runIn'?colors[0]:colors[1]}" stroke="black"><title>Замер MD ${m.md.toFixed(1)} м: ${m.hookTF.toFixed(2)} тс</title></circle>`;
  out+=`<text x="${(left+right)/2}" y="${bottom+39}" text-anchor="middle" font-size="13" fill="#0f172a">Нагрузка на крюке, тс (с заданным весом блока)</text><text x="18" y="${(top+bottom)/2}" transform="rotate(-90 18 ${(top+bottom)/2})" text-anchor="middle" font-size="13" fill="#0f172a">Глубина башмака MD, м</text>`;
  for(const [i,label]of ['Спуск','Подъём','Без трения','Спуск без оснастки'].entries())out+=`<path d="M${left+i*180} ${height-14}h22" stroke="${colors[i]}" stroke-width="3"/><text x="${left+28+i*180}" y="${height-10}" font-size="12" fill="#334155">${label}</text>`;
  return out+'</svg>';
}
