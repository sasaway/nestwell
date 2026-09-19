// 홈 화면에 추가했을 때 404 가 나지 않도록: 모든 경로는 앱 폴더 기준 상대경로여야 한다.
// (GitHub Pages 프로젝트 사이트는 /nestwell/ 아래에 있어서 "/..." 는 사이트 루트(404)로 간다)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const exists = p => fs.existsSync(path.join(root, p));

test('index.html 이 manifest 와 홈 화면 아이콘을 상대경로로 연결한다', () => {
  const manifest = html.match(/<link rel="manifest" href="([^"]+)"/);
  const touch = html.match(/<link rel="apple-touch-icon" href="([^"]+)"/);
  assert.ok(manifest, 'manifest 링크 없음');
  assert.ok(touch, 'apple-touch-icon 링크 없음');
  for (const href of [manifest[1], touch[1]]) {
    assert.ok(!href.startsWith('/') && !href.startsWith('http'), `절대경로 금지: ${href}`);
    assert.ok(exists(href), `파일 없음: ${href}`);
  }
});

test('manifest: 시작 주소와 범위가 앱 폴더 안이고 아이콘 파일이 있다', () => {
  const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.name, 'Nestwell');
  assert.equal(m.start_url, './');
  assert.equal(m.scope, './');
  assert.equal(m.display, 'standalone');
  const sizes = m.icons.map(i => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'));
  for (const i of m.icons) {
    assert.ok(!i.src.startsWith('/'), `절대경로 금지: ${i.src}`);
    assert.ok(exists(i.src), `아이콘 없음: ${i.src}`);
  }
});

test('페이지가 부르는 로컬 스크립트도 상대경로다', () => {
  for (const [, src] of html.matchAll(/<script src="([^"]+)"/g)) {
    if (src.startsWith('http')) continue;
    assert.ok(!src.startsWith('/'), `절대경로 금지: ${src}`);
    assert.ok(exists(src), `파일 없음: ${src}`);
  }
});
