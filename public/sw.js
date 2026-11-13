/* Word Atlas offline cache: app shell network-first, everything else cache-first. */
const VERSION = "atlas-v3";
const SHELL = `${VERSION}-shell`;
const MEDIA = `${VERSION}-media`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => !k.startsWith(VERSION))
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function trim(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || req.headers.has("range")) return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || /^\/api(?:\/|$)/.test(url.pathname))
    return;
  const isShell =
    req.mode === "navigate" || url.pathname.endsWith("/index.json");
  if (isShell) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            // Clone before returning the network response; the browser may consume its body immediately.
            const copy = res.clone();
            event.waitUntil(
              caches
                .open(SHELL)
                .then((cache) => cache.put(req, copy))
                .catch(() => {}),
            );
          }
          return res;
        })
        .catch(() =>
          caches
            .match(req)
            .then(
              (hit) =>
                hit ||
                caches.match(new URL("./", self.registration.scope).href),
            ),
        ),
    );
    return;
  }
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && res.type === "basic") {
            const copy = res.clone();
            const name = /\/atlas\/(img|thumb|audio)\//.test(url.pathname)
              ? MEDIA
              : SHELL;
            event.waitUntil(
              caches
                .open(name)
                .then((cache) => cache.put(req, copy))
                .then(() => name === MEDIA && trim(MEDIA, 1500))
                .catch(() => {}),
            );
          }
          return res;
        }),
    ),
  );
});
