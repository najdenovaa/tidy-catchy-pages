/**
 * Canonical cementing hydraulics entry point.
 * All UI, optimizer and exports must import from this module.
 * Current compatible implementation remains V1 until V2 covers the full
 * PressureProfileResult contract (points, envelope, zone checks, stages,
 * freefall, stops, WOC and safe-rate analysis). Do not combine partial
 * V2 values with V1 outputs: that would make charts inconsistent.
 */
export {
  calculatePressureProfile,
  type PressureProfileResult,
  type PressurePoint,
  type ZoneCheck,
  type DepthEnvelopePoint,
} from "./cementing-calculations";
