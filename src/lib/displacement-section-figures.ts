import {sectionState,SECTION_NOTE,type DisplacementSection,type SectionSource} from './displacement-section';
const esc=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function wrap(s:string,width=105){const lines:string[]=[];let line='';for(const word of s.split(/\s+/)){if(line.length+word.length>width){lines.push(line);line='';}line+=(line?' ':'')+word;}if(line)lines.push(line);return lines;}
export function sectionSvg(s:DisplacementSection,view:'3d'|'top'){
 const width=900,legendRows=Math.ceil(s.fluids.length/2),legendY=505,barY=legendY+legendRows*29+12,notes=wrap(SECTION_NOTE),height=barY+90+notes.length*18;
 const text=(x:number,y:number,t:string,size=16,other='')=>`<text x="${x}" y="${y}" font-size="${size}" ${other}>${esc(t)}</text>`;
 const title=`Сечение вытеснения: ${view==='3d'?'3D':'вид сверху'}, MD ${s.requestedMD.toFixed(1)} м, t ${(s.timeS/60).toFixed(3)} мин`;
 let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="DejaVu Sans,sans-serif"><rect width="100%" height="100%" fill="white"/>`;
 svg+=text(24,25,title,19)+text(24,51,`ОК Ø${(s.geometry.ro*2).toFixed(1)} / ${(s.geometry.ri*2).toFixed(1)} мм; ствол Ø${(s.geometry.rh*2).toFixed(1)} мм`,16);
 svg+=text(24,75,`Зазор: min ${s.geometry.minGapMm.toFixed(2)} / max ${s.geometry.maxGapMm.toFixed(2)} мм; кадр ${s.frame}`,16);
 const n=[1,1.2,2.4],nl=Math.hypot(...n),N=n.map(x=>x/nl),rl=Math.hypot(N[2],N[0]),R=[N[2]/rl,0,-N[0]/rl],U=[N[1]*R[2],N[2]*R[0]-N[0]*R[2],-N[1]*R[0]],dot=(a:number[],b:number[])=>a.reduce((sum,v,i)=>sum+v*b[i],0);
 const project=(p:number[])=>view==='top'?[p[0],p[1],p[2]]:[dot(p,R),dot(p,U),dot(p,N)];
 const faces=s.faces.map(f=>({color:f.color,p:f.points.map(project)})),points=faces.flatMap(f=>f.p),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys),scale=Math.min(620/(maxX-minX),385/(maxY-minY));
 const at=(p:number[])=>[(450+(p[0]-(minX+maxX)/2)*scale).toFixed(3),(292-(p[1]-(minY+maxY)/2)*scale).toFixed(3)].join(',');
 for(const f of faces.sort((a,b)=>a.p.reduce((s,v)=>s+v[2],0)-b.p.reduce((s,v)=>s+v[2],0)))svg+=`<polygon points="${f.p.map(at).join(' ')}" fill="${f.color}" stroke="${f.color}" stroke-width="0.15"/>`;
 svg+=text(24,110,'Широкая сторона',14)+text(24,481,'Узкая сторона',14);
 s.fluids.forEach((f,i)=>{const x=24+(i%2)*438,y=legendY+Math.floor(i/2)*29;svg+=`<rect x="${x}" y="${y-13}" width="18" height="15" fill="${s.colors[i]??'#64748b'}"/>`+text(x+25,y,`${i+1}. ${f.name.length>35?f.name.slice(0,35)+'…':f.name}`,15);});
 for(const [i,label,values]of [[0,'Труба',s.pipeFractions],[1,'Затрубье',s.annulusFractions]] as const){const y=barY+i*31;svg+=text(24,y+14,label,15);let x=145;if(values.some(v=>v===null)){svg+=`<rect x="145" y="${y}" width="700" height="18" fill="#e2e8f0"/>`+text(155,y+14,'Состав не определён',14);}else values.forEach((value,f)=>{const w=700*(value??0);svg+=`<rect x="${x}" y="${y}" width="${w}" height="18" fill="${s.colors[f]??'#64748b'}"/>`;x+=w;});}
 notes.forEach((line,i)=>svg+=text(24,barY+85+i*18,line,14));
 return {title,svg:svg+'</svg>',width,height,reportItem:'displacementSection' as const,sourceKey:s.sourceKey};
}
export function displacementSectionFigures(d:SectionSource,md?:number,frame?:number){const s=sectionState(d,md,frame);return 'error' in s?[]:[sectionSvg(s,'3d'),sectionSvg(s,'top')];}
