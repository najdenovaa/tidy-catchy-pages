import { useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Text } from "@react-three/drei";
import * as THREE from "three";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Box, Pause, Play, RotateCcw } from "lucide-react";
import type { PlugInputs, PlugResults } from "@/lib/cement-plug-calculations";
import type { PlugComplicationSummary } from "@/lib/cement-plug-complication-eval";
import type { TrajectoryPoint } from "@/lib/cementing-calculations";
import { FONT_3D } from "@/lib/three-font";
import { pathPoints, frames } from "@/components/displacement/D2Annulus3D";
import { hexToRgb } from "@/components/displacement/d2-shared";

/**
 * 3D-модель цементного моста: закачка → подъём труб → покой (обмен жидкостями, оседание)
 * → итог с осложнениями. Картина строится по расчётам модуля: балансировка уровней, объём,
 * модель гравитационного обмена (опускание кровли, «язык» цемента ниже подошвы, проникновение
 * лёгкой жидкости в мост, время остановки обмена), осложнения (уход в зону поглощения).
 * В наклонном стволе цемент стекает по нижней стенке, лёгкая жидкость поднимается по верхней.
 */

const C = { mud: "#3f7d55", spacer: "#e0a63a", cement: "#a8adb5", pad: "#9c6bb1", lost: "#d97706" } as const;
type FluidKey = keyof typeof C;
const RGB: Record<FluidKey, [number, number, number]> = Object.fromEntries(Object.entries(C).map(([k, v]) => [k, hexToRgb(v)])) as Record<FluidKey, [number, number, number]>;

const f1 = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "—");
const mm = (s: number) => `${Math.floor(s)} мин`;

interface Scene {
  zA: number; zB: number; top0: number; bot: number; pipeEnd0: number; pullOut: number;
  annTop: number; topAfter: number; spAbove: number; padLen: number; hasPad: boolean;
  topDrop: number; smear: number; lightPen: number; arrestMin: number; incl: number;
  finalTop: number; finalBot: number; loss: { md: number; h: number; volM3: number } | null;
  kickMd: number | null; boreR: number; tExMin: number; verdict: string;
}

interface State { phase: 0 | 1 | 2 | 3; p: number; label: string; tMin: number }

function stateAt(x: number, s: Scene): State {
  // 0–0,3 закачка; 0,3–0,45 подъём труб; 0,45–0,92 покой; 0,92–1 итог
  if (x < 0.3) return { phase: 0, p: x / 0.3, label: "Закачка и продавка (трубы на подошве)", tMin: 0 };
  if (x < 0.45) return { phase: 1, p: (x - 0.3) / 0.15, label: "Подъём труб: цемент из труб выравнивается в стволе", tMin: 0 };
  if (x < 0.92) { const p = (x - 0.45) / 0.47; return { phase: 2, p, label: "Покой: обмен жидкостями и оседание", tMin: p * s.tExMin }; }
  return { phase: 3, p: 1, label: "Итог", tMin: s.tExMin };
}

