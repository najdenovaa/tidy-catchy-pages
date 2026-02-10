import { useEffect, useRef, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import CopyImageButton from "./CopyImageButton";
import type { WellData, SlurryInput, BufferFluid, DrillingFluid, DisplacementFluid } from "@/lib/cementing-calculations";
import { getSlurryHeight, interpolateTVD, getCasingID, annularVolumePerMeter } from "@/lib/cementing-calculations";

interface Props {
  wellData: WellData;
  slurries: SlurryInput[];
  buffers: BufferFluid[];
  drillingFluid: DrillingFluid;
  displacementFluids?: DisplacementFluid[];
}

// ── Displacement efficiency model ──
// For each depth (MD) and circumferential angle (0–360°), compute how well
// cement displaces drilling fluid.  Key factors:
//   1. Density hierarchy  (ρ_cement / ρ_mud)  — higher → better
//   2. Rheology hierarchy (YP_cement > YP_mud) — ensures plug-flow displacement
//   3. Annular velocity   (Q / A_ann)          — higher → better (turbulent helps)
//   4. Inclination angle  (zenith)             — higher → worse on narrow (top) side
//   5. Eccentricity model — in deviated wells casing sags to bottom,
//      creating wide side (WS, bottom, θ≈180°) and narrow side (NS, top, θ≈0°)

interface DepthSlice {
  md: number;
  tvd: number;
  zenithDeg: number;          // local inclination
  isOpenHole: boolean;
  fluidType: "cement" | "buffer" | "mud"; // what's at this depth in annulus
  fluidDensity: number;       // kg/m³
  fluidPV: number;
  fluidYP: number;
}

function computeSlices(
  wellData: WellData,
  slurries: SlurryInput[],
  buffers: BufferFluid[],
  drillingFluid: DrillingFluid,
): DepthSlice[] {
  const traj = wellData.trajectory?.length >= 2
    ? [...wellData.trajectory].sort((a, b) => a.md - b.md)
    : [{ md: 0, azimuth: 0, zenith: 0, tvd: 0 }, { md: wellData.casingDepthMD, azimuth: 0, zenith: 0, tvd: wellData.casingDepthMD }];

  // Build cement intervals  [mdTop, mdBot, slurryIdx]
  const cementIntervals: { top: number; bot: number; idx: number }[] = [];
  slurries.forEach((s, i) => {
    const h = getSlurryHeight(slurries, i, wellData.casingDepthMD);
    if (h > 0) {
      const lastIdx = slurries.length - 1;
      const bot = i === lastIdx ? wellData.casingDepthMD : slurries[i + 1].topDepthMD;
      cementIntervals.push({ top: s.topDepthMD, bot, idx: i });
    }
  });

  // Buffer intervals (above cement)
  const annVPM = annularVolumePerMeter(wellData.holeDiameter, wellData.casingOD, wellData.cavernCoeff);
  const bufferIntervals: { top: number; bot: number; idx: number }[] = [];
  let curMD = cementIntervals.length > 0 ? Math.min(...cementIntervals.map(c => c.top)) : wellData.casingDepthMD;
  for (let i = buffers.length - 1; i >= 0; i--) {
    const bufH = buffers[i].volume / annVPM;
    const mdBot = curMD;
    const mdTop = Math.max(0, curMD - bufH);
    bufferIntervals.push({ top: mdTop, bot: mdBot, idx: i });
    curMD = mdTop;
  }

  // Interpolate zenith at any MD
  function zenithAtMD(md: number): number {
    if (md <= traj[0].md) return traj[0].zenith;
    if (md >= traj[traj.length - 1].md) return traj[traj.length - 1].zenith;
    for (let i = 0; i < traj.length - 1; i++) {
      if (md >= traj[i].md && md <= traj[i + 1].md) {
        const f = (md - traj[i].md) / (traj[i + 1].md - traj[i].md || 1);
        return traj[i].zenith + f * (traj[i + 1].zenith - traj[i].zenith);
      }
    }
    return 0;
  }

  // Determine cementing interval — from topmost cement/buffer to casing shoe
  const cementTopMD = Math.min(
    ...(cementIntervals.map(c => c.top)),
    ...(bufferIntervals.map(b => b.top)),
    wellData.casingDepthMD
  );
  const cementBotMD = wellData.casingDepthMD;

  const numSlices = 200;
  const slices: DepthSlice[] = [];

  for (let i = 0; i <= numSlices; i++) {
    const md = cementTopMD + (cementBotMD - cementTopMD) * i / numSlices;
    const tvd = interpolateTVD(md, wellData.trajectory);
    const zenithDeg = zenithAtMD(md);
    const isOpenHole = md > wellData.prevCasingDepth;

    // Determine fluid at this depth
    let fluidType: DepthSlice["fluidType"] = "mud";
    let fluidDensity = drillingFluid.density;
    let fluidPV = drillingFluid.rheology.pv;
    let fluidYP = drillingFluid.rheology.yp;

    for (const ci of cementIntervals) {
      if (md >= ci.top && md <= ci.bot) {
        const s = slurries[ci.idx];
        fluidType = "cement";
        fluidDensity = s.density * 1000;
        fluidPV = s.rheology.pv;
        fluidYP = s.rheology.yp;
        break;
      }
    }
    if (fluidType === "mud") {
      for (const bi of bufferIntervals) {
        if (md >= bi.top && md <= bi.bot) {
          const b = buffers[bi.idx];
          fluidType = "buffer";
          fluidDensity = b.density;
          fluidPV = b.rheology.pv;
          fluidYP = b.rheology.yp;
          break;
        }
      }
    }

    slices.push({ md, tvd, zenithDeg, isOpenHole, fluidType, fluidDensity, fluidPV, fluidYP });
  }

  return slices;
}

/**
 * Calculate displacement efficiency [0..1] at a given depth slice and circumferential angle.
 * θ = 0 → narrow side (top/high side), θ = π → wide side (bottom/low side)
 */
function calcEfficiency(
  slice: DepthSlice,
  theta: number, // 0..2π circumferential angle
  mudDensity: number,
  mudPV: number,
  mudYP: number,
  flowRateLps: number,
  annAreaM2: number,
  cavernCoeff: number,
): number {
  if (slice.fluidType === "mud") return 0;

  // Base efficiency from density hierarchy
  const densityRatio = slice.fluidDensity / mudDensity;
  const densityScore = Math.min(1, Math.max(0, (densityRatio - 0.9) / 0.5)); // 0.9→0, 1.4→1

  // Rheology hierarchy: YP_cement > YP_mud is favorable
  const ypRatio = slice.fluidYP / Math.max(mudYP, 1);
  const rheoScore = Math.min(1, Math.max(0.3, ypRatio * 0.5));

  // Velocity score: higher velocity = better displacement
  const velocity = flowRateLps > 0 ? (flowRateLps * 0.001) / annAreaM2 : 0.5; // m/s
  const velocityScore = Math.min(1, velocity / 1.5); // ~1.5 m/s = excellent

  // Base efficiency
  let eff = 0.4 * densityScore + 0.25 * rheoScore + 0.35 * velocityScore;

  // Inclination effect: higher zenith → more eccentricity → worse on narrow side
  const zenithRad = slice.zenithDeg * Math.PI / 180;
  const eccentricity = Math.sin(zenithRad); // 0 for vertical, 1 for horizontal

  // Circumferential variation: narrow side (θ≈0,2π) vs wide side (θ≈π)
  // cos(θ) = +1 at narrow side (top), -1 at wide side (bottom)
  const cosTheta = Math.cos(theta);

  // On the narrow side, flow velocity is lower → worse displacement
  // On the wide side, flow velocity is higher → better displacement
  // Effect scales with eccentricity
  const circumVar = eccentricity * cosTheta * 0.35;
  eff = eff - circumVar;

  // Open hole vs cased: open hole has rougher walls, slightly worse
  if (slice.isOpenHole) {
    eff *= 0.92;
  }

  // Cavern effect: larger caverns reduce velocity → worse displacement
  if (cavernCoeff > 1.1) {
    eff *= 1.0 - (cavernCoeff - 1.0) * 0.15;
  }

  // Buffer is inherently less effective than cement
  if (slice.fluidType === "buffer") {
    eff *= 0.6;
  }

  // Add some deterministic "texture" to simulate heterogeneity
  const seed = Math.sin(slice.md * 0.37 + theta * 2.71) * 0.5 + 0.5;
  const noise = (seed - 0.5) * 0.12;
  eff += noise;

  return Math.max(0, Math.min(1, eff));
}

// Color mapping: efficiency → color
// 0.0 = bright yellow/red (poor), 1.0 = dark green/black (excellent)
function effToColor(eff: number): [number, number, number] {
  // Dark = good cement, bright = poor displacement (mud channels)
  if (eff >= 0.85) {
    // Dark green-black (excellent)
    const t = (eff - 0.85) / 0.15;
    return [lerp(10, 5, t), lerp(60, 20, t), lerp(15, 5, t)];
  } else if (eff >= 0.6) {
    // Green (good)
    const t = (eff - 0.6) / 0.25;
    return [lerp(30, 10, t), lerp(140, 60, t), lerp(30, 15, t)];
  } else if (eff >= 0.35) {
    // Yellow-green (moderate)
    const t = (eff - 0.35) / 0.25;
    return [lerp(200, 30, t), lerp(180, 140, t), lerp(40, 30, t)];
  } else if (eff >= 0.15) {
    // Yellow-red (poor)
    const t = (eff - 0.15) / 0.2;
    return [lerp(220, 200, t), lerp(80, 180, t), lerp(20, 40, t)];
  } else {
    // Red (very poor / mud channel)
    const t = eff / 0.15;
    return [lerp(180, 220, t), lerp(30, 80, t), lerp(15, 20, t)];
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export default function DisplacementEfficiency({ wellData, slurries, buffers, drillingFluid, displacementFluids }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const slices = useMemo(
    () => computeSlices(wellData, slurries, buffers, drillingFluid),
    [wellData, slurries, buffers, drillingFluid]
  );

  const annAreaM2 = useMemo(() => {
    const dH = wellData.holeDiameter / 1000;
    const dC = wellData.casingOD / 1000;
    return (Math.PI / 4) * (dH * dH - dC * dC);
  }, [wellData.holeDiameter, wellData.casingOD]);

  // Average flow rate from slurry steps
  const avgFlowRate = useMemo(() => {
    const rates: number[] = [];
    slurries.forEach(s => s.flowRateSteps.forEach(st => { if (st.rateLps > 0) rates.push(st.rateLps); }));
    buffers.forEach(b => b.flowRateSteps.forEach(st => { if (st.rateLps > 0) rates.push(st.rateLps); }));
    return rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : 5;
  }, [slurries, buffers]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || slices.length < 2) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = 400;
    const H = 600;
    const marginLeft = 60;
    const marginRight = 20;
    const marginTop = 30;
    const marginBottom = 40;
    const plotW = W - marginLeft - marginRight;
    const plotH = H - marginTop - marginBottom;

    canvas.width = W * 2; // retina
    canvas.height = H * 2;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.scale(2, 2);

    // Background
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, W, H);

    const numAngles = 120; // circumferential resolution
    const numDepths = slices.length;
    const mdMin = slices[0].md;
    const mdMax = slices[slices.length - 1].md;

    // Draw heatmap
    const cellW = plotW / numAngles;
    const cellH = plotH / numDepths;

    for (let di = 0; di < numDepths; di++) {
      const slice = slices[di];
      const y = marginTop + di * cellH;

      for (let ai = 0; ai < numAngles; ai++) {
        // θ: 0..2π, map so center = narrow side (top), edges = wide side (bottom)
        // Layout: WS | NS | WS (like reference image)
        const theta = (ai / numAngles) * 2 * Math.PI;

        const eff = calcEfficiency(
          slice, theta,
          drillingFluid.density, drillingFluid.rheology.pv, drillingFluid.rheology.yp,
          avgFlowRate, annAreaM2, wellData.cavernCoeff
        );

        const [r, g, b] = effToColor(eff);
        ctx.fillStyle = `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
        ctx.fillRect(marginLeft + ai * cellW, y, cellW + 0.5, cellH + 0.5);
      }
    }

    // ── Axes and labels ──
    ctx.fillStyle = "#aaa";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";

    // X-axis labels (WS - NS - WS)
    const xLabels = ["WS", "NS", "WS"];
    const xPositions = [marginLeft, marginLeft + plotW / 2, marginLeft + plotW];
    xLabels.forEach((label, i) => {
      ctx.fillText(label, xPositions[i], marginTop + plotH + 16);
    });

    // Y-axis: depth labels
    ctx.textAlign = "right";
    const depthInterval = mdMax - mdMin > 300 ? 100 : mdMax - mdMin > 100 ? 50 : 20;
    for (let md = Math.ceil(mdMin / depthInterval) * depthInterval; md <= mdMax; md += depthInterval) {
      const y = marginTop + ((md - mdMin) / (mdMax - mdMin)) * plotH;
      ctx.fillStyle = "#666";
      ctx.fillRect(marginLeft - 4, y, 4, 1);
      ctx.fillStyle = "#aaa";
      ctx.fillText(`${md}`, marginLeft - 8, y + 4);
    }

    // Y-axis title
    ctx.save();
    ctx.translate(14, marginTop + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillStyle = "#aaa";
    ctx.font = "12px sans-serif";
    ctx.fillText("Глубина по стволу, м", 0, 0);
    ctx.restore();

    // Title
    ctx.fillStyle = "#ddd";
    ctx.font = "bold 13px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Эффективность замещения (%)", W / 2, 16);

    // Border around heatmap
    ctx.strokeStyle = "#555";
    ctx.lineWidth = 1;
    ctx.strokeRect(marginLeft, marginTop, plotW, plotH);

    // ── Color legend ──
    const legendX = marginLeft;
    const legendY = marginTop + plotH + 24;
    const legendW = plotW;
    const legendH = 10;

    for (let i = 0; i < legendW; i++) {
      const eff = i / legendW;
      const [r, g, b] = effToColor(eff);
      ctx.fillStyle = `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
      ctx.fillRect(legendX + i, legendY, 1.5, legendH);
    }
    ctx.strokeStyle = "#555";
    ctx.strokeRect(legendX, legendY, legendW, legendH);

    ctx.fillStyle = "#aaa";
    ctx.font = "9px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("0%", legendX, legendY + legendH + 10);
    ctx.textAlign = "center";
    ctx.fillText("50%", legendX + legendW / 2, legendY + legendH + 10);
    ctx.textAlign = "right";
    ctx.fillText("100%", legendX + legendW, legendY + legendH + 10);

    // ── Inclination profile on the right ──
    // Small line graph showing zenith vs depth
    const profX = marginLeft + plotW + 5;
    const profW = marginRight - 8;
    // Skip if too narrow

  }, [slices, drillingFluid, avgFlowRate, annAreaM2, wellData]);

  const mdRange = slices.length >= 2
    ? `${slices[0].md.toFixed(0)} – ${slices[slices.length - 1].md.toFixed(0)} м`
    : "";

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">Эффективность замещения (Displacement Efficiency)</CardTitle>
            <p className="text-xs text-muted-foreground">
              Интервал цементирования {mdRange}. Тёмные зоны — полное замещение, светлые — каналы бурового раствора.
              WS — широкая сторона, NS — узкая сторона кольцевого пространства.
            </p>
          </div>
          <CopyImageButton targetRef={containerRef} />
        </div>
      </CardHeader>
      <CardContent>
        <div ref={containerRef} className="flex justify-center">
          <canvas ref={canvasRef} />
        </div>
      </CardContent>
    </Card>
  );
}
