import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Text, Line } from "@react-three/drei";
import * as THREE from "three";
import type { TrajectoryPoint } from "@/lib/coiled-tubing-calculations";

// ====== Convert trajectory survey to 3D coordinates ======
function trajectoryTo3DRaw(traj: TrajectoryPoint[], maxMD: number) {
  if (!traj || traj.length < 2) {
    return [
      { x: 0, y: 0, z: 0, md: 0, tvd: 0 },
      { x: 0, y: -maxMD, z: 0, md: maxMD, tvd: maxMD },
    ];
  }
  const sorted = [...traj].sort((a, b) => a.md - b.md);
  const pts: { x: number; y: number; z: number; md: number; tvd: number }[] = [];
  let cx = 0, cy = 0, cz = 0;
  pts.push({ x: 0, y: 0, z: 0, md: sorted[0].md, tvd: 0 });
  for (let i = 1; i < sorted.length; i++) {
    const dMD = sorted[i].md - sorted[i - 1].md;
    const zenRad = ((sorted[i].zenith + sorted[i - 1].zenith) / 2) * Math.PI / 180;
    const azRad = ((sorted[i].azimuth + sorted[i - 1].azimuth) / 2) * Math.PI / 180;
    cx += dMD * Math.sin(zenRad) * Math.sin(azRad);
    cy -= dMD * Math.cos(zenRad);
    cz += dMD * Math.sin(zenRad) * Math.cos(azRad);
    pts.push({ x: cx, y: cy, z: cz, md: sorted[i].md, tvd: Math.abs(cy) });
  }
  return pts;
}

function buildSpline(rawPts: ReturnType<typeof trajectoryTo3DRaw>) {
  const vectors = rawPts.map(p => new THREE.Vector3(p.x, p.y, p.z));
  return new THREE.CatmullRomCurve3(vectors, false, "catmullrom", 0.25);
}

function trajectoryTo3D(traj: TrajectoryPoint[], maxMD: number) {
  const raw = trajectoryTo3DRaw(traj, maxMD);
  if (raw.length < 3) return raw;
  const spline = buildSpline(raw);
  const rawMDs = raw.map(p => p.md);
  const rawTVDs = raw.map(p => p.tvd);
  const numSegments = Math.max(100, Math.ceil(maxMD / 5));
  const dense: typeof raw = [];
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

function interpAt(pts: ReturnType<typeof trajectoryTo3D>, md: number) {
  if (pts.length < 2) return { x: 0, y: -md, z: 0, tvd: md };
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
    tvd: pts[lo].tvd + f * (pts[hi].tvd - pts[lo].tvd),
    md,
  };
}

// ====== Well tube mesh along trajectory ======
function WellTube({ path, radius, color, opacity = 1 }: { path: THREE.Vector3[]; radius: number; color: string; opacity?: number }) {
  const geometry = useMemo(() => {
    if (path.length < 2) return null;
    const filtered: THREE.Vector3[] = [path[0]];
    for (let i = 1; i < path.length; i++) {
      if (path[i].distanceTo(filtered[filtered.length - 1]) > 0.0001) filtered.push(path[i]);
    }
    if (filtered.length < 2) return null;
    const curve = new THREE.CatmullRomCurve3(filtered, false, "catmullrom", 0.3);
    try {
      return new THREE.TubeGeometry(curve, Math.max(filtered.length * 4, 32), radius, 16, false);
    } catch { return null; }
  }, [path, radius]);
  if (!geometry) return null;
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color={color} transparent={opacity < 1} opacity={opacity} side={THREE.DoubleSide} metalness={0.35} roughness={0.5} />
    </mesh>
  );
}

// ====== Depth marker (sphere + text) ======
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

