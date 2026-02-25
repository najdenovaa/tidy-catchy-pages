import { useEffect, useRef, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import CopyImageButton from "./CopyImageButton";
import type { WellData, SlurryInput, BufferFluid, DrillingFluid, DisplacementFluid } from "@/lib/cementing-calculations";
import { getSlurryHeight, interpolateTVD, annularVolumePerMeter } from "@/lib/cementing-calculations";
import type { CentralizationResult } from "@/lib/centralization-calculations";

interface Props {
  wellData: WellData;
  slurries: SlurryInput[];
  buffers: BufferFluid[];
  drillingFluid: DrillingFluid;
  displacementFluids?: DisplacementFluid[];
  centralizationResults?: CentralizationResult[];
}

// ── Simple 2D value noise (deterministic, smooth) ──
function hash2d(ix: number, iy: number): number {
  let h = ix * 374761393 + iy * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) & 0x7fffffff) / 0x7fffffff; // 0..1
}

function smoothNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  // Smooth interpolation (hermite)
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const n00 = hash2d(ix, iy);
  const n10 = hash2d(ix + 1, iy);
  const n01 = hash2d(ix, iy + 1);
  const n11 = hash2d(ix + 1, iy + 1);
  const nx0 = n00 + (n10 - n00) * sx;
  const nx1 = n01 + (n11 - n01) * sx;
  return nx0 + (nx1 - nx0) * sy;
}

function fbmNoise(x: number, y: number): number {
  return 0.6 * smoothNoise(x, y) + 0.3 * smoothNoise(x * 2.1, y * 2.1) + 0.1 * smoothNoise(x * 4.3, y * 4.3);
}

interface DepthInfo {
  md: number;
  zenithDeg: number;
  fluidType: "cement" | "buffer" | "mud";
  fluidDensity: number;
  fluidYP: number;
  isOpenHole: boolean;
  distFromTopFrac: number;    // 0=top of this fluid zone, 1=bottom
  distFromBoundary: number;   // 0..1, 0=at fluid boundary (transition zone)
  zoneIndex: number;          // unique index for this fluid zone (seed variation)
}

