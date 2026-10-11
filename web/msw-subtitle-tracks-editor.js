// Fixed tracks are the current project model; the explicit legacy query is for compatibility tests.
const fixedTracksRequested = new URLSearchParams(location.search).get('subtitle-tracks') !== '0';
const fixedTrackCore = window.MSWSubtitleTracks;
let fixedActiveTrackId = null;
let fixedTrackFilter = '';
let fixedDraftOwners = new WeakMap();
let fixedLastContent = null;
let fixedHistoryCheckpoint = null;
let fixedOwnerCache = null;
let fixedCueOwners = new WeakMap();
let fixedLayoutCache = null;
function fixedTrackMode() { return DATA.schema === fixedTrackCore.SCHEMA; }
function fixedInvalidate() { fixedOwnerCache = null; fixedLayoutCache = null; fixedCueOwners = new WeakMap(); fixedPreviewInvalidate(); }
function fixedRef(cue, role = 'main', trackId = null) {
  return { role, track_id: role === 'main' ? null : trackId || getActiveExtensionTrack()?.id, cue_id: cue?.id };
}
function fixedOwners() {
  if (!fixedOwnerCache) {
    fixedOwnerCache = fixedTrackCore.ownerMap(DATA);
    for (const source of window.MSWSubtitleLayers.tracks(DATA)) for (const cue of source.segments) fixedCueOwners.set(cue,
      fixedOwnerCache.get(fixedTrackCore.key({ role: source.role, track_id: source.track_id, cue_id: cue.id })));
  }
  return fixedOwnerCache;
}
function fixedOwner(cue, role = 'main', trackId = null) { return fixedOwners().get(fixedTrackCore.key(fixedRef(cue, role, trackId))); }
function fixedTrack(cue, role = 'main', trackId = null) { return DATA.subtitle_tracks?.tracks.find(t => t.id === fixedOwner(cue, role, trackId)); }
function fixedActiveTrack() {
  return DATA.subtitle_tracks?.tracks.find(t => t.id === fixedActiveTrackId) || DATA.subtitle_tracks?.tracks[0];
}
function fixedStatus(message = '') {
  const node = document.getElementById('fixed-track-status');
  if (node) node.textContent = message;
}
function fixedCanEdit(cues, role = 'main', trackId = null, linked = true) {
  if (!fixedTrackMode()) return true;
  try { fixedTrackCore.assertEditable(DATA, cues.filter(Boolean).map(c => fixedRef(c, role, trackId)), linked); return true; }
  catch (error) { fixedStatus(error.message); return false; }
}
function fixedSameTrack(a, b) {
  if (!fixedTrackMode()) return true;
  fixedOwners(); return fixedCueOwners.get(a) === fixedCueOwners.get(b);
}
function fixedContent() {
  return structuredClone({ schema: DATA.schema, segments: DATA.segments, multi_subtitle: DATA.multi_subtitle,
    subtitle_layers: DATA.subtitle_layers, subtitle_tracks: DATA.subtitle_tracks });
}
function fixedReset() {
  fixedLastContent = null; fixedHistoryCheckpoint = null; fixedDraftOwners = new WeakMap(); fixedInvalidate();
}
function fixedBeginEdit() {
  if (!fixedTrackMode()) return;
  fixedLastContent = fixedContent();
  fixedHistoryCheckpoint = editorHistory.checkpoint();
}
function fixedAcceptEdit() {
  if (!fixedTrackMode()) return true;
  try {
    for (const cue of DATA.segments) if (fixedDraftOwners.get(cue)?.legacy
      && !DATA.subtitle_layers.legacy_overlay.cue_ids.includes(cue.id)) DATA.subtitle_layers.legacy_overlay.cue_ids.push(cue.id);
    fixedTrackCore.reconcile(DATA, row => fixedDraftOwners.get(row.cue)?.owner || fixedActiveTrack()?.id);
    if (fixedLastContent) fixedTrackCore.assertLocks(fixedLastContent, DATA);
    fixedLastContent = fixedContent();
    fixedHistoryCheckpoint = editorHistory.checkpoint();
    fixedInvalidate();
    return true;
  } catch (error) {
    if (fixedLastContent) {
      for (const field of ['segments', 'multi_subtitle', 'subtitle_layers', 'subtitle_tracks']) DATA[field] = structuredClone(fixedLastContent[field]);
      if (fixedHistoryCheckpoint) editorHistory.restoreCheckpoint(fixedHistoryCheckpoint);
      fixedInvalidate(); updateUndoRedoButtons();
    }
    fixedStatus(error.message);
    return false;
  }
}
function fixedInherit(source, children) {
  if (!fixedTrackMode()) return;
  fixedOwners(); const owner = fixedCueOwners.get(source);
  const legacy = DATA.segments.includes(source) && DATA.subtitle_layers.legacy_overlay.cue_ids.includes(source.id);
  for (const cue of children) fixedDraftOwners.set(cue, { owner, legacy });
}
function fixedMergePlan(plan) {
  if (!fixedTrackMode()) return;
  const refs = plan.changes.flatMap(change => [...change.ids].map(id => ({ role: change.role, track_id: change.track_id, cue_id: id })));
  fixedTrackCore.assertEditable(DATA, refs);
  const owners = fixedOwners(), values = new Set(refs.map(r => owners.get(fixedTrackCore.key(r))));
  if (values.size !== 1) throw Error('跨轨字幕不能直接合并，请先移到同一轨道');
  const owner = [...values][0], trial = fixedContent();
  // Main/sub sources may have independent time offsets and different sort
  // order. A linked merge retains the earliest main cue's group position.
  const mainChange=plan.changes.find(change=>change.role==='main');
  if(mainChange&&plan.changes.length>1) {
    const earliest=DATA.segments.filter(c=>mainChange.ids.has(c.id)).sort((a,b)=>a.start-b.start)[0];
    for(const change of plan.changes) {
      if(earliest?.subtitle_position)change.merged.subtitle_position=structuredClone(earliest.subtitle_position);
      else delete change.merged.subtitle_position;
    }
  }
  for (const change of plan.changes) {
    const target = change.role === 'main' ? trial : trial.multi_subtitle.tracks.find(t => t.id === change.track_id);
    target.segments = structuredClone(change.segments);
    fixedDraftOwners.set(change.merged, { owner });
  }
  if (trial.multi_subtitle) trial.multi_subtitle.bindings = structuredClone(plan.bindings);
  fixedTrackCore.reconcile(trial, () => owner);
}
function fixedLayout() {
  return fixedLayoutCache ||= fixedTrackCore.layout(DATA, getActiveExtensionTrack()?.id, multiSubtitleVisible());
}
function fixedWaveLayout(role) {
  if (!fixedTrackMode()) return null;
  const view = fixedLayout(), cues = role === 'main' ? DATA.segments : getActiveExtensionTrack()?.segments || [];
  const lanes = new Map();
  for (const cue of cues) {
    const lane = view.positions.get(JSON.stringify([fixedOwner(cue, role), role]));
    if (lane !== undefined) lanes.set(cue.id, lane);
  }
  return { lanes, count: view.count, indices: new Map(cues.map((cue, index) => [cue, index])),
    index: new layerCore.IntervalIndex(cues, cue => lanes.has(cue.id)) };
}
function fixedHitTrack(fromBottom) {
  if (!fixedTrackMode()) return null;
  const lane = Math.floor(Math.max(0, fromBottom) / 38), view = fixedLayout();
  const band = view.bands.find(b => lane >= b.bottom && lane < b.bottom + b.size);
  if (!band) return null;
  fixedActiveTrackId = band.track.id;
  return band.roles.find(role => view.positions.get(JSON.stringify([band.track.id, role])) === lane) || 'main';
}
function fixedCommitProject(next, label) {
  if (pendingLinkedSplit) { fixedStatus('请先确认或取消当前切分'); return false; }
  try { fixedTrackCore.validate(next); fixedTrackCore.assertLocks(DATA, next); }
  catch (error) { fixedStatus(error.message); return false; }
  commitProcessingEdits(); pushUndo(label, { captureView: true });
  DATA.subtitle_tracks = next.subtitle_tracks;
  DATA.subtitle_layers = next.subtitle_layers;
  fixedInvalidate(); projectImportDirty = true; fixedStatus();
  renderAll({ waveform: 'full' }); scheduleAutoSaveFlush();
  return true;
}
function fixedAddTrack(kind, refs = null) {
  try {
    let next = fixedTrackCore.addTrack(DATA, kind, window.MSWProject.id('subtitle-track'));
    const id = next.subtitle_tracks.tracks.at(-1).id;
    if (refs) next = fixedTrackCore.assign(next, refs, id);
    if (fixedCommitProject(next, refs ? '新建轨道并移动字幕' : '添加字幕轨道')) { fixedActiveTrackId = id; fixedSyncUI(); }
  } catch (error) { fixedStatus(error.message); }
}
function fixedUpdateTrack(id, update) {
  const next = fixedContent(), track = next.subtitle_tracks.tracks.find(t => t.id === id);
  if (!track) return;
  Object.assign(track, update);
  if (update.enabled === true) {
    const members = new Set(next.subtitle_tracks.assignments.filter(a => a.subtitle_track_id === id && a.role === 'main').map(a => a.cue_id));
    next.subtitle_layers.legacy_overlay.cue_ids = next.subtitle_layers.legacy_overlay.cue_ids.filter(cueId => !members.has(cueId));
  }
  return fixedCommitProject(next, '调整字幕轨道');
}
function fixedMove(refs, targetId) {
  try { if (fixedCommitProject(fixedTrackCore.assign(DATA, refs, targetId), '移动到字幕轨道')) fixedActiveTrackId = targetId; }
  catch (error) { fixedStatus(error.message + '；可选择新建轨道'); }
}
function fixedMenuItem(label, action, disabled = false) {
  const item = document.createElement('button'); item.type = 'button'; item.className = 'item';
  item.textContent = label; item.disabled = disabled;
  item.onclick = () => { ctxmenu.classList.remove('show'); action(); };
  ctxmenu.append(item); return item;
}
function fixedAppendMoveMenu(cues, role = 'main', trackId = null) {
  if (!fixedTrackMode()) return;
  const refs = cues.filter(Boolean).map(c => fixedRef(c, role, trackId));
  const section = document.createElement('details'), title = document.createElement('summary');
  section.className = 'fixed-track-move-menu'; title.textContent = '移到轨道…'; section.append(title); ctxmenu.append(section);
  for (const track of DATA.subtitle_tracks.tracks) {
    const item = fixedMenuItem(track.name + (track.locked ? ' · 已锁定' : ''), () => fixedMove(refs, track.id), track.locked);
    section.append(item);
  }
  section.append(fixedMenuItem('新建字幕轨道', () => fixedAddTrack('subtitle', refs)));
}
function fixedRenameTrack(track, x, y, settings = false) {
  ctxmenu.replaceChildren();
  const generation=mswProjectGeneration,form=document.createElement('form');form.className='fixed-track-form';
  const label=document.createElement('label');label.textContent='轨道名称';
  const input=document.createElement('input');input.value=track.name;input.maxLength=160;input.required=true;
  input.setAttribute('aria-label','轨道名称');label.append(input);form.append(label);
  let purpose,layout;
  if(settings) {
    const field=(caption,choices,value,help)=>{const label=document.createElement('label');label.textContent=caption;label.dataset.optionHelp=help;
      const select=document.createElement('select');select.setAttribute('aria-label',caption);select.replaceChildren(...choices.map(([id,text])=>new Option(text,id)));select.value=value;label.append(select);form.append(label);return select;};
    purpose=field('用途',[['none','未指定'],['dialogue','对白'],['source','源字幕'],['translation','译字幕'],['annotation','画面文字']],fixedTrackCore.purpose(track),'用途仅作标记，不改变排布、样式或识别和导出范围。主副字幕的绑定关系保持不变。');
    layout=field('排布',[['auto','自动排布'],['fixed','固定位置']],fixedTrackCore.placement(track),'在工程使用“固定轨道排布”时生效。自动排布：按轨道顺序避让重叠字幕。固定位置：独立定位，不参与自动避让；可在“字幕样式与画面位置”中调整。旧工程单独定位过的字幕仍保留位置覆盖。');
    layout.disabled=track.locked;
    window.MSWHelp?.hydrate(form);
  }
  const actions=document.createElement('div');actions.className='fixed-track-form-actions';
  const cancel=document.createElement('button');cancel.type='button';cancel.textContent='取消';cancel.onclick=()=>ctxmenu.classList.remove('show');
  const save=document.createElement('button');save.type='submit';save.textContent='保存';save.className='primary';actions.append(cancel,save);form.append(actions);
  form.onsubmit=event=>{event.preventDefault();const name=input.value.trim();if(!name){input.setCustomValidity('请输入轨道名称');input.reportValidity();return;}
    if(generation!==mswProjectGeneration||!DATA.subtitle_tracks.tracks.some(t=>t.id===track.id)){ctxmenu.classList.remove('show');return;}
    if(fixedUpdateTrack(track.id,{name,...(settings?{purpose:purpose.value,layout:layout.value}:{})}))ctxmenu.classList.remove('show');};
  input.oninput=()=>input.setCustomValidity('');
  form.onkeydown=event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();ctxmenu.classList.remove('show');}};
  ctxmenu.append(form);ctxShowAt(x,y);input.focus();input.select();
}
function fixedTrackMenu(track, x, y) {
  fixedStatus();
  ctxmenu.replaceChildren();
  fixedMenuItem('重命名', () => fixedRenameTrack(track,x,y));
  fixedMenuItem('轨道设置', () => fixedRenameTrack(track,x,y,true));
  fixedMenuItem('字幕样式与画面位置', () => window.MSWSubtitleStyle?.editTrack(track.id));
  fixedMenuItem(track.collapsed ? '展开轨道' : '折叠轨道', () => fixedUpdateTrack(track.id, { collapsed: !track.collapsed }));
  fixedMenuItem(track.enabled ? '禁用轨道' : '启用轨道', () => fixedUpdateTrack(track.id, { enabled: !track.enabled }));
  fixedMenuItem(track.locked ? '解锁轨道' : '锁定轨道', () => fixedUpdateTrack(track.id, { locked: !track.locked }));
  fixedMenuItem(track.show_secondary ? '按内容显示副字幕行' : '始终显示副字幕行', () => fixedUpdateTrack(track.id, { show_secondary: !track.show_secondary }));
  fixedMenuItem('新增字幕轨道', () => fixedAddTrack('subtitle'));
  for (const [delta, label] of [[-1, '上移轨道'], [1, '下移轨道']]) {
    const index = DATA.subtitle_tracks.tracks.findIndex(t => t.id === track.id);
    fixedMenuItem(label, () => {
      const next = fixedContent(), tracks = next.subtitle_tracks.tracks;
      [tracks[index], tracks[index + delta]] = [tracks[index + delta], tracks[index]];
      fixedCommitProject(next, '调整轨道顺序');
    }, index + delta < 0 || index + delta >= DATA.subtitle_tracks.tracks.length);
  }
  const occupied = DATA.subtitle_tracks.assignments.some(a => a.subtitle_track_id === track.id);
  fixedMenuItem('删除空轨道', () => {
    const next = fixedContent(); next.subtitle_tracks.tracks = next.subtitle_tracks.tracks.filter(t => t.id !== track.id);
    fixedCommitProject(next, '删除空字幕轨道');
  }, occupied || track.locked || DATA.subtitle_tracks.tracks.length === 1);
  ctxShowAt(x, y);
}
function fixedRenderHeads(group, row, audioSpace) {
  if (!fixedTrackMode()) return false;
  for (const band of fixedLayout().bands) {
    const track = band.track, node = document.createElement('div'); node.className = 'fixed-track-head';
    node.dataset.subtitleTrackId = track.id;
    node.classList.toggle('disabled-track', !track.enabled);
    node.classList.toggle('locked-track', track.locked);
    node.classList.toggle('current', fixedActiveTrack()?.id === track.id);
    node.style.bottom = `${7 + audioSpace + band.bottom * 38}px`; node.style.height = `${band.size * 38 - 4}px`;
    if(track.collapsed||band.roles.includes('extension')) {
      const collapse = document.createElement('button'); collapse.type = 'button'; collapse.className='fixed-track-collapse';collapse.textContent = track.collapsed ? '›' : '⌄';
      collapse.title = track.collapsed ? '展开轨道' : '折叠轨道'; collapse.setAttribute('aria-label', collapse.title);
      collapse.onclick = () => fixedUpdateTrack(track.id, { collapsed: !track.collapsed });node.append(collapse);
    }
    const name = document.createElement('button');name.type='button';name.className='fixed-track-toggle';name.textContent=track.name;
    name.setAttribute('aria-label',track.name);name.setAttribute('aria-pressed',String(track.enabled));
    name.title = `${track.name}${track.locked ? ' · 已锁定' : ''}\n点击${track.enabled?'禁用':'启用'}本轨道（含主副字幕），右键管理`;
    name.onclick=()=>{const current=DATA.subtitle_tracks.tracks.find(t=>t.id===track.id);if(current)fixedUpdateTrack(current.id,{enabled:!current.enabled});};
    name.onkeydown=event=>{if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();const rect=name.getBoundingClientRect();fixedTrackMenu(track,rect.right,rect.bottom);}};
    node.append(name);
    if(track.locked){const lock=document.createElement('span');lock.className='fixed-track-lock';lock.setAttribute('aria-label','已锁定');lock.innerHTML='<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1"/><path d="M5 7V5a3 3 0 0 1 6 0v2"/></svg>';node.append(lock);}
    if (band.roles.includes('extension')) { const roles = document.createElement('span'); roles.className = 'fixed-track-roles'; roles.textContent = '副字幕'; node.append(roles); }
    for (const type of ['pointerdown', 'pointerup', 'click', 'dblclick', 'contextmenu']) node.addEventListener(type, event => { event.stopPropagation(); if (type === 'contextmenu') { event.preventDefault(); fixedTrackMenu(track, event.clientX, event.clientY); } });
    group.append(node);
  }
  return true;
}
function fixedSyncUI() {
  document.documentElement.classList.toggle('msw-fixed-tracks', fixedTrackMode());
  if (!fixedTrackMode()) return;
  if (!fixedActiveTrackId || !DATA.subtitle_tracks.tracks.some(t => t.id === fixedActiveTrackId)) fixedActiveTrackId = DATA.subtitle_tracks.tracks[0].id;
  const toolbar = document.getElementById('cues-module');
  let select = document.getElementById('fixed-track-filter');
  if (!select && toolbar) {
    const label = document.createElement('label'); label.className = 'fixed-track-filter'; label.textContent = '轨道 ';
    select = document.createElement('select'); select.id = 'fixed-track-filter'; select.setAttribute('aria-label', '字幕轨道范围');
    select.onchange = () => { fixedTrackFilter = select.value; applySearch(searchEl.value); };
    label.append(select); toolbar.querySelector('.module-tab-strip')?.after(label);
  }
  if (select) {
    if (!DATA.subtitle_tracks.tracks.some(t => t.id === fixedTrackFilter)) fixedTrackFilter = '';
    select.replaceChildren(new Option('全部轨道', ''), ...DATA.subtitle_tracks.tracks.map(t => new Option(t.name, t.id)));
    select.value = fixedTrackFilter;
  }
  if (!document.getElementById('fixed-track-status')) {
    const status = document.createElement('span'); status.id = 'fixed-track-status'; status.setAttribute('role', 'status');
    document.querySelector('.waveform-pane')?.append(status);
  }
  document.getElementById('overlay-track-toggle')?.closest('label')?.setAttribute('hidden', '');
  document.getElementById('subtitle-legacy-visible')?.closest('label')?.setAttribute('hidden', '');
  container.querySelectorAll(':scope > .cue').forEach(node => {
    const main = DATA.segments[Number(node.dataset.mainIdx ?? node.dataset.idx)];
    const ext = getActiveExtensionTrack()?.segments[Number(node.dataset.extIdx)];
    const track = main ? fixedTrack(main) : ext ? fixedTrack(ext, 'extension') : null;
    if (!track) return;
    node.dataset.subtitleTrackId = track.id; node.classList.toggle('fixed-locked', track.locked); node.classList.toggle('fixed-disabled', !track.enabled);
    let badge = node.querySelector(':scope > .fixed-track-badge');
    if (!badge) { badge = document.createElement('span'); badge.className = 'fixed-track-badge'; node.prepend(badge); }
    badge.textContent = track.name + (track.locked ? ' · 已锁定' : '');
  });
}
document.addEventListener('contextmenu',event=>{
  if(!fixedTrackMode()||!event.target.closest('.waveform-track-heads-column')||event.target.closest('.fixed-track-head'))return;
  event.preventDefault();event.stopImmediatePropagation();ctxmenu.replaceChildren();
  fixedMenuItem('新增字幕轨道',()=>fixedAddTrack('subtitle'));ctxShowAt(event.clientX,event.clientY);
},true);
function fixedPanelUI(target) {
  if (!fixedTrackMode()) return;
  let label = document.getElementById('fixed-cue-owner');
  if (!label) { label = document.createElement('span'); label.id = 'fixed-cue-owner'; document.querySelector('#current-cue-panel .module-tab-strip')?.after(label); }
  const track = target ? fixedTrack(target.segment, target.kind, target.trackId) : null;
  label.textContent = track ? `${track.name} · ${target.kind === 'extension' ? '副字幕' : '主字幕'}${track.locked ? ' · 已锁定' : ''}` : '';
  if (track) fixedActiveTrackId = track.id;
  if (track?.locked) for (const node of [cuePanelText, cuePanelStart, cuePanelDuration, cuePanelAddSticker, cuePanelSplit]) if (node) node.disabled = true;
}

