import { useEffect, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Text } from "@react-three/drei";
import * as THREE from "three";
import type { D2Result } from "@/lib/displacement-2d";
import type { TrajectoryPoint } from "@/lib/cementing-calculations";
import { FONT_3D } from "@/lib/three-font";
import { makeBlender, thetaIndex } from "./d2-shared";

const SEG = 72;
/** Вырез: убрать четверть окружности сбоку, чтобы видеть колонну и обе стороны (верх и низ) */
const CUT0 = Math.PI * 0.32, CUT1 = Math.PI * 0.68;

/** Положение по траектории (MD → x восток, y вверх, z север), метры. */
function pathPoints(traj: TrajectoryPoint[], mds: number[]): THREE.Vector3[] {
  const t = traj.length > 1 ? traj.slice().sort((a, b) => a.md - b.md) : [{ md: 0, zenith: 0, azimuth: 0, tvd: 0 }, { md: 1e5, zenith: 0, azimuth: 0, tvd: 1e5 }];
  const out: THREE.Vector3[] = [];
  let x = 0, y = 0, z = 0, md = t[0].md, idx = 0;
  const angAt = (m: number) => {
    while (idx < t.length - 2 && t[idx + 1].md < m) idx++;
    const a = t[idx], b = t[Math.min(t.length - 1, idx + 1)];
    const f = b.md > a.md ? Math.min(1, Math.max(0, (m - a.md) / (b.md - a.md))) : 0;
    return { inc: ((a.zenith + (b.zenith - a.zenith) * f) * Math.PI) / 180, az: ((a.azimuth + (b.azimuth - a.azimuth) * f) * Math.PI) / 180 };
  };
  for (const target of mds) {
    while (md < target - 1e-6) {
      const step = Math.min(5, target - md);
      const { inc, az } = angAt(md + step / 2);
      x += Math.sin(inc) * Math.sin(az) * step; z += Math.sin(inc) * Math.cos(az) * step; y -= Math.cos(inc) * step;
      md += step;
    }
    out.push(new THREE.Vector3(x, y, z));
  }
  return out;
}

/** Кольца вдоль пути с ориентацией «0° = верхняя сторона ствола». */
function frames(pts: THREE.Vector3[]) {
  const up = new THREE.Vector3(0, 1, 0);
  const T: THREE.Vector3[] = [], Nn: THREE.Vector3[] = [], B: THREE.Vector3[] = [];
  let prevN = new THREE.Vector3(1, 0, 0);
  for (let j = 0; j < pts.length; j++) {
    const a = pts[Math.max(0, j - 1)], b = pts[Math.min(pts.length - 1, j + 1)];
    const t = b.clone().sub(a).normalize();
    const n = up.clone().sub(t.clone().multiplyScalar(up.dot(t)));
    if (n.length() > 0.08) n.normalize(); else { n.copy(prevN).sub(t.clone().multiplyScalar(prevN.dot(t))).normalize(); }
    prevN = n;
    T.push(t); Nn.push(n); B.push(new THREE.Vector3().crossVectors(t, n).normalize());
  }
  return { T, N: Nn, B };
}

