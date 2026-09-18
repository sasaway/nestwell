# Nestwell 폰·PC 동기화 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nestwell v6 앱의 모든 입력을 비공개 GitHub 저장소 `sasaway/life`(= Mac 의 `~/life`)에 커밋으로 남기고, 매일 밤 회고 기록·폴더 정리·다음날 준비를 자동으로 돌린다.

**Architecture:** v6 단일 HTML 의 `DB` 객체 안쪽을 `sync.js`(localStorage 캐시 + GitHub Contents API 전송 대기열)로 바꾼다. 앱은 GitHub Pages(공개 저장소 `sasaway/nestwell`, 코드만)에서 돌고, 폰·PC 가 같은 비공개 저장소에 쓴다. Mac 은 launchd 로 밤마다 `~/life/tools/nightly.sh` 를 돌려 pull → 회고 md → 정리 → commit·push 한다.

**Tech Stack:** HTML + 바닐라 JS(빌드 없음), Node 24 `node:test`(테스트 전용, 의존성 없음), Python 3.14 표준 라이브러리, bash, launchd, gh CLI.

**Spec:** `docs/specs/Nestwell_폰PC동기화_설계서.md`

## Global Constraints

- 앱은 `app/**` 만 쓴다. 밤 작업·스킬은 `app/` 밖만 쓴다. 밤 작업은 `app/` 을 읽기만 한다.
- 저장소: `sasaway/nestwell`(공개, 코드만), `sasaway/life`(비공개, `~/life` 전체).
- 토큰: fine-grained PAT, 대상 `sasaway/life` 하나, `Contents: Read and write` 만. 브라우저 `localStorage` 에만 저장. 코드·저장소·채팅에 넣지 않는다.
- `.gitignore`(life): `inbox/mail/`, `tools/nightly.log`, `tools/nightly.err`, `__pycache__/`, `.DS_Store`.
- 데이터 파일: JSON, 2칸 들여쓰기, 끝에 줄바꿈. 경로 = `app/settings.json`, `app/{meals|workouts|budget|review}/YYYY-MM.json`.
- 병합: `meals`·`workouts`·`review` 는 날짜 키 단위(이번에 고친 날짜만 로컬 우선), `settings`·`budget` 은 파일 전체 로컬 우선.
- 전송: 마지막 입력 3초 뒤, sha 불일치(409/422) 시 병합 후 재시도 최대 3회.
- 커밋 메시지: `{기능} {날짜들 또는 월} · {기기}` 예) `meals 2026-09-18 · 폰`.
- 회고: 질문 4개 고정(잘된 것 / 안 된 것 / 배운 것 / 내일 첫 번째), 한 화면 하나, "없음" 버튼, 되묻기 없음, 그 날짜 자정까지만 수정.
- 회고 md: 오늘·어제는 매번 다시 씀(단, 앱이 만든 파일만), 그 이전은 없을 때만, 미래 무시.
- 하단 탭 4개(홈/식단/운동/돈)는 바꾸지 않는다.
- 외부 의존성 추가 금지(npm 패키지·pip 패키지 없음).

## 설계서와 달라지는 점 (Task 4·8 에서 설계서도 함께 고친다)

1. `migrateWorkReset`(v3 1회성 초기화)은 **삭제**한다. 이미 끝난 1회성 작업이고, 새 기기에서 원격 데이터를 받기 전에 돌면 운동 기록을 지운 채 올려 버릴 위험이 있다. 설계서 5장 마지막 줄을 이 내용으로 바꾼다.
2. 이 Mac 에는 `claude` CLI 가 없다. 일요일 주간 요약은 `nightly.sh` 가 아니라 **Claude 데스크톱 앱 예약 작업**(일 23:45, `~/life` 에서 "이번 주 정리해줘")으로 돌린다. 설계서 7장 3단계를 바꾼다.
3. `~/life` 를 **실제 폴더**로 옮기고 `~/Documents/Claude/life` 를 링크로 둔다. launchd 로 도는 bash 는 macOS 보호 폴더(`~/Documents`)에 접근이 막힐 수 있기 때문이다.

---

## 파일 구조

**앱 저장소** `~/Documents/Claude/nestwell/` (→ `sasaway/nestwell`)

| 파일 | 책임 |
|---|---|
| `sync.js` | 키↔경로, 병합, 캐시·대기열 저장소(`createStore`), GitHub 클라이언트(`githubApi`). 브라우저에선 `window.LifeSync`, Node 에선 `module.exports` |
| `review.js` | 회고 질문 목록과 순수 규칙(`isEditable`, `isComplete`, `shouldNudge`). `window.LifeReview` / `module.exports` |
| `index.html` | v6 복사본 + `DB` 교체 + 동기화 배지·설정 시트 + 회고 시트·홈 카드 |
| `tests/sync.test.js` | `sync.js` 테스트 |
| `tests/review.test.js` | `review.js` 테스트 |

**life 저장소** `~/life/` (→ `sasaway/life`)

| 파일 | 책임 |
|---|---|
| `.gitignore` | 저장소에서 뺄 것 |
| `tools/export_review.py` | `app/review/*.json` → `review/YYYY-MM-DD.md` |
| `tools/gen_routine.py` (수정) | 근무 시간 일정 추가 |
| `tools/routine.json` (수정) | `근무시간` 추가 |
| `tools/nightly.sh` | 밤 작업 순서 |
| `tools/kr.life.nightly.plist` | launchd 정의(설치 때 `~/Library/LaunchAgents/` 로 복사) |
| `tools/tests/test_export_review.py`, `tools/tests/test_gen_routine.py` | 테스트 |

---

### Task 1: sync.js — 경로·병합·커밋 메시지

**Files:**
- Create: `sync.js`
- Test: `tests/sync.test.js`

**Interfaces:**
- Produces: `pathForKey(key: string): string`, `isDateKeyed(path: string): boolean`, `diffKeys(prev: object|null, next: object|null): string[]`, `mergeDoc(path: string, remote: object|null, local: object|null, dirty: string[]): object|null`, `commitMessage(path: string, dirty: string[], device: string): string`

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/sync.test.js`

```js
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
```

- [ ] **Step 2: 실패 확인**

Run: `cd ~/Documents/Claude/nestwell && node --test`
Expected: FAIL — `Cannot find module '../sync.js'`

- [ ] **Step 3: 최소 구현** — `sync.js`

```js
/* sync.js — Nestwell 저장을 localStorage 캐시 + GitHub(sasaway/life) 로 동기화한다.
   브라우저: window.LifeSync / Node(테스트): module.exports */
