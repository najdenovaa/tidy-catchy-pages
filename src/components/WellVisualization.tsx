import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Text, Line, Grid } from "@react-three/drei";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import CopyImageButton from "./CopyImageButton";
import DisplacementEfficiency from "./DisplacementEfficiency";
import type { WellData, SlurryInput, BufferFluid, DrillingFluid, DisplacementFluid } from "@/lib/cementing-calculations";
import { getSlurryHeight, interpolateTVD, getCasingID, pipeVolumePerMeter, annularVolumePerMeter } from "@/lib/cementing-calculations";
import * as THREE from "three";

interface Props {
  wellData: WellData;
  slurries: SlurryInput[];
  buffers: BufferFluid[];
  drillingFluid: DrillingFluid;
  displacementFluids?: DisplacementFluid[];
}

// ====== Color palette ======
const CEMENT_COLORS = ["#C4793A", "#9E5C2F", "#D4955A", "#B86B3A"];
const BUFFER_COLORS_3D = ["#E8A838", "#9C6BB1"];
const MUD_COLOR_3D = "#2E7D4F";
const DISP_COLOR = "#4A90D9";
const ROCK_COLOR_3D = "#6B5B4F";
const CASING_STEEL = "#A8A8A8";
const PREV_CASING_STEEL = "#888888";

// ====== Convert trajectory to 3D coordinates (coarse survey stations) ======
function trajectoryTo3DRaw(traj: WellData["trajectory"], casingDepthMD: number): { x: number; y: number; z: number; md: number; tvd: number }[] {
  if (!traj || traj.length < 2) {
    return [
      { x: 0, y: 0, z: 0, md: 0, tvd: 0 },
      { x: 0, y: -casingDepthMD, z: 0, md: casingDepthMD, tvd: casingDepthMD },
    ];
  }
  const sorted = [...traj].sort((a, b) => a.md - b.md);
  const pts: { x: number; y: number; z: number; md: number; tvd: number }[] = [];
  let cx = 0, cy = 0, cz = 0;
  pts.push({ x: 0, y: 0, z: 0, md: sorted[0].md, tvd: sorted[0].tvd });

  for (let i = 1; i < sorted.length; i++) {
    const dMD = sorted[i].md - sorted[i - 1].md;
    const zenRad = ((sorted[i].zenith + sorted[i - 1].zenith) / 2) * Math.PI / 180;
    const azRad = ((sorted[i].azimuth + sorted[i - 1].azimuth) / 2) * Math.PI / 180;
    cx += dMD * Math.sin(zenRad) * Math.sin(azRad);
    cy -= dMD * Math.cos(zenRad);
    cz += dMD * Math.sin(zenRad) * Math.cos(azRad);
    pts.push({ x: cx, y: cy, z: cz, md: sorted[i].md, tvd: sorted[i].tvd });
  }
  return pts;
}

// ====== Build smooth spline from raw survey points ======
function buildSpline(rawPts: ReturnType<typeof trajectoryTo3DRaw>): THREE.CatmullRomCurve3 {
  const vectors = rawPts.map(p => new THREE.Vector3(p.x, p.y, p.z));
  return new THREE.CatmullRomCurve3(vectors, false, "catmullrom", 0.25);
}

// ====== Densify trajectory using spline for smooth curves ======
function trajectoryTo3D(traj: WellData["trajectory"], casingDepthMD: number): { x: number; y: number; z: number; md: number; tvd: number }[] {
  const raw = trajectoryTo3DRaw(traj, casingDepthMD);
  if (raw.length < 3) return raw;

  const spline = buildSpline(raw);
  const rawMDs: number[] = raw.map(p => p.md);
  const rawTVDs: number[] = raw.map(p => p.tvd);

  const numSegments = Math.max(100, Math.ceil(casingDepthMD / 5));
  const dense: { x: number; y: number; z: number; md: number; tvd: number }[] = [];

  for (let i = 0; i <= numSegments; i++) {
    const u = i / numSegments;
    const pt = spline.getPointAt(u);
    const rawU = u * (raw.length - 1);
    const segIdx = Math.min(Math.floor(rawU), raw.length - 2);
    const segFrac = rawU - segIdx;
    const md = rawMDs[segIdx] + segFrac * (rawMDs[segIdx + 1] - rawMDs[segIdx]);
    const tvd = rawTVDs[segIdx] + segFrac * (rawTVDs[segIdx + 1] - rawTVDs[segIdx]);
    dense.push({ x: pt.x, y: pt.y, z: pt.z, md, tvd });
  }
  return dense;
}

