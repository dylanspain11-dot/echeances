// Hors ligne : l'appli s'ouvre sans réseau (fichiers en cache) ; les données vivent dans IndexedDB.
const CACHE = "echeances-v18";
const FICHIERS = ["./", "index.html", "css/app.css", "manifest.webmanifest", "icones/icone-192.png",
  "js/app.js", "js/dates.js", "js/jauge.js", "js/fusion.js", "js/modeles.js", "js/google.js", "js/stockage.js", "js/config.js", "js/parser/index.js", "js/parser/texte.js", "js/parser/dates.js", "js\/commandes.js", "js\/timeline.js"];

self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FICHIERS)).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil(
  caches.keys().then((k) => Promise.all(k.filter((n) => n !== CACHE).map((n) => caches.delete(n)))).then(() => self.clients.claim())));

// Réseau d'abord pour nos fichiers (mises à jour immédiates), cache en secours ; Google jamais en cache.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // « no-cache » : revalide auprès du serveur (GitHub Pages met 10 min de cache HTTP) — bug du 17/11/2026
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then((r) => {
    const copie = r.clone();
    caches.open(CACHE).then((c) => c.put(e.request, copie));
    return r;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match("index.html"))));
});
