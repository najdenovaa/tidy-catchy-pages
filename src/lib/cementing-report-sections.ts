import { calculateCasingRunning, normalizeRunningSettings } from "./casing-running-analysis";
import { Paragraph, TextRun, HeadingLevel, ImageRun, AlignmentType, Table } from "docx";
import { reportDataTable } from "./report-layout";
import { inspectCentralizer } from "./centralizer-clearance";
import { type WellData } from "./cementing-calculations";
import { trajectoryAzimuth } from "./centralizer-mesh";
import type { CementingReportExtras, CentralizationReportData } from "./cementing-report-data";
const PASSPORT_LABELS: Record<string, string> = {"manufacturer":"Производитель","sourceUrl":"Каталог изготовителя","model":"Обозначение изделия","series":"Серия","casingOD":"Диаметр ОК, мм","boreDiameter":"Диаметр ствола по паспорту, мм","outerDiameter":"Наружный диаметр по планкам, мм","innerDiameter":"Внутренний диаметр, мм","length":"Общая длина, мм","springLength":"Длина рессоры, мм","bladeWidth":"Ширина планки, мм","ringOD":"Наружный диаметр кольца, мм","ringLength":"Длина кольца, мм","materialThickness":"Толщина рессоры, мм","restoringForceKgf":"Восстанавливающее усилие, кгс","restoringStandoff":"Степень центрирования при испытании усилия, %","startingForceKgf":"Пусковое усилие, кгс","runningForceKgf":"Сопротивление движению по испытанию, кгс","holdingForceKN":"Удерживающее усилие, кН","frictionCoefficient":"Коэффициент трения","bladeAngle":"Угол лопасти, °","note":"Примечание паспорта","source":"Источник","estimatedRestoringForceKN":"Оценочное восстанавливающее усилие, кН","massKg":"Масса, кг","boreDiameterRange":"Диапазон диаметров ствола, мм","restoringForceSourceKN":"Усилие в источнике, кН","startingForceSourceKN":"Пусковое усилие в источнике, кН","forceLimitAmbiguous":"Неоднозначность ограничения усилия","lengthRange":"Диапазон длины, мм","bladeWidthRange":"Диапазон ширины планки, мм"};
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
export function buildCementingReportExtras(w: WellData, extras: CementingReportExtras = {}): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [h("Состав отчёта и актуальность расчётов"),
    p("Данные отчёта относятся к текущим исходным параметрам. Статические изображения не содержат интерактивной анимации. Все числовые зазоры приведены без визуального увеличения.")];
  out.push(reportDataTable(["Раздел", "Наличие"], [
    ["Исходные данные, объёмы, гидравлика, материалы, программа закачки, лаборатория, ограничения и ОЗЦ", "В основном отчёте"],
    ["Центрирование и паспорта оснастки", extras.centralization ? "Данные и результаты переданы" : "Не рассчитано / данные отсутствуют"],
    ["2D-замещение и 3D-кадры", extras.displacement ? "Актуальный расчёт передан" : "Не выполнено"],
    ["Пеноцементирование", "При наличии отдельного актуального расчёта - приложение"],
    ["Дополнительные инженерные модули", (extras.supplements?.map(x => x.title).join("; ") || "Нет дополнительных рассчитанных разделов")],
  ], [35, 65]));
  (extras.warnings ?? []).forEach(x => out.push(p("Замечание: " + x)));
  const c = extras.centralization;
  if (c) {
    out.push(h("Центрирование: задание, паспорта и расстановка"),
      p("Режим: " + (c.mode === "auto" ? "по целевому Standoff" : "ручная расстановка") + "; целевой Standoff: " + (c.targetStandoff === undefined ? "ручная расстановка" : f(c.targetStandoff, 1) + "%") +
        ". Standoff на опоре и минимальный Standoff в пролёте - разные величины."));
    out.push(reportDataTable(["От MD, м", "До MD, м", "Модель / тип", "шт./трубу", "Труба, м"], c.intervals.map(x =>
      [f(x.fromMD, 1), f(x.toMD, 1), x.spec.passport?.model || x.spec.type, f(x.centralizersPerJoint, 2), f(x.jointLength, 1)])));
    if (c.autoResults?.length) out.push(reportDataTable(["Интервал MD, м", "Шаг, м", "Количество", "Standoff, %"], c.autoResults.map(x =>
      [f(x.fromMD, 0) + "-" + f(x.toMD, 0), x.centralizersPerJoint > 0 ? f((c.jointLength ?? 12) / x.centralizersPerJoint, 2) : "-", f(x.totalCentralizers, 0), f(x.standoffAchieved, 1)])));
    out.push(p("Модели, изготовители и общее количество центраторов включены в ведомость материалов. Ниже приведены паспорта и расстановка по глубине."));
    for (const iv of c.intervals) {
      const passport = iv.spec.passport;
      out.push(h((passport?.model || iv.spec.type) + ": паспорт оснастки " + f(iv.fromMD, 0) + "-" + f(iv.toMD, 0) + " м"),
        p(passport ? "Паспортные поля: отсутствующие размеры не заменяются подтверждёнными данными." : "Паспорт не выбран. Использованы типовые параметры; 3D по паспортной геометрии недоступен."),
        reportDataTable(["Параметр", "Значение"], [
          ["Тип / число планок", iv.spec.type + " / " + iv.spec.bladesCount],
          ["Восстанавливающее усилие для модели, кН", f(iv.spec.restoringForce)],
          ...Object.entries(passport ?? {}).filter(([, v]) => v !== undefined).map(([k, v]) => [PASSPORT_LABELS[k] ?? k, String(v)]),
        ], [40, 60]));
    }
    out.push(h("Нагрузки, прогибы и зазоры по глубине"),
      reportDataTable(["MD, м", "На опоре, %", "В пролёте, %", "Нагрузка, кН", "Прогиб трубы, мм", "Перегрузка"], c.results.map(r =>
        [f(r.md, 1), f(100 * (1 - (r.supportEccentricity ?? r.eccentricity)), 1), f(r.standoff, 1),
          f(r.lateralLoadKN), f(r.spanSagMM), r.supportOverloaded === undefined ? "Не оценено" : r.supportOverloaded ? "Да" : "Нет"])));
    for (const x of centralizerReportSamples(w, c)) {
      if (!x.geometry) continue;
      const g = x.geometry;
      out.push(h("Контрольное сечение оснастки на MD " + f(x.result.md, 1) + " м"),
        p("Номинальный проход модели центрирования. Зенит " + f(x.result.zenith, 1) + "°, азимут " + f(x.azimuth, 1) + "°. Диаметр прохода " + f(x.bore) +
          " мм; смещение на опоре " + f(g.offset) + " мм; зазор труба-стенка " + f(g.minPipeGap) + "-" + f(g.maxPipeGap) + " мм."),
        reportDataTable(["Планка", "Монтаж, мм", "От нагрузки, мм", "Сжатие, мм", "Зазор / конфликт, мм"], g.blades.map(b =>
          [b.index, f(b.mountingCompression), f(b.loadCompression), f(b.compression), f(b.gap)])),
        p("Отрицательный зазор означает геометрический конфликт. Прогиб рессоры на опоре не включает прогиб трубы между опорами."),
        ...(x.result.calculationAssumptions ?? []).map(p));
    }
    if (c.joints?.length) out.push(h("Потрубная ведомость установки оснастки"),
      reportDataTable(["№ трубы", "Кровля MD, м", "Подошва MD, м", "Глубины центраторов MD, м"], c.joints.map(x =>
        [x.jointNum, x.topMD, x.bottomMD, x.centralizerDepths.join("; ") || "-"])));
    if (c.running) {
      const settings=normalizeRunningSettings(w.runningSettings,c.running.frictionCased,c.running.frictionOpenhole);
      const a=calculateCasingRunning({well:w,intervals:c.intervals,turbPoints:c.turbPoints,...c.running,settings});
      out.push(h("Спуск колонны: веник и контроль нагрузок"),
        p("Каждая строка веника - отдельный расчёт при текущей глубине башмака. Оснастка перемещается вместе с трубой. Нагрузки на крюке включают только явно заданный вес подвески."),
        reportDataTable(["Параметр", "Значение"], [
          ["Трение: предыдущая колонна / открытый ствол",f(settings.frictionCased)+" / "+f(settings.frictionOpenhole)],
          ["Вариация трения для веника",f(settings.frictionSpread)],
          ["Скорость движения, м/с",f(settings.speedMps)], ["Погонная масса, кг/м", settings.pipeWeightKgPerM>0?f(settings.pipeWeightKgPerM):c.running.pipeWeightKgPerM?f(c.running.pipeWeightKgPerM):"По геометрии секций"], ["Вес подвески, кН",f(settings.blockWeightKN)],
          ["Предел крюка, кН",settings.maxHookKN>0?f(settings.maxHookKN):"Не задан"],
          ["Добавка на центратор без испытания / турбулизатор, кН",f(settings.centralizerRunningKN)+" / "+f(settings.turbulatorRunningKN)],
          ["ПВ, сПз / ДНС, Па",f(c.running.pv)+" / "+f(c.running.yp)],
        ],[65,35]));
      if (a.final) out.push(reportDataTable(["Показатель", "Значение"],[
        ["Спуск / подъём на проектной глубине, тс",f(a.final.runIn)+" / "+f(a.final.pullOut)],
        ["Максимум подъёма за весь спуск, тс / MD м",f(a.maxPullKN/9.80665)+" / "+f(a.maxPullMD,0)],
        ["Первый геометрический конфликт, глубина башмака MD м",a.firstPassageConflictMD===null?"Не выявлен":f(a.firstPassageConflictMD,0)],
        ["Первое осевое сжатие, глубина башмака MD м",a.firstCompressionMD===null?"Не выявлено":f(a.firstCompressionMD,0)],
        ["Первое превышение крюка, MD м",settings.maxHookKN===0?"Предел не задан":a.firstCapacityMD===null?"Не выявлено":f(a.firstCapacityMD,0)],
        ["Изгиб / осевое + изгиб, оценка МПа",f(a.maxBendingMPa)+" / "+f(a.maxCombinedMPa)],
        ["Полная вместимость / объём стали, м³",f(a.internalVolumeM3)+" / "+f(a.steelDisplacementM3)],
      ],[65,35]),reportDataTable(["Башмак MD, м","Спуск, тс","Подъём, тс","Без трения, тс","Без оснастки, тс","Момент, кН·м"],a.broom.map(r=>[f(r.md,0),f(r.runIn),f(r.pullOut),f(r.free),f(r.noTools),f(r.torqueKNm)])));
      if(settings.measurements.length)out.push(reportDataTable(["Замер MD, м","Режим","Крюк, тс"],settings.measurements.map(m=>[f(m.md,0),m.mode==="runIn"?"Спуск":"Подъём",f(m.hookTF)])));
      if(a.calibration)out.push(p(a.calibration.informative?"Подбор общей поправки трения: Δμ="+f(a.calibration.deltaMu)+"; RMSE="+f(a.calibration.rmseTF)+" тс. "+(a.calibration.atBoundary?"На границе поиска; требует проверки.":"Автоматически не применяется."):"По замерам трение не определяется: недостаточная чувствительность."));
      out.push(...a.errors.map(p),...a.notes.map(p),p("Сжатие не означает доказанный прихват. Изгиб пролёта - оценка без контакта трубы со стенкой. Полная вместимость не является автоматическим доливом; требуется баланс фактического заполнения и возврата."));
    }
    out.push(h("Турбулизаторы"),
      ...(c.turbPoints.length ? [reportDataTable(["MD, м", "Лопастей", "Угол, °", "Высота, мм"], c.turbPoints.map(x =>
        [f(x.md, 1), x.bladesCount, f(x.bladeAngle, 1), f(x.bladeHeight, 1)]))] : [p("Точки установки турбулизаторов не заданы.")]));
  }
  const d = extras.displacement;
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
  for (const figure of extras.figures ?? []) {
    const scale = Math.min(620 / figure.width, 650 / figure.height);
    try {
      out.push(h(figure.title));
      if (extras.displacement && /Замещение|Карта состава/.test(figure.title)) out.push(new Paragraph({ keepNext: true, children: extras.displacement.result.fluids.map((fluid, i) =>
        new TextRun({ text: "● " + fluid.name + "   ", color: (extras.displacement!.meta.colors[i] ?? "#64748b").replace("#", ""), size: 18 })) }));
      out.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({
        data: Uint8Array.from(atob(figure.dataUrl.split(",")[1]), c => c.charCodeAt(0)),
        transformation: { width: Math.round(figure.width * scale), height: Math.round(figure.height * scale) },
      })] }));
    } catch { out.push(p("Изображение недоступно: " + figure.title)); }
  }
  for (const s of extras.supplements ?? []) {
    out.push(h(s.title), ...s.paragraphs.map(p));
    s.tables.forEach(t => {
      if (t.headers.length <= 7) out.push(reportDataTable(t.headers, t.rows));
      else for (let start = 1; start < t.headers.length; start += 6) {
        const columns = [0, ...Array.from({ length: Math.min(6, t.headers.length - start) }, (_, i) => start + i)];
        out.push(reportDataTable(columns.map(i => t.headers[i]), t.rows.map(row => columns.map(i => row[i]))));
      }
    });
  }
  return out;
}
