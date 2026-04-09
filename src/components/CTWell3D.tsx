import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Text, Line } from "@react-three/drei";
import * as THREE from "three";
import type { TrajectoryPoint } from "@/lib/coiled-tubing-calculations";

function trajectoryTo3D(traj: TrajectoryPoint[], maxMD: number) {
  if (!traj || traj.length < 2) {
    return [
      { x: 0, y: 0, z: 0, md: 0 },
      { x: 0, y: -maxMD, z: 0, md: maxMD },
    ];
  }
  const sorted = [...traj].sort((a, b) => a.md - b.md);
  const pts: { x: number; y: number; z: number; md: number }[] = [];
  let cx = 0, cy = 0, cz = 0;
  pts.push({ x: 0, y: 0, z: 0, md: sorted[0].md });
  for (let i = 1; i < sorted.length; i++) {
    const dMD = sorted[i].md - sorted[i - 1].md;
    const zenRad = ((sorted[i].zenith + sorted[i - 1].zenith) / 2) * Math.PI / 180;
    const azRad = ((sorted[i].azimuth + sorted[i - 1].azimuth) / 2) * Math.PI / 180;
    cx += dMD * Math.sin(zenRad) * Math.sin(azRad);
    cy -= dMD * Math.cos(zenRad);
    cz += dMD * Math.sin(zenRad) * Math.cos(azRad);
    pts.push({ x: cx, y: cy, z: cz, md: sorted[i].md });
  }
  return pts;
}

function WellTube({ trajectory, maxMD }: { trajectory: TrajectoryPoint[]; maxMD: number }) {
  const { tubeGeo, labels, linePoints } = useMemo(() => {
    const raw = trajectoryTo3D(trajectory, maxMD);
    const scale = 1;
    const vectors = raw.map(p => new THREE.Vector3(p.x * scale, p.y * scale, p.z * scale));
    const spline = new THREE.CatmullRomCurve3(vectors, false, "catmullrom", 0.25);
    const tubeGeo = new THREE.TubeGeometry(spline, Math.max(64, raw.length * 10), 8, 12, false);
    const linePoints = spline.getPoints(200).map(p => [p.x, p.y, p.z] as [number, number, number]);

    const labels: { pos: THREE.Vector3; text: string }[] = [];
    const labelInterval = Math.max(500, Math.round(maxMD / 8 / 100) * 100);
    for (const p of raw) {
      if (p.md > 0 && p.md % labelInterval < 50) {
        labels.push({ pos: new THREE.Vector3(p.x * scale + 20, p.y * scale, p.z * scale), text: `${Math.round(p.md)}м` });
      }
    }
    if (raw.length > 1) {
      const last = raw[raw.length - 1];
      labels.push({ pos: new THREE.Vector3(last.x * scale + 20, last.y * scale, last.z * scale), text: `${Math.round(last.md)}м (забой)` });
    }
    return { tubeGeo, labels, linePoints };
  }, [trajectory, maxMD]);

  return (
    <group>
      <mesh geometry={tubeGeo}>
        <meshStandardMaterial color="#A8A8A8" metalness={0.4} roughness={0.5} side={THREE.DoubleSide} />
      </mesh>
      <Line points={linePoints} color="#ef4444" lineWidth={3} />
      {labels.map((l, i) => (
        <Text key={i} position={l.pos} fontSize={14} color="#ffffff" anchorX="left" anchorY="middle">
          {l.text}
        </Text>
      ))}
      {/* Surface marker */}
      <mesh position={[0, 5, 0]}>
        <boxGeometry args={[30, 10, 30]} />
        <meshStandardMaterial color="#10b981" />
      </mesh>
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
    const dist = Math.max(maxY, maxX, 500) * 1.2;
    return [dist * 0.6, -dist * 0.3, dist * 0.8] as [number, number, number];
  }, [trajectory, maxMD]);

  return (
    <div className="w-full h-[500px] bg-card rounded-lg border border-border overflow-hidden">
      <Canvas camera={{ position: camPos, fov: 50, near: 1, far: 50000 }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[1, 1, 1]} intensity={0.8} />
        <directionalLight position={[-1, -0.5, -1]} intensity={0.3} />
        <WellTube trajectory={trajectory} maxMD={maxMD} />
        <OrbitControls enableDamping dampingFactor={0.1} />
        <gridHelper args={[Math.max(maxMD * 2, 2000), 20, "#444444", "#333333"]} rotation={[0, 0, 0]} position={[0, 0, 0]} />
      </Canvas>
    </div>
  );
}