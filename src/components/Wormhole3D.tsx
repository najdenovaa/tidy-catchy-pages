import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Text } from "@react-three/drei";
import * as THREE from "three";

interface Props {
  /** Длина wormhole, м */
  wormholeLengthM: number;
  /** Радиус проникновения раствора (без wormhole), м */
  penetrationRadiusM: number;
  /** Радиус скважины, м */
  wellboreRadiusM: number;
  /** Число Дамкёлера */
  damkohler?: number;
  /** Высота интервала перфорации, м (для масштаба цилиндра пласта) */
  reservoirHeightM?: number;
}

/** Цвет канала по нормализованной длине проникновения (0..1) */
function channelColor(t: number): THREE.Color {
  // зелёный → жёлтый → красный
  const c = new THREE.Color();
  c.setHSL((1 - t) * 0.33, 0.85, 0.5);
  return c;
}

/** Регенерация ветвящихся wormhole-каналов */
type Seg = {
  start: THREE.Vector3;
  end: THREE.Vector3;
  thickness: number;
  reach: number; // 0..1
};

function generateBranches(
  rw: number,
  maxLen: number,
  count: number,
  regime: "face" | "wormhole" | "conical" | "compact",
): Seg[] {
  const segs: Seg[] = [];
  // PRNG детерминированный
  let seed = 1337;
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  const cfg = {
    face:     { lenMin: 0.15, lenMax: 0.35, branch: 0.0, thick: 0.025 },
    wormhole: { lenMin: 0.7,  lenMax: 1.0,  branch: 0.25, thick: 0.012 },
    conical:  { lenMin: 0.45, lenMax: 0.85, branch: 0.55, thick: 0.018 },
    compact:  { lenMin: 0.1,  lenMax: 0.25, branch: 0.1,  thick: 0.022 },
  }[regime];

  for (let i = 0; i < count; i++) {
    // равномерно по сфере (направление в пласт)
    const u = rnd();
    const v = rnd();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);
    const dir = new THREE.Vector3(
      Math.sin(phi) * Math.cos(theta),
      Math.cos(phi) * 0.4, // сплющиваем вертикально (в пласт идёт радиально)
      Math.sin(phi) * Math.sin(theta),
    ).normalize();

    const len = maxLen * (cfg.lenMin + (cfg.lenMax - cfg.lenMin) * rnd());
    const start = dir.clone().multiplyScalar(rw);
    let end = dir.clone().multiplyScalar(rw + len);
    segs.push({ start, end, thickness: cfg.thick, reach: len / maxLen });

    // ветвления
    if (cfg.branch > 0 && rnd() < cfg.branch) {
      const nBranch = 1 + Math.floor(rnd() * 2);
      for (let b = 0; b < nBranch; b++) {
        const tBranch = 0.4 + rnd() * 0.5;
        const branchStart = start.clone().lerp(end, tBranch);
        const perturb = new THREE.Vector3(
          (rnd() - 0.5) * 0.7,
          (rnd() - 0.5) * 0.3,
          (rnd() - 0.5) * 0.7,
        );
        const branchDir = dir.clone().add(perturb).normalize();
        const branchLen = len * (0.25 + rnd() * 0.4);
        const branchEnd = branchStart.clone().add(branchDir.multiplyScalar(branchLen));
        segs.push({
          start: branchStart,
          end: branchEnd,
          thickness: cfg.thick * 0.6,
          reach: (branchStart.length() - rw + branchLen) / maxLen,
        });
      }
    }
  }
  return segs;
}

function Channel({ seg }: { seg: Seg }) {
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
  const color = useMemo(() => channelColor(Math.min(1, seg.reach)), [seg.reach]);
  return (
    <mesh geometry={geom}>
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.35} roughness={0.4} />
    </mesh>
  );
}

function Reservoir({ rOuter, height }: { rOuter: number; height: number }) {
  return (
    <mesh>
      <cylinderGeometry args={[rOuter, rOuter, height, 64, 1, true]} />
      <meshStandardMaterial
        color="#6b4d2b"
        roughness={0.95}
        side={THREE.BackSide}
        transparent
        opacity={0.18}
      />
    </mesh>
  );
}

function PenetrationZone({ rPen, height }: { rPen: number; height: number }) {
  if (rPen <= 0) return null;
  return (
    <mesh>
      <cylinderGeometry args={[rPen, rPen, height * 0.96, 64, 1, true]} />
      <meshStandardMaterial color="#3b82f6" transparent opacity={0.08} side={THREE.DoubleSide} />
    </mesh>
  );
}

function Wellbore({ rw, height }: { rw: number; height: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.05;
  });
  return (
    <mesh ref={ref}>
      <cylinderGeometry args={[rw, rw, height, 32]} />
      <meshStandardMaterial color="#2a2f35" metalness={0.7} roughness={0.3} />
    </mesh>
  );
}

