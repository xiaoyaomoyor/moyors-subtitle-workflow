// One filtered result set, shared drafts and one text transaction.
(function (global) {
  'use strict';
  const core=global.MSWFindCore, host=global.MSWE.resolve('processing-host');
  const el=id=>document.getElementById('find-edit-'+id), panel=el('panel'), viewport=el('results'), canvas=el('rows');
  const tidy=id=>document.getElementById('find-tidy-'+id);
  const t=text=>global.MSWE_I18N?.translateText(text)||text;
  let records=new Map(),references=new Map(),cuesById=new Map(),tracks=[],trackSignature='',speakerSignature='';
  let trackIds=new Set(),speakerIds=new Set(),selected=[],excluded=new Set(),drafts=new Map(),invalidGroups=new Map();
  let result={rows:[],count:0},matchMap=new Map(),units=[],changes=[],ready=false,activeKey=null,activeMatch=0;
  let queryVersion=0,worker=null,workerBusy=false,timeout,queryTimer,syncTimer,renderFrame,rowHeight=156;
  let plainEngine=core.createEngine(),notice='',recoverDrafts=false;
  const floating=host.createFloatingPanel({panel,dragHandle:el('drag'),anchorButton:document.querySelector('[data-menubar-item="subtitle"] > button'),positionKey:'msw.findEdit.position.v1',onClose});
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
      const speaker = MSWSpeaker.profile(DATA,cue,source.segments[cue.color_ref?.headIdx]);
      const row = { speakerId:speaker?.id || '', speakerName:speaker ? MSWSpeaker.displayName(speaker) : t('未指定说话人'), key, id: cue.id, trackId, trackName: track.name, order: track.order, start: cue.start, end: cue.end,
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
    refreshFilters();
    return changed.length > 0 || removed.length > 0;
  }

  function checks(target, rows, chosen) {
    target.replaceChildren(...rows.map(row=>{
      const label=document.createElement('label');label.className='media-preview-toggle';
      const input=document.createElement('input');input.type='checkbox';input.value=row.id;input.checked=chosen.has(row.id);
      input.addEventListener('change',()=>{input.checked?chosen.add(row.id):chosen.delete(row.id);scheduleQuery();});
      label.append(input,document.createTextNode(row.name));return label;
    }));
  }
  function refreshFilters() {
    const signature=JSON.stringify(tracks.map(r=>[r.id,r.name]));
    if(signature!==trackSignature){if(!trackSignature)trackIds=new Set(tracks.map(r=>r.id));trackSignature=signature;checks(el('tracks'),tracks,trackIds);}
    const speakers=(DATA.preview?.speaker_palette?.rows||[]).map(r=>({id:r.id,name:MSWSpeaker.displayName(r)}));
    const known=new Set(speakers.map(r=>r.id));
    for(const r of records.values())if(!known.has(r.speakerId)){speakers.push({id:r.speakerId,name:r.speakerName});known.add(r.speakerId);}
    const ss=JSON.stringify(speakers);
    if(ss!==speakerSignature){if(!speakerSignature)speakerIds=new Set(speakers.map(r=>r.id));speakerSignature=ss;checks(el('speakers'),speakers,speakerIds);}
  }
  function scopedRows() {
    const ids=new Set(selected);
    return [...records.values()].filter(r=>(!el('only-selected').checked||ids.has(r.id))&&(el('all-tracks').checked||trackIds.has(r.trackId))&&(el('all-speakers').checked||speakerIds.has(r.speakerId)));
  }
  function options(){return {query:el('query').value,caseSensitive:el('case').checked,regex:el('regex').checked,
    keys:scopedRows().map(r=>r.key),allowEmpty:true,replacement:el('replace-enabled').checked?el('replacement').value:null,
    drafts:Object.fromEntries([...drafts].map(([key,d])=>[key,d.after]))};}
  function stopWorker(){clearTimeout(timeout);worker?.terminate();worker=null;workerBusy=false;}
  function ensureWorker(){
    if(worker)return true;let url;
    try {url=URL.createObjectURL(new Blob([core.workerSource()],{type:'text/javascript'}));worker=new Worker(url);
      worker.onmessage=event=>{if(event.data.version!==queryVersion||!floating.isOpen())return;workerBusy=false;clearTimeout(timeout);publish(event.data.result);};
      worker.onerror=event=>{event.preventDefault();stopWorker();fallback(options());};
      worker.postMessage({type:'update',patch:{rows:[...records.values()],reset:true}});return true;
    }catch(_){stopWorker();return false;}finally{if(url)URL.revokeObjectURL(url);}
  }
  function fallback(query){publish(query.regex?{rows:[],count:0,error:'worker-unavailable'}:plainEngine.search(query));}
  function runQuery(){
    if(!floating.isOpen())return;const query=options(),version=queryVersion;
    if(!ensureWorker()){fallback(query);return;}
    workerBusy=true;worker.postMessage({type:'search',version,query});
    timeout=setTimeout(()=>{if(version===queryVersion&&workerBusy){stopWorker();publish({rows:[],count:0,error:'timeout'});}},1500);
  }
  function scheduleQuery({resetScroll=true}={}) {
    ready=false;el('apply').disabled=true;viewport.setAttribute('aria-busy','true');clearTimeout(queryTimer);++queryVersion;
    if(workerBusy)stopWorker();
    if(resetScroll){viewport.scrollTop=0;activeKey=null;notice='';recoverDrafts=false;}
    matchMap.clear();paintWaveform();queryTimer=setTimeout(runQuery,160);
  }
  function changed(){if(!floating.isOpen())return;ready=false;el('apply').disabled=true;clearTimeout(syncTimer);
    syncTimer=setTimeout(()=>{readIndex();scheduleQuery({resetScroll:false});},180);}
  function highlight(node, text, matches, active = -1) {
    node.replaceChildren(); let cursor = 0;
    matches.forEach(([start, end], i) => {
      node.append(document.createTextNode(text.slice(cursor, start)));
      const mark = document.createElement('mark'); mark.textContent = text.slice(start, end); mark.classList.toggle('current', i === active); node.append(mark); cursor = end;
    });
    node.append(document.createTextNode(text.slice(cursor)));
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
        if (!fixedUpdateTrack(track.id, { collapsed: false })) { notice='请先完成当前编辑，再展开目标轨道';el('message').textContent=t(notice);return; }
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
    const i = units.findIndex(unit => unit.rows.some(row=>row.key===key)), top = i * rowHeight;
    if (top < viewport.scrollTop || top + rowHeight > viewport.scrollTop + viewport.clientHeight) viewport.scrollTop = top;
    renderRows(); paintWaveform();
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
    refreshCueTextRows(new Set(record.cues.map(c => c.id)));
    container.querySelectorAll('.cue.selected').forEach(node => node.classList.remove('selected'));
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
  function processOptions(){return {trim:tidy('trim').checked,capitalize:tidy('capitalize').checked,stripMarkdown:tidy('markdown').checked,addPrefix:tidy('prefix').checked,prefix:tidy('prefix-text').value,addSuffix:tidy('suffix').checked,suffix:tidy('suffix-text').value};}
  function publish(next){
    if(recoverDrafts&&!next.error){
      const present=new Set(next.rows.map(r=>r.key));
      for(const [key,d] of drafts)if(d.before!==d.after&&!present.has(key)){next.rows.push({key,matches:[],after:d.after});present.add(key);}
      for(const group of invalidGroups.values())for(const row of group.rows)if(!present.has(row.key)){next.rows.push({key:row.key,matches:[]});present.add(row.key);}
    }
    result=next;ready=!next.error&&!next.limited;viewport.setAttribute('aria-busy','false');
    matchMap=new Map(next.rows.filter(r=>r.matches.length).map(r=>[records.get(r.key)?.id,r]));
    const errors={'invalid-regex':'正则表达式无效','worker-unavailable':'此环境无法安全运行正则，请使用普通文字查找','timeout':'查询耗时过长，请简化正则表达式','replacement-too-large':'替换结果过大，请缩小范围'};
    notice=errors[next.error]||(next.limited?'匹配过多，请缩小范围':notice);
    buildUnits();updatePlan();renderRows();paintWaveform();
  }
  function buildUnits(){
    const rows=result.rows.map(hit=>records.get(hit.key)||drafts.get(hit.key)?.row||[...invalidGroups.values()].flatMap(g=>g.rows).find(r=>r.key===hit.key)).filter(Boolean),group=el('group').value;
    if(group==='rows')units=rows.map(row=>({id:row.key,title:`${row.trackName}_${row.number}`,rows:[row]}));
    else {const groups=new Map();for(const row of rows){const key=group==='track'?row.trackId:row.speakerId;if(!groups.has(key))groups.set(key,{id:group+':'+key,title:group==='track'?row.trackName:row.speakerName,rows:[]});groups.get(key).rows.push(row);}units=[...groups.values()];}
    for(const unit of units)unit.draftKey=JSON.stringify(unit.rows.map(r=>r.key));
    rowHeight=group==='rows'?156:300;canvas.style.height=`${units.length*rowHeight}px`;
    el('empty').hidden=!!rows.length;el('empty').textContent=t('当前范围没有字幕');
  }
  function draftFor(key){const row=records.get(key);let d=drafts.get(key);if(!d&&row){d={key,before:row.text,after:row.text,row:{...row}};drafts.set(key,d);}return d;}
  function inputText(row){return drafts.get(row.key)?.after??row.text;}
  function unitText(unit){return el('group').value==='rows'?inputText(unit.rows[0]):invalidGroups.get(unit.draftKey)?.text??MSWFindTextTools.pack(unit.rows,inputText);}
  function updatePlan(){
    const opts=processOptions();
    changes=result.rows.filter(hit=>!excluded.has(hit.key)).map(hit=>{
      const draft=drafts.get(hit.key),row=records.get(hit.key)||draft?.row;
      return {key:hit.key,before:draft?.before??row?.text??'',after:AsrEditorUtils.applyTextProcessing(hit.after??draft?.after??row?.text??'',opts)};
    });
    const plan=core.planChanges(changes,records),invalid=units.some(u=>invalidGroups.has(u.draftKey)&&u.rows.some(r=>!excluded.has(r.key)));
    el('apply').disabled=!ready||invalid||!!plan.conflicts.length||!plan.edits.length;
    el('message').textContent=t(invalid?'请保留字幕分隔行；增删字幕请使用切分或合并':plan.conflicts.length?'目标字幕已改变，草稿已保留':notice||`修改 ${plan.edits.length} 条 · 跳过 ${plan.locked} 条锁定字幕`);
    el('count').textContent=t(`${result.rows.length} 条 · 已选 ${changes.length}`);
    const dirty=[...drafts.values()].filter(d=>d.before!==d.after).length+invalidGroups.size;
    el('drafts').hidden=!dirty;el('drafts').textContent=t(`${dirty} 条未应用`);
    el('select-all').disabled=!result.rows.length;
    return new Map(changes.map(c=>[c.key,c]));
  }
  function renderRows(){
    if(!floating.isOpen()||!el('result-section').open)return;cancelAnimationFrame(renderFrame);
    const first=Math.max(0,Math.floor(viewport.scrollTop/rowHeight)-2),last=Math.min(units.length,first+Math.ceil(viewport.clientHeight/rowHeight)+5);
    const changesByKey=new Map(changes.map(c=>[c.key,c])),existing=new Map([...canvas.children].map(n=>[n.dataset.unit,n]));
    const keep=new Set();
    for(let i=first;i<last;i++){
      const unit=units[i];keep.add(unit.id);let node=existing.get(unit.id);
      if(!node){
        node=document.createElement('article');node.className='find-unified-row';node.dataset.unit=unit.id;
        const header=document.createElement('div');header.className='find-result-meta';
        const check=document.createElement('input');check.type='checkbox';check.dataset.check=unit.id;
        const button=document.createElement('button');button.type='button';button.className='find-tools-location';button.dataset.locate=unit.id;
        const state=document.createElement('span');state.className='find-result-status';
        const reset=document.createElement('button');reset.type='button';reset.className='find-reset';reset.dataset.reset=unit.id;reset.textContent='↶';reset.title=t('放弃此条草稿');
        header.append(check,button,state,reset);
        const input=document.createElement('textarea');input.dataset.unit=unit.id;input.spellcheck=false;
        const preview=document.createElement('div');preview.className='find-result-after';preview.dataset.preview='';
        node.append(header,input,preview);canvas.append(node);
      }
      node.style.top=`${i*rowHeight}px`;node.style.height=`${rowHeight}px`;
      node.classList.toggle('current',unit.rows.some(r=>r.key===activeKey));
      const selectedCount=unit.rows.filter(r=>!excluded.has(r.key)).length,check=node.querySelector('input');
      check.checked=selectedCount===unit.rows.length;check.indeterminate=selectedCount>0&&!check.checked;check.ariaLabel=t('选中')+' '+unit.title;
      node.querySelector('[data-locate]').textContent=unit.title+'  '+formatTime(unit.rows[0].start)+(unit.rows.length>1?' · '+t(`${unit.rows.length} 条字幕`):'');
      const input=node.querySelector('textarea'),value=unitText(unit);if(input.value!==value&&document.activeElement!==input)input.value=value;
      input.ariaLabel=unit.title;input.readOnly=unit.rows.some(r=>r.locked||!records.has(r.key));input.style.height=el('group').value==='rows'?'74px':'214px';
      const dirty=unit.rows.some(r=>drafts.has(r.key)&&drafts.get(r.key).after!==drafts.get(r.key).before)||invalidGroups.has(unit.draftKey);
      node.querySelector('.find-result-status').textContent=t(unit.rows.some(r=>!records.has(r.key))?'来源已删除':input.readOnly?'已锁定':dirty?'未应用':unit.rows.every(r=>r.disabled)?'已禁用':'');node.querySelector('[data-reset]').hidden=!dirty;
      const modified=unit.rows.filter(r=>changesByKey.has(r.key)&&changesByKey.get(r.key).after!==inputText(r));
      const preview=node.querySelector('[data-preview]');preview.textContent=modified.length?t('应用后：')+(unit.rows.length===1?changesByKey.get(unit.rows[0].key).after:t(modified.length+' 条字幕将更新')):'';
      preview.title=preview.textContent;
    }
    for(const [id,node] of existing)if(!keep.has(id)&&!node.contains(document.activeElement))node.remove();
  }
  function apply(){
    if(el('apply').disabled)return;
    try{const plan=commit(changes,'查找并编辑');for(const c of plan.edits)drafts.delete(c.key);
      notice=`已修改 ${plan.edits.length} 条 · 跳过 ${plan.locked} 条锁定字幕`;
      // A single application consumes the operation recipe, avoiding accidental double prefixes.
      for(const id of ['trim','capitalize','markdown','prefix','suffix'])tidy(id).checked=false;
      tidy('prefix-text').hidden=tidy('suffix-text').hidden=true;el('replace-enabled').checked=false;el('replacement').disabled=true;
      readIndex();scheduleQuery({resetScroll:false});
    }catch(error){notice=error.message;el('message').textContent=t(notice);el('apply').disabled=true;}
  }
  function hasDraft(){return invalidGroups.size>0||[...drafts.values()].some(d=>d.before!==d.after);}
  function open({ids}={}){const was=floating.isOpen();floating.open();readIndex();
    if(ids){selected=[...ids];el('only-selected').checked=true;el('all-tracks').checked=el('all-speakers').checked=true;el('tracks').hidden=el('speakers').hidden=true;}
    if(!was||ids)scheduleQuery({resetScroll:false});el('query').focus();}
  function onClose(){clearTimeout(queryTimer);clearTimeout(syncTimer);++queryVersion;stopWorker();matchMap.clear();paintWaveform();waveformEditor?.refreshCueOverlay?.();}
  el('open').addEventListener('click',()=>open());el('close').addEventListener('click',()=>floating.close());el('apply').addEventListener('click',apply);
  for(const id of ['only-selected','all-tracks','all-speakers','case','regex'])el(id).addEventListener('change',()=>{
    if(id==='only-selected'&&el(id).checked)selected=batchSelectedIds();
    el('tracks').hidden=el('all-tracks').checked;el('speakers').hidden=el('all-speakers').checked;scheduleQuery();
  });
  el('group').addEventListener('change',()=>{viewport.scrollTop=0;canvas.replaceChildren();buildUnits();updatePlan();renderRows();});
  el('select-all').addEventListener('click',()=>{for(const hit of result.rows)excluded.delete(hit.key);updatePlan();renderRows();});
  el('replace-enabled').addEventListener('change',()=>{el('replacement').disabled=!el('replace-enabled').checked;notice='';scheduleQuery({resetScroll:false});});
  for(const id of ['query','replacement']){
    el(id).addEventListener('input',event=>{notice='';if(!event.isComposing)scheduleQuery({resetScroll:id==='query'});});
    el(id).addEventListener('compositionend',()=>scheduleQuery({resetScroll:id==='query'}));
  }
  for(const id of ['trim','capitalize','markdown','prefix','suffix','prefix-text','suffix-text'])tidy(id).addEventListener(id.endsWith('-text')?'input':'change',()=>{
    notice='';tidy('prefix-text').hidden=!tidy('prefix').checked;tidy('suffix-text').hidden=!tidy('suffix').checked;updatePlan();renderRows();
  });
  canvas.addEventListener('change',event=>{const id=event.target.dataset.check;if(!id)return;const unit=units.find(u=>u.id===id);for(const r of unit.rows)event.target.checked?excluded.delete(r.key):excluded.add(r.key);updatePlan();renderRows();});
  canvas.addEventListener('click',event=>{
    const locate=event.target.closest('[data-locate]'),reset=event.target.closest('[data-reset]');
    const unit=units.find(u=>u.id===(locate?.dataset.locate||reset?.dataset.reset));if(!unit)return;
    if(locate)navigate(unit.rows[0].key);
    else {for(const row of unit.rows)drafts.delete(row.key);invalidGroups.delete(unit.draftKey);notice='';scheduleQuery({resetScroll:false});updatePlan();renderRows();}
  });
  canvas.addEventListener('input',event=>{
    const input=event.target.closest('textarea');if(!input)return;const unit=units.find(u=>u.id===input.dataset.unit);if(!unit)return;
    notice='';
    try{const values=el('group').value==='rows'?[input.value]:MSWFindTextTools.unpack(unit.rows,input.value);
      unit.rows.forEach((row,i)=>{const d=draftFor(row.key);d.after=values[i];if(d.after===d.before)drafts.delete(row.key);});invalidGroups.delete(unit.draftKey);
    }catch(error){invalidGroups.set(unit.draftKey,{text:input.value,rows:unit.rows,group:el('group').value});notice=error.message;}
    updatePlan();if(!event.isComposing)scheduleQuery({resetScroll:false});
  });
  canvas.addEventListener('compositionend',()=>scheduleQuery({resetScroll:false}));
  el('drafts').addEventListener('click',()=>{
    const invalid=[...invalidGroups.values()][0],dirty=[...drafts.values()].filter(d=>d.before!==d.after);
    selected=invalid?invalid.rows.map(r=>r.id):dirty.map(d=>records.get(d.key)?.id).filter(Boolean);
    el('only-selected').checked=true;el('all-tracks').checked=el('all-speakers').checked=true;el('tracks').hidden=el('speakers').hidden=true;el('query').value='';
    if(invalid)el('group').value=invalid.group;scheduleQuery();recoverDrafts=true;
  });
  viewport.addEventListener('scroll',()=>{cancelAnimationFrame(renderFrame);renderFrame=requestAnimationFrame(renderRows);});
  new ResizeObserver(renderRows).observe(viewport);el('result-section').addEventListener('toggle',renderRows);
  new ResizeObserver(()=>{if(!floating.isOpen())return;const r=panel.getBoundingClientRect();panel.style.left=`${Math.max(6,Math.min(r.left,innerWidth-r.width-6))}px`;panel.style.top=`${Math.max(6,Math.min(r.top,innerHeight-r.height-6))}px`;}).observe(panel);
  document.addEventListener('keydown',event=>{
    if(event.isComposing||event.defaultPrevented||document.querySelector('.modal-mask.show,dialog[open]'))return;
    if((event.ctrlKey||event.metaKey)&&!event.altKey&&!event.shiftKey&&event.key.toLowerCase()==='f'){event.preventDefault();event.stopImmediatePropagation();open();}
    else if(floating.isOpen()&&panel.contains(event.target)&&event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();event.stopImmediatePropagation();apply();}
    else if(event.key==='Escape'&&floating.isOpen()&&!document.querySelector('#ctxmenu.show,#msw-option-help:not([hidden])')){
      const front=[...document.querySelectorAll('.gap-remove-panel.show,.settings-panel.show')].sort((a,b)=>+getComputedStyle(b).zIndex-+getComputedStyle(a).zIndex)[0];
      if(front===panel){event.preventDefault();event.stopImmediatePropagation();floating.close();}
    }
  },true);
  window.addEventListener('msw:subtitles-changed',changed);
  window.addEventListener('msw:project-changed',()=>{
    stopWorker();++queryVersion;clearTimeout(queryTimer);clearTimeout(syncTimer);records.clear();references.clear();plainEngine=core.createEngine();trackSignature=speakerSignature='';activeKey=null;
    selected=[];recoverDrafts=false;excluded.clear();drafts.clear();invalidGroups.clear();el('only-selected').checked=false;el('all-tracks').checked=el('all-speakers').checked=true;el('tracks').hidden=el('speakers').hidden=true;
    el('query').value=el('replacement').value='';el('replace-enabled').checked=false;el('replacement').disabled=true;el('group').value='rows';notice='';
    for(const id of ['trim','capitalize','markdown','prefix','suffix'])tidy(id).checked=false;tidy('prefix-text').hidden=tidy('suffix-text').hidden=true;
    if(floating.isOpen()){readIndex();scheduleQuery();}
  });
  global.MSWFindEdit=Object.freeze({open,close:()=>floating.close(),changed,decorateBlock,keepVisible,capture,restore,hasDraft});
})(window);