(function (root) {
  const PREFIX = 'living-routine:v1:';

  function pathForKey(key) {
    const rest = key.startsWith(PREFIX) ? key.slice(PREFIX.length) : null;
    if (rest === 'settings') return 'app/settings.json';
    const m = rest && rest.match(/^(meals|workouts|budget|review):(\d{4}-\d{2})$/);
    if (!m) throw new Error('알 수 없는 저장 키: ' + key);
    return `app/${m[1]}/${m[2]}.json`;
  }

  const isDateKeyed = path => /^app\/(meals|workouts|review)\//.test(path);

  function diffKeys(prev, next) {
    const a = prev || {}, b = next || {};
    return [...new Set([...Object.keys(a), ...Object.keys(b)])]
      .filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  }

  // 날짜 키 파일: 원격을 바탕으로, 이번에 고친 날짜만 로컬 값으로 덮는다.
  function mergeDoc(path, remote, local, dirty) {
    if (!isDateKeyed(path) || remote == null) return local;
    const out = { ...remote };
    for (const k of dirty) {
      if (local && k in local) out[k] = local[k];
      else delete out[k];
    }
    return out;
  }

  function commitMessage(path, dirty, device) {
    const m = path.match(/^app\/(?:(\w+)\/(\d{4}-\d{2})|(settings))\.json$/);
    const feature = m[1] || m[3];
    const when = dirty.length ? [...dirty].sort().join(', ') : (m[2] || '');
    return `${feature}${when ? ' ' + when : ''} · ${device}`;
  }

  const LifeSync = { pathForKey, isDateKeyed, diffKeys, mergeDoc, commitMessage };
  if (typeof module !== 'undefined' && module.exports) module.exports = LifeSync;
  else root.LifeSync = LifeSync;
})(typeof globalThis !== 'undefined' ? globalThis : this);
```

- [ ] **Step 4: 통과 확인**

Run: `node --test`
Expected: PASS 6/6

- [ ] **Step 5: 커밋**

```bash
git add sync.js tests/sync.test.js
git commit -m "feat(sync): 키-경로 매핑, 날짜 단위 병합, 커밋 메시지"
```

---

### Task 2: sync.js — 캐시·대기열 저장소 `createStore`

**Files:**
- Modify: `sync.js` (Task 1 의 `LifeSync` 객체 앞에 추가, 객체에 `createStore` 추가)
- Test: `tests/sync.test.js` (아래 테스트 추가)

**Interfaces:**
- Consumes: Task 1 의 `pathForKey`, `isDateKeyed`, `diffKeys`, `mergeDoc`, `commitMessage`
- Produces: `createStore({ api, storage, device, debounceMs=3000, onRemoteChange=()=>{}, setTimer=setTimeout, clearTimer=clearTimeout })` →
  `{ get(key): Promise<any|null>, set(key, value): void, flush(): Promise<void>, pending(): number, error(): null|'auth'|'network', subscribe(fn: ({pending, error}) => void): () => void }`
  - `api` 는 `{ getFile(path) → Promise<{json, sha}|null>, putFile(path, json, sha|null, message) → Promise<void> }` 또는 `null`(동기화 꺼짐)
  - `api` 오류는 `err.status`(HTTP 코드, 네트워크 오류면 없음)를 가진다
  - localStorage 키: 캐시 `lifesync:cache:<v6키>`, 대기열 `lifesync:queue`

- [ ] **Step 1: 실패하는 테스트 추가** — `tests/sync.test.js` 끝에

```js
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
```

- [ ] **Step 2: 실패 확인**

Run: `node --test`
Expected: FAIL — `S.createStore is not a function`

- [ ] **Step 3: 구현** — `sync.js` 의 `const LifeSync = …` 줄 바로 위에 추가하고, `LifeSync` 객체에 `createStore` 를 넣는다.

```js
  function createStore({ api, storage, device, debounceMs = 3000, onRemoteChange = () => {},
                         setTimer = setTimeout, clearTimer = clearTimeout }) {
    const CACHE = 'lifesync:cache:', QUEUE = 'lifesync:queue';
    const read = (k, d) => { try { const v = storage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
    const write = (k, v) => { try { storage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 공간 없음 */ } };

    let queue = read(QUEUE, {});          // { path: { key, dirty: [...] } } — 항목은 매번 새 객체
    let err = null, timer = null, running = null;
    const subs = new Set();
    const emit = () => subs.forEach(fn => fn({ pending: Object.keys(queue).length, error: err }));
    const saveQueue = () => { write(QUEUE, queue); emit(); };

    async function pull(key) {
      const path = pathForKey(key);
      if (!api || queue[path]) return read(CACHE + key, null);   // 보낼 게 남았으면 로컬이 최신
      const remote = await api.getFile(path);
      if (!remote) return read(CACHE + key, null);
      const before = storage.getItem(CACHE + key);
      write(CACHE + key, remote.json);
      if (before !== null && before !== JSON.stringify(remote.json)) onRemoteChange(key);
      return remote.json;
    }

    async function get(key) {
      const cached = read(CACHE + key, undefined);
      const fresh = pull(key);
      if (cached !== undefined) { fresh.catch(() => {}); return cached; }
      try { return await fresh; } catch (e) { return null; }
    }

    function set(key, value) {
      const path = pathForKey(key);
      const prev = read(CACHE + key, null);
      if (JSON.stringify(prev) === JSON.stringify(value)) return;
      write(CACHE + key, value);
      const old = queue[path] ? queue[path].dirty : [];
      const dirty = isDateKeyed(path) ? [...new Set([...old, ...diffKeys(prev, value)])] : [];
      queue = { ...queue, [path]: { key, dirty } };
      saveQueue();
      if (api) { clearTimer(timer); timer = setTimer(flush, debounceMs); }
    }

    async function sendOne(path, entry) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const remote = await api.getFile(path);
        const local = read(CACHE + entry.key, null);
        const merged = mergeDoc(path, remote && remote.json, local, entry.dirty);
        try {
          await api.putFile(path, merged, remote ? remote.sha : null, commitMessage(path, entry.dirty, device));
        } catch (e) {
          if (e.status === 409 || e.status === 422) continue;   // 그사이 바뀜 → 다시 받아 병합
          throw e;
        }
        if (queue[path] === entry) {                              // 보내는 동안 새 입력이 없었을 때만
          write(CACHE + entry.key, merged);
          const { [path]: _, ...rest } = queue; queue = rest;
        }
        return;
      }
    }

    async function run() {
      for (const [path, entry] of Object.entries(queue)) {
        try { await sendOne(path, entry); err = null; }
        catch (e) { err = e.status === 401 || e.status === 403 ? 'auth' : 'network'; break; }
      }
      saveQueue();
    }

    function flush() {
      if (!api) return Promise.resolve();
      if (!running) running = run().finally(() => { running = null; });
      return running;
    }

    return {
      get, set, flush,
      pending: () => Object.keys(queue).length,
      error: () => err,
      subscribe(fn) { subs.add(fn); fn({ pending: Object.keys(queue).length, error: err }); return () => subs.delete(fn); },
    };
  }