function Scene({
  wormholeLengthM, penetrationRadiusM, wellboreRadiusM, regime, height,
}: {
  wormholeLengthM: number;
  penetrationRadiusM: number;
  wellboreRadiusM: number;
  regime: "face" | "wormhole" | "conical" | "compact";
  height: number;
}) {
  const maxR = Math.max(wormholeLengthM, penetrationRadiusM, wellboreRadiusM * 5, 0.5);
  // нормируем сцену: масштаб 1 unit = maxR
  const scale = 1 / maxR;
  const rw = wellboreRadiusM * scale;
  const rPen = penetrationRadiusM * scale;
  const rWh = wormholeLengthM * scale;
  const h = Math.min(2.5, height * 0.02) + 1.2;

  const segs = useMemo(
    () => (rWh > 0 ? generateBranches(rw, rWh, 18, regime) : []),
    [rw, rWh, regime],
  );

  // Распределяем каналы по высоте (несколько слоёв)
  const layers = 5;
  const allSegs: Seg[] = useMemo(() => {
    const out: Seg[] = [];
    for (let l = 0; l < layers; l++) {
      const y = -h / 2 + (h / (layers - 1)) * l;
      for (const s of segs) {
        out.push({
          start: new THREE.Vector3(s.start.x, y + s.start.y * 0.1, s.start.z),
          end: new THREE.Vector3(s.end.x, y + s.end.y * 0.1, s.end.z),
          thickness: s.thickness,
          reach: s.reach,
        });
      }
    }
    return out;
  }, [segs, h]);

  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[3, 4, 3]} intensity={0.8} />
      <directionalLight position={[-3, -2, -3]} intensity={0.3} />

      <Reservoir rOuter={1.0} height={h} />
      <PenetrationZone rPen={rPen} height={h} />
      <Wellbore rw={rw} height={h} />

      {allSegs.map((s, i) => <Channel key={i} seg={s} />)}

      {/* Подписи радиусов */}
      <Text position={[0, h / 2 + 0.12, 0]} fontSize={0.06} color="#cbd5e1" anchorX="center">
        {`r_w=${wellboreRadiusM.toFixed(2)} м · R_пр=${penetrationRadiusM.toFixed(2)} м · L_wh=${wormholeLengthM.toFixed(2)} м`}
      </Text>

      <OrbitControls enablePan={false} minDistance={1.6} maxDistance={5} target={[0, 0, 0]} />
    </>
  );
}

export default function Wormhole3D({
  wormholeLengthM, penetrationRadiusM, wellboreRadiusM, damkohler = 0.29, reservoirHeightM = 10,
}: Props) {
  const regime: "face" | "wormhole" | "conical" | "compact" =
    damkohler < 0.1 ? "face"
    : damkohler < 0.5 ? "wormhole"
    : damkohler < 5 ? "conical"
    : "compact";

  const regimeInfo = {
    face:     { label: "Face dissolution", color: "#f59e0b", note: "Расход слишком высокий — кислота смывается, ПЗП «изъедается»" },
    wormhole: { label: "Wormholing (оптимум)", color: "#10b981", note: "Da ≈ 0.29 — максимальное проникновение wormhole" },
    conical:  { label: "Conical / Ramified", color: "#3b82f6", note: "Расход умеренно низкий — ветвистые каналы" },
    compact:  { label: "Compact dissolution", color: "#ef4444", note: "Расход слишком низкий — кислота расходуется у стенки" },
  }[regime];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">3D ПЗП — wormhole-каналы</span>
        <span
          className="px-2 py-0.5 rounded text-[10px] font-medium"
          style={{ backgroundColor: `${regimeInfo.color}22`, color: regimeInfo.color }}
        >
          {regimeInfo.label} · Da={damkohler.toFixed(2)}
        </span>
      </div>

      <div className="h-[360px] rounded-lg border border-border bg-gradient-to-b from-slate-900 to-slate-950 overflow-hidden">
        <Canvas camera={{ position: [2.2, 1.4, 2.4], fov: 45 }} dpr={[1, 2]}>
          <Scene
            wormholeLengthM={wormholeLengthM}
            penetrationRadiusM={penetrationRadiusM}
            wellboreRadiusM={wellboreRadiusM}
            regime={regime}
            height={reservoirHeightM}
          />
        </Canvas>
      </div>

      {/* Цветовая легенда */}
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
        <span>Проникновение:</span>
        <div className="flex-1 h-2 rounded" style={{
          background: "linear-gradient(to right, #ef4444 0%, #f59e0b 50%, #10b981 100%)",
        }} />
        <span>0 → L_wh</span>
      </div>
      <p className="text-[11px] text-muted-foreground">{regimeInfo.note}</p>
    </div>
  );
}
