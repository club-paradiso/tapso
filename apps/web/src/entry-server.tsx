import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import App from "./App";

/** Build-time only: renders the page to static HTML for `scripts/prerender.mjs`. */
export function render(): string {
  return renderToString(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
export { FORBIDDEN_CLAIMS } from "./content/forbiddenClaims.ts";
