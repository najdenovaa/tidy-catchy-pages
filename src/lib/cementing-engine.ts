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

/** Charts can only receive restart frames carried by the canonical engine result.
 * V1 intentionally has no V2 overlay: no parallel simulation or mixed provenance.
 */
import type { PressureProfileResult } from "./cementing-calculations";
import { toRestartChartDataV2, type RestartChartFrameV2 } from "./advanced-v2-chart-data";
export function getRestartChartFrames(result:PressureProfileResult):RestartChartFrameV2[]|undefined {
 const frames=(result as PressureProfileResult & {restartPressureFrames?:RestartChartFrameV2[]}).restartPressureFrames;
 return frames ? toRestartChartDataV2(frames) : undefined;
}
