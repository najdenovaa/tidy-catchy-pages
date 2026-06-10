import { useRef, useState, useMemo, useEffect, Suspense } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import * as THREE from "three";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Play, Pause, RotateCcw } from "lucide-react";
import type { FoamCementPoint } from "@/lib/foam-cement-calculations";

interface Props {
  points: FoamCementPoint[];          // top → bottom (md ascending)
  totalDepthMD: number;
  holeDiameterMm: number;
  casingODmm: number;
  baseDensity: number;                // g/cm³
}

/* ───── Color ramp by foam density (light-blue → dark-gray) ───── */
function densityColor(density: number, minD: number, maxD: number): THREE.Color {
  const t = Math.max(0, Math.min(1, (density - minD) / Math.max(1e-6, maxD - minD)));
  // light cyan (low ρ, high FQ) → mid gray → dark gray (high ρ, low FQ)
  const light = new THREE.Color("#bfe6ff");
  const mid   = new THREE.Color("#8a99a3");
  const dark  = new THREE.Color("#2f363b");
  if (t < 0.5) return light.clone().lerp(mid, t * 2);
  return mid.clone().lerp(dark, (t - 0.5) * 2);
}

/* ───── One annular slice (ring) ───── */
function Slice({
  y, height, innerR, outerR, color, visible,
}: { y: number; height: number; innerR: number; outerR: number; color: THREE.Color; visible: boolean }) {
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(() => {
    if (!matRef.current) return;
    const target = visible ? 0.92 : 0.0;
    matRef.current.opacity += (target - matRef.current.opacity) * 0.18;
  });
  return (
    <mesh position={[0, y, 0]}>
      <cylinderGeometry args={[outerR, outerR, height, 48, 1, true]} />
      <meshStandardMaterial
        ref={matRef}
        color={color}
        roughness={0.55}
        metalness={0.05}
        side={THREE.DoubleSide}
        transparent
        opacity={0}
      />
      {/* inner hole (casing) — cuts via a second mesh */}
      <mesh>
        <cylinderGeometry args={[innerR, innerR, height + 0.001, 48, 1, true]} />
        <meshStandardMaterial color="#1a1f24" side={THREE.BackSide} />
      </mesh>
    </mesh>
  );
}

/* ───── Casing pipe (inner) ───── */
function CasingPipe({ height, radius }: { height: number; radius: number }) {
  return (
    <mesh position={[0, height / 2, 0]}>
      <cylinderGeometry args={[radius, radius, height, 48]} />
      <meshStandardMaterial color="#3f4a55" metalness={0.7} roughness={0.35} />
    </mesh>
  );
}

/* ───── Hole wall (outer, wireframe-ish) ───── */
function HoleWall({ height, radius }: { height: number; radius: number }) {
  return (
    <mesh position={[0, height / 2, 0]}>
      <cylinderGeometry args={[radius, radius, height, 48, 1, true]} />
      <meshStandardMaterial color="#6b4d2b" roughness={0.95} side={THREE.BackSide} wireframe={false} transparent opacity={0.25} />
    </mesh>
  );
}

/* ───── Depth ruler ───── */
function DepthRuler({ height, totalDepth, radius }: { height: number; totalDepth: number; radius: number }) {
  const ticks = [];
  const stepCount = 5;
  for (let i = 0; i <= stepCount; i++) {
    const frac = i / stepCount;
    const y = height - frac * height;
    const md = frac * totalDepth;
    ticks.push(
      <Html key={i} position={[radius + 0.25, y, 0]} center distanceFactor={8}>
        <div style={{
          color: "#cbd5e1",
          fontSize: "9px",
          fontFamily: "monospace",
          background: "rgba(15,23,42,0.7)",
          padding: "1px 4px",
          borderRadius: "2px",
          whiteSpace: "nowrap",
        }}>
          {md.toFixed(0)} м
        </div>
      </Html>,
    );
  }
  return <>{ticks}</>;
}

/* ───── Scene ───── */
function Scene({ points, totalDepthMD, holeDiameterMm, casingODmm, fillProgress }: Props & { fillProgress: number }) {
  // Scale: total height = 6 units in 3D
  const H = 6;
  const radiusScale = 1 / 80; // mm → units
  const outerR = (holeDiameterMm / 2) * radiusScale;
  const innerR = (casingODmm / 2) * radiusScale;

  // Quantize points into N slices top→bottom (md ascending → y descending)
  const SLICES = 48;
  const sliceH = H / SLICES;
  const { slices, minD, maxD } = useMemo(() => {
    if (!points.length) return { slices: [], minD: 1, maxD: 2 };
    let mn = Infinity, mx = -Infinity;
    for (const p of points) { mn = Math.min(mn, p.foamDensity); mx = Math.max(mx, p.foamDensity); }
    const sl: { y: number; density: number; md: number }[] = [];
    for (let i = 0; i < SLICES; i++) {
      const frac = (i + 0.5) / SLICES;     // 0 (top) → 1 (bottom)
      const md = frac * totalDepthMD;
      // find nearest point by md
      let best = points[0]; let bd = Math.abs(points[0].md - md);
      for (const p of points) { const d = Math.abs(p.md - md); if (d < bd) { bd = d; best = p; } }
      const y = H - frac * H - sliceH / 2;   // y descends as md grows
      sl.push({ y, density: best.foamDensity, md });
    }
    return { slices: sl, minD: mn, maxD: mx };
  }, [points, totalDepthMD]);

  // Filling rises bottom→top. fillProgress ∈ [0..1].
  // A slice is visible when its normalized depth (1 - frac_from_top) ≤ fillProgress.
  // slice i has frac_from_top = (i+0.5)/SLICES, so bottom-up fill ratio = 1 - frac_from_top.
  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 6, 4]} intensity={0.9} />
      <directionalLight position={[-4, 3, -3]} intensity={0.35} />

      <group position={[0, -H / 2, 0]}>
        <HoleWall height={H} radius={outerR} />
        <CasingPipe height={H} radius={innerR} />
        {slices.map((s, i) => {
          const fracFromTop = (i + 0.5) / SLICES;
          const bottomFill = 1 - fracFromTop;
          const visible = bottomFill <= fillProgress;
          return (
            <Slice
              key={i}
              y={s.y}
              height={sliceH * 0.98}
              innerR={innerR}
              outerR={outerR}
              color={densityColor(s.density, minD, maxD)}
              visible={visible}
            />
          );
        })}
        <DepthRuler height={H} totalDepth={totalDepthMD} radius={outerR} />

        {/* Surface line */}
        <mesh position={[0, H, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[innerR * 0.98, outerR * 1.05, 48]} />
          <meshBasicMaterial color="#475569" side={THREE.DoubleSide} />
        </mesh>
      </group>
    </>
  );
}

