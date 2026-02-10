import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WellData, SlurryInput, BufferFluid, DrillingFluid, DisplacementFluid } from "@/lib/cementing-calculations";
import { getSlurryHeight, interpolateTVD, getCasingID, pipeVolumePerMeter, annularVolumePerMeter } from "@/lib/cementing-calculations";

interface Props {
  wellData: WellData;
  slurries: SlurryInput[];
  buffers: BufferFluid[];
  drillingFluid: DrillingFluid;
  displacementFluids?: DisplacementFluid[];
}

// Fluid color palette
const CEMENT_COLORS = ["#B5651D", "#8B4513", "#CD853F", "#A0522D"];
const CEMENT_GRADIENT_PAIRS = [
  ["#C4793A", "#8B4513"],
  ["#9E5C2F", "#5E3210"],
  ["#D4955A", "#A0522D"],
  ["#B86B3A", "#7A3B11"],
];
const MUD_COLOR = "#2E7D4F";
const MUD_LIGHT = "#3D9963";
const DISPLACEMENT_COLOR = "#4A90D9";
const DISPLACEMENT_LIGHT = "#6CB0F0";
const BUFFER_COLORS = [
  ["#E8A838", "#D4881A"],
  ["#9C6BB1", "#7B4F96"],
];
const ROCK_COLOR = "#5C4A3A";
const ROCK_LIGHT = "#7A6550";
const CASING_COLOR = "#8A8A8A";
const CASING_HIGHLIGHT = "#B0B0B0";

interface Point2D { x: number; y: number; md: number; }

