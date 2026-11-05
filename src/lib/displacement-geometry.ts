import * as THREE from "three";
import type { TrajectoryPoint } from "./cementing-calculations";
/** Положение по траектории (MD → x восток, y вверх, z север), метры. */
export function pathPoints(traj: TrajectoryPoint[], mds: number[]): THREE.Vector3[] {
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
export function frames(pts: THREE.Vector3[]) {
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

