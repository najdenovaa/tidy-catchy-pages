import {displacementPlacement,PLACEMENT_NOTE,type DisplacementPlacement} from './displacement-placement';
import {placementMesh} from './displacement-placement-mesh';
import type {SectionSource} from './displacement-section';
const esc=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
export function placementSvg(s:DisplacementPlacement){
 const faces=placementMesh(s).faces.map(f=>({color:f.color,p:f.points.map(p=>[.8*p[0]-.6*p[2],p[1]*.94-.2*(p[0]+p[2]),.6*p[0]+.8*p[2]+.2*p[1]])})),all=faces.flatMap(f=>f.p);
 if(!all.length)return null;
 let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;for(const p of all){minX=Math.min(minX,p[0]);maxX=Math.max(maxX,p[0]);minY=Math.min(minY,p[1]);maxY=Math.max(maxY,p[1]);}
 const scale=Math.min(790/Math.max(.001,maxX-minX),570/Math.max(.001,maxY-minY)),at=(p:number[])=>`${(450+(p[0]-(minX+maxX)/2)*scale).toFixed(2)},${(370-(p[1]-(minY+maxY)/2)*scale).toFixed(2)}`;
 const title=`${s.isLast?'Конечное размещение':'Размещение'} жидкостей: ${s.completed?(s.isLast?'рассчитанный итог':'промежуточный кадр'):'неполный расчёт'}, t ${(s.timeS/60).toFixed(3)} мин`,legendY=690,height=legendY+Math.ceil(s.fluids.length/2)*27+120;
 let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="${height}" viewBox="0 0 900 ${height}" font-family="DejaVu Sans,sans-serif"><rect width="100%" height="100%" fill="white"/><text x="24" y="28" font-size="19">${esc(title)}</text><text x="24" y="55" font-size="15">Труба: ${s.pipeEnabled?'рассчитана':'отключена'}; затрубье: ${s.annulusEnabled?'рассчитано':'отключено'}. Кадр ${s.frame}. MD 0-${s.depths.at(-1)?.toFixed(1)} м.</text>`;
 for(const f of faces.sort((a,b)=>a.p.reduce((s,p)=>s+p[2],0)-b.p.reduce((s,p)=>s+p[2],0)))svg+=`<polygon points="${f.p.map(at).join(' ')}" fill="${f.color}" stroke="${f.color}" stroke-width=".15"/>`;
 s.fluids.forEach((f,i)=>{const x=24+(i%2)*438,y=legendY+Math.floor(i/2)*27;svg+=`<rect x="${x}" y="${y-13}" width="18" height="16" fill="${s.colors[i]??'#64748b'}"/><text x="${x+25}" y="${y}" font-size="14">${esc((i+1)+'. '+f.name.slice(0,42))}</text>`;});
 const words=PLACEMENT_NOTE.split(' '),lines:string[]=[];let line='';for(const word of words){if(line.length+word.length>112){lines.push(line);line='';}line+=(line?' ':'')+word;}if(line)lines.push(line);lines.forEach((l,i)=>svg+=`<text x="24" y="${legendY+Math.ceil(s.fluids.length/2)*27+20+i*17}" font-size="13">${esc(l)}</text>`);
 return {title,svg:svg+'</svg>',width:900,height,reportItem:'displacementPlacement' as const,sourceKey:s.sourceKey};
}
export function displacementPlacementFigures(d:SectionSource){const state=displacementPlacement(d);if('error'in state)return[];const figure=placementSvg(state);return figure?[figure]:[];}