// Interpolate 3D position at given MD using dense points (smooth)
function interpAt(pts: ReturnType<typeof trajectoryTo3D>, md: number): { x: number; y: number; z: number } {
  if (pts.length < 2) return { x: 0, y: -md, z: 0 };
  if (md <= pts[0].md) return pts[0];
  if (md >= pts[pts.length - 1].md) return pts[pts.length - 1];

  let lo = 0, hi = pts.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].md <= md) lo = mid; else hi = mid;
  }
  const f = (md - pts[lo].md) / (pts[hi].md - pts[lo].md || 1);
  return {
    x: pts[lo].x + f * (pts[hi].x - pts[lo].x),
    y: pts[lo].y + f * (pts[hi].y - pts[lo].y),
    z: pts[lo].z + f * (pts[hi].z - pts[lo].z),
  };
}

// ====== 3D Tube along trajectory ======
function WellTube({ path, radius, color, opacity = 1 }: { path: THREE.Vector3[]; radius: number; color: string; opacity?: number }) {
  const geometry = useMemo(() => {
    if (path.length < 2) return null;
    const curve = new THREE.CatmullRomCurve3(path, false, "catmullrom", 0.3);
    return new THREE.TubeGeometry(curve, Math.max(path.length * 4, 32), radius, 16, false);
  }, [path, radius]);
  if (!geometry) return null;
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color={color} transparent={opacity < 1} opacity={opacity} side={THREE.DoubleSide} metalness={0.2} roughness={0.6} />
    </mesh>
  );
}

