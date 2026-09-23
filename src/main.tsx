import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import AppV2 from "./v2/AppV2";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {window.location.pathname.startsWith("/v2") ? <AppV2 /> : <App />}
  </StrictMode>,
);
