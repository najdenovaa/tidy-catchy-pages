/**
 * Рецептура нижней (вязкой) пачки под цементный мост.
 *
 * Требование к пачке — статическое напряжение сдвига (СНС 10 с) не ниже нужного для остановки
 * обмена с цементом: τ ≥ Y_c·(ρ_ц − ρ_п)·g·R (см. cement-plug-exchange.ts), с запасом 20%.
 * Плотность пачки по умолчанию равна плотности раствора под ней — тогда на нижней границе нет
 * нового «тяжёлое над лёгким».
 *
 * Типы пачек по нужному СНС:
 *   • до ~30 Па — бентонит-полимерная (предгидратированный бентонит + ксантан);
 *   • 30–60 Па — высокоструктурная: бентонит + ксантан + ММГ (смешанный гидроксид металлов);
 *   • 60–250 Па — реактивная: при BHCT ≤ 90 °C — сшитый полиакриламид (ПАА + ацетат хрома),
 *     выше — силикатная (жидкое стекло + активатор CaCl₂);
 *   • больше ~250 Па — пачкой не обеспечить, нужна механическая опора.
 *
 * Свойства — ориентировочные корреляции для пресной технической воды и бентонита
 * ПБМА/ПБМБ; дозировки подтверждаются лабораторным замером СНС на фактических реагентах.
 */
import { yieldNumberCriticalExp } from "./cement-plug-exchange";

export type PillType = "bentonitePolymer" | "mmh" | "crosslinkedPAA" | "silicate" | "none";

export const PILL_TYPE_LABEL: Record<PillType, string> = {
  bentonitePolymer: "Бентонит-полимерная вязкая пачка",
  mmh: "Высокоструктурная пачка (бентонит + ксантан + ММГ)",
  crosslinkedPAA: "Реактивная пачка: сшитый полиакриламид",
  silicate: "Реактивная пачка: силикатная (жидкое стекло + CaCl₂)",
  none: "Пачкой не обеспечить — нужна механическая опора",
};

export interface PillComponent { name: string; purpose: string; kgPerM3: number; sg: number; isLiquid?: boolean }

export interface PillDesign {
  type: PillType;
  targetGel10sPa: number;
  densityGcm3: number;
  components: PillComponent[];
  waterLPerM3: number;
  predicted: { pv: number; yp: number; gel10s: number; gel10min: number; gelTimeMin?: number };
  meets: boolean;
  volumeM3: number;
  procedure: string[];
  warnings: string[];
  notes: string[];
}

export interface PillRequirementInput {
  cementDensity: number;
  boreDiameterMm: number;
  zenithDeg: number;
  /** Плотность пачки (по умолчанию — плотность раствора под мостом) */
  pillDensity: number;
}

/** Нужный СНС 10 с пачки с запасом 20% к экспериментальному пределу, Па. */
export function requiredPillGelPa(i: PillRequirementInput): number {
  const dRho = (i.cementDensity - i.pillDensity) * 1000;
  if (dRho <= 0) return 0;
  return Math.ceil(yieldNumberCriticalExp(i.zenithDeg) * dRho * 9.81 * (i.boreDiameterMm / 2000) * 1.2);
}

const BENT_SG = 2.6, BARITE_SG = 4.2;

/** Бентонит c% (по массе к воде, ≈ кг на 100 л) + ксантан X кг/м³ + ММГ M кг/м³. */
function bentPolymerProps(cPct: number, xKg: number, mmhKg: number, tC: number) {
  const mmhMult = mmhKg > 0 && cPct >= 3 ? 1 + 2.2 * Math.min(1.5, mmhKg) : 1;
  const tMult = 1 + 0.004 * Math.max(0, Math.min(120, tC) - 25); // термофлокуляция бентонита
  const xT = tC > 120 ? Math.max(0.2, 1 - (tC - 120) / 40) : 1;     // деструкция ксантана
  const g10s = (0.25 * cPct * cPct * mmhMult * tMult) + 1.6 * xKg * xT;
  const g10min = (0.45 * cPct * cPct * mmhMult * tMult) + 2.0 * xKg * xT;
  const yp = (0.35 * cPct * cPct * Math.sqrt(mmhMult)) + 3.5 * xKg * xT;
  const pv = 3 + 1.2 * cPct + 2.5 * xKg;
  return { g10s, g10min, yp, pv };
}

