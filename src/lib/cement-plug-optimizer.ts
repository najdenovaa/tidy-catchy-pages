// ============================================================================
// Part 7 — Plug design optimizer.
// Minimizes WOC subject to purpose-driven constraints (UCS target,
// minimum length per regulation), choosing cement class and plug length.
//
// Search space: cement class × plug length grid.
// Objective:    min WOC_hours required to reach UCS_target at BHCT.
// Feasibility:  length ≥ length_min; WOC achievable (UCS_target < UCS_max).
// ============================================================================

import {
  compressiveStrengthVsTime,
  waitOnCementTime,
  type CementClass,
  CEMENT_CLASS_LABEL,
} from "./cement-plug-types";

export type PlugPurposeOpt =
  | "abandonment"   // ликвидация / изоляция
  | "kickoff"       // зарезка бокового
  | "pressureTest"  // опорный мост под опрессовку
  | "lostCirc";     // борьба с поглощением

export interface OptInput {
  purpose: PlugPurposeOpt;
  bhctC: number;
  boreDiameterMm: number;
  /** Maximum plug length acceptable (geometry/economics), m */
  maxPlugLengthM?: number;
  /** Test pressure if purpose=pressureTest, MPa (drives UCS target) */
  testPressureMPa?: number;
  /** Allowed cement classes (default: all) */
  allowedClasses?: CementClass[];
  /** Step for length grid, m (default 10) */
  lengthStepM?: number;
}

export interface OptCandidate {
  cementClass: CementClass;
  cementLabel: string;
  plugLengthM: number;
  ucsTargetMPa: number;
  wocHours: number;
  feasible: boolean;
  reason?: string;
  cementVolumeM3: number;
}

export interface OptResult {
  best: OptCandidate | null;
  top: OptCandidate[];           // top 5 feasible by WOC ascending
  ucsTargetMPa: number;
  minLengthM: number;
  /** Norm reference used */
  normNote: string;
  warnings: string[];
}

const ALL_CLASSES: CementClass[] = ["G", "H", "B", "PCT_I_100", "PCT_II_50"];

function purposeRequirements(p: PlugPurposeOpt, testP?: number): {
  ucs: number; minLen: number; norm: string;
} {
  switch (p) {
    case "abandonment":
      return { ucs: 3.5, minLen: 50, norm: "РФ ПБ НГП №534 §1112 / NORSOK D-010" };
    case "kickoff":
      return { ucs: 14, minLen: 30, norm: "Halliburton/SLB practice: UCS ≥ 14 МПа (≈2000 psi)" };
    case "pressureTest":
      return {
        // UCS must safely hold ΔP with factor 1.25; also ≥ 3.5 MPa minimum
        ucs: Math.max(3.5, (testP ?? 10) * 1.25),
        minLen: 30,
        norm: "API RP-65: UCS ≥ 1.25 × P_test",
      };
    case "lostCirc":
      return { ucs: 3.5, minLen: 30, norm: "API RP-65 (cement plug for losses)" };
  }
}

export function optimizePlugDesign(inp: OptInput): OptResult {
  const warnings: string[] = [];
  const req = purposeRequirements(inp.purpose, inp.testPressureMPa);
  const classes = inp.allowedClasses ?? ALL_CLASSES;
  const stepLen = inp.lengthStepM ?? 10;
  const Lmax = inp.maxPlugLengthM ?? 150;

  const lengths: number[] = [];
  for (let L = req.minLen; L <= Lmax + 1e-6; L += stepLen) lengths.push(L);
  if (lengths.length === 0) lengths.push(req.minLen);

  const D = inp.boreDiameterMm / 1000;
  const A = (Math.PI / 4) * D * D;

  const candidates: OptCandidate[] = [];
  for (const cls of classes) {
    for (const L of lengths) {
      let woc = waitOnCementTime(req.ucs, cls, inp.bhctC);
      let feasible = true;
      let reason: string | undefined;
      if (!isFinite(woc)) {
        feasible = false;
        reason = `${CEMENT_CLASS_LABEL[cls]} не достигает UCS = ${req.ucs.toFixed(1)} МПа при ${inp.bhctC}°C`;
        woc = 99999;
      }
      candidates.push({
        cementClass: cls,
        cementLabel: CEMENT_CLASS_LABEL[cls],
        plugLengthM: L,
        ucsTargetMPa: req.ucs,
        wocHours: feasible ? Math.round(woc * 10) / 10 : 99999,
        feasible,
        reason,
        cementVolumeM3: Math.round(A * L * 1000) / 1000,
      });
    }
  }

  const feasibleSorted = candidates
    .filter(c => c.feasible)
    .sort((a, b) =>
      a.wocHours - b.wocHours ||
      a.plugLengthM - b.plugLengthM ||
      a.cementVolumeM3 - b.cementVolumeM3);

  const best = feasibleSorted[0] ?? null;
  if (!best) warnings.push(`⛔ Нет реализуемых вариантов при BHCT = ${inp.bhctC}°C для UCS ≥ ${req.ucs.toFixed(1)} МПа.`);

  return {
    best,
    top: feasibleSorted.slice(0, 5),
    ucsTargetMPa: req.ucs,
    minLengthM: req.minLen,
    normNote: req.norm,
    warnings,
  };
}

/** UCS curve for the chosen best class — for charting */
export function bestUcsCurve(best: OptCandidate, bhctC: number, maxHours = 72) {
  const pts: { hours: number; ucs: number }[] = [];
  const steps = 36;
  for (let i = 0; i <= steps; i++) {
    const h = (i / steps) * maxHours;
    pts.push({ hours: h, ucs: compressiveStrengthVsTime(best.cementClass, bhctC, h) });
  }
  return pts;
}
