import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Text, Line } from "@react-three/drei";
import * as THREE from "three";
import type { TrajectoryPoint } from "@/lib/coiled-tubing-calculations";

function trajectoryTo3D(traj: TrajectoryPoint[], maxMD: number) {
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

/** Interpolate position along trajectory at a given MD */
function interpolateAtMD(raw: ReturnType<typeof trajectoryTo3D>, targetMD: number) {
  for (let i = 1; i < raw.length; i++) {
    if (raw[i].md >= targetMD) {
      const t = (targetMD - raw[i - 1].md) / (raw[i].md - raw[i - 1].md || 1);
      return {
        x: raw[i - 1].x + t * (raw[i].x - raw[i - 1].x),
        y: raw[i - 1].y + t * (raw[i].y - raw[i - 1].y),
        z: raw[i - 1].z + t * (raw[i].z - raw[i - 1].z),
        tvd: raw[i - 1].tvd + t * (raw[i].tvd - raw[i - 1].tvd),
      };
    }
  }
  const last = raw[raw.length - 1];
  return { x: last.x, y: last.y, z: last.z, tvd: last.tvd };
}

function DepthAxis({ maxDepth }: { maxDepth: number }) {
  const { ticks, axisLine } = useMemo(() => {
    const interval = maxDepth <= 1000 ? 100 : maxDepth <= 3000 ? 250 : 500;
    const ticks: { y: number; label: string }[] = [];
    for (let d = 0; d <= maxDepth; d += interval) {
      ticks.push({ y: -d, label: `${d}` });
    }
    const axisLine: [number, number, number][] = [
      [0, 10, 0],
      [0, -maxDepth - 20, 0],
    ];
    return { ticks, axisLine };
  }, [maxDepth]);

  const tickLen = Math.max(15, maxDepth * 0.012);
  const fontSize = Math.max(8, Math.min(16, maxDepth * 0.008));

  return (
    <group>
      {/* Vertical axis line */}
      <Line points={axisLine} color="#6b7280" lineWidth={1.5} />
      {ticks.map((t, i) => (
        <group key={i}>
          {/* Tick mark */}
          <Line
            points={[[-tickLen, t.y, 0], [0, t.y, 0]]}
            color="#6b7280"
            lineWidth={1}
          />
          {/* Horizontal dashed guide */}
          <Line
            points={[[-tickLen, t.y, 0], [tickLen * 3, t.y, 0]]}
            color="#4b5563"
            lineWidth={0.5}
            dashed
            dashSize={tickLen * 0.3}
            gapSize={tickLen * 0.3}
          />
          {/* Label */}
          <Text
            position={[-tickLen - fontSize * 0.8, t.y, 0]}
            fontSize={fontSize}
            color="#9ca3af"
            anchorX="right"
            anchorY="middle"
          >
            {t.label}
          </Text>
        </group>
      ))}
      {/* Axis title */}
      <Text
        position={[-tickLen - fontSize * 4, -maxDepth / 2, 0]}
        fontSize={fontSize * 1.1}
        color="#d1d5db"
        anchorX="center"
        anchorY="middle"
        rotation={[0, 0, Math.PI / 2]}
      >
        TVD, м
      </Text>
    </group>
  );
}

function WellTube({ trajectory, maxMD }: { trajectory: TrajectoryPoint[]; maxMD: number }) {
  const { tubeGeo, depthMarkers, linePoints, maxTVD } = useMemo(() => {
    const raw = trajectoryTo3D(trajectory, maxMD);
    const vectors = raw.map(p => new THREE.Vector3(p.x, p.y, p.z));
    const spline = new THREE.CatmullRomCurve3(vectors, false, "catmullrom", 0.25);
    const tubeRadius = Math.max(4, maxMD * 0.003);
    const tubeGeo = new THREE.TubeGeometry(spline, Math.max(64, raw.length * 10), tubeRadius, 12, false);
    const linePoints = spline.getPoints(200).map(p => [p.x, p.y, p.z] as [number, number, number]);

    const maxTVD = Math.max(...raw.map(p => p.tvd), maxMD * 0.5);

    // Depth markers along the well path
    const interval = maxMD <= 1000 ? 200 : maxMD <= 3000 ? 500 : 1000;
    const depthMarkers: { pos: THREE.Vector3; md: number; tvd: number }[] = [];
    
    for (let md = interval; md < maxMD; md += interval) {
      const pt = interpolateAtMD(raw, md);
      depthMarkers.push({
        pos: new THREE.Vector3(pt.x, pt.y, pt.z),
        md,
        tvd: pt.tvd,
      });
    }
    // Bottom marker
    if (raw.length > 1) {
      const last = raw[raw.length - 1];
      depthMarkers.push({
        pos: new THREE.Vector3(last.x, last.y, last.z),
        md: last.md,
        tvd: last.tvd,
      });
    }

    return { tubeGeo, depthMarkers, linePoints, maxTVD };
  }, [trajectory, maxMD]);

  const fontSize = Math.max(6, Math.min(14, maxMD * 0.006));
  const ringRadius = Math.max(8, maxMD * 0.006);
  const labelOffset = ringRadius + fontSize * 2;

  return (
    <group>
      {/* Well tube */}
      <mesh geometry={tubeGeo}>
        <meshStandardMaterial color="#71717a" metalness={0.5} roughness={0.4} side={THREE.DoubleSide} />
      </mesh>
      {/* Center line */}
      <Line points={linePoints} color="#ef4444" lineWidth={2} />

      {/* Depth markers with rings and labels */}
      {depthMarkers.map((m, i) => {
        const isBottom = i === depthMarkers.length - 1;
        return (
          <group key={i} position={m.pos}>
            {/* Ring marker */}
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[ringRadius, ringRadius * 0.15, 8, 24]} />
              <meshStandardMaterial color={isBottom ? "#f59e0b" : "#3b82f6"} emissive={isBottom ? "#f59e0b" : "#3b82f6"} emissiveIntensity={0.3} />
            </mesh>
            {/* MD label */}
            <Text
              position={[labelOffset, fontSize * 0.6, 0]}
              fontSize={fontSize}
              color="#e5e7eb"
              anchorX="left"
              anchorY="middle"
              fontWeight="bold"
            >
              {`MD: ${Math.round(m.md)} м`}
            </Text>
            {/* TVD label */}
            <Text
              position={[labelOffset, -fontSize * 0.6, 0]}
              fontSize={fontSize * 0.85}
              color="#9ca3af"
              anchorX="left"
              anchorY="middle"
            >
              {`TVD: ${Math.round(m.tvd)} м`}
            </Text>
            {/* Connector line to label */}
            <Line
              points={[[ringRadius * 1.2, 0, 0], [labelOffset - 2, 0, 0]]}
              color="#6b7280"
              lineWidth={1}
            />
          </group>
        );
      })}

      {/* Surface marker */}
      <group position={[0, 2, 0]}>
        <mesh>
          <boxGeometry args={[ringRadius * 4, 4, ringRadius * 4]} />
          <meshStandardMaterial color="#10b981" />
        </mesh>
        <Text
          position={[0, fontSize * 1.5, 0]}
          fontSize={fontSize * 1.1}
          color="#10b981"
          anchorX="center"
          anchorY="middle"
          fontWeight="bold"
        >
          Устье
        </Text>
      </group>

      {/* Depth axis */}
      <group position={[-maxMD * 0.15, 0, 0]}>
        <DepthAxis maxDepth={maxTVD} />
      </group>
    </group>
  );
}

