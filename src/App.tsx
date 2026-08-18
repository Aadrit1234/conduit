import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Navbar } from "./components/Navbar";
import { Hero } from "./components/Hero";
import { Marquee } from "./components/Marquee";
import { Features } from "./components/Features";
import { HowItWorks } from "./components/HowItWorks";
import { Security } from "./components/Security";
import { ScrollReel } from "./components/ScrollReel";
import { Architecture } from "./components/Architecture";
import { CTA } from "./components/CTA";
import { Footer } from "./components/Footer";
import { RoomDemo } from "./components/RoomDemo";
import { Admin } from "./components/Admin";

function Landing() {
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);
  return (
    <>
      <Navbar />
      <main>
        <Hero />
        <Marquee />
        <Features />
        <ScrollReel />
        <HowItWorks />
        <Security />
        <Architecture />
        <CTA />
      </main>
      <Footer />
    </>
  );
}

function RoomRoute() {
  const { code } = useParams();
  const navigate = useNavigate();
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [code]);
  return <RoomDemo initialCode={code} onExit={() => navigate("/")} />;
}

const fadeIn = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  transition: { duration: 0.4, ease: "easeOut" as const },
};

function CursorSpotlight() {
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      // set synchronously — no rAF, so the glow tracks the pointer even in
      // throttled/backgrounded tabs where requestAnimationFrame is paused
      document.documentElement.style.setProperty("--spot-x", `${e.clientX}px`);
      document.documentElement.style.setProperty("--spot-y", `${e.clientY}px`);
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => window.removeEventListener("mousemove", onMove);
  }, []);
  return <div className="cursor-spotlight" aria-hidden="true" />;
}

export default function App() {
  return (
    <>
      <CursorSpotlight />
      <div className="backdrop" aria-hidden="true">
        <div className="noise" />
        <div className="backdrop-grid" />
        <div className="orb orb-1" />
        <div className="orb orb-2" />
        <div className="orb orb-3" />
      </div>

      <BrowserRouter>
        <Routes>
          <Route path="/" element={<motion.div key="landing" {...fadeIn}><Landing /></motion.div>} />
          {/* one route for /room and /room/:code so creating a room just updates the URL */}
          <Route path="/room/:code?" element={<motion.div key="room" {...fadeIn}><RoomRoute /></motion.div>} />
          <Route path="/admin" element={<motion.div key="admin" {...fadeIn}><Admin /></motion.div>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </>
  );
}
