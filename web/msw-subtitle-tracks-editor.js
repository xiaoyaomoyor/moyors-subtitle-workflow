// Opt-in fixed-track editing. Output/processing stay gated until stages 4–5.
const fixedTracksRequested = new URLSearchParams(location.search).get('subtitle-tracks') === '1';
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
  fixedCommitProject(next, '调整字幕轨道');
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
  for (const [kind, label] of [['dialogue', '新建对白轨道'], ['annotation', '新建画面文字轨道']]) section.append(fixedMenuItem(label, () => fixedAddTrack(kind, refs)));
}
function fixedTrackMenu(track, x, y) {
  ctxmenu.replaceChildren();
  fixedMenuItem('字幕样式与画面位置', () => window.MSWSubtitleStyle?.editTrack(track.id));
  fixedMenuItem(track.collapsed ? '展开轨道' : '折叠轨道', () => fixedUpdateTrack(track.id, { collapsed: !track.collapsed }));
  fixedMenuItem(track.enabled ? '禁用轨道' : '启用轨道', () => fixedUpdateTrack(track.id, { enabled: !track.enabled }));
  fixedMenuItem(track.locked ? '解锁轨道' : '锁定轨道', () => fixedUpdateTrack(track.id, { locked: !track.locked }));
  fixedMenuItem(track.show_secondary ? '按内容显示副字幕行' : '始终显示副字幕行', () => fixedUpdateTrack(track.id, { show_secondary: !track.show_secondary }));
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
    const collapse = document.createElement('button'); collapse.type = 'button'; collapse.textContent = track.collapsed ? '›' : '⌄';
    collapse.title = track.collapsed ? '展开轨道' : '折叠轨道'; collapse.setAttribute('aria-label', collapse.title);
    collapse.onclick = () => fixedUpdateTrack(track.id, { collapsed: !track.collapsed });
    const name = document.createElement('input'); name.value = track.name; name.setAttribute('aria-label', '轨道名称'); name.maxLength = 160;
    name.title = `${track.name} · 主字幕${track.locked ? ' · 已锁定' : ''}${track.enabled ? '' : ' · 已禁用'}`;
    name.onfocus = () => { fixedActiveTrackId = track.id; };
    name.onchange = () => fixedUpdateTrack(track.id, { name: name.value.trim() });
    name.onkeydown = event => { if (event.key === 'Enter') name.blur(); if (event.key === 'Escape') { name.value = track.name; name.blur(); } event.stopPropagation(); };
    const menu = document.createElement('button'); menu.type = 'button'; menu.textContent = '⋯'; menu.title = '轨道操作'; menu.setAttribute('aria-label', '轨道操作');
    if (track.locked) menu.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1"/><path d="M5 7V5a3 3 0 0 1 6 0v2M8 10v2"/></svg>';
    else if (!track.enabled) menu.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><path d="m4 12 8-8"/></svg>';
    menu.title += track.locked ? ' · 已锁定' : !track.enabled ? ' · 已禁用' : '';
    menu.onclick = event => { const rect = menu.getBoundingClientRect(); fixedTrackMenu(track, rect.right, rect.bottom); };
    node.append(collapse, name, menu);
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
  let bar = document.getElementById('fixed-track-toolbar');
  if (!bar) {
    bar = document.createElement('div'); bar.id = 'fixed-track-toolbar';
    const add = document.createElement('button'); add.textContent = '＋ 轨道'; add.type = 'button';
    add.onclick = () => { ctxmenu.replaceChildren(); fixedMenuItem('添加对白轨道', () => fixedAddTrack('dialogue')); fixedMenuItem('添加画面文字轨道', () => fixedAddTrack('annotation')); const r = add.getBoundingClientRect(); ctxShowAt(r.left, r.bottom); };
    const caption = document.createElement('span'); caption.textContent = '固定轨道 · 编辑预览'; caption.title = '开发入口：支持轨道编辑、画面定位和工程保存；识别、配音及输出尚未启用。';
    const status = document.createElement('span'); status.id = 'fixed-track-status'; status.setAttribute('role', 'status');
    bar.append(add, caption, status); document.querySelector('.waveform-pane .module-tab-strip')?.after(bar);
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
  // These producers/outputs do not yet understand fixed track positioning.
  // The v3 development page also has no server project binding.
  document.addEventListener('click', event => {
    const node = event.target.closest('button, a, [role="menuitem"], .item');
    if (!node || node.closest('#fixed-track-toolbar, .fixed-track-head, .fixed-track-move-menu')) return;
    const id = node.id || '';
    if (/^download-/.test(id) && !['download-json'].includes(id)
      || /^(msw-.*(?:tts|asr|translate|export)|export-video|export-audio|video-export-btn|audio-export-btn|timeline-export-btn|tts-open|subtitle-translate-btn)/.test(id)
      || /^(翻译所选字幕|配音所选字幕)/.test(node.textContent.trim())) {
      event.preventDefault(); event.stopImmediatePropagation(); fixedStatus('固定轨道的识别、配音与导出将在后续阶段接入；现在可保存工程');
    }
  }, true);
});
