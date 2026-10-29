// Text-only search. This factory also runs inside a cancellable worker.
(function (global) {
  'use strict';
  function createEngine() {
    const records = new Map();
    function update({ rows = [], removed = [], reset = false } = {}) {
      if (reset) records.clear();
      for (const key of removed) records.delete(key);
      for (const row of rows) records.set(row.key, row);
    }
    function search({ query = '', caseSensitive = false, regex = false, scope = 'all', tracks = [], selected = [], limit = 50000, replacement = null } = {}) {
      if (!query) return { rows: [], count: 0, limited: false };
      let pattern;
      try { pattern = new RegExp(regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'gu' : 'giu'); }
      catch (_) { return { rows: [], count: 0, error: 'invalid-regex' }; }
      const trackSet = new Set(tracks), ids = new Set(selected), rows = [];
      let count = 0, limited = false, zeroWidth = false, outputSize = 0;
      function substitute(match, text) {
        if (!regex) return replacement;
        return replacement.replace(/\$(\$|&|`|'|\d{1,2}|<[^>]+>)/g, (token, key) => {
          if (key === '$') return '$';
          if (key === '&') return match[0];
          if (key === '`') return text.slice(0, match.index);
          if (key === "'") return text.slice(match.index + match[0].length);
          if (key[0] === '<') return match.groups ? match.groups[key.slice(1, -1)] ?? '' : token;
          const n = Number(key);
          if (n > 0 && n < match.length) return match[n] ?? '';
          const first = Number(key[0]);
          return key.length === 2 && first > 0 && first < match.length ? (match[first] ?? '') + key[1] : token;
        });
      }
      for (const row of records.values()) {
        if (scope === 'tracks' && !trackSet.has(row.trackId) || scope === 'selected' && !ids.has(row.id)) continue;
        pattern.lastIndex = 0;
        const matches = [], replacements = [];
        let match;
        while ((match = pattern.exec(row.text)) !== null) {
          // A point has no visible text to mark. Never spin on empty matches.
          if (!match[0].length) {
            zeroWidth = true;
            pattern.lastIndex = match.index + ((row.text.codePointAt(match.index) || 0) > 0xffff ? 2 : 1);
            continue;
          }
          matches.push([match.index, match.index + match[0].length]);
          if (replacement !== null) {
            const value = substitute(match, row.text);
            outputSize += value.length;
            if (outputSize > 8 * 1024 * 1024) return { rows: [], count: 0, error: 'replacement-too-large' };
            replacements.push(value);
          }
          if (++count >= limit) { limited = true; break; }
        }
        if (matches.length) {
          const hit = { key: row.key, matches };
          if (replacement !== null) {
            let at = 0, parts = [];
            matches.forEach(([a, b], i) => { parts.push(row.text.slice(at, a), replacements[i]); at = b; });
            parts.push(row.text.slice(at));
            Object.assign(hit, { before: row.text, after: parts.join(''), replacements });
          }
          rows.push(hit);
        }
        if (limited) break;
      }
      rows.sort((a, b) => {
        const x = records.get(a.key), y = records.get(b.key);
        return x.start - y.start || x.order - y.order || x.number - y.number || x.key.localeCompare(y.key);
      });
      return { rows, count, limited, zeroWidth };
    }
    return { update, search };
  }
  function planChanges(changes, current) {
    const edits = [], conflicts = []; let locked = 0;
    for (const change of changes) {
      const row = current.get(change.key);
      if (!row || row.text !== change.before) { conflicts.push(change.key); continue; }
      if (change.before === change.after) continue;
      if (row.locked) { ++locked; continue; }
      edits.push({ ...change, id: row.id });
    }
    return { edits, conflicts, locked };
  }
  function workerSource() {
    return `const engine=(${createEngine.toString()})();onmessage=({data})=>{if(data.type==='update')engine.update(data.patch);else postMessage({version:data.version,result:engine.search(data.query)});};`;
  }
  const api = { createEngine, workerSource, planChanges };
  if (typeof module !== 'undefined') module.exports = api;
  global.MSWFindCore = api;
})(typeof window === 'undefined' ? globalThis : window);
