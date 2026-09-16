const CACHE_NAME = "sweet-daw-cache-0.1.0-20260722021831";
const CACHEABLE_RESPONSE_TYPES = new Set(["basic", "cors", "default"]);

// Install event - skip waiting to activate immediately
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

// Activate event - clean up old caches and claim clients
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cache) => {
            if (cache !== CACHE_NAME) {
              return caches.delete(cache);
            }
          })
        );
      })
      .then(() => self.clients.claim())
  );
});

// Fetch event - cache-first or network-first for fast loads with robust fallback
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Only handle GET requests. Never try to cache POST/PUT uploads or form submissions.
  if (event.request.method !== "GET") {
    event.respondWith(fetch(event.request));
    return;
  }

  // Never cache build/update files. iPhone PWA must always see the newest shell and assets.
  if (
    url.pathname.includes("sweet-daw-build.json") ||
    url.pathname.includes("manifest.webmanifest") ||
    url.pathname.endsWith("/sw.js")
  ) {
    event.respondWith(fetch(event.request));
    return;
  }

  // HTML/app shell must be network-first so UI updates are reflected immediately.
  if (event.request.mode === "navigate" || event.request.headers.get("accept")?.includes("text/html")) {
    event.respondWith(
      fetch(event.request, { cache: "no-store" }).catch(() => caches.match(event.request))
    );
    return;
  }

  // Next.js chunks must prefer the network. A stale/corrupt cached chunk can break upload/export flows.
  if (url.pathname.includes("/_next/static/")) {
    event.respondWith(
      fetch(event.request, { cache: "no-store" })
        .then((networkResponse) => {
          if (isCacheableResponse(networkResponse)) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Audio range requests (seek/streaming) bypass service worker to prevent media playback errors
  if (event.request.headers.get("range")) {
    event.respondWith(fetch(event.request));
    return;
  }

  // CSS must also be network-first on iPhone PWA. A stale missing CSS file makes the app look white.
  if (url.pathname.endsWith(".css")) {
    event.respondWith(
      fetch(event.request, { cache: "no-store" })
        .then((networkResponse) => {
          if (isCacheableResponse(networkResponse)) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Robust Stale-While-Revalidate strategy to prevent any undefined response errors
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Fetch in background and update cache silently
        fetch(event.request)
          .then((networkResponse) => {
            if (isCacheableResponse(networkResponse)) {
              const responseToCache = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, responseToCache);
              });
            }
          })
          .catch(() => {
            // Ignore background fetch failures silently
          });
        return cachedResponse;
      }

      // If not in cache, fetch from network
      return fetch(event.request).then((networkResponse) => {
        if (isCacheableResponse(networkResponse)) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      });
    })
  );
});

function isCacheableResponse(response) {
  return Boolean(response && response.ok && CACHEABLE_RESPONSE_TYPES.has(response.type || "default"));
}