/** Какая жидкость в точке: md — глубина, y ∈ [−1 (верхняя стенка), 1 (нижняя)]. */
function fluidAt(md: number, y: number, st: State, s: Scene): FluidKey {
  const below: FluidKey = s.hasPad && md <= s.bot + s.padLen + 0.01 ? "pad" : "mud";
  let top: number, bot = s.bot, smear = 0, light = 0;
  if (st.phase === 0) {
    const cTop = s.pipeEnd0 - st.p * (s.pipeEnd0 - s.annTop);
    const spTop = cTop - s.spAbove * Math.min(1, st.p * 3);
    if (md >= cTop && md <= s.pipeEnd0) return "cement";
    if (md >= spTop && md < cTop) return "spacer";
    return md > s.bot ? below : "mud";
  }
  if (st.phase === 1) {
    top = s.annTop + (s.topAfter - s.annTop) * st.p;
  } else {
    const f = Number.isFinite(s.arrestMin) && s.arrestMin > 0 ? 1 - Math.exp((-3 * st.tMin) / s.arrestMin) : st.tMin / Math.max(1, s.tExMin);
    const ff = st.phase === 3 ? 1 : Math.min(1, f / (Number.isFinite(s.arrestMin) ? 1 - Math.exp(-3 * s.tExMin / s.arrestMin) : 1));
    top = s.topAfter + s.topDrop * ff;
    smear = s.smear * ff; light = Math.min(s.lightPen * ff, Math.max(0, bot - top));
    if (st.phase === 3) { top = Math.max(top, s.finalTop); bot = s.finalBot; }
  }
  // наклонная граница: горизонтальная поверхность раздела в наклонном стволе
  const tilt = Math.min(6, Math.tan((Math.min(85, s.incl) * Math.PI) / 180)) * s.boreR * -y;
  const wave = 0.18 * Math.sin(md * 2.1 + y * 3) * Math.max(smear, light) * 0.1;
  const dev = s.incl >= 10;
  if (md < top + tilt) return md >= top + tilt - s.spAbove ? "spacer" : "mud";
  if (md <= bot) {
    // лёгкая жидкость проникает в мост снизу: в наклонном — по верхней стенке, в вертикальном — у стенок
    const w = dev ? Math.max(0, (-y - 0.15) / 0.85) : Math.max(0, (Math.abs(y) - 0.55) / 0.45);
    if (light > 0 && w > 0 && md >= bot - light * Math.sqrt(w) + wave) return below;
    return "cement";
  }
  // язык цемента ниже подошвы: в наклонном — по нижней стенке, в вертикальном — по центру
  const w = dev ? Math.max(0, (y - 0.15) / 0.85) : Math.max(0, 1 - Math.abs(y) / 0.4);
  if (smear > 0 && w > 0 && md <= bot + smear * Math.sqrt(w) + wave) return "cement";
  return below;
}

function buildScene(inputs: PlugInputs, r: PlugResults, compl: PlugComplicationSummary | null, kickMd: number | null): Scene {
  const top0 = r.plugTopMD, bot = r.plugBottomMD, L = Math.max(1, bot - top0);
  const iface = r.exchange.interfaces.find((i) => /цемент/i.test(i.upper)) ?? r.exchange.interfaces[0];
  const hasPad = !!inputs.useViscousPad && r.spacerBelowHeightAnnMD > 0;
  const padLen = hasPad ? r.exchangeInput.padLengthM ?? r.spacerBelowHeightAnnMD : 0;
  const annTop = Math.max(0, r.pipeEndDepthMD - r.cementHeightAnnMD);
  const topDrop = iface?.topDropM ?? 0, smear = iface?.bottomSmearM ?? 0, lightPen = iface?.lightPenetrationM ?? 0;
  const arrestMin = iface?.arrestMin ?? Infinity;
  const tExMin = Number.isFinite(arrestMin) ? Math.min(360, Math.max(20, arrestMin * 1.2)) : 240;
  const loss = compl?.active && compl.hasLoss && compl.lossZone ? { md: compl.lossZone.topMD + compl.lossZone.thicknessM / 2, h: compl.lossZone.thicknessM, volM3: compl.cementLostM3 } : null;
  const extraBelow = Math.max(smear * 1.3, padLen + 5, 0.4 * L, 15);
  let zA = Math.min(top0, r.plugTopByVolumeMD, annTop) - Math.max(25, 0.6 * L, r.spacerAboveHeightAnnMD * 1.2);
  let zB = bot + extraBelow;
  if (loss) { zA = Math.min(zA, loss.md - 10); zB = Math.max(zB, loss.md + 10); }
  if (kickMd) { zA = Math.min(zA, kickMd - 10); zB = Math.max(zB, kickMd + 10); }
  zA = Math.max(0, zA);
  return {
    zA, zB, top0, bot, pipeEnd0: r.pipeEndDepthMD, pullOut: r.pullOutDepthMD, annTop, topAfter: r.plugTopByVolumeMD,
    spAbove: r.spacerAboveHeightAnnMD, padLen, hasPad, topDrop, smear, lightPen, arrestMin,
    incl: r.exchangeInput.zenithDeg, finalTop: compl?.active ? compl.realTopMD : r.plugTopByVolumeMD + topDrop,
    finalBot: compl?.active ? compl.realBottomMD : bot, loss, kickMd, boreR: r.exchange.radiusM, tExMin,
    verdict: r.exchange.headline,
  };
}

