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

function memStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}
function fakeApi() {
  const files = new Map(); let sha = 0;
  const api = {
    files, puts: [], failPut: [],            // failPut: 차례로 던질 상태 코드
    async getFile(p) { return files.has(p) ? { json: structuredClone(files.get(p).json), sha: files.get(p).sha } : null; },
    async putFile(p, json, s, message) {
      const code = api.failPut.shift();
      if (code !== undefined) { const e = new Error('fail'); if (code) e.status = code; throw e; }
      const cur = files.get(p);
      if ((cur && cur.sha) !== (s || undefined) && !(cur == null && s == null)) { const e = new Error('sha'); e.status = 409; throw e; }
      files.set(p, { json: structuredClone(json), sha: 's' + ++sha });
      api.puts.push({ p, json, message });
    },
  };
  return api;
}
const MEALS = 'living-routine:v1:meals:2026-09';
const mk = (api, storage = memStorage()) =>
  S.createStore({ api, storage, device: '폰', setTimer: () => 0, clearTimer: () => {} });

test('set → flush: 파일로 커밋하고 대기열을 비운다', async () => {
  const api = fakeApi(); const st = mk(api);
  st.set(MEALS, { '2026-09-18': { lunch: { done: true } } });
  assert.equal(st.pending(), 1);
  await st.flush();
  assert.equal(st.pending(), 0);
  assert.deepEqual(api.files.get('app/meals/2026-09.json').json, { '2026-09-18': { lunch: { done: true } } });
  assert.equal(api.puts[0].message, 'meals 2026-09-18 · 폰');
});

test('다른 기기가 먼저 쓴 날짜를 지우지 않는다', async () => {
  const api = fakeApi();
  api.files.set('app/meals/2026-09.json', { json: { '2026-09-17': 'PC' }, sha: 's0' });
  const st = mk(api);
  st.set(MEALS, { '2026-09-18': '폰' });          // 폰 캐시에는 17일이 없다
  await st.flush();
  assert.deepEqual(api.files.get('app/meals/2026-09.json').json, { '2026-09-17': 'PC', '2026-09-18': '폰' });
});

test('sha 불일치(409)면 다시 받아 병합하고 재시도', async () => {
  const api = fakeApi(); api.failPut = [409];
  const st = mk(api);
  st.set(MEALS, { a: 1 });
  await st.flush();
  assert.equal(api.puts.length, 1);
  assert.equal(st.pending(), 0);
});

test('3번 실패하면 대기열에 남긴다', async () => {
  const api = fakeApi(); api.failPut = [409, 409, 409];
  const st = mk(api);
  st.set(MEALS, { a: 1 });
  await st.flush();
  assert.equal(st.pending(), 1);
});

test('네트워크 오류면 멈추고 대기열 유지, 다음 flush 에 보낸다', async () => {
  const api = fakeApi(); api.failPut = [0];      // 0 → status 없는 오류
  const st = mk(api);
  st.set(MEALS, { a: 1 });
  await st.flush();
  assert.equal(st.pending(), 1);
  assert.equal(st.error(), 'network');
  await st.flush();
  assert.equal(st.pending(), 0);
  assert.equal(st.error(), null);
});

test('401 이면 error() 가 auth', async () => {
  const api = fakeApi(); api.failPut = [401];
  const st = mk(api);
  st.set(MEALS, { a: 1 });
  await st.flush();
  assert.equal(st.error(), 'auth');
});

test('대기열은 새로고침(새 store) 뒤에도 남는다', async () => {
  const storage = memStorage(); const api = fakeApi();
  mk(null, storage).set(MEALS, { a: 1 });        // 동기화 꺼진 상태에서 입력
  const st2 = mk(api, storage);
  assert.equal(st2.pending(), 1);
  await st2.flush();
  assert.deepEqual(api.files.get('app/meals/2026-09.json').json, { a: 1 });
});

