const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../review.js');

test('질문은 네 개, 순서 고정', () => {
  assert.deepEqual(R.QUESTIONS.map(x => x.id), ['good', 'bad', 'learned', 'tomorrow']);
});
test('그 날짜에만 고칠 수 있다', () => {
  assert.equal(R.isEditable('2026-09-18', '2026-09-18'), true);
  assert.equal(R.isEditable('2026-09-17', '2026-09-18'), false);
});
test('네 칸이 다 차야 완료 ("없음"도 답)', () => {
  assert.equal(R.isComplete({ good: 'a', bad: '없음', learned: 'c', tomorrow: 'd' }), true);
  assert.equal(R.isComplete({ good: 'a', bad: ' ', learned: 'c', tomorrow: 'd' }), false);
  assert.equal(R.isComplete(undefined), false);
});
test('21시 이후 미완료면 홈에서 알린다', () => {
  assert.equal(R.shouldNudge(undefined, '20:59'), false);
  assert.equal(R.shouldNudge(undefined, '21:00'), true);
  assert.equal(R.shouldNudge({ good: 'a', bad: 'b', learned: 'c', tomorrow: 'd' }, '22:00'), false);
});
