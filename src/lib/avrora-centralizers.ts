import type { CentralizerSpec } from './centralization-calculations';
/** Transcribed from user-supplied catalogue screenshots. Ranges are not mapped to arbitrary exact dimensions. */
const rows200: {casing:number;inner:number;outer:number[];length?:number;lengthRange?:string;width?:number;widthRange?:string;blades:number}[] = [
 {casing:102,inner:104,outer:[120,122,124,125,126],length:400,width:30,blades:6},
 {casing:114,inner:117,outer:[138,143,152,156,165],lengthRange:'160-320 (края записи обрезаны; подтвердить)',widthRange:'32-38',blades:6},
 {casing:127,inner:129,outer:[152,155,156,165],length:320,widthRange:'33-40',blades:6},
 {casing:140,inner:143,outer:[216,221],lengthRange:'500-545 (края записи обрезаны; подтвердить)',widthRange:'36-40',blades:6},
 {casing:146,inner:149,outer:[146,221],length:455,widthRange:'36-40',blades:6},
 {casing:168,inner:171,outer:[216,220],length:365,widthRange:'36-40',blades:6},
 {casing:178,inner:181,outer:[216,221],length:365,widthRange:'36-40',blades:6},
 {casing:194,inner:197,outer:[220],length:460,width:50,blades:8},
 {casing:245,inner:248,outer:[295,311],lengthRange:'395-450 (края записи обрезаны; подтвердить)',widthRange:'50-54',blades:8},
 {casing:273,inner:278,outer:[311,317,343],length:440,width:55,blades:8},
 {casing:324,inner:329,outer:[394],length:550,width:50,blades:10},
 {casing:340,inner:345,outer:[394,406,445],length:550,widthRange:'50-56',blades:10},
 {casing:426,inner:432,outer:[490,508],length:550,widthRange:'52-54',blades:10},
 {casing:473,inner:480,outer:[584],length:560,width:56,blades:10},
];
const rows205 = [
 {casing:146,bore:216,inner:149,outer:254,length:620,blades:6,width:40,springLength:500},
 {casing:168,bore:220,inner:171,outer:254,length:680,blades:6,width:46,springLength:550},
 {casing:178,bore:220.7,inner:181,outer:240,length:520,blades:6,width:38,springLength:400},
 {casing:508,bore:660,inner:515,outer:675,length:625,blades:10,width:58,springLength:505},
 {casing:508,bore:660,inner:515,outer:685,length:620,blades:10,width:63,springLength:490},
];
export const avroraCentralizers: {id:string;spec:CentralizerSpec}[] = [
 ...rows200.flatMap(row=>row.outer.map(outer=>({id:`avrora200-${row.casing}-${outer}`,spec:{
  type:'spring' as const,bladesCount:row.blades,bladeHeight:Math.max(0,(outer-row.casing)/2),restoringForce:0,maxAxialLoad:0,
  passport:{manufacturer:"ООО «Аврора»",sourceUrl:"https://gk-avrora.ru/catalog/",model:`AVRORA 200 · ОК ${row.casing} · OD ${outer}`,source:'Предоставленная таблица AVRORA 200 (IMG_2755)',casingOD:row.casing,innerDiameter:row.inner,outerDiameter:outer,length:row.length,bladeWidth:row.width,lengthRange:row.lengthRange,bladeWidthRange:row.widthRange,
   note:`Цельный полужёсткий центратор. Наружный диаметр указан как максимальный; ID с допуском +2 мм; длина - не более указанного значения. Размеры не связаны с конкретными исполнениями внутри диапазона: уточнить по паспорту поставки. Усилия и степень центрирования испытания отсутствуют; для оценочного расчёта используются явно показанные модельные допущения.${outer<=row.inner?' В источнике OD меньше ID: вариант требует уточнения изготовителя.':''}`,
  }
 }}))),
 ...rows205.map(row=>({id:`avrora205-${row.casing}-${row.outer}`,spec:{
  type:'spring' as const,bladesCount:row.blades,bladeHeight:(row.outer-row.casing)/2,restoringForce:0,maxAxialLoad:0,
  passport:{manufacturer:"ООО «Аврора»",sourceUrl:"https://gk-avrora.ru/catalog/",model:`AVRORA 205 · ОК ${row.casing} · OD ${row.outer}`,source:'Предоставленная таблица AVRORA 205 (IMG_2756)',casingOD:row.casing,boreDiameter:row.bore,innerDiameter:row.inner,outerDiameter:row.outer,length:row.length,bladeWidth:row.width,springLength:row.springLength,
   note:'Цельный пружинный центратор. Допуски: ID и OD +2 мм, длина изделия ±5 мм, ширина рессоры ±2 мм, длина рессоры ±5 мм. Два исполнения для ОК 508 мм сохранены отдельно. OD колец, толщина, материал и силовая характеристика не указаны. Восстанавливающее усилие и степень центрирования испытания необходимо внести по паспорту или протоколу испытаний.',
  }
 }})),
];
