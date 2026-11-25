// ReadHound service worker (skeleton).
// Goal: today's article + its audio stay readable offline.
// Phase-1 will pre-cache the daily pick on first load of the day.
const CACHE = "readhound-v1";
const SHELL = ["/", "/styles.css", "/app.js", "/icon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) return; // live data, never cached here
  event.respondWith(
    caches.match(event.request).then((hit) => hit || fetch(event.request))
  );
});
