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
/** Physical order: preparation below pumps, manifold nearest the well; auxiliaries at the sides. */
export function cementFleetLayoutPositions(r:LogisticsResult){
 const nodes:Node[]=[],classic=r.scheme==='classic',integrated=r.scheme==='single'||r.scheme==='twin';
 const count=(id:string)=>r.equipment.find(e=>e.id===id&&e.count>0);
 const add=(id:string,y:number,lane:'center'|'left'|'right'='center')=>{
  const row=count(id);if(!row)return undefined;
  const width=Math.max(280,32+Math.min(row.count,3)*124),x=lane==='left'?24:lane==='right'?WIDTH-24-width:(WIDTH-width)/2;
  const cols=Math.floor((width-32)/124),height=88+Math.ceil(row.count/cols)*108;
  const titles:Record<string,string>={mixer:classic?'СМН - сухой цемент':'Беспылевой миксер',main:integrated?(r.scheme==='twin'?'Двухнасосные агрегаты':'Однонасосные агрегаты'):'Нагнетательные ЦА','blend-ca':'ЦА затворения','support-ca':'Дополнительные рабочие ЦА',averaging:'Осреднительные ёмкости',manifold:'Блоки манифольдов',skc:'СКЦ','reserve-ca':'Резервные ЦА',bulk:'Цементовозы ЦТ-25',water:'Автоцистерны воды'};
  const note=id==='mixer'&&classic?'Сухой цемент в воронку; без воды.':id==='mixer'?'Вода + цемент; отбор раствора ЦА.':id==='blend-ca'?'Вода через штуцер воронки.':id==='bulk'?'Тягач + полуприцеп; 1 оператор.':id==='main'&&integrated?'Миксер и манифольд на борту.':id==='averaging'?'Приём и отбор готового раствора.':id==='manifold'?'Общая линия к скважине.':id==='skc'?'Датчики в нагнетательной линии.':id==='reserve-ca'?'Подключение после переключения.':id==='main'?'Откачка готового раствора.':'Отдельная выбранная машина.';
  const node:Node={id,x,y,width,height,row,title:titles[id]??row.name,note,color:id==='mixer'&&classic||id==='bulk'?DRY:id==='blend-ca'||id==='water'?WATER:id==='skc'?SKC:id==='reserve-ca'?RESERVE:'#2563eb'};
  nodes.push(node);return node;
 };
 const bottom=(n:Node|undefined,fallback:number)=>n?n.y+n.height:fallback;
 const manifold=add('manifold',280);
 const main=add('main',bottom(manifold,240)+40);
 const mainY=main?.y??280,mainBottom=bottom(main,280);
 const support=add('support-ca',mainY,'right');
 const skc=add('skc',Math.max(mainBottom,bottom(support,mainBottom))+40,'right');
 if(classic){
  const reserve=add('reserve-ca',mainBottom+40,'left');
  const averaging=add('averaging',mainBottom+40);
  const prepY=Math.max(bottom(averaging,mainBottom),bottom(reserve,mainBottom),bottom(skc,mainBottom))+40;
  add('mixer',prepY,'left');add('blend-ca',prepY,'right');
  nodes.push({id:'funnel',x:500,y:prepY+90,width:320,height:72,title:'Воронка затворения',note:'Цемент + вода через штуцер',color:SLURRY});
 }else{
  const averaging=add('averaging',mainBottom+40);
  const mixer=integrated?undefined:add('mixer',bottom(averaging,mainBottom)+40);
  const bulk=add('bulk',integrated?mainY:(mixer?.y??mainBottom+40),'left');
  add('reserve-ca',Math.max(mainBottom,bottom(bulk,mainBottom))+40,'left');
 }
 let lower=Math.max(650,...nodes.map(n=>n.y+n.height))+40;
 const water=add('water',lower,'left');lower=bottom(water,lower);
 const known=new Set(nodes.map(n=>n.id));for(const row of r.equipment)if(row.count>0&&!known.has(row.id)){const n=add(row.id,lower+40);lower=bottom(n,lower);}
 return{nodes,height:Math.max(lower,...nodes.map(n=>n.y+n.height))+125};
}

