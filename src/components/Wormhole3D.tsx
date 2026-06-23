import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Text } from "@react-three/drei";
import * as THREE from "three";

interface Props {
  wormholeLengthM: number;
  penetrationRadiusM: number;
  wellboreRadiusM: number;
  damkohler?: number;
  reservoirHeightM?: number;
  /** Тип реагента — задаёт цвет зоны проникновения */
  reagentCategory?: "acid" | "foam" | "solvent" | "nitrogen" | "combo";
  /** Плотность перфорации, отв/м — если задана, рисуем перфорационные каналы */
  perfDensity?: number;
}

const REAGENT_COLORS: Record<string, string> = {
  acid:     "#ff6b35",
  foam:     "#4fc3f7",
  solvent:  "#9c27b0",
  nitrogen: "#cfd8dc",
  combo:    "#ff8a65",
};

type Branch = { start: THREE.Vector3; end: THREE.Vector3; thickness: number; reach: number };

function generateWormholes(
  rw: number,
  maxLen: number,
  yLevels: number[],
  regime: "face" | "wormhole" | "conical" | "compact",
): Branch[] {
  let seed = 4242;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };

  const cfg = {
    face:     { nPerLevel: 18, lenF: 0.45, thick: 0.018, branches: 0 },
    wormhole: { nPerLevel: 5,  lenF: 1.0,  thick: 0.022, branches: 2 },
    conical:  { nPerLevel: 9,  lenF: 0.7,  thick: 0.016, branches: 3 },
    compact:  { nPerLevel: 22, lenF: 0.25, thick: 0.016, branches: 0 },
  }[regime];

  const out: Branch[] = [];
  for (const y of yLevels) {
    for (let i = 0; i < cfg.nPerLevel; i++) {
      const ang = (Math.PI * 2 * i) / cfg.nPerLevel + (rnd() - 0.5) * 0.25;
      const dir = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
      const len = maxLen * cfg.lenF * (0.7 + rnd() * 0.5);
      const start = dir.clone().multiplyScalar(rw); start.y = y;
      const end = dir.clone().multiplyScalar(rw + len); end.y = y + (rnd() - 0.5) * 0.05;
      out.push({ start, end, thickness: cfg.thick, reach: len / maxLen });
      for (let b = 0; b < cfg.branches; b++) {
        const t = 0.4 + rnd() * 0.45;
        const bStart = start.clone().lerp(end, t);
        const bAng = ang + (rnd() - 0.5) * 1.1;
        const bDir = new THREE.Vector3(Math.cos(bAng), 0, Math.sin(bAng));
        const bLen = len * (0.25 + rnd() * 0.35);
        const bEnd = bStart.clone().add(bDir.multiplyScalar(bLen));
        out.push({ start: bStart, end: bEnd, thickness: cfg.thick * 0.6, reach: (bStart.length() - rw + bLen) / maxLen });
      }
    }
  }
  return out;
}

function Channel({ seg, color }: { seg: Branch; color: string }) {
  const geom = useMemo(() => {
    const dir = seg.end.clone().sub(seg.start);
    const len = dir.length();
    const g = new THREE.CylinderGeometry(seg.thickness, seg.thickness * 0.5, len, 8);
    g.translate(0, len / 2, 0);
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    g.applyQuaternion(quat);
    g.translate(seg.start.x, seg.start.y, seg.start.z);
    return g;
  }, [seg]);
  const c = useMemo(() => new THREE.Color(color), [color]);
  return (
    <mesh geometry={geom}>
      <meshStandardMaterial color={c} emissive={c} emissiveIntensity={0.35} roughness={0.5} />
    </mesh>
  );
}

