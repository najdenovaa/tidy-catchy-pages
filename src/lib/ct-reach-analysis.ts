/**
 * Reach Analysis для ГНКТ.
 *
 * Что отвечает: «дойдёт ли ГНКТ до целевой глубины?»
 * Делает прогон calculateTubingForces по диапазону коэффициентов трения,
 * для каждого μ возвращает глубину запирания (lock-up depth).
 *
 * Результат — кривая «Достижимая глубина vs μ» + текстовые рекомендации.
 */

import {
  calculateTubingForces,
  type CTStringData,
  type WellGeometry,
  type FluidData,
  type ToolsData,
  type CTSection,
} from "./coiled-tubing-calculations";

export interface ReachSensitivityPoint {
  friction: number;
  lockUpDepth: number; // 0 = не запирается до total length
  canReach: boolean;
  marginM: number; // запас по глубине: lockUp - target (положителен = доходит)
}

export interface ReachAnalysisInput {
  ct: CTStringData;
  well: WellGeometry;
  fluid: FluidData;
  tools: ToolsData;
  sections?: CTSection[];
  targetDepthMD: number;
  baselineFriction: number;
  frictionMin?: number;
  frictionMax?: number;
  step?: number;
}

export interface ReachAnalysisResult {
  targetDepthMD: number;
  baselineFriction: number;
  baselineLockUpDepth: number;
  canReach: boolean;
  marginAtBaselineM: number;
  criticalFriction: number | null; // μ при котором lockUp = target (граница окна)
  sensitivity: ReachSensitivityPoint[];
  recommendations: string[];
}

/** Линейная интерполяция μ_crit: при какой μ lockUpDepth пересекает targetDepth (идёт сверху вниз). */
function findCriticalFriction(
  sens: ReachSensitivityPoint[],
  target: number,
): number | null {
  for (let i = 0; i < sens.length - 1; i++) {
    const a = sens[i];
    const b = sens[i + 1];
    const aReach = a.lockUpDepth === 0 || a.lockUpDepth >= target;
    const bReach = b.lockUpDepth === 0 || b.lockUpDepth >= target;
    if (aReach && !bReach) {
      // линейная интерполяция (lockUp падает с ростом μ)
      const aDepth = a.lockUpDepth === 0 ? target * 2 : a.lockUpDepth;
      const bDepth = b.lockUpDepth === 0 ? target * 2 : b.lockUpDepth;
      const k = (aDepth - target) / Math.max(1e-6, aDepth - bDepth);
      return a.friction + (b.friction - a.friction) * k;
    }
  }
  return null;
}

export function analyzeReach(input: ReachAnalysisInput): ReachAnalysisResult {
  const muMin = input.frictionMin ?? 0.15;
  const muMax = input.frictionMax ?? 0.45;
  const step = input.step ?? 0.025;
  const sens: ReachSensitivityPoint[] = [];

  for (let mu = muMin; mu <= muMax + 1e-9; mu += step) {
    const f = calculateTubingForces(
      input.ct,
      input.well,
      input.fluid,
      input.tools,
      Number(mu.toFixed(3)),
      input.sections,
    );
    const lockUp = f.lockUpDepth || 0;
    const reach = lockUp === 0 || lockUp >= input.targetDepthMD;
    sens.push({
      friction: Number(mu.toFixed(3)),
      lockUpDepth: lockUp,
      canReach: reach,
      marginM: (lockUp === 0 ? input.well.md : lockUp) - input.targetDepthMD,
    });
  }

  // baseline
  const base = calculateTubingForces(
    input.ct,
    input.well,
    input.fluid,
    input.tools,
    input.baselineFriction,
    input.sections,
  );
  const baseLockUp = base.lockUpDepth || 0;
  const canReach = baseLockUp === 0 || baseLockUp >= input.targetDepthMD;
  const marginAtBaseline =
    (baseLockUp === 0 ? input.well.md : baseLockUp) - input.targetDepthMD;

  const criticalFriction = findCriticalFriction(sens, input.targetDepthMD);

  // Рекомендации
  const recs: string[] = [];
  if (!canReach) {
    recs.push(
      `ГНКТ не достигает цели ${input.targetDepthMD.toFixed(0)} м при μ=${input.baselineFriction}: запирание на ${baseLockUp.toFixed(0)} м (недостача ${(-marginAtBaseline).toFixed(0)} м).`,
    );
    recs.push("Снизить μ: ввод смазки/ингибитора трения (PIPE-LAX, FR-66) до 30%.");
    recs.push("Увеличить плотность жидкости в затрубье для подъёма выталкивающей силы.");
    recs.push("Применить tractor (тяговое устройство) на горизонтальном участке.");
  } else if (marginAtBaseline < 200) {
    recs.push(
      `Достижение цели на пределе: запас ${marginAtBaseline.toFixed(0)} м. Любое увеличение μ приведёт к запиранию.`,
    );
    recs.push("Готовь смазочную пачку — снизит μ на 0.05–0.10.");
  } else {
    recs.push(
      `ГНКТ уверенно достигает цели: запас ${marginAtBaseline.toFixed(0)} м при μ=${input.baselineFriction}.`,
    );
  }

  if (criticalFriction != null) {
    recs.push(
      `Критическое трение μ_crit = ${criticalFriction.toFixed(3)} — при μ выше этого значения цель не достигается.`,
    );
  } else if (canReach) {
    recs.push(
      `Цель достигается во всём диапазоне μ=${muMin.toFixed(2)}…${muMax.toFixed(2)} — высокий запас по реологии.`,
    );
  }

  return {
    targetDepthMD: input.targetDepthMD,
    baselineFriction: input.baselineFriction,
    baselineLockUpDepth: baseLockUp,
    canReach,
    marginAtBaselineM: marginAtBaseline,
    criticalFriction,
    sensitivity: sens,
    recommendations: recs,
  };
}
