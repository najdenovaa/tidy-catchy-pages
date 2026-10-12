/**
 * Расчётный лабораторный протокол подбора рецептуры тампонажных растворов.
 * Модель — универсальный документ (шапка, разделы, таблицы, списки), который редактируется в интерфейсе,
 * печатается и выгружается в Word. Прогноз системы и факт испытаний разнесены по отдельным колонкам.
 */
import {
  getEffectiveTrajectory, interpolateTVD, getCasingID,
  type WellData, type SlurryInput, type BufferFluid, type DrillingFluid, type PressureProfileResult, type VolumeResults, type Additive,
} from "./cementing-calculations";
import { buildLabProgram, buildRecipe, additiveSG, type LabProgramResult } from "./cement-program";
import { designSlurry, conditionsFor, type SlurryDesign } from "./cement-recipe-designer";

export interface ProtocolTable { id: string; headers: string[]; rows: string[][]; widths?: number[] }
export interface ProtocolSection { id: string; title: string; paragraphs?: string[]; tables?: ProtocolTable[]; bullets?: string[] }
export interface LabProtocol {
  version: 1;
  createdAt: string;
  title: string;
  subtitle: string;
  meta: { label: string; value: string }[];
  status: string;
  sections: ProtocolSection[];
  signatures: { role: string; name: string }[];
  /** Число растворов (для обратного переноса рецептуры в программу) */
  slurryNames: string[];
}

const f = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d).replace(".", ",") : "—");
const BLANK = "";

export interface ProtocolInput {
  wellData: WellData;
  slurries: SlurryInput[];
  buffers: BufferFluid[];
  drillingFluid: DrillingFluid;
  pressure: PressureProfileResult | null;
  volumes: VolumeResults | null;
}

export function designAll(p: ProtocolInput, lab?: LabProgramResult): { lab: LabProgramResult; designs: SlurryDesign[] } {
  const l = lab ?? buildLabProgram(p.wellData, p.slurries, p.pressure, p.volumes);
  const traj = getEffectiveTrajectory(p.wellData);
  const layers = p.wellData.reservoirLayers ?? [];
  const minMargin = p.pressure?.zoneChecks?.length ? Math.min(...p.pressure.zoneChecks.map((z) => z.marginMPa)) : null;
  const designs = p.slurries.map((s, i) => {
    const ls = l.slurries[i];
    const maxZen = traj.filter((t) => t.md >= ls.topMD - 1 && t.md <= ls.bottomMD + 1).reduce((m, t) => Math.max(m, t.zenith || 0), 0)
      || traj.reduce((m, t) => Math.max(m, t.zenith || 0), 0);
    return designSlurry(conditionsFor(s, i, p.slurries.length, ls, p.wellData.bottomTempStatic, layers, maxZen, minMargin));
  });
  return { lab: l, designs };
}

const ROLE_ORDER = ["silica", "extender", "lightweight", "weighting", "fluidLoss", "dispersant", "retarder", "accelerator", "gasBlock", "expanding", "stabilizer", "fiber", "defoamer"];

