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
    function search({ query = '', caseSensitive = false, regex = false, scope = 'all', tracks = [], selected = [], limit = 50000 } = {}) {
      if (!query) return { rows: [], count: 0, limited: false };
      let pattern;
      try { pattern = new RegExp(regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'gu' : 'giu'); }
      catch (_) { return { rows: [], count: 0, error: 'invalid-regex' }; }
      const trackSet = new Set(tracks), ids = new Set(selected), rows = [];
      let count = 0, limited = false, zeroWidth = false;
      for (const row of records.values()) {
        if (scope === 'tracks' && !trackSet.has(row.trackId) || scope === 'selected' && !ids.has(row.id)) continue;
        pattern.lastIndex = 0;
        const matches = [];
        let match;
        while ((match = pattern.exec(row.text)) !== null) {
          // A point has no visible text to mark. Never spin on empty matches.
          if (!match[0].length) {
            zeroWidth = true;
            pattern.lastIndex = match.index + ((row.text.codePointAt(match.index) || 0) > 0xffff ? 2 : 1);
            continue;
          }
          matches.push([match.index, match.index + match[0].length]);
          if (++count >= limit) { limited = true; break; }
        }
        if (matches.length) rows.push({ key: row.key, matches });
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
  function workerSource() {
    return `const engine=(${createEngine.toString()})();onmessage=({data})=>{if(data.type==='update')engine.update(data.patch);else postMessage({version:data.version,result:engine.search(data.query)});};`;
  }
  const api = { createEngine, workerSource };
  if (typeof module !== 'undefined') module.exports = api;
  global.MSWFindCore = api;
})(typeof window === 'undefined' ? globalThis : window);
