/// <reference lib="webworker" />
import {
  simulateFoamJob,
  optimiseFoamJob,
  sizeFoamPlacement,
} from "./foam-cement-engine";
import type { FoamJobInput } from "./foam-cement-types";
self.onmessage = (
  event: MessageEvent<{
    id: number;
    task: "simulate" | "optimise" | "sensitivity" | "size";
    input: FoamJobInput;
    objective?: "nitrogen" | "time";
  }>,
) => {
  const { id, task, input, objective } = event.data;
  try {
    let result: unknown;
    if (task === "simulate") result = simulateFoamJob(input);
    else if (task === "size") result = sizeFoamPlacement(input);
    else if (task === "optimise") result = optimiseFoamJob(input, objective);
    else {
      result = [
        ["Температура -10 °C", -10, 1],
        ["Температура +10 °C", 10, 1],
        ["PV -20%", 0, 0.8],
        ["PV +20%", 0, 1.2],
      ].map(([label, dt, k]) => {
        const j = structuredClone(input);
        j.settings.bottomTemperature += Number(dt);
        j.settings.liquidPV *= Number(k);
        j.settings.spatialCells = Math.min(32, j.settings.spatialCells);
        j.settings.timeStepMin = Math.max(0.8, j.settings.timeStepMin);
        const r = simulateFoamJob(j);
        return {
          label,
          n2: r.design.n2StdM3,
          pressure: r.summary.maxPumpPressureMPa,
          ecd: r.summary.maxECD,
          toc: r.summary.finalTOCMD,
        };
      });
    }
    self.postMessage({ id, result });
  } catch (e) {
    self.postMessage({ id, error: e instanceof Error ? e.message : String(e) });
  }
};
