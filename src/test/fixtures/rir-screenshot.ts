import { DEFAULT_RIR, type RirInputs } from "@/lib/rir-calculations";
export const screenCase: RirInputs = {
  ...DEFAULT_RIR,
  wellDepthMD: 2450,
  bottomTempStaticC: 60,
  casing: { ...DEFAULT_RIR.casing, odMm: 168.3, wallMm: 8.9 },
  tool: { ...DEFAULT_RIR.tool, kind: "bradenhead" },
  leak: {
    topMD: 2202,
    bottomMD: 2208,
    kind: "perforation",
    annulusPressureMPa: 0,
  },
  composition: "cement",
  compositionDensity: 0,
  fracGradientMPaM: 0.02,
  injectivity: [{ rateM3h: 7.5, surfacePressureMPa: 15 }],
  spot: {
    initialShoeMD: 2223,
    liftedShoeMD: 2102,
    slurryBottomMD: 2223,
    slurryVolumeM3: 3,
    plannedSqueezeM3: 2,
    bopWorkingMPa: 21,
  },
};
