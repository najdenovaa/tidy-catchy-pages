/**
 * РИР, этап 5: согласованный план (состав ↔ моделирование) и автоподбор технологии.
 *
 * planRir: рецептура подбирается на требуемое время жизни; если по моделированию работа с
 * составом занимает > 75% его времени жизни, требование увеличивается до (экспозиция / 0,7)
 * и рецептура пересчитывается (одна итерация, обычно достаточно).
 *
 * autoDesignRir: перебор инструмента (ретейнер / пакер), глубины его установки, состава
 * (с правилом проходимости 3·d95), числа ступеней и выдержки; для каждого варианта —
 * полный расчёт + рецептура + моделирование задавливания. Оценка (меньше — лучше):
 * результат (задавлено / частично / нет) ≫ запас времени жизни > время операции >
 * стоимость материалов и операций (разбуривание ретейнера, риск прихвата пакера).
 */
import { calculateRir, D95_UM, COMPOSITION_LABEL, type CompositionKind, type RirInputs, type RirResult, type ToolKind } from "./rir-calculations";
import { designRirComposition, resinViscosityTarget, type RirCompositionResult } from "./rir-compositions";
import { simulateSqueeze, type SqueezeSimResult } from "./rir-squeeze-sim";

export interface RirPlan {
  comp: RirCompositionResult | null;
  sim: SqueezeSimResult;
  /** Требование к времени жизни, по которому подобрана рецептура, мин */
  requiredWorkLifeMin: number;
  /** Требование увеличено по результатам моделирования */
  extendedByModel: boolean;
}

function design(inp: RirInputs, res: RirResult, requiredMin: number) {
  return designRirComposition(res.composition, {
    bhctC: res.temps.bhctC, bhstC: res.temps.bhstC, requiredWorkLifeMin: requiredMin, volumeM3: res.volumes.totalM3,
    targetDensity: inp.compositionDensity, gasTight: inp.leak.kind === "intercasing" && inp.leak.annulusPressureMPa > 0,
    maxViscosityMPas: resinViscosityTarget(res.apertureUm),
  }, res.volumes.squeezeM3);
}

export function planRir(inp: RirInputs, res: RirResult): RirPlan {
  let required = res.timing.requiredWorkLifeMin;
  let comp = design(inp, res, required);
  let sim = simulateSqueeze(inp, res, comp?.primary ?? null);
  let extended = false;
  if (comp && sim.workLifeUsedPct > 75) {
    const exposure = (sim.workLifeUsedPct / 100) * comp.primary.workLifeAtBhctMin;
    const req2 = Math.ceil(exposure / 0.7 / 10) * 10;
    if (req2 > required) {
      const comp2 = design(inp, res, req2);
      const sim2 = comp2 ? simulateSqueeze(inp, res, comp2.primary) : sim;
      if (comp2 && sim2.workLifeUsedPct < sim.workLifeUsedPct) { comp = comp2; sim = sim2; required = req2; extended = true; }
    }
  }
  return { comp, sim, requiredWorkLifeMin: required, extendedByModel: extended };
}

export interface RirVariant {
  id: string;
  tool: ToolKind;
  toolDepthMD: number;
  composition: CompositionKind;
  stages: number;
  holdMin: number;
  outcome: SqueezeSimResult["outcome"];
  totalTimeMin: number;
  workLifeUsedPct: number;
  compInChannelL: number;
  squeezeL: number;
  totalM3: number;
  costIndex: number;
  score: number;
  reasons: string[];
}

export interface RirAutoResult {
  variants: RirVariant[];
  best: RirVariant | null;
  evaluated: number;
  notes: string[];
}

/** Относительная стоимость материалов на 1 м³ (цемент = 1). */
const COST_REL: Record<CompositionKind, number> = { cement: 1, microcement: 6, resin: 45, resin_micro: 15 };

