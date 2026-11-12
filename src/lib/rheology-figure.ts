import {rheologyResolution,rheologyMetrics,RHEOLOGY_MODELS,type RheologyInput} from './cement-rheology';
const esc=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
export function rheologyFigure(r:RheologyInput,residual=false,name=''){
 const o=rheologyResolution(r),fit=o.fit;if(!fit)return;
 const models=['bingham','powerLaw','hb'] as const,colors=['#64748b','#ef7d21','#4338ca'],min=Math.min(...fit.points.map(p=>p.gamma)),max=Math.max(...fit.points.map(p=>p.gamma));
 const metric=models.map(m=>rheologyMetrics(fit,m));
 const series=metric.map(m=>residual?fit.points.map(p=>({x:p.gamma,y:m.pred(p.gamma)-p.tau})):Array.from({length:81},(_,i)=>{const x=min+(max-min)*i/80;return {x,y:m.pred(x)};}));
 const manual=o.valid&&!o.params&&(r.pv>0||r.yp>0);
 if(manual){colors.push('#0f766e');const pred=(g:number)=>r.yp+r.pv*g/1000;series.push(residual?fit.points.map(p=>({x:p.gamma,y:pred(p.gamma)-p.tau})):Array.from({length:81},(_,i)=>{const x=min+(max-min)*i/80;return {x,y:pred(x)};}));}
 const ys=series.flat().map(p=>p.y);if(!residual)ys.push(...fit.points.map(p=>p.tau));
 const low=residual?Math.min(0,...ys)*1.15:0,high=Math.max(0,...ys)*1.15||1;
 const X=(x:number)=>65+(x-min)/(max-min)*610,Y=(y:number)=>285-(y-low)/(high-low||1)*193;
 const title=(residual?'Остатки реологии':'Кривые течения')+(name?': '+name:'');
 let svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 365" width="720" height="365" style="max-width:100%;height:auto"><rect width="720" height="365" fill="white"/><g font-family="Arial,sans-serif" font-size="14" fill="#172033"><text x="65" y="20" font-size="14">${esc(title)}</text>`;
 models.forEach((m,i)=>{svg+=`<text x="${65+i*215}" y="42" font-size="12" fill="${colors[i]}">${esc(RHEOLOGY_MODELS[m])}</text>`;});
 if(manual)svg+=`<text x="65" y="60" font-size="12" fill="#0f766e">Заданные PV/YP (применяются)</text>`;
 for(let i=0;i<=4;i++){const x=min+(max-min)*i/4,y=low+(high-low)*i/4;svg+=`<path d="M${X(x)} 92V285 M65 ${Y(y)}H675" stroke="#e2e8f0"/><text x="${X(x)}" y="304" text-anchor="middle">${x.toFixed(1)}</text><text x="58" y="${Y(y)+4}" text-anchor="end">${y.toFixed(2)}</text>`;}
 series.forEach((points,i)=>{svg+=`<polyline fill="none" stroke="${colors[i]}" stroke-width="${i===3||r.model===models[i]?3:1.5}" points="${points.map(p=>`${X(p.x).toFixed(2)},${Y(p.y).toFixed(2)}`).join(' ')}"/>`;});
 if(!residual)for(const p of fit.points)svg+=`<circle cx="${X(p.gamma)}" cy="${Y(p.tau)}" r="3" fill="#111827"/>`;
 svg+=`<text x="370" y="329" text-anchor="middle">Скорость сдвига, с⁻¹</text><text x="65" y="75">${residual?'Модель минус замер, Па':'Напряжение сдвига, Па; точки - замеры'}</text><text x="65" y="350">Выбор: ${esc(o.label)}</text></g></svg>`;
 return {svg,title,width:720,height:365,reportItem:'rheology' as const};
}
export function rheologyCsv(r:RheologyInput){const o=rheologyResolution(r),fit=o.fit;if(!fit)return '';const names=['bingham','powerLaw','hb'] as const;return `Модель;${o.label}\nЕдиницы;скорость сдвига с^-1;напряжение Па\nRPM;gamma_s-1;tau_Pa;Bingham_Pa;PowerLaw_Pa;HB_Pa;Bingham_residual_Pa;PowerLaw_residual_Pa;HB_residual_Pa;Applied_Pa;Applied_residual_Pa\n`+fit.points.map(p=>{const pred=names.map(m=>rheologyMetrics(fit,m).pred(p.gamma));const applied=o.valid?(o.params?o.params.tau0+o.params.K*p.gamma**o.params.n:r.yp+r.pv*p.gamma/1000):NaN;return [p.rpm,p.gamma,p.tau,...pred,...pred.map(v=>v-p.tau),Number.isFinite(applied)?applied:'',Number.isFinite(applied)?applied-p.tau:''].join(';');}).join('\n');}
