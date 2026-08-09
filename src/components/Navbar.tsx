import { useEffect, useState } from "react";
import { motion, AnimatePresence, useScroll, useMotionValueEvent } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Menu, X, Radio } from "lucide-react";
import { Magnetic } from "./Magnetic";
import { ThemeToggle } from "./ThemeToggle";

const links = [
  { label: "Features", href: "#features" },
  { label: "How it works", href: "#how" },
  { label: "Security", href: "#security" },
  { label: "Architecture", href: "#architecture" },
];

export function Navbar() {
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const { scrollY } = useScroll();

  useMotionValueEvent(scrollY, "change", (v) => setScrolled(v > 24));

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <motion.header
        initial={{ y: -80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        className="nav"
        style={{
          background: scrolled ? "var(--nav-bg)" : "transparent",
          borderBottom: scrolled ? "1px solid var(--border)" : "1px solid transparent",
          backdropFilter: scrolled ? "blur(18px)" : "none",
        }}
      >
        <div className="container nav-inner">
          <a href="/" className="logo" onClick={(e) => { e.preventDefault(); navigate("/"); window.scrollTo({ top: 0 }); }}>
            <span className="logo-mark">
              <Radio size={17} />
            </span>
            <span className="logo-name">conduit</span>
            <span className="logo-beta">beta</span>
          </a>

          <nav className="nav-links">
            {links.map((l) => (
              <a key={l.href} href={l.href} className="nav-link">
                <span>{l.label}</span>
              </a>
            ))}
          </nav>

          <div className="nav-actions">
            <ThemeToggle />
            <Magnetic strength={0.25}>
              <button className="btn btn-primary btn-sm" onClick={() => navigate("/room")}>
                Launch a room
              </button>
            </Magnetic>
            <button className="nav-burger" onClick={() => setOpen(true)} aria-label="Open menu">
              <Menu size={20} />
            </button>
          </div>
        </div>
      </motion.header>

      <AnimatePresence>
        {open && (
          <motion.div
            className="mobile-menu"
            initial={{ opacity: 0, clipPath: "circle(0% at 100% 0%)" }}
            animate={{ opacity: 1, clipPath: "circle(140% at 100% 0%)" }}
            exit={{ opacity: 0, clipPath: "circle(0% at 100% 0%)" }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="mobile-menu-top">
              <span className="logo-name">conduit</span>
              <div className="mobile-menu-actions">
                <ThemeToggle />
                <button className="nav-burger" onClick={() => setOpen(false)} aria-label="Close menu">
                  <X size={22} />
                </button>
              </div>
            </div>
            <div className="mobile-menu-links">
              {links.map((l, i) => (
                <motion.a
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  initial={{ opacity: 0, x: -24 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.15 + i * 0.07 }}
                >
                  {l.label}
                </motion.a>
              ))}
            </div>
            <motion.button
              className="btn btn-primary"
              onClick={() => {
                setOpen(false);
                navigate("/room");
              }}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45 }}
            >
              Launch a room
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