export function cementFleetLayoutFigure(r:LogisticsResult,s:LogisticsSettings){return{title:'Схема расстановки оборудования, вид сверху',reportItem:'fleetLayout' as const,svg:cementFleetLayout(r,s),width:WIDTH,height:cementFleetLayoutPositions(r).height};}
export function cementFleetLayout(r:LogisticsResult,s:LogisticsSettings):string{
 const {nodes,height}=cementFleetLayoutPositions(r),classic=r.scheme==='classic';
 const text=(x:number,y:number,str:string,size=15,color='#1e293b')=>`<text x="${x}" y="${y}" font-family="Arial,sans-serif" font-size="${size}" fill="${color}">${esc(str)}</text>`;
 const pipe=(d:string,color:string,dashed=false,arrow=true)=>`<path d="${d}" fill="none" stroke="${color}" stroke-width="3" ${dashed?'stroke-dasharray="5 5"':''} ${arrow?`marker-end="url(#fleet-${color.slice(1)})"`:''}/>`;
 let out=`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" style="width:100%;height:auto;background:white" role="img" aria-label="Схема расстановки цементировочной техники, вид сверху"><rect width="100%" height="100%" fill="white"/><defs>`;
 for(const c of[WATER,DRY,SLURRY,PRESSURE,SKC,RESERVE])out+=`<marker id="fleet-${c.slice(1)}" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0L7 3.5L0 7Z" fill="${c}"/></marker>`;
 out+=`</defs>${text(24,30,'Расстановка оборудования: каждая машина показана отдельно',21)}${text(24,59,`Транспорт: ${r.totalVehicles} ед.; персонал: ${r.totalPeople} чел.`,16)}`;
 out+=`<rect x="24" y="90" width="384" height="112" rx="12" fill="#e0f2fe" stroke="${WATER}"/>${text(42,122,s.waterSource==='tankers'?'Вода из автоцистерн':'Вода с буровой',20,WATER)}${text(42,153,`Потребность: ${r.waterM3.toFixed(1)} м³`,16)}${text(42,180,classic?'Вода в ЦА затворения, не в СМН.':'Вода в смесительную систему.',14)}`;
 out+=`<rect x="500" y="80" width="320" height="140" rx="12" fill="#f1f5f9" stroke="#64748b"/><path d="M525 174L553 96L581 174Z M537 140H569" fill="none" stroke="#475569" stroke-width="3"/><circle cx="735" cy="140" r="24" fill="white" stroke="#0f172a" stroke-width="3"/><circle cx="735" cy="140" r="7" fill="#0f172a"/>${text(520,204,'Буровая / скважина',16)}`;
 if(s.waterSource!=='tankers')out+=pipe('M500 110H450V146H408',WATER);
 out+=`<g data-pressure-line="aggregate-to-well">${pipe('M660 280V240H735V164',PRESSURE)}<circle cx="660" cy="260" r="9" fill="white" stroke="${SKC}" stroke-width="4"/>${text(840,232,'Датчики СКЦ в нагнетательной линии',15,SKC)}${text(840,254,'Перед скважиной',14,SKC)}</g>`;
 const source={id:'water-source',x:24,y:90,width:384,height:112},well={id:'well',x:660,y:280,width:0,height:0};
 const node=(id:string)=>id==='water-source'?source:id==='well'?well:nodes.find(n=>n.id===id);
 for(const edge of cementFleetConnections(r)){
  const a=node(edge.from),b=node(edge.to);if(!a||!b)continue;
  const ax=a.x+a.width/2,bx=b.x+b.width/2,am=a.y+a.height/2,bm=b.y+b.height/2;
  let d='';
  if(edge.kind==='reserve')d=`M${a.x+a.width} ${am}H440V${edge.to==='well'?260:b.y+b.height+20}H660${edge.to==='well'?'':`V${b.y+b.height}`}`;
  else if(edge.to==='well')d=edge.from==='support-ca'?`M${a.x} ${am}H884V280H660`:`M${ax} ${a.y}V280`;
  else if(edge.from==='water-source')d=classic?`M408 146H440V74H1308V${bm}H${b.x+b.width}`:`M216 202V${b.y-20}H450V${b.y+b.height-24}H${b.x}`;
  else if(edge.to==='water-source')d=`M${a.x} ${am}H12V146H24`;
  else if(edge.kind==='dry')d=`M${a.x+a.width} ${am}H440V${bm}H${b.x}`;
  else if(edge.from==='blend-ca')d=`M${a.x} ${am}H880V${bm}H${b.x+b.width}`;
  else if(edge.from==='support-ca')d=`M${a.x} ${am}H884V${b.y+b.height+20}H${bx}V${b.y+b.height}`;
  else if(edge.to==='support-ca')d=`M${a.x+a.width} ${a.y+a.height-24}H${b.x-20}V${b.y+b.height-24}H${b.x}`;
  else d=`M${ax} ${a.y}V${b.y+b.height+20}H${bx}V${b.y+b.height}`;
  out+=`<g data-flow-from="${edge.from}" data-flow-to="${edge.to}" data-fluid="${edge.kind}">${pipe(d,edge.fluid,edge.dashed)}</g>`;
 }
 // Pipe connections are behind vehicles, with individual branches from each pump to its group outlet.
 for(const n of nodes){
  out+=`<g data-equipment-group="${n.id}" data-x="${n.x}" data-y="${n.y}" data-width="${n.width}" data-height="${n.height}"><rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="12" fill="#f8fafc" stroke="#94a3b8"/>${text(n.x+14,n.y+27,n.title,17)}${text(n.x+14,n.y+(n.row?74:55),n.note,14)}`;
  if(!n.row){out+='</g>';continue;}
  out+=text(n.x+14,n.y+51,`${n.row.count} ед.`,17,n.color);
  const cols=Math.max(1,Math.floor((n.width-32)/124));
  const incoming=cementFleetConnections(r).find(e=>e.to===n.id&&!e.dashed);
  for(let i=0;i<n.row.count;i++){
   const x=n.x+16+(i%cols)*124,y=n.y+90+Math.floor(i/cols)*108,c=n.color;

   const label=n.id==='bulk'?`ЦТ-25 №${i+1}`:n.id==='skc'?`СКЦ №${i+1}`:`№${i+1}`;
   out+=`<g data-equipment-id="${n.id}" data-unit="${i+1}" data-vehicle="${n.row.vehicle}"><title>${esc(n.row.name)} №${i+1}</title>`;
   if(n.row.vehicle){
    out+=`<rect x="${x+77}" y="${y+8}" width="30" height="47" rx="5" fill="${c}" stroke="#334155"/><rect x="${x+94}" y="${y+15}" width="8" height="32" fill="#dbeafe"/><path d="M${x+79} ${y+6}h23 M${x+79} ${y+57}h23" stroke="#334155" stroke-width="4"/><rect x="${x}" y="${y+10}" width="70" height="43" rx="${n.id==='bulk'||n.id==='averaging'||n.id==='water'?18:5}" fill="${n.id==='bulk'?'#f1e6cf':c}" stroke="#334155"/><path d="M${x+8} ${y+7}h20 M${x+8} ${y+56}h20 M${x+70} ${y+31}h7" stroke="#334155" stroke-width="4"/>`;
    if(n.id==='manifold')out+=`<path d="M${x+8} ${y+31}h54 M${x+20} ${y+18}v26 M${x+36} ${y+18}v26 M${x+52} ${y+18}v26" stroke="#fff" stroke-width="4"/>`;
   }else out+=`<rect x="${x+14}" y="${y+10}" width="80" height="44" rx="4" fill="#e2e8f0" stroke="#475569"/>`;
   out+=text(x+20,y+82,label,13)+'</g>';
   if(['main','manifold'].includes(n.id))out+=pipe(`M${x+107} ${y+32}H${n.x+n.width-8}V${n.y}H${n.x+n.width/2}`,PRESSURE,false,false);
   if(n.id==='support-ca')out+=pipe(`M${x} ${y+32}H${n.x+8}V${n.y+n.height/2}H${n.x}`,PRESSURE,false,false);
   if(incoming&&['averaging','main','manifold','mixer'].includes(n.id)&&!(n.id==='main'&&(r.scheme==='single'||r.scheme==='twin'))&&!(n.id==='mixer'&&classic))out+=pipe(`M${n.x+n.width/2} ${n.y+n.height}V${n.y+n.height-6}H${x+113}V${y+55}H${x+107}`,incoming.fluid,false,false);
   if(n.id==='skc')out+=pipe(`M${x} ${y+32}H${n.x+8}V${n.y+n.height/2}H876V260H670`,SKC,true,false);

  }
  out+='</g>';
 }
 out+=text(24,height-96,'Синий: вода. Коричневый: сухой цемент. Бирюзовый: готовый раствор и всасывающие линии.',15);
 out+=text(24,height-68,'Красный: нагнетательные линии. Зелёный: датчики СКЦ. Серый пунктир: резервная обвязка.',15);
 out+=text(24,height-34,'Схема условная, без масштаба. Фактические проезды, расстояния и обвязку согласовать на площадке.',14,RESERVE);
 return out+'</svg>';
}
