import { buildDisplacementSchedule, type DisplacementFluid, type PressurePoint } from './cementing-calculations';

export interface DisplacementPlanStage {
  key: string;
  name: string;
  fromM3: number;
  toM3: number;
  rateLps: number;
  endMin: number | null;
}

export interface DisplacementLimitPoint {
  volumeM3: number;
  rateLps: number;
}

export function displacementPlanStages(fluids: DisplacementFluid[], volumeM3: number): DisplacementPlanStage[] {
  if (!(volumeM3 > 0) || !Number.isFinite(volumeM3)) return [];
  let volume = 0;
  let time: number | null = 0;
  return buildDisplacementSchedule(fluids, volumeM3).map(step => {
    const fromM3 = volume;
    volume += step.volumeM3;
    time = time === null || !(step.rateLps > 0) ? null : time + step.volumeM3 / (step.rateLps * .06);
    return { key: `${step.fluidIndex}-${step.stepIndex}`, name: step.name, fromM3, toM3: volume, rateLps: step.rateLps, endMin: time };
  });
}

export function displacementLimitCurve(points: PressurePoint[]): DisplacementLimitPoint[] {
  const first = points.findIndex(point => point.processKind === 'displacement');
  if (first < 1) return [];
  const before = points[first - 1];
  const base = before.cumulativeVolume;
  const curve: DisplacementLimitPoint[] = [];
  if (before.processKind !== 'start' && before.fracturePressure > 0 && Number.isFinite(before.maxSafeRateLps)) {
    curve.push({ volumeM3: 0, rateLps: before.maxSafeRateLps });
  }
  for (let i = first; i < points.length; i++) {
    const point = points[i];
    if (point.processKind !== 'displacement') break;
    if (!(point.fracturePressure > 0) || !Number.isFinite(point.maxSafeRateLps)) return [];
    const volumeM3 = point.cumulativeVolume - base;
    const previous = curve.at(-1);
    if (previous && Math.abs(previous.volumeM3 - volumeM3) < 1e-8) {
      previous.rateLps = Math.min(previous.rateLps, point.maxSafeRateLps);
    } else {
      curve.push({ volumeM3, rateLps: point.maxSafeRateLps });
    }
  }
  return curve;
}

export function displacementStageLimit(stage: DisplacementPlanStage, curve: DisplacementLimitPoint[], factor = 1, equipment?: number) {
  let limit = equipment ?? Infinity;
  for (let i = 0; i < curve.length; i++) {
    const point = curve[i];
    if (point.volumeM3 >= stage.fromM3 - 1e-8 && point.volumeM3 <= stage.toM3 + 1e-8) {
      limit = Math.min(limit, point.rateLps * factor);
    }
    const next = curve[i + 1];
    if (!next) continue;
    for (const boundary of [stage.fromM3, stage.toM3]) {
      if (boundary > point.volumeM3 && boundary < next.volumeM3) {
        const part = (boundary - point.volumeM3) / (next.volumeM3 - point.volumeM3);
        limit = Math.min(limit, (point.rateLps + part * (next.rateLps - point.rateLps)) * factor);
      }
    }
  }
  return Number.isFinite(limit) ? limit : null;
}
