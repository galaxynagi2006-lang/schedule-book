// 電波がないときもアプリを開けるようにする（サービスワーカー）
//   画面（index.html）：まずネットから最新を取りに行き、取れなければ（オフライン・電波が弱く4秒たっても返らない）保存しておいた画面を出す。
//     → ネットにつながっていれば、公開した新しい版がすぐに出る（古い画面が残り続けない）
//   画像・アイコンなど：保存しておいたものをすぐ出し、裏でネットから新しいものに取り替える
//   Google・AI・manaba など、ほかのサイトへの通信には手を出さない
const CACHE = 'schedule-book-v1';
const CORE = ['./', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-32.png', 'icons/icon-192.png', 'icons/apple-touch-icon.png'];
const PAGE_TIMEOUT_MS = 4000;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(pageFromNetworkFirst(request));
  } else {
    event.respondWith(fromCacheThenRefresh(event, request));
  }
});

// 画面：ネット優先。ショートカット（?open=add など）で開いても、同じ1枚の画面として保存する
async function pageFromNetworkFirst(request) {
  const cache = await caches.open(CACHE);
  const network = fetch(request).then(response => {
    if (response.ok) cache.put('./', response.clone());
    return response;
  });
  network.catch(() => {});   // 時間切れで保存した画面を出したあとに失敗しても、エラーを残さない
  const timeout = new Promise(resolve => setTimeout(resolve, PAGE_TIMEOUT_MS, null));
  try {
    const response = await Promise.race([network, timeout]);
    if (response) return response;
  } catch (e) {
    // オフライン：下で保存した画面を出す
  }
  const cached = await cache.match('./');
  return cached || network;   // まだ一度も保存していなければ、ネットの結果を待つ
}

async function fromCacheThenRefresh(event, request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const refresh = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  });
  if (cached) {
    event.waitUntil(refresh.catch(() => {}));
    return cached;
  }
  return refresh;
}
