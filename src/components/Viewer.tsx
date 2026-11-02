import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid, Bounds, GizmoHelper, GizmoViewport } from "@react-three/drei";
import { useMemo } from "react";
import { geomToThree, type Geom } from "@/lib/jscad-run";

export default function Viewer({ geoms }: { geoms: Geom[] }) {
  const meshes = useMemo(
    () =>
      geoms.map((g) => {
        const c = (g as { color?: number[] }).color;
        return { geo: geomToThree(g), color: c ? `rgb(${c.slice(0, 3).map((x) => Math.round(x * 255)).join(",")})` : "#e8a33d" };
      }),
    [geoms],
  );
  return (
    <Canvas camera={{ position: [80, 60, 80], fov: 45, up: [0, 0, 1] }} dpr={[1, 2]}>
      <ambientLight intensity={0.5} />
      <directionalLight position={[50, 80, 100]} intensity={1.4} />
      <directionalLight position={[-60, -40, -30]} intensity={0.4} />
      <Bounds fit clip observe margin={1.4} key={meshes.length + String(geoms[0]?.polygons?.length)}>
        {meshes.map((m, i) => (
          <mesh key={i} geometry={m.geo}>
            <meshStandardMaterial color={m.color} metalness={0.25} roughness={0.45} />
          </mesh>
        ))}
      </Bounds>
      <Grid rotation={[Math.PI / 2, 0, 0]} infiniteGrid cellSize={5} sectionSize={50} cellColor="#3a3f47" sectionColor="#5b6370" fadeDistance={600} />
      <OrbitControls makeDefault />
      <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
        <GizmoViewport />
      </GizmoHelper>
    </Canvas>
  );
}
