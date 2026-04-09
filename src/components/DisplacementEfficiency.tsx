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

interface FluidZone {
  topMD: number;
  botMD: number;
  type: "cement" | "buffer" | "mud";
  density: number;
  yp: number;
  pv: number;
  name: string;
  color: string;
  idx: number;
}

function buildFluidZones(
  wellData: WellData, slurries: SlurryInput[], buffers: BufferFluid[], drillingFluid: DrillingFluid
): FluidZone[] {
  const annVPM = annularVolumePerMeter(wellData.holeDiameter, wellData.casingOD, wellData.cavernCoeff);
  const zones: FluidZone[] = [];

  const cementColors = [
    "hsl(210, 20%, 20%)",
    "hsl(190, 24%, 18%)",
    "hsl(226, 18%, 22%)",
    "hsl(28, 22%, 18%)",
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
      topMD: ci.top,
      botMD: ci.bot,
      type: "cement",
      density: slurries[ci.idx].density * 1000,
      yp: slurries[ci.idx].rheology.yp,
      pv: slurries[ci.idx].rheology.pv,
      name: slurries[ci.idx].name || `Цемент ${ci.idx + 1}`,
      color: cementColors[i % cementColors.length],
      idx: i,
    });
  });

  const bufferColors = [
    "hsl(50, 60%, 50%)",
    "hsl(80, 50%, 45%)",
  ];

  let cur = cemInts.length > 0 ? Math.min(...cemInts.map(c => c.top)) : wellData.casingDepthMD;
  for (let i = buffers.length - 1; i >= 0; i--) {
    const bufH = buffers[i].volume / annVPM;
    const bot = cur;
    const top = Math.max(0, cur - bufH);
    zones.push({
      topMD: top,
      botMD: bot,
      type: "buffer",
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

function hslToRGB(h: number, s: number, l: number): [number, number, number] {
  const sn = s / 100;
  const ln = l / 100;
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
}

function calcEff(
  zenithDeg: number,
  fluidDensity: number,
  fluidYP: number,
  mudDensity: number,
  mudYP: number,
  isOpenHole: boolean,
  cavernCoeff: number,
  distFromTop: number,
  distFromBoundary: number,
  angle: number,
  circumFrac: number,
  depthFrac: number,
  zoneIdx: number,
  ecc: number,
  turbMult: number,
  avgVel: number,
  fluidType: "cement" | "buffer" | "mud",
): number {
  if (fluidType === "mud") return 0;

  const densityRatio = fluidDensity / mudDensity;
  const dScore = Math.min(1, Math.max(0, (densityRatio - 0.85) / 0.55));
  const ypScore = Math.min(1, Math.max(0.15, (fluidYP / Math.max(mudYP, 1)) * 0.35));
  const vScore = Math.min(1, avgVel / 1.0);
  let eff = 0.30 * dScore + 0.25 * ypScore + 0.45 * vScore;

  const eccen = Math.sin(zenithDeg * Math.PI / 180);
  const cosA = Math.cos(angle);
  eff -= eccen * cosA * 0.35;
  eff -= ecc * 0.25 * Math.max(0, cosA);

  if (turbMult > 1) eff += (turbMult - 1) * 0.08;

  if (isOpenHole) eff *= 0.90;
  if (cavernCoeff > 1.05) eff *= 1.0 - (cavernCoeff - 1.0) * 0.25;
  if (fluidType === "buffer") eff *= 0.5;

  eff -= (1 - distFromTop) * 0.18;
  eff -= (1 - distFromBoundary) * 0.22;

  const seed = zoneIdx * 7.31;
  const dY = depthFrac * 30 + seed;
  const channelNoise =
    0.40 * smoothNoise(circumFrac * 8 + seed, dY * 0.3) +
    0.30 * smoothNoise(circumFrac * 18 + seed * 0.5, dY * 0.7) +
    0.20 * smoothNoise(circumFrac * 35, dY * 1.2) +
    0.10 * smoothNoise(circumFrac * 60, dY * 2.0);
  const channelInt = 0.3 + 0.25 * smoothNoise(circumFrac * 3, dY * 0.15);
  const turbReduction = turbMult > 1 ? 0.6 : 1.0;
  eff += (channelNoise - 0.5) * channelInt * turbReduction;

  if (isOpenHole) {
    const wo = smoothNoise(depthFrac * 15 + 5.7, circumFrac * 4 + seed);
    if (wo > 0.75) eff -= (wo - 0.75) * 1.2;
  }

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

  const getCentDataAtMD = useMemo(() => {
    if (!centralizationResults || centralizationResults.length === 0) {
      return (_md: number) => ({ ecc: 0, turbMult: 1, standoff: 100 });
    }
    const sorted = [...centralizationResults].sort((a, b) => a.md - b.md);
    return (md: number) => {
      if (md <= sorted[0].md) {
        return { ecc: sorted[0].eccentricity, turbMult: sorted[0].turbulenceMultiplier, standoff: sorted[0].standoff };
      }
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

    const W = 520;
    const H = 720;
    const mL = 58;
    const mR = 120;
    const mT = 36;
    const mB = 60;
    const plotH = H - mT - mB;
    const plotW = W - mL - mR;
    const mdRange = mdMax - mdMin || 1;

    const casingW = plotW * 0.10;
    const annW = (plotW - casingW) / 2;
    const casingBaseLeft = mL + annW;
    const casingBaseRight = casingBaseLeft + casingW;

    canvas.width = W * 2;
    canvas.height = H * 2;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.scale(2, 2);

    const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, "hsl(220, 24%, 9%)");
    bgGrad.addColorStop(1, "hsl(228, 24%, 15%)");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

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

    function getZoneAt(md: number): FluidZone | null {
      for (const z of zones) {
        if (md >= z.topMD && md <= z.botMD) return z;
      }
      return null;
    }

    const N_Y = Math.round(plotH * 2);
    const N_X = Math.round(plotW * 2);
    const imgData = ctx.createImageData(N_X, N_Y);
    const pixels = imgData.data;
    const annFracW = annW / plotW;
    const casFracW = casingW / plotW;
    const avgVel = (avgRate * 0.001) / (annArea > 0 ? annArea : 0.01);

    for (let py = 0; py < N_Y; py++) {
      const yFrac = py / N_Y;
      const md = mdMin + yFrac * mdRange;
      const zenithDeg = zenithAt(md);
      const isOpenHole = md > wellData.prevCasingDepth;
      const zone = getZoneAt(md);
      const centData = getCentDataAtMD(md);
      const ecc = centData.ecc;
      const turbMult = centData.turbMult;

      const maxOffset = annFracW * 0.85;
      const offsetFrac = ecc * maxOffset;
      const casCenterFrac = annFracW + casFracW / 2 + offsetFrac;
      const casLeftFrac = casCenterFrac - casFracW / 2;
      const casRightFrac = casCenterFrac + casFracW / 2;

      for (let px = 0; px < N_X; px++) {
        const xFrac = px / N_X;
        let r = 15;
        let g = 18;
        let b = 25;
        let a = 255;

        if (xFrac >= casLeftFrac && xFrac <= casRightFrac) {
          a = 0;
        } else {
          const isLeft = xFrac < casLeftFrac;
          let localFrac: number;
          let angle: number;

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
            const mudNoise = smoothNoise(localFrac * 5, yFrac * 20) * 0.15;
            const v = Math.round(230 + mudNoise * 20);
            r = v; g = v; b = v;
          } else {
            const zLen = zone.botMD - zone.topMD || 1;
            const distTop = (md - zone.topMD) / zLen;
            const distBot = (zone.botMD - md) / zLen;
            const distBoundary = Math.min(distTop, distBot) * 2;
            const eccPenalty = !isLeft ? ecc * 0.3 : 0;

            const eff = Math.max(0, calcEff(
              zenithDeg,
              zone.density,
              zone.yp,
              drillingFluid.density,
              drillingFluid.rheology.yp,
              isOpenHole,
              wellData.cavernCoeff,
              distTop,
              distBoundary,
              angle,
              isLeft ? localFrac : localFrac + 1,
              yFrac,
              zone.idx,
              ecc,
              turbMult,
              avgVel,
              zone.type,
            ) - eccPenalty);

            const isCement = zone.type === "cement";
            // Grayscale: dark = good cement, bright = mud channel
            const darkVal = 22;
            const lightVal = isCement ? 235 : 210;
            const quality = isCement ? Math.pow(eff, 0.7) : Math.pow(eff, 0.9);
            const val = Math.round(lightVal - quality * (lightVal - darkVal));

            // Subtle blue tint for cement
            r = val;
            g = val;
            b = Math.min(255, val + (isCement ? 4 : 2));
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

    ctx.lineWidth = 2.5;
    const wallGrad = ctx.createLinearGradient(0, mT, 0, mT + plotH);
    wallGrad.addColorStop(0, "hsl(30, 16%, 34%)");
    wallGrad.addColorStop(0.5, "hsl(32, 18%, 46%)");
    wallGrad.addColorStop(1, "hsl(30, 16%, 28%)");
    ctx.strokeStyle = wallGrad;
    ctx.beginPath();
    ctx.moveTo(mL, mT);
    ctx.lineTo(mL, mT + plotH);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(mL + plotW, mT);
    ctx.lineTo(mL + plotW, mT + plotH);
    ctx.stroke();

    const casingPts: { y: number; lx: number; rx: number }[] = [];
    const nPts = 220;
    for (let i = 0; i <= nPts; i++) {
      const md = mdMin + (mdRange * i / nPts);
      const y = mT + (i / nPts) * plotH;
      const ecc = getCentDataAtMD(md).ecc;
      const offset = ecc * annW * 0.85;
      casingPts.push({ y, lx: casingBaseLeft + offset, rx: casingBaseRight + offset });
    }

    ctx.beginPath();
    ctx.moveTo(casingPts[0].lx, casingPts[0].y);
    for (let i = 1; i < casingPts.length; i++) ctx.lineTo(casingPts[i].lx, casingPts[i].y);
    for (let i = casingPts.length - 1; i >= 0; i--) ctx.lineTo(casingPts[i].rx, casingPts[i].y);
    ctx.closePath();
    const casingFill = ctx.createLinearGradient(casingBaseLeft, 0, casingBaseRight, 0);
    casingFill.addColorStop(0, "hsla(214, 18%, 74%, 0.98)");
    casingFill.addColorStop(0.18, "hsla(214, 16%, 56%, 0.98)");
    casingFill.addColorStop(0.48, "hsla(214, 16%, 28%, 0.99)");
    casingFill.addColorStop(0.52, "hsla(214, 16%, 24%, 0.99)");
    casingFill.addColorStop(0.82, "hsla(214, 16%, 56%, 0.98)");
    casingFill.addColorStop(1, "hsla(214, 18%, 74%, 0.98)");
    ctx.fillStyle = casingFill;
    ctx.fill();

    const drawCasingWall = (getX: (p: typeof casingPts[0]) => number) => {
      const grad = ctx.createLinearGradient(0, mT, 0, mT + plotH);
      grad.addColorStop(0, "hsl(214, 18%, 70%)");
      grad.addColorStop(0.5, "hsl(214, 14%, 82%)");
      grad.addColorStop(1, "hsl(214, 18%, 64%)");
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(getX(casingPts[0]), casingPts[0].y);
      for (let i = 0; i < casingPts.length - 1; i++) {
        const p0 = casingPts[i];
        const p1 = casingPts[i + 1];
        const cpX = (getX(p0) + getX(p1)) / 2;
        const cpY = (p0.y + p1.y) / 2;
        ctx.quadraticCurveTo(getX(p0), p0.y, cpX, cpY);
      }
      const last = casingPts[casingPts.length - 1];
      ctx.lineTo(getX(last), last.y);
      ctx.stroke();
    };

    drawCasingWall(p => p.lx);
    drawCasingWall(p => p.rx);

    const boundaries = new Map<number, string>();
    for (const z of zones) {
      if (z.topMD > mdMin + 1 && !boundaries.has(z.topMD)) boundaries.set(z.topMD, z.color);
      if (z.botMD < mdMax - 1 && !boundaries.has(z.botMD)) boundaries.set(z.botMD, z.color);
    }

    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.2;
    for (const [boundaryMD, color] of boundaries.entries()) {
      const y = mT + ((boundaryMD - mdMin) / mdRange) * plotH;
      const offset = getCentDataAtMD(boundaryMD).ecc * annW * 0.85;
      const leftX = casingBaseLeft + offset;
      const rightX = casingBaseRight + offset;
      const [zh] = parseHSL(color);
      ctx.strokeStyle = `hsla(${zh}, 70%, 65%, 0.85)`;

      ctx.beginPath();
      ctx.moveTo(mL + 2, y);
      ctx.lineTo(leftX - 2, y);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(rightX + 2, y);
      ctx.lineTo(mL + plotW - 2, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    if (centralizationResults && centralizationResults.length > 0) {
      const badZones: { from: number; to: number }[] = [];
      let curBad: { from: number; to: number } | null = null;
      const sorted = [...centralizationResults].sort((a, b) => a.md - b.md);
      for (const pt of sorted) {
        if (pt.md < mdMin || pt.md > mdMax) continue;
        const zone = zones.find(z => pt.md >= z.topMD && pt.md <= z.botMD);
        if (!zone) continue;
        const isBad = pt.standoff < 50 || pt.eccentricity > 0.6;
        if (isBad) {
          if (!curBad) curBad = { from: pt.md, to: pt.md };
          else curBad.to = pt.md;
        } else if (curBad) {
          badZones.push(curBad);
          curBad = null;
        }
      }
      if (curBad) badZones.push(curBad);

      for (const bz of badZones) {
        const y1 = mT + ((bz.from - mdMin) / mdRange) * plotH;
        const y2 = mT + ((bz.to - mdMin) / mdRange) * plotH;
        const h = Math.max(y2 - y1, 4);
        ctx.fillStyle = "hsla(2, 72%, 54%, 0.15)";
        ctx.fillRect(mL + plotW + 2, y1, 18, h);
        ctx.strokeStyle = "hsla(2, 72%, 54%, 0.55)";
        ctx.lineWidth = 1;
        ctx.strokeRect(mL + plotW + 2, y1, 18, h);
        ctx.fillStyle = "hsla(8, 78%, 58%, 0.92)";
        ctx.font = "bold 9px sans-serif";
        ctx.textAlign = "left";
        ctx.fillText("⚠", mL + plotW + 5, (y1 + y2) / 2 + 3);
      }
    }

    ctx.fillStyle = "hsl(214, 18%, 64%)";
    ctx.font = "10px monospace";
    ctx.textAlign = "right";
    const dInt = mdRange > 500 ? 100 : mdRange > 200 ? 50 : 20;
    for (let md = Math.ceil(mdMin / dInt) * dInt; md <= mdMax; md += dInt) {
      const y = mT + ((md - mdMin) / mdRange) * plotH;
      ctx.fillStyle = "hsl(224, 20%, 28%)";
      ctx.fillRect(mL - 5, y, 5, 1);
      ctx.fillStyle = "hsl(214, 18%, 64%)";
      ctx.fillText(`${md}`, mL - 8, y + 3);
    }

    ctx.save();
    ctx.translate(13, mT + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = "hsl(214, 18%, 64%)";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Глубина по стволу, м", 0, 0);
    ctx.restore();

    for (const z of zones) {
      const yMid = mT + (((z.topMD + z.botMD) / 2 - mdMin) / mdRange) * plotH;
      const [zh, zs] = parseHSL(z.color);
      ctx.fillStyle = `hsl(${zh}, ${zs}%, 68%)`;
      ctx.font = "bold 10px sans-serif";
      ctx.textAlign = "left";
      const labelX = mL + plotW + 24;
      ctx.fillText(z.name, labelX, yMid - 2);
      ctx.fillStyle = "hsl(214, 18%, 64%)";
      ctx.font = "9px monospace";
      ctx.fillText(`${z.topMD.toFixed(0)}–${z.botMD.toFixed(0)} м`, labelX, yMid + 10);
      ctx.fillText(`ρ ${(z.density / 1000).toFixed(2)} г/см³`, labelX, yMid + 20);
    }

    ctx.fillStyle = "hsl(214, 24%, 88%)";
    ctx.font = "bold 13px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Эффективность замещения — продольный разрез", W / 2 - 30, 18);

    ctx.fillStyle = "hsl(214, 12%, 52%)";
    ctx.font = "9px sans-serif";
    ctx.textAlign = "center";
    const cx = mL + annW + casingW / 2;
    ctx.fillText("Порода", mL - 8, mT + plotH + 14);
    ctx.fillText("Затрубье", mL + annW / 2, mT + plotH + 14);
    ctx.fillText("Колонна", cx, mT + plotH + 14);
    ctx.fillText("Затрубье", mL + annW + casingW + annW / 2, mT + plotH + 14);
    ctx.fillText("Порода", mL + plotW + 10, mT + plotH + 14);

    const legX = mL;
    const legY = mT + plotH + 28;
    const legW = plotW;
    const legH = 10;
    for (let i = 0; i < legW; i++) {
      const eff = i / legW;
      const g = Math.round(220 - eff * 180);
      const rb = Math.round(200 - eff * 170);
      ctx.fillStyle = `rgb(${rb},${rb + 3},${g})`;
      ctx.fillRect(legX + i, legY, 1.5, legH);
    }
    ctx.strokeStyle = "hsl(224, 18%, 30%)";
    ctx.lineWidth = 0.5;
    ctx.strokeRect(legX, legY, legW, legH);
    ctx.fillStyle = "hsl(214, 18%, 64%)";
    ctx.font = "9px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("Засвет (каналы БР)", legX, legY + legH + 12);
    ctx.textAlign = "right";
    ctx.fillText("Полное замещение", legX + legW, legY + legH + 12);
  }, [zones, mdMin, mdMax, drillingFluid, avgRate, annArea, wellData, getCentDataAtMD, traj, centralizationResults]);

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
