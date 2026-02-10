import { useEffect, useRef, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import CopyImageButton from "./CopyImageButton";
import type { WellData, SlurryInput, BufferFluid, DrillingFluid, DisplacementFluid } from "@/lib/cementing-calculations";
import { getSlurryHeight, interpolateTVD, annularVolumePerMeter, getCasingID } from "@/lib/cementing-calculations";

interface Props {
  wellData: WellData;
  slurries: SlurryInput[];
  buffers: BufferFluid[];
  drillingFluid: DrillingFluid;
  displacementFluids?: DisplacementFluid[];
}

interface DepthSlice {
  md: number;
  zenithDeg: number;
  fluidType: "cement" | "buffer" | "mud";
  fluidDensity: number;
  fluidYP: number;
  isOpenHole: boolean;
}

function buildSlices(wellData: WellData, slurries: SlurryInput[], buffers: BufferFluid[], drillingFluid: DrillingFluid): DepthSlice[] {
  const traj = wellData.trajectory?.length >= 2
    ? [...wellData.trajectory].sort((a, b) => a.md - b.md)
    : [{ md: 0, azimuth: 0, zenith: 0, tvd: 0 }, { md: wellData.casingDepthMD, azimuth: 0, zenith: 0, tvd: wellData.casingDepthMD }];

  const annVPM = annularVolumePerMeter(wellData.holeDiameter, wellData.casingOD, wellData.cavernCoeff);

  // Cement intervals
  const cemInts: { top: number; bot: number; idx: number }[] = [];
  slurries.forEach((s, i) => {
    const h = getSlurryHeight(slurries, i, wellData.casingDepthMD);
    if (h > 0) {
      const bot = i === slurries.length - 1 ? wellData.casingDepthMD : slurries[i + 1].topDepthMD;
      cemInts.push({ top: s.topDepthMD, bot, idx: i });
    }
  });

  // Buffer intervals
  const bufInts: { top: number; bot: number; idx: number }[] = [];
  let cur = cemInts.length > 0 ? Math.min(...cemInts.map(c => c.top)) : wellData.casingDepthMD;
  for (let i = buffers.length - 1; i >= 0; i--) {
    const bufH = buffers[i].volume / annVPM;
    const bot = cur;
    const top = Math.max(0, cur - bufH);
    bufInts.push({ top, bot, idx: i });
    cur = top;
  }

  function zenithAt(md: number): number {
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

  // Only cement interval (from top cement/buffer to shoe)
  const topMD = Math.min(
    ...(cemInts.map(c => c.top)),
    ...(bufInts.map(b => b.top)),
    wellData.casingDepthMD
  );
  const botMD = wellData.casingDepthMD;
  const N = 300;
  const slices: DepthSlice[] = [];

  for (let i = 0; i <= N; i++) {
    const md = topMD + (botMD - topMD) * i / N;
    const zenithDeg = zenithAt(md);
    const isOpenHole = md > wellData.prevCasingDepth;

    let fluidType: DepthSlice["fluidType"] = "mud";
    let fluidDensity = drillingFluid.density;
    let fluidYP = drillingFluid.rheology.yp;

    for (const ci of cemInts) {
      if (md >= ci.top && md <= ci.bot) {
        fluidType = "cement";
        fluidDensity = slurries[ci.idx].density * 1000;
        fluidYP = slurries[ci.idx].rheology.yp;
        break;
      }
    }
    if (fluidType === "mud") {
      for (const bi of bufInts) {
        if (md >= bi.top && md <= bi.bot) {
          fluidType = "buffer";
          fluidDensity = buffers[bi.idx].density;
          fluidYP = buffers[bi.idx].rheology.yp;
          break;
        }
      }
    }

    slices.push({ md, zenithDeg, fluidType, fluidDensity, fluidYP, isOpenHole });
  }
  return slices;
}

/**
 * Compute displacement efficiency 0..1.
 * angle: circumferential 0=narrow side (top in deviated well), π=wide side (bottom)
 */
function efficiency(
  slice: DepthSlice,
  angle: number,
  mudDensity: number,
  mudYP: number,
  avgRateLps: number,
  annArea: number,
  cavernCoeff: number,
): number {
  if (slice.fluidType === "mud") return 0;

  // Density advantage
  const dr = slice.fluidDensity / mudDensity;
  const dScore = Math.min(1, Math.max(0, (dr - 0.85) / 0.6));

  // YP advantage (cement should have higher YP)
  const ypScore = Math.min(1, Math.max(0.2, (slice.fluidYP / Math.max(mudYP, 1)) * 0.4));

  // Velocity
  const vel = avgRateLps > 0 ? (avgRateLps * 0.001) / annArea : 0.4;
  const vScore = Math.min(1, vel / 1.2);

  let eff = 0.35 * dScore + 0.25 * ypScore + 0.4 * vScore;

  // Inclination effect: high zenith → eccentricity → bad on narrow side
  const eccen = Math.sin(slice.zenithDeg * Math.PI / 180);
  const cosA = Math.cos(angle); // +1 narrow, -1 wide
  eff -= eccen * cosA * 0.3;

  // Open hole roughness
  if (slice.isOpenHole) eff *= 0.93;

  // Cavern
  if (cavernCoeff > 1.05) eff *= 1.0 - (cavernCoeff - 1.0) * 0.2;

  // Buffer is weaker
  if (slice.fluidType === "buffer") eff *= 0.55;

  // Deterministic noise for texture
  const n = Math.sin(slice.md * 0.53 + angle * 3.17) * 0.5 + 0.5;
  eff += (n - 0.5) * 0.08;

  return Math.max(0, Math.min(1, eff));
}

export default function DisplacementEfficiency({ wellData, slurries, buffers, drillingFluid, displacementFluids }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const slices = useMemo(() => buildSlices(wellData, slurries, buffers, drillingFluid), [wellData, slurries, buffers, drillingFluid]);

  const annArea = useMemo(() => {
    const dH = wellData.holeDiameter / 1000;
    const dC = wellData.casingOD / 1000;
    return (Math.PI / 4) * (dH * dH - dC * dC);
  }, [wellData.holeDiameter, wellData.casingOD]);

  const avgRate = useMemo(() => {
    const r: number[] = [];
    slurries.forEach(s => s.flowRateSteps.forEach(st => { if (st.rateLps > 0) r.push(st.rateLps); }));
    buffers.forEach(b => b.flowRateSteps.forEach(st => { if (st.rateLps > 0) r.push(st.rateLps); }));
    return r.length > 0 ? r.reduce((a, b) => a + b) / r.length : 5;
  }, [slurries, buffers]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || slices.length < 2) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Layout: left annulus strip | casing | right annulus strip
    const W = 460, H = 650;
    const mL = 55, mR = 50, mT = 30, mB = 45;
    const plotH = H - mT - mB;
    const plotW = W - mL - mR;

    // Casing in center, annulus on both sides
    const casingW = plotW * 0.15;
    const annW = (plotW - casingW) / 2;
    const annLeftX = mL;
    const casingX = mL + annW;
    const annRightX = casingX + casingW;

    canvas.width = W * 2;
    canvas.height = H * 2;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.scale(2, 2);

    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, W, H);

    const mdMin = slices[0].md;
    const mdMax = slices[slices.length - 1].md;
    const numAngles = 60; // circumferential resolution per side
    const cellHraw = plotH / slices.length;

    // Draw LEFT annulus (wide side → narrow side, angle π→0)
    for (let di = 0; di < slices.length; di++) {
      const slice = slices[di];
      const y = mT + di * cellHraw;
      const cellW = annW / numAngles;
      for (let ai = 0; ai < numAngles; ai++) {
        // Left side: wide side (bottom) at left edge, narrow side at casing
        const angle = Math.PI * (1 - ai / numAngles); // π→0
        const eff = efficiency(slice, angle, drillingFluid.density, drillingFluid.rheology.yp, avgRate, annArea, wellData.cavernCoeff);
        // Grayscale: dark gray = good, white = poor
        const gray = Math.round(255 - eff * 220); // 35 (good) to 255 (poor=0)
        ctx.fillStyle = `rgb(${gray},${gray},${gray})`;
        ctx.fillRect(annLeftX + ai * cellW, y, cellW + 0.5, cellHraw + 0.5);
      }
    }

    // Draw RIGHT annulus (narrow side → wide side, angle 0→π)
    for (let di = 0; di < slices.length; di++) {
      const slice = slices[di];
      const y = mT + di * cellHraw;
      const cellW = annW / numAngles;
      for (let ai = 0; ai < numAngles; ai++) {
        const angle = Math.PI * (ai / numAngles); // 0→π
        const eff = efficiency(slice, angle, drillingFluid.density, drillingFluid.rheology.yp, avgRate, annArea, wellData.cavernCoeff);
        const gray = Math.round(255 - eff * 220);
        ctx.fillStyle = `rgb(${gray},${gray},${gray})`;
        ctx.fillRect(annRightX + ai * cellW, y, cellW + 0.5, cellHraw + 0.5);
      }
    }

    // Draw casing (steel gray)
    ctx.fillStyle = "#707070";
    ctx.fillRect(casingX, mT, casingW, plotH);
    ctx.strokeStyle = "#999";
    ctx.lineWidth = 1;
    ctx.strokeRect(casingX, mT, casingW, plotH);

    // Casing label
    ctx.save();
    ctx.translate(casingX + casingW / 2, mT + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = "#ccc";
    ctx.font = "9px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`Обс. колонна ∅${wellData.casingOD}`, 0, 3);
    ctx.restore();

    // Borehole walls
    ctx.strokeStyle = "#8B7D6B";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(annLeftX, mT); ctx.lineTo(annLeftX, mT + plotH);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(annRightX + annW, mT); ctx.lineTo(annRightX + annW, mT + plotH);
    ctx.stroke();

    // Formation labels
    ctx.fillStyle = "#8B7D6B";
    ctx.font = "9px sans-serif";
    ctx.textAlign = "center";
    ctx.save();
    ctx.translate(annLeftX - 8, mT + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("Порода", 0, 0);
    ctx.restore();
    ctx.save();
    ctx.translate(annRightX + annW + 10, mT + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("Порода", 0, 0);
    ctx.restore();

    // Y-axis depth labels
    ctx.fillStyle = "#aaa";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "right";
    const dInt = mdMax - mdMin > 300 ? 100 : mdMax - mdMin > 100 ? 50 : 20;
    for (let md = Math.ceil(mdMin / dInt) * dInt; md <= mdMax; md += dInt) {
      const y = mT + ((md - mdMin) / (mdMax - mdMin)) * plotH;
      ctx.fillStyle = "#555";
      ctx.fillRect(mL - 4, y, 4, 1);
      ctx.fillStyle = "#aaa";
      ctx.fillText(`${md}`, mL - 7, y + 3);
    }

    // Y-axis title
    ctx.save();
    ctx.translate(12, mT + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = "#aaa";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Глубина по стволу, м", 0, 0);
    ctx.restore();

    // Title
    ctx.fillStyle = "#ddd";
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Эффективность замещения", W / 2, 16);

    // Legend bar at bottom
    const legX = mL, legY = mT + plotH + 18, legW = plotW, legH = 10;
    for (let i = 0; i < legW; i++) {
      const eff = i / legW;
      const gray = Math.round(255 - eff * 220);
      ctx.fillStyle = `rgb(${gray},${gray},${gray})`;
      ctx.fillRect(legX + i, legY, 1.5, legH);
    }
    ctx.strokeStyle = "#555";
    ctx.lineWidth = 0.5;
    ctx.strokeRect(legX, legY, legW, legH);

    ctx.fillStyle = "#aaa";
    ctx.font = "9px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("Плохое (засвет)", legX, legY + legH + 12);
    ctx.textAlign = "right";
    ctx.fillText("Полное замещение", legX + legW, legY + legH + 12);

    // Side labels
    ctx.fillStyle = "#888";
    ctx.font = "9px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Широкая сторона", annLeftX + annW * 0.3, mT + plotH + 6);
    ctx.fillText("Широкая сторона", annRightX + annW * 0.7, mT + plotH + 6);

  }, [slices, drillingFluid, avgRate, annArea, wellData]);

  const mdRange = slices.length >= 2 ? `${slices[0].md.toFixed(0)} – ${slices[slices.length - 1].md.toFixed(0)} м` : "";

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">Эффективность замещения</CardTitle>
            <p className="text-xs text-muted-foreground">
              Продольный разрез кольцевого пространства ({mdRange}). Тёмное — полное замещение, белое (засвет) — каналы бурового раствора.
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
