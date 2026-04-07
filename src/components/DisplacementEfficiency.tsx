import { useEffect, useRef, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import CopyImageButton from "./CopyImageButton";
import type { WellData, SlurryInput, BufferFluid, DrillingFluid } from "@/lib/cementing-calculations";
import { getSlurryHeight, annularVolumePerMeter } from "@/lib/cementing-calculations";
import type { CentralizationResult } from "@/lib/centralization-calculations";

interface Props {
  wellData: WellData;
  slurries: SlurryInput[];
  buffers: BufferFluid[];
  drillingFluid: DrillingFluid;
  displacementFluids?: any[];
  centralizationResults?: CentralizationResult[];
}

// ── Noise helpers ──
function hash2d(ix: number, iy: number): number {
  let h = ix * 374761393 + iy * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) & 0x7fffffff) / 0x7fffffff;
}
function smoothNoise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const n00 = hash2d(ix, iy), n10 = hash2d(ix + 1, iy);
  const n01 = hash2d(ix, iy + 1), n11 = hash2d(ix + 1, iy + 1);
  return (n00 + (n10 - n00) * sx) + ((n01 + (n11 - n01) * sx) - (n00 + (n10 - n00) * sx)) * sy;
}

// ── Fluid zone info ──
interface FluidZone {
  topMD: number;
  botMD: number;
  type: "cement" | "buffer" | "mud";
  density: number;
  yp: number;
  pv: number;
  name: string;
  color: string; // base color for this zone
  idx: number;
}

function buildFluidZones(
  wellData: WellData, slurries: SlurryInput[], buffers: BufferFluid[], drillingFluid: DrillingFluid
): FluidZone[] {
  const annVPM = annularVolumePerMeter(wellData.holeDiameter, wellData.casingOD, wellData.cavernCoeff);
  const zones: FluidZone[] = [];

  // Cement intervals
  const cementColors = [
    "hsl(200, 55%, 35%)",   // blue-steel
    "hsl(160, 40%, 30%)",   // teal-dark
    "hsl(220, 50%, 40%)",   // slate-blue
    "hsl(30, 45%, 35%)",    // warm brown
  ];
  const cemInts: { top: number; bot: number; idx: number }[] = [];
  slurries.forEach((s, i) => {
    const h = getSlurryHeight(slurries, i, wellData.casingDepthMD);
    if (h > 0) {
      const bot = i === slurries.length - 1 ? wellData.casingDepthMD : slurries[i + 1].topDepthMD;
      cemInts.push({ top: s.topDepthMD, bot, idx: i });
    }
  });
  cemInts.forEach((ci, i) => {
    zones.push({
      topMD: ci.top, botMD: ci.bot, type: "cement",
      density: slurries[ci.idx].density * 1000,
      yp: slurries[ci.idx].rheology.yp,
      pv: slurries[ci.idx].rheology.pv,
      name: slurries[ci.idx].name || `Цемент ${ci.idx + 1}`,
      color: cementColors[i % cementColors.length],
      idx: i,
    });
  });

  // Buffer intervals (stack from top of cement upwards)
  const bufferColors = [
    "hsl(50, 60%, 50%)",    // amber
    "hsl(80, 50%, 45%)",    // olive
  ];
  let cur = cemInts.length > 0 ? Math.min(...cemInts.map(c => c.top)) : wellData.casingDepthMD;
  for (let i = buffers.length - 1; i >= 0; i--) {
    const bufH = buffers[i].volume / annVPM;
    const bot = cur;
    const top = Math.max(0, cur - bufH);
    zones.push({
      topMD: top, botMD: bot, type: "buffer",
      density: buffers[i].density,
      yp: buffers[i].rheology.yp,
      pv: buffers[i].rheology.pv,
      name: buffers[i].name || `Буфер ${i + 1}`,
      color: bufferColors[i % bufferColors.length],
      idx: 100 + i,
    });
    cur = top;
  }

  zones.sort((a, b) => a.topMD - b.topMD);
  return zones;
}

function parseHSL(hsl: string): [number, number, number] {
  const m = hsl.match(/hsl\((\d+),\s*(\d+)%?,\s*(\d+)%?\)/);
  if (!m) return [200, 50, 40];
  return [+m[1], +m[2], +m[3]];
}

