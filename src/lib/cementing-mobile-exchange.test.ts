import { describe, expect, it } from "vitest";
import { defaultCementingSnapshot, normalizeCementingSnapshot } from "./cementing-normalizers";
import { exportCementingToMobileText, importMobileCementingText } from "./cementing-mobile-exchange";

const sample = normalizeCementingSnapshot({
  ...defaultCementingSnapshot,
  wellData: { ...defaultCementingSnapshot.wellData,
    wellDepthMD: 2600, wellDepthTVD: 2500, casingDepthMD: 2500, holeDiameter: 215.9,
    casingOD: 168.3, casingWall: 8.9, prevCasingDepth: 500, prevCasingID: 226,
    ckodDepth: 2480, cavernCoeff: 1.1, cementRiseHeight: 1200 },
  drillingFluid: { name: "Буровой", density: 1200, rheology: {pv:25, yp:12}, fluidLoss:0 },
  slurries: [
    {name:"Лёгкий", density:1450,topDepthMD:1200,rheology:{pv:60,yp:8},flowRateSteps:[{rateLps:12,volumeM3:14}],waterRatio:0.6,yieldPerTon:1,additives:[],thickeningTime30Bc:0,thickeningTime50Bc:0},
    {name:"Тяжёлый", density:1850,topDepthMD:1900,rheology:{pv:75,yp:10},flowRateSteps:[{rateLps:13,volumeM3:16}],waterRatio:0.45,yieldPerTon:0.8,additives:[],thickeningTime30Bc:0,thickeningTime50Bc:0},
  ],
  buffers:[{name:"Буфер",density:1100,volume:8,rheology:{pv:20,yp:5},additives:[],flowRateSteps:[{rateLps:12,volumeM3:8}]}],
  displacementFluids:[{name:"Продавка",density:1200,rheology:{pv:25,yp:12},flowRateSteps:[{rateLps:12,volumeM3:30}],compressionCoeff:1.02}],
  fractureGradient:18.5,
});
describe("Offline mobile cementing exchange", () => {
  it("exports native mobile keys and restores common web parameters", () => {
    const txt=exportCementingToMobileText(sample);
    expect(txt).toContain("[module]: cementing");
    expect(txt).toContain("[stage2.bottomMD]: 2500");
    expect(txt).toContain("[mudDensity]: 1.2");
    const restored=importMobileCementingText(txt,defaultCementingSnapshot);
    expect(restored.wellData.casingDepthMD).toBe(2500);
    expect(restored.slurries[0].topDepthMD).toBe(1200);
    expect(restored.slurries[1].topDepthMD).toBe(1900);
    expect(restored.slurries[1].density).toBe(1850);
    expect(restored.buffers[0].volume).toBe(8);
    expect(restored.drillingFluid.density).toBe(1200);
    expect(restored.fractureGradient).toBeCloseTo(18.5,8);
  });
  it("rejects unrelated modules and invalid geometry without modifying existing state", () => {
    const txt=exportCementingToMobileText(sample);
    expect(()=>importMobileCementingText(txt.replace("[module]: cementing","[module]: kill"),sample)).toThrow();
    expect(()=>importMobileCementingText(txt.replace("[holeDiameter]: 215.9","[holeDiameter]: 100"),sample)).toThrow();
    expect(sample.wellData.casingOD).toBe(168.3);
  });
});
