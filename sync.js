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

  function createStore({ api, storage, device, debounceMs = 3000, onRemoteChange = () => {},
                         setTimer = setTimeout, clearTimer = clearTimeout }) {
    const CACHE = 'lifesync:cache:', QUEUE = 'lifesync:queue';
    const read = (k, d) => { try { const v = storage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
    const write = (k, v) => { try { storage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 공간 없음 */ } };

    let queue = read(QUEUE, {});          // { path: { key, dirty: [...] } } — 항목은 매번 새 객체
    let err = null, lastErr = null, timer = null, running = null;
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
      const e = new Error('충돌 재시도 3번 실패'); e.status = 409; throw e;   // 조용히 멈추지 않게
    }

    async function run() {
      for (const [path, entry] of Object.entries(queue)) {
        try { await sendOne(path, entry); err = null; lastErr = null; }
        catch (e) {
          err = e.status === 401 || e.status === 403 ? 'auth' : 'network';
          lastErr = e.status ? `HTTP ${e.status}` : '네트워크 오류';
          break;
        }
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
      lastError: () => lastErr,
      subscribe(fn) { subs.add(fn); fn({ pending: Object.keys(queue).length, error: err }); return () => subs.delete(fn); },
    };
  }

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

  // 설정을 저장하기 전에 토큰이 저장소에 닿는지 한 번 확인한다.
  async function checkToken({ token, repo, fetchImpl = (...a) => fetch(...a) }) {
    try {
      const res = await fetchImpl(`https://api.github.com/repos/${repo}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }, cache: 'no-store',
      });
      if (res.status === 200) return 'ok';
      if (res.status === 401 || res.status === 403) return 'auth';
      if (res.status === 404) return 'notfound';
      return 'network';
    } catch (e) { return 'network'; }
  }

  const LifeSync = { pathForKey, isDateKeyed, diffKeys, mergeDoc, commitMessage, createStore, githubApi, checkToken };
  if (typeof module !== 'undefined' && module.exports) module.exports = LifeSync;
  else root.LifeSync = LifeSync;
})(typeof globalThis !== 'undefined' ? globalThis : this);