interface Props {
  trajectory: TrajectoryPoint[];
  maxMD: number;
}

export default function CTWell3D({ trajectory, maxMD }: Props) {
  const camPos = useMemo(() => {
    const raw = trajectoryTo3D(trajectory, maxMD);
    const maxY = Math.abs(Math.min(...raw.map(p => p.y)));
    const maxX = Math.max(...raw.map(p => Math.abs(p.x)), ...raw.map(p => Math.abs(p.z)));
    const dist = Math.max(maxY, maxX, 500) * 1.4;
    return [dist * 0.7, -dist * 0.35, dist * 0.9] as [number, number, number];
  }, [trajectory, maxMD]);

  return (
    <div className="w-full h-[550px] bg-card rounded-lg border border-border overflow-hidden relative">
      <Canvas camera={{ position: camPos, fov: 50, near: 1, far: 50000 }}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[1, 1, 1]} intensity={0.8} />
        <directionalLight position={[-1, -0.5, -1]} intensity={0.3} />
        <WellTube trajectory={trajectory} maxMD={maxMD} />
        <OrbitControls enableDamping dampingFactor={0.1} />
      </Canvas>
      {/* Legend overlay */}
      <div className="absolute bottom-2 left-2 bg-background/80 backdrop-blur-sm rounded px-3 py-1.5 text-xs text-muted-foreground border border-border">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" /> Интервалы MD/TVD</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" /> Забой</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-0.5 bg-red-500 inline-block" /> Ось ствола</span>
        </div>
      </div>
    </div>
  );
}