function shellGeometry(pts: THREE.Vector3[], fr: ReturnType<typeof frames>, R: number, cut: boolean, uvs: boolean, shift?: (j: number) => number) {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const nZ = pts.length - 1;
  for (let j = 0; j <= nZ; j++) for (let m = 0; m <= SEG; m++) {
    const a = (m / SEG) * 2 * Math.PI;
    const off = shift ? shift(j) : 0; // смещение центра к нижней стенке
    const p = pts[j].clone().add(fr.N[j].clone().multiplyScalar(R * Math.cos(a) - off)).add(fr.B[j].clone().multiplyScalar(R * Math.sin(a)));
    pos.push(p.x, p.y, p.z);
    if (uvs) uv.push(j / nZ, m / SEG);
  }
  for (let j = 0; j < nZ; j++) for (let m = 0; m < SEG; m++) {
    const ac = ((m + 0.5) / SEG) * 2 * Math.PI;
    if (cut && ac > CUT0 && ac < CUT1) continue;
    const a = j * (SEG + 1) + m, b = a + 1, c = a + SEG + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  if (uvs) g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export default function D2Annulus3D({ res, colors, snap, trajectory, cut, height = 520 }: {
  res: D2Result; colors: string[]; snap: number; trajectory: TrajectoryPoint[]; cut: boolean; height?: number;
}) {
  const geo = useMemo(() => {
    const dz = (res.zCenters[1] ?? res.zCenters[0] + 1) - res.zCenters[0];
    const mds = Array.from({ length: res.nZ + 1 }, (_, j) => res.zCenters[0] - dz / 2 + j * dz);
    const raw = pathPoints(trajectory, mds);
    const o = raw[0].clone();
    const L = mds[mds.length - 1] - mds[0];
    const s = 10 / Math.max(1, L);
    const pts = raw.map((p) => p.sub(o).multiplyScalar(s));
    const fr = frames(pts);
    const Rh = 0.85, Rc = 0.5;
    const shell = shellGeometry(pts, fr, Rh, cut, true);
    const soAt = (j: number) => res.rows[Math.min(res.rows.length - 1, Math.max(0, j - (j === res.nZ ? 1 : 0)))]?.standoff ?? 1;
    const casing = shellGeometry(pts, fr, Rc, false, false, (j) => (1 - soAt(j)) * (Rh - Rc) * 0.95);
    // метки глубин
    const marks: { p: THREE.Vector3; label: string }[] = [];
    const step = L > 1500 ? 500 : L > 600 ? 200 : 100;
    for (let j = 0; j <= res.nZ; j++) {
      const md = mds[j];
      if (j === 0 || j === res.nZ || Math.floor(md / step) !== Math.floor(mds[Math.max(0, j - 1)] / step)) {
        marks.push({ p: pts[j].clone().add(fr.N[j].clone().multiplyScalar(1.6)), label: `${Math.round(md)} м` });
      }
    }
    // «низ ствола» — подпись у узкой стороны в середине
    const jm = Math.floor(res.nZ / 2);
    const low = pts[jm].clone().add(fr.N[jm].clone().multiplyScalar(-1.7)).add(fr.B[jm].clone().multiplyScalar(0.4));
    const center = pts[jm].clone();
    const span = pts[0].distanceTo(pts[pts.length - 1]);
    // камера со стороны выреза (+B), чуть сверху
    const d = Math.max(8, span * 1.45);
    const cam = center.clone().add(fr.B[jm].clone().multiplyScalar(d)).add(fr.N[jm].clone().multiplyScalar(d * 0.25));
    return { shell, casing, marks, low, center, span, cam };
  }, [res, trajectory, cut]);

  // Текстура развёртки: x — глубина, y — угол по окружности
  const tex = useMemo(() => {
    const cnv = document.createElement("canvas");
    cnv.width = res.nZ; cnv.height = 2 * res.nTheta * 2;
    const t = new THREE.CanvasTexture(cnv);
    t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.LinearFilter;
    return t;
  }, [res]);
  const blend = useMemo(() => makeBlender(res, colors), [res, colors]);
  useEffect(() => {
    const cnv = tex.image as HTMLCanvasElement;
    const ctx = cnv.getContext("2d")!;
    const W = cnv.width, H = cnv.height;
    const img = ctx.createImageData(W, H);
    const fr = res.snapshots[Math.min(snap, res.snapshots.length - 1)].frac;
    for (let y = 0; y < H; y++) {
      const a = ((y + 0.5) / H) * 2 * Math.PI;
      const i = thetaIndex(a, res.nTheta, res.full);
      for (let x = 0; x < W; x++) blend(fr, x * res.nTheta + i, img.data, (y * W + x) * 4);
    }
    ctx.putImageData(img, 0, 0);
    tex.needsUpdate = true;
  }, [snap, res, tex, blend]);
  useEffect(() => () => { tex.dispose(); geo.shell.dispose(); geo.casing.dispose(); }, [tex, geo]);

  return (
    <div style={{ height }} className="w-full rounded-md overflow-hidden bg-[#0f172a]">
      <Canvas key={res.nZ} camera={{ position: [geo.cam.x, geo.cam.y, geo.cam.z], fov: 40 }} gl={{ preserveDrawingBuffer: true }}>
        <color attach="background" args={["#0f172a"]} />
        <ambientLight intensity={0.75} />
        <directionalLight position={[5, 8, 6]} intensity={0.9} />
        <directionalLight position={[-6, -3, -4]} intensity={0.35} />
        <mesh geometry={geo.shell}>
          <meshStandardMaterial map={tex} side={THREE.DoubleSide} roughness={0.75} metalness={0.05} />
        </mesh>
        <mesh geometry={geo.casing}>
          <meshStandardMaterial color="#b8bec6" roughness={0.35} metalness={0.6} />
        </mesh>
        {geo.marks.map((m, i) => (
          <Text key={i} font={FONT_3D} position={[m.p.x, m.p.y, m.p.z]} fontSize={0.3} color="#cbd5e1" anchorX="center" anchorY="middle">{m.label}</Text>
        ))}
        <Text font={FONT_3D} position={[geo.low.x, geo.low.y, geo.low.z]} fontSize={0.24} color="#fca5a5" anchorX="center">▼ низ ствола — узкий зазор</Text>
        <OrbitControls target={[geo.center.x, geo.center.y, geo.center.z]} enableDamping dampingFactor={0.1} />
      </Canvas>
    </div>
  );
}
