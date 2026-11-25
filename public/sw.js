// ReadHound service worker.
// - App shell: network-first, cached copy when offline.
// - Read-aloud audio: cache-first once fetched, so a story heard once can be
//   heard again offline.
// - Other API calls: network only (progress must reach the server).
const SHELL_CACHE = "readhound-shell-v3";
const AUDIO_CACHE = "readhound-audio-v1";
const SHELL = ["/", "/index.html", "/styles.css", "/app.js", "/pup.js", "/icon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (![SHELL_CACHE, AUDIO_CACHE].includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (url.pathname.startsWith("/api/audio/")) {
    event.respondWith(caches.open(AUDIO_CACHE).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  if (url.pathname.startsWith("/api/")) return;

  // shell: network first (a deploy is picked up at once), cache when offline
  event.respondWith(caches.open(SHELL_CACHE).then(async (c) => {
    try {
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    } catch {
      return (await c.match(req, { ignoreSearch: true })) || (await c.match("/index.html")) || Response.error();
    }
  }));
});