```

`LifeSync` 객체를 다음으로 바꾼다:

```js
  const LifeSync = { pathForKey, isDateKeyed, diffKeys, mergeDoc, commitMessage, createStore };
```

- [ ] **Step 4: 통과 확인**

Run: `node --test`
Expected: PASS 17/17

- [ ] **Step 5: 커밋**

```bash
git add sync.js tests/sync.test.js
git commit -m "feat(sync): localStorage 캐시 + 전송 대기열, 충돌 재시도, 오프라인 보존"
```

---

### Task 3: sync.js — GitHub 클라이언트 `githubApi`

**Files:**
- Modify: `sync.js`
- Test: `tests/sync.test.js`

**Interfaces:**
- Produces: `githubApi({ token, repo, fetchImpl }) → { getFile(path), putFile(path, json, sha, message) }` — Task 2 의 `api` 모양 그대로. 404 → `null`, 그 밖 실패 → `Error` 에 `status`. 네트워크 실패는 `fetch` 가 던진 오류(status 없음) 그대로.

- [ ] **Step 1: 실패하는 테스트 추가**

```js
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
```

- [ ] **Step 2: 실패 확인**

Run: `node --test`
Expected: FAIL — `S.githubApi is not a function`

- [ ] **Step 3: 구현** — `createStore` 아래에 추가, `LifeSync` 에 `githubApi` 추가

```js
  function githubApi({ token, repo, fetchImpl = (...a) => fetch(...a) }) {
    const base = `https://api.github.com/repos/${repo}/contents/`;
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    const toB64 = s => { let bin = ''; new TextEncoder().encode(s).forEach(b => { bin += String.fromCharCode(b); }); return btoa(bin); };
    const fromB64 = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, '')), c => c.charCodeAt(0)));

    async function call(path, init = {}) {
      const res = await fetchImpl(base + encodeURI(path), { ...init, headers, cache: 'no-store' });
      if (res.status === 404) return null;
      if (!res.ok) { const e = new Error(`GitHub ${res.status}`); e.status = res.status; throw e; }
      return res.json();
    }
    return {
      async getFile(path) {
        const r = await call(path);
        return r && { sha: r.sha, json: JSON.parse(fromB64(r.content)) };
      },
      async putFile(path, json, sha, message) {
        const body = { message, content: toB64(JSON.stringify(json, null, 2) + '\n') };
        if (sha) body.sha = sha;
        await call(path, { method: 'PUT', body: JSON.stringify(body) });
      },
    };
  }
```

```js
  const LifeSync = { pathForKey, isDateKeyed, diffKeys, mergeDoc, commitMessage, createStore, githubApi };
```

- [ ] **Step 4: 통과 확인**

Run: `node --test`
Expected: PASS 19/19

- [ ] **Step 5: 커밋**

```bash
git add sync.js tests/sync.test.js
git commit -m "feat(sync): GitHub Contents API 클라이언트"
```

---

### Task 4: index.html — v6 에 동기화 연결

**Files:**
- Create: `index.html` (← `~/Downloads/자취루틴_통합앱_v6.html` 복사 후 수정)
- Modify: `~/Documents/Claude/.claude/launch.json` (미리보기 서버 `nestwell` 추가 — 세션 루트의 설정 파일만 읽힌다)
- Modify: `docs/specs/Nestwell_폰PC동기화_설계서.md` 5장 마지막 줄

**Interfaces:**
- Consumes: `LifeSync.createStore`, `LifeSync.githubApi` (Task 2·3)
- Produces: 전역 `store`(createStore 결과), `K.review(ym)`, `syncSheet()` — Task 5 가 `K.review` 와 `DB` 를 쓴다
- localStorage 키 `lifesync:config` = `{ token, repo, device }`

- [ ] **Step 1: v6 복사**

```bash
cp ~/Downloads/자취루틴_통합앱_v6.html ~/Documents/Claude/nestwell/index.html
```

- [ ] **Step 2: 스크립트 로드** — `<div class="sheet" id="sheet"></div>` 다음 줄, 기존 `<script>` 앞에 추가

```html
<script src="sync.js"></script>
```

- [ ] **Step 3: `DB` 블록 교체** — `const MEM = {};` 부터 `const K = {…};` 끝까지를 아래로 바꾼다

```js
/* ============================================================
   shared/storage.js — localStorage 캐시 + GitHub(sasaway/life) 동기화 (sync.js)
   ============================================================ */
const SYNC_CFG = 'lifesync:config';
const storage = (() => {
  try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); return localStorage; }
  catch (e) { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; }
})();
const syncCfg = (() => { try { return JSON.parse(storage.getItem(SYNC_CFG)); } catch (e) { return null; } })();
const store = LifeSync.createStore({
  api: syncCfg ? LifeSync.githubApi({ token: syncCfg.token, repo: syncCfg.repo }) : null,
  storage,
  device: syncCfg ? syncCfg.device : '로컬',
  onRemoteChange: () => { loadAll().then(render); },
});
const DB = {
  async get(key){ return store.get(key); },
  async set(key,val){ store.set(key,val); },
  async del(key){ storage.removeItem('lifesync:cache:'+key); }   // v6 에서 부르는 곳 없음
};
const K = {
  settings:'living-routine:v1:settings',
  meals: ym => `living-routine:v1:meals:${ym}`,
  work:  ym => `living-routine:v1:workouts:${ym}`,
  money: ym => `living-routine:v1:budget:${ym}`,
  review: ym => `living-routine:v1:review:${ym}`
};
```

- [ ] **Step 4: v3 1회성 초기화 삭제**

`loadAll()` 안의 `await migrateWorkReset();` 줄을 지우고, `/* v3 1회성 초기화 …` 주석부터 `migrateWorkReset` 함수 끝 `}` 까지 지운다.

- [ ] **Step 5: 헤더 배지** — `<header class="top" id="top">` 안, 제목 `<div>` 닫힌 뒤에 추가

```html
    <button class="chip off" id="syncBadge" hidden></button>
```

- [ ] **Step 6: 배지·설정 시트·자동 전송** — `/* 시작 */` 줄 바로 위에 추가

```js
/* ============================================================
   app/sync-ui.js — 동기화 배지와 토큰 설정
   ============================================================ */