test('flush 도중 새 입력은 잃지 않는다', async () => {
  const api = fakeApi(); const st = mk(api);
  st.set(MEALS, { a: 1 });
  const orig = api.putFile;
  api.putFile = async (...args) => { st.set(MEALS, { a: 1, b: 2 }); api.putFile = orig; return orig(...args); };
  await st.flush();
  assert.equal(st.pending(), 1);
  await st.flush();
  assert.deepEqual(api.files.get('app/meals/2026-09.json').json, { a: 1, b: 2 });
});

test('같은 값 set 은 대기열에 넣지 않는다', () => {
  const st = mk(fakeApi());
  st.set(MEALS, { a: 1 }); st.set(MEALS, { a: 1 });
  assert.equal(st.pending(), 1);
});

test('get: 캐시가 있으면 바로, 없으면 원격을 기다린다', async () => {
  const api = fakeApi();
  api.files.set('app/settings.json', { json: { weight: 61 }, sha: 's0' });
  const storage = memStorage();
  const st = mk(api, storage);
  assert.deepEqual(await st.get('living-routine:v1:settings'), { weight: 61 });
  api.files.set('app/settings.json', { json: { weight: 62 }, sha: 's1' });
  let changed = null;
  const st2 = S.createStore({ api, storage, device: '폰', onRemoteChange: k => { changed = k; }, setTimer: () => 0, clearTimer: () => {} });
  assert.deepEqual(await st2.get('living-routine:v1:settings'), { weight: 61 });   // 캐시 먼저
  await new Promise(r => setTimeout(r, 0));
  assert.equal(changed, 'living-routine:v1:settings');
  assert.deepEqual(await st2.get('living-routine:v1:settings'), { weight: 62 });
  assert.equal(await mk(null).get('living-routine:v1:budget:2026-09'), null);
});

test('subscribe 는 pending 변화를 알린다', () => {
  const st = mk(fakeApi()); const seen = [];
  st.subscribe(s => seen.push(s.pending));
  st.set(MEALS, { a: 1 });
  assert.deepEqual(seen, [0, 1]);
});

test('githubApi: 한글 JSON 을 base64 로 주고받고, 404 는 null', async () => {
  const calls = [];
  const stored = {};
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const path = decodeURI(url.split('/contents/')[1]);
    if (init.method === 'PUT') { stored[path] = JSON.parse(init.body); return { ok: true, status: 201, json: async () => ({}) }; }
    if (!stored[path]) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ sha: 'abc', content: stored[path].content.replace(/(.{60})/g, '$1\n') }) };
  };
  const gh = S.githubApi({ token: 'T', repo: 'sasaway/life', fetchImpl });
  assert.equal(await gh.getFile('app/meals/2026-09.json'), null);
  await gh.putFile('app/meals/2026-09.json', { '2026-09-18': { memo: '대패짜글이' } }, null, 'meals 2026-09-18 · 폰');
  const body = JSON.parse(calls[1].init.body);
  assert.equal(body.message, 'meals 2026-09-18 · 폰');
  assert.equal(body.sha, undefined);
  assert.equal(calls[1].init.headers.Authorization, 'Bearer T');
  assert.equal(calls[1].init.cache, 'no-store');
  assert.equal(calls[1].url, 'https://api.github.com/repos/sasaway/life/contents/app/meals/2026-09.json');
  const got = await gh.getFile('app/meals/2026-09.json');
  assert.deepEqual(got, { sha: 'abc', json: { '2026-09-18': { memo: '대패짜글이' } } });
});

test('githubApi: 실패 상태 코드를 status 로', async () => {
  const gh = S.githubApi({ token: 'T', repo: 'r/r', fetchImpl: async () => ({ ok: false, status: 409, json: async () => ({}) }) });
  await assert.rejects(gh.putFile('app/settings.json', {}, 'x', 'm'), e => e.status === 409);
});