function buildDepthInfo(
  wellData: WellData, slurries: SlurryInput[], buffers: BufferFluid[], drillingFluid: DrillingFluid
): { info: DepthInfo[]; mdMin: number; mdMax: number } {
  const traj = wellData.trajectory?.length >= 2
    ? [...wellData.trajectory].sort((a, b) => a.md - b.md)
    : [{ md: 0, azimuth: 0, zenith: 0, tvd: 0 }, { md: wellData.casingDepthMD, azimuth: 0, zenith: 0, tvd: wellData.casingDepthMD }];

  const annVPM = annularVolumePerMeter(wellData.holeDiameter, wellData.casingOD, wellData.cavernCoeff);

  const cemInts: { top: number; bot: number; idx: number }[] = [];
  slurries.forEach((s, i) => {
    const h = getSlurryHeight(slurries, i, wellData.casingDepthMD);
    if (h > 0) {
      const bot = i === slurries.length - 1 ? wellData.casingDepthMD : slurries[i + 1].topDepthMD;
      cemInts.push({ top: s.topDepthMD, bot, idx: i });
    }
  });

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
    for (let j = 0; j < traj.length - 1; j++) {
      if (md >= traj[j].md && md <= traj[j + 1].md) {
        const f = (md - traj[j].md) / (traj[j + 1].md - traj[j].md || 1);
        return traj[j].zenith + f * (traj[j + 1].zenith - traj[j].zenith);
      }
    }
    return 0;
  }

  const mdMin = Math.min(
    ...(cemInts.map(c => c.top)),
    ...(bufInts.map(b => b.top)),
    wellData.casingDepthMD
  );
  const mdMax = wellData.casingDepthMD;
  const N = 400;
  const info: DepthInfo[] = [];

  // Build all fluid zones with boundaries
  const allZones: { top: number; bot: number; type: DepthInfo["fluidType"]; density: number; yp: number; zoneIdx: number }[] = [];
  let zi = 0;
  for (const bi of bufInts) {
    allZones.push({ top: bi.top, bot: bi.bot, type: "buffer", density: buffers[bi.idx].density, yp: buffers[bi.idx].rheology.yp, zoneIdx: zi++ });
  }
  for (const ci of cemInts) {
    allZones.push({ top: ci.top, bot: ci.bot, type: "cement", density: slurries[ci.idx].density * 1000, yp: slurries[ci.idx].rheology.yp, zoneIdx: zi++ });
  }
  allZones.sort((a, b) => a.top - b.top);

  for (let i = 0; i <= N; i++) {
    const md = mdMin + (mdMax - mdMin) * i / N;
    const zenithDeg = zenithAt(md);
    const isOpenHole = md > wellData.prevCasingDepth;

    let fluidType: DepthInfo["fluidType"] = "mud";
    let fluidDensity = drillingFluid.density;
    let fluidYP = drillingFluid.rheology.yp;
    let distFromTopFrac = 0.5;
    let distFromBoundary = 1;
    let zoneIndex = 99;

    for (const z of allZones) {
      if (md >= z.top && md <= z.bot) {
        fluidType = z.type;
        fluidDensity = z.density;
        fluidYP = z.yp;
        zoneIndex = z.zoneIdx;
        const zoneLen = z.bot - z.top || 1;
        distFromTopFrac = (md - z.top) / zoneLen;
        // Distance to nearest boundary (0 at boundary, 1 at center)
        const distTop = (md - z.top) / zoneLen;
        const distBot = (z.bot - md) / zoneLen;
        distFromBoundary = Math.min(distTop, distBot) * 2; // 0..1
        break;
      }
    }

    info.push({ md, zenithDeg, fluidType, fluidDensity, fluidYP, isOpenHole, distFromTopFrac, distFromBoundary, zoneIndex });
  }
  return { info, mdMin, mdMax };
}

/**
 * Displacement efficiency 0..1.
 * Longitudinal channels (vertical streaks) that vary with depth.
 * Near fluid boundaries: transition/mixing zones with poor displacement.
 * Different zones have different channel patterns (seed from zoneIndex).
 * Cement front (top of cement) has worse displacement than bottom.
 */
