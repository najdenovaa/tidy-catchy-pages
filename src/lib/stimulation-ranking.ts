import { STIMULATION_METHODS, type StimulationMethod, type CollectorType } from "./stimulation-methods";
import type { DamageAssessment } from "./foam-treatment-diagnostics";

export interface ReservoirData {
  collectorType: CollectorType;
  temperatureC: number;
  permeability_mD: number;
  porosity: number;
  payZoneM: number;
  reservoirPressureMPa: number;
}

export interface RankedMethod {
  method: StimulationMethod;
  score: number;          // 0..100
  reasons: string[];
  warnings: string[];
}

export function rankMethods(
  reservoir: ReservoirData,
  damage: DamageAssessment[] = [],
): RankedMethod[] {
  return STIMULATION_METHODS.map((method) => {
    let score = 0;
    const reasons: string[] = [];
    const warnings: string[] = [];

    // 1. Коллектор (30)
    if (method.collectorTypes.includes(reservoir.collectorType)) {
      score += 30;
      reasons.push(`Подходит для ${reservoir.collectorType}`);
    } else {
      warnings.push(`Не для ${reservoir.collectorType}`);
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

    // Контриндикации
    for (const c of method.contraindications) {
      const low = c.toLowerCase();
      if (low.includes("терриген") && reservoir.collectorType === "sandstone") { score -= 20; warnings.push(`Противопоказано: ${c}`); }
      if (low.includes("карбонат") && reservoir.collectorType === "carbonate") { score -= 20; warnings.push(`Противопоказано: ${c}`); }
    }

    return {
      method,
      score: Math.max(0, Math.min(100, Math.round(score))),
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
