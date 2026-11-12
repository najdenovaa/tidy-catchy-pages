import type { ReportItem } from './cementing-report-options';
export interface PlotSeries {name:string;color:string;values:(number|null|undefined)[];axis?:'left'|'right';dash?:string;curve?:'stepBefore';}
export function reportSeriesPlot(title:string,item:ReportItem,xValues:number[],xUnit:string,leftUnit:string,series:PlotSeries[],opts:{rightUnit?:string;depth?:boolean;stages?:{time:number;label:string}[]}={}) {
 const esc=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
 const width=900,height=580,left=85,right=opts.rightUnit?800:850,top=150,bottom=490;
 const finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n);
 const xs=xValues.filter(finite),range=(a:number[])=>{let min=Math.min(0,...a),max=Math.max(1,...a);if(max===min)max=min+1;return{min,max:max+(max-min)*.06};};
 const xr=range(xs),lr=range(series.filter(s=>s.axis!=='right').flatMap(s=>s.values.filter(finite))),rr=range(series.filter(s=>s.axis==='right').flatMap(s=>s.values.filter(finite)));
 const X=(v:number)=>left+(v-xr.min)/(xr.max-xr.min)*(right-left),Y=(v:number,r=lr)=>bottom-(v-r.min)/(r.max-r.min)*(bottom-top);
 let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="white"/><text x="24" y="30" font-family="sans-serif" font-size="19" fill="#0f172a">${esc(title)}</text>`;
 series.forEach((s,i)=>{const x=26+i%2*430,y=58+Math.floor(i/2)*22;svg+=`<path d="M${x} ${y-5}h24" stroke="${s.color}" stroke-width="3" ${s.dash?'stroke-dasharray="'+s.dash+'"':''}/><text x="${x+31}" y="${y}" font-family="sans-serif" font-size="13">${esc(s.name)}</text>`;});
 for(let i=0;i<=5;i++){const yy=top+(bottom-top)*i/5,xx=left+(right-left)*i/5;
 svg+=`<path d="M${left} ${yy}H${right} M${xx} ${top}V${bottom}" stroke="#e2e8f0"/>`;
 if(!opts.depth){svg+=`<text x="${left-9}" y="${yy+4}" text-anchor="end" font-family="sans-serif" font-size="12">${(lr.max-(lr.max-lr.min)*i/5).toFixed(2)}</text><text x="${xx}" y="${bottom+22}" text-anchor="middle" font-family="sans-serif" font-size="12">${(xr.min+(xr.max-xr.min)*i/5).toFixed(1)}</text>`;if(opts.rightUnit)svg+=`<text x="${right+8}" y="${yy+4}" font-family="sans-serif" font-size="12">${(rr.max-(rr.max-rr.min)*i/5).toFixed(1)}</text>`;}
 else {svg+=`<text x="${left-9}" y="${yy+4}" text-anchor="end" font-family="sans-serif" font-size="12">${(xr.max*i/5).toFixed(0)}</text><text x="${xx}" y="${bottom+22}" text-anchor="middle" font-family="sans-serif" font-size="12">${(lr.min+(lr.max-lr.min)*i/5).toFixed(2)}</text>`;}}
 for(const s of series){let path='',pen=false,previousX=0;for(let i=0;i<xValues.length;i++){const v=s.values[i];if(!finite(v)||!finite(xValues[i])){pen=false;continue;}
 const xx=opts.depth?left+(v-lr.min)/(lr.max-lr.min)*(right-left):X(xValues[i]);const yy=opts.depth?top+xValues[i]/xr.max*(bottom-top):Y(v,s.axis==='right'?rr:lr);
 if(pen&&s.curve==='stepBefore'&&!opts.depth)path+=`L${previousX.toFixed(2)} ${yy.toFixed(2)} `;
 path+=`${pen?'L':'M'}${xx.toFixed(2)} ${yy.toFixed(2)} `;pen=true;previousX=xx;}
 svg+=`<path d="${path}" fill="none" stroke="${s.color}" stroke-width="2.2" ${s.dash?'stroke-dasharray="'+s.dash+'"':''}/>`;}
 if(!opts.depth)for(const [i,stage]of (opts.stages??[]).entries())if(stage.time>=xr.min&&stage.time<=xr.max){svg+=`<path d="M${X(stage.time)} ${top}V${bottom}" stroke="#94a3b8" stroke-dasharray="3 5"/><text x="${X(stage.time)+3}" y="${top+12+(i%3)*14}" font-family="sans-serif" font-size="9" fill="#64748b">${esc(stage.label.slice(0,30))}</text>`;}
 svg+=`<text x="${(left+right)/2}" y="${height-30}" text-anchor="middle" font-family="sans-serif" font-size="14">${esc(opts.depth?leftUnit:xUnit)}</text><text x="18" y="${(top+bottom)/2}" transform="rotate(-90 18 ${(top+bottom)/2})" text-anchor="middle" font-family="sans-serif" font-size="13">${esc(opts.depth?xUnit:leftUnit)}</text>`;
 if(opts.rightUnit)svg+=`<text x="882" y="${(top+bottom)/2}" transform="rotate(90 882 ${(top+bottom)/2})" text-anchor="middle" font-family="sans-serif" font-size="13">${esc(opts.rightUnit)}</text>`;
 return{title,reportItem:item,width,height,svg:svg+'</svg>'};
}
