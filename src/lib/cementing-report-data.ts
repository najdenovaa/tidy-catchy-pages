import { buildCentralizerJointSchedule, type CentralizerJointRow } from './centralizer-layout';
export { buildCentralizerJointSchedule } from './centralizer-layout';
import { WELL_GEOMETRY_MODEL_VERSION } from "./well-geometry";
import type { WellData, BufferFluid, SlurryInput, DrillingFluid, DisplacementFluid, VolumeResults } from "./cementing-calculations";
import { calculateCentralization, autoPlaceCentralizers, type CentralizationResult, type CentralizerInterval, type CentralizerSpec, type TurbulatorPoint, type AutoPlacementInterval } from "./centralization-calculations";
import type { D2Result, D2Stage } from "./displacement-2d";
import type { D2Meta } from "./displacement-2d-input";
export interface CentralizationReportData {
  running?: { mudDensity:number; pv:number; yp:number; pipeWeightKgPerM?:number; frictionCased:number; frictionOpenhole:number };
  mode: "manual" | "auto"; targetStandoff?: number;
  autoSpec?: CentralizerSpec; jointLength?: number;
  intervals: CentralizerInterval[]; results: CentralizationResult[];
  turbPoints: TurbulatorPoint[]; autoResults?: AutoPlacementInterval[];
  selectedMD?: number; calculated: boolean;
  joints?: (Omit<CentralizerJointRow,"placements"> & {placements?:CentralizerJointRow["placements"]})[];
}
export interface DisplacementReportSettings { rotationRpm: number; settleMin: number; fine: boolean; }
export interface DisplacementReportData {
  inputKey: string; result: D2Result; meta: D2Meta; stages: D2Stage[]; settings: DisplacementReportSettings;
}
export type DisplacementReportInput = { flushTimeMin?:number;flushVolumeM3?:number;wellData: WellData; slurries: SlurryInput[]; buffers: BufferFluid[];
  drillingFluid: DrillingFluid; displacementFluids: DisplacementFluid[]; volumes: VolumeResults };
export interface ReportSupplement {
  title: string; paragraphs: string[]; tables: { headers: string[]; rows: string[][] }[];
}
export interface ReportFigure { sourceKey?:string; reportItem?: import("./cementing-report-options").ReportItem; title: string; dataUrl: string; width: number; height: number; }
export interface CementingReportExtras {
  centralization?: CentralizationReportData | null; displacement?: DisplacementReportData | null;
  figures?: ReportFigure[]; supplements?: ReportSupplement[]; warnings?: string[];
}
export function displacementReportKey(p: DisplacementReportInput, settings: DisplacementReportSettings) {
  return JSON.stringify([WELL_GEOMETRY_MODEL_VERSION, "process-contract-v1", p.wellData, p.slurries, p.buffers, p.drillingFluid, p.displacementFluids, p.volumes,p.flushTimeMin??0,p.flushVolumeM3??0, settings]);
}
export function resolveCentralizationReport(data: CentralizationReportData | null, w: WellData, mudDensity: number) {
  if (!data?.calculated) return null;
  let intervals = data.intervals, autoResults = data.autoResults;
  if (data.mode === "auto" && data.autoSpec && data.jointLength && data.targetStandoff) {
    autoResults = autoPlaceCentralizers(w, data.autoSpec, data.jointLength, data.targetStandoff, mudDensity,
      { pumpZoneTop: w.pumpZoneTop, pumpZoneBottom: w.pumpZoneBottom });
    intervals = autoResults.map((x, i) => ({ id: "report-" + i, fromMD: x.fromMD, toMD: x.toMD,
      centralizersPerJoint: x.centralizersPerJoint, jointLength: data.jointLength!, spec: data.autoSpec! }));
  }
  return { ...data, intervals, autoResults, results: calculateCentralization(w, intervals, mudDensity, undefined, data.turbPoints),
    // Existing installation sheet is valid only for the geometry which generated it.
    joints: buildCentralizerJointSchedule(w.casingDepthMD, intervals) };
}
export async function runDisplacementForReport(p: DisplacementReportInput, settings: DisplacementReportSettings): Promise<DisplacementReportData> {
  const worker = new Worker(new URL("../workers/displacement2d.worker.ts", import.meta.url), { type: "module" });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { worker.terminate(); reject(new Error("Расчёт замещения превысил 180 с")); }, 180000);
    const done = () => { clearTimeout(timer); worker.terminate(); };
    worker.onmessage = e => {
      const m = e.data; if (m.progress !== undefined) return;
      done();
      if (m.error) reject(new Error(m.error));
      else resolve({ inputKey: displacementReportKey(p, settings), result: m.result, meta: m.meta, stages: m.stages, settings });
    };
    worker.onerror = err => { done(); reject(new Error(err.message || "Не выполнен расчёт замещения")); };
    worker.postMessage({ id: 1, data: p, ...settings });
  });
}
