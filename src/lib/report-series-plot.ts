import type {ReportItem} from './cementing-report-options';
import {resolveChartPresentation,type ChartPresentation} from './chart-presentation';
export interface PlotSeries {name:string;color:string;values:(number|null|undefined)[];axis?:'left'|'right';dash?:string;curve?:'stepBefore';reference?:boolean;markersOnly?:boolean;}
export interface PlotOptions {rightUnit?:string;depth?:boolean;stages?:{time:number;label:string}[];plotId?:string;presentation?:ChartPresentation;note?:string;depthMarkers?:{depth:number;label:string}[]}
const finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n);
const esc=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function wrap(text:string,max:number){const lines:string[]=[];let line='';for(const word of text.split(/\s+/)){for(let offset=0;offset<word.length;offset+=max){const part=word.slice(offset,offset+max);if(line&&line.length+part.length+1>max){lines.push(line);line='';}line+=(line?' ':'')+part;}}if(line)lines.push(line);return lines;}
export function reportSeriesPlot(sourceTitle:string,item:ReportItem,xValues:number[],xUnit:string,leftUnit:string,series:PlotSeries[],opts:PlotOptions={}){
 const style=resolveChartPresentation(opts.presentation,{x:xUnit,left:leftUnit,right:opts.rightUnit}),presentation=style.presentation;
 const title=presentation?.title??sourceTitle,fontSize=presentation?.fontSize??13,titleFont=fontSize+6;
 const family=presentation?.fontFamily==='serif'?'DejaVu Serif,serif':presentation?.fontFamily==='monospace'?'DejaVu Sans Mono,monospace':'DejaVu Sans,sans-serif';
 const width=900,left=Math.max(85,fontSize*7),right=opts.rightUnit?width-Math.max(100,fontSize*7):width-45;
 const titleLines=wrap(title,Math.floor((width-48)/(titleFont*.62))),sourceLines=title!==sourceTitle?wrap(sourceTitle,Math.floor((width-48)/((fontSize-1)*.62))):[];
 let y=30;const text=(value:string,x:number,yy:number,size:number,attrs='')=>`<text x="${x}" y="${yy}" font-size="${size}" ${attrs}>${esc(value)}</text>`;
 let header='';for(const line of titleLines){header+=text(line,24,y,titleFont,'fill="#0f172a"');y+=titleFont+4;}
 for(const line of sourceLines){header+=text(line,24,y,fontSize-1,'fill="#475569"');y+=fontSize+3;}
 if(opts.note)for(const line of wrap(opts.note,Math.floor((width-48)/((fontSize-1)*.62)))){header+=text(line,24,y,fontSize-1,'fill="#475569"');y+=fontSize+3;}
 y+=8;
 for(let i=0;i<series.length;i+=2){let rowLines=1;for(let j=i;j<Math.min(i+2,series.length);j++){
  const s=series[j],x=26+(j%2)*430,lines=wrap(s.name,Math.floor(380/(fontSize*.62)));rowLines=Math.max(rowLines,lines.length);
  header+=`<path d="M${x} ${y-5}h24" stroke="${s.color}" stroke-width="3" ${s.dash?'stroke-dasharray="'+s.dash+'"':''}/>`;
  lines.forEach((line,k)=>header+=text(line,x+31,y+k*(fontSize+3),fontSize));
 }y+=rowLines*(fontSize+3)+6;}
 const top=y+10,bottom=top+340,height=bottom+90;
 const range=(values:number[])=>{let min=0,max=1;for(const n of values){min=Math.min(min,n);max=Math.max(max,n);}return {min,max:max+(max-min)*.06};};
 const xr=style.ranges.x??range(xValues.filter(finite)),lr=style.ranges.left??range(series.filter(s=>s.axis!=='right').flatMap(s=>s.values.filter(finite))),rr=style.ranges.right??range(series.filter(s=>s.axis==='right').flatMap(s=>s.values.filter(finite)));
 const X=(v:number)=>left+(v-xr.min)/(xr.max-xr.min)*(right-left),Y=(v:number,r=lr)=>bottom-(v-r.min)/(r.max-r.min)*(bottom-top);
 const tick=(v:number,r:{min:number;max:number})=>v.toFixed(Math.min(9,Math.max(0,Math.ceil(-Math.log10((r.max-r.min)/5))+1)));
 const clipId='plot-'+(opts.plotId??item).replace(/[^A-Za-z0-9_-]/g,'');
 let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${family}"><rect width="100%" height="100%" fill="white"/>${header}<defs><clipPath id="${clipId}"><rect x="${left}" y="${top}" width="${right-left}" height="${bottom-top}"/></clipPath></defs>`;
 for(let i=0;i<=5;i++){const yy=top+(bottom-top)*i/5,xx=left+(right-left)*i/5;
  svg+=`<path d="M${left} ${yy}H${right} M${xx} ${top}V${bottom}" stroke="#e2e8f0"/>`;
  const value=opts.depth?xr.min+(xr.max-xr.min)*i/5:lr.max-(lr.max-lr.min)*i/5;
  svg+=text(tick(value,opts.depth?xr:lr),left-9,yy+4,fontSize,'text-anchor="end"');
  svg+=text(tick(opts.depth?lr.min+(lr.max-lr.min)*i/5:xr.min+(xr.max-xr.min)*i/5,opts.depth?lr:xr),xx,bottom+24,fontSize,'text-anchor="middle"');
  if(opts.rightUnit&&!opts.depth)svg+=text(tick(rr.max-(rr.max-rr.min)*i/5,rr),right+8,yy+4,fontSize);
 }
 let outsideCount=0;
 svg+=`<g clip-path="url(#${clipId})">`;
 for(const s of series){let path='',markers='',pen=false,previousX=0;const r=s.axis==='right'?rr:lr;
  for(let i=0;i<xValues.length;i++){const v=s.values[i],x=xValues[i];if(!finite(v)||!finite(x)){pen=false;continue;}
   if(x<xr.min||x>xr.max||v<r.min||v>r.max)outsideCount++;
   const xx=opts.depth?left+(v-lr.min)/(lr.max-lr.min)*(right-left):X(x),yy=opts.depth?top+(x-xr.min)/(xr.max-xr.min)*(bottom-top):Y(v,r);
   if(!finite(xx)||!finite(yy)){pen=false;continue;}
   if(s.markersOnly)markers+=`<circle cx="${xx.toFixed(2)}" cy="${yy.toFixed(2)}" r="3.2" fill="${s.color}"/>`;
   if(pen&&s.curve==='stepBefore'&&!opts.depth)path+=`L${previousX.toFixed(2)} ${yy.toFixed(2)} `;
   path+=`${pen?'L':'M'}${xx.toFixed(2)} ${yy.toFixed(2)} `;pen=true;previousX=xx;
  }
  if(s.markersOnly)svg+=markers;else svg+=`<path d="${path}" fill="none" stroke="${s.color}" stroke-width="2.2" ${s.dash?'stroke-dasharray="'+s.dash+'"':''}/>`;
 }
 if(!opts.depth)for(const [i,stage]of (opts.stages??[]).entries())if(stage.time>=xr.min&&stage.time<=xr.max){svg+=`<path d="M${X(stage.time)} ${top}V${bottom}" stroke="#94a3b8" stroke-dasharray="3 5"/>`+text(stage.label.slice(0,30),X(stage.time)+3,top+12+(i%3)*14,Math.max(9,fontSize-3),'fill="#64748b"');}
 if(opts.depth)for(const marker of opts.depthMarkers??[]){if(!finite(marker.depth)||marker.depth<xr.min||marker.depth>xr.max)continue;const yy=top+(marker.depth-xr.min)/(xr.max-xr.min)*(bottom-top);svg+=`<path d="M${left} ${yy}H${right}" stroke="#64748b" stroke-dasharray="3 4"/>`+text(marker.label,right-4,Math.max(top+12,yy-4),10,'text-anchor="end" fill="#475569"');}
 svg+='</g>';
 svg+=text(opts.depth?leftUnit:xUnit,(left+right)/2,bottom+58,fontSize+1,'text-anchor="middle"');
 svg+=text(opts.depth?xUnit:leftUnit,18,(top+bottom)/2,fontSize,`transform="rotate(-90 18 ${(top+bottom)/2})" text-anchor="middle"`);
 if(opts.rightUnit)svg+=text(opts.rightUnit,width-18,(top+bottom)/2,fontSize,`transform="rotate(90 ${width-18} ${(top+bottom)/2})" text-anchor="middle"`);
 if(outsideCount)svg+=text(`За пределами окна: ${outsideCount} значений. Полные ряды сохранены в XLSX.`,24,height-12,10,'fill="#b45309"');
 else if(style.ignored.length)svg+=text('Единицы или координата изменились: прежние пределы соответствующих шкал не применены.',24,height-12,10,'fill="#b45309"');
 return {title,plotId:opts.plotId??item,reportItem:item,width,height,svg:svg+'</svg>',data:{sourceTitle,xLabel:xUnit,leftLabel:leftUnit,rightLabel:opts.rightUnit,depth:!!opts.depth,stages:opts.stages,note:opts.note,depthMarkers:opts.depthMarkers,presentation,ignoredRanges:style.ignored,outsideCount,ranges:{x:xr,left:lr,right:opts.rightUnit?rr:undefined},coordinates:undefined as {mdM:number;tvdM:number}[]|undefined,xValues:xValues.map(x=>finite(x)?x:null),series:series.map(s=>({...s,values:xValues.map((_,i)=>finite(s.values[i])?s.values[i] as number:null)}))}};
}
export function applyPlotPresentation<T extends ReturnType<typeof reportSeriesPlot>>(plot:T,presentation?:ChartPresentation):T {
 if(!presentation&&!plot.data.presentation)return plot;
 const d=plot.data,r=reportSeriesPlot(d.sourceTitle,plot.reportItem,d.xValues.map(x=>x??NaN),d.xLabel,d.leftLabel,d.series,{rightUnit:d.rightLabel,depth:d.depth,stages:d.stages,note:d.note,depthMarkers:d.depthMarkers,plotId:plot.plotId,presentation});
 return {...plot,...r,data:{...r.data,coordinates:d.coordinates}};
}
export function hasPlotNumbers(plot:ReturnType<typeof reportSeriesPlot>){return plot.data.xValues.some((x,i)=>x!==null&&plot.data.series.some(s=>!s.reference&&s.values[i]!==null));}
