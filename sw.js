const CACHE_NAME = "sitelog-cache-v1";
const CORE_ASSETS = [
  "./index.html",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Cache-first for app shell; network-first (with cache fallback) for everything else.
// Never intercept calls to api.anthropic.com or Google Apps Script sync endpoints.
self.addEventListener("fetch", (e) => {
  const url = e.request.url;
  if(url.includes("api.anthropic.com") || url.includes("api.deepseek.com") || url.includes("script.google.com")) return;

  if(CORE_ASSETS.some((a) => url.endsWith(a.replace("./","")))){
    e.respondWith(
      caches.match(e.request).then((cached) => cached || fetch(e.request))
    );
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(e.request, resClone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
