import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { App } from "./App";
import "./styles.css";

// Console easter egg — because every self-respecting app has one
console.log(
  "%c BoilerDeck ",
  "background: #6c5ce7; color: #fff; font-size: 20px; font-weight: bold; padding: 4px 12px; border-radius: 4px;",
);
console.log(
  "%cThis codebase was mass-produced by Claude Code.\nThe human just mass-watched and mass-hit 'approve'.\nIf you find a bug, it's probably the one thing they wrote themselves.",
  "color: #a29bfe; font-size: 12px;",
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);
