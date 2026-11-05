// @vitest-environment node
import { it, expect } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import { getCementingExample } from "../cementing-example";
import { calculateVolumes, calculatePressureProfile } from "../cementing-calculations";
import { buildDisplacementInput } from "../displacement-2d-input";
import { simulateDisplacement2D } from "../displacement-2d";
import { resolveCentralizationReport, displacementReportKey, type CementingReportExtras } from "../cementing-report-data";
import { buildCementingReportSvgs, buildHydraulicReportSvgs, buildWellReportSvgs } from "../cementing-report-figures";
import { exportToDocx } from "../export-docx";
import { REPORT_TEXT_WIDTH } from "../report-layout";
const ex = getCementingExample();
const w = { ...ex.wellData, wellDepthMD: 260, casingDepthMD: 250, wellDepthTVD: 241, prevCasingDepth: 60, ckodDepth: 235,
  reservoirLayers: [], pumpZoneTop: 0, pumpZoneBottom: 0, trajectory: [
    { md: 0, tvd: 0, zenith: 0, azimuth: 0 }, { md: 100, tvd: 98, zenith: 16, azimuth: 100 },
    { md: 260, tvd: 241, zenith: 35, azimuth: 112 },
  ] };
const slurries = ex.slurries.map((x, i) => ({ ...x, topDepthMD: i === 0 ? 45 : 150, washVolume: 0,
  flowRateSteps: [{ rateLps: 8, volumeM3: 1.5 }] }));
const buffers = ex.buffers.map(b => ({ ...b, volume: .8, flowRateSteps: [{ rateLps: 8, volumeM3: .8 }] }));
const volume = calculateVolumes(w, slurries);
const dData = { wellData: w, slurries, buffers, drillingFluid: ex.drillingFluid, displacementFluids: ex.displacementFluids, volumes: volume };
const settings = { fine: false, rotationRpm: 0, settleMin: 2 };
it("uses all physical inputs to invalidate a cached displacement run", () => {
  const p = { ...dData, wellData: { ...w, standoffProfile: [{ md: 100, standoffPct: 67 }] } };
  const key = displacementReportKey(p, settings);
  expect(displacementReportKey({ ...p, wellData: { ...p.wellData, standoffProfile: [{ md: 100, standoffPct: 41 }] } }, settings)).not.toBe(key);
  expect(displacementReportKey(p, { ...settings, fine: true })).not.toBe(key);
  expect(displacementReportKey({ ...p, buffers: buffers.map(b => ({ ...b, flowRateSteps: [{ rateLps: 6, volumeM3: .8 }] })) }, settings)).not.toBe(key);
});
it("exports a complete report with a full-width A4 grid, actual clearances and displacement frames", async () => {
  const cent = resolveCentralizationReport({
    mode: "manual", calculated: true, results: [], turbPoints: [{ id: "t1", md: 110, bladesCount: 4, bladeAngle: 45, bladeHeight: 12 }],
    intervals: [{ id: "c1", fromMD: 60, toMD: 250, jointLength: 12, centralizersPerJoint: 1, spec: {
      type: "spring", bladesCount: 6, bladeHeight: 40, restoringForce: 4, maxAxialLoad: 2,
      passport: { model: "Тестовый центратор 168", outerDiameter: 254, length: 620, bladeWidth: 40, springLength: 500, restoringStandoff: 67 }
    } }],
  }, w, ex.drillingFluid.density)!;
  expect(cent.joints?.some(j => j.centralizerDepths.length > 0)).toBe(true);
  expect(cent.joints![cent.joints!.length - 1].bottomMD).toBe(250);
  const reportWell = { ...w, standoffProfile: cent.results.map(r => ({ md: r.md, standoffPct: r.standoff })) };
  const { input, meta } = buildDisplacementInput({ ...dData, wellData: reportWell });
  const result = simulateDisplacement2D({ ...input, nTheta: 8, nZ: 18, maxSnapshots: 8, settleMin: settings.settleMin });
  const extras: CementingReportExtras = { centralization: cent,
    displacement: { inputKey: displacementReportKey(dData, settings), result, meta, stages: input.stages, settings },
    supplements: [{ title: "Расчёт времени контакта", paragraphs: ["Контрольный результат"], tables: [{ headers: ["MD", "Время"], rows: [["100", "6,2"]] }] }] };
  const pressure = calculatePressureProfile(reportWell, slurries, buffers, ex.drillingFluid, ex.displacementFluids,
    ex.fractureGradient, volume.displacementVolumeWithCompression);
  const svg = [...buildHydraulicReportSvgs(pressure.points), ...buildWellReportSvgs(reportWell, slurries), ...buildCementingReportSvgs(reportWell, extras)];
  expect(svg.some(f => f.title.includes("Сечение через вершины"))).toBe(true);
  expect(svg.some(f => f.title.includes("конец продавки"))).toBe(true);
  expect(svg.filter(f => f.title.startsWith("Замещение: 3D-кадр")).length).toBeGreaterThanOrEqual(2);
  for (const f of svg) expect(f.svg).not.toMatch(/NaN|Infinity/);
  const dir = process.env.REPORT_QA_DIR;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    svg.forEach((f, i) => writeFileSync(join(dir, "figure-" + i + ".svg"), f.svg));
    if (process.env.REPORT_QA_RASTER) extras.figures = svg.map((f, i) => ({ ...f,
      dataUrl: "data:image/png;base64," + readFileSync(join(dir, "figure-" + i + ".png")).toString("base64") }));
  }
  const b = await exportToDocx(reportWell, ex.drillingFluid, slurries, buffers, ex.displacementFluids, ex.fractureGradient,
    undefined, cent.results, { volumes: volume, pressureResult: pressure }, { extras, returnBlob: true });
  if (!b) throw new Error("DOCX was not generated");
  const bytes = Buffer.from(await b.arrayBuffer()), zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml")!.async("text");
  const grids = [...xml.matchAll(/<w:tblGrid>(.*?)<\/w:tblGrid>/g)];
  expect(grids.length).toBeGreaterThan(20);
  for (const [, grid] of grids) {
    const widths = [...grid.matchAll(/w:w="(\d+)"/g)].map(x => +x[1]);
    expect(widths.reduce((s, x) => s + x, 0)).toBe(REPORT_TEXT_WIDTH);
    expect(Math.min(...widths)).toBeGreaterThan(1000);
  }
  expect(xml).toContain("w:w=\"11906\"");
  expect(xml).toContain("СОГЛАСОВАНО");
  expect(xml).toContain("УТВЕРЖДАЮ");
  expect(xml).toContain("Тестовый центратор 168");
  expect(xml).toContain("Зазор / конфликт, мм");
  expect(xml).toContain("Потрубная ведомость");
  expect(xml).toContain("Замещение в затрубье");
  expect(xml).toContain("Контрольный результат");
  if (extras.figures) {
    expect(Object.keys(zip.files).filter(k => /word\/media\/.+\.(png|jpg)$/.test(k)).length).toBeGreaterThanOrEqual(svg.length);
    expect(xml).toContain("3D-кадр");
  }
  if (dir) writeFileSync(join(dir, "cementing-report.docx"), bytes);
}, 45000);
