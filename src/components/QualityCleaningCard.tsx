import {useState} from 'react';
import {Card} from './ui/card';
import {Button} from './ui/button';
import {buildProcessContract} from '@/lib/cementing-process';
import {CLEANING_NOTE,type HighQualityScenario} from '@/lib/optimizer-cleaning';
const n=(v:number)=>Number.isFinite(v)?v.toFixed(2):'—';
export default function QualityCleaningCard({value:v,disabled,onApply}:{value:HighQualityScenario;disabled:boolean;onApply:()=>void}){
 const [applied,setApplied]=useState(false),d=v.design,t=v.target;
 return <Card className="p-4 space-y-3" data-testid="quality-cleaning-plan">
  <h3 className="font-semibold">Высокое качество · двухступенчатая очистка</h3>
  <p className={v.ready?'text-green-700':'text-amber-700'} role="status">{v.ready?'Сценарий прошёл расчётные проверки; 85% подтверждены только в лаборатории':'Сценарий не подтверждён — применение заблокировано'}</p>
  {t&&<p className="text-sm">Пласты: {t.layers.join(', ')}. Зона MD {n(t.topMD)}–{n(t.bottomMD)} м; TVD {n(t.topTVD)}–{n(t.bottomTVD)} м. Расширение вверх {n(t.aboveActualM)} м TVD. Объём затрубья {n(t.volumeM3)} м³.</p>}
  {d&&<div className="overflow-x-auto"><table className="text-xs w-full"><thead><tr><th>Проход целевого интервала</th><th>Объём</th><th>Расход</th><th>Контакт по кадрам, не менее</th></tr></thead><tbody>
   <tr><td className="p-2">{d.chemicalName} · химический</td><td>{n(d.chemicalVolumeM3)} м³</td><td>10 л/с · проверка ламинарности</td><td>{n(d.chemicalContactMin)} мин</td></tr>
   <tr><td className="p-2">{d.heavyName} · тяжёлый</td><td>{n(d.heavyVolumeM3)} м³</td><td>{n(d.heavyRateLps)} л/с · переходный/турбулентный</td><td>{n(d.heavyHighContactMin)} мин при повышенной подаче</td></tr>
  </tbody></table></div>}
  {d?.proof&&<p className="text-xs">Измеренное смытие {d.proof.removalPct}%: {d.proof.source} [{d.proof.id}], {d.proof.exposureS} с, {d.proof.criticalPa} Па, {d.proof.temperatureC} °C / {d.proof.pressureMPaAbs} МПа абс. Дозировки сохранены как в испытанном составе.</p>}
  {d&&!d.proof&&<p className="text-xs text-amber-700">Цель 85% не рассчитана и не подтверждена: требуется протокол вымываемости для выбранного состава.</p>}
  {v.program&&<p className="text-xs">Центраторы: {v.centralization?.totalCount} шт.; целевой отступ 85%. Турбулизаторы: {v.program.wellData.turbulatorDesign?.points.length??0} шт.; геометрия текущего изделия, шаг не больше трубы и расчётной L90. Местные потери включены в гидравлику.</p>}
  {v.evaluation&&<p className="text-xs">Запас до ГРП/поглощения {n(v.evaluation.minMarginMPa)} МПа; устье до {n(v.evaluation.maxSurfaceMPa)} МПа; продолжительность {n(v.evaluation.jobTimeMin)} мин.</p>}
  {v.issues.length>0&&<ul className="text-xs list-disc pl-5 text-amber-700">{v.issues.map(x=><li key={x}>{x}</li>)}</ul>}
  {v.warnings.filter(x=>x!==CLEANING_NOTE).map(x=><p className="text-xs text-amber-700" key={x}>{x}</p>)}
  <p className="text-xs text-muted-foreground">{CLEANING_NOTE}</p>
  {v.program&&<details><summary>Рецептуры и единый график подачи</summary><div className="p-3 space-y-3">
   {v.program.buffers.map((b,i)=><p className="text-xs" key={i}>{b.name}: {b.density} кг/м³; PV {b.rheology.pv} сПз; ДНС {b.rheology.yp} Па. {b.additives.map(a=>a.name+': '+a.percentage+'% '+a.percentageType).join('; ')||'Добавки не заданы'}</p>)}
   <p className="text-xs">Повышение подачи после {n(d!.switchVolumeM3)} м³ закачки в скважину — когда хвост химбуфера прошёл кровлю целевой зоны. Окончание повышенной подачи после {n(d!.heavyEndVolumeM3)} м³. Материал на устье в этот момент может быть уже другим.</p>
   <div className="overflow-x-auto"><table className="text-xs w-full"><thead><tr><th>Жидкость на устье</th><th>Объём, м³</th><th>Расход, л/с</th><th>Начало, мин</th></tr></thead><tbody>{buildProcessContract(v.program).stages.map(s=><tr key={s.id}><td className="p-1">{s.name}</td><td>{n(s.volumeM3)}</td><td>{n(s.rateLps)}</td><td>{s.startMin===null?'—':n(s.startMin)}</td></tr>)}</tbody></table></div>
  </div></details>}
  <Button disabled={disabled||!v.ready} onClick={()=>{onApply();setApplied(true);}}>{applied?'Применено':'Применить высокое качество'}</Button>
 </Card>;
}
