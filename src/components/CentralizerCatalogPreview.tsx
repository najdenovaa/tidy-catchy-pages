import { useState } from 'react';
import type { WellData } from '@/lib/cementing-calculations';
import type { CentralizerSpec } from '@/lib/centralization-calculations';
import { interpolateTrajectory } from '@/lib/centralization-calculations';
import { trajectoryAzimuth } from '@/lib/centralizer-mesh';
import Centralizer3DInspector from './Centralizer3DInspector';

export default function CentralizerCatalogPreview({spec,wellData,fromMD=0,toMD}: {spec:CentralizerSpec;wellData:WellData;fromMD?:number;toMD:number}) {
 const [show,setShow]=useState(false),[position,setPosition]=useState(50);
 const md=Math.max(0,Math.min(wellData.casingDepthMD,fromMD+(toMD-fromMD)*position/100));
 const {tvd,zenith}=interpolateTrajectory(wellData.trajectory,md);
 const cased=md<=(wellData.prevCasingDepth||0)&&wellData.prevCasingID>0;
 return <div className="space-y-3">
  <button type="button" className="text-sm underline" onClick={()=>setShow(!show)}>{show?'Скрыть':'Показать'} геометрию изделия из справочника</button>
  {show&&<><p role="status" className="text-sm text-amber-500">Предпросмотр размеров: оси трубы и ствола совмещены условно. Положение, зазоры и сжатие в этом режиме - геометрический сценарий при эксцентриситете 0, а не результат силового расчёта. Основная кнопка расчёта определяет оценочное положение по нагрузке; недостающие параметры показаны как допущения.</p><label className="text-xs">Глубина для ракурса по траектории: {md.toFixed(1)} м MD<input aria-label="Глубина каталожного просмотра" type="range" min="0" max="100" value={position} onChange={e=>setPosition(+e.target.value)} className="w-full"/></label><Centralizer3DInspector spec={spec} casingOD={wellData.casingOD} casingID={wellData.casingOD-2*wellData.casingWall} boreDiameter={cased?wellData.prevCasingID:wellData.holeDiameter} cased={cased} azimuth={trajectoryAzimuth(wellData.trajectory,md)} result={{md,tvd,zenith,eccentricity:0,standoff:100,hasCentralizer:true,hasTurbulizer:false,turbulenceMultiplier:1,intervalId:null}}/></>}
 </div>;
}
