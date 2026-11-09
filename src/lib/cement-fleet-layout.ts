import type { LogisticsResult,LogisticsSettings } from './cement-logistics';
const esc=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
/** Top view of equipment GROUPS. Quantities are actual selections, not hidden recommended counts. */
export function cementFleetLayout(r:LogisticsResult,s:LogisticsSettings):string {
 const integrated=r.scheme==='single'||r.scheme==='twin',separate=r.mixers>0;
 const rows=(id:string)=>r.equipment.find(e=>e.id===id);
 const text=(x:number,y:number,str:string,size=15,color='#1e293b')=>`<text x="${x}" y="${y}" font-family="Arial,sans-serif" font-size="${size}" fill="${color}">${esc(str)}</text>`;
 const truck=(x:number,y:number,color:string,bulk=false)=>`<g transform="translate(${x} ${y})"><rect x="0" y="0" width="44" height="58" rx="7" fill="${color}" stroke="#334155"/><rect x="7" y="7" width="30" height="12" fill="#dbeafe"/><path d="M8 60H36" stroke="#334155" stroke-width="5"/><rect x="2" y="66" width="40" height="${bulk?96:80}" rx="${bulk?18:4}" fill="${bulk?'#f1e6cf':color}" stroke="#334155"/><path d="M-3 24v18 M47 24v18 M-3 90v27 M47 90v27" stroke="#334155" stroke-width="5"/></g>`;
 const card=(id:string,x:number,y:number,w:number,h:number,title:string,color:string,bulk=false)=>{const row=rows(id);return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="#fff" stroke="#94a3b8" ${row?.count===0?'stroke-dasharray="6 4"':''}/>${text(x+12,y+24,title,15)}${text(x+12,y+45,`${row?.count??0} ед.`,18,color)}${truck(x+w-64,y+40,color,bulk)}${text(x+12,y+72,bulk?'Тягач + полуприцеп':integrated&&id==='main'?'Миксер на борту':'Отдельная единица',12)}${text(x+12,y+94,bulk?'1 водитель-оператор':id==='skc'?'Бортовой автомобиль':'',12)}</g>`;};
 const arrow=(d:string,color:string,dash='')=>`<path d="${d}" fill="none" stroke="${color}" stroke-width="4" ${dash?'stroke-dasharray="'+dash+'"':''} marker-end="url(#${color.replace('#','a')})"/>`;
 const blue='#0284c7',red='#dc2626',dry='#a16207',green='#15803d',grey='#64748b';
 let out=`<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="900" viewBox="0 0 1120 900" style="width:100%;height:auto;background:white" role="img" aria-label="Схема расстановки цементировочной техники, вид сверху"><rect width="1120" height="900" fill="white"/><defs>`;
 for(const c of [blue,red,dry,green,grey])out+=`<marker id="${c.replace('#','a')}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8Z" fill="${c}"/></marker>`;
 out+=`</defs><rect x="12" y="40" width="1095" height="745" rx="18" fill="#f8fafc" stroke="#cbd5e1" stroke-dasharray="7 5"/>${text(28,27,'Расстановка оборудования: вид сверху, группы машин',19)}${text(28,75,`В парке ${r.totalVehicles} транспортных единиц; персонал ${r.totalPeople} чел.`,14)}`;
 out+=`<rect x="720" y="90" width="350" height="155" rx="12" fill="#f1f5f9" stroke="#475569"/><path d="M770 207L804 108L838 207Z M782 170H826 M792 139H816" fill="none" stroke="#475569" stroke-width="4"/><circle cx="957" cy="170" r="30" fill="white" stroke="#0f172a" stroke-width="4"/><circle cx="957" cy="170" r="10" fill="#0f172a"/>${text(740,231,'Буровая / скважина. Устье',16)}`;
 out+=`<rect x="330" y="100" width="310" height="100" rx="12" fill="#e0f2fe" stroke="${blue}"/>${text(348,130,s.waterSource==='tankers'?'Вода из автоцистерн':'Вода с буровой',17,blue)}${text(348,158,`Потребность: ${r.waterM3.toFixed(1)} м³`,14)}${text(348,183,s.waterSource==='tankers'?`Автоцистерн: ${r.tankers}`:'От точки водоснабжения буровой',12)}`;
 if(r.bulkTrucks>0)out+=card('bulk',30,280,270,230,'Цементовозы ЦТ-25',dry,true);
 else out+=`<rect x="30" y="300" width="250" height="100" fill="#fff7ed" stroke="${dry}"/>${text(44,330,'Подача сухого цемента',15,dry)}${text(44,358,r.scheme==='classic'?'Бункеры смесительных машин':'Автопоезда не выбраны',12)}`;
 out+=card('main',350,285,320,220,integrated?(r.scheme==='twin'?'Двухнасосный агрегат':'Однонасосный агрегат'):'Рабочие ЦА','#2563eb');
 if(separate)out+=card('mixer',350,545,320,205,'Отдельные смесители','#7c3aed');
 else out+=`<rect x="350" y="570" width="320" height="90" rx="12" fill="#eef2ff" stroke="#a5b4fc"/>${text(367,600,integrated?'Встроенный миксер':'Смеситель не выбран',16)}${text(367,625,integrated?'Отдельная машина не требуется':'Проверьте производительность смешивания',13)}`;
 if(integrated&&r.supportUnits>0)out+=card('support-ca',750,295,320,200,'Дополнительные рабочие ЦА','#ea580c');
 if(r.reserveCA>0)out+=card('reserve-ca',750,545,320,205,'Резервные ЦА',grey);
 out+=card('skc',30,545,270,205,'СКЦ - отдельная машина',green);
 out+=arrow('M720 130H640',blue);
 // Low-pressure water enters the mixer. Dry feed and slurry are separate routes.
 const mixerY=separate?565:325;
 out+=arrow(`M480 200V250H320V${mixerY+30}H350`,blue);
 out+=arrow(separate?'M280 410H320V680H350':'M280 410H350',dry);
 if(separate)out+=arrow('M510 545V505',red);
 out+=arrow('M670 365H700V265H957V204',red);
 out+=`<rect x="682" y="250" width="28" height="28" fill="#fee2e2" stroke="${red}"/>${text(723,278,'Манифольд',13,red)}`;
 if(r.supportUnits>0&&integrated)out+=arrow('M914 295V265H957V204',red);
 if(r.reserveCA>0)out+=arrow('M910 545V515H705V283',grey,'6 5');
 out+=arrow('M300 690H325V755H1090V170H990',green,'3 7');
 out+=text(366,520,'Раствор под давлением - к устью',13,red);
 out+=text(750,535,'Резерв: подключение после переключения',12,grey);
 out+=text(42,820,'Синий: вода. Коричневый: сухой материал. Красный: цементный раствор.',14);
 out+=text(42,845,'Зелёный пунктир: связь СКЦ. Серый пунктир: резервная обвязка.',14);
 out+=text(42,875,'Схема условная, без масштаба. Проезды, расстояния и фактическую обвязку согласовать на площадке.',13,grey);
 return out+'</svg>';
}
