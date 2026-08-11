import { useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Points, PointMaterial } from "@react-three/drei";
import * as THREE from "three";
import type { Group, Mesh, Points as PointsType } from "three";
import { useTheme } from "../theme";

/**
 * Scroll-driven 3D scene for the mid-page reel. `progress.v` (0..1) is fed by
 * the parent section's scrollYProgress — the core counter-rotates faster and
 * grows, the particle rings spin up, and the palette shifts violet → cyan.
 */

export type ScrollProgress = { v: number };

/* ---------- Wireframe core ---------- */

function Core({ progress }: { progress: ScrollProgress }) {
  const mesh = useRef<Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  const { theme } = useTheme();
  const light = theme === "light";
  const from = useMemo(() => new THREE.Color(light ? "#6d4aff" : "#7c5cff"), [light]);
  const to = useMemo(() => new THREE.Color(light ? "#0a84a6" : "#22d3ee"), [light]);
  const tmp = useMemo(() => new THREE.Color(), []);

  useFrame((state, delta) => {
    const p = progress.v;
    if (mesh.current) {
      mesh.current.rotation.y -= delta * (0.3 + p * 1.8);
      mesh.current.rotation.x += delta * 0.12;
      const s = 1 + Math.sin(state.clock.elapsedTime * 0.8) * 0.04 + p * 0.35;
      mesh.current.scale.setScalar(s);
    }
    if (mat.current) {
      mat.current.color.copy(tmp.copy(from).lerp(to, p));
    }
  });

  return (
    <mesh ref={mesh}>
      <icosahedronGeometry args={[1.7, 2]} />
      <meshBasicMaterial ref={mat} wireframe transparent opacity={light ? 0.5 : 0.35} />
    </mesh>
  );
}

/* ---------- Orbiting glowing dots ---------- */

function OrbitDots({ progress }: { progress: ScrollProgress }) {
  const group = useRef<Group>(null);
  const colors = ["#22d3ee", "#7c5cff", "#ff5c9d"];

  useFrame((_state, delta) => {
    if (!group.current) return;
    group.current.rotation.y += delta * (0.4 + progress.v * 2.2);
  });

  return (
    <group ref={group}>
      {[0, 1, 2].map((i) => {
        const r = 2.5 + i * 0.8;
        const tilt = (i - 1) * 0.75;
        return (
          <group key={i} rotation={[tilt, i * 1.2, 0]}>
            <mesh position={[r, 0, 0]}>
              <sphereGeometry args={[0.1, 20, 20]} />
              <meshStandardMaterial
                color={colors[i]}
                emissive={colors[i]}
                emissiveIntensity={2.4}
                roughness={0.2}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/* ---------- Flowing particle rings ---------- */

function ParticleRings({ progress }: { progress: ScrollProgress }) {
  const points = useRef<PointsType>(null);
  const { theme } = useTheme();
  const light = theme === "light";

  const positions = useMemo(() => {
    const count = 1100;
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const ring = i % 3;
      const radius = (2.6 + ring * 0.85) * (1 + (Math.random() - 0.5) * 0.05);
      const a = Math.random() * Math.PI * 2;
      const tilt = (ring - 1) * 0.7;
      arr[i * 3] = Math.cos(a) * radius;
      arr[i * 3 + 1] = -Math.sin(a) * radius * Math.sin(tilt);
      arr[i * 3 + 2] = Math.sin(a) * radius * Math.cos(tilt);
    }
    return arr;
  }, []);

  useFrame((state, delta) => {
    if (!points.current) return;
    points.current.rotation.y += delta * (0.35 + progress.v * 4.2);
    points.current.rotation.x += delta * 0.06 * progress.v;
    const s = 0.9 + Math.sin(state.clock.elapsedTime * 0.5) * 0.03;
    points.current.scale.setScalar(s);
  });

  return (
    <Points ref={points} positions={positions} stride={3} frustumCulled={false}>
      <PointMaterial
        transparent
        color={light ? "#5a5fd0" : "#7c8cff"}
        size={0.05}
        sizeAttenuation
        depthWrite={false}
        opacity={light ? 0.5 : 0.65}
      />
    </Points>
  );
}

/* ---------- Mouse parallax rig ---------- */

function Rig({ children }: { children: ReactNode }) {
  const group = useRef<Group>(null);
  const target = useRef({ x: 0, y: 0 });

  useFrame((state, delta) => {
    if (!group.current) return;
    target.current.x += (state.pointer.x * 0.4 - target.current.x) * Math.min(delta * 2.5, 1);
    target.current.y += (state.pointer.y * 0.3 - target.current.y) * Math.min(delta * 2.5, 1);
    group.current.rotation.y = target.current.x * 0.24;
    group.current.rotation.x = target.current.y * 0.16;
    group.current.position.x = target.current.x * 0.5;
    group.current.position.y = target.current.y * 0.35;
  });

  return <group ref={group}>{children}</group>;
}

/* ---------- Canvas wrapper ---------- */

export default function ScrollScene({ progress }: { progress: ScrollProgress }) {
  const [failed, setFailed] = useState(false);

  if (failed) return null;

  return (
    <Canvas
      dpr={[1, 1.6]}
      camera={{ position: [0, 0, 7.5], fov: 45 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      onCreated={(state) => {
        state.gl.setClearColor(0x000000, 0);
      }}
      onError={() => setFailed(true)}
      style={{ background: "transparent" }}
    >
      <ambientLight intensity={0.6} />
      <pointLight position={[6, 6, 6]} intensity={30} color="#7c5cff" />
      <pointLight position={[-6, -4, 4]} intensity={22} color="#22d3ee" />
      <Rig>
        <Core progress={progress} />
        <OrbitDots progress={progress} />
        <ParticleRings progress={progress} />
      </Rig>
    </Canvas>
  );
}
