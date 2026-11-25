// ReadHound service worker.
// - Built files (/assets/*, content-hashed): cache-first; a name never changes content.
// - The app pages: network-first, but a slow network (over 2.5 s) or none gets
//   the cached copy; the late response still refreshes the cache for next time.
//   On install the child page is fetched and every script/style it references
//   is cached too, so reading works offline from the first visit.
// - Read-aloud audio: cache-first once fetched.
// - Other API calls: network only (progress must reach the server).
const SHELL_CACHE = "readhound-shell-v5";
const AUDIO_CACHE = "readhound-audio-v1";
const STATIC = ["/manifest.webmanifest", "/icon.svg", "/icon-180.png"];

async function precache() {
  const c = await caches.open(SHELL_CACHE);
  const res = await fetch("/", { cache: "no-cache" });
  if (!res.ok) return;
  const html = await res.clone().text();
  await c.put("/", res);
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  await c.addAll([...new Set([...assets, ...STATIC])]);
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache().catch(() => {}));
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
    event.respondWith(cacheFirst(AUDIO_CACHE, req));
    return;
  }
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(SHELL_CACHE, req));
    return;
  }

  // pages and other static files: network first, cached copy if slow or offline
  event.respondWith(caches.open(SHELL_CACHE).then(async (c) => {
    const key = req.mode === "navigate" ? new Request(url.pathname) : req;
    const fresh = fetch(req).then((res) => {
      if (res.ok && res.type === "basic") c.put(key, res.clone());
      return res;
    });
    event.waitUntil(fresh.then(() => {}, () => {}));
    const cached = () => c.match(key, { ignoreSearch: true }).then((hit) => hit || (req.mode === "navigate" ? c.match("/") : undefined));
    const slow = new Promise((r) => setTimeout(r, 2500)).then(cached);
    try {
      // whichever comes first: the network, or (after 2.5 s) a cached copy
      return await Promise.race([fresh, slow.then((hit) => hit || fresh)]);
    } catch {
      return (await cached()) || Response.error();
    }
  }));
});

async function cacheFirst(name, req) {
  const c = await caches.open(name);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) c.put(req, res.clone());
  return res;
}
