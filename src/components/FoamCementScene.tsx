import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { FoamFrame, FoamFluidKind } from "@/lib/foam-cement-types";
import type { WellData } from "@/lib/cementing-calculations";
import {
  getCavernCoeffAtDepth,
  interpolateTVD,
} from "@/lib/cementing-calculations";
const colors: Record<FoamFluidKind, string> = {
  mud: "#8b7355",
  buffer: "#38bdf8",
  foam: "#e7bd54",
  displacement: "#a78bfa",
};
function Scene({ frame, wellData }: { frame: FoamFrame; wellData: WellData }) {
  const segments = useMemo(() => {
    const w = wellData,
      scale = 7 / w.casingDepthMD;
    const point = (md: number) => {
      let x = 0,
        z = 0;
      for (let i = 1; i < w.trajectory.length; i++) {
        const a = w.trajectory[i - 1],
          b = w.trajectory[i],
          len = Math.max(0, Math.min(md, b.md) - a.md),
          zen = ((a.zenith + b.zenith) * Math.PI) / 360,
          az = ((a.azimuth + b.azimuth) * Math.PI) / 360;
        x += len * Math.sin(zen) * Math.cos(az);
        z += len * Math.sin(zen) * Math.sin(az);
      }
      return new THREE.Vector3(
        x * scale,
        -interpolateTVD(md, w.trajectory) * scale,
        z * scale,
      );
    };
    const middle = point(w.casingDepthMD).multiplyScalar(0.5);
    return frame.cells.map((c) => {
      const a = point(c.mdTop).sub(middle),
        b = point(c.mdBottom).sub(middle),
        direction = b.clone().sub(a),
        length = direction.length(),
        rotation = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          direction.normalize(),
        );
      const hole =
        c.md <= w.prevCasingDepth
          ? w.prevCasingID
          : w.holeDiameter *
            Math.sqrt(
              getCavernCoeffAtDepth(c.md, w.cavernCoeff, w.cavernIntervals),
            );
      const radialScale = 0.35 / w.holeDiameter;
      return {
        cell: c,
        position: a.add(b).multiplyScalar(0.5),
        rotation,
        length,
        outer: hole * radialScale,
        pipe: w.casingOD * radialScale,
        inner:
          Math.sqrt(c.leg === "pipe" ? (c.areaM2 * 4) / Math.PI : 0) *
          1000 *
          radialScale,
      };
    });
  }, [frame, wellData]);
  return (
    <>
      <ambientLight intensity={1.4} />
      <directionalLight position={[6, 10, 5]} intensity={2} />
      <pointLight position={[-5, -2, 5]} intensity={30} />
      {segments.map(
        ({ cell: c, position, rotation, length, outer, pipe, inner }, i) => {
          const kind = (Object.keys(colors) as FoamFluidKind[]).reduce(
            (k, next) => (c.fractions[next] > c.fractions[k] ? next : k),
            "mud",
          );
          return (
            <group key={i} position={position} quaternion={rotation}>
              {c.leg === "annulus" ? (
                <>
                  <mesh>
                    <cylinderGeometry
                      args={[
                        outer,
                        outer,
                        length,
                        32,
                        1,
                        true,
                        Math.PI / 4,
                        Math.PI * 1.5,
                      ]}
                    />
                    <meshStandardMaterial
                      color={colors[kind]}
                      side={THREE.DoubleSide}
                      transparent
                      opacity={0.78}
                      roughness={0.65}
                    />
                  </mesh>
                  <mesh>
                    <cylinderGeometry
                      args={[outer * 1.015, outer * 1.015, length, 16, 1, true]}
                    />
                    <meshBasicMaterial
                      color="#64748b"
                      wireframe
                      transparent
                      opacity={0.12}
                    />
                  </mesh>
                  <mesh
                    rotation={[Math.PI / 2, 0, 0]}
                    position={[0, length / 2, 0]}
                  >
                    <ringGeometry
                      args={[pipe, outer, 32, 1, Math.PI / 4, Math.PI * 1.5]}
                    />
                    <meshStandardMaterial
                      color={colors[kind]}
                      side={THREE.DoubleSide}
                      transparent
                      opacity={0.7}
                    />
                  </mesh>
                </>
              ) : (
                <>
                  <mesh>
                    <cylinderGeometry
                      args={[inner * 0.98, inner * 0.98, length, 24]}
                    />
                    <meshStandardMaterial
                      color={colors[kind]}
                      roughness={0.6}
                    />
                  </mesh>
                  <mesh>
                    <cylinderGeometry
                      args={[
                        pipe,
                        pipe,
                        length,
                        32,
                        1,
                        true,
                        Math.PI / 4,
                        Math.PI * 1.5,
                      ]}
                    />
                    <meshStandardMaterial
                      color="#a8b4c5"
                      metalness={0.7}
                      roughness={0.3}
                      side={THREE.DoubleSide}
                      transparent
                      opacity={0.35}
                    />
                  </mesh>
                </>
              )}
            </group>
          );
        },
      )}
      <OrbitControls makeDefault enablePan minDistance={3} maxDistance={18} />
    </>
  );
}
export default function FoamCementScene(props: {
  frame: FoamFrame;
  wellData: WellData;
}) {
  return (
    <div
      className="h-[520px] w-full"
      role="img"
      aria-label="Трёхмерный разрез распределения жидкостей по траектории"
    >
      <Canvas
        camera={{ position: [4, 1, 10], fov: 45 }}
        gl={{ antialias: true, alpha: true }}
      >
        <Scene {...props} />
      </Canvas>
    </div>
  );
}