/* ───── Public component ───── */
export default function FoamCement3D(props: Props) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0); // 0..1 — fill ratio bottom→top
  const [speed, setSpeed] = useState(0.25);    // per second
  const last = useRef<number | null>(null);

  // Animation loop driven by rAF (works even when canvas is idle)
  useEffect(() => {
    if (!playing) { last.current = null; return; }
    let raf = 0;
    const tick = (t: number) => {
      if (last.current == null) last.current = t;
      const dt = (t - last.current) / 1000;
      last.current = t;
      setProgress(p => {
        const next = p + dt * speed;
        if (next >= 1) { setPlaying(false); return 1; }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed]);

  const minD = useMemo(() => props.points.reduce((m, p) => Math.min(m, p.foamDensity), Infinity), [props.points]);
  const maxD = useMemo(() => props.points.reduce((m, p) => Math.max(m, p.foamDensity), -Infinity), [props.points]);
  const fillMD = props.totalDepthMD * (1 - progress); // top of foam column inside well
  const filledFromBottom = props.totalDepthMD - fillMD;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">🌀 3D-анимация заполнения затрубья пеноцементом</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_260px] gap-4">
          <div className="h-[460px] rounded-lg border border-border bg-gradient-to-b from-slate-900 to-slate-950 overflow-hidden">
            <Canvas camera={{ position: [4.5, 2.5, 5.5], fov: 38 }} dpr={[1, 2]}>
              <Suspense fallback={null}>
                <Scene {...props} fillProgress={progress} />
                <OrbitControls enablePan={false} minDistance={4} maxDistance={14} target={[0, 0, 0]} />
              </Suspense>
            </Canvas>
          </div>

          <div className="space-y-3 text-xs">
            <div className="flex items-center gap-1">
              <Button size="sm" onClick={() => setPlaying(p => !p)}>
                {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setProgress(0); setPlaying(false); }}>
                <RotateCcw className="w-4 h-4" />
              </Button>
              <select
                value={speed}
                onChange={e => setSpeed(+e.target.value)}
                className="px-2 py-1 rounded bg-background border border-border ml-auto"
              >
                <option value={0.1}>0.5×</option>
                <option value={0.25}>1×</option>
                <option value={0.5}>2×</option>
                <option value={1}>4×</option>
              </select>
            </div>

            <div>
              <div className="text-muted-foreground mb-1">Прогресс закачки</div>
              <Slider min={0} max={1} step={0.01} value={[progress]} onValueChange={v => setProgress(v[0])} />
              <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                <span>0%</span>
                <span className="font-mono text-foreground">{(progress * 100).toFixed(0)}%</span>
                <span>100%</span>
              </div>
            </div>

            <div className="rounded-md border border-border bg-muted/10 p-2 space-y-1.5">
              <div className="flex justify-between"><span className="text-muted-foreground">Заполнено снизу</span><span className="font-mono">{filledFromBottom.toFixed(0)} м</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Верх столба</span><span className="font-mono">{fillMD.toFixed(0)} м MD</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">ρ база</span><span className="font-mono">{props.baseDensity.toFixed(2)} г/см³</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">ρ пены диапазон</span><span className="font-mono">{Number.isFinite(minD) ? minD.toFixed(2) : "—"} … {Number.isFinite(maxD) ? maxD.toFixed(2) : "—"}</span></div>
            </div>

            {/* Density legend */}
            <div className="rounded-md border border-border p-2">
              <div className="text-muted-foreground mb-1.5">Цвет = плотность / FQ</div>
              <div className="h-3 rounded" style={{
                background: "linear-gradient(to right, #bfe6ff 0%, #8a99a3 50%, #2f363b 100%)",
              }} />
              <div className="flex justify-between text-[10px] mt-1 text-muted-foreground">
                <span>лёгкий (выс. FQ)</span>
                <span>плотный (низ. FQ)</span>
              </div>
            </div>

            <div className="text-[10px] text-muted-foreground leading-relaxed">
              Заполнение снизу вверх отражает технологию: пеноцемент сначала достигает забоя, затем поднимается по затрубью. Тёмный оттенок внизу — газ сжат, FQ ниже, плотность выше.
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