const NZ = 220, NA = 64, NY = 48;
const CUT0 = 0.25 * Math.PI, CUT1 = 0.75 * Math.PI;

function ribbon(pts: THREE.Vector3[], fr: ReturnType<typeof frames>, R: number) {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let j = 0; j < pts.length; j++) for (let k = 0; k <= 1; k++) {
    const y = k === 0 ? -1 : 1; // −1 — верх (+N), +1 — низ (−N)
    const p = pts[j].clone().add(fr.N[j].clone().multiplyScalar(-y * R * 0.995));
    pos.push(p.x, p.y, p.z); uv.push(j / (pts.length - 1), k);
  }
  for (let j = 0; j < pts.length - 1; j++) { const a = j * 2, b = a + 1, c = a + 2, d = a + 3; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

function shell(pts: THREE.Vector3[], fr: ReturnType<typeof frames>, R: number, cut: boolean, uvs: boolean, offN = 0, seg = 64) {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const n = pts.length - 1;
  for (let j = 0; j <= n; j++) for (let m = 0; m <= seg; m++) {
    const a = (m / seg) * 2 * Math.PI;
    const p = pts[j].clone().add(fr.N[j].clone().multiplyScalar(R * Math.cos(a) + offN)).add(fr.B[j].clone().multiplyScalar(R * Math.sin(a)));
    pos.push(p.x, p.y, p.z); if (uvs) uv.push(j / n, m / seg);
  }
  for (let j = 0; j < n; j++) for (let m = 0; m < seg; m++) {
    const ac = ((m + 0.5) / seg) * 2 * Math.PI;
    if (cut && ac > CUT0 && ac < CUT1) continue;
    const a = j * (seg + 1) + m, b = a + 1, c = a + seg + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  if (uvs) g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

function PlugScene({ s, x, traj }: { s: Scene; x: number; traj: TrajectoryPoint[] }) {
  const st = stateAt(x, s);
  const geo = useMemo(() => {
    const mds = Array.from({ length: NZ + 1 }, (_, j) => s.zA + ((s.zB - s.zA) * j) / NZ);
    const raw = pathPoints(traj, mds);
    const o = raw[0].clone();
    const sc = 10 / Math.max(1, s.zB - s.zA);
    const pts = raw.map((p) => p.sub(o).multiplyScalar(sc));
    const fr = frames(pts);
    const Rh = 0.9, Rr = 1.7, Rp = 0.28;
    const at = (md: number) => Math.min(NZ, Math.max(0, Math.round(((md - s.zA) / (s.zB - s.zA)) * NZ)));
    const marks: { p: THREE.Vector3; t: string; c: string }[] = [];
    const lab = (md: number, t: string, c = "#cbd5e1") => { const j = at(md); marks.push({ p: pts[j].clone().add(fr.N[j].clone().multiplyScalar(Rr + 0.9)), t, c }); };
    lab(s.top0, `кровля ${Math.round(s.top0)} м`, "#e5e7eb"); lab(s.bot, `подошва ${Math.round(s.bot)} м`, "#e5e7eb");
    if (s.loss) lab(s.loss.md, `поглощение ${Math.round(s.loss.md)} м`, "#fca5a5");
    if (s.kickMd) lab(s.kickMd, `проявление ${Math.round(s.kickMd)} м`, "#93c5fd");
    const jm = Math.floor(NZ / 2);
    const lowLbl = pts[jm].clone().add(fr.N[jm].clone().multiplyScalar(-(Rr + 0.8)));
    const center = pts[jm].clone();
    const span = pts[0].distanceTo(pts[pts.length - 1]);
    const d = Math.max(9, span * 1.35);
    const cam = center.clone().add(fr.B[jm].clone().multiplyScalar(d)).add(fr.N[jm].clone().multiplyScalar(d * 0.2));
    return {
      pts, fr, mds, at, marks, lowLbl, center, cam, Rh, Rr, Rp,
      wall: shell(pts, fr, Rh, true, true), section: ribbon(pts, fr, Rh),
      rock: shell(pts, fr, Rr, true, false, 0, 48), rockInner: shell(pts, fr, Rh * 1.01, true, false, 0, 48),
    };
  }, [s, traj]);

  // текстуры: стенка (угол) и продольный разрез (y)
  const tex = useMemo(() => {
    const mk = (w: number, h: number) => { const c = document.createElement("canvas"); c.width = w; c.height = h; const t = new THREE.CanvasTexture(c); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; return t; };
    return { wall: mk(NZ, NA), section: mk(NZ, NY) };
  }, []);
  useEffect(() => {
    const paint = (t: THREE.CanvasTexture, H: number, yOf: (row: number) => number) => {
      const cnv = t.image as HTMLCanvasElement, ctx = cnv.getContext("2d")!;
      const img = ctx.createImageData(NZ, H);
      for (let row = 0; row < H; row++) {
        const y = yOf(row);
        for (let j = 0; j < NZ; j++) {
          const md = geo.mds[j] + (geo.mds[1] - geo.mds[0]) / 2;
          const c = RGB[fluidAt(md, y, st, s)];
          const o = (row * NZ + j) * 4;
          img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0); t.needsUpdate = true;
    };
    paint(tex.wall, NA, (row) => -Math.cos(((row + 0.5) / NA) * 2 * Math.PI));
    paint(tex.section, NY, (row) => -1 + (2 * (row + 0.5)) / NY);
  }, [st.phase, st.p, st.tMin, s, geo, tex]); // eslint-disable-line react-hooks/exhaustive-deps

  // трубы: от верха области до текущей глубины конца труб, прижаты к нижней стенке
  const pipeEnd = st.phase === 0 ? s.pipeEnd0 : st.phase === 1 ? s.pipeEnd0 + (s.pullOut - s.pipeEnd0) * st.p : s.zA - 1;
  const pipeGeo = useMemo(() => {
    if (pipeEnd <= s.zA + 0.5) return null;
    const jEnd = geo.at(pipeEnd);
    if (jEnd < 2) return null;
    return shell(geo.pts.slice(0, jEnd + 1), { T: geo.fr.T.slice(0, jEnd + 1), N: geo.fr.N.slice(0, jEnd + 1), B: geo.fr.B.slice(0, jEnd + 1) }, geo.Rp, false, false, -(geo.Rh - geo.Rp) * 0.75, 24);
  }, [pipeEnd, geo, s.zA]);
  useEffect(() => () => pipeGeo?.dispose(), [pipeGeo]);

  // уход цемента в пласт: диск в породе в зоне поглощения
  const lossDisk = useMemo(() => {
    if (!s.loss || st.phase < 2 || s.loss.volM3 <= 0) return null;
    const j = geo.at(s.loss.md);
    const grow = st.phase === 3 ? 1 : st.p;
    const rv = geo.Rh + (geo.Rr * 1.8 - geo.Rh) * Math.min(1, Math.sqrt(s.loss.volM3 / 2)) * grow;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), geo.fr.T[j]);
    return { p: geo.pts[j], q, rv };
  }, [s, st.phase, st.p, geo]);

  return (
    <>
      <color attach="background" args={["#0f172a"]} />
      <ambientLight intensity={0.8} />
      <directionalLight position={[6, 9, 7]} intensity={0.9} />
      <directionalLight position={[-6, -4, -5]} intensity={0.35} />
      <mesh geometry={geo.rock}><meshStandardMaterial color="#a08a6c" transparent opacity={0.45} side={THREE.DoubleSide} roughness={0.95} /></mesh>
      <mesh geometry={geo.wall}><meshStandardMaterial map={tex.wall} side={THREE.DoubleSide} roughness={0.7} /></mesh>
      <mesh geometry={geo.section}><meshStandardMaterial map={tex.section} side={THREE.DoubleSide} roughness={0.8} /></mesh>
      {pipeGeo && <mesh geometry={pipeGeo}><meshStandardMaterial color="#cbd5e1" metalness={0.6} roughness={0.35} /></mesh>}
      {s.loss && (() => { const j = geo.at(s.loss.md); const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), geo.fr.T[j]); const h = Math.max(0.08, (s.loss.h / (s.zB - s.zA)) * 10); return (
        <mesh position={geo.pts[j]} quaternion={q}><cylinderGeometry args={[geo.Rr * 1.02, geo.Rr * 1.02, h, 48, 1, true]} /><meshStandardMaterial color="#ef4444" transparent opacity={0.35} side={THREE.DoubleSide} /></mesh>
      ); })()}
      {lossDisk && (
        <mesh position={lossDisk.p} quaternion={lossDisk.q}><cylinderGeometry args={[lossDisk.rv, lossDisk.rv, 0.06, 48]} /><meshStandardMaterial color={C.lost} transparent opacity={0.75} /></mesh>
      )}
      {s.kickMd && (() => { const j = geo.at(s.kickMd); const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), geo.fr.T[j]); return (
        <mesh position={geo.pts[j]} quaternion={q}><cylinderGeometry args={[geo.Rr * 1.02, geo.Rr * 1.02, 0.25, 48, 1, true]} /><meshStandardMaterial color="#3b82f6" transparent opacity={0.45} side={THREE.DoubleSide} /></mesh>
      ); })()}
      {geo.marks.map((m, i) => <Text key={i} font={FONT_3D} position={[m.p.x, m.p.y, m.p.z]} fontSize={0.28} color={m.c} anchorX="left" anchorY="middle">{m.t}</Text>)}
      {s.incl >= 10 && <Text font={FONT_3D} position={[geo.lowLbl.x, geo.lowLbl.y, geo.lowLbl.z]} fontSize={0.26} color="#fca5a5" anchorX="center">▼ нижняя стенка</Text>}
      <OrbitControls target={[geo.center.x, geo.center.y, geo.center.z]} enableDamping dampingFactor={0.1} />
    </>
  );
}