// ====== 3D Scene (matches cementing visualization 1:1) ======
function WellScene({ trajectory, maxMD }: { trajectory: TrajectoryPoint[]; maxMD: number }) {
  const scale = 1 / Math.max(maxMD, 100);
  const pts3d = useMemo(() => trajectoryTo3D(trajectory, maxMD), [trajectory, maxMD]);
  const scaledPts = useMemo(() => pts3d.map(p => ({ ...p, x: p.x * scale, y: p.y * scale, z: p.z * scale })), [pts3d, scale]);

  const pathForRange = (mdStart: number, mdEnd: number): THREE.Vector3[] => {
    const range = Math.abs(mdEnd - mdStart);
    const steps = Math.max(40, Math.ceil(range / 3));
    const result: THREE.Vector3[] = [];
    for (let i = 0; i <= steps; i++) {
      const md = mdStart + (mdEnd - mdStart) * i / steps;
      const p = interpAt(pts3d, md);
      result.push(new THREE.Vector3(p.x * scale, p.y * scale, p.z * scale));
    }
    return result;
  };

  const tubeRadius = 0.015;

  // Center line
  const centerLine = useMemo(() => scaledPts.map(p => new THREE.Vector3(p.x, p.y, p.z)), [scaledPts]);

  // Camera target
  const center = useMemo(() => {
    const mid = interpAt(pts3d, maxMD / 2);
    return new THREE.Vector3(mid.x * scale, mid.y * scale, mid.z * scale);
  }, [pts3d, scale, maxMD]);

  // Depth markers
  const depthInterval = maxMD > 500 ? 100 : 50;
  const depthMarkers = useMemo(() => {
    const markers: { md: number; tvd: number; pos: [number, number, number]; label: string }[] = [];
    for (let md = 0; md <= maxMD; md += depthInterval) {
      const p = interpAt(pts3d, md);
      markers.push({ md, tvd: p.tvd, pos: [p.x * scale, p.y * scale, p.z * scale], label: `${md}/${p.tvd.toFixed(0)}` });
    }
    const lastMD = maxMD;
    if (lastMD % depthInterval !== 0) {
      const p = interpAt(pts3d, lastMD);
      markers.push({ md: lastMD, tvd: p.tvd, pos: [p.x * scale, p.y * scale, p.z * scale], label: `${lastMD}/${p.tvd.toFixed(0)}` });
    }
    return markers;
  }, [pts3d, scale, maxMD, depthInterval]);

  // 3-plane grid sizing
  const gridSize = 1.2;
  const gridDiv = 12;
  const gridColor1 = "#3a3a3a";
  const gridColor2 = "#2a2a2a";
  const bottomY = (() => {
    const p = interpAt(pts3d, maxMD);
    return p.y * scale;
  })();

  // Shoe position
  const shoePos = useMemo(() => {
    const p = interpAt(pts3d, maxMD);
    return [p.x * scale, p.y * scale, p.z * scale] as [number, number, number];
  }, [pts3d, scale, maxMD]);

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[3, 2, 5]} intensity={0.8} />
      <directionalLight position={[-2, -1, -3]} intensity={0.3} />

      {/* ===== 3-plane reference grid (identical to cementing) ===== */}
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

      {/* Well tube (casing) */}
      <WellTube path={pathForRange(0, maxMD)} radius={tubeRadius} color="#A8A8A8" opacity={0.6} />

      {/* Center line (dashed white) */}
      <Line points={centerLine} color="#ffffff" lineWidth={0.5} dashed dashSize={0.01} gapSize={0.01} />

      {/* Depth markers */}
      {depthMarkers.map((dm, i) => (
        <DepthMarker key={`dm-${i}`} position={dm.pos} label={dm.label} offset={[tubeRadius * 3, 0, 0]} />
      ))}

      {/* Surface marker */}
      <Text position={[0, 0.08, 0]} fontSize={0.025} color="#999">
        Устье
      </Text>

      {/* Bottom shoe */}
      <mesh position={shoePos}>
        <coneGeometry args={[tubeRadius * 2, 0.02, 12]} />
        <meshStandardMaterial color="#FF6B35" emissive="#FF4500" emissiveIntensity={0.3} />
      </mesh>
      <Text
        position={[shoePos[0] + tubeRadius * 4, shoePos[1], shoePos[2]]}
        fontSize={0.028}
        color="#f59e0b"
        anchorX="left"
        fontWeight={600}
      >
        {`Забой ${maxMD} м`}
      </Text>

      <OrbitControls target={center} enableDamping dampingFactor={0.1} />
    </>
  );
}

interface Props {
  trajectory: TrajectoryPoint[];
  maxMD: number;
}

export default function CTWell3D({ trajectory, maxMD }: Props) {
  const camDist = 1.4;

  return (
    <div className="w-full h-[550px] bg-card rounded-lg border border-border overflow-hidden relative">
      <Canvas camera={{ position: [camDist * 0.7, -camDist * 0.35, camDist * 0.9], fov: 50, near: 0.01, far: 100 }}>
        <WellScene trajectory={trajectory} maxMD={maxMD} />
      </Canvas>
      {/* Legend overlay */}
      <div className="absolute bottom-2 left-2 bg-background/80 backdrop-blur-sm rounded px-3 py-1.5 text-xs text-muted-foreground border border-border">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-gray-400 inline-block" /> Ствол скважины</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" /> Забой</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-0.5 bg-white inline-block" /> Ось ствола</span>
          <span className="text-[9px]">Метки: MD/TVD</span>
        </div>
      </div>
    </div>
  );
}