// ── Displacement efficiency ──
function calcEff(
  zenithDeg: number, fluidDensity: number, fluidYP: number,
  mudDensity: number, mudYP: number,
  isOpenHole: boolean, cavernCoeff: number,
  distFromTop: number, distFromBoundary: number,
  angle: number, circumFrac: number, depthFrac: number,
  zoneIdx: number, ecc: number, turbMult: number,
  avgVel: number, fluidType: "cement" | "buffer" | "mud",
): number {
  if (fluidType === "mud") return 0;

  const densityRatio = fluidDensity / mudDensity;
  const dScore = Math.min(1, Math.max(0, (densityRatio - 0.85) / 0.55));
  const ypScore = Math.min(1, Math.max(0.15, (fluidYP / Math.max(mudYP, 1)) * 0.35));
  const vScore = Math.min(1, avgVel / 1.0);
  let eff = 0.30 * dScore + 0.25 * ypScore + 0.45 * vScore;

  // Inclination → eccentricity penalty on low side
  const eccen = Math.sin(zenithDeg * Math.PI / 180);
  const cosA = Math.cos(angle);
  eff -= eccen * cosA * 0.35;

  // Centralization eccentricity
  eff -= ecc * 0.25 * Math.max(0, cosA);

  // Turbulizer boost: increases mixing → better displacement
  if (turbMult > 1) {
    eff += (turbMult - 1) * 0.08;
  }

  if (isOpenHole) eff *= 0.90;
  if (cavernCoeff > 1.05) eff *= 1.0 - (cavernCoeff - 1.0) * 0.25;
  if (fluidType === "buffer") eff *= 0.5;

  // Cement front penalty
  eff -= (1 - distFromTop) * 0.18;
  // Boundary mixing penalty
  eff -= (1 - distFromBoundary) * 0.22;

  // Longitudinal channels with depth variation
  const seed = zoneIdx * 7.31;
  const dY = depthFrac * 30 + seed;
  const channelNoise =
    0.40 * smoothNoise(circumFrac * 8 + seed, dY * 0.3) +
    0.30 * smoothNoise(circumFrac * 18 + seed * 0.5, dY * 0.7) +
    0.20 * smoothNoise(circumFrac * 35, dY * 1.2) +
    0.10 * smoothNoise(circumFrac * 60, dY * 2.0);
  const channelInt = 0.3 + 0.25 * smoothNoise(circumFrac * 3, dY * 0.15);
  // Turbulizer reduces channel depth
  const turbReduction = turbMult > 1 ? 0.6 : 1.0;
  eff += (channelNoise - 0.5) * channelInt * turbReduction;

  // Washout zones in open hole
  if (isOpenHole) {
    const wo = smoothNoise(depthFrac * 15 + 5.7, circumFrac * 4 + seed);
    if (wo > 0.75) eff -= (wo - 0.75) * 1.2;
  }

  // Laminar flow channels
  const Re = avgVel * 0.05 * mudDensity / (mudYP > 0 ? mudYP * 0.001 : 0.025);
  if (Re < 2100 && turbMult <= 1) {
    eff -= smoothNoise(circumFrac * 12 + seed, dY * 0.5) * 0.18;
  }

  return Math.max(0, Math.min(1, eff));
}