export default function Plug3D({ inputs, results, compl, kickZoneMD }: { inputs: PlugInputs; results: PlugResults; compl: PlugComplicationSummary | null; kickZoneMD?: number | null }) {
  const s = useMemo(() => buildScene(inputs, results, compl, compl?.active && compl.hasKick ? kickZoneMD ?? null : null), [inputs, results, compl, kickZoneMD]);
  const [x, setX] = useState(1);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const h = window.setInterval(() => setX((v) => { if (v >= 1) { setPlaying(false); return 1; } return Math.min(1, v + 0.006); }), 50);
    return () => window.clearInterval(h);
  }, [playing]);
  const st = stateAt(x, s);
  const traj = (inputs.well.trajectory as unknown as TrajectoryPoint[]) ?? [];
  const camPos = useMemo(() => {
    const mds = [s.zA, (s.zA + s.zB) / 2, s.zB];
    const raw = pathPoints(traj, mds);
    const o = raw[0].clone(), sc = 10 / Math.max(1, s.zB - s.zA);
    const pts = raw.map((p) => p.sub(o).multiplyScalar(sc));
    const fr = frames(pts);
    const span = pts[0].distanceTo(pts[2]);
    const d = Math.max(9, span * 1.35);
    const c = pts[1];
    return { c, cam: c.clone().add(fr.B[1].clone().multiplyScalar(d)).add(fr.N[1].clone().multiplyScalar(d * 0.15)).add(new THREE.Vector3(0, d * 0.22, 0)) };
  }, [s, traj]);
  const len = Math.max(0, s.finalBot - s.finalTop);
  return (
    <Card data-testid="plug-3d">
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
          <Box className="w-4 h-4" /> 3D-модель моста: установка, растекание и оседание
          <Badge variant="outline" className="text-[10px]">по расчёту балансировки и модели обмена</Badge>
          {compl?.active && <Badge variant="destructive" className="text-[10px]">с осложнениями</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" className="h-7 w-7 p-0" aria-label={playing ? "Пауза" : "Воспроизвести"} onClick={() => { if (!playing && x >= 1) setX(0); setPlaying((v) => !v); }}>
            {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          </Button>
          <Button size="sm" variant="outline" className="h-7 w-7 p-0" aria-label="В начало" onClick={() => { setPlaying(false); setX(0); }}><RotateCcw className="w-3.5 h-3.5" /></Button>
          <input type="range" min={0} max={1000} value={Math.round(x * 1000)} onChange={(e) => { setPlaying(false); setX(+e.target.value / 1000); }} className="flex-1 min-w-[160px] accent-[hsl(var(--primary))]" aria-label="Этап" data-testid="plug3d-range" />
          <span className="text-muted-foreground w-80 text-right">{st.label}{st.phase === 2 ? ` · ${mm(st.tMin)} после остановки` : ""}</span>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {([["cement", "цемент"], ["spacer", "буфер"], ["mud", "буровой раствор"], ...(s.hasPad ? [["pad", "вязкая пачка"]] : []), ...(s.loss ? [["lost", "цемент, ушедший в пласт"]] : [])] as [FluidKey, string][]).map(([k, t]) => (
            <span key={k} className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: C[k] }} />{t}</span>
          ))}
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: "#cbd5e1" }} />трубы</span>
        </div>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="h-[540px] rounded-md overflow-hidden bg-[#0f172a]">
            <Canvas camera={{ position: [camPos.cam.x, camPos.cam.y, camPos.cam.z], fov: 40 }} gl={{ preserveDrawingBuffer: true }}>
              <PlugScene s={s} x={x} traj={traj} />
            </Canvas>
          </div>
          <div className="space-y-2">
            <table className="w-full text-[11px]">
              <tbody>
                {[
                  ["Проект: кровля — подошва", `${f1(s.top0, 0)} — ${f1(s.bot, 0)} м`],
                  ["Кровля после подъёма труб", `${f1(s.topAfter, 1)} м`],
                  ["Опускание кровли при обмене", `${f1(s.topDrop, 1)} м`],
                  ["Язык цемента ниже подошвы", `${f1(s.smear, 1)} м${s.incl >= 10 ? " (по нижней стенке)" : " (по центру ствола)"}`],
                  ["Проникание лёгкой жидкости в мост", `${f1(s.lightPen, 1)} м${s.incl >= 10 ? " (по верхней стенке)" : " (у стенок)"}`],
                  ["Обмен останавливается через", Number.isFinite(s.arrestMin) ? `${f1(s.arrestMin, 0)} мин` : "не останавливается до схватывания"],
                  ["Зенитный угол в интервале", `${f1(s.incl, 0)}°`],
                  ["Итог: кровля — подошва (длина)", `${f1(s.finalTop, 1)} — ${f1(s.finalBot, 1)} м (${f1(len, 1)} м)`],
                  ...(s.loss ? [["Уход цемента в зону поглощения", `${f1(s.loss.volM3, 2)} м³ на ${f1(s.loss.md, 0)} м`]] : []),
                ].map(([a, b]) => <tr key={a} className="border-t border-border/40"><td className="p-1 text-muted-foreground">{a}</td><td className="p-1 text-right font-medium">{b}</td></tr>)}
              </tbody>
            </table>
            <p className="text-[11px]">{s.verdict}</p>
            <p className="text-[10px] text-muted-foreground">
              Слева — ствол с вырезом: на стенке и в продольном разрезе по вертикальной плоскости (верхняя ↔ нижняя стенка) показано, где какая жидкость.
              Радиус ствола увеличен для наглядности. Размеры «языков» и опускание кровли — из модели гравитационного обмена модуля (с промысловым множителем и
              кинетикой загустевания); форма — схематичная: в наклонном стволе тяжёлый цемент стекает по нижней стенке, лёгкая жидкость поднимается по верхней.
              Вращение — мышью, масштаб — колесом.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
