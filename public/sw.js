// ReadHound service worker.
// - App shell: network-first, but a slow network (over 2.5 s) or none gets
//   the cached copy, which the late response then refreshes for next time.
// - Read-aloud audio: cache-first once fetched, so a story heard once can be
//   heard again offline.
// - Other API calls: network only (progress must reach the server).
const SHELL_CACHE = "readhound-shell-v4";
const AUDIO_CACHE = "readhound-audio-v1";
const SHELL = ["/", "/index.html", "/styles.css", "/app.js", "/pup.js", "/ui.js", "/icon.svg", "/manifest.webmanifest"];

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
    const fresh = fetch(req).then((res) => {
      if (res.ok) c.put(req, res.clone());
      return res;
    });
    event.waitUntil(fresh.then(() => {}, () => {}));
    const cached = () => c.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === "navigate" ? c.match("/index.html") : undefined));
    const slow = new Promise((r) => setTimeout(r, 2500)).then(cached);
    try {
      // whichever comes first: the network, or (after 2.5 s) a cached copy
      const res = await Promise.race([fresh, slow.then((hit) => hit || fresh)]);
      return res;
    } catch {
      return (await cached()) || Response.error();
    }
  }));
});