function calcEff(
  d: DepthInfo,
  angle: number,
  circumFrac: number,
  depthFrac: number,
  mudDensity: number,
  mudYP: number,
  avgRate: number,
  annArea: number,
  cavernCoeff: number,
): number {
  if (d.fluidType === "mud") return 0;

  // ── Base efficiency from fluid properties ──
  const densityRatio = d.fluidDensity / mudDensity;
  const dScore = Math.min(1, Math.max(0, (densityRatio - 0.85) / 0.55));
  const ypScore = Math.min(1, Math.max(0.15, (d.fluidYP / Math.max(mudYP, 1)) * 0.35));
  const vel = avgRate > 0 ? (avgRate * 0.001) / annArea : 0.3;
  const vScore = Math.min(1, vel / 1.0);
  let eff = 0.30 * dScore + 0.25 * ypScore + 0.45 * vScore;

  // ── Inclination → eccentricity ──
  const eccen = Math.sin(d.zenithDeg * Math.PI / 180);
  const cosA = Math.cos(angle);
  eff -= eccen * cosA * 0.35;

  if (d.isOpenHole) eff *= 0.90;
  if (cavernCoeff > 1.05) eff *= 1.0 - (cavernCoeff - 1.0) * 0.25;
  if (d.fluidType === "buffer") eff *= 0.5;

  // ── Depth-dependent variation ──
  // 1. Cement front (top of zone): displacement is worst here (leading edge turbulence)
  //    Bottom of zone: cement has settled, better displacement
  const frontPenalty = (1 - d.distFromTopFrac) * 0.2; // worse at top
  eff -= frontPenalty;

  // 2. Transition/mixing zones at fluid boundaries: poor displacement
  //    distFromBoundary: 0=at boundary, 1=zone center
  const boundaryPenalty = (1 - d.distFromBoundary) * 0.25;
  eff -= boundaryPenalty;

  // ── Longitudinal channels with depth variation ──
  // Use zoneIndex as seed offset so each zone has unique channel pattern
  const seedOffset = d.zoneIndex * 7.31;
  
  // Channels: high freq circumferentially, but they SHIFT and CHANGE with depth
  // depthFrac scaled higher so pattern actually changes along the wellbore
  const dY = depthFrac * 30 + seedOffset; // much more depth variation
  
  const channelNoise = 
    0.40 * smoothNoise(circumFrac * 8 + seedOffset, dY * 0.3) +
    0.30 * smoothNoise(circumFrac * 18 + seedOffset * 0.5, dY * 0.7) +
    0.20 * smoothNoise(circumFrac * 35, dY * 1.2) +
    0.10 * smoothNoise(circumFrac * 60, dY * 2.0);

  // Channel intensity varies with depth (some depths have deeper channels)
  const channelIntensity = 0.3 + 0.25 * smoothNoise(circumFrac * 3, dY * 0.15);
  eff += (channelNoise - 0.5) * channelIntensity;

  // 3. Washout/cavern zones: random pockets of bad displacement at certain depths
  const washoutNoise = smoothNoise(depthFrac * 15 + 5.7, circumFrac * 4 + seedOffset);
  if (washoutNoise > 0.75 && d.isOpenHole) {
    eff -= (washoutNoise - 0.75) * 1.2; // localized bad zones
  }

  // 4. Laminar flow penalty — channels deeper in laminar regime
  const Re = vel * 0.05 * mudDensity / (mudYP > 0 ? mudYP * 0.001 : 0.025);
  if (Re < 2100) {
    const laminarChannels = smoothNoise(circumFrac * 12 + seedOffset, dY * 0.5) * 0.18;
    eff -= laminarChannels;
  }

  return Math.max(0, Math.min(1, eff));
}