// ====== Depth tick marks ======
function DepthMarker({ position, label, offset }: { position: [number, number, number]; label: string; offset: [number, number, number] }) {
  return (
    <group>
      <mesh position={position}>
        <sphereGeometry args={[0.008, 8, 8]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      <Text
        position={[position[0] + offset[0], position[1] + offset[1], position[2] + offset[2]]}
        fontSize={0.035}
        color="#aaaaaa"
        anchorX="left"
        anchorY="middle"
      >
        {label}
      </Text>
    </group>
  );
}

// ====== Main 3D Scene ======
function WellScene3D({ wellData, slurries, buffers, drillingFluid, displacementFluids }: Props) {
  const scale = 1 / Math.max(wellData.casingDepthMD, 100); // normalize to ~1 unit
  const pts3d = useMemo(() => trajectoryTo3D(wellData.trajectory, wellData.casingDepthMD), [wellData.trajectory, wellData.casingDepthMD]);
  const scaledPts = useMemo(() => pts3d.map(p => ({ ...p, x: p.x * scale, y: p.y * scale, z: p.z * scale })), [pts3d, scale]);

  // Generate path points for a given MD range — adaptive density for smoothness
  const pathForRange = (mdStart: number, mdEnd: number): THREE.Vector3[] => {
    const range = Math.abs(mdEnd - mdStart);
    const steps = Math.max(40, Math.ceil(range / 3)); // ~1 point per 3m for silky curves
    const result: THREE.Vector3[] = [];
    for (let i = 0; i <= steps; i++) {
      const md = mdStart + (mdEnd - mdStart) * i / steps;
      const p = interpAt(pts3d, md);
      result.push(new THREE.Vector3(p.x * scale, p.y * scale, p.z * scale));
    }
    return result;
  };

  // Radii (scaled for visibility)
  const vizScale = 0.08; // visual exaggeration for radii
  const holeR = (wellData.holeDiameter / 2 / 1000) * vizScale;
  const casOR = (wellData.casingOD / 2 / 1000) * vizScale;
  const casIR = (getCasingID(wellData.casingOD, wellData.casingWall) / 2 / 1000) * vizScale;
  const prevCasOR = (wellData.prevCasingOD / 2 / 1000) * vizScale;
  const prevCasIR = (wellData.prevCasingID / 2 / 1000) * vizScale;

  const casingID = getCasingID(wellData.casingOD, wellData.casingWall);
  const annVPM = annularVolumePerMeter(wellData.holeDiameter, wellData.casingOD, wellData.cavernCoeff);

  // Cement sections
  const cementSections = useMemo(() => {
    const secs: { mdTop: number; mdBot: number; color: string; name: string }[] = [];
    slurries.forEach((s, i) => {
      const h = getSlurryHeight(slurries, i, wellData.casingDepthMD);
      if (h > 0) {
        const lastIdx = slurries.length - 1;
        const mdBot = i === lastIdx ? wellData.casingDepthMD : slurries[i + 1].topDepthMD;
        secs.push({ mdTop: s.topDepthMD, mdBot, color: CEMENT_COLORS[i % CEMENT_COLORS.length], name: s.name });
      }
    });
    return secs;
  }, [slurries, wellData.casingDepthMD]);

  // Buffer sections above cement
  const bufferSections = useMemo(() => {
    const secs: { mdTop: number; mdBot: number; color: string; name: string }[] = [];
    let currentMD = slurries.length > 0 ? Math.min(...slurries.map(s => s.topDepthMD)) : wellData.casingDepthMD;
    for (let i = buffers.length - 1; i >= 0; i--) {
      const bufH = buffers[i].volume / annVPM;
      const mdBot = currentMD;
      const mdTop = Math.max(0, currentMD - bufH);
      secs.push({ mdTop, mdBot, color: BUFFER_COLORS_3D[i % BUFFER_COLORS_3D.length], name: buffers[i].name });
      currentMD = mdTop;
    }
    return secs;
  }, [buffers, slurries, annVPM, wellData.casingDepthMD]);

  const topFluidMD = bufferSections.length > 0
    ? Math.min(...bufferSections.map(b => b.mdTop))
    : (slurries.length > 0 ? Math.min(...slurries.map(s => s.topDepthMD)) : wellData.casingDepthMD);

  // Trajectory center line
  const centerLine = useMemo(() => scaledPts.map(p => new THREE.Vector3(p.x, p.y, p.z)), [scaledPts]);

  // Center of well for camera target
  const center = useMemo(() => {
    const mid = interpAt(pts3d, wellData.casingDepthMD / 2);
    return new THREE.Vector3(mid.x * scale, mid.y * scale, mid.z * scale);
  }, [pts3d, scale, wellData.casingDepthMD]);

  // Depth markers every 50m (or appropriate interval)
  const depthInterval = wellData.casingDepthMD > 500 ? 100 : 50;
  const depthMarkers = useMemo(() => {
    const markers: { md: number; tvd: number; pos: [number, number, number]; label: string }[] = [];
    for (let md = 0; md <= wellData.casingDepthMD; md += depthInterval) {
      const p = interpAt(pts3d, md);
      const tvd = interpolateTVD(md, wellData.trajectory);
      markers.push({ md, tvd, pos: [p.x * scale, p.y * scale, p.z * scale], label: `${md}/${tvd.toFixed(0)}` });
    }
    const lastMD = wellData.casingDepthMD;
    if (lastMD % depthInterval !== 0) {
      const p = interpAt(pts3d, lastMD);
      const tvd = interpolateTVD(lastMD, wellData.trajectory);
      markers.push({ md: lastMD, tvd, pos: [p.x * scale, p.y * scale, p.z * scale], label: `${lastMD}/${tvd.toFixed(0)}` });
    }
    return markers;
  }, [pts3d, scale, wellData, depthInterval]);

  // Previous casing label position
  const prevCasingLabelPos = useMemo(() => {
    if (wellData.prevCasingDepth <= 0) return null;
    const midMD = wellData.prevCasingDepth / 2;
    const p = interpAt(pts3d, midMD);
    return [p.x * scale + holeR * 3, p.y * scale, p.z * scale] as [number, number, number];
  }, [pts3d, scale, wellData.prevCasingDepth, holeR]);

  // Previous casing shoe label
  const prevCasingShoePos = useMemo(() => {
    if (wellData.prevCasingDepth <= 0) return null;
    const p = interpAt(pts3d, wellData.prevCasingDepth);
    return [p.x * scale, p.y * scale, p.z * scale] as [number, number, number];
  }, [pts3d, scale, wellData.prevCasingDepth]);

  // 3-plane grid sizing
  const gridSize = 1.2;
  const gridDiv = 12;
  const gridColor1 = "#3a3a3a";
  const gridColor2 = "#2a2a2a";
  const bottomY = (() => {
    const p = interpAt(pts3d, wellData.casingDepthMD);
    return p.y * scale;
  })();

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[3, 2, 5]} intensity={0.8} />
      <directionalLight position={[-2, -1, -3]} intensity={0.3} />

      {/* ===== 3-plane reference grid ===== */}
      {/* XZ plane (horizontal, at surface y=0) */}
      <group position={[0, 0, 0]}>
        <gridHelper args={[gridSize, gridDiv, gridColor1, gridColor2]} />
      </group>
      {/* XZ plane (horizontal, at bottom) */}
      <group position={[0, bottomY, 0]}>
        <gridHelper args={[gridSize, gridDiv, gridColor1, gridColor2]} />
      </group>

      {/* XY plane (vertical, back wall at z = -gridSize/2) */}
      <group position={[0, bottomY / 2, -gridSize / 2]} rotation={[Math.PI / 2, 0, 0]}>
        <gridHelper args={[gridSize, gridDiv, gridColor1, gridColor2]} />
      </group>

      {/* YZ plane (vertical, left wall at x = -gridSize/2) */}
      <group position={[-gridSize / 2, bottomY / 2, 0]} rotation={[0, 0, Math.PI / 2]}>
        <gridHelper args={[gridSize, gridDiv, gridColor1, gridColor2]} />
      </group>

      {/* Axis labels */}
      <Text position={[gridSize / 2 + 0.05, 0, 0]} fontSize={0.025} color="#666">X</Text>
      <Text position={[0, 0, gridSize / 2 + 0.05]} fontSize={0.025} color="#666">Z</Text>
      <Text position={[-gridSize / 2 - 0.05, bottomY / 2, 0]} fontSize={0.025} color="#666">TVD</Text>

      {/* Rock / Formation — open hole */}
      <WellTube path={pathForRange(wellData.prevCasingDepth, wellData.casingDepthMD)} radius={holeR * 1.3} color={ROCK_COLOR_3D} opacity={0.3} />

      {/* Previous casing — outer wall (visible, thicker) */}
      {wellData.prevCasingDepth > 0 && (
        <>
          <WellTube path={pathForRange(0, wellData.prevCasingDepth)} radius={prevCasOR} color={PREV_CASING_STEEL} opacity={0.55} />
          {/* Previous casing inner wall hint */}
          <WellTube path={pathForRange(0, wellData.prevCasingDepth)} radius={prevCasIR} color="#666666" opacity={0.2} />
          {/* Previous casing shoe ring */}
          {prevCasingShoePos && (
            <mesh position={prevCasingShoePos}>
              <torusGeometry args={[prevCasOR * 1.3, 0.004, 8, 24]} />
              <meshStandardMaterial color={PREV_CASING_STEEL} emissive={PREV_CASING_STEEL} emissiveIntensity={0.3} />
            </mesh>
          )}
          {/* Label */}
          {prevCasingLabelPos && (
            <Text position={prevCasingLabelPos} fontSize={0.028} color={PREV_CASING_STEEL} anchorX="left" fontWeight={600}>
              {`Кондуктор ∅${wellData.prevCasingOD} (${wellData.prevCasingDepth}м)`}
            </Text>
          )}
          {/* Shoe depth label */}
          {prevCasingShoePos && (
            <Text
              position={[prevCasingShoePos[0] + holeR * 3, prevCasingShoePos[1], prevCasingShoePos[2]]}
              fontSize={0.025}
              color="#BBBBBB"
              anchorX="left"
            >
              {`Башмак ${wellData.prevCasingDepth}м`}
            </Text>
          )}
        </>
      )}

      {/* Current casing (outer) */}
      <WellTube path={pathForRange(0, wellData.casingDepthMD)} radius={casOR} color={CASING_STEEL} opacity={0.6} />

      {/* Drilling mud in annulus (above fluids) */}
      {topFluidMD > 1 && (
        <WellTube path={pathForRange(0, topFluidMD)} radius={holeR * 1.05} color={MUD_COLOR_3D} opacity={0.35} />
      )}

      {/* Buffer sections in annulus */}
      {bufferSections.map((buf, i) => (
        <WellTube key={`buf3d-${i}`} path={pathForRange(buf.mdTop, buf.mdBot)} radius={holeR * 1.1} color={buf.color} opacity={0.7} />
      ))}

      {/* Cement sections in annulus */}
      {cementSections.map((sec, i) => (
        <WellTube key={`cem3d-${i}`} path={pathForRange(sec.mdTop, sec.mdBot)} radius={holeR * 1.1} color={sec.color} opacity={0.8} />
      ))}

      {/* Displacement fluid inside pipe */}
      <WellTube path={pathForRange(0, wellData.ckodDepth)} radius={casIR * 0.8} color={DISP_COLOR} opacity={0.4} />

      {/* Shoe */}
      {(() => {
        const p = interpAt(pts3d, wellData.casingDepthMD);
        return (
          <mesh position={[p.x * scale, p.y * scale, p.z * scale]}>
            <coneGeometry args={[casOR * 1.5, 0.02, 12]} />
            <meshStandardMaterial color="#FF6B35" emissive="#FF4500" emissiveIntensity={0.3} />
          </mesh>
        );
      })()}

      {/* CKOD marker */}
      {(() => {
        const p = interpAt(pts3d, wellData.ckodDepth);
        return (
          <mesh position={[p.x * scale, p.y * scale, p.z * scale]}>
            <torusGeometry args={[casOR * 1.2, 0.003, 8, 24]} />
            <meshStandardMaterial color="#E53E3E" emissive="#E53E3E" emissiveIntensity={0.5} />
          </mesh>
        );
      })()}

      {/* Depth markers */}
      {depthMarkers.map((dm, i) => (
        <DepthMarker key={`dm-${i}`} position={dm.pos} label={dm.label} offset={[holeR * 2.5, 0, 0]} />
      ))}

      {/* Section labels */}
      {cementSections.map((sec, i) => {
        const midMD = (sec.mdTop + sec.mdBot) / 2;
        const p = interpAt(pts3d, midMD);
        return (
          <Text key={`cl3d-${i}`} position={[p.x * scale - holeR * 3, p.y * scale, p.z * scale]} fontSize={0.03} color={sec.color} anchorX="right" fontWeight={700}>
            {sec.name}
          </Text>
        );
      })}

      {bufferSections.map((buf, i) => {
        const midMD = (buf.mdTop + buf.mdBot) / 2;
        const p = interpAt(pts3d, midMD);
        return (
          <Text key={`bl3d-${i}`} position={[p.x * scale - holeR * 3, p.y * scale, p.z * scale]} fontSize={0.025} color={buf.color} anchorX="right">
            {buf.name}
          </Text>
        );
      })}

      {/* Axis label */}
      <Text position={[0, 0.08, 0]} fontSize={0.025} color="#999">
        Устье
      </Text>

      {/* Trajectory center line */}
      <Line points={centerLine} color="#ffffff" lineWidth={0.5} dashed dashSize={0.01} gapSize={0.01} />

      <OrbitControls target={center} enableDamping dampingFactor={0.1} />
    </>
  );
}

