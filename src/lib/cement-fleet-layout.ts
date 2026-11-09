import type { FleetEquipment, LogisticsResult, LogisticsSettings } from './cement-logistics';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const WIDTH=1320, WATER='#0284c7', DRY='#a16207', SLURRY='#0891b2', PRESSURE='#dc2626', SKC='#15803d', RESERVE='#64748b';
type Node={id:string;x:number;y:number;width:number;height:number;row?:FleetEquipment;title:string;note:string;color:string};
type Edge={from:string;to:string;fluid:string;kind:string;dashed?:boolean};
/** Explicit process connections shared by the on-screen plan and Word export. */
export function cementFleetConnections(r:LogisticsResult):Edge[]{
 const classic=r.scheme==='classic',integrated=r.scheme==='single'||r.scheme==='twin';
 const has=(id:string)=>r.equipment.some(e=>e.id===id&&e.count>0),edges:Edge[]=[];
 const link=(from:string,to:string,fluid:string,kind:string,dashed=false)=>{if((has(from)||['water-source','funnel'].includes(from))&&(has(to)||['well','funnel','water-source'].includes(to)))edges.push({from,to,fluid,kind,dashed});};
 if(classic){link('water-source','blend-ca',WATER,'water');link('mixer','funnel',DRY,'dry');link('blend-ca','funnel',WATER,'jet-water');link('funnel','averaging',SLURRY,'mixed-slurry');link('averaging','main',SLURRY,'suction');}
 else {const mixer=integrated?'main':'mixer';link('water-source',mixer,WATER,'water');link('bulk',mixer,DRY,'dry');if(!integrated){if(has('averaging')){link('mixer','averaging',SLURRY,'mixed-slurry');link('averaging','main',SLURRY,'suction');}else link('mixer','main',SLURRY,'suction');}if(integrated)link('main','support-ca',SLURRY,'suction');}
 const outlet=has('manifold')?'manifold':'well';
 link('main',outlet,PRESSURE,'discharge');link('support-ca',outlet,PRESSURE,'discharge');if(has('manifold'))link('manifold','well',PRESSURE,'common-discharge');
 link('reserve-ca',has('manifold')?'manifold':'well',RESERVE,'reserve',true);
 link('water','water-source',WATER,'water-supply');
 return edges;
}
function layout(r:LogisticsResult){
 const nodes:Node[]=[],classic=r.scheme==='classic',integrated=r.scheme==='single'||r.scheme==='twin';
 let y=310;
 const count=(id:string)=>r.equipment.find(e=>e.id===id&&e.count>0);
 const add=(id:string,x=24,width=1272,at=y)=>{const row=count(id);if(!row)return 0;const columns=Math.max(1,Math.floor((width-32)/124)),height=88+Math.ceil(row.count/columns)*108;
 const titles:Record<string,string>={mixer:classic?'СМН - сухой цемент':'Отдельный беспылевой миксер',main:integrated?(r.scheme==='twin'?'Двухнасосные агрегаты со встроенным миксером':'Однонасосные агрегаты со встроенным миксером'):'Нагнетательные ЦА - откачка на скважину','blend-ca':'ЦА затворения - вода через штуцер воронки','support-ca':'Дополнительные нагнетательные ЦА',averaging:'Осреднительные ёмкости на автомобилях',manifold:'Блоки манифольдов на автомобилях',skc:'СКЦ - отдельные автомобили','reserve-ca':'Резервные ЦА',bulk:'Цементовозы ЦТ-25 с тягачами',water:'Автоцистерны воды'};
 const note=id==='mixer'&&classic?'Сухой цемент в воронку. Вода к СМН не подводится.':id==='blend-ca'?'Вода от буровой; отдельные агрегаты для затворения.':id==='bulk'?'Тягач + полуприцеп; один водитель-оператор.':id==='main'&&integrated?'Вода и сухой цемент поступают на борт; смешивание и закачка встроены.':id==='averaging'?classic?'Приём после воронки; отбор раствора нагнетательными ЦА.':'Приём готового раствора; отбор нагнетательными ЦА.':id==='manifold'?'Входы от всех качающих ЦА; одна общая линия к головке.':id==='skc'?'Датчики на конечной нагнетательной линии.':id==='reserve-ca'?'Резерв подключается после переключения обвязки.':'Каждый значок - отдельная выбранная машина.';
 nodes.push({id,x,y:at,width,height,row,title:titles[id]??row.name,note,color:id==='mixer'&&classic||id==='bulk'?DRY:id==='blend-ca'||id==='water'?WATER:id==='skc'?SKC:id==='reserve-ca'?RESERVE:'#2563eb'});return height;};
 if(classic){const h1=add('mixer',24,620),h2=add('blend-ca',676,620);y+=Math.max(h1,h2)+35;nodes.push({id:'funnel',x:460,y,width:400,height:72,title:'Воронка затворения',note:'Сухой цемент + вода через штуцер',color:SLURRY});y+=107;y+=add('averaging')+35;}
 else {y+=add('bulk')+35;if(!integrated){y+=add('mixer')+35;if(count('averaging'))y+=add('averaging')+35;}}
 y+=add('main')+35;
 if(integrated&&count('support-ca'))y+=add('support-ca')+35;
 if(count('manifold'))y+=add('manifold')+35;
 const h1=add('reserve-ca',24,620),h2=add('skc',676,620);y+=Math.max(h1,h2)+35;
 if(count('water'))y+=add('water')+35;
 if(integrated&&count('averaging'))y+=add('averaging')+35;
 const known=new Set(nodes.map(n=>n.id));for(const row of r.equipment)if(row.count>0&&!known.has(row.id))y+=add(row.id)+35;
 return{nodes,height:y+125};
}
export function cementFleetLayoutFigure(r:LogisticsResult,s:LogisticsSettings){return{title:'Схема расстановки оборудования, вид сверху',reportItem:'fleetLayout' as const,svg:cementFleetLayout(r,s),width:WIDTH,height:layout(r).height};}
export function cementFleetLayout(r:LogisticsResult,s:LogisticsSettings):string{
 const {nodes,height}=layout(r),classic=r.scheme==='classic';
 const text=(x:number,y:number,str:string,size=15,color='#1e293b')=>`<text x="${x}" y="${y}" font-family="Arial,sans-serif" font-size="${size}" fill="${color}">${esc(str)}</text>`;
 const pipe=(d:string,color:string,dashed=false,arrow=true)=>`<path d="${d}" fill="none" stroke="${color}" stroke-width="3" ${dashed?'stroke-dasharray="5 5"':''} ${arrow?`marker-end="url(#fleet-${color.slice(1)})"`:''}/>`;
 let out=`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" style="width:100%;height:auto;background:white" role="img" aria-label="Схема расстановки цементировочной техники, вид сверху"><rect width="100%" height="100%" fill="white"/><defs>`;
 for(const c of[WATER,DRY,SLURRY,PRESSURE,SKC,RESERVE])out+=`<marker id="fleet-${c.slice(1)}" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0L7 3.5L0 7Z" fill="${c}"/></marker>`;
 out+=`</defs>${text(24,30,'Расстановка оборудования: каждая машина показана отдельно',21)}${text(24,59,`Транспорт: ${r.totalVehicles} ед.; персонал: ${r.totalPeople} чел.`,16)}`;
 out+=`<rect x="24" y="90" width="560" height="112" rx="12" fill="#e0f2fe" stroke="${WATER}"/>${text(42,122,s.waterSource==='tankers'?'Вода из автоцистерн':'Вода с буровой',20,WATER)}${text(42,153,`Потребность: ${r.waterM3.toFixed(1)} м³`,16)}${text(42,180,classic?'Вода подаётся в ЦА затворения, не в СМН.':'Вода подаётся в смесительную систему.',15)}`;
 out+=`<rect x="1060" y="90" width="236" height="145" rx="12" fill="#f1f5f9" stroke="#64748b"/><path d="M1075 170L1103 100L1131 170Z M1085 143H1120" fill="none" stroke="#475569" stroke-width="3"/><circle cx="1240" cy="140" r="24" fill="white" stroke="#0f172a" stroke-width="3"/><circle cx="1240" cy="140" r="7" fill="#0f172a"/>${text(1078,208,'Буровая / скважина. Устье',16)}`;
 if(s.waterSource!=='tankers')out+=pipe('M1060 100H620V146H584',WATER);
 // Shared final pressure line, downstream of all discharging machines and the external manifold if present.
 out+=`<g data-pressure-line="aggregate-to-well">${pipe('M1308 260H1240V164',PRESSURE)}<circle cx="1275" cy="260" r="10" fill="white" stroke="${SKC}" stroke-width="4"/>${text(740,253,'Датчики СКЦ в нагнетательной линии',15,SKC)}${text(740,276,'После объединения потоков, перед скважиной',14,SKC)}</g>`;
 const source={id:'water-source',x:24,y:90,width:560,height:112},well={id:'well',x:1308,y:260,width:0,height:0};
 const node=(id:string)=>id==='water-source'?source:id==='well'?well:nodes.find(n=>n.id===id);
 for(const edge of cementFleetConnections(r)){
  const a=node(edge.from),b=node(edge.to);if(!a||!b)continue;
  let d='';
  if(edge.to==='well')d=`M${a.x+a.width} ${a.y+a.height/2}H1308V260`;
  else if(edge.from==='water-source')d=`M584 146H640V286H1314V${b.y+86}H${b.x+b.width}`;
  else if(edge.to==='water-source')d=`M${a.x} ${a.y+a.height/2}H6V146H24`;
  else if(edge.kind==='dry'&&classic)d=`M${a.x} ${a.y+a.height/2}H12V${b.y+b.height/2}H${b.x}`;
  else if(edge.from==='blend-ca')d=`M${a.x+a.width/2} ${a.y+a.height}V${b.y+b.height/2}H${b.x+b.width}`;
  else if(edge.kind==='reserve')d=`M${a.x} ${a.y+a.height/2}H12V${b.y+b.height/2}H${b.x}`;
  else if(edge.to==='manifold'&&edge.kind==='discharge')d=`M${a.x+a.width/2} ${a.y+a.height}V${a.y+a.height+16}H12V${b.y+86}H${b.x}`;
  else if(edge.to==='support-ca')d=`M${a.x+a.width} ${a.y+a.height/2}H1300V${b.y-16}H12V${b.y+86}H${b.x}`;
  else d=`M${a.x+a.width/2} ${a.y+a.height}V${b.y-16}H12V${b.y+86}H${b.x}`;
  out+=`<g data-flow-from="${edge.from}" data-flow-to="${edge.to}" data-fluid="${edge.kind}">${pipe(d,edge.fluid,edge.dashed)}</g>`;
 }
 // Pipe connections are behind vehicles, with individual branches from each pump to its group outlet.
 for(const n of nodes){
  out+=`<g data-equipment-group="${n.id}"><rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="12" fill="#f8fafc" stroke="#94a3b8"/>${text(n.x+14,n.y+27,n.title,17)}${text(n.x+14,n.y+(n.row?74:55),n.note,14)}`;
  if(!n.row){out+='</g>';continue;}
  out+=text(n.x+14,n.y+51,`${n.row.count} ед.`,17,n.color);
  const cols=Math.max(1,Math.floor((n.width-32)/124));
  const incoming=cementFleetConnections(r).find(e=>e.to===n.id&&!e.dashed);
  if(incoming)out+=pipe(`M${incoming.kind==='water'?n.x+n.width:n.x} ${n.y+86}H${n.x+28}`,incoming.fluid,false,false);
  for(let i=0;i<n.row.count;i++){
   const x=n.x+16+(i%cols)*124,y=n.y+90+Math.floor(i/cols)*108,c=n.color;
   if(incoming)out+=pipe(`M${n.x+28} ${n.y+86}H${x+53}V${y+8}`,incoming.fluid,false,false);
   const label=n.id==='bulk'?`ЦТ-25 №${i+1}`:n.id==='skc'?`СКЦ №${i+1}`:`№${i+1}`;
   out+=`<g data-equipment-id="${n.id}" data-unit="${i+1}" data-vehicle="${n.row.vehicle}"><title>${esc(n.row.name)} №${i+1}</title>`;
   if(n.row.vehicle){
    out+=`<rect x="${x+77}" y="${y+8}" width="30" height="47" rx="5" fill="${c}" stroke="#334155"/><rect x="${x+94}" y="${y+15}" width="8" height="32" fill="#dbeafe"/><path d="M${x+79} ${y+6}h23 M${x+79} ${y+57}h23" stroke="#334155" stroke-width="4"/><rect x="${x}" y="${y+10}" width="70" height="43" rx="${n.id==='bulk'||n.id==='averaging'||n.id==='water'?18:5}" fill="${n.id==='bulk'?'#f1e6cf':c}" stroke="#334155"/><path d="M${x+8} ${y+7}h20 M${x+8} ${y+56}h20 M${x+70} ${y+31}h7" stroke="#334155" stroke-width="4"/>`;
    if(n.id==='manifold')out+=`<path d="M${x+8} ${y+31}h54 M${x+20} ${y+18}v26 M${x+36} ${y+18}v26 M${x+52} ${y+18}v26" stroke="#fff" stroke-width="4"/>`;
   }else out+=`<rect x="${x+14}" y="${y+10}" width="80" height="44" rx="4" fill="#e2e8f0" stroke="#475569"/>`;
   out+=text(x+20,y+82,label,13)+'</g>';
   if(['main','support-ca','manifold'].includes(n.id)){
    const collects=n.id!=='manifold'&&nodes.some(v=>v.id==='manifold');
    out+=pipe(collects?`M${x+107} ${y+32}H${n.x+n.width-8}V${n.y+n.height-6}H${n.x+n.width/2}V${n.y+n.height}`:`M${x+107} ${y+32}H${n.x+n.width-8}V${n.y+n.height/2}H${n.x+n.width}`,PRESSURE,false,false);
   }
   if(n.id==='skc')out+=pipe(`M${x+53} ${y+55}V${y+94}H1302V285H1275V270`,SKC,true,false);
  }
  out+='</g>';
 }
 out+=text(24,height-96,'Синий: вода. Коричневый: сухой цемент. Бирюзовый: готовый раствор и всасывающие линии.',15);
 out+=text(24,height-68,'Красный: нагнетательные линии. Зелёный: датчики СКЦ. Серый пунктир: резервная обвязка.',15);
 out+=text(24,height-34,'Схема условная, без масштаба. Фактические проезды, расстояния и обвязку согласовать на площадке.',14,RESERVE);
 return out+'</svg>';
}