export function autoDesignRir(base: RirInputs): RirAutoResult {
  const notes: string[] = [];
  const res0 = calculateRir(base);
  const ap = res0.apertureUm;
  const comps = (["cement", "microcement", "resin", "resin_micro"] as CompositionKind[]).filter((k) => {
    if (k === "resin") return true;
    if (ap === null) return k !== "cement";
    return ap >= 3 * D95_UM[k];
  });
  if (ap !== null) notes.push(`Раскрытие канала ~${ap.toFixed(0)} мкм: допустимы ${comps.map((k) => COMPOSITION_LABEL[k].split(" (")[0]).join(", ")}.`);
  const tools: ToolKind[] = base.tool.kind === "bradenhead" ? ["bradenhead", "retainer", "packer"] : ["retainer", "packer"];
  const top = base.leak.topMD;
  const depthsFor = (t: ToolKind) => t === "bradenhead" ? [0]
    : [...new Set([base.tool.setDepthMD, top - 10, top - 30].filter((d) => d > 50 && d <= top - 5).map((d) => Math.round(d)))];
  const stagesSet = [2, 3, 4, 6];
  const holdSet = [5, 10, 15];

  const out: RirVariant[] = [];
  let n = 0;
  for (const tool of tools) for (const depth of depthsFor(tool)) for (const composition of comps) {
    // объём, давление, рецептура не зависят от ступеней — считаем один раз
    const inp0: RirInputs = { ...base, tool: { ...base.tool, kind: tool, setDepthMD: depth || base.tool.setDepthMD }, composition };
    const res = calculateRir(inp0);
    if (res.maxBhpMPa <= (res.fit?.openingBhpMPa ?? 0)) continue;
    for (const stages of stagesSet) for (const holdMin of holdSet) {
      const inp: RirInputs = { ...inp0, hesitationStages: stages, hesitationHoldMin: holdMin };
      const r = calculateRir(inp);
      const plan = planRir(inp, r);
      n++;
      const s = plan.sim;
      const reasons: string[] = [];
      let score = 0;
      if (s.outcome === "partial") score += 1000;
      if (s.outcome === "no_squeeze") score += 3000;
      if (s.workLifeUsedPct > 75) score += (s.workLifeUsedPct - 75) * 15 + (s.workLifeUsedPct > 100 ? 1500 : 0);
      score += s.totalTimeMin;
      const cost = COST_REL[composition] * r.volumes.totalM3;
      score += cost * 8;
      if (tool === "retainer") { score += 60; reasons.push("ретейнер: стингер выходит под давлением (обратный клапан), но нужно разбуривание"); }
      if (tool === "packer" && composition !== "resin") { score += 40; reasons.push("пакер: без разбуривания, но риск прихвата суспензией над пакером"); }
      if (tool === "packer" && composition === "resin") reasons.push("пакер со смолой: состав доводится до нарушения, извлекается без разбуривания");
      const fillShare = r.volumes.squeezeM3 > 0 ? s.compInChannelM3 / r.volumes.squeezeM3 : 0;
      score -= Math.min(1, fillShare) * 150;
      if (holdMin < 10) score += 25; // короткая выдержка — меньше уверенности в «стоп-давлении»
      if (plan.extendedByModel) reasons.push(`время жизни состава увеличено до ${plan.requiredWorkLifeMin} мин по моделированию`);
      out.push({
        id: `${tool}-${depth}-${composition}-${stages}-${holdMin}`, tool, toolDepthMD: depth, composition, stages, holdMin,
        outcome: s.outcome, totalTimeMin: s.totalTimeMin, workLifeUsedPct: s.workLifeUsedPct,
        compInChannelL: s.compInChannelM3 * 1000, squeezeL: r.volumes.squeezeM3 * 1000, totalM3: r.volumes.totalM3,
        costIndex: cost, score, reasons,
      });
    }
  }
  out.sort((a, b) => a.score - b.score);
  const best = out[0] ?? null;
  if (!best) notes.push("Нет вариантов с допустимым давлением выше давления начала приёмистости — задавливание в окне давлений невозможно.");
  else if (best.outcome !== "sealed") notes.push("Ни один вариант не даёт уверенного задавливания по расчёту — нужны изменения условий (окно давлений, противодавление, другой интервал установки).");
  return { variants: out, best, evaluated: n, notes };
}

export function applyVariant(inp: RirInputs, v: RirVariant): RirInputs {
  return {
    ...inp, composition: v.composition, hesitationStages: v.stages, hesitationHoldMin: v.holdMin,
    tool: { ...inp.tool, kind: v.tool, setDepthMD: v.tool === "bradenhead" ? inp.tool.setDepthMD : v.toolDepthMD },
  };
}
