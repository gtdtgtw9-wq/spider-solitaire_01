// Spider Solitaire Service Worker
// キャッシュのバージョンを上げると、古いキャッシュは自動的に破棄されて新しいファイルに入れ替わる。
// index.html / style.css / script.js のいずれかを更新した際は CACHE_VERSION の数字を1つ上げること。
const CACHE_VERSION = "v4";
const CACHE_NAME = "spider-solitaire-" + CACHE_VERSION;

const ASSETS_TO_CACHE = [
  "./",
  "./index.html",
  "./style.css",
  "./script.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // { cache: "reload" } でブラウザのHTTPキャッシュを迂回し、
      // GitHub Pages側のキャッシュヘッダに関わらず必ずネットワークから最新版を取得する
      return Promise.all(
        ASSETS_TO_CACHE.map((url) =>
          fetch(url, { cache: "reload" }).then((response) => {
            if (response && response.ok) {
              return cache.put(url, response);
            }
          })
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// cache-first: キャッシュにあればそれを返し、なければネットワークから取得してキャッシュに追加する
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response && response.status === 200 && response.type === "basic") {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(() => cached);
    })
  );
});
