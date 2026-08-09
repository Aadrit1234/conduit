import { useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float, MeshDistortMaterial, Points, PointMaterial } from "@react-three/drei";
import * as THREE from "three";
import type { Group, Points as PointsType } from "three";
import { useTheme } from "../theme";

/* ---------- Particle network ---------- */

function ParticleField({ count = 1500 }: { count?: number }) {
  const points = useRef<PointsType>(null);
  const { theme } = useTheme();
  const light = theme === "light";

  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 9 + Math.random() * 14;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      arr[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      arr[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.7;
      arr[i * 3 + 2] = r * Math.cos(phi);
    }
    return arr;
  }, [count]);

  useFrame((_state, delta) => {
    if (!points.current) return;
    points.current.rotation.y += delta * 0.02;
    points.current.rotation.x += delta * 0.006;
  });

  return (
    <Points ref={points} positions={positions} stride={3} frustumCulled={false}>
      <PointMaterial
        transparent
        color={light ? "#5a5fd0" : "#7c8cff"}
        size={0.045}
        sizeAttenuation
        depthWrite={false}
        opacity={light ? 0.55 : 0.7}
      />
    </Points>
  );
}

/* ---------- Morphing core blob ---------- */

function CoreBlob() {
  const mesh = useRef<THREE.Mesh>(null);
  const { theme } = useTheme();
  const light = theme === "light";

  useFrame((state) => {
    if (!mesh.current) return;
    mesh.current.rotation.y += 0.0018;
    mesh.current.rotation.x += 0.0009;
    const s = 1 + Math.sin(state.clock.elapsedTime * 0.5) * 0.05;
    mesh.current.scale.setScalar(s);
  });

  return (
    <Float speed={2} rotationIntensity={0.4} floatIntensity={1.4}>
      <mesh ref={mesh}>
        <icosahedronGeometry args={[2.2, 28]} />
        <MeshDistortMaterial
          color={light ? "#ffffff" : "#0b0c16"}
          emissive={light ? "#6d4aff" : "#3b2f9e"}
          emissiveIntensity={light ? 0.85 : 0.55}
          roughness={light ? 0.28 : 0.18}
          metalness={light ? 0.55 : 0.85}
          distort={0.42}
          speed={2.2}
        />
      </mesh>
      <mesh scale={1.35}>
        <icosahedronGeometry args={[2.2, 3]} />
        <meshBasicMaterial color={light ? "#6d4aff" : "#7c5cff"} wireframe transparent opacity={light ? 0.22 : 0.12} />
      </mesh>
    </Float>
  );
}

/* ---------- Streaming data rings ---------- */

function DataRings() {
  const group = useRef<Group>(null);

  const ringGeo = useMemo(() => new THREE.TorusGeometry(3.6, 0.012, 8, 120), []);

  useFrame((_state, delta) => {
    if (!group.current) return;
    group.current.rotation.z += delta * 0.1;
  });

  return (
    <group ref={group}>
      {[0, 1, 2].map((i) => (
        <mesh
          key={i}
          geometry={ringGeo}
          position={[0, (i - 1) * 1.5, 0]}
          rotation={[Math.PI / 2.6, i * 1.05, 0]}
        >
          <meshBasicMaterial
            color={i === 1 ? "#22d3ee" : "#7c5cff"}
            transparent
            opacity={0.5 - i * 0.14}
          />
        </mesh>
      ))}
    </group>
  );
}

/* ---------- Floating UI nodes (mini "rooms") ---------- */

function FloatingNodes() {
  const nodes: Array<{ pos: [number, number, number]; color: string; speed: number }> = [
    { pos: [-4.4, 2.4, -1], color: "#22d3ee", speed: 2.4 },
    { pos: [4.8, -2.2, -0.5], color: "#7c5cff", speed: 1.8 },
    { pos: [-3.4, -2.8, 0.5], color: "#ff5c9d", speed: 3 },
    { pos: [5.2, 2.6, 0.8], color: "#22d3ee", speed: 2.1 },
  ];

  return (
    <>
      {nodes.map((n, i) => (
        <Float key={i} speed={n.speed} floatIntensity={2.2} rotationIntensity={1.2}>
          <mesh position={n.pos}>
            <octahedronGeometry args={[0.26, 0]} />
            <meshStandardMaterial color={n.color} emissive={n.color} emissiveIntensity={1.6} roughness={0.2} />
          </mesh>
          <mesh position={n.pos} scale={2.2}>
            <octahedronGeometry args={[0.26, 0]} />
            <meshBasicMaterial color={n.color} wireframe transparent opacity={0.35} />
          </mesh>
        </Float>
      ))}
    </>
  );
}

/* ---------- Mouse parallax rig ---------- */

function Rig({ children }: { children: ReactNode }) {
  const group = useRef<Group>(null);
  const target = useRef({ x: 0, y: 0 });

  useFrame((state, delta) => {
    if (!group.current) return;
    target.current.x += (state.pointer.x * 0.35 - target.current.x) * Math.min(delta * 2.5, 1);
    target.current.y += (state.pointer.y * 0.25 - target.current.y) * Math.min(delta * 2.5, 1);
    group.current.rotation.y = target.current.x * 0.22;
    group.current.rotation.x = target.current.y * 0.14;
    group.current.position.x = target.current.x * 0.4;
    group.current.position.y = target.current.y * 0.3;
  });

  return <group ref={group}>{children}</group>;
}

/* ---------- Canvas wrapper ---------- */

export default function HeroScene() {
  const [failed, setFailed] = useState(false);

  if (failed) return null;

  return (
    <Canvas
      dpr={[1, 1.8]}
      camera={{ position: [0, 0, 10], fov: 42 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      onCreated={(state) => {
        state.gl.setClearColor(0x000000, 0);
      }}
      onError={() => setFailed(true)}
      style={{ background: "transparent" }}
    >
      <ambientLight intensity={0.5} />
      <pointLight position={[6, 6, 6]} intensity={40} color="#7c5cff" />
      <pointLight position={[-6, -4, 4]} intensity={30} color="#22d3ee" />
      <Rig>
        <CoreBlob />
        <DataRings />
        <FloatingNodes />
        <ParticleField />
      </Rig>
    </Canvas>
  );
}