export function buildLabProtocol(p: ProtocolInput, number?: string): { protocol: LabProtocol; designs: SlurryDesign[] } {
  const { lab, designs } = designAll(p);
  const w = p.wellData;
  const traj = getEffectiveTrajectory(w);
  const now = new Date();
  const date = now.toLocaleDateString("ru-RU");
  const num = number ?? `РП-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-01`;
  const bottomTVD = interpolateTVD(w.casingDepthMD, traj);
  const maxZen = traj.reduce((m, t) => Math.max(m, t.zenith || 0), 0);
  const maxBhp = p.pressure?.points.reduce((m, x) => Math.max(m, x.bottomholePressure), 0) ?? 0;
  const casingID = getCasingID(w.casingOD, w.casingWall);
  const cementTop = Math.min(...p.slurries.map((s) => s.topDepthMD), w.casingDepthMD);

  const sections: ProtocolSection[] = [];

  sections.push({
    id: "well", title: "1. Исходные данные скважины",
    tables: [{
      id: "well-kv", headers: ["Параметр", "Значение"], widths: [60, 40],
      rows: [
        ["Глубина скважины по стволу / по вертикали, м", `${f(w.wellDepthMD, 0)} / ${f(w.wellDepthTVD, 0)}`],
        ["Обсадная колонна: наружный диаметр × толщина стенки, мм", `${f(w.casingOD, 1)} × ${f(w.casingWall, 1)} (внутр. ${f(casingID, 1)})`],
        ["Глубина спуска колонны по стволу / по вертикали, м", `${f(w.casingDepthMD, 0)} / ${f(bottomTVD, 0)}`],
        ["Диаметр ствола (долота), мм; коэффициент кавернозности", `${f(w.holeDiameter, 1)}; ${f(w.cavernCoeff, 2)}`],
        ["Предыдущая колонна: внутр. диаметр, мм / глубина башмака, м", `${f(w.prevCasingID, 1)} / ${f(w.prevCasingDepth, 0)}`],
        ["Интервал цементирования по стволу, м", `${f(cementTop, 0)} – ${f(w.casingDepthMD, 0)}`],
        ["Максимальный зенитный угол, °", f(maxZen, 1)],
        ["Статическая температура на забое (BHST), °C", f(w.bottomTempStatic, 0)],
        ["Циркуляционная температура (BHCT), °C", `${f(lab.bhctUsedC, 0)} (${lab.bhctEnteredC > 0 ? "задана" : `расчёт: ${lab.bhct.method}`})`],
        ["Температура нейтрального слоя / поверхности, °C", f(lab.surfaceC, 0)],
        ["Геотермический градиент, °C/100 м", f(lab.bhct.gradientCper100m, 2)],
        ["Максимальное давление на забое при цементировании, МПа", maxBhp > 0 ? f(maxBhp, 1) : "—"],
        ["Буровой раствор: плотность, кг/м³; PV, сПз; ДНС, Па", `${f(p.drillingFluid.density, 0)}; ${f(p.drillingFluid.rheology.pv, 0)}; ${f(p.drillingFluid.rheology.yp, 1)}`],
        ...p.buffers.map((b) => [`Буфер «${b.name}»: плотность, кг/м³; объём, м³`, `${f(b.density, 0)}; ${f(b.volume, 1)}`]),
      ],
    }],
  });

  const layers = w.reservoirLayers ?? [];
  if (layers.length) {
    sections.push({
      id: "layers", title: "2. Пласты в интервале цементирования",
      tables: [{
        id: "layers-t", headers: ["Пласт", "Интервал MD, м", "Флюид", "Градиент пластового, кПа/м", "Градиент поглощения, кПа/м", "Градиент ГРП, кПа/м"],
        rows: layers.map((l) => [l.name, `${f(l.topMD, 0)}–${f(l.bottomMD, 0)}`, l.fluidType || "—", f(l.porePressureGrad, 1), f(l.absorbGrad, 1), f(l.fracGrad, 1)]),
      }],
    });
  }

  const base = layers.length ? 3 : 2;
  sections.push({
    id: "cond", title: `${base}. Условия испытаний (по расчёту закачки)`,
    tables: [{
      id: "cond-t", headers: ["Параметр", ...lab.slurries.map((s) => s.slurryName)], widths: [50, ...lab.slurries.map(() => 50 / Math.max(1, lab.slurries.length))],
      rows: [
        ["Интервал по стволу, м", ...lab.slurries.map((s) => `${f(s.topMD, 0)}–${f(s.bottomMD, 0)}`)],
        ["Статическая температура кровли / подошвы, °C", ...lab.slurries.map((s) => `${f(s.tTopStaticC, 0)} / ${f(s.tBottomStaticC, 0)}`)],
        ["Температура испытания на загустевание (BHCT), °C", ...lab.slurries.map((s) => f(s.bhctC, 0))],
        ["Давление испытания, МПа", ...lab.slurries.map((s) => f(s.testPressureMPa, 1))],
        ["Время выхода на режим, мин", ...lab.slurries.map((s) => f(s.rampMin, 0))],
        ["Время работы раствора (от затворения до посадки пробки), мин", ...lab.slurries.map((s) => f(s.jobTimeMin, 0))],
        ["Требуемое время загустевания до 30 Вс, мин", ...lab.slurries.map((s) => `≥ ${f(s.requiredThickeningMin, 0)}`)],
      ],
    }],
  });

  let secNo = base + 1;
  p.slurries.forEach((s, i) => {
    const d = designs[i];
    const ls = lab.slurries[i];
    const vol = p.volumes?.slurryVolumes[i]?.slurryVolumeM3 ?? 0;
    // кг цемента на 1 м³ раствора: объём на 1 т цемента = выход × масса сухой смеси
    const cementKgM3 = 1e6 / (d.yieldM3PerT * (1 + d.components.reduce((t, c) => t + c.pctBwoc / 100, 0)) * 1000);
    const reserve = 1.05;
    const comps = [...d.components].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
    const recipeRows: string[][] = [
      ["1", d.baseCement, "Вяжущее", "100", f(cementKgM3, 0), f((cementKgM3 * vol * reserve) / 1000, 2) + " т"],
      ...comps.map((c, j) => [String(j + 2), c.name, c.purpose, f(c.pctBwoc, 2), f((cementKgM3 * c.pctBwoc) / 100, 1), f((cementKgM3 * c.pctBwoc * vol * reserve) / 100, 0) + " кг"]),
      [String(comps.length + 2), "Вода затворения (техническая, пресная)", "Затворение", f(d.waterPctBwoc, 1), f((cementKgM3 * d.waterPctBwoc) / 100, 0), f((cementKgM3 * d.waterPctBwoc * vol * reserve) / 100 / 1000, 2) + " м³"],
    ];
    const dry = comps.filter((c) => !["gasBlock", "defoamer", "retarder", "accelerator"].includes(c.role)).map((c) => c.name.split(" (")[0].toLowerCase());
    const liquid = comps.filter((c) => ["gasBlock", "defoamer", "retarder", "accelerator"].includes(c.role)).map((c) => c.name.split(" (")[0].toLowerCase());
    sections.push({
      id: `recipe-${i}`, title: `${secNo++}. Раствор ${i + 1} «${s.name}» — рекомендуемая рецептура`,
      paragraphs: [
        `Назначение: ${i === p.slurries.length - 1 ? "хвостовая (основная) пачка у башмака" : "головная (облегчённая) пачка"}, интервал ${f(ls.topMD, 0)}–${f(ls.bottomMD, 0)} м. Проектная плотность ${f(s.density, 2)} г/см³, объём ${f(vol, 1)} м³.`,
        `Вяжущее: ${d.baseCement}. Дозировки — % от массы цемента (bwoc).`,
      ],
      tables: [
        { id: `recipe-t-${i}`, headers: ["№", "Компонент", "Назначение", "% bwoc", "кг на 1 м³", "На операцию (+5%)"], rows: recipeRows, widths: [5, 28, 33, 9, 10, 15] },
        {
          id: `recipe-kv-${i}`, headers: ["Показатель смеси", "Значение"], widths: [60, 40],
          rows: [
            ["Плотность расчётная, г/см³", f(d.densityGcm3, 3)],
            ["Водоцементное отношение В/Ц", f(d.waterPctBwoc / 100, 3)],
            ["Водосмесевое отношение В/С (к сухой смеси)", f(d.waterToBlend, 3)],
            ["Выход раствора, м³ на 1 т сухой смеси", f(d.yieldM3PerT, 3)],
            ["Сухая смесь на операцию (+5%), т", f((vol * reserve) / d.yieldM3PerT, 2)],
            ["Вода затворения на операцию (+5%), м³", f((cementKgM3 * d.waterPctBwoc * vol * reserve) / 100 / 1000, 2)],
          ],
        },
      ],
      bullets: [
        ...d.rationale,
        `Порядок приготовления: в воду затворения ввести ${liquid.length ? liquid.join(", ") : "пеногаситель"} и перемешать 10–15 мин; сухие компоненты (${dry.length ? dry.join(", ") : "—"}) затворить в составе сухой смеси с цементом на смесительной установке; контроль плотности рычажными весами под давлением, допуск ±0,02 г/см³.`,
      ],
    });

    const pr = d.predicted;
    const req30 = ls.requiredThickeningMin;
    const isTail = i === p.slurries.length - 1;
    const fannStr = (r: SlurryDesign["predicted"]["rheo27"]) => `${r.fann.r600}/${r.fann.r300}/${r.fann.r200}/${r.fann.r100}/${r.fann.r6}/${r.fann.r3}`;
    const verdict = (ok: boolean) => (ok ? "соответствует (прогноз)" : "НЕ соответствует (прогноз)");
    // Требования к прочности: хвостовая пачка — к разбуриванию; головная облегчённая — к началу работы камня
    const s24req = isTail ? 3.5 : 0.35;
    const s48req = isTail ? 3.5 : 0.7;
    const wocReq = isTail ? 24 : 48;
    const propsRows: string[][] = [
      ["Плотность, г/см³", "20 ± 2 °C, рычажные весы под давлением", `${f(s.density, 2)} ± 0,02`, f(d.densityGcm3, 3), BLANK, verdict(Math.abs(d.densityGcm3 - s.density) <= 0.02)],
      ["Растекаемость по конусу АзНИИ, см", "20 ± 2 °C", "≥ 18", f(pr.spreadCm, 1), BLANK, verdict(pr.spreadCm >= 18)],
      ["Реология при 27 °C: PV, сПз / ДНС, Па", "Вискозиметр Fann 35 (R1B1F1)", "прокачиваемость, ДНС ≤ 25 Па", `${f(pr.rheo27.pv, 0)} / ${f(pr.rheo27.ypPa, 1)}`, BLANK, verdict(pr.rheo27.ypPa <= 25)],
      ["Показания Fann 600/300/200/100/6/3 при 27 °C, дел.", "после затворения", "—", fannStr(pr.rheo27), BLANK, "—"],
      [`Реология при ${f(ls.bhctC, 0)} °C: PV, сПз / ДНС, Па`, "после кондиционирования 20 мин", "—", `${f(pr.rheoBhct.pv, 0)} / ${f(pr.rheoBhct.ypPa, 1)}`, BLANK, "—"],
      [`Показания Fann при ${f(ls.bhctC, 0)} °C, дел.`, "после кондиционирования", "—", fannStr(pr.rheoBhct), BLANK, "—"],
      ["Водоотдача, мл/30 мин", `${f(Math.min(ls.bhctC, 88), 0)} °C, ΔP 6,9 МПа, сетка 325 mesh`, `≤ ${f(pr.fluidLossTargetMl, 0)}`, f(pr.fluidLossMl, 0), BLANK, verdict(pr.fluidLossMl <= pr.fluidLossTargetMl)],
      ["Свободная вода (водоотделение), %", `BHCT, 2 ч, ${maxZen > 30 ? "под углом 45°" : "вертикально"}`, maxZen > 30 ? "0" : "≤ 0,5", f(pr.freeWaterPct, 1), BLANK, verdict(maxZen > 30 ? pr.freeWaterPct === 0 : pr.freeWaterPct <= 0.5)],
      ["Седиментационная устойчивость (Δρ верх/низ), г/см³", "BHCT, твердение в вертикальной трубке", "≤ 0,05", f(pr.sedimentationGcm3, 2), BLANK, verdict(pr.sedimentationGcm3 <= 0.05)],
      ["Время загустевания до 30 Вс, мин", `${f(ls.bhctC, 0)} °C, ${f(ls.testPressureMPa, 1)} МПа, выход на режим ${f(ls.rampMin, 0)} мин`, `≥ ${f(req30, 0)}`, f(pr.thickening30BcMin, 0), BLANK, verdict(pr.thickening30BcMin >= req30)],
      ["Время загустевания до 50 / 100 Вс, мин", "то же", "—", `${f(pr.thickening50BcMin, 0)} / ${f(pr.thickening100BcMin, 0)}`, BLANK, "—"],
      [`Прочность на сжатие 24 ч (кровля, ${f(ls.tTopStaticC, 0)} °C), МПа`, "УЗ-анализатор / кубы, давление испытания", `≥ ${f(s24req, 1)}`, f(pr.strength24TopMPa, 1), BLANK, verdict(pr.strength24TopMPa >= s24req)],
      [`Прочность на сжатие 48 ч (кровля, ${f(ls.tTopStaticC, 0)} °C), МПа`, "то же", `≥ ${f(s48req, 1)}`, f(pr.strength48TopMPa, 1), BLANK, verdict(pr.strength48TopMPa >= s48req)],
      [`Прочность на сжатие 24 / 48 ч (подошва, ${f(ls.tBottomStaticC, 0)} °C), МПа`, "то же", `≥ ${f(s48req, 1)} (48 ч)`, `${f(pr.strength24BottomMPa, 1)} / ${f(pr.strength48BottomMPa, 1)}`, BLANK, verdict(pr.strength48BottomMPa >= s48req)],
      ["Время ОЗЦ до 3,5 МПа на кровле, ч", "по кривой набора прочности", `≤ ${wocReq}`, Number.isFinite(pr.wocTo35MPaHours) ? f(pr.wocTo35MPaHours, 0) : "> 48", BLANK, isTail ? verdict(Number.isFinite(pr.wocTo35MPaHours) && pr.wocTo35MPaHours <= wocReq) : "справочно"],
      ...(pr.sgsTransitionMin !== null ? [["Переходный период СНС 48 → 240 Па, мин", "SGS-анализатор, BHCT → BHST", "≤ 45", f(pr.sgsTransitionMin, 0), BLANK, verdict(pr.sgsTransitionMin <= 45)]] : []),
      ...(pr.expansionPct !== null ? [["Линейное расширение камня через 7 сут, %", "BHST, водная среда", "≥ 0,3", f(pr.expansionPct, 1), BLANK, verdict(pr.expansionPct >= 0.3)]] : []),
    ];
    sections.push({
      id: `props-${i}`, title: `${secNo++}. Раствор ${i + 1} «${s.name}» — свойства (прогноз и факт)`,
      tables: [{ id: `props-t-${i}`, headers: ["Показатель", "Условия испытания", "Требование", "Прогноз системы", "Факт", "Заключение"], rows: propsRows, widths: [24, 24, 12, 13, 10, 17] }],
      bullets: d.warnings.map((x) => `⚠ ${x}`),
    });
  });

  sections.push({
    id: "compat", title: `${secNo++}. Совместимость жидкостей (API RP 10B-2, разд. 16)`,
    tables: [{
      id: "compat-t", headers: ["Смесь (по объёму)", "Условия", "Требование", "Прогноз системы", "Факт", "Заключение"],
      rows: ["95/5", "75/25", "50/50", "25/75", "5/95"].map((m) => [`Цемент / буфер ${m}`, "27 °C и BHCT", "без резкого роста реологии, загустевание не короче чистого цемента", "совместимы при соблюдении иерархии реологии", BLANK, BLANK])
        .concat([["Буфер / буровой раствор 50/50", "27 °C", "без флокуляции и роста ДНС более чем в 2 раза", "—", BLANK, BLANK]]),
    }],
  });

  const allOk = designs.every((d, i) => d.predicted.thickening30BcMin >= lab.slurries[i].requiredThickeningMin && d.predicted.fluidLossMl <= d.predicted.fluidLossTargetMl);
  sections.push({
    id: "concl", title: `${secNo++}. Заключение`,
    paragraphs: [
      allOk
        ? "По расчётному прогнозу рекомендуемые рецептуры удовлетворяют требованиям по времени загустевания, водоотдаче и реологии для условий данной скважины."
        : "По расчётному прогнозу часть требований не выполняется — см. строки «НЕ соответствует» и предупреждения; рецептура требует корректировки.",
      "Перед применением рекомендуется подтвердить испытанием на фактической партии цемента и химреагентов как минимум: плотность, время загустевания при BHCT и давлении, водоотдачу и прочность через 24 ч при температуре кровли. Дозировки замедлителя и понизителя водоотдачи уточняются по результатам испытания (марки реагентов разных производителей отличаются по активности).",
    ],
    bullets: lab.notes.map((n) => `⚠ ${n}`),
  });

  return {
    protocol: {
      version: 1,
      createdAt: now.toISOString(),
      title: `РАСЧЁТНЫЙ ПРОТОКОЛ № ${num}`,
      subtitle: "подбора рецептуры тампонажных растворов для цементирования обсадной колонны",
      meta: [
        { label: "Дата", value: date },
        { label: "Месторождение", value: BLANK },
        { label: "Куст / скважина", value: BLANK },
        { label: "Обсадная колонна", value: `Ø ${f(w.casingOD, 1)} мм, спуск до ${f(w.casingDepthMD, 0)} м` },
        { label: "Заказчик", value: BLANK },
        { label: "Исполнитель работ", value: BLANK },
        { label: "Основание", value: `Программа цементирования, расчёт DeAllsoft от ${date}` },
      ],
      status: "Документ сформирован расчётом. Колонка «Прогноз системы» — расчётные значения (баланс масс и абсолютных объёмов, корреляции API RP 10B-2, типовые кривые портландцемента класса G); это не результаты лабораторных испытаний. Колонка «Факт» заполняется по результатам испытаний. Точность прогноза: плотность и выход — расчётно точны; время загустевания ±25%; водоотдача, реология и прочность — ориентировочно.",
      sections,
      signatures: [
        { role: "Составил (инженер-технолог)", name: BLANK },
        { role: "Проверил", name: BLANK },
        { role: "Утвердил (главный инженер)", name: BLANK },
      ],
      slurryNames: p.slurries.map((s) => s.name),
    },
    designs,
  };
}

