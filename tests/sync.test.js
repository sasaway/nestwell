const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../sync.js');

test('pathForKey: v6 키를 저장소 경로로', () => {
  assert.equal(S.pathForKey('living-routine:v1:settings'), 'app/settings.json');
  assert.equal(S.pathForKey('living-routine:v1:meals:2026-09'), 'app/meals/2026-09.json');
  assert.equal(S.pathForKey('living-routine:v1:workouts:2026-09'), 'app/workouts/2026-09.json');
  assert.equal(S.pathForKey('living-routine:v1:budget:2026-10'), 'app/budget/2026-10.json');
  assert.equal(S.pathForKey('living-routine:v1:review:2026-09'), 'app/review/2026-09.json');
  assert.throws(() => S.pathForKey('other:key'));
  assert.throws(() => S.pathForKey('living-routine:v1:meals:2026-9'));
});

test('mergeDoc: 날짜 키 파일은 고친 날짜만 로컬 우선', () => {
  const remote = { '2026-09-17': 'r17', '2026-09-18': 'r18' };
  const local = { '2026-09-17': 'l17', '2026-09-18': 'l18', '2026-09-19': 'l19' };
  assert.deepEqual(
    S.mergeDoc('app/meals/2026-09.json', remote, local, ['2026-09-18', '2026-09-19']),
    { '2026-09-17': 'r17', '2026-09-18': 'l18', '2026-09-19': 'l19' });
});

test('mergeDoc: 로컬에서 지운 날짜는 지운다', () => {
  assert.deepEqual(S.mergeDoc('app/workouts/2026-09.json', { a: 1, b: 2 }, { a: 1 }, ['b']), { a: 1 });
});

test('mergeDoc: 전체 단위 파일과 원격 없음은 로컬 그대로', () => {
  assert.deepEqual(S.mergeDoc('app/budget/2026-09.json', { x: 1 }, { y: 2 }, []), { y: 2 });
  assert.deepEqual(S.mergeDoc('app/settings.json', { x: 1 }, { y: 2 }, []), { y: 2 });
  assert.deepEqual(S.mergeDoc('app/meals/2026-09.json', null, { a: 1 }, ['a']), { a: 1 });
});

test('diffKeys: 값이 달라진 최상위 키만', () => {
  assert.deepEqual(S.diffKeys({ a: 1, b: { c: 1 } }, { a: 1, b: { c: 2 }, d: 0 }).sort(), ['b', 'd']);
  assert.deepEqual(S.diffKeys(null, { a: 1 }), ['a']);
  assert.deepEqual(S.diffKeys({ a: 1 }, { a: 1 }), []);
});

test('commitMessage 형식', () => {
  assert.equal(S.commitMessage('app/meals/2026-09.json', ['2026-09-18'], '폰'), 'meals 2026-09-18 · 폰');
  assert.equal(S.commitMessage('app/meals/2026-09.json', ['2026-09-19', '2026-09-18'], 'PC'), 'meals 2026-09-18, 2026-09-19 · PC');
  assert.equal(S.commitMessage('app/budget/2026-09.json', [], '폰'), 'budget 2026-09 · 폰');
  assert.equal(S.commitMessage('app/settings.json', [], '폰'), 'settings · 폰');
});