export default function WellVisualization({ wellData, slurries, buffers, drillingFluid, displacementFluids }: Props) {
  const profile = useMemo(() => {
    // Build trajectory path (vertical section)
    const traj = wellData.trajectory;
    if (!traj || traj.length < 2) {
      return [
        { x: 0, y: 0, md: 0 },
        { x: 0, y: wellData.casingDepthMD, md: wellData.casingDepthMD },
      ];
    }
    const sorted = [...traj].sort((a, b) => a.md - b.md);
    const pts: Point2D[] = [];
    let cumHoriz = 0;
    pts.push({ x: 0, y: sorted[0].tvd, md: sorted[0].md });
    for (let i = 1; i < sorted.length; i++) {
      const dMD = sorted[i].md - sorted[i - 1].md;
      const dTVD = sorted[i].tvd - sorted[i - 1].tvd;
      const dHoriz = Math.sqrt(Math.max(0, dMD * dMD - dTVD * dTVD));
      const zenithRad = (sorted[i].zenith || 0) * Math.PI / 180;
      const azimuthRad = (sorted[i].azimuth || 0) * Math.PI / 180;
      cumHoriz += dHoriz * Math.sin(azimuthRad || 1); // project onto viewing plane
      pts.push({ x: cumHoriz, y: sorted[i].tvd, md: sorted[i].md });
    }
    return pts;
  }, [wellData.trajectory, wellData.casingDepthMD]);

  // SVG viewport calculation
  const padding = 60;
  const svgWidth = 800;
  const svgHeight = 700;

  const minX = Math.min(...profile.map(p => p.x));
  const maxX = Math.max(...profile.map(p => p.x));
  const minY = Math.min(...profile.map(p => p.y));
  const maxY = Math.max(...profile.map(p => p.y));

  const rangeX = Math.max(maxX - minX, 1);
  const rangeY = Math.max(maxY - minY, 1);
  const drawW = svgWidth - padding * 2;
  const drawH = svgHeight - padding * 2;
  const scaleVal = Math.min(drawW / rangeX, drawH / rangeY) * 0.85;

  // Convert well coords to SVG coords
  const toSVG = (x: number, y: number): [number, number] => {
    const cx = svgWidth / 2;
    const sx = cx + (x - (minX + maxX) / 2) * scaleVal;
    const sy = padding + (y - minY) * scaleVal;
    return [sx, sy];
  };

  // Interpolate position along profile at given MD
  const posAtMD = (md: number): [number, number] => {
    if (profile.length < 2) return toSVG(0, md);
    for (let i = 0; i < profile.length - 1; i++) {
      if (md >= profile[i].md && md <= profile[i + 1].md) {
        const frac = (md - profile[i].md) / (profile[i + 1].md - profile[i].md);
        const px = profile[i].x + frac * (profile[i + 1].x - profile[i].x);
        const py = profile[i].y + frac * (profile[i + 1].y - profile[i].y);
        return toSVG(px, py);
      }
    }
    const last = profile[profile.length - 1];
    return toSVG(last.x, last.y);
  };

  // Normal vector (perpendicular to well path) at given MD
  const normalAtMD = (md: number, width: number): { left: [number, number]; right: [number, number] } => {
    const [cx, cy] = posAtMD(md);
    // Find tangent direction
    const eps = 0.5;
    const [x1, y1] = posAtMD(Math.max(0, md - eps));
    const [x2, y2] = posAtMD(Math.min(wellData.casingDepthMD, md + eps));
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    return {
      left: [cx - nx * width, cy - ny * width],
      right: [cx + nx * width, cy + ny * width],
    };
  };

  // Build well outline polygons
  const holeRadius = (wellData.holeDiameter / 2) * scaleVal / rangeY * 3;
  const casingOuterR = (wellData.casingOD / 2) * scaleVal / rangeY * 3;
  const casingID = getCasingID(wellData.casingOD, wellData.casingWall);
  const casingInnerR = (casingID / 2) * scaleVal / rangeY * 3;
  const prevCasingOuterR = (wellData.prevCasingOD / 2) * scaleVal / rangeY * 3;
  const prevCasingInnerR = (wellData.prevCasingID / 2) * scaleVal / rangeY * 3;

  // Generate polygon points along the well path
  const numSteps = 60;
  const generateOutline = (radiusLeft: number, radiusRight: number, mdStart: number, mdEnd: number) => {
    const leftPoints: string[] = [];
    const rightPoints: string[] = [];
    const steps = Math.max(Math.ceil((mdEnd - mdStart) / wellData.casingDepthMD * numSteps), 4);
    for (let i = 0; i <= steps; i++) {
      const md = mdStart + (mdEnd - mdStart) * i / steps;
      const n = normalAtMD(md, 1);
      const [cx, cy] = posAtMD(md);
      const dx = n.right[0] - cx;
      const dy = n.right[1] - cy;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      leftPoints.push(`${cx - dx / len * radiusLeft},${cy - dy / len * radiusLeft}`);
      rightPoints.push(`${cx + dx / len * radiusRight},${cy + dy / len * radiusRight}`);
    }
    return [...leftPoints, ...rightPoints.reverse()].join(" ");
  };

  // Generate annular ring (between two radii) — for cement, buffers, mud in annulus
  const generateAnnularRing = (innerR: number, outerR: number, mdStart: number, mdEnd: number, side: "left" | "right" | "both" = "both") => {
    const steps = Math.max(Math.ceil((mdEnd - mdStart) / wellData.casingDepthMD * numSteps), 4);
    const outerLeft: string[] = [];
    const outerRight: string[] = [];
    const innerLeft: string[] = [];
    const innerRight: string[] = [];

    for (let i = 0; i <= steps; i++) {
      const md = mdStart + (mdEnd - mdStart) * i / steps;
      const [cx, cy] = posAtMD(md);
      const n = normalAtMD(md, 1);
      const dx = n.right[0] - cx;
      const dy = n.right[1] - cy;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const ndx = dx / len;
      const ndy = dy / len;

      outerLeft.push(`${cx - ndx * outerR},${cy - ndy * outerR}`);
      outerRight.push(`${cx + ndx * outerR},${cy + ndy * outerR}`);
      innerLeft.push(`${cx - ndx * innerR},${cy - ndy * innerR}`);
      innerRight.push(`${cx + ndx * innerR},${cy + ndy * innerR}`);
    }

    if (side === "both") {
      // Left side annulus + Right side annulus
      const leftPoly = [...outerLeft, ...innerLeft.reverse()].join(" ");
      const rightPoly = [...outerRight, ...innerRight.reverse()].join(" ");
      return [leftPoly, rightPoly];
    }
    return [];
  };

  // Fluid sections calculations — at STOP moment
  // Annulus: cement fills from bottom, then buffers, then mud on top
  // Pipe: displacement fluid fills from top to CKOD depth, cement below
  const annVPM = annularVolumePerMeter(wellData.holeDiameter, wellData.casingOD, wellData.cavernCoeff);
  const pipeVPM = pipeVolumePerMeter(casingID);

  // Cement sections in annulus (from bottom up)
  const cementSections = useMemo(() => {
    const sections: { mdTop: number; mdBottom: number; color: string; gradientColors: string[]; name: string }[] = [];
    // Slurries are ordered: first in list = top (pumped first), last = bottom (pumped last)
    // After STOP: last slurry is at bottom, first is higher
    for (let i = slurries.length - 1; i >= 0; i--) {
      const h = getSlurryHeight(slurries, i, wellData.casingDepthMD);
      if (h > 0) {
        const mdBottom = i === slurries.length - 1 ? wellData.casingDepthMD : slurries[i + 1].topDepthMD;
        sections.push({
          mdTop: slurries[i].topDepthMD,
          mdBottom,
          color: CEMENT_COLORS[i % CEMENT_COLORS.length],
          gradientColors: CEMENT_GRADIENT_PAIRS[i % CEMENT_GRADIENT_PAIRS.length],
          name: slurries[i].name,
        });
      }
    }
    return sections;
  }, [slurries, wellData.casingDepthMD]);

  // Buffer sections above cement
  const bufferSections = useMemo(() => {
    const sections: { mdTop: number; mdBottom: number; colors: string[]; name: string }[] = [];
    let currentMD = slurries.length > 0 ? Math.min(...slurries.map(s => s.topDepthMD)) : wellData.casingDepthMD;
    // Buffers above cement, in reverse order (last buffer is closest to cement)
    for (let i = buffers.length - 1; i >= 0; i--) {
      const bufHeight = buffers[i].volume / annVPM;
      const mdBottom = currentMD;
      const mdTop = Math.max(0, currentMD - bufHeight);
      sections.push({
        mdTop, mdBottom,
        colors: BUFFER_COLORS[i % BUFFER_COLORS.length],
        name: buffers[i].name,
      });
      currentMD = mdTop;
    }
    return sections;
  }, [buffers, slurries, annVPM, wellData.casingDepthMD]);

  // Top of all fluids in annulus (above which is drilling mud)
  const topFluidMD = bufferSections.length > 0
    ? Math.min(...bufferSections.map(b => b.mdTop))
    : (slurries.length > 0 ? Math.min(...slurries.map(s => s.topDepthMD)) : wellData.casingDepthMD);

  // Pipe: displacement fluid from 0 to ckodDepth
  const ckodDepth = wellData.ckodDepth;

  // Depth markers
  const depthMarkers = useMemo(() => {
    const markers: { md: number; label: string }[] = [
      { md: 0, label: "0 м (устье)" },
      { md: wellData.casingDepthMD, label: `${wellData.casingDepthMD} м (забой)` },
    ];
    if (wellData.prevCasingDepth > 0 && wellData.prevCasingDepth < wellData.casingDepthMD) {
      markers.push({ md: wellData.prevCasingDepth, label: `${wellData.prevCasingDepth} м (кондуктор)` });
    }
    if (ckodDepth > 0 && ckodDepth < wellData.casingDepthMD) {
      markers.push({ md: ckodDepth, label: `${ckodDepth} м (ЦКОД)` });
    }
    return markers;
  }, [wellData]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Профиль скважины — состояние после СТОП</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex justify-center">
            <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full max-w-3xl" style={{ height: "650px" }}>
              <defs>
                {/* Rock gradient */}
                <linearGradient id="rockGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor={ROCK_LIGHT} />
                  <stop offset="100%" stopColor={ROCK_COLOR} />
                </linearGradient>
                {/* Mud gradient */}
                <linearGradient id="mudGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={MUD_LIGHT} />
                  <stop offset="100%" stopColor={MUD_COLOR} />
                </linearGradient>
                {/* Displacement gradient */}
                <linearGradient id="dispGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={DISPLACEMENT_LIGHT} />
                  <stop offset="100%" stopColor={DISPLACEMENT_COLOR} />
                </linearGradient>
                {/* Casing gradient */}
                <linearGradient id="casingGrad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor={CASING_COLOR} />
                  <stop offset="40%" stopColor={CASING_HIGHLIGHT} />
                  <stop offset="100%" stopColor={CASING_COLOR} />
                </linearGradient>
                {/* Cement gradients */}
                {CEMENT_GRADIENT_PAIRS.map((pair, i) => (
                  <linearGradient key={`cg${i}`} id={`cementGrad${i}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={pair[0]} />
                    <stop offset="100%" stopColor={pair[1]} />
                  </linearGradient>
                ))}
                {/* Buffer gradients */}
                {BUFFER_COLORS.map((pair, i) => (
                  <linearGradient key={`bg${i}`} id={`bufferGrad${i}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={pair[0]} />
                    <stop offset="100%" stopColor={pair[1]} />
                  </linearGradient>
                ))}
                {/* Rock texture pattern */}
                <pattern id="rockPattern" patternUnits="userSpaceOnUse" width="8" height="8">
                  <rect width="8" height="8" fill={ROCK_COLOR} />
                  <circle cx="2" cy="2" r="0.8" fill={ROCK_LIGHT} opacity="0.3" />
                  <circle cx="6" cy="6" r="0.6" fill={ROCK_LIGHT} opacity="0.2" />
                  <circle cx="5" cy="1" r="0.4" fill={ROCK_LIGHT} opacity="0.15" />
                </pattern>
                {/* Glow filter */}
                <filter id="glow">
                  <feGaussianBlur stdDeviation="2" result="coloredBlur" />
                  <feMerge>
                    <feMergeNode in="coloredBlur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
                <filter id="shadow">
                  <feDropShadow dx="1" dy="1" stdDeviation="2" floodOpacity="0.3" />
                </filter>
              </defs>

              {/* Background */}
              <rect x="0" y="0" width={svgWidth} height={svgHeight} fill="hsl(var(--card))" rx="8" />

              {/* Formation / Rock — open hole section */}
              <polygon
                points={generateOutline(holeRadius * 1.3, holeRadius * 1.3, wellData.prevCasingDepth, wellData.casingDepthMD)}
                fill="url(#rockPattern)" stroke={ROCK_COLOR} strokeWidth="1"
              />

              {/* Previous casing */}
              {wellData.prevCasingDepth > 0 && (
                <>
                  {generateAnnularRing(prevCasingInnerR, prevCasingOuterR, 0, wellData.prevCasingDepth).map((poly, i) => (
                    <polygon key={`prevcas-${i}`} points={poly} fill="url(#casingGrad)" stroke="#777" strokeWidth="0.5" opacity="0.7" />
                  ))}
                </>
              )}

              {/* Drilling mud in annulus (above fluids) */}
              {topFluidMD > 0 && (
                <>
                  {generateAnnularRing(casingOuterR, holeRadius * 1.1, 0, Math.min(topFluidMD, wellData.prevCasingDepth)).map((poly, i) => (
                    <polygon key={`mudann-prev-${i}`} points={poly} fill="url(#mudGrad)" opacity="0.6" />
                  ))}
                  {topFluidMD > wellData.prevCasingDepth && generateAnnularRing(casingOuterR, holeRadius * 1.2, wellData.prevCasingDepth, topFluidMD).map((poly, i) => (
                    <polygon key={`mudann-open-${i}`} points={poly} fill="url(#mudGrad)" opacity="0.6" />
                  ))}
                </>
              )}

              {/* Buffer sections in annulus */}
              {bufferSections.map((buf, bi) => {
                const outerR = buf.mdBottom <= wellData.prevCasingDepth ? prevCasingInnerR * 0.98 : holeRadius * 1.15;
                return generateAnnularRing(casingOuterR * 1.02, outerR, buf.mdTop, buf.mdBottom).map((poly, i) => (
                  <polygon key={`buf-${bi}-${i}`} points={poly} fill={`url(#bufferGrad${bi % BUFFER_COLORS.length})`} opacity="0.8" />
                ));
              })}

              {/* Cement sections in annulus */}
              {cementSections.map((sec, ci) => {
                const outerR = sec.mdTop >= wellData.prevCasingDepth ? holeRadius * 1.15 : prevCasingInnerR * 0.98;
                const gradIdx = ci % CEMENT_GRADIENT_PAIRS.length;
                return generateAnnularRing(casingOuterR * 1.02, outerR, sec.mdTop, sec.mdBottom).map((poly, i) => (
                  <polygon key={`cem-${ci}-${i}`} points={poly} fill={`url(#cementGrad${gradIdx})`} opacity="0.85" stroke={sec.gradientColors[1]} strokeWidth="0.5" />
                ));
              })}

              {/* Current casing walls */}
              {generateAnnularRing(casingInnerR, casingOuterR, 0, wellData.casingDepthMD).map((poly, i) => (
                <polygon key={`cas-${i}`} points={poly} fill="url(#casingGrad)" stroke="#666" strokeWidth="0.8" />
              ))}

              {/* Displacement fluid inside pipe (from top to CKOD) */}
              <polygon
                points={generateOutline(casingInnerR * 0.9, casingInnerR * 0.9, 0, ckodDepth)}
                fill="url(#dispGrad)" opacity="0.5"
              />

              {/* Shoe (башмак) */}
              {(() => {
                const [sx, sy] = posAtMD(wellData.casingDepthMD);
                return (
                  <g filter="url(#glow)">
                    <polygon
                      points={`${sx - casingOuterR * 1.3},${sy} ${sx},${sy + 8} ${sx + casingOuterR * 1.3},${sy}`}
                      fill="#FF6B35" stroke="#CC4411" strokeWidth="1"
                    />
                  </g>
                );
              })()}

              {/* CKOD marker */}
              {(() => {
                const [sx, sy] = posAtMD(ckodDepth);
                return (
                  <g>
                    <line x1={sx - casingInnerR * 1.5} y1={sy} x2={sx + casingInnerR * 1.5} y2={sy} stroke="#E53E3E" strokeWidth="2.5" strokeDasharray="4 2" />
                    <circle cx={sx} cy={sy} r="4" fill="#E53E3E" />
                  </g>
                );
              })()}

              {/* Depth markers & labels */}
              {depthMarkers.map((marker, i) => {
                const [mx, my] = posAtMD(marker.md);
                const labelX = mx + holeRadius * 1.8;
                return (
                  <g key={`dm-${i}`}>
                    <line x1={mx + holeRadius * 1.4} y1={my} x2={labelX - 4} y2={my} stroke="hsl(var(--muted-foreground))" strokeWidth="0.8" strokeDasharray="2 2" />
                    <text x={labelX} y={my + 4} fontSize="11" fill="hsl(var(--muted-foreground))" fontFamily="sans-serif">{marker.label}</text>
                  </g>
                );
              })}

              {/* Fluid labels on the left side */}
              {cementSections.map((sec, i) => {
                const midMD = (sec.mdTop + sec.mdBottom) / 2;
                const [mx, my] = posAtMD(midMD);
                const labelX = mx - holeRadius * 1.8;
                return (
                  <g key={`cl-${i}`}>
                    <line x1={mx - holeRadius * 1.4} y1={my} x2={labelX + 4} y2={my} stroke={sec.color} strokeWidth="0.8" />
                    <text x={labelX} y={my + 4} fontSize="10" fill={sec.color} fontFamily="sans-serif" textAnchor="end" fontWeight="600">
                      {sec.name}
                    </text>
                  </g>
                );
              })}

              {bufferSections.map((buf, i) => {
                const midMD = (buf.mdTop + buf.mdBottom) / 2;
                const [mx, my] = posAtMD(midMD);
                const labelX = mx - holeRadius * 1.8;
                return (
                  <g key={`bl-${i}`}>
                    <line x1={mx - holeRadius * 1.4} y1={my} x2={labelX + 4} y2={my} stroke={buf.colors[0]} strokeWidth="0.8" />
                    <text x={labelX} y={my + 4} fontSize="10" fill={buf.colors[0]} fontFamily="sans-serif" textAnchor="end" fontWeight="500">
                      {buf.name}
                    </text>
                  </g>
                );
              })}

              {/* Pipe fluid label */}
              {(() => {
                const midMD = ckodDepth / 2;
                const [mx, my] = posAtMD(midMD);
                return (
                  <text x={mx} y={my} fontSize="9" fill={DISPLACEMENT_COLOR} fontFamily="sans-serif" textAnchor="middle" fontWeight="500" opacity="0.8">
                    Продавка
                  </text>
                );
              })()}

              {/* Title annotations */}
              <text x={svgWidth / 2} y={25} fontSize="13" fill="hsl(var(--foreground))" fontFamily="sans-serif" textAnchor="middle" fontWeight="600" opacity="0.7">
                Разрез скважины (по вертикали)
              </text>
            </svg>
          </div>
        </CardContent>
      </Card>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground px-2">
        <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-sm border" style={{ background: `linear-gradient(135deg, ${CASING_HIGHLIGHT}, ${CASING_COLOR})` }} /> Обсадная колонна</span>
        {cementSections.map((sec, i) => (
          <span key={i} className="flex items-center gap-1.5">
            <span className="w-3.5 h-3.5 rounded-sm" style={{ background: `linear-gradient(135deg, ${sec.gradientColors[0]}, ${sec.gradientColors[1]})` }} />
            {sec.name}
          </span>
        ))}
        {bufferSections.map((buf, i) => (
          <span key={`bl-${i}`} className="flex items-center gap-1.5">
            <span className="w-3.5 h-3.5 rounded-sm" style={{ background: `linear-gradient(135deg, ${buf.colors[0]}, ${buf.colors[1]})` }} />
            {buf.name}
          </span>
        ))}
        <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-sm" style={{ background: `linear-gradient(135deg, ${MUD_LIGHT}, ${MUD_COLOR})` }} /> {drillingFluid.name}</span>
        <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-sm" style={{ background: `linear-gradient(135deg, ${DISPLACEMENT_LIGHT}, ${DISPLACEMENT_COLOR})` }} /> Продавочная жидкость</span>
        <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-sm" style={{ background: `linear-gradient(135deg, ${ROCK_LIGHT}, ${ROCK_COLOR})` }} /> Горная порода</span>
        <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-sm" style={{ background: "#FF6B35" }} /> Башмак</span>
        <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-full" style={{ background: "#E53E3E" }} /> ЦКОД</span>
      </div>
    </div>
  );
}
