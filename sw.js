/* sw.js — 신호가 약해도 앱이 열리고 운동 사진이 보이게 한다.
   - 앱 화면: 네트워크 먼저, 3초 안에 답이 없으면 저장본 (새 버전은 바로 반영)
   - 해시 붙은 스크립트·사진·아이콘·글꼴: 저장본 먼저
   - GitHub API(동기화)·GET 이 아닌 요청: 손대지 않는다
   사진을 같은 이름으로 바꿔 넣으면 CACHE 숫자를 올린다. */
const CACHE = 'nestwell-v1';
const TIMEOUT_MS = 3000;
const PRECACHE = [
  './',
  'manifest.webmanifest',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'img/ex/calf-raise-0.jpg',
  'img/ex/calf-raise-1.jpg',
  'img/ex/chest-press-0.jpg',
  'img/ex/chest-press-1.jpg',
  'img/ex/crunch-0.jpg',
  'img/ex/crunch-1.jpg',
  'img/ex/db-curl-0.jpg',
  'img/ex/db-curl-1.jpg',
  'img/ex/db-lunge-0.jpg',
  'img/ex/db-lunge-1.jpg',
  'img/ex/dead-bug-0.jpg',
  'img/ex/dead-bug-1.jpg',
  'img/ex/hammer-curl-0.jpg',
  'img/ex/hammer-curl-1.jpg',
  'img/ex/hip-thrust-0.jpg',
  'img/ex/hip-thrust-1.jpg',
  'img/ex/lat-pulldown-0.jpg',
  'img/ex/lat-pulldown-1.jpg',
  'img/ex/lateral-raise-0.jpg',
  'img/ex/lateral-raise-1.jpg',
  'img/ex/leg-curl-0.jpg',
  'img/ex/leg-curl-1.jpg',
  'img/ex/leg-ext-0.jpg',
  'img/ex/leg-ext-1.jpg',
  'img/ex/leg-press-0.jpg',
  'img/ex/leg-press-1.jpg',
  'img/ex/overhead-ext-0.jpg',
  'img/ex/overhead-ext-1.jpg',
  'img/ex/pec-deck-0.jpg',
  'img/ex/pec-deck-1.jpg',
  'img/ex/plank-0.jpg',
  'img/ex/plank-1.jpg',
  'img/ex/preacher-curl-0.jpg',
  'img/ex/preacher-curl-1.jpg',
  'img/ex/pushdown-0.jpg',
  'img/ex/pushdown-1.jpg',
  'img/ex/reverse-wrist-curl-0.jpg',
  'img/ex/reverse-wrist-curl-1.jpg',
  'img/ex/seated-row-0.jpg',
  'img/ex/seated-row-1.jpg',
  'img/ex/shoulder-press-0.jpg',
  'img/ex/shoulder-press-1.jpg',
  'img/ex/superman-0.jpg',
  'img/ex/superman-1.jpg',
  'img/ex/wrist-curl-0.jpg',
  'img/ex/wrist-curl-1.jpg'
];

function strategyFor({ url, method, mode }, base) {
  if (method !== 'GET') return null;
  const u = new URL(url), b = new URL(base);
  if (u.origin === 'https://cdn.jsdelivr.net') return 'cache-first';
  if (u.origin !== b.origin || !u.pathname.startsWith(b.pathname)) return null;
  if (mode === 'navigate') return 'network-first';
  const rel = u.pathname.slice(b.pathname.length);
  if (/^(img|icons)\//.test(rel) || rel === 'manifest.webmanifest') return 'cache-first';
  if (rel.endsWith('.js') && u.searchParams.has('v')) return 'cache-first';
  return 'network-first';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { strategyFor, PRECACHE };
} else {
  self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
  });
  self.addEventListener('activate', e => {
    e.waitUntil(caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()));
  });
  self.addEventListener('fetch', e => {
    const s = strategyFor(e.request, self.registration.scope);
    if (s === 'cache-first') e.respondWith(cacheFirst(e.request));
    else if (s === 'network-first') e.respondWith(networkFirst(e.request));
  });
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  const net = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; });
  net.catch(() => {});   // 저장본으로 답한 뒤 네트워크가 실패해도 오류를 남기지 않는다
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS));
  try {
    return await Promise.race([net, timeout]);
  } catch (e) {
    const hit = await cache.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' && await cache.match('./'));
    return hit || net;   // 저장본이 없으면 늦더라도 네트워크를 기다린다
  }
}
