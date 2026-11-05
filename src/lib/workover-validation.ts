import type { WorkoverWellData } from './workover-calculations';

/** Input validation only: no clamping of impossible geometry into a valid calculation. */
export function validateWorkoverPart(part: string, value: unknown, well?: WorkoverWellData): string[] {
  const errors: string[] = [];
  const add = (ok: boolean, message: string) => { if (!ok) errors.push(message); };
  if (typeof value === 'number') return Number.isFinite(value) && (part === 'brineTempC' || value >= 0) ? [] : ['Введите конечное допустимое число'];
  if (!value || typeof value !== 'object') return [];
  if(part==='selectedOperations') return Array.isArray(value) && value.every(op=>['kill','packer','drag','stuck','fishing','cleanout','casing','rig'].includes(op)) && new Set(value).size===value.length ? [] : ['Некорректный список операций'];
  if (Array.isArray(value)) return value.flatMap(v => validateWorkoverPart('interval', v, well));
  const v = value as Record<string, unknown>;
  const n = (key: string) => Number(v[key]);
  const required:Record<string,string[]>={
    well:['wellDepthMD','casingID_mm','pipeOD_mm','pipeID_mm','pipeWeight_kgm','pipeYieldMPa','pipeYoungModulusGPa','fluidDensity_gcm3','fluidPV_cP','fluidYP_Pa'],
    kill:['formationPressureMPa','reservoirDepthTVD','fracturePressureMPa','currentMudDensity','wellDepthMD','casingID_mm','tubingOD_mm','tubingID_mm','killFluidPV_cP','killFluidYP_Pa','pumpRateLs','safetyMarginPct'],
    cleanout:['plugTopMD','plugBottomMD','rateLs','grainDiameter_mm','feedRate_mh','plugPorosity'],
    casing:['casingOD_mm','casingWall_mm','casingYieldMPa','wearPct','bottomMD','testPressureMPa','insideDensity','outsideDensity','levelMD','sfBurst','sfCollapse'],
  };
  for(const key of required[part]??[]) add(typeof v[key]==='number' && Number.isFinite(v[key]),`${key}: обязательное числовое поле`);

  for (const [key, val] of Object.entries(v)) {
    if (typeof val === 'number') {
      add(Number.isFinite(val), `${key}: требуется конечное число`);
      if (!['avgTempChangeC', 'temperatureC'].includes(key)) add(val >= 0, `${key}: отрицательное значение недопустимо`);
    }
  }
  const positive = ['wellDepthMD','casingID_mm','pipeOD_mm','pipeID_mm','pipeWeight_kgm','pipeYieldMPa','pipeYoungModulusGPa','fluidDensity_gcm3','holeDiameter_mm','rigCapacityKN','derrickCapacityKN','setDepthMD','sealBoreID_mm','ratingDiffMPa','ratingLoadKN','tubingFluidDensity0','annulusFluidDensity','tubingFluidDensity1','formationPressureMPa','reservoirDepthTVD','fracturePressureMPa','currentMudDensity','tubingOD_mm','tubingID_mm','pulledForceKN','measuredStretchM','fishTopMD','fishOD_mm','externalBodyWall_mm','grainDiameter_mm','feedRate_mh','rateLs','reservoirMD','reservoirPressureMPa','fluidDensity','swabSubmergenceM','swabSpeedMs','casingOD_mm','casingWall_mm','casingYieldMPa','bottomMD','insideDensity','outsideDensity'];
  for (const k of positive) if (k in v) add(n(k) > 0 || (part==='interval' && k==='fracturePressureMPa' && n(k)===0), `${k}: значение должно быть больше нуля`);
  const ranges: Record<string,[number,number]> = {
    plugPorosity:[0,0.99], porosityPct:[0,100], wearPct:[0,90], pipeConditionPct:[1,100],
    swabEfficiency:[0.01,1], frictionCoeff:[0,1], baseFrictionCoeff:[0,1], lubricatedFrictionCoeff:[0,1], mudcakeFriction:[0,1],
    penetrationIndex:[1,10], concentration:[0,100], safetyFactor:[1,100], sfBurst:[1,100], sfCollapse:[1,100],
  };
  for (const [k,[lo,hi]] of Object.entries(ranges)) if (k in v) add(n(k)>=lo && n(k)<=hi, `${k}: допустимый диапазон ${lo}...${hi}`);
  for (const [top,bottom] of [['plugTopMD','plugBottomMD'],['perfTopMD','perfBottomMD'],['topMD','bottomMD'],['topTVD','bottomTVD']]) {
    if (top in v && bottom in v) add(n(bottom)>=n(top), 'Подошва интервала не может быть выше кровли');
  }
  if ('pipeOD_mm' in v) add(n('casingID_mm')>n('pipeOD_mm') && n('pipeOD_mm')>n('pipeID_mm'), 'Требуется ID колонны > OD НКТ > ID НКТ > 0');
  if ('tubingOD_mm' in v) add(n('casingID_mm')>n('tubingOD_mm') && n('tubingOD_mm')>n('tubingID_mm'), 'Проверьте диаметры колонны и НКТ');
  if ('casingWall_mm' in v) add(n('casingOD_mm')>2*n('casingWall_mm'), 'Стенка должна быть меньше половины наружного диаметра');
  if ('fishID_mm' in v) add(n('fishID_mm')<n('fishOD_mm'), 'ID рыбы должен быть меньше OD');
  if (n('collarLengthM')>0) add(n('collarOD_mm')>n('collarID_mm') && n('collarID_mm')>0, 'Проверьте диаметры УБТ');
  if(part==='cleanout') add(n('plugBottomMD')>n('plugTopMD'),'Подошва пробки должна быть ниже кровли');
  if(part==='interval') add(n('bottomMD')>n('topMD'),'Интервал должен иметь положительную длину');
  if(part==='well') add(n('wellDepthMD')<=30000,'Глубина вне области модели: максимум 30 000 м');
  if(part==='casing' && well) add(n('casingOD_mm')-2*n('casingWall_mm')>well.pipeOD_mm,'НКТ не проходят во внутренний диаметр колонны');
  if (part === 'kill') {
    add(['driller','wait_weight','volumetric','bullhead'].includes(String(v.method)), 'Неизвестный метод глушения');
    add(n('reservoirDepthTVD')<=n('wellDepthMD'), 'TVD пласта не может превышать MD скважины');
    add(n('pumpRateLs')>0 || v.method==='volumetric', 'Для циркуляции требуется положительный расход');
  }
  if (well) {
    for (const [k,val] of Object.entries(v)) if (k.endsWith('MD') && typeof val==='number') add(val<=well.wellDepthMD, `${k}: глубина больше забоя`);
  }
  if (part==='well') {
    const trajectory = v.trajectory;
    add(Array.isArray(trajectory) && trajectory.length>=2,'Нужны минимум две точки траектории');
    if (Array.isArray(trajectory)) trajectory.forEach((p,i)=>{
      add([p.md,p.tvd,p.zenith,p.azimuth].every(Number.isFinite),'Траектория содержит некорректные числа');
      add(p.md>=0 && p.tvd>=0 && p.tvd<=p.md+0.01 && p.zenith>=0 && p.zenith<=90 && p.azimuth>=0 && p.azimuth<=360,'Проверьте глубины и углы траектории (поддерживается зенит 0...90°)');
      if(i) add(p.md>trajectory[i-1].md,'Глубины траектории должны строго возрастать');
    });
  }
  const labels:Record<string,string>={plugPorosity:'Пористость пробки',swabEfficiency:'Коэффициент подачи сваба',wearPct:'Износ стенки',pipeConditionPct:'Остаточная прочность',rateLs:'Расход',feedRate_mh:'Скорость размыва',grainDiameter_mm:'Диаметр песка',wellDepthMD:'Глубина скважины',casingID_mm:'ID колонны',pipeOD_mm:'OD НКТ',pipeID_mm:'ID НКТ',reservoirMD:'MD пласта',setDepthMD:'Глубина пакера',stuckDepthMD:'Глубина прихвата',fishTopMD:'Голова рыбы',bottomMD:'Низ интервала',plugTopMD:'Кровля пробки',plugBottomMD:'Подошва пробки',formationPressureMPa:'Пластовое давление',fracturePressureMPa:'Давление ГРП',safetyFactor:'Коэффициент запаса',sfBurst:'Запас на разрыв',sfCollapse:'Запас на смятие'};
  return [...new Set(errors)].map(e=>e.replace(/^([^:]+):/,(_,k)=>`${labels[k]??k}:`));
}
