import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import CommercialApp from "./commercial/CommercialApp";
import AppV2 from "./v2/AppV2";
import AppV21 from "./v2/AppV21";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {window.location.pathname.startsWith("/v2-1") ? <AppV21 /> : window.location.pathname.startsWith("/v2") ? <AppV2 /> : <CommercialApp />}
  </StrictMode>,
);