/** Рецептура из (возможно отредактированной) таблицы протокола → добавки раствора программы. */
export function additivesFromProtocol(protocol: LabProtocol, idx: number, designs: SlurryDesign[]): Additive[] | null {
  const sec = protocol.sections.find((s) => s.id === `recipe-${idx}`);
  const t = sec?.tables?.find((x) => x.id === `recipe-t-${idx}`);
  if (!t) return null;
  const d = designs[idx];
  const out: Additive[] = [];
  for (const row of t.rows) {
    const name = (row[1] || "").trim();
    const pct = parseFloat((row[3] || "").replace(",", "."));
    if (!name || !Number.isFinite(pct) || pct <= 0) continue;
    if (/^ПЦТ|цемент/i.test(name) && pct >= 99) continue; // вяжущее
    if (/^Вода затворения/i.test(name)) continue;
    const comp = d?.components.find((c) => c.name === name);
    const sg = comp?.sg ?? additiveSG({ name, percentage: pct, percentageType: "bwoc", massKg: 0 }).sg;
    out.push({ name, percentage: pct, percentageType: "bwoc", massKg: 0, specificGravity: sg });
  }
  return out;
}

/** Применить рецептуры протокола к растворам программы: добавки (с правками), В/С и выход — по абсолютным объёмам. */
export function applyProtocolToSlurries(protocol: LabProtocol, slurries: SlurryInput[], designs: SlurryDesign[]): SlurryInput[] {
  return slurries.map((s, i) => {
    const d = designs[i];
    if (!d) return s;
    const additives = additivesFromProtocol(protocol, i, designs) ?? [];
    const draft: SlurryInput = { ...s, additives, cementSG: d.cementSG };
    const r = buildRecipe(draft, 1);
    const rh = d.predicted.rheo27;
    return {
      ...draft,
      waterRatio: Math.round(r.wcForDesign * 1000) / 1000,
      yieldPerTon: Math.round(r.yieldM3perT * 1000) / 1000,
      rheology: s.rheology.fann ? s.rheology : { pv: Math.round(rh.pv), yp: Math.round(rh.ypPa * 10) / 10, fann: { ...rh.fann } },
      thickeningTime30Bc: s.thickeningTime30Bc > 0 ? s.thickeningTime30Bc : Math.round(d.predicted.thickening30BcMin),
      thickeningTime50Bc: s.thickeningTime50Bc > 0 ? s.thickeningTime50Bc : Math.round(d.predicted.thickening50BcMin),
    };
  });
}