store.subscribe(({pending, error})=>{
  const b = $('#syncBadge');
  const text = !syncCfg ? '동기화 꺼짐' : error==='auth' ? '토큰 확인' : pending ? `동기화 대기 ${pending}` : '';
  b.textContent = text; b.hidden = !text;
});
$('#syncBadge').addEventListener('click', ()=>syncSheet());
function syncSheet(){
  const c = syncCfg || { repo:'sasaway/life', device:'' };
  openSheet(`<h3>동기화 설정</h3>
    <div class="tiny" style="margin-bottom:10px">GitHub 토큰은 이 브라우저에만 저장됩니다.</div>
    <input id="syncToken" type="password" placeholder="GitHub 토큰 (github_pat_…)" autocomplete="off" style="width:100%;padding:12px;border:1px solid var(--line);border-radius:12px;margin-bottom:8px">
    <input id="syncRepo" value="${esc(c.repo)}" style="width:100%;padding:12px;border:1px solid var(--line);border-radius:12px;margin-bottom:8px">
    <input id="syncDevice" value="${esc(c.device)}" placeholder="기기 이름 (예: 폰, PC)" style="width:100%;padding:12px;border:1px solid var(--line);border-radius:12px;margin-bottom:12px">
    <button class="btn work full" data-sync-save="1">저장하고 다시 열기</button>
    ${syncCfg?'<button class="btn ghost full" style="margin-top:8px" data-sync-off="1">동기화 끄기</button>':''}
    <button class="btn ghost full" style="margin-top:8px" data-close="1">닫기</button>`);
}
$('#sheet').addEventListener('click', e=>{
  if(e.target.closest('[data-sync-save]')){
    const token = $('#syncToken').value.trim() || (syncCfg && syncCfg.token);
    const repo = $('#syncRepo').value.trim(), device = $('#syncDevice').value.trim() || '기기';
    if(!token || !repo) return;
    storage.setItem(SYNC_CFG, JSON.stringify({token, repo, device}));
    return location.reload();
  }
  if(e.target.closest('[data-sync-off]')){ storage.removeItem(SYNC_CFG); return location.reload(); }
});
window.addEventListener('online', ()=>store.flush());
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState==='visible'){ store.flush(); loadAll().then(render); }
  else store.flush();
});
```

- [ ] **Step 7: 설계서 고치기** — 5장 마지막 줄(`v3 1회성 마이그레이션…`)을 다음으로 바꾼다

```markdown
- v3 1회성 초기화(`migrateWorkReset`)는 삭제한다. 이미 끝난 작업이고, 새 기기에서 원격을 받기 전에 돌면 운동 기록을 지운 채 올릴 위험이 있다.
```

- [ ] **Step 8: 미리보기 설정** — `~/Documents/Claude/.claude/launch.json` 의 configurations 에 추가 (`--directory nestwell`)

```json
{
  "version": "0.0.1",
  "configurations": [
    { "name": "nestwell", "runtimeExecutable": "python3", "runtimeArgs": ["-m", "http.server", "5173", "--directory", "nestwell"], "port": 5173 }
  ]
}
```

- [ ] **Step 9: 브라우저 확인(동기화 꺼진 상태)**

`preview_start {name:"nestwell"}` → `http://localhost:5173/`
확인:
1. 콘솔 오류 없음 (`read_console_messages onlyErrors`)
2. 헤더에 `동기화 꺼짐` 배지
3. 식단에서 끼니 완료 체크 → 새로고침 → 체크가 남아 있음 (localStorage 캐시)
4. 배지 클릭 → 설정 시트가 열림
5. `javascript_tool`: `JSON.parse(localStorage.getItem('lifesync:queue'))` 에 `app/meals/2026-09.json` 항목이 있음 (꺼진 상태 입력도 대기열에 보존)

- [ ] **Step 10: 커밋**

```bash
git add index.html docs/specs/Nestwell_폰PC동기화_설계서.md
git commit -m "feat(app): v6 저장 계층을 sync.js 로 교체, 동기화 배지·설정"
```

---

### Task 5: 오늘 회고 — review.js + 시트 + 홈 카드

**Files:**
- Create: `review.js`, `tests/review.test.js`
- Modify: `index.html`

**Interfaces:**
- Consumes: `K.review`, `DB`, `openSheet`, `closeSheet`, `toastSheet`, `render`, `state`, `TODAY`, `ymd`, `nowHM`, `esc` (v6 / Task 4)
- Produces: `LifeReview.QUESTIONS: {id, q}[]`, `isEditable(date, today): boolean`, `isComplete(rec): boolean`, `shouldNudge(rec, hhmm): boolean`
- 회고 레코드: `state.review[YYYY-MM-DD] = { good, bad, learned, tomorrow, savedAt }`

- [ ] **Step 1: 실패하는 테스트** — `tests/review.test.js`

```js
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
```

- [ ] **Step 2: 실패 확인**

Run: `node --test`
Expected: FAIL — `Cannot find module '../review.js'`

- [ ] **Step 3: 구현** — `review.js`

```js
/* review.js — 오늘 회고의 질문과 규칙. review-agent 의 네 질문 그대로. */
(function (root) {
  const QUESTIONS = [
    { id: 'good', q: '오늘 잘된 것은?' },
    { id: 'bad', q: '안 된 것은?' },
    { id: 'learned', q: '배운 것은?' },
    { id: 'tomorrow', q: '내일 첫 번째로 할 것은?' },
  ];
  const isEditable = (date, today) => date === today;
  const isComplete = rec => !!rec && QUESTIONS.every(x => typeof rec[x.id] === 'string' && rec[x.id].trim() !== '');
  const shouldNudge = (rec, hhmm) => hhmm >= '21:00' && !isComplete(rec);

  const LifeReview = { QUESTIONS, isEditable, isComplete, shouldNudge };
  if (typeof module !== 'undefined' && module.exports) module.exports = LifeReview;
  else root.LifeReview = LifeReview;
})(typeof globalThis !== 'undefined' ? globalThis : this);
```

