import { type ReactNode, type MouseEvent } from "react";
import { motion, useMotionValue, useSpring, useReducedMotion } from "framer-motion";

/**
 * 3D perspective tilt with a cursor-following spotlight.
 * Sets --tilt-x/--tilt-y (spotlight position) on the element so CSS can paint
 * a radial glow that tracks the pointer inside the card.
 */
export function Tilt({
  children,
  className,
  max = 9,
}: {
  children: ReactNode;
  className?: string;
  max?: number;
}) {
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const srx = useSpring(rx, { stiffness: 260, damping: 22 });
  const sry = useSpring(ry, { stiffness: 260, damping: 22 });
  const reduce = useReducedMotion();

  function onMove(e: MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    e.currentTarget.style.setProperty("--tilt-x", `${(e.clientX - rect.left).toFixed(0)}px`);
    e.currentTarget.style.setProperty("--tilt-y", `${(e.clientY - rect.top).toFixed(0)}px`);
    if (reduce) return;
    ry.set(px * max * 2);
    rx.set(-py * max * 2);
  }

  function onLeave() {
    rx.set(0);
    ry.set(0);
  }

  return (
    <motion.div
      className={className}
      style={{ rotateX: srx, rotateY: sry, transformStyle: "preserve-3d", perspective: 900 }}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
    >
      {children}
    </motion.div>
  );
}
