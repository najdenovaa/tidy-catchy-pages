/// <reference lib="webworker" />
import { simulateDisplacement2D } from "@/lib/displacement-2d";
import { buildDisplacementInput } from "@/lib/displacement-2d-input";

type Msg = { id: number; data: Parameters<typeof buildDisplacementInput>[0]; fine?: boolean };

self.onmessage = (e: MessageEvent<Msg>) => {
  const { id, data, fine } = e.data;
  try {
    const { input, meta } = buildDisplacementInput(data);
    let last = 0;
    const result = simulateDisplacement2D({
      ...input,
      nZ: fine ? Math.round(Math.min(400, Math.max(120, (input.zBot - input.zTop) / 2.5))) : undefined,
      nTheta: fine ? 24 : input.nTheta,
      onProgress: (f) => { const now = Date.now(); if (now - last > 150) { last = now; (self as unknown as Worker).postMessage({ id, progress: f }); } },
    });
    // geom — функция, её не передаём; остальное — структурно клонируемо
    (self as unknown as Worker).postMessage({ id, result, meta, stages: input.stages, zTop: input.zTop, zBot: input.zBot });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String((err as Error)?.message ?? err) });
  }
};
