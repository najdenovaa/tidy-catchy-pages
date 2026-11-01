/** Explicit compatibility audit. No V1/V2 mixing or fabricated field defaults. */
import type { PressureProfileResult, PressurePoint, DepthEnvelopePoint, ZoneCheck } from "./cementing-calculations";

export type V2CompatibilityField =
  | "stageLabels" | "surfacePressure" | "bottomholePressure" | "fracturePressure"
  | "cumulativeVolume" | "pumpRate" | "annularReturns" | "annularRheology"
  | "safeFlowRate" | "fluidDensity" | "fluidHeights" | "freefall"
  | "equivalentCirculatingDensity" | "staticPressure" | "depthEnvelope"
  | "zoneChecks" | "safeWorkingTime" | "cementStartTime"
  | "operationStopTime" | "stageBoundaries" | "settlingTime";

export const V2_COMPATIBILITY: Readonly<Record<V2CompatibilityField, "implemented" | "missing">> = {
  stageLabels:"missing",surfacePressure:"implemented",bottomholePressure:"implemented",
  fracturePressure:"missing",cumulativeVolume:"implemented",pumpRate:"implemented",
  annularReturns:"implemented",annularRheology:"missing",safeFlowRate:"missing",
  fluidDensity:"missing",fluidHeights:"missing",freefall:"missing",
  equivalentCirculatingDensity:"implemented",staticPressure:"missing",
  depthEnvelope:"missing",zoneChecks:"missing",safeWorkingTime:"missing",
  cementStartTime:"missing",operationStopTime:"missing",stageBoundaries:"missing",
  settlingTime:"missing",
};

export const MISSING_V2_FIELDS: V2CompatibilityField[] = (Object.keys(V2_COMPATIBILITY) as V2CompatibilityField[])
  .filter(k=>V2_COMPATIBILITY[k]==="missing");

export function assertV2ReadyForUnifiedRelease(): void {
  if(MISSING_V2_FIELDS.length) throw new Error(
    "V2 cannot replace the unified pressure engine: "+MISSING_V2_FIELDS.join(", ")
  );
}

/** Compile-time contract: all downstream consumers depend on these exact types. */
export type EngineConsumerContract = {
  points:PressurePoint[];
  envelope:DepthEnvelopePoint[];
  zoneChecks:ZoneCheck[];
  result:PressureProfileResult;
};
