import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import CommercialApp from "./commercial/CommercialApp";
import AppV2 from "./v2/AppV2";
import AppV22 from "./v22/AppV22";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {window.location.pathname.startsWith("/v2-2") ? <AppV22 /> : window.location.pathname.startsWith("/v2") ? <AppV2 /> : <CommercialApp />}
  </StrictMode>,
);
