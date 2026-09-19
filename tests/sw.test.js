// 서비스 워커: 요청마다 어떤 전략을 쓰는지, 미리 받는 목록이 실제 파일과 맞는지.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const SW = require('../sw.js');
const ORIGIN = 'https://sasaway.github.io';
const BASE = ORIGIN + '/nestwell/';
const s = (url, method = 'GET', mode = 'no-cors') => SW.strategyFor({ url, method, mode }, BASE);

test('앱 화면은 네트워크 먼저', () => {
  assert.equal(s(BASE, 'GET', 'navigate'), 'network-first');
  assert.equal(s(BASE + 'index.html', 'GET', 'navigate'), 'network-first');
});

test('해시 붙은 스크립트·사진·아이콘·manifest 는 저장본 먼저', () => {
  assert.equal(s(BASE + 'sync.js?v=1df51e4e'), 'cache-first');
  assert.equal(s(BASE + 'img/ex/plank-0.jpg'), 'cache-first');
  assert.equal(s(BASE + 'icons/icon-192.png'), 'cache-first');
  assert.equal(s(BASE + 'manifest.webmanifest'), 'cache-first');
});

test('jsDelivr 글꼴은 저장본 먼저', () => {
  assert.equal(s('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/woff2-dynamic-subset/PretendardVariable.subset.0.woff2'), 'cache-first');
});

test('동기화(GitHub API)와 GET 이 아닌 요청은 건드리지 않는다', () => {
  assert.equal(s('https://api.github.com/repos/sasaway/life/contents/app/meals/2026-09.json'), null);
  assert.equal(s(BASE + 'img/ex/plank-0.jpg', 'PUT'), null);
  assert.equal(s('https://example.com/x.js'), null);
  assert.equal(s(ORIGIN + '/other-app/index.html', 'GET', 'navigate'), null);   // 범위 밖
});

test('해시 없는 로컬 스크립트는 저장본 먼저로 두지 않는다 (옛 파일이 굳는 것 방지)', () => {
  assert.equal(s(BASE + 'sync.js'), 'network-first');
});

test('미리 받는 목록 = 실제 사진·아이콘 파일 전부', () => {
  const files = [
    ...fs.readdirSync(path.join(root, 'img/ex')).filter(f => f.endsWith('.jpg')).map(f => 'img/ex/' + f),
    ...fs.readdirSync(path.join(root, 'icons')).map(f => 'icons/' + f),
  ].sort();
  const pre = SW.PRECACHE.filter(p => p.startsWith('img/') || p.startsWith('icons/')).sort();
  assert.deepEqual(pre, files);
  for (const p of SW.PRECACHE) assert.ok(!p.startsWith('/'), `절대경로 금지: ${p}`);
});

test('index.html 이 sw.js 를 상대경로로 등록한다', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /navigator\.serviceWorker\.register\('sw\.js'\)/);
});
