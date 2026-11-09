import { centralizerInventory } from "./cementing-equipment";
import { allowedReportFigure, reportIncludes, type ReportScope, type ReportSelection } from "./cementing-report-options";
import { calculateCasingRunning, normalizeRunningSettings } from "./casing-running-analysis";
import { Paragraph, TextRun, HeadingLevel, ImageRun, AlignmentType, Table } from "docx";
import { reportDataTable } from "./report-layout";
import { inspectCentralizer } from "./centralizer-clearance";
import { type WellData } from "./cementing-calculations";
import { trajectoryAzimuth } from "./centralizer-mesh";
import type { CementingReportExtras, CentralizationReportData } from "./cementing-report-data";
const f = (v: unknown, n = 2) => typeof v === "number" && Number.isFinite(v) ? v.toFixed(n) : "не задано";
const p = (text: string) => new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: text.replace(/[—–]/g, "-"), size: 20, font: "Calibri" })] });
const h = (text: string) => new Paragraph({ text, heading: HeadingLevel.HEADING_2, keepNext: true, spacing: { before: 200, after: 100 } });
export function localBore(w: WellData, md: number) {
  return md <= (w.prevCasingDepth || 0) && w.prevCasingID > 0 ? w.prevCasingID : w.holeDiameter;
}
export function centralizerReportSamples(w: WellData, data: CentralizationReportData) {
  const withSupport = data.results.filter(r => r.hasCentralizer);
  const pool = withSupport.length ? withSupport : data.results;
  if (!pool.length) return [];
  const chosen = [pool.reduce((a, b) => a.standoff < b.standoff ? a : b),
    pool.reduce((a, b) => (a.supportEccentricity ?? a.eccentricity) > (b.supportEccentricity ?? b.eccentricity) ? a : b),
    ...(data.selectedMD !== undefined ? [pool.reduce((a, b) => Math.abs(a.md - data.selectedMD!) < Math.abs(b.md - data.selectedMD!) ? a : b)] : [])];
  return [...new Map(chosen.map(r => [r.md, r])).values()].map(result => {
    const interval = data.intervals.find(x => x.id === result.intervalId) ??
      data.intervals.find(x => result.md >= x.fromMD && result.md <= x.toMD);
    if (!interval) return null;
    return { result, spec: interval.spec, bore: localBore(w, result.md), azimuth: trajectoryAzimuth(w.trajectory ?? [], result.md),
      geometry: inspectCentralizer(interval.spec, w.casingOD, localBore(w, result.md), result.supportEccentricity ?? result.eccentricity) };
  }).filter((x): x is NonNullable<typeof x> => !!x);
}
export function buildCementingReportExtras(w:WellData,extras:CementingReportExtras={},scope:ReportScope='cementing',selection?:ReportSelection):(Paragraph|Table)[] {
 const out:(Paragraph|Table)[]=[],yes=(key:Parameters<typeof reportIncludes>[1])=>reportIncludes(selection,key);
 const c=extras.centralization;
 (extras.warnings??[]).forEach(n=>out.push(p(n)));
 if(scope!=='cementing'&&yes('inputs'))out.push(h('Исходные данные расчёта'),reportDataTable(['Параметр','Значение'],[
   ['Колонна, наружный диаметр / стенка, мм',f(w.casingOD)+' / '+f(w.casingWall)],['Проектная глубина башмака MD, м',f(w.casingDepthMD)],
   ['Ствол / проход предыдущей колонны, мм',f(w.holeDiameter)+' / '+f(w.prevCasingID)],['Башмак предыдущей колонны MD, м',f(w.prevCasingDepth)],
 ]),reportDataTable(['MD, м','TVD, м','Зенит, °','Азимут, °'],w.trajectory.map(t=>[f(t.md,1),f(t.tvd,1),f(t.zenith,1),f(t.azimuth,1)])));
 if(scope!=='cementing'&&c&&yes('materials'))out.push(h('Ведомость оснастки'),reportDataTable(['Наименование','Количество, шт.'],centralizerInventory(w.casingDepthMD,c.intervals).map(x=>[x.model,String(x.quantity)])));
 if(scope==='centralization'&&c){
   if(yes('inputs'))out.push(h('Задание на центрирование'),p('Режим: '+(c.mode==='auto'?'по целевому Standoff':'ручная расстановка')+'; целевой Standoff '+(c.targetStandoff===undefined?'не задан':f(c.targetStandoff,1)+'%')+'. На опоре и в пролёте оцениваются разные значения.'));
   if(yes('placement')){
     out.push(h('Расстановка центраторов'),reportDataTable(['От MD, м','До MD, м','Наименование','шт./трубу','Длина трубы, м'],c.intervals.map(x=>[f(x.fromMD,1),f(x.toMD,1),x.spec.passport?.model||x.spec.type,f(x.centralizersPerJoint),f(x.jointLength,1)])));
     if(c.joints?.length)out.push(h('Потрубная ведомость установки оснастки'),reportDataTable(['№ трубы','Кровля MD, м','Подошва MD, м','Центраторы MD, м'],c.joints.map(x=>[String(x.jointNum),f(x.topMD,1),f(x.bottomMD,1),x.centralizerDepths.join('; ')||'-'])));
     if(c.turbPoints.length)out.push(h('Расстановка турбулизаторов'),reportDataTable(['Наименование','MD, м'],c.turbPoints.map(x=>['Турбулизатор',f(x.md,1)])));
   }
   if(yes('loads'))out.push(h('Нагрузки, прогибы и зазоры по глубине'),reportDataTable(['MD, м','На опоре, %','В пролёте, %','Нагрузка, кН','Прогиб трубы, мм','Перегрузка'],c.results.map(r=>[f(r.md,1),f(100*(1-(r.supportEccentricity??r.eccentricity)),1),f(r.standoff,1),f(r.lateralLoadKN),f(r.spanSagMM),r.supportOverloaded===undefined?'Не оценено':r.supportOverloaded?'Да':'Нет'])));
   if(yes('clearance'))for(const x of centralizerReportSamples(w,c)){
     if(!x.geometry)continue;const g=x.geometry;
     out.push(h('Контрольное сечение оснастки на MD '+f(x.result.md,1)+' м'),p('Расчётный проход '+f(x.bore)+' мм; смещение '+f(g.offset)+' мм; зазор труба-стенка '+f(g.minPipeGap)+'-'+f(g.maxPipeGap)+' мм.'),
       reportDataTable(['Планка','Монтаж, мм','От нагрузки, мм','Сжатие, мм','Зазор / конфликт, мм'],g.blades.map(b=>[String(b.index),f(b.mountingCompression),f(b.loadCompression),f(b.compression),f(b.gap)])),
       p('Отрицательный зазор означает геометрический конфликт. Прогиб рессор на опоре не включает прогиб трубы в пролёте.'));
   }
 }
 if(scope==='running'&&c?.running){
   const settings=normalizeRunningSettings(w.runningSettings,c.running.frictionCased,c.running.frictionOpenhole);
   const a=calculateCasingRunning({well:w,intervals:c.intervals,turbPoints:c.turbPoints,...c.running,settings});
   if(yes('inputs'))out.push(h('Параметры спуска колонны'),reportDataTable(['Параметр','Значение'],[
     ['Трение: предыдущая колонна / ствол',f(settings.frictionCased)+' / '+f(settings.frictionOpenhole)],['Вариация трения',f(settings.frictionSpread)],
     ['Скорость движения, м/с',f(settings.speedMps)],['Вес блока, кН',f(settings.blockWeightKN)],['Предел крюка, кН',settings.maxHookKN>0?f(settings.maxHookKN):'Не задан'],
     ['ПВ, сПз / ДНС, Па',f(c.running.pv)+' / '+f(c.running.yp)],['Плотность раствора, кг/м³',f(c.running.mudDensity)],
     ['Сопротивление центратора без испытания / турбулизатора, кН',f(settings.centralizerRunningKN)+' / '+f(settings.turbulatorRunningKN)]
   ]));
   if(yes('runningLoads')){
     out.push(h('Дохождение колонны: веник и контроль нагрузок'),p('Каждая строка относится к отдельной глубине башмака. Сжатие не является доказанным прихватом; резерв по устойчивости требует отдельной оценки.'));
     if(a.final)out.push(reportDataTable(['Показатель','Значение'],[
       ['Спуск / подъём на проектной глубине, тс',f(a.final.runIn)+' / '+f(a.final.pullOut)],['Максимум подъёма, тс / MD м',f(a.maxPullKN/9.80665)+' / '+f(a.maxPullMD,0)],
       ['Первое осевое сжатие, MD башмака м',a.firstCompressionMD===null?'Не выявлено':f(a.firstCompressionMD,0)],
       ['Первый конфликт прохода, MD башмака м',a.firstPassageConflictMD===null?'Не выявлен':f(a.firstPassageConflictMD,0)],
       ['Первое превышение крюка, MD м',settings.maxHookKN===0?'Предел не задан':a.firstCapacityMD===null?'Не выявлено':f(a.firstCapacityMD,0)],
       ['Изгиб / осевое + изгиб, оценка МПа',f(a.maxBendingMPa)+' / '+f(a.maxCombinedMPa)],
     ]),reportDataTable(['Башмак MD, м','Спуск, тс','Подъём, тс','Без трения, тс','Без оснастки, тс','Момент, кН·м'],a.broom.map(r=>[f(r.md,0),f(r.runIn),f(r.pullOut),f(r.free),f(r.noTools),f(r.torqueKNm)])));
     out.push(...a.errors.map(p),...a.notes.map(p));
   }
   if(yes('measurements')){
     out.push(h('Фактические замеры и подбор трения'));
     out.push(settings.measurements.length?reportDataTable(['MD, м','Режим','Крюк, тс'],settings.measurements.map(m=>[f(m.md,0),m.mode==='runIn'?'Спуск':'Подъём',f(m.hookTF)])):p('Фактические замеры не внесены.'));
     if(a.calibration)out.push(p(a.calibration.informative?'Поправка Δμ='+f(a.calibration.deltaMu)+'; RMSE='+f(a.calibration.rmseTF)+' тс. '+(a.calibration.atBoundary?'Граница поиска.':'Автоматически не применяется.'):'Трение не определяется: чувствительность замеров недостаточна.'));
   }
 }
 const d=scope==='cementing'&&yes('displacementSummary')?extras.displacement:null;
  if (d) {
    const r = d.result, s = r.summary;
    out.push(h("Замещение в затрубье: 2D-расчёт и 3D-представление"),
      p("Расчётная сетка " + r.nZ + " × " + r.nTheta + "; " + (r.full ? "полная окружность" : "половина окружности с отражением") +
        "; вращение " + f(s.rotationRpm, 1) + " об/мин; выдержка " + f(s.settleS / 60, 1) + " мин."),
      reportDataTable(["Показатель", "Конец продавки", "После выдержки"], [
        ["Заполнение цементом, %", f(s.pumpEnd.cementFillPct, 1), f(s.cementFillPct, 1)],
        ["Остаточный раствор, %", f(s.pumpEnd.mudLeftPct, 1), f(s.mudLeftPct, 1)],
        ["Длина каналов, м", f(s.pumpEnd.channelM, 1), f(s.channelM, 1)],
        ["Неподвижный раствор, м", f(s.pumpEnd.staticM, 1), f(s.staticM, 1)],
      ]),
      p("Ноль времени кадров - начало вытеснения в затрубье, через " + f(d.meta.annulusStartS / 60, 1) + " мин от начала закачки."),
      p("Баланс объёмов: " + f(s.massBalanceErrPct, 4) + "%; смещение кровли на выдержке " + f(r.settleTopShiftM, 2) + " м."),
      reportDataTable(["Жидкость", "Плотность, кг/м³", "ПВ, мПа·с", "ДНС, Па"], r.fluids.map(x =>
        [x.name, f(x.density, 1), f(x.pv * 1000, 2), f(x.yp, 2)])),
      reportDataTable(["Порция в затрубье", "Объём, м³", "Расход, л/с", "Выдержка, мин"], d.stages.map(x =>
        [r.fluids[x.fluid]?.name ?? "-", f(x.volumeM3, 3), f(x.rateM3s * 1000, 2), f((x.holdS ?? 0) / 60, 1)])),
      reportDataTable(["MD, м", "Цемент, %", "Раствор, %", "Буфер, %", "Охват, %", "Канал / застой"], r.rows.map(x =>
        [f(x.md, 1), f(x.cement * 100, 1), f(x.mud * 100, 1), f(x.spacer * 100, 1), f(x.coverage * 100, 1),
          (x.channel ? "канал " : "") + (x.staticNarrow ? "застой" : "") || "-"])),
      ...d.meta.notes.map(p), ...r.warnings.map(p),
      p("2D-модель осреднена по радиальному зазору. 3D - визуализация этого же поля, а не независимый расчёт CFD. Радиусы увеличены для наглядности."));
    if (s.worst.length) out.push(reportDataTable(["Риск от MD, м", "До MD, м", "Минимальный охват, %"], s.worst.map(x =>
      [f(x.topMD, 1), f(x.bottomMD, 1), f(x.minCoverage * 100, 1)])));
  }
 for(const figure of extras.figures??[]){
   if(!allowedReportFigure(scope,selection,figure))continue;
   const scale=Math.min(620/figure.width,650/figure.height);
   try{
     out.push(h(figure.title));
     if(extras.displacement&&/Замещение|Карта состава/.test(figure.title))out.push(new Paragraph({keepNext:true,children:extras.displacement.result.fluids.map((fluid,i)=>new TextRun({text:"● "+fluid.name+"   ",color:(extras.displacement!.meta.colors[i]??"#64748b").replace("#",""),size:18}))}));
     out.push(new Paragraph({alignment:AlignmentType.CENTER,children:[new ImageRun({data:Uint8Array.from(atob(figure.dataUrl.split(',')[1]),c=>c.charCodeAt(0)),transformation:{width:Math.round(figure.width*scale),height:Math.round(figure.height*scale)}})]}));}
   catch{out.push(p('Изображение недоступно: '+figure.title));}
 }
 if(scope==='cementing'&&yes('relatedModules'))for(const s of extras.supplements??[]){
   // Only explicitly cementing-related supplements, never generic drilling or T&D tabs.
   if(/центрир|дохожд|Torque|спуск колонн|паспорта/i.test(s.title))continue;
   out.push(h(s.title),...s.paragraphs.map(p));for(const t of s.tables){if(t.headers.length<=7)out.push(reportDataTable(t.headers,t.rows));else for(let start=1;start<t.headers.length;start+=6){const cols=[0,...Array.from({length:Math.min(6,t.headers.length-start)},(_,i)=>start+i)];out.push(reportDataTable(cols.map(i=>t.headers[i]),t.rows.map(row=>cols.map(i=>row[i]))));}}
 }
 return out;
}
