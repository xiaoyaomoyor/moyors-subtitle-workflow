/* Shared preference storage. Unknown keys (project drafts, queues) remain local. */
(function (global) {
  'use strict';
  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const object = v => v && typeof v === 'object' && !Array.isArray(v);
  const identify = op => ({...op,id:global.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}-${Math.random()}`});
  const get = (value, path) => path.reduce((v, p) => v?.[p], value);
  const put = (value, path, item) => {
    for (const p of path.slice(0, -1)) { if (!object(value[p])) value[p] = {}; value = value[p]; }
    if (item === undefined) delete value[path.at(-1)]; else value[path.at(-1)] = clone(item);
  };
  function diff(before, after, path = []) {
    if (before === undefined && object(after)) before = {};
    if (object(before) && object(after)) return [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .flatMap(k => diff(before[k], after[k], [...path, k]));
    if (equal(before, after)) return [];
    return [{path, exists: before !== undefined, ...(before === undefined ? {} : {before}),
      ...(after === undefined ? {delete: true} : {value: after})}];
  }
  let native;
  try { native = global.localStorage; } catch (_) { /* Private mode remains usable in memory. */ }
  let registry = {}, view = {}, observed = {}, send = null, queue = [], timer, inFlight, blocked = false, announced = '';
  let ready = Promise.resolve(), migration, transfer = [];
  const pendingKey = 'msw.config.pending.v1', backupKey = 'msw.config.legacy.v1';
  const rawGet = key => { try { return native?.getItem(key) ?? null; } catch (_) { return null; } };
  const rawSet = (key, value) => { try { native?.setItem(key, value); } catch (_) { /* Server still persists. */ } };
  function announce(message) {
    if (announced === message) return; announced = message;
    global.dispatchEvent?.(new CustomEvent('msw:config-notice', {detail: {message}}));
    // The host installs its normal notification surface after boot.
    global.MSWConfig.notice = message;
  }
  function persistQueue() { rawSet(pendingKey, JSON.stringify(queue)); }
  function schedule() { if (!send || blocked) return; clearTimeout(timer); timer = setTimeout(() => void flush().catch(() => {}), 250); }
  async function flush() {
    await ready;
    if (inFlight) { await inFlight; return flush(); }
    if (blocked) throw Error('配置冲突尚未处理，请刷新后重试；本窗口改动已保留。');
    if (!send || !queue.length) return;
    const batch = queue.slice();
    inFlight = (async () => {
      try {
        if (migration) { const result=await send({action:'migrate',sections:migration}); if(result?.error)throw Error(result.error); migration=null; }
        // Server validates this ordered batch atomically, including parent/child edits.
        const result = await send({action: 'patch', changes: batch});
        if (!result || result.error) throw Object.assign(Error(result?.error || '配置保存失败'), {conflict: result?.conflict});
        queue.splice(0, batch.length); persistQueue(); announced = ''; global.MSWConfig.notice = '';
        // Do not replace the UI's observed baseline with another window's unseen values.
      } catch (error) {
        if (error.conflict) {
          blocked = true;
          rawSet('msw.config.conflict.' + Date.now(), JSON.stringify(queue));
          queue = []; persistQueue();
        }
        announce(error.conflict ? '配置已在其他窗口更新；本窗口改动已保留，请刷新后重试。' : '配置暂未保存到本机服务，改动已保留，连接恢复后重试。');
        throw error;
      } finally { inFlight = null; }
    })();
    await inFlight;
    if (queue.length) return flush();
  }
  const storage = {
    getItem(key) {
      const rule = registry[key];
      if (!rule) return rawGet(key);
      const value = get(view, rule.path);
      return value === undefined ? null : rule.encoding === 'text' ? String(value) : JSON.stringify(value);
    },
    setItem(key, text) {
      const rule = registry[key];
      if (!rule) { rawSet(key, text); return; }
      const value = rule.encoding === 'text' ? String(text) : JSON.parse(text);
      const edits = diff(Object.hasOwn(observed,key) ? observed[key] : get(view, rule.path), value, rule.path);
      // Project layout can differ from the saved preference. Detect what the user
      // changed against that layout, but compare writes against the saved value.
      const ops = edits.flatMap(op => diff(get(view, op.path), op.delete ? undefined : op.value, op.path));
      observed[key] = clone(value);
      for(const op of ops) put(view,op.path,op.delete?undefined:op.value);
      rawSet(key, storage.getItem(key));
      if (send && ops.length) { queue.push(...ops.map(identify)); persistQueue(); schedule(); }
    },
    removeItem(key) {
      const rule = registry[key];
      if (rule) {
        const ops = diff(get(view, rule.path), undefined, rule.path);
        put(view, rule.path, undefined);
        if (send && ops.length) { queue.push(...ops.map(identify)); persistQueue(); schedule(); }
      }
      try { native?.removeItem(key); } catch (_) {}
    },
  };
  function observe(key, text) { if(registry[key]) observed[key] = registry[key].encoding==='text'?String(text):JSON.parse(text); }
  function collect(snapshot) {
    const migrated = new Set(snapshot.migrations || []), sections = {};
    for (const [key, rule] of Object.entries(registry)) {
      const raw = rawGet(key); if (raw === null) continue;
      const [section, name] = rule.path;
      if (name && migrated.has(`browser:${section}:${name}`)) continue;
      try { put(sections, rule.path, rule.encoding === 'text' ? raw : JSON.parse(raw)); } catch (_) {}
    }
    return sections;
  }
  function fill(old, newer) {
    if (old === undefined) return clone(newer);
    if (object(old) && object(newer)) return {...newer, ...old, ...Object.fromEntries(Object.keys(newer).map(k => [k, fill(old[k], newer[k])]))};
    return old;
  }
  function connect(snapshot, transport) {
    registry = snapshot.registry || {}; view = clone(snapshot.sections || {}); observed = {}; send = transport;
    transfer=snapshot.transfer||transfer;
    if(!send){try{view=fill(view,JSON.parse(rawGet('msw.config.offline.v1')||'{}'));}catch(_){}}
    const legacy = collect(snapshot);
    if (!rawGet(backupKey)) rawSet(backupKey, JSON.stringify(legacy));
    view = fill(view, legacy);
    try { queue = JSON.parse(rawGet(pendingKey) || '[]'); if(!Array.isArray(queue))queue=[]; } catch (_) { queue = []; }
    // Pending edits are never replayed blindly over another window's values.
    for (const op of queue) put(view, op.path, op.delete ? undefined : op.value);
    if (!send) return Promise.resolve();
    migration = legacy;
    ready = transport({action: 'migrate', sections: legacy}).then(result => {
      if (result?.error) throw Error(result.error);
      migration = null;
      // Retain any writes made during startup; normal modules have already read view.
    }).catch(error => { announce('配置迁移未完成，原设置已保留：' + error.message); });
    ready.then(schedule);
    return ready;
  }
  async function http(payload) {
    const boot = global.MSW_CONFIG_BOOTSTRAP;
    const response = await fetch(boot.url, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-MSW-Token': boot.token}, body: JSON.stringify(payload)});
    const data = await response.json();
    if (!response.ok || data.error) throw Object.assign(Error(data.error || '配置保存失败'), {conflict: data.conflict || response.status === 409});
    return data;
  }
  async function update(path, before, after) {
    await flush();
    if(!send) throw Error('当前没有本机配置服务');
    const result=await send({action:'patch',changes:diff(before,after,path).map(identify)});
    if(result?.error) throw Error(result.error);
    return result;
  }
  function adopt(snapshot) {
    // The open UI still displays the old values. Preserve that baseline so its
    // next one-field edit cannot undo an import's unrelated fields.
    for(const [key, rule] of Object.entries(registry)) if(!Object.hasOwn(observed,key)) observed[key]=clone(get(view,rule.path));
    view=clone(snapshot.sections||{});
    for(const [key,rule] of Object.entries(registry)) {
      const value=get(view,rule.path);
      if(value===undefined){try{native?.removeItem(key);}catch(_){}}
      else rawSet(key,rule.encoding==='text'?String(value):JSON.stringify(value));
    }
    if(!send)rawSet('msw.config.offline.v1',JSON.stringify(view));
    global.dispatchEvent?.(new CustomEvent('msw:config-adopted'));
  }
  async function request(payload) {
    await ready;await flush();
    if(!send)return global.MSWConfigOffline.request(payload);
    const result=await send(payload);
    if(result?.error)throw Object.assign(Error(result.error),{conflict:result.conflict});
    if(result.snapshot)adopt(result.snapshot);
    return result;
  }
  global.MSWConfig = {storage, connect, flush, diff, observe, update, request, adopt,
    get snapshot(){return {sections:clone(view),registry:clone(registry),transfer:clone(transfer)};},
    get connected() { return !!send; }, get ready() { return ready; }, notice: ''};
  if (global.MSW_CONFIG_BOOTSTRAP) {
    const boot = global.MSW_CONFIG_BOOTSTRAP;
    connect(boot.snapshot, boot.url ? http : null);
  }
  global.addEventListener?.('online', schedule);
  global.addEventListener?.('pagehide', () => { if(queue.length)void flush().catch(() => {}); });
  global.addEventListener?.('beforeunload', event => { if(queue.length&&send){event.preventDefault();event.returnValue='';} });
  global.setInterval?.(() => { if(queue.length&&!blocked) schedule(); }, 10000);
})(window);
