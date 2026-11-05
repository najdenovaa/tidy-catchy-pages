import { useState, useId, useEffect, lazy, Suspense, Component } from "react";
import type { FoamFrame, FoamFluidKind } from "@/lib/foam-cement-types";
import type { WellData } from "@/lib/cementing-calculations";
const ThreeScene = lazy(() => import("./FoamCementScene"));
class SceneBoundary extends Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
const colors: Record<FoamFluidKind, string> = {
  mud: "#8b7355",
  buffer: "#38bdf8",
  foam: "#e7bd54",
  displacement: "#a78bfa",
};
export default function FoamCement3D({
  frame,
  wellData,
}: {
  frame: FoamFrame;
  wellData: WellData;
}) {
  const [supported, setSupported] = useState(false),
    [use3D, setUse3D] = useState(true);
  useEffect(() => {
    if (typeof window.WebGLRenderingContext === "undefined") return;
    try {
      const canvas = document.createElement("canvas"),
        context = canvas.getContext("webgl2") || canvas.getContext("webgl");
      setSupported(!!context);
      context?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      setSupported(false);
    }
  }, []);
  const [angle, setAngle] = useState(30),
    [zoom, setZoom] = useState(1);
  const id = useId().replace(/:/g, "");
  const depth = wellData.casingDepthMD,
    rotation = (angle * Math.PI) / 180;
  const position = (md: number) => {
    let x = 0,
      y = 0,
      z = 0;
    const t = wellData.trajectory;
    for (let i = 1; i < t.length; i++) {
      const a = t[i - 1],
        b = t[i],
        length = Math.max(0, Math.min(md, b.md) - a.md);
      if (!length) continue;
      const zen = (((a.zenith + b.zenith) / 2) * Math.PI) / 180,
        az = (((a.azimuth + b.azimuth) / 2) * Math.PI) / 180;
      x += length * Math.sin(zen) * Math.cos(az);
      y += length * Math.sin(zen) * Math.sin(az);
      z += length * Math.cos(zen);
    }
    return {
      x: ((x * Math.cos(rotation) + y * Math.sin(rotation)) / depth) * 400,
      y:
        ((z * 0.85 + (y * Math.cos(rotation) - x * Math.sin(rotation)) * 0.25) /
          depth) *
        400,
    };
  };
  const p0 = position(0),
    p1 = position(depth),
    center = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
  const project = (md: number) => {
    const p = position(md);
    return {
      x: 340 + (p.x - center.x) * zoom,
      y: 265 + (p.y - center.y) * zoom,
    };
  };
  const ann = frame.cells.filter((c) => c.leg === "annulus");
  const projection = (
    <div className="rounded-xl bg-slate-950 text-slate-100 p-4 space-y-3">
      <div className="flex justify-between flex-wrap gap-2">
        <strong>Размещение по траектории · {frame.time.toFixed(1)} мин</strong>
        <span className="text-sm text-slate-300">{frame.stage}</span>
      </div>
      <svg
        viewBox="0 0 680 530"
        role="img"
        aria-label="Объёмный вид распределения жидкостей по траектории скважины"
        className="w-full max-h-[600px]"
      >
        <defs>
          <linearGradient id={id}>
            <stop stopColor="#d8e1ec" stopOpacity=".65" />
            <stop offset=".5" stopColor="#475569" stopOpacity=".15" />
            <stop offset="1" stopColor="#e2e8f0" stopOpacity=".45" />
          </linearGradient>
        </defs>
        {ann.map((c, i) => {
          const a = project(c.mdTop),
            b = project(c.mdBottom),
            kind = (Object.keys(colors) as FoamFluidKind[]).reduce(
              (k, next) => (c.fractions[next] > c.fractions[k] ? next : k),
              "mud",
            );
          return (
            <g key={i}>
              <title>
                MD {c.mdTop.toFixed(0)}-{c.mdBottom.toFixed(0)} м;{" "}
                {c.pressureMPaAbs.toFixed(2)} МПа абс.; FQ{" "}
                {c.qualityPct.toFixed(1)}%; ρ {c.density.toFixed(3)} г/см³
              </title>
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={colors[kind]}
                strokeWidth={46}
                opacity=".7"
              />
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={`url(#${id})`}
                strokeWidth={48}
              />
            </g>
          );
        })}
        {frame.cells
          .filter((c) => c.leg === "pipe")
          .map((c, i) => {
            const a = project(c.mdTop),
              b = project(c.mdBottom),
              kind = (Object.keys(colors) as FoamFluidKind[]).reduce(
                (k, next) => (c.fractions[next] > c.fractions[k] ? next : k),
                "mud",
              );
            return (
              <g key={i}>
                <title>
                  Колонна MD {c.md.toFixed(0)} м; FQ {c.qualityPct.toFixed(1)}%;{" "}
                  {c.density.toFixed(3)} г/см³
                </title>
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="#cbd5e1"
                  strokeWidth="23"
                />
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={colors[kind]}
                  strokeWidth="17"
                />
              </g>
            );
          })}
        {[0, 0.25, 0.5, 0.75, 1].map((k) => {
          const p = project(k * depth);
          return (
            <text key={k} x={p.x + 40} y={p.y + 5} fill="#cbd5e1" fontSize="13">
              {(k * depth).toFixed(0)} м MD
            </text>
          );
        })}
        <text x="20" y="510" fill="#94a3b8" fontSize="12">
          Поперечный масштаб увеличен. Цвет ячейки - преобладающая жидкость.
        </text>
      </svg>
      <div className="flex flex-wrap gap-4 text-sm">
        {Object.entries(colors).map(([k, v]) => (
          <span key={k}>
            <i
              style={{ background: v }}
              className="inline-block h-3 w-3 rounded mr-1"
            />
            {
              {
                mud: "Буровой",
                buffer: "Буфер",
                foam: "Пеноцемент",
                displacement: "Продавка",
              }[k]
            }
          </span>
        ))}
      </div>
      <label className="block text-sm">
        Обход {angle}°
        <input
          aria-label="Обход траектории"
          type="range"
          min="-180"
          max="180"
          value={angle}
          onChange={(e) => setAngle(+e.target.value)}
          className="w-full"
        />
      </label>
      <label className="block text-sm">
        Приближение ×{zoom.toFixed(1)}
        <input
          aria-label="Приближение"
          type="range"
          min=".5"
          max="1.5"
          step=".1"
          value={zoom}
          onChange={(e) => setZoom(+e.target.value)}
          className="w-full"
        />
      </label>
      <p className="text-xs text-slate-400">
        Проекция объёмной траектории без WebGL. Центры траектории интегрированы
        по инклинометрии; фронт смешанной ячейки приближён сеткой. Положение и
        состав взяты из выбранного расчётного кадра.
      </p>
    </div>
  );
  if (!supported || !use3D)
    return (
      <div>
        {supported && (
          <button
            className="text-sm underline p-2"
            onClick={() => setUse3D(true)}
          >
            Открыть 3D-разрез
          </button>
        )}
        {projection}
      </div>
    );
  return (
    <SceneBoundary fallback={projection}>
      <div className="rounded-xl bg-slate-950 p-4 text-slate-100">
        <strong>
          3D-разрез · {frame.time.toFixed(1)} мин · {frame.stage}
        </strong>
        <Suspense fallback={<p>Подготовка 3D…</p>}>
          <ThreeScene frame={frame} wellData={wellData} />
        </Suspense>
        <p className="text-sm">
          Вращайте и приближайте мышью или касанием. Буровой - коричневый; буфер
          - голубой; пена - золотой; продавка - фиолетовая.
        </p>
        <p className="text-xs text-slate-400">
          Поперечный масштаб усилен. Цвет - преобладающая жидкость ячейки;
          числовые профили и положение взяты из выбранного кадра. Устойчивость
          структуры пены не визуализируется.
        </p>
        <button
          className="text-sm underline p-2"
          onClick={() => setUse3D(false)}
        >
          Упрощённая проекция без WebGL
        </button>
      </div>
    </SceneBoundary>
  );
}