// ====== 2D Cross-Section SVG ======
function CrossSection({ wellData, slurries, buffers, drillingFluid }: Omit<Props, "displacementFluids">) {
  const w = 400, h = 400;
  const cx = w / 2, cy = h / 2;
  const maxR = 160;
  const holeR = maxR;
  const casOR = maxR * (wellData.casingOD / wellData.holeDiameter);
  const casingID = getCasingID(wellData.casingOD, wellData.casingWall);
  const casIR = maxR * (casingID / wellData.holeDiameter);
  const prevCasOR = Math.min(maxR * (wellData.prevCasingOD / wellData.holeDiameter), maxR * 1.15);
  const prevCasIR = maxR * (wellData.prevCasingID / wellData.holeDiameter);
  const annVPM = annularVolumePerMeter(wellData.holeDiameter, wellData.casingOD, wellData.cavernCoeff);
  const totalCementMD = slurries.reduce((s, sl, i) => s + getSlurryHeight(slurries, i, wellData.casingDepthMD), 0);
  const cementFillFrac = Math.min(1, totalCementMD / wellData.casingDepthMD);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full max-w-sm mx-auto">
      <defs>
        <radialGradient id="rockRadial"><stop offset="70%" stopColor="#7A6550" /><stop offset="100%" stopColor="#5C4A3A" /></radialGradient>
        <radialGradient id="cementRadial"><stop offset="0%" stopColor="#D4955A" /><stop offset="100%" stopColor="#8B4513" /></radialGradient>
        <radialGradient id="mudRadial"><stop offset="0%" stopColor="#3D9963" /><stop offset="100%" stopColor="#1D5C33" /></radialGradient>
        <radialGradient id="dispRadial"><stop offset="0%" stopColor="#6CB0F0" /><stop offset="100%" stopColor="#2B6CB0" /></radialGradient>
        <radialGradient id="casingRadial"><stop offset="0%" stopColor="#C8C8C8" /><stop offset="50%" stopColor="#A0A0A0" /><stop offset="100%" stopColor="#707070" /></radialGradient>
      </defs>
      <circle cx={cx} cy={cy} r={holeR + 15} fill="url(#rockRadial)" />
      {Array.from({ length: 30 }).map((_, i) => {
        const angle = (i / 30) * Math.PI * 2 + 0.3;
        const r = holeR + 5 + Math.random() * 8;
        return <circle key={`rock-${i}`} cx={cx + Math.cos(angle) * r} cy={cy + Math.sin(angle) * r} r={1.5} fill="#5C4A3A" opacity={0.4} />;
      })}
      <circle cx={cx} cy={cy} r={holeR} fill="none" stroke="#5C4A3A" strokeWidth="2" />
      <circle cx={cx} cy={cy} r={holeR - 1} fill="url(#cementRadial)" />
      <circle cx={cx} cy={cy} r={prevCasOR} fill="none" stroke={PREV_CASING_STEEL} strokeWidth="2" strokeDasharray="6 3" opacity={0.5} />
      <circle cx={cx} cy={cy} r={casOR} fill="url(#casingRadial)" />
      <circle cx={cx} cy={cy} r={casOR} fill="none" stroke="#666" strokeWidth="1.5" />
      <circle cx={cx} cy={cy} r={casIR} fill="url(#dispRadial)" />
      <circle cx={cx} cy={cy} r={casIR} fill="none" stroke="#888" strokeWidth="1" />
      <line x1={cx - holeR} y1={cy - holeR - 20} x2={cx + holeR} y2={cy - holeR - 20} stroke="#999" strokeWidth="0.8" />
      <line x1={cx - holeR} y1={cy - holeR - 25} x2={cx - holeR} y2={cy - holeR - 15} stroke="#999" strokeWidth="0.5" />
      <line x1={cx + holeR} y1={cy - holeR - 25} x2={cx + holeR} y2={cy - holeR - 15} stroke="#999" strokeWidth="0.5" />
      <text x={cx} y={cy - holeR - 24} fontSize="11" fill="#999" textAnchor="middle" fontFamily="sans-serif">∅{wellData.holeDiameter} мм</text>
      <line x1={cx - casOR} y1={cy + holeR + 20} x2={cx + casOR} y2={cy + holeR + 20} stroke="#aaa" strokeWidth="0.8" />
      <line x1={cx - casOR} y1={cy + holeR + 15} x2={cx - casOR} y2={cy + holeR + 25} stroke="#aaa" strokeWidth="0.5" />
      <line x1={cx + casOR} y1={cy + holeR + 15} x2={cx + casOR} y2={cy + holeR + 25} stroke="#aaa" strokeWidth="0.5" />
      <text x={cx} y={cy + holeR + 34} fontSize="11" fill="#aaa" textAnchor="middle" fontFamily="sans-serif">∅{wellData.casingOD}×{wellData.casingWall} мм</text>
      <text x={cx} y={cy + 5} fontSize="10" fill="#fff" textAnchor="middle" fontFamily="sans-serif" fontWeight="600" opacity={0.8}>Продавка</text>
      <text x={cx + casOR + (holeR - casOR) / 2} y={cy + 4} fontSize="9" fill="#fff" textAnchor="middle" fontFamily="sans-serif" fontWeight="500" transform={`rotate(90, ${cx + casOR + (holeR - casOR) / 2}, ${cy})`}>Цемент</text>
      <text x={cx - casOR - (holeR - casOR) / 2} y={cy + 4} fontSize="9" fill="#fff" textAnchor="middle" fontFamily="sans-serif" fontWeight="500" transform={`rotate(-90, ${cx - casOR - (holeR - casOR) / 2}, ${cy})`}>Цемент</text>
      <text x={cx} y={cy + casOR + 12} fontSize="8" fill="#ccc" textAnchor="middle" fontFamily="sans-serif">Обсадная колонна</text>
    </svg>
  );
}

