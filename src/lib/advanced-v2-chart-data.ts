/** Typed, presentation-only view of one coupled V2 restart result. */
import type { buildRestartPressureFramesV2 } from "./advanced-restart-pressure-frames-v2";
export type RestartChartFrameV2 = ReturnType<typeof buildRestartPressureFramesV2>[number];
export function toRestartChartDataV2(
 frames:ReturnType<typeof buildRestartPressureFramesV2>
):RestartChartFrameV2[]{
 if(frames.some(f=>![f.timeMin,f.pumpedM3,f.rateLps,f.surfacePressureMPa,
  f.baseSurfacePressureMPa,f.gelRestartExcessMPa,f.shoePressureMPa].every(Number.isFinite)))
  throw Error("Nonfinite V2 restart chart frame");
 return frames;
}
