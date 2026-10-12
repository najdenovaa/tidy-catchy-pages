import { STIMULATION_METHODS, type StimulationMethod, type CollectorType } from "./stimulation-methods";
import type { DamageAssessment } from "./foam-treatment-diagnostics";

export type CementQuality = "good" | "partial" | "poor" | "unknown";

export interface ReservoirData {
  collectorType: CollectorType;
  temperatureC: number;
  permeability_mD: number;
  porosity: number;
  payZoneM: number;
  reservoirPressureMPa: number;
  /** Обводнённость продукции, % */
  waterCutPct?: number;
  /** Расстояние от подошвы перфорации до ВНК (ГВК), м. 0/undefined — не задано */
  distanceToContactM?: number;
  /** Качество цементирования в интервале (по АКЦ/СГДТ) */
  cementQuality?: CementQuality;
}

export interface RankedMethod {
  method: StimulationMethod;
  score: number;          // 0..100
  reasons: string[];
  warnings: string[];
}

/** Обработка без отклонения, которая идёт по пути наименьшего сопротивления (в т.ч. в водоносный пропласток). */
const isNonDivertedReactive = (m: StimulationMethod) =>
  (m.category === "acid" || m.category === "combo") && m.type !== "acid_diversion";
/** Пена/отклонитель снижают подвижность в водонасыщенных интервалах. */
const isWaterSelective = (m: StimulationMethod) =>
  m.category === "foam" || m.type === "acid_diversion" || m.type === "foam_acid_combo" || m.type === "acid_then_foam";

export const CEMENT_LABEL: Record<CementQuality, string> = {
  good: "сплошной контакт",
  partial: "частичный контакт",
  poor: "плохой / отсутствует",
  unknown: "нет данных",
};

export function rankMethods(
  reservoir: ReservoirData,
  damage: DamageAssessment[] = [],
): RankedMethod[] {
  return STIMULATION_METHODS.map((method) => {
    let score = 0;
    const reasons: string[] = [];
    const warnings: string[] = [];

    // 1. Коллектор (30) — несовместимый тип коллектора дисквалифицирует метод
    const collectorOk = method.collectorTypes.includes(reservoir.collectorType);
    if (collectorOk) {
      score += 30;
      reasons.push(`Подходит для типа коллектора`);
    } else {
      warnings.push(`Не предназначен для этого типа коллектора`);
    }

    // 2. Повреждение (30)
    const matched = damage.filter((d) => method.damageTypes.includes(d.mechanism));
    if (matched.length > 0) {
      const top = matched.reduce((a, b) => (a.probability > b.probability ? a : b));
      score += 30 * Math.min(1, top.probability);
      reasons.push(`Лечит: ${matched.map((d) => d.nameRu).join(", ")}`);
    } else if (method.damageTypes.length > 0) {
      warnings.push("Не покрывает выявленные повреждения");
    } else {
      score += 10; // универсальные методы (азотный лифт и т.п.)
    }

    // 3. Температура (15)
    if (reservoir.temperatureC >= method.tempRangeC[0] && reservoir.temperatureC <= method.tempRangeC[1]) {
      score += 15;
    } else {
      warnings.push(`T ${reservoir.temperatureC}°C вне ${method.tempRangeC.join("–")}°C`);
    }

    // 4. Проницаемость (15)
    if (reservoir.permeability_mD >= method.permRangeMd[0] && reservoir.permeability_mD <= method.permRangeMd[1]) {
      score += 15;
    } else {
      warnings.push(`k ${reservoir.permeability_mD} мД вне ${method.permRangeMd.join("–")} мД`);
    }

    // 5. Успешность (10)
    score += method.successRate * 0.10;

    // 6. Риск обводнения: близкий ВНК, плохой цемент, высокая обводнённость
    const wc = reservoir.waterCutPct ?? 0;
    const dist = reservoir.distanceToContactM ?? 0;
    const cement = reservoir.cementQuality ?? "unknown";
    if (isNonDivertedReactive(method)) {
      if (dist > 0 && dist < 5) { score -= 25; warnings.push(`ВНК в ${dist} м от перфорации — кислота без отклонения откроет путь воде`); }
      else if (dist > 0 && dist < 15) { score -= 10; warnings.push(`ВНК в ${dist} м — ограничить объём и давление, рассмотреть отклонитель`); }
      if (cement === "poor") { score -= 20; warnings.push("Плохой цемент за колонной — кислота уйдёт в заколонные перетоки"); }
      else if (cement === "partial") { score -= 8; warnings.push("Частичный контакт цемента — риск заколонного перетока"); }
      if (wc > 70) { score -= 15; warnings.push(`Обводнённость ${wc}% — кислота пойдёт в обводнённые интервалы`); }
      else if (wc > 40) { score -= 5; warnings.push(`Обводнённость ${wc}% — нужен контроль отклонения`); }
      if (method.type === "acid_fracturing" && dist > 0 && dist < 30) {
        score -= 20; warnings.push("Кислотный ГРП при близком ВНК — трещина может дойти до воды");
      }
    }
    if (isWaterSelective(method) && (wc > 40 || (dist > 0 && dist < 15))) {
      score += 8; reasons.push("Пена/отклонитель снижают приёмистость водонасыщенных интервалов");
    }
    if (cement === "poor" && method.category !== "nitrogen" && method.category !== "physical") {
      warnings.push("Перед обработкой рекомендуется РИР (восстановление крепи) — см. модуль цементирования");
    }

    const raw = Math.max(0, Math.min(100, Math.round(score)));
    return {
      method,
      score: collectorOk ? raw : Math.min(raw, 30),
      reasons,
      warnings,
    };
  }).sort((a, b) => b.score - a.score);
}

export function scoreColor(score: number): "green" | "yellow" | "gray" {
  if (score >= 80) return "green";
  if (score >= 50) return "yellow";
  return "gray";
}