export default function DisplacementEfficiency({ wellData, slurries, buffers, drillingFluid, centralizationResults }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { info, mdMin, mdMax } = useMemo(
    () => buildDepthInfo(wellData, slurries, buffers, drillingFluid),
    [wellData, slurries, buffers, drillingFluid]
  );

  const annArea = useMemo(() => {
    const dH = wellData.holeDiameter / 1000;
    const dC = wellData.casingOD / 1000;
    return (Math.PI / 4) * (dH * dH - dC * dC);
  }, [wellData.holeDiameter, wellData.casingOD]);

  // Интерполяция эксцентриситета из данных центрирования
  const getEccentricityAtMD = useMemo(() => {
    if (!centralizationResults || centralizationResults.length === 0) return (_md: number) => 0;
    const sorted = [...centralizationResults].sort((a, b) => a.md - b.md);
    return (md: number): number => {
      if (md <= sorted[0].md) return sorted[0].eccentricity;
      if (md >= sorted[sorted.length - 1].md) return sorted[sorted.length - 1].eccentricity;
      for (let i = 0; i < sorted.length - 1; i++) {
        if (md >= sorted[i].md && md <= sorted[i + 1].md) {
          const f = (md - sorted[i].md) / (sorted[i + 1].md - sorted[i].md);
          return sorted[i].eccentricity + f * (sorted[i + 1].eccentricity - sorted[i].eccentricity);
        }
      }
      return 0;
    };
  }, [centralizationResults]);

  const avgRate = useMemo(() => {
    const r: number[] = [];
    slurries.forEach(s => s.flowRateSteps.forEach(st => { if (st.rateLps > 0) r.push(st.rateLps); }));
    buffers.forEach(b => b.flowRateSteps.forEach(st => { if (st.rateLps > 0) r.push(st.rateLps); }));
    return r.length > 0 ? r.reduce((a, b) => a + b) / r.length : 5;
  }, [slurries, buffers]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || info.length < 2) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = 480, H = 680;
    const mL = 55, mR = 20, mT = 30, mB = 50;
    const plotH = H - mT - mB;
    const plotW = W - mL - mR;

    // Layout: [borehole wall] annulus | casing | annulus [borehole wall]
    const casingW = plotW * 0.12;
    const annW = (plotW - casingW) / 2;
    const annLX = mL;
    const casX = mL + annW;
    const annRX = casX + casingW;

    canvas.width = W * 2;
    canvas.height = H * 2;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.scale(2, 2);

    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, W, H);

    const numAnglesPerSide = 80;
    const mdRange = mdMax - mdMin || 1;

    // Use ImageData for speed
    // We'll draw pixel-by-pixel on a temporary canvas
    const imgW = Math.round(plotW);
    const imgH = Math.round(plotH);
    const imgData = ctx.createImageData(imgW * 2, imgH * 2);
    const pixels = imgData.data;
    const annFracW = annW / plotW;
    const casFracW = casingW / plotW;

    for (let py = 0; py < imgH * 2; py++) {
      const yFrac = py / (imgH * 2);
      const diFloat = yFrac * (info.length - 1);
      const di = Math.min(Math.floor(diFloat), info.length - 1);
      const d = info[di];

      // Эксцентриситет колонны на данной глубине (0 = по центру, 1 = лежит на стенке)
      const ecc = getEccentricityAtMD(d.md);
      // Смещение колонны: ecc * (доступный зазор в пикселях)
      // Колонна смещается ВПРАВО (лежит на правой стенке = low side)
      const maxOffsetPx = annW / plotW * 0.85; // макс. смещение как доля от ширины
      const offsetFrac = ecc * maxOffsetPx; // смещение центра колонны в долях от plotW

      // Динамические границы колонны с учётом смещения
      const casCenterFrac = annFracW + casFracW / 2 + offsetFrac;
      const casLeftFrac = casCenterFrac - casFracW / 2;
      const casRightFrac = casCenterFrac + casFracW / 2;

      for (let px = 0; px < imgW * 2; px++) {
        const xFrac = px / (imgW * 2);

        let gray = 0;
        let alpha = 255;

         // Затемнение для тяжёлого цемента (более тёмный = более плотный)
         const densityDarkening = d.fluidType === "cement"
           ? Math.min(0.35, Math.max(0, (d.fluidDensity - 1400) / 2000) * 0.35)
           : 0;

         if (xFrac < casLeftFrac) {
          // Левое затрубье (расширенное при эксцентриситете)
          const leftAnnWidth = casLeftFrac;
          const localFrac = leftAnnWidth > 0 ? xFrac / leftAnnWidth : 0;
          const angle = Math.PI * (1 - localFrac);
          const eff = calcEff(d, angle, localFrac, yFrac, drillingFluid.density, drillingFluid.rheology.yp, avgRate, annArea, wellData.cavernCoeff);
          gray = Math.round((40 + (1 - eff) * 215) * (1 - densityDarkening));
        } else if (xFrac > casRightFrac) {
          // Правое затрубье (сужено при эксцентриситете — low side)
          const rightAnnStart = casRightFrac;
          const rightAnnWidth = 1.0 - rightAnnStart;
          const localFrac = rightAnnWidth > 0 ? (xFrac - rightAnnStart) / rightAnnWidth : 0;
          const angle = Math.PI * localFrac;
          // На сжатой стороне — хуже замещение (дополнительный штраф от эксцентриситета)
          const eccPenalty = ecc * 0.3;
          const eff = Math.max(0, calcEff(d, angle, localFrac + 1, yFrac, drillingFluid.density, drillingFluid.rheology.yp, avgRate, annArea, wellData.cavernCoeff) - eccPenalty);
          gray = Math.round((40 + (1 - eff) * 215) * (1 - densityDarkening));
        } else {
          // Колонна — steel gray
          gray = 110;
          alpha = 220;
        }

        const idx = (py * imgW * 2 + px) * 4;
        pixels[idx] = gray;
        pixels[idx + 1] = gray;
        pixels[idx + 2] = gray;
        pixels[idx + 3] = alpha;
      }
    }

    ctx.putImageData(imgData, mL * 2, mT * 2);

    // Borehole walls
    ctx.strokeStyle = "#8B7D6B";
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(annLX, mT); ctx.lineTo(annLX, mT + plotH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(annRX + annW, mT); ctx.lineTo(annRX + annW, mT + plotH); ctx.stroke();

    // Casing walls — follow eccentricity curve with smooth Bezier transitions
    const casingPoints: { y: number; leftX: number; rightX: number }[] = [];
    for (let i = 0; i <= info.length - 1; i++) {
      const y = mT + (i / (info.length - 1)) * plotH;
      const ecc = getEccentricityAtMD(info[i].md);
      const offset = ecc * annW * 0.85;
      casingPoints.push({ y, leftX: casX + offset, rightX: annRX + offset });
    }

    // Draw smooth casing walls using quadratic Bezier curves
    const drawSmoothLine = (getX: (p: typeof casingPoints[0]) => number) => {
      ctx.strokeStyle = "#bbb";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (casingPoints.length < 2) return;
      ctx.moveTo(getX(casingPoints[0]), casingPoints[0].y);
      for (let i = 0; i < casingPoints.length - 1; i++) {
        const p0 = casingPoints[i];
        const p1 = casingPoints[i + 1];
        const cpX = (getX(p0) + getX(p1)) / 2;
        const cpY = (p0.y + p1.y) / 2;
        ctx.quadraticCurveTo(getX(p0), p0.y, cpX, cpY);
      }
      const last = casingPoints[casingPoints.length - 1];
      ctx.lineTo(getX(last), last.y);
      ctx.stroke();
    };
    drawSmoothLine(p => p.leftX);
    drawSmoothLine(p => p.rightX);

    // Labels
    ctx.fillStyle = "#aaa";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "right";
    const dInt = mdRange > 300 ? 100 : mdRange > 100 ? 50 : 20;
    for (let md = Math.ceil(mdMin / dInt) * dInt; md <= mdMax; md += dInt) {
      const y = mT + ((md - mdMin) / mdRange) * plotH;
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

    // X labels
    ctx.fillStyle = "#888";
    ctx.font = "9px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Порода", annLX - 8, mT + plotH + 14);
    ctx.fillText("Затрубье", annLX + annW / 2, mT + plotH + 14);
    ctx.fillText("Колонна", casX + casingW / 2, mT + plotH + 14);
    ctx.fillText("Затрубье", annRX + annW / 2, mT + plotH + 14);
    ctx.fillText("Порода", annRX + annW + 12, mT + plotH + 14);

    // Title
    ctx.fillStyle = "#ddd";
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Эффективность замещения — продольный разрез", W / 2, 16);

    // Legend
    const legX = mL, legY = mT + plotH + 24, legW = plotW, legH = 10;
    for (let i = 0; i < legW; i++) {
      const eff = i / legW;
      const g = Math.round(40 + (1 - eff) * 215);
      ctx.fillStyle = `rgb(${g},${g},${g})`;
      ctx.fillRect(legX + i, legY, 1.5, legH);
    }
    ctx.strokeStyle = "#555";
    ctx.lineWidth = 0.5;
    ctx.strokeRect(legX, legY, legW, legH);
    ctx.fillStyle = "#aaa";
    ctx.font = "9px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("Засвет (каналы БР)", legX, legY + legH + 12);
    ctx.textAlign = "right";
    ctx.fillText("Полное замещение", legX + legW, legY + legH + 12);

  }, [info, mdMin, mdMax, drillingFluid, avgRate, annArea, wellData, getEccentricityAtMD]);

  const range = info.length >= 2 ? `${info[0].md.toFixed(0)} – ${info[info.length - 1].md.toFixed(0)} м` : "";

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">Эффективность замещения</CardTitle>
            <p className="text-xs text-muted-foreground">
              Продольный разрез кольцевого пространства ({range}). Тёмное — цемент замещён полностью, белое — каналы бурового раствора (засветы).
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
