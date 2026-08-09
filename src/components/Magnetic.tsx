import { useRef, type ReactNode, type MouseEvent } from "react";
import { motion, useReducedMotion } from "framer-motion";

export function Magnetic({
  children,
  strength = 0.35,
  className,
}: {
  children: ReactNode;
  strength?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  function onMove(e: MouseEvent) {
    if (reduce || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const x = (e.clientX - rect.left - rect.width / 2) * strength;
    const y = (e.clientY - rect.top - rect.height / 2) * strength;
    ref.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }

  function onLeave() {
    if (ref.current) ref.current.style.transform = "translate3d(0,0,0)";
  }

  return (
    <motion.div
      ref={ref}
      className={className}
      style={{ display: "inline-block", transition: "transform 0.35s cubic-bezier(0.22, 1, 0.36, 1)" }}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
    >
      {children}
    </motion.div>
  );
}
