import { useMemo, useState, type RefObject } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Text } from "@react-three/drei";
import * as THREE from "three";
import { Button } from "@/components/ui/button";
import { Crosshair } from "lucide-react";
import { FONT_3D } from "@/lib/three-font";
import { pathPoints, frames } from "@/components/displacement/D2Annulus3D";
import { generateForceDepthProfile, type CTSection, type CTStringData, type CTSurfaceOptions, type FluidData, type ForceResult, type ToolsData, type WellGeometry, type DepthForcePoint } from "@/lib/coiled-tubing-calculations";
import { pipeGeom } from "@/lib/ct-engine";

const C_TENS = new THREE.Color("#3b82f6"), C_COMP = new THREE.Color("#eab308"), C_SIN = new THREE.Color("#f97316"), C_HEL = new THREE.Color("#dc2626");

function stateColor(p: DepthForcePoint | undefined): THREE.Color {
  if (!p || p.axialRIH === null || p.axialRIH === undefined) return C_HEL;
  if (p.axialRIH >= 0) return C_TENS;
  return p.buckleRIH === 2 ? C_HEL : p.buckleRIH === 1 ? C_SIN : C_COMP;
}

/** Трубка вдоль ломаной с цветом по вершинам (рамки — из frames). */
function colorTube(pts: THREE.Vector3[], cols: THREE.Color[], radius: number, radial = 10, N?: THREE.Vector3[], B?: THREE.Vector3[]) {
  const fr = N && B ? { N, B } : frames(pts);
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  for (let j = 0; j < pts.length; j++) for (let m = 0; m <= radial; m++) {
    const a = (m / radial) * Math.PI * 2;
    const p = pts[j].clone().add(fr.N[j].clone().multiplyScalar(radius * Math.cos(a))).add(fr.B[j].clone().multiplyScalar(radius * Math.sin(a)));
    pos.push(p.x, p.y, p.z); col.push(cols[j].r, cols[j].g, cols[j].b);
  }
  for (let j = 0; j < pts.length - 1; j++) for (let m = 0; m < radial; m++) {
    const a = j * (radial + 1) + m, b = a + 1, c = a + radial + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

function interp(prof: DepthForcePoint[], md: number): DepthForcePoint | undefined {
  if (!prof.length) return undefined;
  let lo = 0, hi = prof.length - 1;
  if (md <= prof[0].depth) return prof[0];
  if (md >= prof[hi].depth) return prof[hi];
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (prof[m].depth <= md) lo = m; else hi = m; }
  const a = prof[lo], b = prof[hi], t = (md - a.depth) / Math.max(1e-6, b.depth - a.depth);
  const L = (x: number | null, y: number | null) => (x === null || y === null || x === undefined || y === undefined ? (t < 0.5 ? x : y) : x + (y - x) * t);
  return { depth: md, tvd: a.tvd + (b.tvd - a.tvd) * t, axialRIH: L(a.axialRIH, b.axialRIH) as number, axialPOOH: L(a.axialPOOH, b.axialPOOH) as number, axialStatic: L(a.axialStatic, b.axialStatic) as number, bucklingLimit: L(a.bucklingLimit, b.bucklingLimit) as number, helicalLimit: L(a.helicalLimit, b.helicalLimit) as number, buckleRIH: t < 0.5 ? a.buckleRIH : b.buckleRIH };
}

interface Props {
  ct: CTStringData; well: WellGeometry; fluid: FluidData; tools: ToolsData; sections?: CTSection[]; opts: CTSurfaceOptions;
  friction: number; forces: ForceResult;
  /** зона износа трубы (от нижнего конца), м */
  fatigueHot?: [number, number] | null;
  overviewRef?: RefObject<HTMLDivElement | null>;
  closeupRef?: RefObject<HTMLDivElement | null>;
}

export default function CTBuckling3D({ ct, well, fluid, tools, sections, opts, friction, forces, fatigueHot, overviewRef, closeupRef }: Props) {
  const reach = forces.lockUpDepth > 0 ? Math.floor(forces.lockUpDepth * 0.98) : Math.floor(forces.deployDepth);
  const [bha, setBha] = useState(reach);
  const bhaD = Math.min(bha, reach);
  const prof = useMemo(() => generateForceDepthProfile(ct, well, fluid, tools, friction, 160, sections, opts, Math.max(10, bhaD)), [ct, well, fluid, tools, friction, sections, opts, bhaD]);
  const worst = useMemo(() => prof.reduce((b, p) => ((p.axialRIH ?? 0) < (b.axialRIH ?? 0) ? p : b), prof[0] ?? { depth: bhaD / 2, axialRIH: 0 } as DepthForcePoint), [prof, bhaD]);
  const [center, setCenter] = useState<number | null>(null);
  const win = 30;
  const cMd = Math.min(Math.max(win / 2, center ?? worst?.depth ?? bhaD / 2), Math.max(win / 2, bhaD - 1));

  // ── общий вид ──
  const ov = useMemo(() => {
    const md = well.md;
    const n = 220;
    const mds = Array.from({ length: n + 1 }, (_, i) => (md * i) / n);
    const raw = pathPoints(well.trajectory.length > 1 ? well.trajectory : [{ md: 0, tvd: 0, zenith: 0, azimuth: 0 }, { md, tvd: well.tvd || md, zenith: 0, azimuth: 0 }], mds);
    const box = new THREE.Box3().setFromPoints(raw);
    const size = box.getSize(new THREE.Vector3());
    const s = 10 / Math.max(size.x, size.y, size.z, 1);
    const ctr = box.getCenter(new THREE.Vector3());
    const pts = raw.map((p) => p.clone().sub(ctr).multiplyScalar(s));
    const fr = frames(pts);
    const k = mds.findIndex((m) => m >= bhaD);
    const ctPts = pts.slice(0, Math.max(2, k < 0 ? pts.length : k + 1));
    const ctCols = ctPts.map((_, i) => stateColor(interp(prof, mds[i])));
    const ctGeo = colorTube(ctPts, ctCols, 0.055, 10, fr.N.slice(0, ctPts.length), fr.B.slice(0, ctPts.length));
    const holeCols = pts.map(() => new THREE.Color("#94a3b8"));
    const holeGeo = colorTube(pts, holeCols, 0.16, 14, fr.N, fr.B);
    const at = (m: number) => { const i = Math.min(pts.length - 1, Math.max(0, Math.round((m / md) * n))); return { p: pts[i], n: fr.N[i] }; };
    const marks: { md: number; label: string; color: string }[] = [];
    marks.push({ md: bhaD, label: `КНБК ${Math.round(bhaD)} м`, color: "#e2e8f0" });
    if (forces.lockUpDepth > 0) marks.push({ md: forces.lockUpDepth, label: `запирание ${forces.lockUpDepth} м`, color: "#ef4444" });
    if (forces.pipeLightDepth > 0) marks.push({ md: forces.pipeLightDepth, label: `равновесие ${forces.pipeLightDepth} м`, color: "#c084fc" });
    if (opts.tubingShoeMD && well.tubingID > 0) marks.push({ md: opts.tubingShoeMD, label: `башмак НКТ ${opts.tubingShoeMD} м`, color: "#94a3b8" });
    const ticks: number[] = [];
    const step = md > 3000 ? 500 : md > 1200 ? 250 : 100;
    for (let m = step; m < md; m += step) ticks.push(m);
    // зона износа трубы — где она находится при КНБК на глубине bhaD
    let hot: THREE.BufferGeometry | null = null;
    if (fatigueHot) {
      const a = Math.max(0, bhaD - fatigueHot[1]), b = Math.max(0, bhaD - fatigueHot[0]);
      const i0 = Math.round((a / md) * n), i1 = Math.round((b / md) * n);
      if (i1 > i0) hot = colorTube(pts.slice(i0, i1 + 1), pts.slice(i0, i1 + 1).map(() => new THREE.Color("#d946ef")), 0.2, 14, fr.N.slice(i0, i1 + 1), fr.B.slice(i0, i1 + 1));
    }
    // камера сбоку от горизонтального направления ствола
    const dir = pts[pts.length - 1].clone().sub(pts[0]); dir.y = 0;
    const perp = dir.length() > 0.5 ? new THREE.Vector3(-dir.z, 0, dir.x).normalize() : new THREE.Vector3(0.6, 0, 0.8);
    const cam = perp.multiplyScalar(15).add(new THREE.Vector3(0, 4, 0));
    return { ctGeo, holeGeo, marks: marks.map((m) => ({ ...m, ...at(m.md) })), ticks: ticks.map((m) => ({ m, ...at(m) })), hot, cam, cIdx: at(cMd) };
  }, [well, prof, bhaD, forces, opts.tubingShoeMD, fatigueHot, cMd]);

  // ── вид изнутри: участок ствола ±15 м вокруг выбранной глубины ──
  const cu = useMemo(() => {
    const pg = pipeGeom(ct.od, ct.wall);
    const shoe = opts.tubingShoeMD && opts.tubingShoeMD > 0 ? opts.tubingShoeMD : Infinity;
    const holeMm = well.tubingID > 0 && cMd <= shoe ? well.tubingID : well.casingID;
    const rcReal = Math.max(0.001, (holeMm - ct.od) / 2000);
    const R = 2.2, rPipe = Math.max(0.12, R * (ct.od / holeMm)), rc = R - rPipe;
    const p0 = interp(prof, cMd);
    const traj = well.trajectory.length > 1 ? well.trajectory.slice().sort((a, b) => a.md - b.md) : [];
    let inc = 0;
    for (let i = 1; i < traj.length; i++) if (traj[i].md >= cMd) { const t = (cMd - traj[i - 1].md) / Math.max(1e-6, traj[i].md - traj[i - 1].md); inc = traj[i - 1].zenith + (traj[i].zenith - traj[i - 1].zenith) * t; break; }
    const N = 600;
    const pts: THREE.Vector3[] = [], cols: THREE.Color[] = [];
    let phi = 0, maxContact = 0;
    const contactAt: number[] = [];
    for (let i = 0; i <= N; i++) {
      const sM = -win / 2 + (win * i) / N;
      const p = interp(prof, cMd + sM);
      const c = p && p.axialRIH !== null ? Math.max(0, -p.axialRIH * 1000) : 0;
      const st = p?.buckleRIH ?? 0;
      let y = inc > 3 ? -rc : 0, z = 0;
      if (st === 2 && c > 0) {
        const pitch = Math.PI * Math.sqrt((8 * pg.ei) / c);
        if (i > 0) phi += (2 * Math.PI * (win / N)) / pitch;
        y = -rc * Math.cos(phi); z = rc * Math.sin(phi);
        contactAt.push((rcReal * c * c) / (4 * pg.ei));
      } else if (st === 1 && c > 0) {
        const lam = 2 * Math.PI * Math.sqrt((2 * pg.ei) / c);
        if (i > 0) phi += (2 * Math.PI * (win / N)) / lam;
        const fs = Math.abs((p?.bucklingLimit ?? 0) * 1000), fh = Math.abs((p?.helicalLimit ?? 0) * 1000);
        const th = (Math.PI / 2) * Math.min(1, Math.max(0.2, fh > fs ? (c - fs) / (fh - fs) : 0.5));
        const ang = th * Math.sin(phi);
        y = -rc * Math.cos(ang); z = rc * Math.sin(ang);
        contactAt.push((rcReal * c * c) / (8 * pg.ei));
      } else contactAt.push(0);
      maxContact = Math.max(maxContact, contactAt[contactAt.length - 1]);
      pts.push(new THREE.Vector3(sM, y, z));
    }
    for (let i = 0; i <= N; i++) {
      const p = interp(prof, cMd - win / 2 + (win * i) / N);
      const base = stateColor(p);
      cols.push(base.clone().lerp(new THREE.Color("#7f1d1d"), maxContact > 0 ? Math.min(0.6, contactAt[i] / maxContact * 0.6) : 0));
    }
    // рамки для трубки вдоль ломаной: N — «вверх» (+y), B — вдоль z, с проекцией
    const T = pts.map((_, i) => pts[Math.min(N, i + 1)].clone().sub(pts[Math.max(0, i - 1)]).normalize());
    const Nn = T.map((t) => { const u = new THREE.Vector3(0, 1, 0); return u.sub(t.clone().multiplyScalar(u.dot(t))).normalize(); });
    const Bn = T.map((t, i) => new THREE.Vector3().crossVectors(t, Nn[i]).normalize());
    const geo = colorTube(pts, cols, rPipe, 12, Nn, Bn);
    const c = p0 && p0.axialRIH !== null ? -p0.axialRIH : 0;
    const st = p0?.buckleRIH ?? 0;
    const pitch = st === 2 && c > 0 ? Math.PI * Math.sqrt((8 * pg.ei) / (c * 1000)) : st === 1 && c > 0 ? 2 * Math.PI * Math.sqrt((2 * pg.ei) / (c * 1000)) : null;
    const contact = st === 2 ? (rcReal * (c * 1000) ** 2) / (4 * pg.ei) : st === 1 ? (rcReal * (c * 1000) ** 2) / (8 * pg.ei) : 0;
    const stateLabel = !p0 || p0.axialRIH === null ? "—" : p0.axialRIH >= 0 ? "растяжение" : st === 2 ? "спиральный изгиб" : st === 1 ? "синусоидальный изгиб" : "сжатие без изгиба";
    return { geo, R, inc, info: { axial: p0?.axialRIH ?? null, stateLabel, pitch, contact, holeMm } };
  }, [ct, well, prof, cMd, opts.tubingShoeMD]);

  const caseGeo = useMemo(() => {
    const g = new THREE.CylinderGeometry(cu.R, cu.R, win, 48, 1, true, Math.PI * 0.15, Math.PI * 1.35);
    g.rotateZ(Math.PI / 2);
    return g;
  }, [cu.R]);
  const f1 = (v: number | null, d = 1) => (v === null || !Number.isFinite(v) ? "—" : v.toFixed(d));

  return (
    <div className="space-y-3 text-xs">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 flex-1 min-w-[220px]"><span className="whitespace-nowrap">КНБК при спуске: <b>{Math.round(bhaD)} м</b></span>
          <input type="range" min={50} max={reach} step={10} value={bhaD} onChange={(e) => { setBha(+e.target.value); setCenter(null); }} className="flex-1 accent-[hsl(var(--primary))]" aria-label="Глубина КНБК" data-testid="ct3d-bha" /></label>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {[["#3b82f6", "растяжение"], ["#eab308", "сжатие"], ["#f97316", "синусоидальный изгиб"], ["#dc2626", "спиральный изгиб"], ...(fatigueHot ? [["#d946ef", "изношенный участок трубы"]] : [])].map(([c, l]) => <span key={l} className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: c }} />{l}</span>)}
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <div>
          <p className="text-[11px] font-semibold mb-1">Ствол и ГНКТ при спуске: состояние трубы по глубине</p>
          <div ref={overviewRef} className="h-[460px] rounded-md overflow-hidden bg-[#0f172a]">
            <Canvas camera={{ position: [ov.cam.x, ov.cam.y, ov.cam.z], fov: 42 }} gl={{ preserveDrawingBuffer: true }}>
              <color attach="background" args={["#0f172a"]} />
              <ambientLight intensity={0.8} /><directionalLight position={[6, 10, 6]} intensity={0.9} />
              <mesh geometry={ov.holeGeo}><meshStandardMaterial vertexColors transparent opacity={0.18} depthWrite={false} side={THREE.DoubleSide} /></mesh>
              {ov.hot && <mesh geometry={ov.hot}><meshStandardMaterial vertexColors transparent opacity={0.45} depthWrite={false} /></mesh>}
              <mesh geometry={ov.ctGeo}><meshStandardMaterial vertexColors roughness={0.45} metalness={0.25} /></mesh>
              {ov.ticks.map((t) => <Text key={t.m} font={FONT_3D} position={t.p.clone().add(t.n.clone().multiplyScalar(0.45)).toArray()} fontSize={0.22} color="#64748b" anchorX="center">{`${t.m} м`}</Text>)}
              {ov.marks.map((m) => (
                <group key={m.label}>
                  <mesh position={m.p.toArray()}><sphereGeometry args={[0.13, 16, 16]} /><meshStandardMaterial color={m.color} emissive={m.color} emissiveIntensity={0.5} /></mesh>
                  <Text font={FONT_3D} position={m.p.clone().add(m.n.clone().multiplyScalar(0.75)).toArray()} fontSize={0.28} color={m.color} anchorX="center">{m.label}</Text>
                </group>
              ))}
              <mesh position={ov.cIdx.p.toArray()}><torusGeometry args={[0.3, 0.04, 8, 24]} /><meshBasicMaterial color="#22d3ee" /></mesh>
              <OrbitControls enableDamping={false} />
            </Canvas>
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1 gap-2">
            <p className="text-[11px] font-semibold">Внутри ствола: {Math.round(cMd - win / 2)}–{Math.round(cMd + win / 2)} м (радиальный масштаб увеличен)</p>
            <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => setCenter(worst?.depth ?? null)}><Crosshair className="w-3 h-3 mr-1" />к худшей точке</Button>
          </div>
          <div ref={closeupRef} className="h-[460px] rounded-md overflow-hidden bg-[#0b1220]">
            <Canvas camera={{ position: [0, 9, 30], fov: 42 }} gl={{ preserveDrawingBuffer: true }}>
              <color attach="background" args={["#0b1220"]} />
              <ambientLight intensity={0.7} /><directionalLight position={[4, 8, 10]} intensity={1} /><directionalLight position={[-6, -4, -4]} intensity={0.3} />
              <group>
                <mesh geometry={caseGeo}><meshStandardMaterial color="#9ca3af" metalness={0.55} roughness={0.4} transparent opacity={0.35} side={THREE.DoubleSide} depthWrite={false} /></mesh>
                <mesh geometry={cu.geo}><meshStandardMaterial vertexColors roughness={0.35} metalness={0.4} /></mesh>
                <Text font={FONT_3D} position={[-win / 2 + 1, -cu.R - 0.7, 0]} fontSize={0.6} color="#94a3b8" anchorX="left">{`${cu.inc > 3 ? "▼ нижняя стенка · " : ""}${Math.round(cMd - win / 2)} м`}</Text>
                <Text font={FONT_3D} position={[win / 2 - 1, -cu.R - 0.7, 0]} fontSize={0.6} color="#94a3b8" anchorX="right">{`${Math.round(cMd + win / 2)} м → к забою`}</Text>
              </group>
              <OrbitControls enableDamping={false} />
            </Canvas>
          </div>
          <input type="range" min={win / 2} max={Math.max(win / 2 + 1, bhaD - 1)} step={5} value={cMd} onChange={(e) => setCenter(+e.target.value)} className="w-full mt-1 accent-[hsl(var(--primary))]" aria-label="Глубина участка" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-1">
            {[
              ["Глубина (центр)", `${Math.round(cMd)} м`, `зенит ${f1(cu.inc, 0)}°, Ø ствола ${cu.info.holeMm} мм`],
              ["Осевая сила", cu.info.axial === null ? "—" : `${f1(cu.info.axial)} кН`, cu.info.stateLabel],
              ["Шаг спирали / волны", cu.info.pitch ? `${f1(cu.info.pitch)} м` : "—", cu.info.pitch ? "чем сильнее сжатие, тем шаг короче" : "изгиба нет"],
              ["Прижатие к стенке от изгиба", cu.info.contact ? `${f1(cu.info.contact, 0)} Н/м` : "—", "добавляется к трению"],
            ].map(([n, v, s]) => <div key={n} className="rounded-md border border-border/60 p-2"><p className="text-[10px] text-muted-foreground">{n}</p><p className="text-sm font-semibold">{v}</p><p className="text-[10px] text-muted-foreground">{s}</p></div>)}
          </div>
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Слева — весь ствол: цвет ГНКТ показывает состояние трубы при спуске КНБК на выбранную глубину (из расчёта сил), отмечены запирание, глубина равновесия, башмак НКТ и
        изношенный по журналу участок трубы. Справа — вид внутри ствола на участке 30 м (голубое кольцо слева): форма трубы по расчёту — прямо на нижней стенке, синусоида или спираль
        с шагом π·√(8EI/F); потемнение — рост прижатия к стенке. Радиальный зазор увеличен для наглядности.
      </p>
    </div>
  );
}
