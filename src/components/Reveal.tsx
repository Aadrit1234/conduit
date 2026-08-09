import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

type Dir = "up" | "down" | "left" | "right" | "none";

const offsets: Record<Dir, { x: number; y: number }> = {
  up: { x: 0, y: 44 },
  down: { x: 0, y: -44 },
  left: { x: 44, y: 0 },
  right: { x: -44, y: 0 },
  none: { x: 0, y: 0 },
};

export function Reveal({
  children,
  dir = "up",
  delay = 0,
  className,
  once = true,
}: {
  children: ReactNode;
  dir?: Dir;
  delay?: number;
  className?: string;
  once?: boolean;
}) {
  const reduce = useReducedMotion();
  const { x, y } = offsets[dir];
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, x: reduce ? 0 : x, y: reduce ? 0 : y, filter: "blur(6px)" }}
      whileInView={{ opacity: 1, x: 0, y: 0, filter: "blur(0px)" }}
      viewport={{ once, margin: "-80px" }}
      transition={{ duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
