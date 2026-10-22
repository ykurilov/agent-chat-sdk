import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";

// Palette styles are global: the compatibility route deliberately loads only Tandem.
const tandemStyles = new URLSearchParams(location.search).get("skin") === "tandem"
  || ["/memory", "/sandbox", "/messengers", "/skills", "/mcp"].includes(location.pathname);
if (tandemStyles) await import("./styles.css");
else await import("./oduvanchik.css");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
