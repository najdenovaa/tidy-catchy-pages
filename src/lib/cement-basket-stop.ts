/** Sensitivity study of post-stop load transfer. A permeable basket is not a packer.
 * No basket credit is applied to the primary hydraulic/safety calculation. */
import { getEffectiveTrajectory, interpolateTVD, type WellData } from './cementing-calculations';
export interface StopColumnSegment { top: number; bot: number; rho: number; fluidType?: string }
export interface BasketStopRow { md: number; tvd: number; withoutMPa: number; scenarioMPa: number; reductionMPa: number; poreMPa: number | null; limitMPa: number | null }
export interface BasketLoad { id: string; model: string; md: number; transferPct: number; potentialMPa: number; transferredMPa: number; reactionKN: number; capacityKN?: number; limited: boolean; notes: string[] }
export interface BasketStopResult { elapsedMin: number; rows: BasketStopRow[]; baskets: BasketLoad[]; notes: string[] }
const g = .00981;
export function evaluateBasketStop(w: WellData, column: StopColumnSegment[], fractureGradientKPaM: number): BasketStopResult {
  const traj = getEffectiveTrajectory(w), tvd = (md: number) => interpolateTVD(md, traj);
  const elapsedMin = Math.max(0, w.basketEvaluationMin ?? 5);
  const devices = (w.equipment ?? []).filter(e => e.kind === 'basket' && e.quantity > 0 && e.depthMD !== undefined && e.depthMD > 0 && e.depthMD <= w.casingDepthMD).sort((a,b) => a.depthMD! - b.depthMD!);
  const baskets: BasketLoad[] = [];
  const supportContributions: { pieces: { top:number; bot:number; excessRho:number }[]; fraction:number }[] = [];
  let upperBoundary = 0;
  for (const e of devices) {
    const md = e.depthMD!, notes: string[] = [];
    const atBasket = column.find(c => c.top < md && c.bot >= md);
    const inCement = atBasket?.fluidType === 'cement';
    const delay = e.basketBridgeMin;
    const entered = Math.max(0, Math.min(100, e.basketSupportPct ?? 0));
    const active = inCement && delay !== undefined && elapsedMin > 0 && elapsedMin >= delay;
    const fraction = active ? entered / 100 : 0;
    const carrier = e.basketCarrierDensityGcm3 && e.basketCarrierDensityGcm3 > 0 ? e.basketCarrierDensityGcm3 : 1;
    let potentialMPa = 0;
    const pieces: {top:number;bot:number;excessRho:number}[] = [];
    // Disjoint support intervals prevent counting the same cement weight twice.
    // Only a contiguous cement interval above this basket can transfer load.
    let supportTop = md;
    for (const c of [...column].sort((a,b) => b.bot-a.bot)) {
      if(c.top >= supportTop || c.bot < supportTop - 1e-6) continue;
      if(c.fluidType !== 'cement') break;
      const top = Math.max(upperBoundary, c.top), bot = Math.min(md, supportTop, c.bot);
      if(bot > top) {
        const excessRho=Math.max(0,c.rho-carrier);
        potentialMPa += excessRho*g*Math.max(0,tvd(bot)-tvd(top));
        pieces.push({top,bot,excessRho});
      }
      supportTop = top;
      if(supportTop <= upperBoundary) break;
    }
    const localCavern=w.cavernIntervals?.find(c=>md>=c.fromMD&&md<=c.toMD)?.coeff??w.cavernCoeff??1;
    const outer = md <= w.prevCasingDepth && w.prevCasingID > 0 ? w.prevCasingID : w.holeDiameter * Math.sqrt(localCavern > 0 ? localCavern : 1);
    const area = Math.PI/4*Math.max(0,(outer/1000)**2-(w.casingOD/1000)**2);
    const desired = potentialMPa*fraction;
    const capacity = e.basketCapacityKN;
    const capMPa = capacity !== undefined && area > 0 ? capacity/(area*1000) : Infinity;
    const transferredMPa = area > 0 ? Math.min(desired,capMPa) : 0;
    supportContributions.push({pieces,fraction:potentialMPa>0?transferredMPa/potentialMPa:0});
    if(!inCement) notes.push('На глубине корзины в конечном профиле нет цемента; передача нагрузки не начислена.');
    if(delay === undefined || e.basketSupportPct === undefined) notes.push('Время формирования перемычки или доля передачи нагрузки не заданы; разгрузка не начислена.');
    if(entered > 0 && capacity === undefined) notes.push('Несущая способность не задана; сценарная нагрузка не подтверждена паспортом.');
    if(desired > capMPa) notes.push('Передача нагрузки ограничена введённой несущей способностью корзины и крепления.');
    if(e.quantity !== 1) notes.push('В этой позиции несколько корзин: нагрузка не умножается на количество. Внесите каждую глубину отдельной позицией.');
    if(!(area > 0)) notes.push('Нет положительного кольцевого сечения; проверьте геометрию.');
    baskets.push({id:e.id,model:e.model,md,transferPct:fraction*100,potentialMPa,transferredMPa,reactionKN:transferredMPa*area*1000,capacityKN:capacity,limited:desired>capMPa,notes});
    // Only an active load-bearing basket splits the supported weight interval.
    if(fraction > 0 && transferredMPa > 0) upperBoundary=md;
  }
  const depths=new Set<number>(Array.from({length:61},(_,i)=>w.casingDepthMD*i/60));
  for(const e of baskets){depths.add(e.md);depths.add(Math.max(0,e.md-.01));}
  for(const l of w.reservoirLayers??[]){depths.add(l.topMD);depths.add(l.bottomMD);}
  const rows=[...depths].filter(md=>md>=0&&md<=w.casingDepthMD).sort((a,b)=>a-b).map(md=>{
    let withoutMPa=0;
    for(const c of column)if(md>c.top)withoutMPa+=c.rho*g*Math.max(0,tvd(Math.min(md,c.bot))-tvd(c.top));
    // A permeable support cannot create a pressure jump. Transfer is distributed
    // through its supported cement interval; below it the head reduction persists.
    const reductionMPa=Math.min(withoutMPa,supportContributions.reduce((sum,support)=>sum+support.fraction*support.pieces.reduce((n,c)=>n+(md>c.top?c.excessRho*g*Math.max(0,tvd(Math.min(md,c.bot))-tvd(c.top)):0),0),0));
    const ls=(w.reservoirLayers??[]).filter(l=>md>=l.topMD&&md<=l.bottomMD);
    const pores=ls.filter(l=>l.porePressureGrad>0).map(l=>l.porePressureGrad*tvd(md)/1000);
    const limits=ls.flatMap(l=>[l.fracGrad,l.absorbGrad]).filter(n=>n>0).map(n=>n*tvd(md)/1000);
    if(md>=w.prevCasingDepth&&fractureGradientKPaM>0)limits.push(fractureGradientKPaM*tvd(md)/1000);
    return {md,tvd:tvd(md),withoutMPa,scenarioMPa:withoutMPa-reductionMPa,reductionMPa,poreMPa:pores.length?Math.max(...pores):null,limitMPa:limits.length?Math.min(...limits):null};
  });
  return {elapsedMin,rows,baskets,notes:[
    'Сразу после остановки насосов гидростатика жидкого столба сохраняется, потери на трение исчезают. Посадочное давление пробки не добавляется автоматически к давлению на пласт.',
    'Корзина пропускает жидкость. Снижение давления возможно при передаче части веса цемента на сформировавшуюся перемычку, корзину и колонну. Время и степень передачи - параметры сценария, не прогноз седиментации.',
    'Непрерывная оценка чувствительности: доля избыточного веса передаётся твёрдым скелетом по поддерживаемому интервалу; скачка давления на проницаемой корзине нет. Ниже опоры сохраняется накопленное снижение. ΔP = доля передачи × g × интеграл (плотность цемента − плотность несущей жидкости) по TVD. Точный пороупругий процесс, фильтрация и обходные каналы не моделируются.',
    'Основная гидравлика и проверки ГРП сохраняют полный столб без зачёта разгрузки корзиной. Сценарий отдельно проверяется на недодавление относительно пластового давления; герметичный пакер этим расчётом не заменяется.',
    'Для нескольких корзин используется консервативное разбиение цемента на неперекрывающиеся интервалы. Дополнительное сопротивление лепестков при циркуляции без измеренной характеристики не моделируется.',
    'Предполагаются открытое затрубье, сохранение уровней и работоспособное поплавковое оборудование. Поглощение, приток, переток и закрытое затрубье требуют отдельной граничной модели.',
  ]};
}
