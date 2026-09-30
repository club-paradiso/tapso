import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import App from "./App";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/surfaces.css";
import "./styles/sections.css";
import "./styles/forms.css";
import "./support-million.css";

const root = document.getElementById("root")!;
const app = (
  <StrictMode>
    <App />
  </StrictMode>
);

// The production build ships the page prerendered (scripts/prerender.mjs), so
// the content is readable before any JavaScript runs; hydrate it in place.
// The dev server serves an empty root and renders from scratch.
if (root.hasChildNodes()) hydrateRoot(root, app);
else createRoot(root).render(app);
