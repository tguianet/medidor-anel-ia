// Service worker do Medidor de Anel (PWA).
// Estratégia: rede primeiro (sempre pega a versão mais nova quando há internet)
// e usa o cache só quando estiver sem conexão. Assim uma atualização publicada
// chega ao app instalado sem ficar presa numa versão antiga.
const CACHE = "medidor-anel-v2";
const SHELL = ["/v2", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // fontes, CDNs: direto da rede
  if (url.pathname.startsWith("/.netlify/")) return; // funções: nunca cachear
  // Página (HTML): sempre revalida no servidor, para nunca abrir versão velha.
  const fresh = req.mode === "navigate" ? fetch(req, { cache: "no-cache" }) : fetch(req);
  event.respondWith(
    fresh
      .then((res) => {
        if (res && res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => undefined);
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) => hit || (req.mode === "navigate" ? caches.match("/v2") : undefined))
          .then((r) => r || new Response("Sem conexão", { status: 503 })),
      ),
  );
});
