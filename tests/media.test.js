// 운동 사진: index.html 의 EX_IMG 가 가리키는 파일이 전부 있고, 헬스장 본운동이 빠짐없이 연결돼 있는지.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const block = html.match(/const EX_IMG = \{([\s\S]*?)\n\};/);
const map = block ? Object.fromEntries([...block[1].matchAll(/'([^']+)':\s*'([a-z-]+)'/g)].map(m => [m[1], m[2]])) : {};

test('EX_IMG 의 모든 운동에 시작·끝 사진 파일이 있다', () => {
  assert.ok(block, 'EX_IMG 없음');
  assert.ok(Object.keys(map).length >= 20);
  for (const slug of Object.values(map)) {
    for (const n of [0, 1]) assert.ok(fs.existsSync(path.join(root, `img/ex/${slug}-${n}.jpg`)), `${slug}-${n}.jpg 없음`);
  }
});

test('헬스장 본운동(m1~) 이름이 모두 EX_IMG 에 있다', () => {
  const plans = html.slice(html.indexOf('const PLANS'), html.indexOf('\n};', html.indexOf('const PLANS')));
  const names = new Set([...plans.matchAll(/\{id:'m\d+',name:'([^']+)'/g)].map(m => m[1]));
  const missing = [...names].filter(n => !(n in map));
  assert.deepEqual(missing, []);
});

test('사진 출처 기록이 있다', () => {
  assert.ok(fs.existsSync(path.join(root, 'img/ex/CREDITS.md')));
});