// ====== Main Component ======
export default function WellVisualization(props: Props) {
  const { wellData, slurries, buffers, drillingFluid, displacementFluids } = props;
  const vis3dRef = useRef<HTMLDivElement>(null);
  const crossRef = useRef<HTMLDivElement>(null);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">3D профиль ствола скважины</CardTitle>
              <p className="text-xs text-muted-foreground">Глубины: ствол / вертикаль (м). Вращайте мышью для обзора.</p>
            </div>
            <CopyImageButton targetRef={vis3dRef} />
          </div>
        </CardHeader>
        <CardContent>
          <div ref={vis3dRef} className="rounded-lg border border-border overflow-hidden" style={{ height: "550px" }}>
            <Canvas camera={{ position: [1.5, -0.3, 1.5], fov: 45, near: 0.001, far: 100 }} gl={{ preserveDrawingBuffer: true }}>
              <WellScene3D {...props} />
            </Canvas>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">Поперечный разрез (после СТОП)</CardTitle>
              <p className="text-xs text-muted-foreground">Размещение жидкостей в сечении скважины</p>
            </div>
            <CopyImageButton targetRef={crossRef} />
          </div>
        </CardHeader>
        <CardContent>
          <div ref={crossRef}>
            <CrossSection wellData={wellData} slurries={slurries} buffers={buffers} drillingFluid={drillingFluid} />
          </div>
        </CardContent>
      </Card>

      <DisplacementEfficiency
        wellData={wellData}
        slurries={slurries}
        buffers={buffers}
        drillingFluid={drillingFluid}
        displacementFluids={displacementFluids}
      />

      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground px-2">
        <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-sm" style={{ background: CASING_STEEL }} /> Обсадная колонна</span>
        {slurries.map((s, i) => (
          <span key={i} className="flex items-center gap-1.5">
            <span className="w-3.5 h-3.5 rounded-sm" style={{ background: CEMENT_COLORS[i % CEMENT_COLORS.length] }} />
            {s.name}
          </span>
        ))}
        {buffers.map((b, i) => (
          <span key={`b-${i}`} className="flex items-center gap-1.5">
            <span className="w-3.5 h-3.5 rounded-sm" style={{ background: BUFFER_COLORS_3D[i % BUFFER_COLORS_3D.length] }} />
            {b.name}
          </span>
        ))}
        <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-sm" style={{ background: MUD_COLOR_3D }} /> {drillingFluid.name}</span>
        <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-sm" style={{ background: DISP_COLOR }} /> Продавочная жидкость</span>
        <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-sm" style={{ background: ROCK_COLOR_3D }} /> Горная порода</span>
        <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-sm" style={{ background: "#FF6B35" }} /> Башмак</span>
        <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-full border" style={{ background: "#E53E3E" }} /> ЦКОД</span>
      </div>
    </div>
  );
}
