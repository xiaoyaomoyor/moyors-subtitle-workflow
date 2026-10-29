// Search, replacement previews and cue-local text transactions.
(function (global) {
  'use strict';
  const core = global.MSWFindCore, host = global.MSWE.resolve('processing-host');
  const el = id => document.getElementById('find-edit-' + id), panel = el('panel');
  const viewport = el('results'), canvas = el('rows');
  let rowHeight = 70, ready = false, publishedVersion = -1, editKey = null, drafts = new Map(), operationNotice = '';
  const t = text => global.MSWE_I18N?.translateText(text) || text;
  let records = new Map(), references = new Map(), cuesById = new Map(), tracks = [], trackSignature = '';
  let result = { rows: [], count: 0 }, matchMap = new Map(), selected = [], trackIds = new Set();
  let activeKey = null, activeMatch = 0, queryVersion = 0, worker = null, workerBusy = false;
  let timeout, queryTimer, syncTimer, renderFrame, plainEngine = core.createEngine();
  const floating = host.createFloatingPanel({ panel, dragHandle: el('drag'),
    anchorButton: document.querySelector('[data-menubar-item="subtitle"] > button'),
    positionKey: 'msw.findEdit.position.v1', onClose: onClose });

  function sources() { return layerCore.tracks(DATA); }
  function readIndex() {
    const flat = fixedTrackMode();
    tracks = flat ? DATA.subtitle_tracks.tracks : sources().map((s, i) => ({ id: s.track_id || 'main', name: `S${i + 1}`, enabled: true }));
    const trackMap = new Map(tracks.map((track, order) => [track.id, { ...track, order }]));
    const owners = flat ? new Map(DATA.subtitle_tracks.assignments.map(a => [fixedTrackCore.key(a), a.subtitle_track_id])) : null;
    const next = new Map(), refs = new Map(), groups = new Map();
    for (const source of sources()) source.segments.forEach((cue, index) => {
      const trackId = owners ? owners.get(fixedTrackCore.key({ role: source.role, track_id: source.track_id, cue_id: cue.id })) : source.track_id || 'main';
      const track = trackMap.get(trackId); if (!track) return;
      const key = JSON.stringify([trackId, cue.id]);
      const row = { key, id: cue.id, trackId, trackName: track.name, order: track.order, start: cue.start, end: cue.end,
        text: String(cue.text || ''), locked: !!track.locked, disabled: track.enabled === false || !!cue.disabled };
      if (!groups.has(trackId)) groups.set(trackId, []);
      groups.get(trackId).push(row); refs.set(key, { cue, source, index });
    });
    const changed = [];
    for (const rows of groups.values()) rows.sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id)).forEach((row, i) => {
      row.number = i + 1;
      const old = records.get(row.key);
      if (!old || Object.keys(row).some(k => row[k] !== old[k])) changed.push(row);
      next.set(row.key, row);
    });
    const removed = [...records.keys()].filter(key => !next.has(key));
    records = next; references = refs; cuesById = new Map([...refs.values()].map(ref => [ref.cue.id, ref.cue]));
    const patch = { rows: changed, removed };
    plainEngine.update(patch); worker?.postMessage({ type: 'update', patch });
    refreshTracks();
    return changed.length > 0 || removed.length > 0;
  }
  function refreshTracks() {
    const signature = JSON.stringify(tracks.map(track => [track.id, track.name, track.locked, track.enabled]));
    if (signature === trackSignature) return;
    const first = !trackSignature; trackSignature = signature;
    if (first) trackIds = new Set(tracks.map(track => track.id));
    else trackIds = new Set([...trackIds].filter(id => tracks.some(track => track.id === id)));
    el('tracks').replaceChildren(...tracks.map(track => {
      const label = document.createElement('label'); label.className = 'media-preview-toggle';
      const input = document.createElement('input'); input.type = 'checkbox'; input.value = track.id; input.checked = trackIds.has(track.id);
      input.addEventListener('change', () => { if (input.checked) trackIds.add(track.id); else trackIds.delete(track.id); scheduleQuery(); });
      label.append(input, document.createTextNode(track.name)); return label;
    }));
  }
  function options() {
    return { query: el('query').value, caseSensitive: el('case').checked, regex: el('regex').checked,
      scope: el('scope').value, tracks: [...trackIds], selected,
      replacement: el('replace').open ? el('replacement').value : null };
  }
  function stopWorker() { clearTimeout(timeout); worker?.terminate(); worker = null; workerBusy = false; }
  function ensureWorker() {
    if (worker) return true;
    let url;
    try {
      url = URL.createObjectURL(new Blob([core.workerSource()], { type: 'text/javascript' }));
      worker = new Worker(url);
      worker.onmessage = event => {
        if (event.data.version !== queryVersion || !floating.isOpen()) return;
        workerBusy = false; clearTimeout(timeout); publish(event.data.result);
      };
      worker.onerror = event => { event.preventDefault(); stopWorker(); fallback(queryVersion, options()); };
      worker.postMessage({ type: 'update', patch: { rows: [...records.values()], reset: true } });
      return true;
    } catch (_) { stopWorker(); return false; }
    finally { if (url) URL.revokeObjectURL(url); }
  }
  function fallback(version, query) {
    if (version !== queryVersion || !floating.isOpen()) return;
    if (query.regex) { publish({ rows: [], count: 0, error: 'worker-unavailable' }); return; }
    // Literal matching is bounded. Never execute arbitrary regex on the UI thread.
    publish(plainEngine.search(query));
  }
  function message(text) { el('message').textContent = t(text); el('message').hidden = !text; }
  function publish(next) {
    const oldIndex = result.rows.findIndex(row => row.key === activeKey);
    result = next; publishedVersion = queryVersion; ready = !next.error && !next.limited; viewport.setAttribute('aria-busy', 'false');
    matchMap = new Map(next.rows.map(row => [records.get(row.key)?.id, row]));
    if (!next.rows.some(row => row.key === activeKey)) { activeKey = oldIndex >= 0 ? next.rows[Math.min(oldIndex, next.rows.length - 1)]?.key || null : null; activeMatch = 0; }
    else activeMatch = Math.min(activeMatch, matchMap.get(records.get(activeKey)?.id)?.matches.length - 1 || 0);
    el('count').textContent = global.MSWE_I18N?.language === 'en'
      ? `${next.rows.length} cues · ${next.count} matches` : `${next.rows.length} 条字幕 · ${next.count} 处匹配`;
    const notices = { 'invalid-regex': '正则表达式无效', 'worker-unavailable': '此环境无法安全运行正则，请使用普通文字查找', 'timeout': '查询耗时过长，请简化正则表达式', 'replacement-too-large': '替换结果过大，请缩小范围' };
    message(notices[next.error] || (next.limited ? '匹配过多，仅显示前 50000 处，请缩小范围' : next.zeroWidth ? '已忽略不包含文字的零宽匹配' : operationNotice));
    el('empty').textContent = t(!el('query').value ? '输入文字开始查找' : '没有匹配的字幕');
    el('empty').hidden = !!next.rows.length || !!next.error;
    el('prev').disabled = el('next').disabled = !next.count;
    rowHeight = el('replace').open ? 100 : 70;
    canvas.style.height = `${next.rows.length * rowHeight}px`;
    syncActions(); syncDraftStatus(); renderRows(); paintWaveform();
  }
  function runQuery() {
    if (!floating.isOpen()) return;
    const query = options(), version = queryVersion;
    if (!query.query) { publish({ rows: [], count: 0 }); return; }
    viewport.setAttribute('aria-busy', 'true'); el('count').textContent = t('正在查找…');
    if (!ensureWorker()) { fallback(version, query); return; }
    workerBusy = true; worker.postMessage({ type: 'search', version, query });
    timeout = setTimeout(() => { if (version === queryVersion && workerBusy) { stopWorker(); publish({ rows: [], count: 0, error: 'timeout' }); } }, 1500);
  }
  function scheduleQuery({ resetScroll = true } = {}) {
    ready = false; syncActions();
    clearTimeout(queryTimer); ++queryVersion;
    if (workerBusy) stopWorker();
    if (resetScroll) {
      operationNotice = '';
      viewport.scrollTop = 0; activeKey = null; activeMatch = 0;
      result = { rows: [], count: 0 }; canvas.replaceChildren(); canvas.style.height = '0px';
      el('prev').disabled = el('next').disabled = true; el('empty').hidden = true; message('');
    }
    // Old highlights must not advertise a newer query while it is pending.
    matchMap.clear(); paintWaveform();
    queryTimer = setTimeout(runQuery, 170);
  }
  function changed() {
    if (!floating.isOpen()) return;
    ready = false; syncActions();
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { if (readIndex()) scheduleQuery({ resetScroll: false }); else { ready = publishedVersion === queryVersion && !result.error && !result.limited; syncActions(); } syncDraftStatus(); }, 180);
  }
  function highlight(node, text, matches, active = -1) {
    node.replaceChildren(); let cursor = 0;
    matches.forEach(([start, end], i) => {
      node.append(document.createTextNode(text.slice(cursor, start)));
      const mark = document.createElement('mark'); mark.textContent = text.slice(start, end); mark.classList.toggle('current', i === active); node.append(mark); cursor = end;
    });
    node.append(document.createTextNode(text.slice(cursor)));
  }
  function renderRows() {
    if (!floating.isOpen()) return;
    cancelAnimationFrame(renderFrame);
    const first = Math.max(0, Math.floor(viewport.scrollTop / rowHeight) - 3);
    const last = Math.min(result.rows.length, first + Math.ceil(viewport.clientHeight / rowHeight) + 7);
    const fragment = document.createDocumentFragment();
    for (let i = first; i < last; i++) {
      const hit = result.rows[i], row = records.get(hit.key); if (!row) continue;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'find-result'; button.dataset.key = hit.key;
      button.style.top = `${i * rowHeight}px`; button.style.height = `${rowHeight}px`; button.setAttribute('aria-current', hit.key === activeKey ? 'true' : 'false');
      button.setAttribute('aria-label', `${row.trackName}_${row.number} ${formatTime(row.start)} ${row.text}`);
      const meta = document.createElement('span'); meta.className = 'find-result-meta';
      const name = document.createElement('strong'); name.textContent = `${row.trackName}_${row.number}`;
      const time = document.createElement('span'); time.textContent = formatTime(row.start);
      const status = document.createElement('span'); status.className = 'find-result-status';
      status.textContent = [row.locked ? t('已锁定') : '', row.disabled ? t('已禁用') : '', hit.matches.length > 1 ? `×${hit.matches.length}` : ''].filter(Boolean).join(' · ');
      meta.append(name, time, status);
      const text = document.createElement('span'); text.className = 'find-result-text'; text.dataset.i18nSkip = '';
      const current = hit.key === activeKey ? activeMatch : 0, start = Math.max(0, hit.matches[current][0] - 35), end = Math.min(row.text.length, Math.max(start + 140, hit.matches[current][1] + 35));
      const snippet = row.text.slice(start, end);
      const ranges = hit.matches.map(([a, b]) => [Math.max(a, start) - start, Math.min(b, end) - start]).filter(([a, b]) => b > a);
      highlight(text, snippet, ranges); if (start) text.prepend('…'); if (end < row.text.length) text.append('…');
      button.append(meta, text);
      if (hit.after !== undefined) {
        text.prepend(t('原文') + '：');
        const after = document.createElement('span'); after.className = 'find-result-text find-result-after';
        after.textContent = t('替换后') + '：' + (hit.after || t('（空文本）')); after.title = hit.after;
        button.append(after);
      }
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'find-icon find-edit-one';
      edit.dataset.editKey = hit.key; edit.style.top = `${i * rowHeight + 8}px`;
      edit.title = edit.ariaLabel = t('编辑此条字幕');
      edit.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5 5 5M4 20l5-1L21 7l-5-5L4 14z"/></svg>';
      fragment.append(button, edit);
    }
    canvas.replaceChildren(fragment);
  }
  function formatTime(ms) {
    const total = Math.max(0, Math.round(ms)), seconds = Math.floor(total / 1000), minutes = Math.floor(seconds / 60);
    return (minutes >= 60 ? `${String(Math.floor(minutes / 60)).padStart(2, '0')}:` : '') + `${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.${String(total % 1000).padStart(3, '0')}`;
  }
  function decorateBlock(block, cue) {
    if (!floating.isOpen() && !block.classList.contains('msw-search-hit')) return;
    const hit = floating.isOpen() ? matchMap.get(cue.id) : null;
    const previous = block.classList.contains('msw-search-hit');
    block.classList.toggle('msw-search-hit', !!hit);
    block.classList.toggle('msw-search-current', !!hit && hit.key === activeKey);
    const label = block.querySelector('.waveform-cue-label');
    if (!label || !hit && !previous) return;
    const text = String(cue.text || ''), display = text.replace(/\s+/g, ' ');
    if (!hit) { label.textContent = display; delete block.dataset.searchSignature; return; }
    const signature = `${queryVersion}:${hit.key === activeKey ? activeMatch : -1}:${text}`;
    if (block.dataset.searchSignature === signature && label.querySelector('mark')) return;
    block.dataset.searchSignature = signature;
    const ranges = hit.matches.map(([a, b]) => [text.slice(0, a).replace(/\s+/g, ' ').length, text.slice(0, b).replace(/\s+/g, ' ').length]).filter(([a, b]) => b > a);
    highlight(label, display, ranges, hit.key === activeKey ? activeMatch : -1);
  }
  function paintWaveform() {
    if (!waveformEditor?.content) return;
    waveformEditor.content.querySelectorAll('.waveform-cue-block').forEach(block => {
      const cue = cuesById.get(block.dataset.cueId); if (cue) decorateBlock(block, cue);
      else { block.classList.remove('msw-search-hit', 'msw-search-current'); block.querySelectorAll('mark').forEach(mark => mark.replaceWith(mark.textContent)); }
    });
  }
  function keepVisible(cue) { return floating.isOpen() && cue?.id === records.get(activeKey)?.id; }
  function navigate(key, occurrence = 0) {
    // Resolve by ID again: indexes may have changed since the last query.
    if (readIndex()) scheduleQuery({ resetScroll: false });
    let ref = references.get(key); const row = records.get(key);
    if (!ref || !row) { scheduleQuery({ resetScroll: false }); return; }
    activeKey = key; activeMatch = occurrence;
    if (fixedTrackMode()) {
      const track = DATA.subtitle_tracks.tracks.find(track => track.id === row.trackId);
      if (track?.collapsed) {
        if (!fixedUpdateTrack(track.id, { collapsed: false })) { message('请先完成当前编辑，再展开目标轨道'); return; }
        readIndex(); ref = references.get(key);
      }
      fixedActiveTrackId = row.trackId;
    }
    if (!ref) return;
    // Search navigation must never complete a pending bind operation.
    pendingExtensionBinding = null;
    if (ref.source.role === 'extension') selectOnlyExtension(ref.index, getExtensionTrack(ref.source.track_id));
    else if (ref.source.role === 'overlay') selectOverlayCueRow(ref.index);
    else selectCueByClick(ref.index);
    if (waveformEditor?.showModule?.('wave', { recordUndo: false })) rebuildShowModuleMenu();
    waveformEditor?.activateModuleTab?.('wave');
    seekFromWaveform(row.start / 1000, { pauseAfterSeek: true });
    waveformEditor?.refreshCueOverlay?.();
    waveformEditor?.revealTime(row.start, true);
    const i = result.rows.findIndex(hit => hit.key === key), top = i * rowHeight;
    if (top < viewport.scrollTop || top + rowHeight > viewport.scrollTop + viewport.clientHeight) viewport.scrollTop = top;
    syncActions(); renderRows(); paintWaveform();
  }
  function currentChange() {
    const hit = result.rows.find(row => row.key === activeKey) || result.rows[0];
    if (!hit?.replacements) return null;
    const i = hit.key === activeKey ? activeMatch : 0, [a, b] = hit.matches[i];
    return { key: hit.key, before: hit.before, after: hit.before.slice(0, a) + hit.replacements[i] + hit.before.slice(b) };
  }
  function syncActions() {
    const plan = core.planChanges(result.rows.filter(r => r.after !== undefined), records);
    const current = currentChange(), now = current && core.planChanges([current], records);
    el('replace-current').disabled = !ready || !now?.edits.length;
    el('replace-all').disabled = !ready || !plan.edits.length;
    el('plan').textContent = ready && el('replace').open
      ? (global.MSWE_I18N?.language === 'en' ? `Change ${plan.edits.length} cues · Skip ${plan.locked} locked` : `修改 ${plan.edits.length} 条 · 跳过 ${plan.locked} 条锁定字幕`) : '';
  }
  function capture(record, label = record.label) {
    const ids = new Set(record.cues.map(c => c.id));
    return { kind: 'subtitle-text', label, view: snapshotEditorSelection(), cues: sources().flatMap(s => s.segments.filter(c => ids.has(c.id)).map(c =>
      ({ id: c.id, fields: structuredClone({ text: c.text, items: c.items, _dirty: c._dirty }) }))) };
  }
  function applyFields(cue, fields) {
    for (const key of ['text', 'items', '_dirty']) { if (fields[key] === undefined) delete cue[key]; else cue[key] = structuredClone(fields[key]); }
  }
  function restore(record) {
    const live = new Map(sources().flatMap(s => s.segments.map(c => [c.id, c])));
    if (record.cues.some(c => !live.has(c.id))) return false;
    for (const c of record.cues) applyFields(live.get(c.id), c.fields);
    if (fixedTrackMode() && fixedLastContent) {
      const patch = new Map(record.cues.map(c => [c.id, c.fields]));
      for (const s of layerCore.tracks(fixedLastContent)) for (const c of s.segments) if (patch.has(c.id)) applyFields(c, patch.get(c.id));
      fixedLastContentKey = fixedContentKey(); fixedHistoryCheckpoint = editorHistory.checkpoint();
    }
    fixedPreviewInvalidate(); projectImportDirty = true;
    renderAll({ changedCueIds: new Set(record.cues.map(c => c.id)), validated: true });
    restoreEditorSelection(record.view); updateUndoRedoButtons(); scheduleAutoSaveFlush({ validated: true });
    changed(); return true;
  }
  function commit(changes, label) {
    if (pendingLinkedSplit || waveformEditor?.drag) throw Error('请先完成当前切分或拖动');
    commitProcessingEdits();
    if (!fixedAcceptEdit()) throw Error('字幕编辑未通过轨道校验');
    readIndex(); const plan = core.planChanges(changes, records);
    if (plan.conflicts.length) throw Error('目标字幕已改变，请重新检查后再应用');
    if (!plan.edits.length) return plan;
    // Map only the changed text. Preserve times, IDs, speaker/style and bindings.
    const patch = { label, view: snapshotEditorSelection(), cues: plan.edits.map(change => {
      const cue = references.get(change.key).cue;
      const mapped = change.after ? AsrEditorUtils.applyTimedTextEdit([cue], [change.after])?.[0] : null;
      return { id: cue.id, fields: { text: change.after, items: mapped?.items || [], _dirty: true } };
    }) };
    editorHistory.push(capture(patch)); restore(patch); return plan;
  }
  function replace(all) {
    if (!ready) return;
    try {
      const changes = all ? result.rows.filter(r => r.after !== undefined) : [currentChange()].filter(Boolean);
      if (changes.some(c => drafts.has(c.key) && drafts.get(c.key).after !== drafts.get(c.key).before)) throw Error('请先应用或取消目标字幕的未应用修改');
      const plan = commit(changes, all ? '替换全部' : '替换当前');
      operationNotice = global.MSWE_I18N?.language === 'en' ? `Changed ${plan.edits.length} cues · Skipped ${plan.locked} locked` : `已修改 ${plan.edits.length} 条 · 跳过 ${plan.locked} 条锁定字幕`;
      readIndex(); scheduleQuery({ resetScroll: false });
    } catch (error) { operationNotice = error.message; message(operationNotice); readIndex(); scheduleQuery({ resetScroll: false }); syncDraftStatus(); }
  }
  function editOne(key) {
    readIndex(); const row = records.get(key); if (!row && !drafts.has(key)) return;
    if (!drafts.has(key)) drafts.set(key, { key, before: row.text, after: row.text, title: `${row.trackName}_${row.number}` });
    editKey = key; el('editor').hidden = false;
    el('text').value = drafts.get(key).after; el('edit-title').textContent = drafts.get(key).title;
    syncDraftStatus(); el('text').focus();
  }
  function hasDraft() { return [...drafts.values()].some(d => d.before !== d.after); }
  function syncDraftStatus() {
    const dirty = [...drafts.values()].filter(d => d.before !== d.after);
    el('drafts').hidden = !dirty.length;
    el('drafts').textContent = global.MSWE_I18N?.language === 'en' ? `${dirty.length} unapplied drafts` : `${dirty.length} 条未应用修改`;
    const draft = drafts.get(editKey), row = records.get(editKey);
    if (!draft) return;
    const conflict = !row || row.text !== draft.before;
    el('edit-status').textContent = t(conflict ? '原文已改变，草稿已保留' : row.locked ? '已锁定' : draft.before !== draft.after ? '未应用' : '');
    el('apply').disabled = conflict || row?.locked || draft.before === draft.after;
    el('text').readOnly = !!row?.locked;
  }
  function discard() { drafts.delete(editKey); editKey = null; el('editor').hidden = true; syncDraftStatus(); }
  function applyDraft() {
    const draft = drafts.get(editKey); if (!draft || el('apply').disabled) return;
    try { const plan = commit([draft], '编辑查找结果'); if (plan.locked) throw Error('已锁定'); discard(); }
    catch (error) { el('edit-status').textContent = t(error.message); }
  }
  function step(direction) {
    if (!result.count) return;
    let index = result.rows.findIndex(row => row.key === activeKey), occurrence = activeMatch + direction;
    if (index < 0) { index = direction > 0 ? 0 : result.rows.length - 1; occurrence = direction > 0 ? 0 : result.rows[index].matches.length - 1; }
    else if (occurrence >= result.rows[index].matches.length) { index = (index + 1) % result.rows.length; occurrence = 0; }
    else if (occurrence < 0) { index = (index + result.rows.length - 1) % result.rows.length; occurrence = result.rows[index].matches.length - 1; }
    navigate(result.rows[index].key, occurrence);
  }
  function scopeChanged() {
    const scope = el('scope').value;
    el('tracks').hidden = scope !== 'tracks'; el('selection').hidden = scope !== 'selected';
    if (scope === 'selected') selected = batchSelectedIds();
    el('selected-count').textContent = String(selected.length); scheduleQuery();
  }
  function open() {
    const wasOpen = floating.isOpen(); floating.open();
    readIndex(); if (!wasOpen) scheduleQuery({ resetScroll: false });
    el('query').focus(); el('query').select();
  }
  function onClose() {
    clearTimeout(queryTimer); clearTimeout(syncTimer); ++queryVersion; stopWorker(); matchMap.clear(); paintWaveform();
    // A disabled result revealed for navigation returns to the user's normal visibility.
    waveformEditor?.refreshCueOverlay?.();
  }
  el('open').addEventListener('click', open); el('close').addEventListener('click', () => floating.close());
  el('replace').addEventListener('toggle', () => scheduleQuery({ resetScroll: false }));
  el('replacement').addEventListener('input', event => { operationNotice = ''; if (!event.isComposing) scheduleQuery({ resetScroll: false }); });
  el('replacement').addEventListener('compositionend', () => scheduleQuery({ resetScroll: false }));
  el('replace-current').addEventListener('click', () => replace(false)); el('replace-all').addEventListener('click', () => replace(true));
  el('text').addEventListener('input', () => { const d = drafts.get(editKey); if (d) { d.after = el('text').value; syncDraftStatus(); } });
  el('apply').addEventListener('click', applyDraft); el('discard').addEventListener('click', discard);
  el('drafts').addEventListener('click', () => { const keys = [...drafts.keys()].filter(k => drafts.get(k).before !== drafts.get(k).after); editOne(keys[(keys.indexOf(editKey) + 1) % keys.length]); });
  el('query').addEventListener('input', event => { if (!event.isComposing) scheduleQuery(); });
  el('query').addEventListener('compositionend', () => scheduleQuery());
  el('query').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); step(event.shiftKey ? -1 : 1); } });
  el('clear').addEventListener('click', () => { el('query').value = ''; scheduleQuery(); el('query').focus(); });
  el('prev').addEventListener('click', () => step(-1)); el('next').addEventListener('click', () => step(1));
  el('scope').addEventListener('change', scopeChanged); el('use-selection').addEventListener('click', scopeChanged);
  for (const id of ['case', 'regex']) el(id).addEventListener('change', () => scheduleQuery());
  viewport.addEventListener('scroll', () => { cancelAnimationFrame(renderFrame); renderFrame = requestAnimationFrame(renderRows); });
  canvas.addEventListener('click', event => { const edit = event.target.closest('[data-edit-key]'); if (edit) { editOne(edit.dataset.editKey); return; } const button = event.target.closest('[data-key]'); if (button) navigate(button.dataset.key); });
  canvas.addEventListener('dblclick', event => { const button = event.target.closest('[data-key]'); if (button) editOne(button.dataset.key); });
  const observer = new ResizeObserver(() => { if (floating.isOpen()) renderRows(); }); observer.observe(viewport);
  new ResizeObserver(() => {
    if (!floating.isOpen()) return;
    const rect = panel.getBoundingClientRect();
    panel.style.left = `${Math.max(6, Math.min(rect.left, innerWidth - rect.width - 6))}px`;
    panel.style.top = `${Math.max(6, Math.min(rect.top, innerHeight - rect.height - 6))}px`;
  }).observe(panel);
  document.addEventListener('keydown', event => {
    const modal = document.querySelector('.modal-mask.show, dialog[open]');
    if (event.isComposing || modal || event.defaultPrevented) return;
    if (floating.isOpen() && el('editor').contains(event.target)) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); discard(); return; }
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.stopImmediatePropagation(); applyDraft(); return; }
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
      event.preventDefault(); event.stopImmediatePropagation(); open();
    } else if (event.key === 'Escape' && floating.isOpen() && !document.querySelector('#msw-option-help:not([hidden])')) {
      const front = [...document.querySelectorAll('.gap-remove-panel.show, .settings-panel.show')].sort((a, b) => +getComputedStyle(b).zIndex - +getComputedStyle(a).zIndex)[0];
      if (front === panel) { event.preventDefault(); event.stopImmediatePropagation(); floating.close(); }
    }
  }, true);
  window.addEventListener('msw:subtitles-changed', changed);
  window.addEventListener('msw:project-changed', () => {
    stopWorker(); ++queryVersion; clearTimeout(queryTimer); clearTimeout(syncTimer);
    records.clear(); references.clear(); plainEngine = core.createEngine(); trackSignature = ''; activeKey = null;
    selected = []; el('scope').value = 'all'; el('query').value = ''; el('tracks').hidden = el('selection').hidden = true;
    drafts.clear(); editKey = null; el('editor').hidden = true; el('replacement').value = ''; ready = false; syncDraftStatus();
    if (floating.isOpen()) { readIndex(); publish({ rows: [], count: 0 }); }
  });
  global.MSWFindEdit = Object.freeze({ open, close: () => floating.close(), changed, decorateBlock, keepVisible, capture, restore, hasDraft });
})(window);
