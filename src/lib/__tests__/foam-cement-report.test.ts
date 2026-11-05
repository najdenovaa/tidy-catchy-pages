import { it, expect } from "vitest";
import { Document, Packer } from "docx";
import JSZip from "jszip";
import { foamReportChildren } from "../foam-cement-report";
import { defaultFoamSettings, simulateFoamJob } from "../foam-cement-engine";
import type { WellData } from "../cementing-calculations";
it("exports a reproducible DOCX with stages, model limits and material ledger", async () => {
  const w: WellData = {
    wellDepthMD: 500,
    wellDepthTVD: 500,
    casingDepthMD: 500,
    holeDiameter: 215.9,
    casingOD: 168.3,
    casingWall: 8.9,
    prevCasingDepth: 100,
    prevCasingID: 250,
    prevCasingOD: 273,
    ckodDepth: 480,
    cementRiseHeight: 500,
    cavernCoeff: 1,
    bottomTempStatic: 50,
    bottomTempCirc: 40,
    pumpZoneTop: 0,
    pumpZoneBottom: 0,
    trajectory: [
      { md: 0, tvd: 0, zenith: 0, azimuth: 0 },
      { md: 500, tvd: 500, zenith: 0, azimuth: 0 },
    ],
  };
  const simulation = simulateFoamJob({
    wellData: w,
    mudDensity: 1.2,
    settings: {
      ...defaultFoamSettings({ wellData: w }),
      spatialCells: 16,
      timeStepMin: 1,
    },
  });
  const doc = new Document({
    sections: [
      { children: foamReportChildren({ simulation, observations: [] }) },
    ],
  });
  const zip = await JSZip.loadAsync(await Packer.toBuffer(doc));
  const xml = await zip.file("word/document.xml")!.async("text");
  expect(xml).toContain("foam-2.0-conservative-homogeneous");
  expect(xml).toContain("Продавка до башмака");
  expect(xml).toContain("Протоколы отсутствуют");
  expect(xml).toContain("Исходные параметры для воспроизведения");
});