function Scene({
  wormholeLengthM, penetrationRadiusM, wellboreRadiusM, regime, payZoneM,
  reagentColor, perfDensity, autoRotate,
}: {
  wormholeLengthM: number; penetrationRadiusM: number; wellboreRadiusM: number;
  regime: "face" | "wormhole" | "conical" | "compact"; payZoneM: number;
  reagentColor: string; perfDensity: number; autoRotate: boolean;
}) {
  const maxR = Math.max(wormholeLengthM, penetrationRadiusM, wellboreRadiusM * 5, 0.5);
  const scale = 1 / maxR;
  const rw = wellboreRadiusM * scale;
  const rPen = penetrationRadiusM * scale;
  const rWh = wormholeLengthM * scale;
  const h = Math.max(1.2, Math.min(3.5, payZoneM * scale * 0.6 + 1.0));

  const yLevels = useMemo(() => {
    const levels = Math.max(3, Math.min(7, Math.round(payZoneM / 2)));
    const arr: number[] = [];
    for (let i = 0; i < levels; i++) arr.push(-h / 2 + (h / (levels - 1)) * i);
    return arr;
  }, [payZoneM, h]);

  const segs = useMemo(
    () => (rWh > 0 ? generateWormholes(rw, rWh, yLevels, regime) : []),
    [rw, rWh, regime, yLevels],
  );

  // перфорация
  const perfs = useMemo(() => {
    if (perfDensity <= 0 || payZoneM <= 0) return [];
    const total = Math.max(4, Math.min(80, Math.round(perfDensity * payZoneM / 4))); // визуально умеренно
    const phase = [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2];
    const out: { pos: [number, number, number]; rot: [number, number, number] }[] = [];
    for (let i = 0; i < total; i++) {
      const y = -h / 2 + (h * (i + 0.5)) / total;
      const ang = phase[i % 4] + (i * 0.31);
      out.push({
        pos: [Math.cos(ang) * (rw + 0.02), y, Math.sin(ang) * (rw + 0.02)],
        rot: [0, -ang, Math.PI / 2],
      });
    }
    return out;
  }, [perfDensity, payZoneM, rw, h]);

  const rotGroup = useRef<THREE.Group>(null);
  useFrame((_, dt) => { if (autoRotate && rotGroup.current) rotGroup.current.rotation.y += dt * 0.08; });

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[3, 4, 3]} intensity={0.9} />
      <directionalLight position={[-3, -2, -3]} intensity={0.3} />

      <group ref={rotGroup}>
        {/* пласт — большой полупрозрачный цилиндр (порода) */}
        <mesh>
          <cylinderGeometry args={[Math.max(rPen, rWh) * 1.35 + 0.05, Math.max(rPen, rWh) * 1.35 + 0.05, h, 64, 1, true]} />
          <meshStandardMaterial color="#C4A574" roughness={0.95} side={THREE.BackSide} transparent opacity={0.22} />
        </mesh>

        {/* верх/низ пласта (плоскости породы) */}
        <mesh position={[0, h / 2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[rw, Math.max(rPen, rWh) * 1.35 + 0.05, 64]} />
          <meshStandardMaterial color="#8c6d3a" roughness={0.95} side={THREE.DoubleSide} transparent opacity={0.35} />
        </mesh>
        <mesh position={[0, -h / 2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[rw, Math.max(rPen, rWh) * 1.35 + 0.05, 64]} />
          <meshStandardMaterial color="#8c6d3a" roughness={0.95} side={THREE.DoubleSide} transparent opacity={0.35} />
        </mesh>

        {/* зона проникновения реагента */}
        {rPen > rw && (
          <mesh>
            <cylinderGeometry args={[rPen, rPen, h * 0.96, 48]} />
            <meshStandardMaterial color={reagentColor} transparent opacity={0.22} emissive={reagentColor} emissiveIntensity={0.15} />
          </mesh>
        )}

        {/* обсадная колонна */}
        <mesh>
          <cylinderGeometry args={[rw, rw, h * 1.05, 32]} />
          <meshStandardMaterial color="#8a8f95" metalness={0.85} roughness={0.25} />
        </mesh>
        {/* внутренний канал — тёмный */}
        <mesh>
          <cylinderGeometry args={[rw * 0.78, rw * 0.78, h * 1.06, 32]} />
          <meshStandardMaterial color="#15181c" />
        </mesh>

        {/* перфорация */}
        {perfs.map((p, i) => (
          <mesh key={i} position={p.pos} rotation={p.rot}>
            <cylinderGeometry args={[0.012, 0.006, 0.08, 8]} />
            <meshStandardMaterial color="#1a1a1a" emissive={reagentColor} emissiveIntensity={0.4} />
          </mesh>
        ))}

        {/* wormhole */}
        {segs.map((s, i) => <Channel key={i} seg={s} color={reagentColor} />)}
      </group>

      <Text position={[0, h / 2 + 0.18, 0]} fontSize={0.07} color="#cbd5e1" anchorX="center">
        {`r_w=${wellboreRadiusM.toFixed(2)} м · R=${penetrationRadiusM.toFixed(2)} м · L_wh=${wormholeLengthM.toFixed(2)} м · h=${payZoneM.toFixed(1)} м`}
      </Text>

      <OrbitControls enablePan={false} minDistance={1.5} maxDistance={6} target={[0, 0, 0]} />
    </>
  );
}

export default function Wormhole3D({
  wormholeLengthM, penetrationRadiusM, wellboreRadiusM, damkohler = 0.29,
  reservoirHeightM = 10, reagentCategory = "acid", perfDensity = 0,
}: Props) {
  const regime: "face" | "wormhole" | "conical" | "compact" =
    damkohler < 0.1 ? "face"
    : damkohler < 0.5 ? "wormhole"
    : damkohler < 5 ? "conical"
    : "compact";

  const regimeInfo = {
    face:     { label: "Face dissolution", color: "#f59e0b" },
    wormhole: { label: "Wormholing (оптимум)", color: "#10b981" },
    conical:  { label: "Conical / Ramified", color: "#3b82f6" },
    compact:  { label: "Compact dissolution", color: "#ef4444" },
  }[regime];

  const reagentColor = REAGENT_COLORS[reagentCategory] ?? REAGENT_COLORS.acid;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">3D ПЗП — скважина, пласт, зона реагента и wormholes</span>
        <span className="px-2 py-0.5 rounded text-[10px] font-medium"
          style={{ backgroundColor: `${regimeInfo.color}22`, color: regimeInfo.color }}>
          {regimeInfo.label} · Da={damkohler.toFixed(2)}
        </span>
      </div>

      <div className="h-[380px] rounded-lg border border-border bg-gradient-to-b from-slate-900 to-slate-950 overflow-hidden">
        <Canvas camera={{ position: [2.4, 1.5, 2.6], fov: 45 }} dpr={[1, 2]}>
          <Scene
            wormholeLengthM={wormholeLengthM}
            penetrationRadiusM={penetrationRadiusM}
            wellboreRadiusM={wellboreRadiusM}
            regime={regime}
            payZoneM={reservoirHeightM}
            reagentColor={reagentColor}
            perfDensity={perfDensity}
            autoRotate
          />
        </Canvas>
      </div>

      {/* Легенда */}
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground flex-wrap">
        <LegendDot color="#8a8f95" label="обсадная" />
        <LegendDot color="#C4A574" label="пласт" />
        <LegendDot color={reagentColor} label={`зона ${reagentCategory}`} />
        <LegendDot color={reagentColor} label="wormhole / каналы" />
        {perfDensity > 0 && <LegendDot color="#1a1a1a" label="перфорация" />}
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: color }} />
      {label}
    </span>
  );
}
