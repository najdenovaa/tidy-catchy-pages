import { useMemo } from "react";
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from "recharts";


function Tank({ x, y, width, height, label, capacity, level }: {
  x: number; y: number; width: number; height: number;
  label: string; capacity: number; level: number;
}) {
  const fillRatio = level / capacity;
  const fillH = height * fillRatio;
  return (
    <g>
      {/* Tank body */}
      <rect x={x} y={y} width={width} height={height} rx={4}
        fill="none" stroke="hsl(210,40%,60%)" strokeWidth={2} />
      {/* Fill */}
      <rect x={x + 1} y={y + height - fillH} width={width - 2} height={fillH - 1} rx={2}
        fill="hsl(210,70%,55%)" opacity={0.35} />
      {/* Liquid surface line */}
      <line x1={x + 2} y1={y + height - fillH} x2={x + width - 2} y2={y + height - fillH}
        stroke="hsl(210,80%,50%)" strokeWidth={1.5} />
      {/* Labels */}
      <text x={x + width / 2} y={y - 6} textAnchor="middle"
        fontSize={9} fill="hsl(var(--foreground))" fontWeight={600}>{label}</text>
      <text x={x + width / 2} y={y + height / 2 - 6} textAnchor="middle"
        fontSize={11} fill="hsl(var(--foreground))" fontWeight={700}>
        {level.toFixed(2)} м³
      </text>
      <text x={x + width / 2} y={y + height / 2 + 8} textAnchor="middle"
        fontSize={8} fill="hsl(var(--muted-foreground))">
        / {capacity} м³
      </text>
      {/* Percentage */}
      <text x={x + width / 2} y={y + height + 14} textAnchor="middle"
        fontSize={8} fill="hsl(var(--muted-foreground))">
        {(fillRatio * 100).toFixed(0)}%
      </text>
    </g>
  );
}

function Engine({ x, y, label, rpm, idle }: {
  x: number; y: number; label: string; rpm: number; idle: boolean;
}) {
  const color = idle ? "hsl(40,80%,50%)" : "hsl(120,60%,45%)";
  return (
    <g>
      {/* Motor body */}
      <rect x={x} y={y} width={70} height={44} rx={6}
        fill="hsl(var(--muted))" stroke="hsl(var(--border))" strokeWidth={1.5} />
      {/* Rotor circle */}
      <circle cx={x + 35} cy={y + 18} r={10}
        fill="none" stroke={color} strokeWidth={2} />
      <line x1={x + 35} y1={y + 10} x2={x + 35} y2={y + 26}
        stroke={color} strokeWidth={1.5} />
      <line x1={x + 27} y1={y + 18} x2={x + 43} y2={y + 18}
        stroke={color} strokeWidth={1.5} />
      {/* Label */}
      <text x={x + 35} y={y - 6} textAnchor="middle"
        fontSize={9} fill="hsl(var(--foreground))" fontWeight={600}>{label}</text>
      {/* RPM */}
      <text x={x + 35} y={y + 38} textAnchor="middle"
        fontSize={10} fill={color} fontWeight={700}>
        {rpm} RPM
      </text>
      {/* Status dot */}
      <circle cx={x + 60} cy={y + 6} r={3} fill={color} />
      <text x={x + 35} y={y + 56} textAnchor="middle"
        fontSize={7} fill="hsl(var(--muted-foreground))">
        {idle ? "Холостой ход" : "Работа"}
      </text>
    </g>
  );
}

export default function CementingUnitSchematic() {
  return (
    <div className="w-full h-full flex items-center justify-center">
      <svg viewBox="0 0 380 200" className="w-full h-full"
        preserveAspectRatio="xMidYMid meet">
        {/* Tanks */}
        <Tank x={20} y={30} width={80} height={120} label="Ёмкость №1" capacity={6} level={4.23} />
        <Tank x={130} y={50} width={60} height={100} label="Ёмкость №2" capacity={2} level={1.32} />

        {/* Pipe from tank 1 to engine 1 */}
        <line x1={100} y1={110} x2={130} y2={110} stroke="hsl(var(--border))" strokeWidth={2} />
        {/* Pipe from tank 2 down */}
        <line x1={160} y1={150} x2={160} y2={165} stroke="hsl(var(--border))" strokeWidth={2} />
        <line x1={160} y1={165} x2={230} y2={165} stroke="hsl(var(--border))" strokeWidth={2} />

        {/* Engines */}
        <Engine x={230} y={30} label="Двигатель №1" rpm={900} idle={true} />
        <Engine x={230} y={120} label="Двигатель №2" rpm={1523} idle={false} />

        {/* Pipe from engine 2 to output */}
        <line x1={300} y1={142} x2={340} y2={142} stroke="hsl(var(--border))" strokeWidth={2} />
        <polygon points="340,137 350,142 340,147" fill="hsl(120,60%,45%)" />
        <text x={355} y={145} fontSize={7} fill="hsl(var(--muted-foreground))">→ скв.</text>

        {/* Pipe from engine 1 */}
        <line x1={300} y1={52} x2={340} y2={52} stroke="hsl(var(--border))" strokeWidth={2} strokeDasharray="4 3" />
        <text x={345} y={55} fontSize={7} fill="hsl(var(--muted-foreground))">стоп</text>
      </svg>
    </div>
  );
}
