import type { CentralizerSpec } from './centralization-calculations';
import { inspectCentralizer } from './centralizer-clearance';
import type { Vec3 } from './centralizer-mesh';
/** One source for the mesh, free reference, longitudinal profile and midspan cross-section.
 * Contact-constrained bow approximation, not a stress/large-deflection beam solver. Millimetres. */
export function centralizerShape(spec: CentralizerSpec, casingOD: number, bore: number, ecc: number) {
  const g = inspectCentralizer(spec, casingOD, bore, ecc);
  if (!g) return null;
  const p = spec.passport!;
  const ringRadius = p.ringOD ? p.ringOD / 2 : Math.max(g.pipeRadius + 3, (p.innerDiameter ?? casingOD) / 2 + 2);
  const activeLength = p.springLength ?? g.length * .72;
  const ringLength = Math.max(1, Math.min(g.length * .45, p.ringLength ?? (g.length - activeLength) / 2));
  return { ...g, spring: spec.type === 'spring', ringRadius, ringLength, bowLength: g.length - 2 * ringLength,
    thickness: p.materialThickness ?? 2, width: p.bladeWidth ?? Math.min(40, Math.PI * ringRadius / g.blades.length * .45),
    twist: spec.type === 'spring' ? 0 : (p.bladeAngle ?? 0) * Math.PI / 180,
  };
}
export type CentralizerShape = NonNullable<ReturnType<typeof centralizerShape>>;
export type ShapeBlade = CentralizerShape['blades'][number];
export type BowState = 'free' | 'installed' | 'loaded';
export function bladeRadius(g: CentralizerShape, b: ShapeBlade, t: number, state: BowState = 'loaded', side = 0) {
  const bow = Math.sin(Math.PI * t);
  const outer = g.ringRadius + (b.freeRadius - g.ringRadius) * (g.spring ? bow : bow ** .3);
  const v = side * g.width / 2;
  const free = Math.sqrt(Math.max(0, outer ** 2 - v * v));
  if (!g.spring || state === 'free') return free;
  const offset = state === 'installed' ? 0 : g.offset;
  const a = b.angle;
  // Exact contact limit of a constant-width strip, including its two edges.
  const wall = -offset * Math.cos(a) + Math.sqrt(Math.max(0, g.boreRadius ** 2 - (offset * Math.sin(a) - v) ** 2));
  const centreWall = -offset * Math.cos(a) + Math.sqrt(Math.max(0, g.boreRadius ** 2 - offset ** 2 * Math.sin(a) ** 2));
  const compression = Math.max(0, b.freeRadius - centreWall);
  const deformed = free - compression * 16 * t * t * (1 - t) * (1 - t);
  const pipeLimit = Math.sqrt(Math.max(0, (g.pipeRadius + g.thickness) ** 2 - v * v));
  return Math.max(pipeLimit, Math.min(deformed, wall));
}
export function bladePoint(g: CentralizerShape, b: ShapeBlade, t: number, side = 0, inside = false, state: BowState = 'loaded'): Vec3 {
  const r = bladeRadius(g, b, t, state, side) - (inside ? g.thickness : 0);
  const a = b.angle + g.twist * (t - .5) * g.bowLength / Math.max(1, b.freeRadius);
  const v = side * g.width / 2;
  return [g.offset + r * Math.cos(a) - v * Math.sin(a), r * Math.sin(a) + v * Math.cos(a), (t - .5) * g.bowLength];
}
export function bladeCurve(g: CentralizerShape, b: ShapeBlade, state: BowState = 'loaded'): Vec3[] {
  return Array.from({ length: 65 }, (_, j) => bladePoint(g, b, j / 64, 0, false, state));
}
export function bladeSection(g: CentralizerShape, b: ShapeBlade, state: BowState = 'loaded'): Vec3[] {
  return [...Array.from({ length: 17 }, (_, j) => bladePoint(g, b, .5, -1 + j / 8, false, state)),
    ...Array.from({ length: 17 }, (_, j) => bladePoint(g, b, .5, 1 - j / 8, true, state))];
}
/** Apply the same display map to the bow AND bore wall, so amplified contact stays coincident. */
export function displayCentralizerPoint(g: CentralizerShape, v: Vec3, gain: number): Vec3 {
  const x = v[0] - g.offset, y = v[1], r = Math.hypot(x, y);
  const rr = r <= g.pipeRadius ? r : g.pipeRadius + (r - g.pipeRadius) * gain;
  return [g.offset * gain + (r ? x * rr / r : 0), r ? y * rr / r : 0, v[2]];
}