/** Утяжеление баритом до плотности: возвращает кг барита и л воды на 1 м³ при заданных добавках на 1 м³ воды. */
function weightUp(targetRho: number, solidsPerM3Water: { kg: number; sg: number }[]): { bariteKg: number; waterL: number; rho: number } {
  // На 1 м³ воды: масса и объём добавок
  const mAdd = solidsPerM3Water.reduce((t, s) => t + s.kg, 0);
  const vAdd = solidsPerM3Water.reduce((t, s) => t + s.kg / s.sg / 1000, 0);
  const rho0 = (1000 + mAdd) / (1 + vAdd) / 1000;
  let barite = 0;
  if (targetRho > rho0) barite = ((targetRho * (1 + vAdd)) - (1000 + mAdd) / 1000) * 1000 / (1 - targetRho / BARITE_SG);
  const vTot = 1 + vAdd + barite / BARITE_SG / 1000; // м³ смеси на 1 м³ воды
  const rho = (1000 + mAdd + barite) / vTot / 1000;
  return { bariteKg: barite / vTot, waterL: 1000 / vTot, rho };
}

export function designPill(needGel10sPa: number, densityGcm3: number, bhctC: number, volumeM3: number): PillDesign {
  const warnings: string[] = [], notes: string[] = [], procedure: string[] = [];
  const need = Math.max(0, needGel10sPa);
  let type: PillType = need <= 30 ? "bentonitePolymer" : need <= 60 ? "mmh" : need <= 250 ? (bhctC <= 90 ? "crosslinkedPAA" : "silicate") : "none";
  if (densityGcm3 > 1.6 && (type === "bentonitePolymer" || type === "mmh")) notes.push("Высокая плотность пачки: часть структуры даёт барит; бентонит снижен, чтобы не загустить сверх прокачиваемости.");

  const comps: PillComponent[] = [];
  let pred = { pv: 0, yp: 0, gel10s: 0, gel10min: 0 } as PillDesign["predicted"];

  if (type === "bentonitePolymer" || type === "mmh") {
    // Подбор: бентонит 4–10%, ксантан 1–6 кг/м³, ММГ 0,5–1,5 кг/м³ (только для «mmh»)
    let best: { c: number; x: number; m: number; p: ReturnType<typeof bentPolymerProps>; score: number } | null = null;
    for (let c = 4; c <= 10; c += 0.5) for (let x = 1; x <= 6; x += 0.5) for (const m of type === "mmh" ? [0.5, 0.75, 1, 1.25, 1.5] : [0]) {
      const p = bentPolymerProps(c, x, m, bhctC);
      const ok = p.g10s >= need && p.yp <= 60;
      const score = (ok ? 0 : 1000 + (need - p.g10s) * 10) + c * 2 + x * 3 + m * 5; // минимум реагентов
      if (!best || score < best.score) best = { c, x, m, p, score };
    }
    const b = best!;
    pred = { pv: b.p.pv, yp: b.p.yp, gel10s: b.p.g10s, gel10min: b.p.g10min };
    comps.push({ name: "Бентонит (глинопорошок ПБМА/ПБМБ), предгидратированный", purpose: "Структура и СНС пачки", kgPerM3: b.c * 10, sg: BENT_SG });
    comps.push({ name: "Ксантановая камедь (биополимер)", purpose: "Вязкость, СНС, удержание утяжелителя", kgPerM3: b.x, sg: 1.5 });
    if (b.m > 0) comps.push({ name: "ММГ — смешанный гидроксид металлов (Mg/Al)", purpose: "Резкий рост СНС бентонитовой суспензии («твердеющая» при покое структура)", kgPerM3: b.m, sg: 2.4 });
    comps.push({ name: "Кальцинированная сода", purpose: "Связывание жёсткости воды, лучшая гидратация бентонита", kgPerM3: 1, sg: 2.5 });
    if (bhctC > 120) warnings.push(`BHCT ${bhctC.toFixed(0)} °C: ксантан разрушается выше ~120 °C — замените термостойким полимером (сульфированный, AMPS) и подтвердите СНС при температуре.`);
    procedure.push(
      "Вода техническая пресная; ввести кальцинированную соду.",
      "Ввести бентонит через гидроворонку, перемешивать и выдержать на гидратацию не менее 4–6 ч (предгидратация).",
      "Ввести ксантан медленно через гидроворонку, перемешивать до однородности 30–60 мин.",
      ...(b.m > 0 ? ["Ввести ММГ в последнюю очередь (суспензия резко загустевает) — непосредственно перед закачкой."] : []),
      "Утяжелить баритом до проектной плотности (если требуется); контроль плотности и СНС 10 с / 10 мин перед закачкой.",
    );
  } else if (type === "crosslinkedPAA") {
    comps.push({ name: "Полиакриламид (ПАА, средне- или высокомолекулярный)", purpose: "Основа сшиваемого геля", kgPerM3: 8, sg: 1.3 });
    comps.push({ name: "Ацетат хрома (III) — сшиватель", purpose: "Сшивка ПАА в гель, время гелеобразования по температуре", kgPerM3: 0.8, sg: 1.3 });
    comps.push({ name: "Бентонит (глинопорошок)", purpose: "Несущая вязкость до сшивки, удержание барита", kgPerM3: 30, sg: BENT_SG });
    const gelTime = Math.round(240 * Math.exp(-0.045 * (bhctC - 40)));
    pred = { pv: 25, yp: 15, gel10s: Math.max(need, 150), gel10min: Math.max(need * 1.5, 250), gelTimeMin: gelTime };
    notes.push(`Время гелеобразования при ${bhctC.toFixed(0)} °C ≈ ${gelTime} мин — должно быть больше времени закачки и продавки пачки, но меньше времени до установки цемента.`);
    procedure.push(
      "Приготовить бентонитовую суспензию 3% на пресной воде, выдержать на гидратацию.",
      "Ввести ПАА через гидроворонку, перемешать до полного растворения (1–2 ч).",
      "Сшиватель ввести непосредственно перед закачкой; время гелеобразования подтвердить пробой при BHCT.",
    );
    warnings.push("Время гелеобразования сшитых гелей сильно зависит от температуры и воды — обязательна проба при BHCT на фактических реагентах.");
  } else if (type === "silicate") {
    comps.push({ name: "Жидкое стекло натриевое (силикатный модуль 2,8–3,0)", purpose: "Гелеобразующая основа", kgPerM3: 250, sg: 1.45, isLiquid: true });
    comps.push({ name: "Бентонит (глинопорошок)", purpose: "Несущая вязкость", kgPerM3: 30, sg: BENT_SG });
    comps.push({ name: "Хлорид кальция (раствор 10–15%) — активатор, отдельной порцией за пачкой", purpose: "Гелеобразование силиката на контакте", kgPerM3: 40, sg: 1.96 });
    pred = { pv: 20, yp: 12, gel10s: Math.max(need, 200), gel10min: Math.max(need * 1.5, 400), gelTimeMin: 20 };
    procedure.push(
      "Приготовить бентонитовую суспензию 3%, ввести жидкое стекло.",
      "Закачать пачку, за ней — порцию раствора CaCl₂ (активатор) объёмом 10–20% объёма пачки, разделив буфером пресной воды.",
      "Гелеобразование на контакте; прочность структуры подтвердить пробой.",
    );
    warnings.push("Силикат несовместим с цементом при прямом смешении (ускоряет схватывание): между пачкой и цементом — буфер пресной воды.");
  } else {
    warnings.push(`Нужный СНС ${need.toFixed(0)} Па выше возможностей пачек (~250 Па) — установите механическую опору (пакер-пробка, цементировочная корзина) или мост на ранее установленный мост.`);
  }

  // Утяжеление до плотности
  const solids = comps.filter((c) => !c.isLiquid).map((c) => ({ kg: c.kgPerM3, sg: c.sg }));
  const liquids = comps.filter((c) => c.isLiquid).map((c) => ({ kg: c.kgPerM3, sg: c.sg }));
  const w = weightUp(densityGcm3, [...solids, ...liquids]);
  const scale = w.waterL / 1000; // добавки заданы на 1 м³ воды → на 1 м³ пачки
  comps.forEach((c) => { c.kgPerM3 = Math.round(c.kgPerM3 * scale * 10) / 10; });
  if (w.bariteKg > 1) {
    comps.push({ name: "Барит (утяжелитель)", purpose: `Плотность пачки ${densityGcm3.toFixed(2)} г/см³ — как у раствора ниже (без новой неустойчивой границы)`, kgPerM3: Math.round(w.bariteKg), sg: BARITE_SG });
    pred.pv *= 1 + 0.3 * (w.bariteKg / 500);
  }
  const rho = w.bariteKg > 1 ? densityGcm3 : w.rho;
  if (rho < densityGcm3 - 0.01) notes.push(`Плотность без утяжелителя ${rho.toFixed(2)} г/см³.`);
  if (densityGcm3 < w.rho - 0.01) warnings.push(`Заданная плотность ${densityGcm3.toFixed(2)} ниже достижимой с этими реагентами (${w.rho.toFixed(2)} г/см³).`);

  return {
    type, targetGel10sPa: need, densityGcm3: Math.max(rho, densityGcm3), components: comps, waterLPerM3: Math.round(w.waterL),
    predicted: { ...pred, pv: Math.round(pred.pv), yp: Math.round(pred.yp * 10) / 10, gel10s: Math.round(pred.gel10s * 10) / 10, gel10min: Math.round(pred.gel10min * 10) / 10 },
    meets: type !== "none" && pred.gel10s >= need - 0.5,
    volumeM3, procedure, warnings, notes,
  };
}