- [ ] **Step 4: 통과 확인**

Run: `node --test`
Expected: PASS 23/23

- [ ] **Step 5: index.html 연결**

5-1. `<script src="sync.js"></script>` 다음 줄에:

```html
<script src="review.js"></script>
```

5-2. `state` 객체의 `work:{},` 다음 줄에 `review:{},` 추가.

5-3. `loadAll()` 의 `state.work = …` 줄 다음에:

```js
  state.review = await DB.get(K.review(state.monthKey)) || {};
```

5-4. `const saveBudget = …` 줄 다음에:

```js
const saveReview   = () => DB.set(K.review(state.monthKey), state.review);
```

5-5. `logSheet()` 의 `data-quick="money"` 버튼 다음 줄에:

```js
    <button class="opt" data-quick="review"><span>📝 오늘 회고</span><span class="tiny">${LifeReview.isComplete(state.review[TODAY])?'작성함':'네 가지 질문'}</span></button>
```

5-6. `#sheet` 클릭 핸들러의 `if(q==='money') return go('money','close');` 다음 줄에:

```js
    if(q==='review') return reviewSheet(0);
```

5-7. `viewHome()` 의 마지막 `+ 기록` 버튼 줄을 다음으로 바꾼다(버튼 앞에 회고 카드):

```js
  ${LifeReview.shouldNudge(state.review[TODAY], nowHM()) ? `
  <section class="card">
    <div class="card-head"><div class="card-label">📝 오늘 회고</div></div>
    <div class="tiny">네 가지만 답하면 끝나요</div>
    <button class="btn line full" style="margin-top:10px" data-review-open="1">회고 쓰기</button>
  </section>` : ''}
  <button class="btn ghost full" style="margin-top:4px;padding:15px" data-log="1">+ 기록</button>`;
```

5-8. `view` 클릭 핸들러의 `if(el('data-log')) return logSheet();` 다음 줄에:

```js
  if(el('data-review-open')) return reviewSheet(0);
```

5-9. `/* 시작 */` 줄 바로 위에 회고 시트 추가:

```js
/* ============================================================
   features/review/view.js — 오늘 회고 (질문 하나씩)
   ============================================================ */
function reviewSheet(i){
  const Q = LifeReview.QUESTIONS[i], rec = state.review[TODAY] || {};
  openSheet(`<h3>${esc(Q.q)}</h3>
    <div class="tiny" style="margin-bottom:8px">${i+1} / ${LifeReview.QUESTIONS.length}</div>
    <textarea id="reviewInput" rows="4" style="width:100%;padding:12px;border:1px solid var(--line);border-radius:12px;font:inherit">${esc(rec[Q.id]||'')}</textarea>
    <div style="display:flex;gap:8px;margin-top:10px">
      ${i>0?`<button class="btn ghost" data-review-go="${i-1}">이전</button>`:''}
      <button class="btn line" data-review-none="${i}">없음</button>
      <button class="btn work" style="flex:1" data-review-next="${i}">${i<LifeReview.QUESTIONS.length-1?'다음':'저장'}</button>
    </div>`);
  setTimeout(()=>{ const t=$('#reviewInput'); if(t) t.focus(); }, 50);
}
function saveReviewAnswer(i, value){
  if(!LifeReview.isEditable(TODAY, ymd(new Date()))){
    toastSheet('날짜가 바뀌었어요', '지난 회고는 고칠 수 없어요. 앱을 새로 열어 주세요.');
    return false;
  }
  const id = LifeReview.QUESTIONS[i].id;
  state.review[TODAY] = { ...(state.review[TODAY]||{}), [id]: value, savedAt: new Date().toISOString() };
  saveReview();
  return true;
}
$('#sheet').addEventListener('click', e=>{
  const n = e.target.closest('[data-review-next],[data-review-none],[data-review-go]');
  if(!n) return;
  if(n.dataset.reviewGo !== undefined) return reviewSheet(+n.dataset.reviewGo);
  const i = +(n.dataset.reviewNext ?? n.dataset.reviewNone);
  const value = n.dataset.reviewNone !== undefined ? '없음' : $('#reviewInput').value;
  if(!saveReviewAnswer(i, value)) return;
  if(i < LifeReview.QUESTIONS.length-1) return reviewSheet(i+1);
  closeSheet(); render();
});
```

- [ ] **Step 6: 브라우저 확인**

`preview_start {name:"nestwell"}` 후 새로고침.
1. `+ 기록` → `📝 오늘 회고` → 질문 1/4 → 입력 → 다음 … 4/4 `없음` → 시트 닫힘
2. `javascript_tool`: `JSON.parse(localStorage.getItem('lifesync:cache:living-routine:v1:review:' + new Date().toISOString().slice(0,7)))` 에 오늘 날짜로 네 칸, `tomorrow: "없음"`
3. `+ 기록` 시트에 `작성함` 표시
4. `javascript_tool` 로 시계를 21:30 으로 가정할 수 없으므로 홈 카드는 `LifeReview.shouldNudge(undefined,'21:30') === true` 로 규칙만 확인(테스트가 이미 보장), 21시 이후 실제 확인은 Task 9 종단 확인에서
5. 콘솔 오류 없음

- [ ] **Step 7: 커밋**

```bash
git add review.js tests/review.test.js index.html
git commit -m "feat(app): 오늘 회고 — 네 질문 시트, 21시 이후 홈 카드"
```

---

### Task 6: ~/life 저장소 준비 + export_review.py

**Files:**
- Move: `~/Documents/Claude/life` → `~/life` (링크 방향 뒤집기)
- Create: `~/life/.gitignore`, `~/life/tools/export_review.py`, `~/life/tools/tests/test_export_review.py`
- Modify: `~/life/CLAUDE.md` (첫 줄 링크 설명)

**Interfaces:**
- Produces: `export_review.render(day: str, rec: dict) -> str`, `export_review.export(life: Path, today: date) -> list[str]`(쓴 파일 이름들). CLI `python3 tools/export_review.py [--today YYYY-MM-DD]`
- 앱이 만든 md 표시: 마지막 줄이 `기록: 앱 입력 …` 으로 시작

- [ ] **Step 1: 폴더를 옮기고 링크 뒤집기** (launchd 가 `~/Documents` 보호에 막히지 않게)

```bash
rm ~/life                                   # 지금은 링크
mv ~/Documents/Claude/life ~/life
ln -s ~/life ~/Documents/Claude/life
ls -la ~/life ~/Documents/Claude/life
```

Expected: `~/life` 는 폴더, `~/Documents/Claude/life -> /Users/younghyun/life`

- [ ] **Step 2: CLAUDE.md 첫 줄 수정** — `` `~/life` 는 이 폴더를 가리키는 링크다. …`` 를 다음으로

```markdown
`~/life` 가 실제 폴더다(`~/Documents/Claude/life` 는 링크). 비공개 저장소 `sasaway/life` 와 같다. 다섯 스킬이 모두 `~/life/...` 를 읽는다.
앱(Nestwell)은 `app/` 아래만 쓴다. 여기서는 `app/` 을 고치지 않는다.
```

- [ ] **Step 3: git 시작 + .gitignore**

`~/life/.gitignore`:

```
inbox/mail/
tools/nightly.log
tools/nightly.err
__pycache__/
.DS_Store
```

```bash
cd ~/life && git init -q && git branch -m main
git config user.name sasaway && git config user.email sasaway02@gmail.com
git add -A && git commit -q -m "chore: life 폴더 시작" && git log --oneline
```

- [ ] **Step 4: 실패하는 테스트** — `~/life/tools/tests/test_export_review.py`

```python
import json, sys, tempfile, unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import export_review as ex

