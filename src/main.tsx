import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import CommercialApp from "./commercial/CommercialApp";
import AppV2 from "./v2/AppV2";
import "./styles.css";

// Dentro do app nativo (Capacitor) sempre abre o medidor v2.
const isNativeApp = Boolean(
  (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.(),
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isNativeApp || window.location.pathname.startsWith("/v2") ? <AppV2 /> : <CommercialApp />}
  </StrictMode>,
);

// PWA: registra o service worker (app instalável no celular).
if (!isNativeApp && "serviceWorker" in navigator && window.location.protocol === "https:") {
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
