import { useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Text } from "@react-three/drei";
import * as THREE from "three";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pause, Play, RotateCcw, Scan } from "lucide-react";
import type { RirInputs, RirResult } from "@/lib/rir-calculations";
import type { CompositionDesign } from "@/lib/rir-compositions";
import type { SqueezePoint, SqueezeSimResult } from "@/lib/rir-squeeze-sim";
import { FONT_3D } from "@/lib/three-font";

/**
 * РИР: 3D-вид нарушения «как в скважине» — колонна с дефектом (трещина / муфта / перфорация),
 * цементный камень, порода, трещина от нарушения в камень и пласт; ход закачки по времени из
 * моделирования задавливания: пачка состава в НКТ, заполнение под инструментом, уход в трещину
 * (площадь заполнения ∝ объёму состава в канале), загустевание (состав темнеет).
 */

const COL = { water: "#3b82f6", well: "#93c5fd", resin: "#f59e0b", micro: "#d0a457", cement: "#b9bec6", crack: "#111827" };
const R = { cIn: 0.72, cOut: 0.82, hole: 1.3, rock: 5.8, tub: 0.27, frac: 5.4, outerIn: 1.55, outerOut: 1.68 };

/** Процедурная текстура породы / камня: шум и слоистость. */
function noiseTexture(base: string, kind: "rock" | "cement") {
  const c = document.createElement("canvas"); c.width = 256; c.height = 256;
  const ctx = c.getContext("2d")!, img = ctx.createImageData(256, 256);
  const b = [parseInt(base.slice(1, 3), 16), parseInt(base.slice(3, 5), 16), parseInt(base.slice(5, 7), 16)];
  let sd = kind === "rock" ? 7 : 3;
  const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < 256; y++) {
    const layer = kind === "rock" ? 0.12 * Math.sin(y * 0.18) + 0.08 * Math.sin(y * 0.047 + 1.3) : 0;
    for (let x = 0; x < 256; x++) {
      const n = (rnd() - 0.5) * (kind === "rock" ? 0.35 : 0.22) + layer;
      const k = (y * 256 + x) * 4;
      img.data[k] = Math.max(0, Math.min(255, b[0] * (1 + n))); img.data[k + 1] = Math.max(0, Math.min(255, b[1] * (1 + n))); img.data[k + 2] = Math.max(0, Math.min(255, b[2] * (1 + n))); img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 6); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function sectorSolid(r0: number, r1: number, y0: number, y1: number, phi0: number, phi1: number, seg = 48) {
  // кольцевой сектор: внутренняя и наружная поверхности, торцы сверху/снизу и два среза
  const pos: number[] = [], idx: number[] = [], uvs: number[] = [];
  const v = (x: number, y: number, z: number) => { pos.push(x, y, z); uvs.push(Math.atan2(z, x) / (2 * Math.PI) + 0.5 + Math.hypot(x, z) * 0.15, (y - y0) / Math.max(1e-6, y1 - y0)); return pos.length / 3 - 1; };
  const P = (r: number, y: number, ph: number) => [r * Math.cos(ph), y, r * Math.sin(ph)] as const;
  const quad = (a: number, b: number, c: number, d: number) => idx.push(a, b, c, a, c, d);
  for (let i = 0; i < seg; i++) {
    const a0 = phi0 + ((phi1 - phi0) * i) / seg, a1 = phi0 + ((phi1 - phi0) * (i + 1)) / seg;
    for (const [r, flip] of [[r0, true], [r1, false]] as const) {
      const A = v(...P(r, y0, a0)), B = v(...P(r, y0, a1)), Cc = v(...P(r, y1, a1)), D = v(...P(r, y1, a0));
      if (flip) quad(A, D, Cc, B); else quad(A, B, Cc, D);
    }
    for (const [y, flip] of [[y0, false], [y1, true]] as const) {
      const A = v(...P(r0, y, a0)), B = v(...P(r1, y, a0)), Cc = v(...P(r1, y, a1)), D = v(...P(r0, y, a1));
      if (flip) quad(A, B, Cc, D); else quad(A, D, Cc, B);
    }
  }
  for (const ph of [phi0, phi1]) {
    const A = v(...P(r0, y0, ph)), B = v(...P(r1, y0, ph)), Cc = v(...P(r1, y1, ph)), D = v(...P(r0, y1, ph));
    quad(A, B, Cc, D);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

/** Плоское крыло трещины по азимуту phi: r от r0 до r1, y от y0 до y1, с UV. */
function wing(phi: number, r0: number, r1: number, y0: number, y1: number) {
  const g = new THREE.PlaneGeometry(1, 1, 1, 1);
  const p = g.attributes.position as THREE.BufferAttribute;
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const u = uv.getX(i), vv = uv.getY(i);
    const r = r0 + (r1 - r0) * u, y = y0 + (y1 - y0) * vv;
    p.setXYZ(i, r * Math.cos(phi), y, r * Math.sin(phi));
  }
  g.computeVertexNormals();
  return g;
}

/** Изогнутая полоса (канал в камне) на радиусе r: угол phi0…phi1, высота y0…y1; u — по углу, v — по высоте. */
function band(r: number, phi0: number, phi1: number, y0: number, y1: number, seg = 32) {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= seg; i++) for (let k = 0; k <= 1; k++) {
    const ph = phi0 + ((phi1 - phi0) * i) / seg;
    pos.push(r * Math.cos(ph), k ? y1 : y0, r * Math.sin(ph)); uv.push(i / seg, k);
  }
  for (let i = 0; i < seg; i++) { const a = i * 2, b = a + 1, c = a + 2, d = a + 3; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

/** Горизонтальное кольцо (трещина по муфте): r от r0 до r1, без сектора выреза. */
function ringDisc(y: number, r0: number, r1: number, phi0: number, phi1: number, seg = 96) {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= seg; i++) for (let k = 0; k <= 1; k++) {
    const ph = phi0 + ((phi1 - phi0) * i) / seg, r = k ? r1 : r0;
    pos.push(r * Math.cos(ph), y, r * Math.sin(ph)); uv.push(k, i / seg);
  }
  for (let i = 0; i < seg; i++) { const a = i * 2, b = a + 1, c = a + 2, d = a + 3; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

/** Контур трещины с неровным краем и заполнение составом от точки нарушения. */
function paintFracture(cnv: HTMLCanvasElement, o: { fill: number; water: number; comp: string; gel: number; radial: boolean; seed: number; vAspect: number }) {
  const W = cnv.width, H = cnv.height, ctx = cnv.getContext("2d")!;
  const img = ctx.createImageData(W, H);
  const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const cc = hex(o.comp), cw = hex(COL.water), ck = hex(COL.crack);
  const dark = 1 - 0.45 * o.gel;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    let d: number, ang: number;
    if (o.radial) { // u — радиус, v — угол (кольцо по муфте): заполнение от колонны наружу
      const u = (i + 0.5) / W; d = u; ang = ((j + 0.5) / H) * 2 * Math.PI;
    } else { // u — от колонны в породу, v — по высоте (нарушение по центру)
      const u = (i + 0.5) / W, vv = ((j + 0.5) / H - 0.5) * 2 * o.vAspect;
      d = Math.sqrt(u * u + vv * vv); ang = Math.atan2(vv, u);
    }
    const edge = 1 + 0.09 * Math.sin(3 * ang + o.seed) + 0.05 * Math.sin(7 * ang + 2 * o.seed) + 0.025 * Math.sin(17 * ang + o.seed * 3);
    const k = (j * W + i) * 4;
    if (d > edge * 0.97) { img.data[k + 3] = 0; continue; }
    const rough = 1 + 0.06 * Math.sin(5 * ang + o.seed * 1.7) + 0.03 * Math.sin(11 * ang);
    let c = ck, a = 200;
    if (d < o.fill * edge * rough) { c = cc.map((x) => x * dark) as number[]; a = 255; }
    else if (d < o.water * edge * rough) { c = cw; a = 215; }
    img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = a;
  }
  ctx.putImageData(img, 0, 0);
}

interface Layout {
  sy: number; mdMid: number; y: (md: number) => number; yTop: number; yBot: number;
  leakY0: number; leakY1: number; toolY: number | null; toolAbove: number; phiF: number; camPhi: number;
}

function Scene({ inp, res, p, end, compColor, kind, L }: { inp: RirInputs; res: RirResult; p: SqueezePoint; end: SqueezePoint; compColor: string; kind: RirInputs["leak"]["kind"]; L: Layout }) {
  const cut0 = L.camPhi - 0.85, cut1 = L.camPhi + 0.85;
  const geo = useMemo(() => {
    const full = (r0: number, r1: number, y0: number, y1: number) => sectorSolid(r0, r1, y0, y1, cut1, cut0 + 2 * Math.PI, 64);
    const rock = full(kind === "intercasing" ? R.outerOut : R.hole, R.rock, L.yBot, L.yTop);
    const cem = full(R.cOut, kind === "intercasing" ? R.outerIn : R.hole, L.yBot, L.yTop);
    const casing = full(R.cIn, R.cOut, L.yBot, L.yTop);
    const outer = kind === "intercasing" ? full(R.outerIn, R.outerOut, L.yBot, L.yTop) : null;
    return { rock, cem, casing, outer };
  }, [L, kind, cut0, cut1]);
  const rockTex = useMemo(() => noiseTexture("#8b7355", "rock"), []);
  const cemTex = useMemo(() => noiseTexture("#b9bec6", "cement"), []);
  useEffect(() => () => { geo.rock.dispose(); geo.cem.dispose(); geo.casing.dispose(); geo.outer?.dispose(); }, [geo]);
  useEffect(() => () => { rockTex.dispose(); cemTex.dispose(); }, [rockTex, cemTex]);

  // Трещина / канал
  const fracH = Math.max(2.2, (L.leakY0 - L.leakY1) + 2.5);
  const yl = (L.leakY0 + L.leakY1) / 2;
  const radial = kind === "coupling";
  const fracGeo = useMemo(() => {
    if (kind === "coupling") return [ringDisc(yl, R.cOut, R.frac, cut1, cut0 + 2 * Math.PI)];
    // канал — изогнутая полоса в камне сразу за кромкой выреза (видна снаружи и в разрезе)
    if (kind === "behind_casing") return [band((R.cOut + R.hole) / 2, cut1 + 0.05, cut1 + 0.75, L.leakY1 - 0.3, L.yTop - 0.2)];
    if (kind === "intercasing") return [band((R.cOut + R.outerIn) / 2, cut1 + 0.05, cut1 + 0.9, L.leakY1 - 0.3, L.yTop - 0.2)];
    const wA = wing(L.phiF, R.cOut, R.frac, yl - fracH, yl + fracH);
    return kind === "perforation" ? [wA, wing(L.phiF + Math.PI, R.cOut, R.frac, yl - fracH, yl + fracH)] : [wA];
  }, [kind, L, yl, fracH, cut0, cut1]);
  const texs = useMemo(() => fracGeo.map(() => { const c = document.createElement("canvas"); c.width = 160; c.height = 160; const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }), [fracGeo]);
  const vComp = Math.max(1e-9, end.vCompChannel), vAll = Math.max(1e-9, end.vChannel);
  const fill = Math.sqrt(Math.min(1, p.vCompChannel / (vComp * 1.8)));
  const water = Math.min(1, Math.max(fill, Math.sqrt(Math.min(1, p.vChannel / vAll)) * 1.05));
  const gel = p.vCompChannel > 0 ? Math.max(0, Math.min(1, -Math.log10(Math.max(1e-4, p.mobility)) / 4)) : 0;
  useEffect(() => {
    texs.forEach((t, i) => {
      const channel = kind === "behind_casing" || kind === "intercasing";
      if (channel) {
        // канал: заполнение снизу (от нарушения) вверх
        const cnv = t.image as HTMLCanvasElement, ctx = cnv.getContext("2d")!;
        ctx.clearRect(0, 0, cnv.width, cnv.height);
        ctx.fillStyle = COL.crack; ctx.globalAlpha = 0.85; ctx.fillRect(0, 0, cnv.width, cnv.height);
        const hW = water * cnv.height, hC = fill * cnv.height;
        ctx.globalAlpha = 0.9; ctx.fillStyle = COL.water; ctx.fillRect(0, cnv.height - hW, cnv.width, hW);
        ctx.globalAlpha = 1; ctx.fillStyle = compColor; ctx.fillRect(0, cnv.height - hC, cnv.width, hC);
        ctx.globalAlpha = 0.45 * gel; ctx.fillStyle = "#000"; ctx.fillRect(0, cnv.height - hC, cnv.width, hC); ctx.globalAlpha = 1;
      } else paintFracture(t.image as HTMLCanvasElement, { fill, water, comp: compColor, gel, radial, seed: i * 2.3 + 1, vAspect: (R.frac - R.cOut) / fracH });
      t.needsUpdate = true;
    });
  }, [texs, fill, water, gel, compColor, radial, kind, fracH]);
  useEffect(() => () => { texs.forEach((t) => t.dispose()); fracGeo.forEach((g) => g.dispose()); }, [texs, fracGeo]);

  // Жидкость в колонне под инструментом и в НКТ
  const tY = L.toolY ?? L.yTop + 0.01;
  const belowLen = Math.max(0, tY - L.yBot);
  const compBelowH = belowLen * Math.min(1, p.belowComp);
  const compBelowY0 = p.vCompChannel > 0 ? L.yBot : tY - compBelowH; // состав сначала сверху, после ухода в канал — снизу
  // в НКТ: видимая часть — от верха окна до инструмента; доля длины НКТ, видимая в окне
  const toolMD = inp.tool.setDepthMD;
  const visFrac0 = Math.max(0, (toolMD - (L.yTop - tY) / L.sy) / toolMD);
  const inTub = p.compTop >= 0 ? { a: Math.max(visFrac0, p.compTop), b: Math.min(1, p.compBottom) } : null;
  const tubY = (frac: number) => tY + (1 - frac) * toolMD * L.sy;
  const pumping = p.qLs > 0;

  const leakMarks = useMemo(() => {
    const out: { pos: [number, number, number]; text: string; color: string }[] = [];
    const r = R.rock + 0.6;
    const phL = kind === "behind_casing" || kind === "intercasing" ? cut1 + 0.4 : L.phiF;
    out.push({ pos: [r * Math.cos(phL), yl, r * Math.sin(phL)], text: kind === "behind_casing" ? "канал в камне" : kind === "coupling" ? "трещина по муфте" : "трещина", color: "#fca5a5" });
    if (L.toolY !== null) out.push({ pos: [-(R.rock + 0.4) * Math.cos(L.camPhi), L.toolY, -(R.rock + 0.4) * Math.sin(L.camPhi)], text: inp.tool.kind === "retainer" ? "ретейнер" : "пакер", color: "#e5e7eb" });
    return out;
  }, [L, yl, kind, inp.tool.kind, cut1]);

  return (
    <>
      <color attach="background" args={["#0b1220"]} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[8, 10, 6]} intensity={1.0} />
      <directionalLight position={[-6, -3, -8]} intensity={0.35} />
      <pointLight position={[0, yl, 0]} intensity={0.6} distance={6} color="#fde68a" />
      {/* порода и цементный камень (полупрозрачные, чтобы видеть трещину), колонна */}
      <mesh geometry={geo.rock}><meshStandardMaterial map={rockTex} transparent opacity={0.4} roughness={1} side={THREE.DoubleSide} depthWrite={false} /></mesh>
      <mesh geometry={geo.cem}><meshStandardMaterial map={cemTex} transparent opacity={0.6} roughness={0.9} side={THREE.DoubleSide} depthWrite={false} /></mesh>
      <mesh geometry={geo.casing}><meshStandardMaterial color="#9aa3ad" metalness={0.75} roughness={0.35} side={THREE.DoubleSide} /></mesh>
      {geo.outer && <mesh geometry={geo.outer}><meshStandardMaterial color="#7b8590" metalness={0.7} roughness={0.4} side={THREE.DoubleSide} /></mesh>}
      {/* дефект колонны */}
      {(kind === "casing_body" || kind === "behind_casing" || kind === "intercasing") && (() => { const ph = kind === "casing_body" ? L.phiF : cut1 + 0.4; return (
        <mesh position={[(R.cOut + 0.005) * Math.cos(ph), yl, (R.cOut + 0.005) * Math.sin(ph)]} rotation={[0, -ph, 0]}>
          <boxGeometry args={[0.03, Math.max(0.3, L.leakY0 - L.leakY1), 0.06]} /><meshStandardMaterial color={p.vCompChannel > 0 ? compColor : COL.crack} emissive={p.vCompChannel > 0 ? compColor : "#000"} emissiveIntensity={0.25} />
        </mesh>
      ); })()}
      {kind === "coupling" && <mesh position={[0, yl, 0]}><torusGeometry args={[R.cOut + 0.005, 0.025, 8, 96]} /><meshStandardMaterial color={COL.crack} /></mesh>}
      {kind === "perforation" && [0, 1, 2, 3].map((k) => { const ph = L.phiF + (k * Math.PI) / 2; return [L.leakY1 + 0.15, (L.leakY0 + L.leakY1) / 2, L.leakY0 - 0.15].map((yy, n) => (
        <mesh key={`${k}-${n}`} position={[(R.cOut + 0.25) * Math.cos(ph), yy, (R.cOut + 0.25) * Math.sin(ph)]} rotation={[0, -ph, Math.PI / 2]}>
          <cylinderGeometry args={[0.05, 0.035, 0.6, 12]} /><meshStandardMaterial color={p.vCompChannel > 0 ? compColor : COL.crack} />
        </mesh>
      )); })}
      {/* трещина / канал */}
      {fracGeo.map((g, i) => <mesh key={i} geometry={g}><meshStandardMaterial map={texs[i]} transparent alphaTest={0.05} side={THREE.DoubleSide} roughness={0.6} emissive="#ffffff" emissiveIntensity={0.08} emissiveMap={texs[i]} /></mesh>)}
      {/* жидкость в колонне под инструментом */}
      {belowLen > 0.05 && <mesh position={[0, (L.yBot + tY) / 2, 0]}><cylinderGeometry args={[R.cIn * 0.98, R.cIn * 0.98, belowLen, 40, 1, true]} /><meshStandardMaterial color={COL.well} transparent opacity={0.35} side={THREE.DoubleSide} depthWrite={false} /></mesh>}
      {compBelowH > 0.02 && <mesh position={[0, compBelowY0 + compBelowH / 2, 0]}><cylinderGeometry args={[R.cIn * 0.97, R.cIn * 0.97, compBelowH, 40]} /><meshStandardMaterial color={compColor} transparent opacity={0.85} /></mesh>}
      {/* инструмент и НКТ */}
      {L.toolY !== null && (
        <>
          <mesh position={[0, L.toolY, 0]}><cylinderGeometry args={[R.cIn * 0.97, R.cIn * 0.97, 0.35, 40]} /><meshStandardMaterial color="#1f2937" metalness={0.5} roughness={0.5} /></mesh>
          <mesh position={[0, L.toolY + 0.3, 0]}><cylinderGeometry args={[R.cIn * 0.9, R.cIn * 0.9, 0.25, 8]} /><meshStandardMaterial color="#374151" metalness={0.4} /></mesh>
          <mesh position={[0, (L.toolY + L.yTop) / 2, 0]}><cylinderGeometry args={[R.tub, R.tub, L.yTop - L.toolY, 24, 1, true]} /><meshStandardMaterial color="#cbd5e1" metalness={0.7} roughness={0.3} transparent opacity={0.55} side={THREE.DoubleSide} /></mesh>
          {inTub && inTub.b > inTub.a && (() => { const ya = Math.min(L.yTop, tubY(inTub.a)), yb = Math.max(L.toolY, tubY(inTub.b)); return ya > yb ? <mesh position={[0, (ya + yb) / 2, 0]}><cylinderGeometry args={[R.tub * 0.9, R.tub * 0.9, ya - yb, 20]} /><meshStandardMaterial color={compColor} /></mesh> : null; })()}
        </>
      )}
      {/* поток: стрелки в трещину при закачке */}
      {pumping && p.vChannel > 0 && <Text font={FONT_3D} position={[(R.cOut + 0.5) * Math.cos(L.phiF), yl + 0.35, (R.cOut + 0.5) * Math.sin(L.phiF)]} fontSize={0.38} color="#fde68a" anchorX="center">→</Text>}
      {leakMarks.map((m, i) => <Text key={i} font={FONT_3D} position={m.pos} fontSize={0.32} color={m.color} anchorX="center">{m.text}</Text>)}
      <OrbitControls target={[0, 0, 0]} enableDamping dampingFactor={0.1} />
    </>
  );
}

export default function RirLeak3D({ inp, res, sim, design }: { inp: RirInputs; res: RirResult; sim: SqueezeSimResult; design: CompositionDesign | null }) {
  const kind = inp.leak.kind;
  const pts = sim.points;
  const [idx, setIdx] = useState(pts.length - 1);
  const [playing, setPlaying] = useState(false);
  useEffect(() => { setIdx(pts.length - 1); setPlaying(false); }, [sim, pts.length]);
  useEffect(() => {
    if (!playing) return;
    const step = Math.max(1, Math.round(pts.length / 260));
    const h = window.setInterval(() => setIdx((i) => { if (i + step >= pts.length - 1) { setPlaying(false); return pts.length - 1; } return i + step; }), 45);
    return () => window.clearInterval(h);
  }, [playing, pts.length]);
  const L = useMemo<Layout>(() => {
    const top = inp.leak.topMD, bot = Math.max(inp.leak.bottomMD, top + 0.5);
    const hasTool = inp.tool.kind !== "bradenhead";
    const toolNear = hasTool && top - inp.tool.setDepthMD <= 40 && inp.tool.setDepthMD < top;
    const mdTop = toolNear ? Math.min(top - 4, inp.tool.setDepthMD - 3) : top - 6;
    const mdBot = bot + 9;
    const sy = 14 / Math.max(6, mdBot - mdTop);
    const mdMid = (mdTop + mdBot) / 2;
    const y = (md: number) => -(md - mdMid) * sy;
    const camPhi = Math.atan2(9, 6);
    return { sy, mdMid, y, yTop: y(mdTop), yBot: y(mdBot), leakY0: y(top), leakY1: y(bot), toolY: toolNear ? y(inp.tool.setDepthMD) : null,
      toolAbove: hasTool && !toolNear ? top - inp.tool.setDepthMD : 0, phiF: camPhi - Math.PI / 2 - 0.3, camPhi };
  }, [inp]);
  const p = pts[Math.min(idx, pts.length - 1)];
  const end = pts[pts.length - 1];
  const compColor = design?.kind === "resin" ? COL.resin : res.composition === "cement" ? "#9ca3af" : COL.micro;
  const yl = (L.leakY0 + L.leakY1) / 2;
  const d = 20;
  return (
    <Card data-testid="rir-leak3d">
      <CardHeader className="py-2.5 px-4">
        <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
          <Scan className="w-4 h-4" /> 3D: нарушение и уход состава в трещину
          <Badge variant="outline" className="text-[10px]">по времени моделирования задавливания</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" className="h-7 w-7 p-0" aria-label={playing ? "Пауза" : "Воспроизвести"} onClick={() => { if (!playing && idx >= pts.length - 1) setIdx(0); setPlaying((x) => !x); }}>
            {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          </Button>
          <Button size="sm" variant="outline" className="h-7 w-7 p-0" aria-label="В начало" onClick={() => { setPlaying(false); setIdx(0); }}><RotateCcw className="w-3.5 h-3.5" /></Button>
          <input type="range" min={0} max={pts.length - 1} value={idx} onChange={(e) => { setPlaying(false); setIdx(+e.target.value); }} className="flex-1 min-w-[160px] accent-[hsl(var(--primary))]" aria-label="Время" data-testid="rir-leak3d-range" />
          <span className="tabular-nums text-muted-foreground text-right w-80">t = {p.t.toFixed(0)} мин · {p.stage} · P {p.surfaceMPa.toFixed(1)} МПа · в трещине {(p.vCompChannel * 1000).toFixed(0)} л</span>
        </div>
        <div className="relative h-[560px] rounded-md overflow-hidden bg-[#0b1220]">
          <Canvas camera={{ position: [d * Math.cos(L.camPhi), 2.5, d * Math.sin(L.camPhi)], fov: 42 }} gl={{ preserveDrawingBuffer: true, antialias: true }}>
            <Scene inp={inp} res={res} p={p} end={end} compColor={compColor} kind={kind} L={L} />
          </Canvas>
          <div className="pointer-events-none absolute left-3 top-3 rounded bg-black/55 px-2 py-1.5 text-[11px] text-slate-100 space-y-0.5">
            <p className="font-semibold">{inp.leak.topMD.toFixed(0)}–{inp.leak.bottomMD.toFixed(0)} м · {kind === "coupling" ? "негерметичная муфта" : kind === "perforation" ? "интервал перфорации" : kind === "behind_casing" ? "заколонный переток" : kind === "intercasing" ? "межколонный переток" : "трещина в теле колонны"}</p>
            <p>Q {p.qLs.toFixed(2)} л/с · подвижность канала {(p.mobility * 100).toFixed(p.mobility < 0.1 ? 2 : 0)}% от воды</p>
            {L.toolAbove > 0 && <p>инструмент выше на {L.toolAbove.toFixed(0)} м (вне кадра)</p>}
          </div>
          <div className="pointer-events-none absolute right-3 bottom-3 rounded bg-black/55 px-2 py-1.5 text-[10px] text-slate-100 space-y-0.5">
            {[[compColor, design?.title ?? "состав"], [COL.water, "вода / жидкость впереди состава"], [COL.crack, "пустая трещина"], [COL.cement, "цементный камень"], ["#8b7355", "порода"]].map(([c, t]) => (
              <p key={t} className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: c }} />{t}</p>
            ))}
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Масштаб по радиусу увеличен, порода и камень полупрозрачны, чтобы видеть трещину. Площадь заполнения трещины пропорциональна объёму состава,
          ушедшему в канал по моделированию; по мере загустевания состав темнеет. Форма трещины схематична (одно крыло от трещины колонны, два крыла —
          при перфорации, кольцо — по муфте, вертикальный канал в камне — при заколонном перетоке).
        </p>
      </CardContent>
    </Card>
  );
}