// ───────────────────────── HTML (печать) ─────────────────────────

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function protocolToHtml(p: LabProtocol): string {
  const table = (t: ProtocolTable) => `<table><thead><tr>${t.headers.map((h, i) => `<th${t.widths?.[i] ? ` style="width:${t.widths[i]}%"` : ""}>${esc(h)}</th>`).join("")}</tr></thead><tbody>${t.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  const body = p.sections.map((s) => `<section><h2>${esc(s.title)}</h2>${(s.paragraphs ?? []).map((x) => `<p>${esc(x)}</p>`).join("")}${(s.tables ?? []).map(table).join("")}${s.bullets?.length ? `<ul>${s.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}</section>`).join("");
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${esc(p.title)}</title>
<style>
body{font-family:"Times New Roman",serif;font-size:11pt;color:#000;margin:15mm}
h1{font-size:14pt;text-align:center;margin:0}
.sub{text-align:center;margin:2px 0 10px}
h2{font-size:11.5pt;margin:14px 0 4px}
table{width:100%;border-collapse:collapse;margin:4px 0}
th,td{border:1px solid #000;padding:2px 4px;vertical-align:top;font-size:9.5pt}
th{background:#eee}
.meta td:first-child{width:30%;font-weight:bold}
.status{border:1px solid #000;padding:4px 6px;font-size:9pt;margin:8px 0}
ul{margin:4px 0 4px 18px;padding:0}li{font-size:9.5pt}
.sign td{border:none;padding:10px 4px}
section{break-inside:auto}
@page{size:A4;margin:12mm}
</style></head><body>
<h1>${esc(p.title)}</h1><div class="sub">${esc(p.subtitle)}</div>
<table class="meta"><tbody>${p.meta.map((m) => `<tr><td>${esc(m.label)}</td><td>${esc(m.value) || "&nbsp;"}</td></tr>`).join("")}</tbody></table>
<div class="status">${esc(p.status)}</div>
${body}
<table class="sign"><tbody>${p.signatures.map((s) => `<tr><td style="width:40%">${esc(s.role)}</td><td>____________________ ${esc(s.name)}</td><td style="width:20%">«___» ________ 20__ г.</td></tr>`).join("")}</tbody></table>
</body></html>`;
}
