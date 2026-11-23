import {rheologyResolution} from './cement-rheology';
import type {BufferFluid,DrillingFluid} from './cementing-calculations';
export type MudBase='water'|'oil'|'synthetic';
export type WashFamily='water'|'nonaqueous';
export interface ChemicalRecipeRecord {version:1;id:string;family:WashFamily;waterSource?:string;propertySource?:string;propertySignature?:string}
export interface WashComponent {id:string;name:string;function:string;sourceUrl:string;startPct:number;screeningRange:[number,number];note:string}
export interface WashRecipe {id:string;name:string;family:WashFamily;purpose:string;components:{id:string;pct:number}[];note:string}
export const WASH_RECIPE_NOTE='Стартовые массовые дозировки поставляемых продуктов для лабораторного скрининга, не опубликованная готовая рецептура и не гарантия 85% смытия. Активность, изготовитель, партия, совместимость, температура, минерализация и пенообразование проверяются на фактических материалах. Шаблон не рассчитывает плотность и реологию.';
export const WASH_COMPONENTS:readonly WashComponent[]=[
 {id:'wash-alcohol-ethoxylate',name:'Неионогенный ПАВ C12–C14 — этоксилат спирта',function:'Смачивание и удаление плёнки',sourceUrl:'https://www.mdpi.com/1996-1073/14/16/5187',startPct:.5,screeningRange:[.25,1],note:'Выбирать подходящую марку по активности, фазовому поведению и пенообразованию. Сходное название не означает одинаковый продукт.'},
 {id:'wash-mes',name:'MES — метилэфирсульфонат натрия',function:'Анионный ПАВ для очистки и изменения смачиваемости',sourceUrl:'https://doi.org/10.1016/j.engeos.2021.11.002',startPct:.05,screeningRange:[.025,.1],note:'В статье получены разные результаты на конкретных образцах. Они не присваиваются новой смеси. Массовая доза здесь — старт нашего скрининга, не пересчёт 0,20 г без полной базы опыта.'},
 {id:'wash-dpm',name:'DPM — монометиловый эфир дипропиленгликоля',function:'Взаимный растворитель / сорастворитель',sourceUrl:'https://www.dow.com/documents/327/327-00001-01-dow-oxygenated-solvents-selection-guide.pdf',startPct:2,screeningRange:[1,3],note:'Роль взаимных растворителей описана в AADE-2009-NTCE-06-01. DPM — конкретный кандидат для испытания, не тождественен фирменной мезофазной добавке.'},
 {id:'wash-sapp',name:'SAPP — кислый пирофосфат натрия',function:'Диспергирование глинистого БР',sourceUrl:'https://www.swpshortcourse.org/ppdl/369',startPct:.5,screeningRange:[.25,1],note:'Не универсальный разрушитель полимеров. В исходном исследовании отдельный SAPP уступал готовой промывке. Обязательно проверить влияние на цемент и совместимость.'},
];
export const WASH_RECIPES:readonly WashRecipe[]=[
 {id:'wbm-wetting',name:'Водный БР · смачивание',family:'water',purpose:'Исходная моющая пачка для сравнения',components:[{id:'wash-alcohol-ethoxylate',pct:.5}],note:'Контроль относительно воды и фактического БР.'},
 {id:'wbm-clay',name:'Водный БР · ПАВ + диспергатор',family:'water',purpose:'Смачивание и диспергирование глинистых остатков',components:[{id:'wash-alcohol-ethoxylate',pct:.5},{id:'wash-sapp',pct:.5}],note:'Для глинистой системы; разрушение конкретного полимера не предполагается автоматически.'},
 {id:'obm-mes-solvent',name:'РУО/синтетика · MES + ПАВ + DPM',family:'nonaqueous',purpose:'Кандидат для удаления нефтяной плёнки и перевода в водосмачиваемое состояние',components:[{id:'wash-mes',pct:.05},{id:'wash-alcohol-ethoxylate',pct:.5},{id:'wash-dpm',pct:2}],note:'Проверить инверсию эмульсии, смачиваемость и смеси с БР/цементом. Это предлагаемая комбинация для испытаний, не воспроизведение фирменного микроэмульсионного состава.'},
 {id:'obm-nonionic-solvent',name:'РУО/синтетика · неионогенный ПАВ + DPM',family:'nonaqueous',purpose:'Сравнение с вариантом без MES',components:[{id:'wash-alcohol-ethoxylate',pct:1},{id:'wash-dpm',pct:2}],note:'Сравнивается при тех же T/P, контакте и сдвиге; большая доза не считается лучшим результатом.'},
 {id:'obm-mes-reference',name:'РУО/синтетика · MES для сравнения',family:'nonaqueous',purpose:'Отдельно оценить действие MES на вашем БР',components:[{id:'wash-mes',pct:.05}],note:'Не переносить литературный процент очистки на этот состав.'},
];
export const washComponent=(id:string)=>WASH_COMPONENTS.find(x=>x.id===id);
/** Editable planning assumptions, never laboratory measurements or predicted chemistry properties. */
export function defaultChemicalProperties(mud?:DrillingFluid){return {density:1100,rheology:{pv:20,yp:5,model:'pvyp' as const,testTemperatureC:mud?.rheology.testTemperatureC??40,testPressureMPaAbs:mud?.rheology.testPressureMPaAbs??.101325}};}
export function bufferPlanningDefaults(b:BufferFluid):BufferFluid{
 const r=b.rheology,empty=(!Number.isFinite(r.pv)||r.pv<=0)&&(!Number.isFinite(r.yp)||r.yp<=0)&&!r.fann&&(!r.model||r.model==='pvyp');
 const density=Number.isFinite(b.density)&&b.density>0?b.density:1100;
 if(!empty&&density===b.density)return b;
 return {...b,density,...(empty?{rheology:defaultChemicalProperties().rheology}:{})};
}
export function washFamily(base:DrillingFluid['base']):WashFamily|undefined{return base==='water'?'water':base==='oil'||base==='synthetic'?'nonaqueous':undefined;}
export function normalizeChemicalRecipeRecord(v:unknown):ChemicalRecipeRecord|undefined{
 if(!v||typeof v!=='object')return;
 const x=v as ChemicalRecipeRecord,r=WASH_RECIPES.find(r=>r.id===x.id);
 if(x.version!==1||!r||x.family!==r.family)return;
 return {version:1,id:r.id,family:r.family,...(typeof x.waterSource==='string'?{waterSource:x.waterSource.slice(0,2000)}:{}),...(typeof x.propertySource==='string'?{propertySource:x.propertySource.slice(0,2000)}:{}),...(typeof x.propertySignature==='string'&&x.propertySignature.length<100000?{propertySignature:x.propertySignature}:{})};
}
const stable=(v:unknown)=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
export function chemicalPropertySignature(b:BufferFluid){return stable([b.chemicalRecipe?.id,b.chemicalRecipe?.family,b.chemicalRecipe?.waterSource,b.name,b.density,b.rheology,b.additives]);}
export function chemicalRecipeIssue(b:BufferFluid,mud:DrillingFluid){
 if(!b.chemicalRecipe)return null;
 const record=normalizeChemicalRecipeRecord(b.chemicalRecipe);
 if(!record)return 'Некорректная привязка химической рецептуры.';
 if(!washFamily(mud.base))return 'Укажите основу бурового раствора для подбора химии.';
 if(record.family!==washFamily(mud.base))return 'Рецептура предназначена для другой основы БР.';
 if(!record.waterSource?.trim())return 'Укажите воду/рассол и минерализацию, на которых испытывается рецептура.';
 if(!rheologyResolution(b.rheology).valid)return 'Для новой рецептуры нужны корректные измеренные параметры выбранной модели реологии.';
 if(!(b.density>0&&b.rheology.pv>=0&&b.rheology.yp>=0&&(b.rheology.pv>0||b.rheology.yp>0||b.rheology.fann)))return 'Нужны измеренные плотность и реология новой рецептуры.';
 if(!Number.isFinite(b.rheology.testTemperatureC)||!Number.isFinite(b.rheology.testPressureMPaAbs)||b.rheology.testTemperatureC!<=-273.15||b.rheology.testPressureMPaAbs!<=0)return 'Укажите корректные T/P измерений новой рецептуры.';
 if(!record.propertySource?.trim()||record.propertySignature!==chemicalPropertySignature(b))return 'Подтвердите измеренные плотность и реологию этой рецептуры; свойства предыдущего буфера не переносятся.';
 return null;
}
export function confirmChemicalProperties(b:BufferFluid,source:string):BufferFluid{
 if(!b.chemicalRecipe||!source.trim())throw Error('Укажите протокол измерений плотности и реологии.');
 if(!b.chemicalRecipe.waterSource?.trim())throw Error('Укажите воду/рассол и минерализацию испытанной рецептуры.');
 const r=b.rheology;
 if(!rheologyResolution(r).valid)throw Error(rheologyResolution(r).error);
 if(!(b.density>0)||![r.pv,r.yp].every(x=>Number.isFinite(x)&&x>=0)||!(r.pv>0||r.yp>0||r.fann)||!Number.isFinite(r.testTemperatureC)||!Number.isFinite(r.testPressureMPaAbs)||r.testTemperatureC!<=-273.15||r.testPressureMPaAbs!<=0)throw Error('Введите плотность, реологию и корректные T/P испытания в карточке буфера.');
 return {...b,chemicalRecipe:{...b.chemicalRecipe,propertySource:source.trim().slice(0,2000),propertySignature:chemicalPropertySignature(b)}};
}
export function recipeBatch(recipe:WashRecipe,doses:Record<string,number>,massKg:number){
 if(!(Number.isFinite(massKg)&&massKg>0))throw Error('Масса партии должна быть положительной.');
 const rows=recipe.components.map(x=>{const c=washComponent(x.id)!;const pct=doses[x.id]??x.pct;if(!Number.isFinite(pct)||pct<=0||pct>=100)throw Error('Дозировки компонентов должны быть больше 0 и меньше 100% массы буфера.');return {...c,pct,massKg:massKg*pct/100};});
 const sum=rows.reduce((n,x)=>n+x.pct,0);if(sum>=100)throw Error('Сумма добавок должна быть меньше 100%; основа — остаток до массы партии.');
 return {rows,baseMassKg:massKg*(1-sum/100),massKg};
}
export function applyChemicalRecipe(target:BufferFluid,recipe:WashRecipe,doses:Record<string,number>,mud:DrillingFluid):BufferFluid{
 if(recipe.family!==washFamily(mud.base))throw Error('Сначала выберите основу БР и соответствующую ей рецептуру.');
 const batch=recipeBatch(recipe,doses,1000);
 return {...target,name:'Химбуфер · '+recipe.name,bufferType:'chemical_wash',libraryReference:undefined,
  // A new composition receives planning defaults, without carrying over previous measurements.
  density:target.density>0?target.density:1100,rheology:defaultChemicalProperties(mud).rheology,chemicalRecipe:{version:1,id:recipe.id,family:recipe.family,waterSource:''},
  additives:batch.rows.map(x=>({productId:x.id,name:x.name,sourceUrl:x.sourceUrl,technicalSpec:'Класс компонента; марку, активность и партию уточнить',percentage:x.pct,percentageType:'bwob',massKg:0})),
 };
}
