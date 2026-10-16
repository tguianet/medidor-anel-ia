import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import CommercialApp from "./commercial/CommercialApp";
import AppV2 from "./v2/AppV2";
import "./styles.css";

// Versao de teste congelada: /medidordedov24 mostra a v2 com um selo fixo
// para o testador saber em qual versao esta.
const VERSION_ROUTE = "/medidordedov24";
const path = window.location.pathname;
const isVersionRoute = path.startsWith(VERSION_ROUTE);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isVersionRoute || path.startsWith("/v2") ? <AppV2 /> : <CommercialApp />}
    {isVersionRoute && (
      <div
        style={{
          position: "fixed", top: 8, right: 8, zIndex: 99999, pointerEvents: "none",
          background: "#1f6feb", color: "#fff", font: "700 12px/1 system-ui, sans-serif",
          padding: "6px 9px", borderRadius: 999, boxShadow: "0 2px 8px rgba(0,0,0,.35)",
        }}
      >
        medidordedov24
      </div>
    )}
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