document.addEventListener('DOMContentLoaded', () => {
  if (!fixedTrackMode()) return;
  fixedSyncUI(); fixedAcceptEdit();
});

// SRT selection is explicit and independent of the list filter. ASS keeps all
// enabled tracks, matching video output, including annotation positions.
let fixedSrtScope = '';
function fixedSrtProject() {
  const project=structuredClone(DATA),index=fixedTrackCore.createIndex(DATA);
  for(const source of layerCore.tracks(project)) {
    layerCore.materializeReferences(source.segments);
    source.segments=source.segments.filter(c=>{
      const owner=index.trackFor({role:source.role,track_id:source.track_id,cue_id:c.id});
      return owner?.enabled&&!c.disabled&&(!fixedSrtScope||owner.id===fixedSrtScope)
        && layerCore.visible(DATA,c,source.role);
    });
    if(source.role==='main')project.segments=source.segments;
    else project.multi_subtitle.tracks.find(t=>t.id===source.track_id).segments=source.segments;
  }
  return project;
}
async function fixedAssDocument(target='both',removeGaps=false) {
  if(!SERVER_CONFIG?.processingUrl)throw Error('精确 ASS 导出需要本机编辑器服务，请用 MSW 启动器打开工程');
  commitProcessingEdits();
  const project=window.MSWE.resolve('processing-host').exportProject();
  const payload={project,target,video:{width:player.videoWidth||1920,height:player.videoHeight||1080}};
  if(removeGaps) {
    const intervals=[];let cursor=0,output=0;
    const end=Math.max(1,...project.segments.map(c=>c.end),...(project.multi_subtitle?.tracks||[]).flatMap(t=>t.segments.map(c=>c.end)));
    for(const range of getRemovedGapRanges()) {
      const start=Math.min(end,range.start),finish=Math.min(end,range.end);
      if(start>cursor){intervals.push({start_ms:cursor,end_ms:start,output_start_ms:output});output+=start-cursor;}
      cursor=Math.max(cursor,finish);
    }
    if(cursor<end)intervals.push({start_ms:cursor,end_ms:end,output_start_ms:output});
    payload.plan={intervals};
  }
  const result=await window.MSWSubtitleStyle.request('subtitle-preview',payload);
  if(result.layoutVersion!==window.MSWProjectStyle.layoutVersion)throw Error('请保存工程并重启编辑器服务，以加载新的字幕排布');
  if(!EDITOR_SETTINGS.exportStartAtZero)return result.ass;
  // Extend the first exported event to zero without changing stored cue times
  // or recalculating its stable track position.
  const lines=result.ass.split('\n'),events=lines.map((line,index)=>({index,fields:line.startsWith('Dialogue: ')?line.split(','):null})).filter(e=>e.fields);
  const stamp=value=>value.split(':').reduce((sum,part)=>sum*60+Number(part),0);
  events.sort((a,b)=>stamp(a.fields[1])-stamp(b.fields[1]));
  if(events.length){const first=events[0];first.fields[1]='0:00:00.00';lines[first.index]=first.fields.join(',');}
  return lines.join('\n');
}
document.addEventListener('DOMContentLoaded',()=>{
  const anchor=document.getElementById('download-merged-srt');if(!anchor)return;
  const row=document.createElement('div');row.className='fixed-srt-scope';
  const label=document.createElement('label');label.textContent='SRT 范围 ';
  const select=document.createElement('select');select.setAttribute('aria-label','SRT 轨道范围');
  select.onchange=()=>{fixedSrtScope=select.value;};label.append(select);
  row.append(label);anchor.before(row);
  const sync=()=>{row.hidden=!fixedTrackMode();if(!fixedTrackMode())return;
    select.replaceChildren(new Option('全部启用轨道',''),...DATA.subtitle_tracks.tracks.filter(t=>t.enabled).map(t=>new Option(t.name,t.id)));
    if(DATA.subtitle_tracks.tracks.some(t=>t.id===fixedSrtScope))select.value=fixedSrtScope;else fixedSrtScope='';};
  anchor.parentElement.addEventListener('pointerenter',sync);window.addEventListener('msw:project-changed',sync);sync();
});

async function fixedDownloadAss(target='both',removeGaps=false) {
  try {
    const content=await fixedAssDocument(target,removeGaps);
    const suffix=removeGaps?'gap-removed':target==='secondary'?'extension':'';
    await downloadFile(content,`${FILENAME_BASE}${suffix?'.'+suffix:''}.ass`,'text/plain',{desc:'ASS 字幕文件',types:{'text/plain':['.ass']}});
  } catch(error){flashHint(error.message,'warning');}
}
