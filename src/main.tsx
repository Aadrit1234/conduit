import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./components.css";
import App from "./App";
import { ThemeProvider, THEME_STORAGE_KEY } from "./theme";

// Apply the saved/system theme before first paint so there's no flash of the wrong theme.
(function initTheme() {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
  document.documentElement.dataset.theme =
    saved === "light" || saved === "dark" ? saved : prefersLight ? "light" : "dark";
})();

// ?selftest=1 runs the standalone WebRTC pipeline self-test (no app UI).
if (new URLSearchParams(window.location.search).get("selftest") === "1") {
  void import("./webrtc/selftest").then(({ renderSelfTest }) => renderSelfTest(document.getElementById("root")!));
} else {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </StrictMode>
  );
}