REC = {"good": "제안서 끝냄", "bad": "", "learned": "메일은 점심 뒤로\n- 이미 줄표", "tomorrow": "2분기 계획 검토",
       "savedAt": "2026-09-18T14:02:11.000Z"}


class ExportReview(unittest.TestCase):
    def setUp(self):
        self.life = Path(tempfile.mkdtemp())
        (self.life / "app/review").mkdir(parents=True)

    def put(self, month, data):
        (self.life / f"app/review/{month}.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

    def md(self, day):
        return (self.life / f"review/{day}.md").read_text(encoding="utf-8")

    def test_render_keeps_words_and_fills_empty(self):
        text = ex.render("2026-09-18", REC)
        self.assertTrue(text.startswith("# 2026-09-18 (금)\n"))
        self.assertIn("## 잘된 것\n- 제안서 끝냄\n", text)
        self.assertIn("## 안 된 것\n- 없음\n", text)
        self.assertIn("## 배운 것\n- 메일은 점심 뒤로\n- 이미 줄표\n", text)
        self.assertIn("\n---\n기록: 앱 입력 2026-09-18 23:02", text)

    def test_writes_and_skips_future(self):
        self.put("2026-09", {"2026-09-18": REC, "2026-09-19": REC})
        self.assertEqual(ex.export(self.life, date(2026, 9, 18)), ["2026-09-18.md"])
        self.assertFalse((self.life / "review/2026-09-19.md").exists())

    def test_rewrites_today_and_yesterday_only_if_app_made(self):
        self.put("2026-09", {"2026-09-17": REC})
        ex.export(self.life, date(2026, 9, 17))
        self.put("2026-09", {"2026-09-17": {**REC, "good": "고침"}})
        self.assertEqual(ex.export(self.life, date(2026, 9, 18)), ["2026-09-17.md"])
        self.assertIn("- 고침", self.md("2026-09-17"))
        # 대화형 review-agent 가 쓴 파일은 건드리지 않는다
        (self.life / "review/2026-09-17.md").write_text("# 손으로 쓴 회고\n", encoding="utf-8")
        self.assertEqual(ex.export(self.life, date(2026, 9, 18)), [])
        self.assertEqual(self.md("2026-09-17"), "# 손으로 쓴 회고\n")

    def test_older_than_yesterday_written_only_when_missing(self):
        self.put("2026-09", {"2026-09-10": REC})
        self.assertEqual(ex.export(self.life, date(2026, 9, 18)), ["2026-09-10.md"])
        self.put("2026-09", {"2026-09-10": {**REC, "good": "바뀜"}})
        self.assertEqual(ex.export(self.life, date(2026, 9, 18)), [])
        self.assertIn("- 제안서 끝냄", self.md("2026-09-10"))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 5: 실패 확인**

Run: `cd ~/life/tools && python3 -m unittest discover -s tests -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'export_review'`

- [ ] **Step 6: 구현** — `~/life/tools/export_review.py`

```python
"""앱 회고(app/review/*.json) → review/YYYY-MM-DD.md (review-agent 형식).

오늘·어제: 앱이 만든 파일이면 매번 다시 쓴다(자정 전 마지막 수정까지 반영).
그 이전: 파일이 없을 때만 쓴다(지난 기록은 고치지 않는다). 미래: 무시.
사용: python3 tools/export_review.py [--today YYYY-MM-DD]
"""
import argparse, json
from datetime import date, datetime, timedelta
from pathlib import Path

LIFE = Path(__file__).resolve().parent.parent
DAYS = "월화수목금토일"
SECTIONS = [("good", "잘된 것"), ("bad", "안 된 것"), ("learned", "배운 것"), ("tomorrow", "내일 첫 번째")]
MARK = "기록: 앱 입력"


def render(day: str, rec: dict) -> str:
    out = [f"# {day} ({DAYS[date.fromisoformat(day).weekday()]})", ""]
    for key, title in SECTIONS:
        lines = [l.strip() for l in (rec.get(key) or "").splitlines() if l.strip()] or ["없음"]
        out += [f"## {title}"] + [l if l.startswith("- ") else f"- {l}" for l in lines] + [""]
    saved = rec.get("savedAt")
    when = datetime.fromisoformat(saved.replace("Z", "+00:00")).astimezone().strftime("%Y-%m-%d %H:%M") if saved else ""
    out += ["---", f"{MARK} {when}".rstrip()]
    return "\n".join(out) + "\n"


def export(life: Path, today: date) -> list[str]:
    written = []
    for f in sorted((life / "app/review").glob("*.json")):
        for day, rec in sorted(json.loads(f.read_text(encoding="utf-8")).items()):
            d = date.fromisoformat(day)
            target = life / "review" / f"{day}.md"
            if d > today:
                continue
            if target.exists():
                old = target.read_text(encoding="utf-8")
                if d < today - timedelta(days=1) or MARK not in old:
                    continue
            text = render(day, rec)
            if target.exists() and target.read_text(encoding="utf-8") == text:
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(text, encoding="utf-8")
            written.append(target.name)
    return written


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--today", default=date.today().isoformat())
    names = export(LIFE, date.fromisoformat(p.parse_args().today))
    print(f"회고 내보냄 {len(names)}" + (": " + ", ".join(names) if names else ""))
```

- [ ] **Step 7: 통과 확인**

Run: `cd ~/life/tools && python3 -m unittest discover -s tests -v`
Expected: PASS 4/4 (`test_render_keeps_words_and_fills_empty` 의 `23:02` 는 Mac 시간대가 Asia/Seoul 일 때 기준)

- [ ] **Step 8: 커밋**

```bash
cd ~/life && git add .gitignore CLAUDE.md tools/export_review.py tools/tests/test_export_review.py
git commit -m "feat(tools): 앱 회고를 review/ md 로 내보내기"
```

---

### Task 7: gen_routine.py — 근무 시간 일정

**Files:**
- Modify: `~/life/tools/routine.json`, `~/life/tools/gen_routine.py` (`build_ics` 의 날짜 반복문)
- Test: `~/life/tools/tests/test_gen_routine.py`

**Interfaces:**
- Consumes: 기존 `day_info(d)`, `_dt(d, hhmm)`, `build_ics(start, weeks)`

- [ ] **Step 1: 실패하는 테스트**

```python
import sys, unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import gen_routine as g


class WorkHours(unittest.TestCase):
    def test_open_shift_workday_has_hours(self):
        ics = g.build_ics(date(2026, 9, 18), 1)          # 금, 오픈반
        self.assertIn("DTSTART:20260918T083000\r\nDTEND:20260918T153000\r\nSUMMARY:근무 (오픈반)", ics)

    def test_close_shift_workday_has_hours(self):
        ics = g.build_ics(date(2026, 9, 21), 1)          # 월, 마감반
        self.assertIn("DTSTART:20260921T150000\r\nDTEND:20260921T220000\r\nSUMMARY:근무 (마감반)", ics)

    def test_off_day_has_no_hours(self):
        ics = g.build_ics(date(2026, 9, 16), 1)          # 수, 오픈반 휴무
        self.assertNotIn("20260916-work@", ics)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 실패 확인**

Run: `cd ~/life/tools && python3 -m unittest tests.test_gen_routine -v`
Expected: FAIL — `SUMMARY:근무 (오픈반)` 없음

- [ ] **Step 3: 구현**

`routine.json` 의 `"휴무요일"` 줄 다음에:

```json
  "근무시간": { "오픈반": { "시작": "08:30", "끝": "15:30" }, "마감반": { "시작": "15:00", "끝": "22:00" } },
```

`gen_routine.py` `build_ics` 반복문의 `event(f"{ymd}-shift", …)` 줄 다음에:

```python
        if not info["휴무"]:
            h = CFG["근무시간"][info["근무"]]
            event(f"{ymd}-work", f"근무 ({info['근무']})", _dt(d, h["시작"]), _dt(d, h["끝"]))
```

- [ ] **Step 4: 통과 확인**

Run: `cd ~/life/tools && python3 -m unittest discover -s tests -v`
Expected: PASS 7/7

- [ ] **Step 5: 커밋**

```bash
cd ~/life && git add tools/routine.json tools/gen_routine.py tools/tests/test_gen_routine.py
git commit -m "feat(tools): Nestwell 일정에 근무 시간 추가"
```

---

### Task 8: nightly.sh + launchd 정의

**Files:**
- Create: `~/life/tools/nightly.sh`, `~/life/tools/kr.life.nightly.plist`
- Modify: `~/Documents/Claude/nestwell/docs/specs/Nestwell_폰PC동기화_설계서.md` 7장 3단계
- Modify: `~/life/CLAUDE.md` (밤 작업 절 추가)

**Interfaces:**
- Consumes: `tools/export_review.py`, `tools/sort_drop.py`, `tools/gen_routine.py --date`

- [ ] **Step 1: 스크립트** — `~/life/tools/nightly.sh`

```bash
#!/bin/bash
# 매일 밤: 앱 기록 받기 → 회고 md → _drop 정리 → 내일 일정 → 올리기
set -u
LIFE="$HOME/life"
LOG="$LIFE/tools/nightly.log"
export PATH="/Library/Frameworks/Python.framework/Versions/3.14/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

log() { echo "$(date '+%F %T') $*" >> "$LOG"; }
notify() { osascript -e "display notification \"$1\" with title \"life 밤 작업\"" >/dev/null 2>&1; }

cd "$LIFE" || exit 1
log "시작"
HAS_REMOTE=$(git remote | grep -c '^origin$')

if [ "$HAS_REMOTE" = 1 ] && ! git pull --rebase -q 2>>"$LOG"; then
  git rebase --abort 2>/dev/null
  log "pull 실패 — 중단"
  notify "git pull 실패. ~/life 를 확인해 주세요"
  exit 1
fi

python3 tools/export_review.py >>"$LOG" 2>&1 || log "회고 내보내기 실패"
python3 tools/sort_drop.py    >>"$LOG" 2>&1 || log "_drop 정리 실패"
python3 tools/gen_routine.py --date "$(date -v+1d +%F)" >>"$LOG" 2>&1 || log "일정 생성 실패"

if [ -n "$(git status --porcelain)" ]; then
  git add -A && git commit -q -m "nightly $(date +%F)" && log "커밋"
fi
if [ "$HAS_REMOTE" = 1 ]; then
  git push -q 2>>"$LOG" && log "push 완료" || log "push 실패 — 다음 밤에 함께"
fi
log "끝"
```

```bash
chmod +x ~/life/tools/nightly.sh
```

- [ ] **Step 2: launchd 정의** — `~/life/tools/kr.life.nightly.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>kr.life.nightly</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>/Users/younghyun/life/tools/nightly.sh</string></array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>23</integer><key>Minute</key><integer>30</integer></dict>
  <key>StandardErrorPath</key><string>/Users/younghyun/life/tools/nightly.err</string>
</dict>
</plist>
```

Run: `plutil -lint ~/life/tools/kr.life.nightly.plist`
Expected: `OK`

- [ ] **Step 3: 원격 없이 한 번 돌려 보기**

샘플 회고를 넣고 돌린 뒤 되돌린다(`app/` 은 원래 앱만 쓰므로 확인 후 지운다):

```bash
mkdir -p ~/life/app/review
printf '{"%s":{"good":"테스트","bad":"","learned":"","tomorrow":"","savedAt":"%s"}}\n' "$(date +%F)" "$(date -u +%FT%T.000Z)" > ~/life/app/review/$(date +%Y-%m).json
bash ~/life/tools/nightly.sh; tail -n 8 ~/life/tools/nightly.log
cat ~/life/review/$(date +%F).md
ls ~/life/inbox/tasks/
```

Expected: 로그에 `회고 내보냄 1`, `생성: … Nestwell_<내일>.md`, `커밋`; md 에 `- 테스트` 와 `- 없음` 세 번; push 줄은 없음(원격 없음).

되돌리기:

```bash
cd ~/life && git rm -rq app review/$(date +%F).md && git commit -q -m "chore: 밤 작업 시험 데이터 제거"
```

- [ ] **Step 4: 설계서 7장 3단계 고치기**

```markdown
3. 일요일 주간 요약은 이 스크립트가 아니라 **Claude 데스크톱 앱 예약 작업**(매주 일 23:45, 작업 폴더 `~/life`, 프롬프트 "이번 주 정리해줘")이 한다. 이 Mac 에는 `claude` CLI 가 없다.
```

- [ ] **Step 5: CLAUDE.md 에 밤 작업 절 추가** (`## 스케줄 규칙이 바뀌면` 앞)

```markdown
## 밤 작업

- 매일 23:30 launchd(`kr.life.nightly`) → `tools/nightly.sh`: pull → 회고 md → `_drop` 정리 → 내일 일정 → commit·push. 결과는 `tools/nightly.log`.
- 일요일 23:45 Claude 데스크톱 예약 작업 → review-agent 주간 요약(`review/_week/`).
- 수동 실행: `bash ~/life/tools/nightly.sh`
```

- [ ] **Step 6: 커밋 (두 저장소)**

```bash
cd ~/life && git add tools/nightly.sh tools/kr.life.nightly.plist CLAUDE.md && git commit -m "feat(tools): 밤 작업 스크립트와 launchd 정의"
cd ~/Documents/Claude/nestwell && git add docs/specs && git commit -m "docs: 주간 요약을 데스크톱 예약 작업으로"
```

---

### Task 9: 배포와 종단 확인 (사용자 확인 필요 단계 포함)

**Files:** 없음(설정·배포)

> 이 Task 의 ★ 표시 단계는 GitHub 에 무언가를 만들거나 시스템 예약을 등록한다. **실행 전에 사용자에게 무엇을 할지 보여 주고 확인을 받는다.**

- [ ] **Step 1: ★ 앱 저장소 만들기 + 올리기** (공개 전 `git ls-files` 로 데이터·토큰이 없는지 확인)

```bash
cd ~/Documents/Claude/nestwell && git ls-files
gh repo create sasaway/nestwell --public --source=. --push
```

- [ ] **Step 2: ★ GitHub Pages 켜기**

```bash
gh api -X POST repos/sasaway/nestwell/pages -f "source[branch]=main" -f "source[path]=/"
gh api repos/sasaway/nestwell/pages --jq .html_url
```

Expected: `https://sasaway.github.io/nestwell/` (첫 배포는 1~2분)

- [ ] **Step 3: ★ life 비공개 저장소 만들기 + 올리기**

```bash
cd ~/life && git ls-files | head -50
gh repo create sasaway/life --private --source=. --push
gh auth setup-git
```

- [ ] **Step 4: 사용자 — 토큰 발급**

안내: https://github.com/settings/personal-access-tokens/new → Repository access: *Only select repositories* → `sasaway/life` → Permissions: *Contents: Read and write* → 만료 1년 → 생성. 토큰은 **채팅에 붙여 넣지 않고** 앱의 `동기화 꺼짐` 배지 → 설정 시트에 직접 넣는다(폰: 기기 이름 `폰`, PC: `PC`).

- [ ] **Step 5: ★ launchd 등록**

```bash
cp ~/life/tools/kr.life.nightly.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/kr.life.nightly.plist
launchctl kickstart gui/$(id -u)/kr.life.nightly
sleep 5; tail -n 6 ~/life/tools/nightly.log; cat ~/life/tools/nightly.err 2>/dev/null
```

Expected: 로그에 `시작`…`push 완료`…`끝`. `Operation not permitted` 가 보이면 시스템 설정 → 개인정보 보호 및 보안 → 전체 디스크 접근 권한에 `/bin/bash` 추가를 사용자에게 안내.

- [ ] **Step 6: ★ 주간 요약 예약 작업** — Claude 데스크톱 `scheduled-tasks` 로 매주 일요일 23:45, 작업 폴더 `~/life`, 프롬프트 `이번 주 정리해줘` 등록.

- [ ] **Step 7: 종단 확인**

1. 폰에서 `https://sasaway.github.io/nestwell/` → 토큰 입력 → 식단 끼니 체크
2. `gh api repos/sasaway/life/commits --jq '.[0].commit.message'` → `meals YYYY-MM-DD · 폰`
3. PC 브라우저에서 같은 주소 → 같은 체크가 보임
4. 폰에서 비행기 모드 → 운동 한 종목 체크 → 배지 `동기화 대기 1` → 비행기 모드 해제 → 배지 사라짐 → 커밋 확인
5. 폰에서 오늘 회고 작성 → Mac: `launchctl kickstart gui/$(id -u)/kr.life.nightly` → `~/life/review/<오늘>.md` 생성, `sasaway/life` 에 `nightly …` 커밋

---

## 설계서 대비 점검

| 설계서 | Task |
|---|---|
| 3 구조·저장소 둘·쓰기 영역·.gitignore | 6, 9 |
| 3 토큰 | 4(설정 시트), 9-4 |
| 4 데이터 파일·병합 단위 | 1, 2 |
| 5 get/set/전송/병합/오프라인/메시지/401 | 2, 3, 4 |
| 5 v3 초기화 | 4 (삭제, 설계서 수정) |
| 6 회고 화면 | 5 |
| 7 밤 작업 1·2·4·5 | 6, 7, 8 |
| 7 주간 요약 | 8(설계서 수정), 9-6 |
| 8 오류 처리 | 2(재시도·오프라인·auth), 8(pull 충돌·push 실패), 9-5 |
| 9 테스트 | 1~3, 5, 6, 7, 9-7 |
| 10 사용자 할 일 | 9 |
