// Text tools share the find panel's scope, drafts, navigation and text history.
(function (global) {
  'use strict';
  global.MSWFindTextTools = function (bridge) {
    const el = id => document.getElementById('find-' + id), t = bridge.t, formatTime = bridge.formatTime;
    const list = el('tools-list'), canvas = el('tools-rows');
    let mode = 'search', view = 'rows', shown = [], changes = [], timer, renderFrame;
    let whole = null, resumedWhole = null, wholeDrafts = new Map(), notice = '', scopeKey = '';
    const count = (zh, en) => global.MSWE_I18N?.language === 'en' ? en : zh;
    const dirty = d => d && d.before !== d.after;
    const status = text => { el('tools-status').textContent = t(text); };
    const pendingRows = () => bridge.scope().map(r => bridge.drafts().get(r.key)).filter(dirty);
    const wholeDirty = d => d && d.text !== d.initial;
    function options() {
      return { trim: el('tidy-trim').checked, capitalize: el('tidy-capitalize').checked,
        stripMarkdown: el('tidy-markdown').checked, addPrefix: el('tidy-prefix').checked,
        prefix: el('tidy-prefix-text').value, addSuffix: el('tidy-suffix').checked, suffix: el('tidy-suffix-text').value };
    }
    function summary(plan) {
      return count(`修改 ${plan.edits.length} 条 · 跳过 ${plan.locked} 条锁定字幕`, `Change ${plan.edits.length} cues · Skip ${plan.locked} locked`);
    }
    function setMode(next) {
      mode = next; notice = ''; list.scrollTop = 0;
      el('tools').hidden = mode === 'search';
      el('tidy-options').hidden = mode !== 'tidy'; el('continuous-options').hidden = mode !== 'edit';
      refresh();
    }
    function refresh() {
      if (mode === 'search') return;
      clearTimeout(timer);
      const rows = bridge.scope();
      const nextScope = JSON.stringify([bridge.scopeTracks(), rows.map(r => r.key)]);
      if (nextScope !== scopeKey) { notice = ''; scopeKey = nextScope; list.scrollTop = 0; }
      if (mode === 'edit' && !resumedWhole && bridge.scopeTracks().length !== 1) view = 'rows';
      el('continuous-rows').setAttribute('aria-pressed', String(view === 'rows'));
      el('continuous-whole').setAttribute('aria-pressed', String(view === 'whole'));
      el('tools-apply').textContent = t(mode === 'tidy' ? '应用处理' : '应用修改');
      el('tools-discard').hidden = mode === 'tidy';
      el('whole-editor').hidden = mode !== 'edit' || view !== 'whole';
      list.hidden = mode === 'edit' && view === 'whole';
      if (mode === 'tidy') {
        el('tidy-prefix-text').hidden = !el('tidy-prefix').checked; el('tidy-suffix-text').hidden = !el('tidy-suffix').checked;
        const query = bridge.query();
        el('tidy-query').textContent = query.text ? `“${query.text}”` : t('尚未查找');
        el('tidy-matched').disabled = !query.text && !el('tidy-matched').checked;
        const matched = el('tidy-matched').checked, selected = matched ? rows.filter(r => query.keys.has(r.key)) : rows;
        const opts = options();
        changes = selected.map(r => ({ key:r.key, before:r.text, after:AsrEditorUtils.applyTextProcessing(r.text, opts) })).filter(c => c.before !== c.after);
        shown = changes.map(c => ({ ...bridge.records().get(c.key), change:c }));
        const plan = MSWFindCore.planChanges(changes, bridge.records());
        el('tools-apply').disabled = !plan.edits.length || matched && (!query.text || !query.ready);
        status(notice || (matched && (!query.text || !query.ready) ? '请先完成有效查找，或取消仅匹配结果' : summary(plan)));
      } else {
        const single = bridge.scopeTracks().length === 1;
        el('continuous-whole').disabled = !single;
        el('continuous-hint').textContent = t(view === 'whole' ? '一行对应一条字幕；绑定字幕的拆分／合并请使用联动操作。' : single ? '' : '整体编辑需要选择单条轨道。');
        el('continuous-filter').hidden = view === 'whole';
        if (view === 'whole') { loadWhole(rows); return; }
        const threshold = el('continuous-threshold').value;
        shown = rows.filter(r => threshold === '' || MSWBatchEditing.visibleCharacterCount(bridge.drafts().get(r.key)?.after ?? r.text) >= Number(threshold));
        updateRowsStatus();
      }
      render();
    }
    function updateRowsStatus() {
      const plan = MSWFindCore.planChanges(pendingRows(), bridge.records());
      el('tools-apply').disabled = !plan.edits.length || !!plan.conflicts.length;
      el('tools-discard').disabled = !pendingRows().length;
      status(notice || (plan.conflicts.length ? '目标字幕已改变，草稿已保留' : summary(plan)));
    }
    function meta(row) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'find-tools-location'; button.dataset.locate = row.key;
      button.textContent = `${row.trackName}_${row.number}  ${formatTime(row.start)}`;
      button.title = t('定位到字幕'); return button;
    }
    function render() {
      if (mode === 'search' || list.hidden || !bridge.isOpen()) return;
      cancelAnimationFrame(renderFrame);
      const height = mode === 'edit' ? 128 : 100;
      canvas.style.height = `${shown.length * height}px`;
      const first = Math.max(0, Math.floor(list.scrollTop / height) - 2), last = Math.min(shown.length, first + Math.ceil(list.clientHeight / height) + 5);
      const focused = document.activeElement?.closest('#find-tools-rows textarea'), focus = focused && {key:focused.dataset.key, start:focused.selectionStart, end:focused.selectionEnd};
      const fragment = document.createDocumentFragment();
      for (let i = first; i < last; i++) {
        const row = shown[i], item = document.createElement('div'); item.className = 'find-tools-row'; item.dataset.key = row.key;
        item.style.top = `${i * height}px`; item.style.height = `${height}px`;
        const header = document.createElement('div'); header.className = 'find-editor-heading'; header.append(meta(row));
        const state = document.createElement('span'); state.className = 'find-tools-row-status';
        const draft = bridge.drafts().has(row.key) ? bridge.draft(row.key) : null;
        state.textContent = t(row.locked ? '已锁定' : dirty(draft) ? (draft.before !== row.text ? '原文已改变' : '未应用') : row.disabled ? '已禁用' : '');
        header.append(state); item.append(header);
        if (mode === 'edit') {
          const input = document.createElement('textarea'); input.rows = 2; input.dataset.key = row.key; input.value = draft?.after ?? row.text;
          input.readOnly = row.locked; input.ariaLabel = `${row.trackName}_${row.number}`; input.spellcheck = false; item.append(input);
        } else {
          for (const [title, value] of [['原文',row.change.before],['处理后',row.change.after]]) {
            const line = document.createElement('div'); line.className = 'find-result-text'; line.textContent = `${t(title)}：${value || t('（空文本）')}`;
            line.title = value; item.append(line);
          }
        }
        fragment.append(item);
      }
      canvas.replaceChildren(fragment);
      if (focus) { const input = [...canvas.querySelectorAll('textarea')].find(n => n.dataset.key === focus.key); if (input) { input.focus({preventScroll:true}); input.setSelectionRange(focus.start,focus.end); } }
    }
    function loadWhole(rows) {
      const tracks = bridge.scopeTracks(), key = JSON.stringify([tracks, rows.map(r => r.id)]);
      whole = resumedWhole || wholeDrafts.get(key) || null;
      if (whole && !wholeDirty(whole)) { wholeDrafts.delete(key); whole = null; }
      if (!whole) {
        if (tracks.length !== 1 || !rows.length || rows.some(r => r.text.includes('\n'))) {
          el('whole-text').value = ''; el('whole-text').disabled = true; el('tools-apply').disabled = true; el('tools-discard').disabled = true;
          status(tracks.length !== 1 ? '整体编辑需要选择单条轨道。' : !rows.length ? '当前范围没有字幕' : '当前字幕含有换行，请使用逐条编辑。'); el('whole-report').replaceChildren(); return;
        }
        const p = MSWProductionProject.toProject(DATA), ids = rows.map(r => r.id), chosen = new Set(ids), snapshot = MSWBatchEditing.trackCues(p, tracks[0]);
        const source = MSWBatchEditing.textSources(snapshot.filter(c => chosen.has(c.id)), p);
        const initial = source.map(c => c.text).join('\n');
        whole = {key, track:tracks[0], ids, snapshot, source, initial, text:initial, title:rows[0].trackName};
      }
      el('whole-text').disabled = false;
      if (el('whole-text').value !== whole.text) el('whole-text').value = whole.text;
      el('whole-text').readOnly = rows.some(r => r.locked);
      previewWhole();
    }
    function wholePlan(draft, makeId) {
      if (pendingLinkedSplit || waveformEditor?.drag) throw Error('请先完成当前切分或拖动');
      const p = MSWProductionProject.toProject(DATA), ids = new Set(draft.ids);
      const current = MSWBatchEditing.textSources(MSWBatchEditing.trackCues(p,draft.track).filter(c => ids.has(c.id)),p);
      if (JSON.stringify(current) !== JSON.stringify(draft.source)) throw Error('目标字幕已改变，草稿已保留');
      const lines = draft.text.replace(/\r\n?/g,'\n').split('\n');
      const report = AsrEditorUtils.buildTimedTextEditReport(draft.source,lines);
      if (!report.valid) throw Error('无法映射这些行，请检查修改内容');
      const segments = AsrEditorUtils.applyTimedTextEdit(draft.source,lines);
      if (!segments) throw Error('无法映射这些行，请检查修改内容');
      const result = MSWBatchEditing.draft(p,draft.track,draft.snapshot,draft.ids,segments,report,{makeId});
      return { ...result, report, segments };
    }
    function previewWhole() {
      el('tools-apply').disabled = true; el('tools-discard').disabled = !wholeDirty(whole); el('whole-report').replaceChildren();
      if (!whole || !wholeDirty(whole)) { status(notice || '当前没有文字修改'); return; }
      try {
        const result = wholePlan(whole), stats = result.report.stats;
        const added = result.ids.filter(id => !whole.ids.includes(id)).length, removed = whole.ids.filter(id => !result.ids.includes(id)).length;
        status(count(`修改 ${stats.changedSegments} 条 · 新增 ${added} 条 · 移除 ${removed} 条`, `Change ${stats.changedSegments} · Add ${added} · Remove ${removed}`));
        const metrics = document.createElement('p'); metrics.className = 'msw-processing-hint';
        metrics.textContent = count(`字词时间码：完整映射 ${stats.fullMappedCues || 0} · 部分保留 ${stats.partialMappedCues || 0} · 重新分配 ${stats.structureMappedCues || 0} · 估算 ${stats.estimatedTimingCues || 0} · 清除 ${stats.lostMappedCues || 0}`, `Word timing: complete ${stats.fullMappedCues || 0} · partial ${stats.partialMappedCues || 0} · remapped ${stats.structureMappedCues || 0} · estimated ${stats.estimatedTimingCues || 0} · cleared ${stats.lostMappedCues || 0}`);
        el('whole-report').append(metrics);
        result.segments.slice(0,100).forEach(c => { const line=document.createElement('div'); line.textContent=`${formatTime(c.start)} → ${formatTime(c.end)}  ${c.text}`; el('whole-report').append(line); });
        if(result.segments.length>100){const hint=document.createElement('p');hint.textContent=t('详情仅展示前 100 条，应用包含全部修改。');el('whole-report').append(hint);}
        el('tools-apply').disabled = !stats.changedSegments;
      } catch(error) { status(error.message); }
    }
    function apply() {
      if (el('tools-apply').disabled) return;
      try {
        if (mode === 'edit' && view === 'whole') {
          commitProcessingEdits();
          const result = wholePlan(whole, kind => MSWProject.id(kind));
          if (whole.ids.some(id => dirty([...bridge.drafts().values()].find(d => bridge.records().get(d.key)?.id === id)))) throw Error('请先应用或取消目标字幕的未应用修改');
          const sameStructure = result.ids.length === whole.ids.length && result.segments.every((c,i) => c.id === whole.source[i].id && c.start === whole.source[i].start && c.end === whole.source[i].end);
          if (sameStructure) bridge.commit(result.segments.map((c,i) => ({key:JSON.stringify([whole.track,c.id]),before:whole.source[i].text,after:c.text})), '整体文字编辑');
          else productionCommitProject(result.project,'整体文字编辑',result.ids);
          wholeDrafts.delete(whole.key); whole = null; resumedWhole = null;
        } else {
          const edits = mode === 'tidy' ? changes : pendingRows();
          if (mode === 'tidy' && edits.some(c => dirty(bridge.drafts().get(c.key)))) throw Error('请先应用或取消目标字幕的未应用修改');
          const plan = bridge.commit(edits, mode === 'tidy' ? '文字整理' : '连续文字编辑');
          for (const c of plan.edits) bridge.drafts().delete(c.key);
          notice = count(`已修改 ${plan.edits.length} 条 · 跳过 ${plan.locked} 条锁定字幕`, `Changed ${plan.edits.length} cues · Skipped ${plan.locked} locked`);
        }
        bridge.refresh(); refresh(); bridge.draftsChanged();
      } catch(error) { status(error.message); el('tools-apply').disabled = true; }
    }
    function discard() {
      notice = '';
      if (mode === 'edit' && view === 'whole') { if(whole) wholeDrafts.delete(whole.key); whole=null; resumedWhole=null; }
      else for (const row of bridge.scope()) bridge.drafts().delete(row.key);
      refresh(); bridge.draftsChanged();
    }
    function resumeWhole(key) {
      const pending = key ? wholeDrafts.get(key) : [...wholeDrafts.values()].find(wholeDirty); if (!pending) return false;
      bridge.selectIds(pending.ids); resumedWhole = pending; view = 'whole'; bridge.setMode('edit'); refresh(); el('whole-text').focus(); return true;
    }
    for (const id of ['tidy-trim','tidy-capitalize','tidy-markdown','tidy-prefix','tidy-suffix','tidy-matched']) el(id).addEventListener('change', () => { notice='';refresh(); });
    for (const id of ['tidy-prefix-text','tidy-suffix-text','continuous-threshold']) el(id).addEventListener('input', () => {notice='';clearTimeout(timer);timer=setTimeout(refresh,170);el('tools-apply').disabled=true;});
    for (const name of ['rows','whole']) el('continuous-'+name).addEventListener('click', () => {
      view=name;resumedWhole=null;notice='';list.scrollTop=0;
      el('continuous-rows').setAttribute('aria-pressed',String(view==='rows'));el('continuous-whole').setAttribute('aria-pressed',String(view==='whole'));refresh();
    });
    el('whole-text').addEventListener('input', () => { if(!whole)return;whole.text=el('whole-text').value;if(wholeDirty(whole))wholeDrafts.set(whole.key,whole);else wholeDrafts.delete(whole.key);notice='';el('tools-apply').disabled=true;bridge.draftsChanged();clearTimeout(timer);timer=setTimeout(previewWhole,170); });
    list.addEventListener('scroll', () => {cancelAnimationFrame(renderFrame);renderFrame=requestAnimationFrame(render);});
    new ResizeObserver(render).observe(list);
    canvas.addEventListener('click', event => {const button=event.target.closest('[data-locate]');if(button)bridge.navigate(button.dataset.locate);});
    canvas.addEventListener('input', event => {
      const input=event.target.closest('textarea[data-key]');if(!input)return;
      const draft=bridge.draft(input.dataset.key);draft.after=input.value;notice='';
      input.closest('.find-tools-row').querySelector('.find-tools-row-status').textContent=t(dirty(draft)?'未应用':'');
      updateRowsStatus();bridge.draftsChanged();
    });
    el('tools-apply').addEventListener('click',apply);el('tools-discard').addEventListener('click',discard);
    el('tools').addEventListener('keydown', event => {if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)&&!event.isComposing){event.preventDefault();event.stopPropagation();if(view==='whole'&&mode==='edit'){clearTimeout(timer);previewWhole();}apply();}});
    return { setMode,refresh,hasDraft:()=>[...wholeDrafts.values()].some(wholeDirty),pendingCount:()=>[...wholeDrafts.values()].filter(wholeDirty).length,resumeWhole,
      pendingKeys:()=>[...wholeDrafts.values()].filter(wholeDirty).map(d=>d.key),
      invalidate(){el('tools-apply').disabled=true;},
      scopeChanged(){resumedWhole=null;notice='';},
      reset(){clearTimeout(timer);wholeDrafts.clear();whole=null;resumedWhole=null;view='rows';notice='';scopeKey='';}, close(){clearTimeout(timer);} };
  };
})(window);
