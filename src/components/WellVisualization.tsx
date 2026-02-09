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

function WellScene({ wellData, slurries, buffers, drillingFluid }: Props) {
  const scale = 0.01; // м -> scene units
  const totalDepth = wellData.casingDepthMD;
  const holeR = (wellData.holeDiameter / 2) * 0.001 * 60; // exaggerate radial scale
  const casingOR = (wellData.casingOD / 2) * 0.001 * 60;
  const casingIR = ((wellData.casingOD - 2 * wellData.casingWall) / 2) * 0.001 * 60;
  const prevCasingIR = (wellData.prevCasingID / 2) * 0.001 * 60;
  const prevCasingOR = (wellData.prevCasingOD / 2) * 0.001 * 60;
  const prevCasingDepth = wellData.prevCasingDepth;
  const h = totalDepth * scale;
  const prevH = prevCasingDepth * scale;

  // Cement fills from bottom up
  const cementSections = useMemo(() => {
    const sections: { startY: number; height: number; color: string; name: string }[] = [];
    let currentBottom = 0; // from bottom of well
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

      {/* Formation / borehole wall (open hole below prev casing) */}
      <mesh position={[0, -(prevH + (h - prevH) / 2), 0]}>
        <cylinderGeometry args={[holeR, holeR, h - prevH, 32, 1, true]} />
        <meshStandardMaterial color="#6B5B4F" side={2} transparent opacity={0.3} />
      </mesh>

      {/* Previous casing */}
      <mesh position={[0, -prevH / 2, 0]}>
        <cylinderGeometry args={[prevCasingOR, prevCasingOR, prevH, 32, 1, true]} />
        <meshStandardMaterial color="#888" side={2} transparent opacity={0.25} />
      </mesh>

      {/* Current casing (full depth) */}
      <mesh position={[0, -h / 2, 0]}>
        <cylinderGeometry args={[casingOR, casingOR, h, 32, 1, true]} />
        <meshStandardMaterial color="#A0A0A0" metalness={0.6} roughness={0.3} side={2} />
      </mesh>

      {/* Inside casing (darker) */}
      <mesh position={[0, -h / 2, 0]}>
        <cylinderGeometry args={[casingIR, casingIR, h, 32, 1, true]} />
        <meshStandardMaterial color="#555" side={2} transparent opacity={0.15} />
      </mesh>

      {/* Cement in annulus (between casing OD and hole/prev casing ID) */}
      {cementSections.map((sec, i) => {
        const yPos = -(h - sec.startY - sec.height / 2);
        return (
          <group key={i}>
            {/* Outer cement ring */}
            <mesh position={[0, yPos, 0]}>
              <cylinderGeometry args={[holeR * 0.98, holeR * 0.98, sec.height, 32, 1, true]} />
              <meshStandardMaterial color={sec.color} side={2} transparent opacity={0.7} />
            </mesh>
          </group>
        );
      })}

      {/* Drilling fluid above cement in annulus */}
      {mudH > 0 && (
        <mesh position={[0, -(mudH / 2), 0]}>
          <cylinderGeometry args={[holeR * 0.97, holeR * 0.97, mudH, 32, 1, true]} />
          <meshStandardMaterial color="#4A7A5C" side={2} transparent opacity={0.35} />
        </mesh>
      )}

      {/* Shoe at bottom */}
      <mesh position={[0, -h + 0.05, 0]}>
        <cylinderGeometry args={[casingOR * 1.1, casingOR * 0.5, 0.1, 16]} />
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

      {/* Cement labels */}
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
