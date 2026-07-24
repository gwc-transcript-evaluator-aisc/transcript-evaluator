import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { loadRuntimeConfig } from "./lib/runtimeConfig";
import "./index.css";

// Resolve API endpoints from the deploy-time /config.json (falling back to env vars
// for local dev) before rendering, so API clients read final values on first use.
loadRuntimeConfig().finally(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});
