import { Canvas } from "@react-three/fiber";
import { OrbitControls, Text } from "@react-three/drei";
import { useMemo } from "react";
import type { WellData, SlurryInput, BufferFluid, DrillingFluid } from "@/lib/cementing-calculations";

interface Props {
  wellData: WellData;
  slurries: SlurryInput[];
  buffers: BufferFluid[];
  drillingFluid: DrillingFluid;
}

function HalfCylinder({ radiusTop, radiusBottom, height, position, color, opacity = 1, metalness = 0, roughness = 0.5, side = 0 }: {
  radiusTop: number; radiusBottom: number; height: number; position: [number, number, number];
  color: string; opacity?: number; metalness?: number; roughness?: number; side?: number;
}) {
  return (
    <mesh position={position}>
      <cylinderGeometry args={[radiusTop, radiusBottom, height, 32, 1, false, 0, Math.PI]} />
      <meshStandardMaterial color={color} transparent={opacity < 1} opacity={opacity} metalness={metalness} roughness={roughness} side={side as any} />
    </mesh>
  );
}

function WellScene({ wellData, slurries, buffers, drillingFluid }: Props) {
  const scale = 0.01;
  const totalDepth = wellData.casingDepthMD;
  const holeR = (wellData.holeDiameter / 2) * 0.001 * 60;
  const casingOR = (wellData.casingOD / 2) * 0.001 * 60;
  const casingIR = ((wellData.casingOD - 2 * wellData.casingWall) / 2) * 0.001 * 60;
  const prevCasingIR = (wellData.prevCasingID / 2) * 0.001 * 60;
  const prevCasingOR = (wellData.prevCasingOD / 2) * 0.001 * 60;
  const prevCasingDepth = wellData.prevCasingDepth;
  const h = totalDepth * scale;
  const prevH = prevCasingDepth * scale;

  const cementSections = useMemo(() => {
    const sections: { startY: number; height: number; color: string; name: string }[] = [];
    let currentBottom = 0;
    slurries.forEach((s, i) => {
      if (s.height > 0) {
        const colors = ["#8B7355", "#A0522D", "#CD853F", "#D2691E"];
        sections.push({
          startY: currentBottom,
          height: s.height * scale,
          color: colors[i % colors.length],
          name: s.name,
        });
        currentBottom += s.height * scale;
      }
    });
    return sections;
  }, [slurries, scale]);

  const cementTotalH = cementSections.reduce((s, c) => s + c.height, 0);
  const mudH = h - cementTotalH;

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 5, 5]} intensity={0.8} />
      <directionalLight position={[-3, 3, -3]} intensity={0.3} />

      {/* Formation / borehole wall (open hole below prev casing) — half cylinder */}
      <HalfCylinder radiusTop={holeR} radiusBottom={holeR} height={h - prevH}
        position={[0, -(prevH + (h - prevH) / 2), 0]} color="#6B5B4F" opacity={0.4} side={2} />

      {/* Previous casing — half */}
      <HalfCylinder radiusTop={prevCasingOR} radiusBottom={prevCasingOR} height={prevH}
        position={[0, -prevH / 2, 0]} color="#888" opacity={0.3} side={2} />

      {/* Current casing outer — half */}
      <HalfCylinder radiusTop={casingOR} radiusBottom={casingOR} height={h}
        position={[0, -h / 2, 0]} color="#A0A0A0" opacity={0.85} metalness={0.6} roughness={0.3} side={2} />

      {/* Current casing inner — half */}
      <HalfCylinder radiusTop={casingIR} radiusBottom={casingIR} height={h}
        position={[0, -h / 2, 0]} color="#666" opacity={0.2} side={2} />

      {/* Cement in annulus — solid half-ring segments */}
      {cementSections.map((sec, i) => {
        const yPos = -(h - sec.startY - sec.height / 2);
        return (
          <group key={i}>
            {/* Outer cement surface */}
            <HalfCylinder radiusTop={holeR * 0.98} radiusBottom={holeR * 0.98} height={sec.height}
              position={[0, yPos, 0]} color={sec.color} opacity={0.85} side={2} />
            {/* Inner cement surface (against casing) */}
            <HalfCylinder radiusTop={casingOR * 1.01} radiusBottom={casingOR * 1.01} height={sec.height}
              position={[0, yPos, 0]} color={sec.color} opacity={0.85} />
            {/* Flat cut face to show fill */}
            <mesh position={[0, yPos, 0]} rotation={[0, 0, 0]}>
              <ringGeometry args={[casingOR * 1.01, holeR * 0.98, 32, 1, 0, Math.PI]} />
              <meshStandardMaterial color={sec.color} opacity={0.9} transparent />
            </mesh>
          </group>
        );
      })}

      {/* Drilling fluid above cement in annulus — half */}
      {mudH > 0 && (
        <group>
          <HalfCylinder radiusTop={holeR * 0.97} radiusBottom={holeR * 0.97} height={mudH}
            position={[0, -(mudH / 2), 0]} color="#4A7A5C" opacity={0.4} side={2} />
          <HalfCylinder radiusTop={casingOR * 1.01} radiusBottom={casingOR * 1.01} height={mudH}
            position={[0, -(mudH / 2), 0]} color="#4A7A5C" opacity={0.4} />
          {/* Flat cut face */}
          <mesh position={[0, -(mudH / 2), 0]}>
            <ringGeometry args={[casingOR * 1.01, holeR * 0.97, 32, 1, 0, Math.PI]} />
            <meshStandardMaterial color="#4A7A5C" opacity={0.5} transparent />
          </mesh>
        </group>
      )}

      {/* Inside casing fluid (drilling mud) — half */}
      <HalfCylinder radiusTop={casingIR * 0.99} radiusBottom={casingIR * 0.99} height={h}
        position={[0, -h / 2, 0]} color="#3D6B4E" opacity={0.25} />

      {/* Shoe at bottom */}
      <mesh position={[0, -h + 0.05, 0]}>
        <cylinderGeometry args={[casingOR * 1.1, casingOR * 0.5, 0.1, 16, 1, false, 0, Math.PI]} />
        <meshStandardMaterial color="#FF6B35" />
      </mesh>

      {/* Labels */}
      <Text position={[holeR + 0.3, 0.15, 0]} fontSize={0.12} color="#666" anchorX="left">
        0 м (устье)
      </Text>
      <Text position={[holeR + 0.3, -h, 0]} fontSize={0.12} color="#666" anchorX="left">
        {totalDepth} м (забой)
      </Text>
      <Text position={[holeR + 0.3, -prevH, 0]} fontSize={0.1} color="#888" anchorX="left">
        Пред. колонна {prevCasingDepth} м
      </Text>

      {cementSections.map((sec, i) => {
        const yPos = -(h - sec.startY - sec.height / 2);
        return (
          <Text key={`label-${i}`} position={[-(holeR + 0.3), yPos, 0]} fontSize={0.09} color={sec.color} anchorX="right">
            {slurries[i]?.name || `ЦР-${i + 1}`}
          </Text>
        );
      })}

      {mudH > 0 && (
        <Text position={[-(holeR + 0.3), -(mudH / 2), 0]} fontSize={0.09} color="#4A7A5C" anchorX="right">
          {drillingFluid.name}
        </Text>
      )}

      <OrbitControls enablePan enableZoom enableRotate target={[0, -h / 2, 0]} />
    </>
  );
}

export default function WellVisualization(props: Props) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card overflow-hidden" style={{ height: "600px" }}>
        <Canvas camera={{ position: [4, -1, 4], fov: 50 }}>
          <WellScene {...props} />
        </Canvas>
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground px-2">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ background: "#A0A0A0" }} /> Обсадная колонна</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ background: "#8B7355" }} /> Цемент</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ background: "#4A7A5C" }} /> Буровой раствор</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ background: "#6B5B4F" }} /> Горная порода</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ background: "#FF6B35" }} /> Башмак</span>
      </div>
    </div>
  );
}
