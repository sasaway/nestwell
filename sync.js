/* sync.js — 자취루틴 저장을 localStorage 캐시 + GitHub(sasaway/life) 로 동기화한다.
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