export default function DisplacementEfficiency({ wellData, slurries, buffers, drillingFluid, centralizationResults }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const zones = useMemo(
    () => buildFluidZones(wellData, slurries, buffers, drillingFluid),
    [wellData, slurries, buffers, drillingFluid]
  );

  const mdMin = useMemo(() => {
    if (zones.length === 0) return wellData.casingDepthMD;
    return Math.min(...zones.map(z => z.topMD));
  }, [zones, wellData.casingDepthMD]);
  const mdMax = wellData.casingDepthMD;

  const annArea = useMemo(() => {
    const dH = wellData.holeDiameter / 1000;
    const dC = wellData.casingOD / 1000;
    return (Math.PI / 4) * (dH * dH - dC * dC);
  }, [wellData.holeDiameter, wellData.casingOD]);

  // Interpolate centralization results
  const getCentDataAtMD = useMemo(() => {
    if (!centralizationResults || centralizationResults.length === 0) {
      return (_md: number) => ({ ecc: 0, turbMult: 1, standoff: 100 });
    }
    const sorted = [...centralizationResults].sort((a, b) => a.md - b.md);
    return (md: number) => {
      if (md <= sorted[0].md) return { ecc: sorted[0].eccentricity, turbMult: sorted[0].turbulenceMultiplier, standoff: sorted[0].standoff };
      if (md >= sorted[sorted.length - 1].md) {
        const l = sorted[sorted.length - 1];
        return { ecc: l.eccentricity, turbMult: l.turbulenceMultiplier, standoff: l.standoff };
      }
      for (let i = 0; i < sorted.length - 1; i++) {
        if (md >= sorted[i].md && md <= sorted[i + 1].md) {
          const f = (md - sorted[i].md) / (sorted[i + 1].md - sorted[i].md);
          return {
            ecc: sorted[i].eccentricity + f * (sorted[i + 1].eccentricity - sorted[i].eccentricity),
            turbMult: sorted[i].turbulenceMultiplier + f * (sorted[i + 1].turbulenceMultiplier - sorted[i].turbulenceMultiplier),
            standoff: sorted[i].standoff + f * (sorted[i + 1].standoff - sorted[i].standoff),
          };
        }
      }
      return { ecc: 0, turbMult: 1, standoff: 100 };
    };
  }, [centralizationResults]);

  const avgRate = useMemo(() => {
    const r: number[] = [];
    slurries.forEach(s => s.flowRateSteps.forEach(st => { if (st.rateLps > 0) r.push(st.rateLps); }));
    buffers.forEach(b => b.flowRateSteps.forEach(st => { if (st.rateLps > 0) r.push(st.rateLps); }));
    return r.length > 0 ? r.reduce((a, b) => a + b) / r.length : 5;
  }, [slurries, buffers]);

  const traj = useMemo(() => {
    return wellData.trajectory?.length >= 2
      ? [...wellData.trajectory].sort((a, b) => a.md - b.md)
      : [{ md: 0, azimuth: 0, zenith: 0, tvd: 0 }, { md: wellData.casingDepthMD, azimuth: 0, zenith: 0, tvd: wellData.casingDepthMD }];
  }, [wellData]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || zones.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = 520, H = 720;
    const mL = 58, mR = 120, mT = 36, mB = 60;
    const plotH = H - mT - mB;
    const plotW = W - mL - mR;
    const mdRange = mdMax - mdMin || 1;

    // Casing geometry proportions
    const casingW = plotW * 0.10;
    const annW = (plotW - casingW) / 2;

    canvas.width = W * 2;
    canvas.height = H * 2;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.scale(2, 2);

    // Background gradient
    const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, "#0f1318");
    bgGrad.addColorStop(1, "#1a1f2e");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // Zenith interpolation
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

    // Find zone at depth
    function getZoneAt(md: number): FluidZone | null {
      for (const z of zones) {
        if (md >= z.topMD && md <= z.botMD) return z;
      }
      return null;
    }

    const N_Y = plotH * 2;
    const N_X = plotW * 2;
    const imgData = ctx.createImageData(N_X, N_Y);
    const pixels = imgData.data;
    const annFracW = annW / plotW;
    const casFracW = casingW / plotW;
    const avgVel = (avgRate * 0.001) / (annArea > 0 ? annArea : 0.01);

    // ── Render pixel grid ──
    for (let py = 0; py < N_Y; py++) {
      const yFrac = py / N_Y;
      const md = mdMin + yFrac * mdRange;
      const zenithDeg = zenithAt(md);
      const isOpenHole = md > wellData.prevCasingDepth;
      const zone = getZoneAt(md);
      const centData = getCentDataAtMD(md);
      const ecc = centData.ecc;
      const turbMult = centData.turbMult;

      // Eccentricity offset
      const maxOffset = annFracW * 0.85;
      const offsetFrac = ecc * maxOffset;
      const casCenterFrac = annFracW + casFracW / 2 + offsetFrac;
      const casLeftFrac = casCenterFrac - casFracW / 2;
      const casRightFrac = casCenterFrac + casFracW / 2;

      for (let px = 0; px < N_X; px++) {
        const xFrac = px / N_X;
        let r = 15, g = 18, b = 25, a = 255;

        if (xFrac >= casLeftFrac && xFrac <= casRightFrac) {
          // ── Casing: solid steel gradient ──
          const t = (xFrac - casLeftFrac) / (casRightFrac - casLeftFrac);
          // 3D pipe shading: bright at edges, darker in center
          const shade = 0.35 + 0.65 * Math.pow(Math.abs(2 * t - 1), 0.6);
          const base = 100 + shade * 60;
          r = Math.round(base * 0.85);
          g = Math.round(base * 0.88);
          b = Math.round(base * 0.95);
          a = 240;
        } else {
          // ── Annulus ──
          const isLeft = xFrac < casLeftFrac;
          let localFrac: number, angle: number;
          if (isLeft) {
            localFrac = casLeftFrac > 0 ? xFrac / casLeftFrac : 0;
            angle = Math.PI * (1 - localFrac);
          } else {
            const rightStart = casRightFrac;
            const rightW = 1.0 - rightStart;
            localFrac = rightW > 0 ? (xFrac - rightStart) / rightW : 0;
            angle = Math.PI * localFrac;
          }

          if (!zone || zone.type === "mud") {
            // Mud (drilling fluid) — dark brownish
            const mudNoise = smoothNoise(localFrac * 5, yFrac * 20) * 0.15;
            r = Math.round(45 + mudNoise * 30);
            g = Math.round(38 + mudNoise * 25);
            b = Math.round(30 + mudNoise * 20);
          } else {
            // Cement or buffer
            const zLen = zone.botMD - zone.topMD || 1;
            const distTop = (md - zone.topMD) / zLen;
            const distBot = (zone.botMD - md) / zLen;
            const distBoundary = Math.min(distTop, distBot) * 2;
            const eccPenalty = !isLeft ? ecc * 0.3 : 0;

            const eff = Math.max(0, calcEff(
              zenithDeg, zone.density, zone.yp,
              drillingFluid.density, drillingFluid.rheology.yp,
              isOpenHole, wellData.cavernCoeff,
              distTop, distBoundary, angle,
              isLeft ? localFrac : localFrac + 1, yFrac,
              zone.idx, ecc, turbMult, avgVel, zone.type,
            ) - eccPenalty);

            // Map efficiency to color: zone base color → white (poor displacement = mud channel)
            const [zh, zs, zl] = parseHSL(zone.color);
            // Good displacement: saturated zone color (darker)
            // Poor displacement: light/white (mud channel = засвет)
            const effL = zl * (0.5 + eff * 0.5); // darker with better eff
            const effS = zs * (0.4 + eff * 0.6);
            // Mix: poor eff → whitish (засвет)
            const mudR = 220, mudG = 215, mudB = 200; // mud channel color (light)
            const hslToRGB = (h: number, s: number, l: number) => {
              const sn = s / 100, ln = l / 100;
              const c = (1 - Math.abs(2 * ln - 1)) * sn;
              const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
              const m = ln - c / 2;
              let rr = 0, gg = 0, bb = 0;
              if (h < 60) { rr = c; gg = x; }
              else if (h < 120) { rr = x; gg = c; }
              else if (h < 180) { gg = c; bb = x; }
              else if (h < 240) { gg = x; bb = c; }
              else if (h < 300) { rr = x; bb = c; }
              else { rr = c; bb = x; }
              return [Math.round((rr + m) * 255), Math.round((gg + m) * 255), Math.round((bb + m) * 255)];
            };
            const [cr, cg, cb] = hslToRGB(zh, effS, effL);
            // Blend with mud color based on efficiency
            r = Math.round(cr * eff + mudR * (1 - eff));
            g = Math.round(cg * eff + mudG * (1 - eff));
            b = Math.round(cb * eff + mudB * (1 - eff));
          }
        }

        const idx = (py * N_X + px) * 4;
        pixels[idx] = r;
        pixels[idx + 1] = g;
        pixels[idx + 2] = b;
        pixels[idx + 3] = a;
      }
    }

    ctx.putImageData(imgData, mL * 2, mT * 2);

    // ── Borehole walls ──
    ctx.lineWidth = 2.5;
    const wallGrad = ctx.createLinearGradient(0, mT, 0, mT + plotH);
    wallGrad.addColorStop(0, "#6b5f52");
    wallGrad.addColorStop(0.5, "#8b7d6b");
    wallGrad.addColorStop(1, "#5a4f42");
    ctx.strokeStyle = wallGrad;
    ctx.beginPath(); ctx.moveTo(mL, mT); ctx.lineTo(mL, mT + plotH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(mL + plotW, mT); ctx.lineTo(mL + plotW, mT + plotH); ctx.stroke();

    // ── Casing walls — smooth Bezier ──
    const casingPts: { y: number; lx: number; rx: number }[] = [];
    const nPts = 200;
    for (let i = 0; i <= nPts; i++) {
      const md = mdMin + (mdRange * i / nPts);
      const y = mT + (i / nPts) * plotH;
      const ecc = getCentDataAtMD(md).ecc;
      const offset = ecc * annW * 0.85;
      const cx = mL + annW;
      casingPts.push({ y, lx: cx + offset, rx: cx + casingW + offset });
    }
    const drawCasingWall = (getX: (p: typeof casingPts[0]) => number) => {
      const grad = ctx.createLinearGradient(0, mT, 0, mT + plotH);
      grad.addColorStop(0, "#a0a8b4");
      grad.addColorStop(0.5, "#c0c8d0");
      grad.addColorStop(1, "#9098a4");
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(getX(casingPts[0]), casingPts[0].y);
      for (let i = 1; i < casingPts.length; i++) {
        const p0 = casingPts[i - 1], p1 = casingPts[i];
        const cpX = (getX(p0) + getX(p1)) / 2;
        const cpY = (p0.y + p1.y) / 2;
        ctx.quadraticCurveTo(getX(p0), p0.y, cpX, cpY);
      }
      ctx.lineTo(getX(casingPts[casingPts.length - 1]), casingPts[casingPts.length - 1].y);
      ctx.stroke();
    };
    drawCasingWall(p => p.lx);
    drawCasingWall(p => p.rx);

    // ── Dashed boundary lines between fluid zones ──
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.2;
    for (const z of zones) {
      // Top boundary
      const yTop = mT + ((z.topMD - mdMin) / mdRange) * plotH;
      const yBot = mT + ((z.botMD - mdMin) / mdRange) * plotH;
      const [zh] = parseHSL(z.color);
      const lineColor = `hsla(${zh}, 70%, 65%, 0.8)`;
      ctx.strokeStyle = lineColor;
      // Top line
      if (z.topMD > mdMin + 1) {
        ctx.beginPath();
        ctx.moveTo(mL + 2, yTop);
        ctx.lineTo(mL + plotW - 2, yTop);
        ctx.stroke();
      }
      // Bottom line
      if (z.botMD < mdMax - 1) {
        ctx.beginPath();
        ctx.moveTo(mL + 2, yBot);
        ctx.lineTo(mL + plotW - 2, yBot);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);

    // ── Identify and mark unrealistic zones (standoff < 50% → засвет) ──
    if (centralizationResults && centralizationResults.length > 0) {
      const badZones: { from: number; to: number }[] = [];
      let curBad: { from: number; to: number } | null = null;
      const sorted = [...centralizationResults].sort((a, b) => a.md - b.md);
      for (const pt of sorted) {
        if (pt.md < mdMin || pt.md > mdMax) continue;
        const zone = zones.find(z => pt.md >= z.topMD && pt.md <= z.botMD);
        if (!zone) continue;
        // Bad if standoff < 50 or very high eccentricity
        const isBad = pt.standoff < 50 || pt.eccentricity > 0.6;
        if (isBad) {
          if (!curBad) curBad = { from: pt.md, to: pt.md };
          else curBad.to = pt.md;
        } else {
          if (curBad) { badZones.push(curBad); curBad = null; }
        }
      }
      if (curBad) badZones.push(curBad);

      // Draw warning markers for bad zones
      for (const bz of badZones) {
        const y1 = mT + ((bz.from - mdMin) / mdRange) * plotH;
        const y2 = mT + ((bz.to - mdMin) / mdRange) * plotH;
        const h = Math.max(y2 - y1, 4);
        // Transparent red overlay on the right side
        ctx.fillStyle = "rgba(220, 50, 50, 0.15)";
        ctx.fillRect(mL + plotW + 2, y1, 18, h);
        ctx.strokeStyle = "rgba(220, 50, 50, 0.6)";
        ctx.lineWidth = 1;
        ctx.strokeRect(mL + plotW + 2, y1, 18, h);
        // Warning marker
        ctx.fillStyle = "rgba(220, 80, 60, 0.9)";
        ctx.font = "bold 9px sans-serif";
        ctx.textAlign = "left";
        const midY = (y1 + y2) / 2;
        ctx.fillText("⚠", mL + plotW + 5, midY + 3);
      }
    }

    // ── Depth labels (left axis) ──
    ctx.fillStyle = "#8899aa";
    ctx.font = "10px monospace";
    ctx.textAlign = "right";
    const dInt = mdRange > 500 ? 100 : mdRange > 200 ? 50 : 20;
    for (let md = Math.ceil(mdMin / dInt) * dInt; md <= mdMax; md += dInt) {
      const y = mT + ((md - mdMin) / mdRange) * plotH;
      ctx.fillStyle = "#334";
      ctx.fillRect(mL - 5, y, 5, 1);
      ctx.fillStyle = "#8899aa";
      ctx.fillText(`${md}`, mL - 8, y + 3);
    }

    // Y axis label
    ctx.save();
    ctx.translate(13, mT + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = "#8899aa";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Глубина по стволу, м", 0, 0);
    ctx.restore();

    // ── Zone labels on the right ──
    for (const z of zones) {
      const yMid = mT + (((z.topMD + z.botMD) / 2 - mdMin) / mdRange) * plotH;
      const [zh, zs] = parseHSL(z.color);
      ctx.fillStyle = `hsl(${zh}, ${zs}%, 65%)`;
      ctx.font = "bold 10px sans-serif";
      ctx.textAlign = "left";
      const labelX = mL + plotW + 24;
      ctx.fillText(z.name, labelX, yMid - 2);
      ctx.fillStyle = "#8899aa";
      ctx.font = "9px monospace";
      ctx.fillText(`${z.topMD.toFixed(0)}–${z.botMD.toFixed(0)} м`, labelX, yMid + 10);
      ctx.fillText(`ρ ${(z.density / 1000).toFixed(2)} г/см³`, labelX, yMid + 20);
    }

    // ── Title ──
    ctx.fillStyle = "#d0d8e0";
    ctx.font = "bold 13px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Эффективность замещения — продольный разрез", W / 2 - 30, 18);

    // ── Bottom labels ──
    ctx.fillStyle = "#667788";
    ctx.font = "9px sans-serif";
    ctx.textAlign = "center";
    const cx = mL + annW + casingW / 2;
    ctx.fillText("Порода", mL - 8, mT + plotH + 14);
    ctx.fillText("Затрубье", mL + annW / 2, mT + plotH + 14);
    ctx.fillText("Колонна", cx, mT + plotH + 14);
    ctx.fillText("Затрубье", mL + annW + casingW + annW / 2, mT + plotH + 14);
    ctx.fillText("Порода", mL + plotW + 10, mT + plotH + 14);

    // ── Color legend bar ──
    const legX = mL, legY = mT + plotH + 28, legW = plotW, legH = 10;
    // Gradient from zone color (good) to light (poor/засвет)
    for (let i = 0; i < legW; i++) {
      const eff = i / legW;
      const g = Math.round(220 - eff * 180);
      const rb = Math.round(200 - eff * 160);
      ctx.fillStyle = `rgb(${rb},${rb + 5},${g})`;
      ctx.fillRect(legX + i, legY, 1.5, legH);
    }
    ctx.strokeStyle = "#445";
    ctx.lineWidth = 0.5;
    ctx.strokeRect(legX, legY, legW, legH);
    ctx.fillStyle = "#8899aa";
    ctx.font = "9px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("Засвет (каналы БР)", legX, legY + legH + 12);
    ctx.textAlign = "right";
    ctx.fillText("Полное замещение", legX + legW, legY + legH + 12);

  }, [zones, mdMin, mdMax, drillingFluid, avgRate, annArea, wellData, getCentDataAtMD, traj]);

  const range = zones.length > 0 ? `${mdMin.toFixed(0)} – ${mdMax.toFixed(0)} м` : "";

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">Эффективность замещения</CardTitle>
            <p className="text-xs text-muted-foreground">
              Продольный разрез кольцевого пространства ({range}). Цветное — цемент/буфер, светлое — каналы БР (засветы).
              {centralizationResults && centralizationResults.length > 0 && " Учтены: центрирование, турбулизаторы, реология."}
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
