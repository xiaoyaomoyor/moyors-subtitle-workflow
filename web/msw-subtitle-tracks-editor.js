// Fixed tracks are the current project model; the explicit legacy query is for compatibility tests.
const fixedTracksRequested = new URLSearchParams(location.search).get('subtitle-tracks') !== '0';
const productionFlatRequested = !window.MSWFlatTrialRequested
  && !new URLSearchParams(location.search).has('subtitle-tracks')
  && new URLSearchParams(location.search).get('subtitle-layers') !== '0'
  && new URLSearchParams(location.search).get('flat-production') !== '0';
function productionFlatMode() { return window.MSWProductionProject.isView(DATA); }
const fixedTrackCore = window.MSWSubtitleTracks;
let fixedActiveTrackId = null;
let fixedTrackFilter = new Set();
let fixedDraftOwners = new WeakMap();
let fixedLastContent = null;
let fixedHistoryCheckpoint = null;
let fixedOwnerCache = null;
let fixedCueOwners = new WeakMap();
let fixedLayoutCache = null;
let fixedNumberCache = null;
let fixedLastMessage = '';
let productionSplitTrackId = null;
let productionSelectionOrder = [];
function productionRememberSelection() {
  if(!productionFlatMode())return;
  const ids=[...selectedIdxs].map(i=>DATA.segments[i]?.id).concat([...selectedExtensionIdxs].map(i=>getActiveExtensionTrack()?.segments[i]?.id)).filter(Boolean);
  productionSelectionOrder=productionSelectionOrder.filter(id=>ids.includes(id));
  for(const id of ids)if(!productionSelectionOrder.includes(id))productionSelectionOrder.push(id);
}
function productionSplitMode(segment,role='main',storage=null) {
  const owner=segment?.id?fixedTrack(segment,role,storage):fixedActiveTrack();
  if(['word','continuous'].includes(owner?.split_mode))return owner.split_mode;
  const text=segment?.text??layerCore.tracks(DATA).flatMap(s=>s.segments.filter(c=>fixedOwner(c,s.role,s.track_id)===owner?.id).map(c=>c.text)).join('\n');
  return MULTI_SUBTITLE_UTILS.detectSubtitleSplitMode(text);
}
function productionSyncSettings() {
  const active=productionFlatMode();
  document.querySelectorAll('[data-flat-settings]').forEach(node=>{node.hidden=!active;});
  document.getElementById('multi-subtitle-settings-dropdown').hidden=active;
  document.getElementById('overlay-track-controls').hidden=active;
  if(!active)return;
  const tracks=DATA.subtitle_tracks.tracks,select=document.getElementById('track-split-track'),mode=document.getElementById('track-split-mode');
  if(!tracks.some(t=>t.id===productionSplitTrackId))productionSplitTrackId=fixedActiveTrack()?.id||tracks[0]?.id;
  if(JSON.stringify([...select.options].map(o=>[o.value,o.textContent]))!==JSON.stringify(tracks.map(t=>[t.id,t.name])))select.replaceChildren(...tracks.map(t=>new Option(t.name,t.id)));
  select.value=productionSplitTrackId||'';
  const track=tracks.find(t=>t.id===productionSplitTrackId);mode.value=track?.split_mode||'auto';mode.disabled=!track||track.locked;
  for(const [id,key] of [['track-select-bound','selectBoundSubtitlePair'],['track-bind-sync','multiSubtitleAutoSyncDuration'],['wave-cross-track-snap','crossTrackSnap']])document.getElementById(id).checked=Boolean(EDITOR_SETTINGS[key]);
  document.getElementById('cue-list-swap-sides').disabled=!DATA.segments.length&&!getActiveExtensionTrack()?.segments.length;
}
document.getElementById('track-split-track')?.addEventListener('change',event=>{productionSplitTrackId=event.target.value;productionSyncSettings();});
document.getElementById('track-split-mode')?.addEventListener('change',event=>{
  if(['auto','word','continuous'].includes(event.target.value))fixedUpdateTrack(productionSplitTrackId,{split_mode:event.target.value});
  productionSyncSettings();
});
for(const [id,key] of [['track-select-bound','selectBoundSubtitlePair'],['track-bind-sync','multiSubtitleAutoSyncDuration'],['wave-cross-track-snap','crossTrackSnap']])document.getElementById(id)?.addEventListener('change',event=>updateEditorSettings({[key]:event.target.checked}));
document.getElementById('cue-list-swap-sides')?.addEventListener('click',()=>{
  try {commitProcessingEdits();productionRememberSelection();productionCommitProject(MSWProductionProject.swapColumns(DATA),'交换列表两侧位置',productionSelectionOrder,{displayOnly:true});}
  catch(error){fixedStatus(error.message);}
});
function fixedTrackMode() { return DATA.schema === fixedTrackCore.SCHEMA; }
function fixedInvalidate() { fixedOwnerCache = null; fixedLayoutCache = null; fixedNumberCache=null; fixedCueOwners = new WeakMap(); fixedPreviewInvalidate(); }
function fixedCueLabel(cue,role='main',trackId=null,editor=false) {
  const track=fixedTrack(cue,role,trackId);if(!track)return '';
  if(!fixedNumberCache) {
    fixedNumberCache=new Map();const lanes=new Map();
    for(const s of layerCore.tracks(DATA))for(const c of s.segments){const id=fixedOwner(c,s.role,s.track_id);if(!lanes.has(id))lanes.set(id,[]);lanes.get(id).push(c);}
    for(const rows of lanes.values())rows.sort((a,b)=>a.start-b.start||a.end-b.end||a.id.localeCompare(b.id)).forEach((c,i)=>fixedNumberCache.set(c.id,i+1));
  }
  return track.name+(editor&&/[主副]$/.test(track.name)?'字幕':'')+'_'+fixedNumberCache.get(cue.id);
}
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
// Capture the physical destination once: main/extension is only its storage row.
function fixedCueCreationContext(role = 'main') {
  if (!fixedTrackMode()) return null;
  const track = fixedActiveTrack();
  const source = role === 'extension' ? getActiveExtensionTrack()?.segments || [] : DATA.segments;
  return { id: track?.id, locked: !track || track.locked,
    lane: fixedLayout().positions.get(JSON.stringify([track?.id, role])),
    segments: productionFlatMode()?layerCore.tracks(DATA).flatMap(s=>s.segments.filter(c=>fixedOwner(c,s.role,s.track_id)===track?.id)):source.filter(cue => fixedOwner(cue, role) === track?.id) };
}
function fixedStatus(message = '', {silent = false} = {}) {
  if (message.includes('同轨同角色字幕重叠')) message = '目标轨道此处已有字幕，请调整位置';
  fixedLastMessage = message;
  if (message && !silent) flashHint(window.MSWE_I18N?.translateText?.(message) || message, 'invalid');
}
function fixedCanEdit(cues, role = 'main', trackId = null, linked = true, {silent = false} = {}) {
  if (!fixedTrackMode()) return true;
  try { fixedTrackCore.assertEditable(DATA, cues.filter(Boolean).map(c => fixedRef(c, role, trackId)), linked); return true; }
  catch (error) { fixedStatus(error.message, {silent}); return false; }
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
  fixedLastContent = null; fixedHistoryCheckpoint = null; fixedDraftOwners = new WeakMap(); fixedLastMessage = ''; fixedInvalidate();
}
function fixedBeginEdit() {
  if(fixedPositionEditing)fixedStopPositioning(false);
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
  for (const cue of children) {
    fixedDraftOwners.set(cue, { owner, legacy });
    const roles=DATA.subtitle_tracks.flat_context?.bindingSources;
    if(roles&&Object.hasOwn(roles,source.id))roles[cue.id]=roles[source.id];
  }
}
function fixedMergePlan(plan) {
  if (!fixedTrackMode()) return;
  if (productionFlatMode()) {
    const trial=fixedContent(),ownerById=new Map();
    for(const change of plan.changes) {
      const refs=[...change.ids].map(cue_id=>({role:change.role,track_id:change.track_id,cue_id}));
      fixedTrackCore.assertEditable(DATA,refs);
      const owners=new Set(refs.map(r=>fixedOwners().get(fixedTrackCore.key(r))));
      if(owners.size!==1)throw Error('跨轨字幕不能直接合并，请先移到同一轨道');
      const roles=DATA.subtitle_tracks.flat_context.bindingSources||{};
      const directions=new Set([...change.ids].filter(id=>Object.hasOwn(roles,id)).map(id=>roles[id]));
      if(directions.size>1)throw Error('所选字幕的绑定参考方向不一致，请先统一方向');
      if(directions.size)roles[change.merged.id]=[...directions][0];
      const owner=[...owners][0];fixedDraftOwners.set(change.merged,{owner});ownerById.set(change.merged.id,owner);
      (change.role==='main'?trial:trial.multi_subtitle.tracks.find(t=>t.id===change.track_id)).segments=structuredClone(change.segments);
    }
    trial.multi_subtitle.bindings=structuredClone(plan.bindings);
    fixedTrackCore.reconcile(trial,row=>ownerById.get(row.cue_id));return;
  }
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
function fixedWaveGeometry() {
  const compact = productionFlatMode() && fixedLayout().bands.length >= 3;
  return compact ? {height:20, pitch:24} : {height:32, pitch:38};
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
  const lane = Math.floor(Math.max(0, fromBottom) / fixedWaveGeometry().pitch), view = fixedLayout();
  const band = view.bands.find(b => lane >= b.bottom && lane < b.bottom + b.size);
  if (!band) return null;
  fixedActiveTrackId = band.track.id;
  if(productionFlatMode())return band.track.flat_style_slot==='secondary'?'extension':'main';
  return band.roles.find(role => view.positions.get(JSON.stringify([band.track.id, role])) === lane) || 'main';
}
function fixedCommitProject(next, label) {
  if (pendingLinkedSplit) { fixedStatus('请先确认或取消当前切分'); return false; }
  try { window.MSWProductionProject.normalizeView(next);fixedTrackCore.validate(next); fixedTrackCore.assertLocks(DATA, next); }
  catch (error) { fixedStatus(error.message); return false; }
  commitProcessingEdits(); pushUndo(label, { captureView: true });
  DATA.subtitle_tracks = next.subtitle_tracks;
  DATA.subtitle_layers = next.subtitle_layers;
  fixedInvalidate(); projectImportDirty = true; fixedStatus();
  renderAll({ waveform: 'full' }); scheduleAutoSaveFlush();
  return true;
}
function productionCommitProject(project,label,ids=[],{displayOnly=false}={}) {
  if(pendingLinkedSplit)throw Error('请先确认或取消当前切分');
  const next=window.MSWProductionProject.fromProject(project);
  if(displayOnly) {
    const ordered=p=>({...p.subtitles,cues:[...p.subtitles.cues].sort((a,b)=>a.id.localeCompare(b.id))});
    if(JSON.stringify(ordered(MSWProductionProject.toProject(DATA)))!==JSON.stringify(ordered(MSWProductionProject.toProject(next))))throw Error('显示操作不能修改字幕内容');
  } else fixedTrackCore.assertLocks(DATA,next);
  commitProcessingEdits();pushUndo(label,{captureView:true});
  for(const field of ['segments','multi_subtitle','subtitle_layers','subtitle_tracks','msw'])if(next[field])DATA[field]=next[field];
  // This transaction has already checked the canonical content/locks. Reset
  // the legacy operation checkpoint so a display-side change on locked tracks
  // is not mistaken for a later edit to their contents.
  fixedLastContent=fixedContent();fixedHistoryCheckpoint=editorHistory.checkpoint();
  fixedInvalidate();normalizeMultiSubtitleState();clearSelection({silent:true});
  DATA.segments.forEach((c,i)=>{if(ids.includes(c.id))selectedIdxs.add(i);});getActiveExtensionTrack()?.segments.forEach((c,i)=>{if(ids.includes(c.id))selectedExtensionIdxs.add(i);});
  projectImportDirty=true;cueListPlaybackKey=null;renderAll({waveform:'full'});scheduleAutoSaveFlush();
}
function productionBindSelected() {
  try {
    commitProcessingEdits();productionRememberSelection();const ids=[...productionSelectionOrder];
    if(ids.length!==2)throw Error('请选择不同轨道的两条字幕进行绑定');
    let p=window.MSWProductionProject.toProject(DATA);
    for(const b of p.subtitles.bindings.filter(b=>ids.includes(b.source_id)||ids.includes(b.target_id)))p=window.MSWFlatSubtitles.unbind(p,b.id);
    let next=window.MSWFlatSubtitles.bind(p,ids[0],ids[1],window.MSWProject.id('binding'));
    if(EDITOR_SETTINGS.multiSubtitleAutoSyncDuration) {
      const a=next.subtitles.cues.find(c=>c.id===ids[0]).content;
      next=MSWFlatEditing.updateRanges(next,[{id:ids[1],start:a.start,end:a.end}],{linked:false});
    }
    productionCommitProject(next,'绑定字幕',ids);
  } catch(error){fixedStatus(error.message);}
}
function productionBindingAction(action) {
  if(pendingLinkedSplit){fixedStatus('请先确认或取消当前切分');return false;}
  try {
    commitProcessingEdits();productionRememberSelection();const ids=[...productionSelectionOrder],p=MSWProductionProject.toProject(DATA);
    if(!p.subtitles.bindings.some(b=>ids.includes(b.source_id)||ids.includes(b.target_id))){fixedStatus('所选字幕没有绑定关系');return false;}
    const next=action==='reverse'?MSWProductionProject.reverseBindings(DATA,ids):MSWProductionProject.alignBindings(DATA,ids);
    if(JSON.stringify(p.subtitles)===JSON.stringify(next.subtitles))return false;
    productionCommitProject(next,action==='reverse'?'反转绑定方向':'按参考字幕对齐',ids);return true;
  }catch(error){fixedStatus(error.message);return false;}
}
function productionAppendBindingMenu() {
  productionRememberSelection();const ids=productionSelectionOrder,p=MSWProductionProject.toProject(DATA),E=MSWFlatEditing;
  const bound=p.subtitles.bindings.filter(b=>ids.includes(b.source_id)||ids.includes(b.target_id));
  const node=(label,key,action,disabled)=>{
    const item=ctxAppendItem(label,action,{disabled});
    if(key){const kbd=document.createElement('kbd');kbd.textContent=key;item.append(kbd);}
    return {node:item};
  };
  const children=[node('绑定所选字幕','G',productionBindSelected,ids.length!==2||E.cue(p,ids[0])?.track_id===E.cue(p,ids[1])?.track_id)];
  if(bound.length) {
    children.push(node('解绑所选字幕','Shift+G',unbindSelectedSubtitlePair,false),
      node('按参考字幕对齐','H',()=>productionBindingAction('align'),false),
      node('反转绑定方向','',()=>productionBindingAction('reverse'),false));
    const references=[...new Set(bound.map(b=>E.track(p,E.cue(p,b.source_id).track_id).name))];
    for(const child of children.slice(2))child.node.title=`当前参考轨道：${references.join('、')}。对齐会调整另一侧；反转只改变参考方向，不交换位置。`;
  }
  ctxAppendExpandableSettings('绑定操作',children);
}
let productionClipboard=null;
function productionCaptureClipboard() {
  if(!productionFlatMode()){productionClipboard=null;return;}
  const p=window.MSWProductionProject.toProject(DATA),ids=new Set([...processingSelection().mainIds,...processingSelection().extensionIds]);
  const rows=structuredClone(p.subtitles.cues.filter(c=>ids.has(c.id)));
  for(const c of rows)for(const f of ['color','sticker'])if(c.content[f+'_ref']) {
    c.content[f]=structuredClone(p.subtitles.cues.find(r=>r.id===c.content[f+'_ref'].cue_id).content[f]);delete c.content[f+'_ref'];
  }
  productionClipboard={rows,bindings:p.subtitles.bindings.filter(b=>ids.has(b.source_id)&&ids.has(b.target_id))};
}
function productionPasteClipboard() {
  try {
    const at=Math.round(window.MSWE?.resolve('audio-timeline')?.currentTimeMs()??player.currentTime*1000)||0;
    const result=window.MSWProductionProject.place(DATA,productionClipboard.rows,productionClipboard.bindings,at,fixedActiveTrack().id);
    productionCommitProject(window.MSWProductionProject.toProject(result.project),'粘贴字幕',result.ids);
  }catch(error){flashHint(error.message,'warning');}
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

// Pointer moves change time and physical ownership in one validated transaction.
// Display columns remain an adapter detail; crossing them never unbinds cues.
function fixedMoveDrag(drag, rawDelta, fromBottom, disableSnap) {
  if(!productionFlatMode()||drag.kind!=='move')return null;
  const source=drag.track==='extension'?getActiveExtensionTrack().segments:DATA.segments;
  if(!fixedCanEdit(drag.indices.map(i=>source[i]),drag.track,null,true,{silent:true})) {
    drag.destinationPreview={...drag.destinationPreview,blocked:true,reason:fixedLastMessage};return false;
  }
  if(!drag.fixedMove) {
    ensureBoundDragTimelineOriginals(drag);
    const entries=drag.indices.map(index=>({cue:source[index],original:structuredClone(source[index]),index}));
    const followers=waveformEditor.options.getSubtitleDragFollowers(drag).map(f=>({cue:f.segment,original:structuredClone(f.segment),index:f.index}));
    for(const follower of followers)ensureBoundDragOriginal(drag,follower.index,follower.cue);
    drag.fixedMove={assignments:structuredClone(DATA.subtitle_tracks.assignments),entries,followers,
      active:fixedActiveTrackId,owners:new Map(entries.map(e=>[e.cue.id,fixedOwner(e.cue,drag.track)]))};
  }
  const state=drag.fixedMove,tracks=fixedLayout().bands.map(b=>b.track),bands=fixedLayout().bands;
  const lane=Math.floor(fromBottom/fixedWaveGeometry().pitch),band=Number.isFinite(lane)&&bands.find(b=>lane>=b.bottom&&lane<b.bottom+b.size);
  const originalOwner=state.owners.get(source[drag.index].id);
  const destination=band?.track.id||state.target||originalOwner;
  const original=drag.originals.get(drag.index),clock=drag.timing;
  drag.destinationPreview={name:tracks.find(t=>t.id===destination)?.name||'',
    start:clock.toMs(original.start+rawDelta),end:clock.toMs(original.end+rawDelta),blocked:true,reason:'目标轨道此处已有字幕，请调整位置'};
  const shift=tracks.findIndex(t=>t.id===destination)-tracks.findIndex(t=>t.id===originalOwner);
  const moving=new Map();
  for(const entry of state.entries) {
    const target=tracks[tracks.findIndex(t=>t.id===state.owners.get(entry.cue.id))+shift];
    if(!target||target.locked){drag.destinationPreview.reason=target?'目标轨道已锁定，请先解锁':'没有足够的轨道容纳所选字幕';return false;}
    moving.set(entry.cue.id,target.id);
  }
  const previous=DATA.subtitle_tracks.assignments;
  const proposed=previous.map(a=>moving.has(a.cue_id)?{...a,subtitle_track_id:moving.get(a.cue_id)}:a);
  // The existing snap solver reads physical owners. Expose only for this
  // synchronous calculation; invalid candidates never reach rendering/save.
  DATA.subtitle_tracks.assignments=proposed;fixedInvalidate();
  drag.relocating=shift!==0||drag.pointerGeometry?.startMs!==undefined&&drag.pointerGeometry.startMs!==drag.geometry.startMs;
  let changes,bindings;
  try {
    const delta=waveformEditor.resolveLayerPointerDelta(drag,rawDelta,disableSnap);
    if(delta===null)return false;
    const clock=drag.timing;
    changes=new Map(state.entries.map(e=>{
      const original=drag.originals.get(e.index),next={...e.original};
      clock.setStart(next,original.start+delta);clock.setEnd(next,original.end+delta);
      next.items=remapPanelItems(e.original.items,e.original.start,e.original.end,next.start,next.end);
      return [e.cue.id,next];
    }));
    for(const follower of state.followers) {
      const entry=state.entries.find(e=>e.index===follower.index),lead=changes.get(entry.cue.id),original=follower.original;
      const next={...original,start:original.start+lead.start-entry.original.start,end:original.end+lead.end-entry.original.end};
      if(clock.unit==='frames'){clock.setStart(next,clock.fromMs(next.start));clock.setEnd(next,clock.fromMs(next.end));}
      next.items=remapPanelItems(original.items,original.start,original.end,next.start,next.end);changes.set(follower.cue.id,next);
    }
    const segments=DATA.segments.map(c=>changes.get(c.id)||c);
    const multi={...DATA.multi_subtitle,tracks:DATA.multi_subtitle.tracks.map(t=>({...t,segments:t.segments.map(c=>changes.get(c.id)||c)}))};
    const byId=new Map([...segments,...multi.tracks.flatMap(t=>t.segments)].map(c=>[c.id,c]));
    bindings=multi.bindings.map(b=>({...b,start_offset_ms:byId.get(b.extension_segment_ids[0]).start-byId.get(b.main_segment_ids[0]).start,
      end_offset_ms:byId.get(b.extension_segment_ids[0]).end-byId.get(b.main_segment_ids[0]).end}));
    multi.bindings=bindings;
    fixedTrackCore.validate({...DATA,segments,multi_subtitle:multi});
  } catch(error) {drag.destinationPreview.reason=error.message;return false;}
  finally { DATA.subtitle_tracks.assignments=previous;fixedInvalidate(); }
  const ownerChanged=previous.some((a,i)=>a.subtitle_track_id!==proposed[i].subtitle_track_id);
  const changed=ownerChanged||[...state.entries,...state.followers].some(e=>e.cue.start!==changes.get(e.cue.id).start||e.cue.end!==changes.get(e.cue.id).end);
  fixedStatus();state.target=destination;
  Object.assign(drag.destinationPreview,{start:changes.get(source[drag.index].id).start,
    end:changes.get(source[drag.index].id).end,blocked:false});
  if(!changed)return false;
  DATA.subtitle_tracks.assignments=proposed;
  for(const entry of [...state.entries,...state.followers])Object.assign(entry.cue,changes.get(entry.cue.id));
  DATA.multi_subtitle.bindings=bindings;fixedActiveTrackId=destination;
  // Physical ownership changes lane positions, not just the time-range index.
  if(ownerChanged)waveformEditor.subtitleLayouts=null;
  layerInvalidate();return true;
}
function fixedCancelMoveDrag(drag) {
  if(!drag.fixedMove)return;
  const state=drag.fixedMove;DATA.subtitle_tracks.assignments=state.assignments;fixedActiveTrackId=state.active;
  for(const entry of [...state.entries,...state.followers]){
    for(const field of Object.keys(entry.cue))if(!(field in entry.original))delete entry.cue[field];
    Object.assign(entry.cue,entry.original);
  }
  syncBindingOffsets();fixedStatus();layerInvalidate();
}
function fixedMenuItem(label, action, disabled = false) {
  if(productionFlatMode())return ctxAppendItem(label,action,{disabled});
  const item = document.createElement('button'); item.type = 'button'; item.className = 'item';
  item.textContent = label; item.disabled = disabled;
  item.onclick = () => { ctxmenu.classList.remove('show'); action(); };
  ctxmenu.append(item); return item;
}
function fixedAppendMoveMenu(cues, role = 'main', trackId = null) {
  if (!fixedTrackMode() || productionFlatMode()) return;
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
function fixedSelectTrackContent(track) {
  clearSelection({silent:true});
  fixedActiveTrackId = track.id;
  const extension = getActiveExtensionTrack();
  DATA.segments.forEach((cue, i) => { if (fixedOwner(cue) === track.id) selectedIdxs.add(i); });
  extension?.segments.forEach((cue, i) => { if (fixedOwner(cue, 'extension', extension.id) === track.id) selectedExtensionIdxs.add(i); });
  // Select the physical track, regardless of paired-selection preferences.
  // Linked cues on other tracks remain unselected.
  if (selectedIdxs.size) setCuePanelTarget('main', [...selectedIdxs][0]);
  else if (selectedExtensionIdxs.size) setCuePanelTarget('extension', [...selectedExtensionIdxs][0], extension.id);
  updateMultiSelectionClasses(); updateSelectionCountText(); waveformEditor?.updateSelection();
}
function fixedTrackMenu(track, x, y) {
  fixedStatus();
  ctxmenu.replaceChildren();
  fixedMenuItem('全选轨道内容', () => fixedSelectTrackContent(track),
    !DATA.subtitle_tracks.assignments.some(a => a.subtitle_track_id === track.id));
  ctxAppendSeparator();
  if(productionFlatMode()) {
    const tracks=DATA.subtitle_tracks.tracks;
    const apply=main=>{try{const p=window.MSWProductionProject.toProject(DATA);productionCommitProject(window.MSWFlatSubtitles.setTrackGroup(p,track.id,main),'调整主副轨道分组');}catch(e){fixedStatus(e.message);}};
    if(track.secondary_for||tracks.some(t=>t.secondary_for===track.id))fixedMenuItem('解除主副分组',()=>apply(null),track.locked);
    if(!tracks.some(t=>t.secondary_for===track.id)) {
      const choices=tracks.filter(t=>t.id!==track.id&&!t.secondary_for&&!tracks.some(s=>s.secondary_for===t.id&&s.id!==track.id))
        .map(main=>({label:'S'+main.display_number,action:()=>apply(main.id),disabled:track.locked||main.locked||track.secondary_for===main.id,selected:track.secondary_for===main.id}));
      ctxAppendExpandableSettings('设为副轨道',choices.length?choices:[{label:'没有可用的主轨道',action:()=>{},disabled:true}]);
    }
  } else {
    fixedMenuItem('重命名', () => fixedRenameTrack(track,x,y));
    fixedMenuItem('轨道设置', () => fixedRenameTrack(track,x,y,true));
  }
  if(!productionFlatMode())fixedMenuItem('字幕样式与画面位置', () => window.MSWSubtitleStyle?.editTrack(track.id));
  fixedMenuItem(track.collapsed ? '展开轨道' : '折叠轨道', () => fixedUpdateTrack(track.id, { collapsed: !track.collapsed }));
  fixedMenuItem(track.enabled ? '禁用轨道' : '启用轨道', () => fixedUpdateTrack(track.id, { enabled: !track.enabled }));
  fixedMenuItem(track.locked ? '解锁轨道' : '锁定轨道', () => fixedUpdateTrack(track.id, { locked: !track.locked }));
  if(!productionFlatMode())fixedMenuItem(track.show_secondary ? '按内容显示副字幕行' : '始终显示副字幕行', () => fixedUpdateTrack(track.id, { show_secondary: !track.show_secondary }));
  if(!productionFlatMode())fixedMenuItem('新增字幕轨道', () => fixedAddTrack('subtitle'));
  for (const [delta, label] of productionFlatMode()?[]:[[-1, '上移轨道'], [1, '下移轨道']]) {
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
function fixedAudioTrackMenu(id, x, y) {
  const audio = window.MSWE?.resolve('audio-timeline');
  const track = DATA.msw?.audio_tracks?.find(track => track.id === id);
  if (!audio || !track) return;
  ctxmenu.replaceChildren();
  fixedMenuItem('全选轨道内容', () => audio.selectTrackClips(id), !DATA.msw.audio_clips?.some(clip => clip.track_id === id));
  ctxAppendSeparator();
  fixedMenuItem(track.muted ? '启用轨道' : '禁用轨道', () => audio.toggleAudioTrackMuted(id));
  fixedMenuItem(track.collapsed ? '展开轨道' : '折叠轨道', () => audio.setTrackCollapsed(id, !track.collapsed));
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
    const geometry = fixedWaveGeometry();
    node.classList.toggle('compact-track', geometry.height === 20);
    node.style.bottom = `${7 + audioSpace + band.bottom * geometry.pitch}px`;
    node.style.height = `${band.size * geometry.pitch - (geometry.pitch - geometry.height)}px`;
    if(track.collapsed||!productionFlatMode()&&band.roles.includes('extension')) {
      const collapse = document.createElement('button'); collapse.type = 'button'; collapse.className='fixed-track-collapse';collapse.textContent = track.collapsed ? '›' : '⌄';
      collapse.title = track.collapsed ? '展开轨道' : '折叠轨道'; collapse.setAttribute('aria-label', collapse.title);
      collapse.onclick = () => fixedUpdateTrack(track.id, { collapsed: !track.collapsed });node.append(collapse);
    }
    const name = document.createElement('button');name.type='button';name.className='fixed-track-toggle';name.textContent=track.name;
    name.setAttribute('aria-label',track.name);name.setAttribute('aria-pressed',String(track.enabled));
    name.title = `${track.name}${track.locked ? ' · 已锁定' : ''}\n点击${track.enabled?'禁用':'启用'}本轨道${productionFlatMode()?'':'（含主副字幕）'}，右键管理`;
    name.onclick=()=>{const current=DATA.subtitle_tracks.tracks.find(t=>t.id===track.id);if(current)fixedUpdateTrack(current.id,{enabled:!current.enabled});};
    name.onkeydown=event=>{if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();const rect=name.getBoundingClientRect();fixedTrackMenu(track,rect.right,rect.bottom);}};
    node.append(name);
    if(track.locked){const lock=document.createElement('span');lock.className='fixed-track-lock';lock.setAttribute('aria-label','已锁定');lock.innerHTML='<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1"/><path d="M5 7V5a3 3 0 0 1 6 0v2"/></svg>';node.append(lock);}
    if (!productionFlatMode()&&band.roles.includes('extension')) { const roles = document.createElement('span'); roles.className = 'fixed-track-roles'; roles.textContent = '副字幕'; node.append(roles); }
    for (const type of ['pointerdown', 'pointerup', 'click', 'dblclick', 'contextmenu']) node.addEventListener(type, event => { event.stopPropagation(); if (type === 'contextmenu') { event.preventDefault(); fixedTrackMenu(track, event.clientX, event.clientY); } });
    group.append(node);
  }
  return true;
}
function fixedSyncTrackSettings() {
  const group=document.getElementById('subtitle-track-settings-dropdown');
  if(!group)return;
  group.hidden=!fixedTrackMode();if(group.hidden)return;
  const tracks=DATA.subtitle_tracks.tracks;
  for(const [id,field,inverse,caption] of [
    ['subtitle-track-visibility-menu','collapsed',true,'展开'],
    ['subtitle-track-enabled-menu','enabled',false,'启用'],
  ]) {
    const menu=document.getElementById(id);if(!menu)continue;
    const rows=new Map([...menu.children].map(row=>[row.dataset.trackId,row]));
    for(const [key,row] of rows)if(!tracks.some(t=>t.id===key))row.remove();
    tracks.forEach((track,index)=>{
      let row=rows.get(track.id);
      if(!row) {
        row=document.createElement('label');row.className='dropdown-item recent-project-setting';row.dataset.trackId=track.id;
        row.tabIndex=0;row.setAttribute('role','menuitemcheckbox');
        const check=document.createElement('input');check.type='checkbox';check.tabIndex=-1;
        const name=document.createElement('span');row.append(check,name);
        check.onchange=()=>{fixedUpdateTrack(track.id,{[field]:inverse?!check.checked:check.checked});fixedSyncTrackSettings();};
      }
      const check=row.querySelector('input'),name=row.querySelector('span');
      check.checked=inverse?!track[field]:track[field]!==false;
      check.setAttribute('aria-label',`${window.MSWE_I18N?.translateText?.(caption)||caption} ${track.name}`);
      row.setAttribute('aria-checked',String(check.checked));name.textContent=track.name;
      // Keep existing focused controls in place while a checkbox triggers renderAll.
      if(menu.children[index]!==row)menu.insertBefore(row,menu.children[index]||null);
    });
  }
}
function fixedSyncUI() {
  document.documentElement.classList.toggle('msw-fixed-tracks', fixedTrackMode());
  document.documentElement.classList.toggle('msw-numbered-tracks',productionFlatMode());
  fixedSyncTrackSettings();
  if (!fixedTrackMode()) return;
  if (!fixedActiveTrackId || !DATA.subtitle_tracks.tracks.some(t => t.id === fixedActiveTrackId)) fixedActiveTrackId = DATA.subtitle_tracks.tracks[0].id;
  const toolbar = document.getElementById('cues-module');
  let select = document.getElementById('fixed-track-filter');
  if(productionFlatMode()){select?.closest('label')?.remove();select=null;}
  if (!select && toolbar && !productionFlatMode()) {
    const label = document.createElement('label'); label.className = 'fixed-track-filter'; label.textContent = '轨道 ';
    select = document.createElement('select'); select.id = 'fixed-track-filter'; select.setAttribute('aria-label', '字幕轨道范围');
    select.onchange = () => { fixedTrackFilter = new Set(select.value?[select.value]:[]); applySearch(searchEl.value); };
    label.append(select); toolbar.querySelector('.module-tab-strip')?.after(label);
  }
  fixedTrackFilter=new Set([...fixedTrackFilter].filter(id=>DATA.subtitle_tracks.tracks.some(t=>t.id===id)));
  if (select) {
    select.replaceChildren(new Option('全部轨道', ''), ...DATA.subtitle_tracks.tracks.map(t => new Option(t.name, t.id)));
    select.value = fixedTrackFilter.size===1?[...fixedTrackFilter][0]:'';
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
    const other=productionFlatMode()&&main&&ext?fixedTrack(ext,'extension'):null;
    node.dataset.subtitleTrackIds=JSON.stringify([...new Set([track.id,other?.id].filter(Boolean))]);
    if(productionFlatMode())badge?.remove();
    else {if(!badge){badge=document.createElement('span');badge.className='fixed-track-badge';node.prepend(badge);}badge.textContent=track.name+(track.locked?' · 已锁定':'');}
  });
}

function fixedAppendListFilter() {
  if(!productionFlatMode())return;
  ctxAppendExpandableSettings('轨道', [{label:'全部轨道',selected:()=>!fixedTrackFilter.size,
    action:()=>{fixedTrackFilter.clear();applySearch(searchEl.value);}},...DATA.subtitle_tracks.tracks.map(track=>({
    label:track.name,checked:()=>fixedTrackFilter.has(track.id),
    toggle:()=>{if(fixedTrackFilter.has(track.id))fixedTrackFilter.delete(track.id);else fixedTrackFilter.add(track.id);applySearch(searchEl.value);}
  }))]);
}
function fixedListTrackAllows(cue,role='main',trackId=null) {
  return !!cue&&(!fixedTrackMode()||!fixedTrackFilter.size||fixedTrackFilter.has(fixedOwner(cue,role,trackId)));
}
document.addEventListener('contextmenu',event=>{
  if(!fixedTrackMode()||!event.target.closest('.waveform-track-heads-column')||event.target.closest('.fixed-track-head, .a-track'))return;
  event.preventDefault();event.stopImmediatePropagation();ctxmenu.replaceChildren();
  fixedMenuItem('新增字幕轨道',()=>fixedAddTrack('subtitle'));
  if(productionFlatMode()) {
    const choices=DATA.subtitle_tracks.tracks.filter(t=>t.collapsed).map(t=>({label:t.name,action:()=>fixedUpdateTrack(t.id,{collapsed:false})}));
    (DATA.msw?.audio_tracks || []).forEach((track,index) => {
      if(track.collapsed)choices.push({label:`A${index+1}`,action:()=>window.MSWE?.resolve('audio-timeline')?.setTrackCollapsed(track.id,false)});
    });
    ctxAppendExpandableSettings('展开轨道',choices.length?choices:[{label:'没有折叠的轨道',action:()=>{},disabled:true}]);
    ctxAppendSettingsEntry('字幕样式与画面位置',()=>window.MSWSubtitleStyle?.editTrack(fixedActiveTrack()?.id));
  }
  ctxShowAt(event.clientX,event.clientY);
},true);
function fixedPanelUI(target) {
  if (!fixedTrackMode()) return;
  const track = target ? fixedTrack(target.segment, target.kind, target.trackId) : null;
  if(productionFlatMode()) {
    document.getElementById('fixed-cue-owner')?.remove();
    if(track){fixedActiveTrackId=track.id;cuePanelTarget.textContent=fixedCueLabel(target.segment,target.kind,target.trackId,true);}
    if(track?.locked)for(const node of [cuePanelText,cuePanelStart,cuePanelDuration,cuePanelAddSticker,cuePanelSplit])if(node)node.disabled=true;
    return;
  }
  let label = document.getElementById('fixed-cue-owner');
  if (!label) { label = document.createElement('span'); label.id = 'fixed-cue-owner'; document.querySelector('#current-cue-panel .module-tab-strip')?.after(label); }
  label.textContent = track ? `${track.name}${productionFlatMode()?'':' · '+(target.kind === 'extension' ? '副字幕' : '主字幕')}${track.locked ? ' · 已锁定' : ''}` : '';
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
    const end=Math.max(1,...(project.subtitles?.cues||[]).map(c=>c.content.end),...(project.segments||[]).map(c=>c.end),...(project.multi_subtitle?.tracks||[]).flatMap(t=>t.segments.map(c=>c.end)));
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
  document.getElementById('subtitle-track-add')?.addEventListener('click',()=>fixedAddTrack('subtitle'));
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
