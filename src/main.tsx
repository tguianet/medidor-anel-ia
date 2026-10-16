import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import CommercialApp from "./commercial/CommercialApp";
import AppV2 from "./v2/AppV2";
import PartialFingerV22 from "./v22/PartialFingerV22";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {window.location.pathname.startsWith("/v2-2") ? <PartialFingerV22 /> : window.location.pathname.startsWith("/v2") ? <AppV2 /> : <CommercialApp />}
  </StrictMode>,
);

// PWA: registra o service worker (app instalável no celular).
if ("serviceWorker" in navigator && window.location.protocol === "https:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}

// Guarda o pedido de instalação do Android/Chrome para o botão "Instalar app".
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  (window as unknown as { __mdaInstall?: Event }).__mdaInstall = event;
  window.dispatchEvent(new Event("mda-install-ready"));
});
