import type { CentralizerSpec } from './centralization-calculations';
/** Circular local section. All dimensions in mm. Eccentricity comes from the engineering model, not a caliper measurement. */
export function inspectCentralizer(spec: CentralizerSpec, casingOD: number, boreDiameter: number, eccentricity: number) {
  const p = spec.passport;
  if (!p?.outerDiameter || !Number.isFinite(p.outerDiameter) || p.outerDiameter <= casingOD || !p.length || !Number.isFinite(p.length) || p.length <= 0 || !Number.isFinite(boreDiameter) || boreDiameter <= casingOD || casingOD <= 0 || !Number.isFinite(eccentricity)) return null;
  const boreRadius = boreDiameter / 2;
  const pipeRadius = casingOD / 2;
  const offset = Math.max(0, Math.min(1, eccentricity)) * (boreRadius - pipeRadius);
  const freeRadius = p.outerDiameter / 2;
  const blades = Array.from({length: Math.max(1, Math.min(32, Math.round(spec.bladesCount)))}, (_, i) => {
    const angle = i * Math.PI * 2 / Math.max(1, spec.bladesCount);
    // Distance from displaced pipe axis to the circular bore along a radial ray.
    const wallRadius = -offset * Math.cos(angle) + Math.sqrt(boreRadius ** 2 - offset ** 2 * Math.sin(angle) ** 2);
    const interference = Math.max(0, freeRadius - wallRadius);
    const loadedRadius = spec.type === 'spring' ? Math.max(pipeRadius, Math.min(freeRadius, wallRadius)) : freeRadius;
    return { index:i+1, angle, wallRadius, freeRadius, loadedRadius, compression:spec.type === 'spring' ? interference : 0, gap:wallRadius-loadedRadius, interference };
  });
  return { boreRadius, pipeRadius, offset, length:p.length, minPipeGap:boreRadius-pipeRadius-offset, maxPipeGap:boreRadius-pipeRadius+offset,
    annularArea:Math.PI*(boreRadius**2-pipeRadius**2), blades,
    rigidConflict:spec.type !== 'spring' && blades.some(b => b.interference > 0.1),
  };
}
