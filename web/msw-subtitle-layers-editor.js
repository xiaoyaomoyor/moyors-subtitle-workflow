// A–C development adapter. Production writing/processing is enabled in D–G.
// Keep legacy numeric UI handles at the boundary; identity survives all sorting.
const layerCore = window.MSWSubtitleLayers;
const layerDevelopmentRequested = new URLSearchParams(location.search).get('subtitle-layers') === '1';
let layerIndexes = new WeakMap();
let layerPendingDragHistory = null;
function prepareLayerProject(project) {
  return layerDevelopmentRequested || layerCore.enabled(project) ? layerCore.migrate(project) : project;
}
function layerMode() { return layerCore.enabled(DATA); }
function layerAllowOverlap() { return DATA.subtitle_layers?.allow_overlap !== false; }
function layerInvalidate() { layerIndexes = new WeakMap(); }
function layerIndex(segments) {
  if (!Array.isArray(segments)) return new layerCore.IntervalIndex([]);
  if (!layerIndexes.has(segments)) layerIndexes.set(segments, new layerCore.IntervalIndex(segments,
    cue => segments !== DATA.segments || layerCore.visible(DATA, cue)));
  return layerIndexes.get(segments);
}
function layerActive(segments, time, includeDisabled = false) {
  return layerIndex(segments).at(Number(time), { includeDisabled });
}
function layerPreferredActive(segments, time, includeDisabled = false) {
  const active = layerActive(segments, time, includeDisabled);
  const target = getCurrentCuePanelTarget();
  const own = target && (target.kind === 'main' ? DATA.segments : target.track?.segments);
  return own === segments && active.includes(target.index) ? target.index : active[0] ?? -1;
}
function layerPrepareRender() {
  if (!layerMode()) return;
  const liveIds = new Set(DATA.segments.map(cue => cue.id));
  DATA.subtitle_layers.legacy_overlay.cue_ids = DATA.subtitle_layers.legacy_overlay.cue_ids.filter(id => liveIds.has(id));
  const snapshot = snapshotEditorSelection();
  layerCore.tracks(DATA).forEach(track => layerCore.sortTrack(track.segments));
  const restore = (set, cues, ids) => {
    set.clear(); const wanted = new Set(ids);
    cues.forEach((cue, index) => { if (wanted.has(cue.id)) set.add(index); });
  };
  restore(selectedIdxs, DATA.segments, snapshot.mainIds);
  restore(selectedExtensionIdxs, getActiveExtensionTrack()?.segments || [], snapshot.extensionIds);
  lastClickedIdx = DATA.segments.findIndex(cue => cue.id === snapshot.lastMainId);
  lastClickedExtensionIdx = (getActiveExtensionTrack()?.segments || []).findIndex(cue => cue.id === snapshot.lastExtensionId);
  const panel = snapshot.panelKind === 'extension' ? getExtensionTrack(snapshot.panelTrackId)?.segments : DATA.segments;
  currentCuePanelIdx = panel?.findIndex(cue => cue.id === snapshot.panelId) ?? -1;
  layerInvalidate();
  layerSyncControls();
}
function layerSyncControls() {
  document.documentElement.classList.toggle('msw-layer-development', layerMode());
  document.querySelectorAll('option[value="overlay"]').forEach(option => {
    option.hidden = layerMode();
    if (layerMode() && option.selected) option.parentElement.value = 'main';
  });
  const badge = document.getElementById('subtitle-layer-development');
  if (badge) badge.hidden = !layerMode();
  const control = document.getElementById('subtitle-legacy-visible');
  if (control) {
    control.closest('label').hidden = !layerMode() || !DATA.subtitle_layers.legacy_overlay.cue_ids.length;
    control.checked = DATA.subtitle_layers?.legacy_overlay?.visible === true;
  }
}
function layerBlockProduction(silent = false) {
  if (!layerMode()) return false;
  if (!silent) flashHint('多层字幕为 A–C 开发预览；保存、处理回填与导出将在后续阶段开放。请用工程副本体验。', 'warning');
  return true;
}
function layerRangeAllowed(segments, cue, start, end) {
  return layerAllowOverlap() || !segments.some(other => other !== cue
    && layerCore.intersects({ start, end }, other) && (!cue || !layerCore.intersects(cue, other)));
}
function layerCanApplyRanges(role, ranges, linked = true) {
  if (!layerMode() || layerAllowOverlap()) return true;
  const track = role === 'extension' ? getActiveExtensionTrack() : null;
  const cues = track?.segments || DATA.segments;
  const changes = ranges.map(range => ({ start: Math.round(range.start), end: Math.round(range.end),
    ref: { role, track_id: track?.id || null, cue_id: cues[range.index]?.id } }));
  if (linked && multiSubtitleVisible()) for (const range of ranges) {
    const source = cues[range.index];
    const binding = MULTI_SUBTITLE_UTILS.bindingForSegment(getMultiSubtitleState(), source?.id, role, track?.id);
    if (!source || !binding) continue;
    const followerRole = role === 'main' ? 'extension' : 'main';
    const followerTrack = role === 'main' ? getExtensionTrack(binding.track_id) : null;
    const id = role === 'main' ? binding.extension_segment_ids?.[0] : binding.main_segment_ids?.[0];
    const follower = (followerTrack?.segments || DATA.segments).find(cue => cue.id === id);
    if (follower) changes.push({ ref: { role: followerRole, track_id: followerTrack?.id || null, cue_id: id },
      start: Math.max(0, Math.round(follower.start + range.start - source.start)),
      end: Math.round(follower.end + range.end - source.end) });
  }
  return layerCore.applyRanges(DATA, changes, { dryRun: true }).ok;
}
function layerCreateCue(start, end, role = 'main') {
  const track = role === 'extension' ? getActiveExtensionTrack() : null;
  const cues = role === 'extension' ? track?.segments : DATA.segments;
  if (!cues) return false;
  const lo = Math.min(start, end), hi = Math.max(start, end);
  start = Math.max(0, timelineFrameAlignedMilliseconds(lo));
  end = timelineFrameAlignedMilliseconds(Math.max(start + timelineMinimumDurationMs(), hi));
  if (!Number.isFinite(end) || !layerRangeAllowed(cues, null, start, end)) {
    flashHint('此操作会新增字幕重叠，请先启用“允许字幕重叠”', 'warning'); return false;
  }
  commitProcessingEdits(); pushUndo('创建字幕', { captureView: true });
  const cue = { id: window.MSWProject.id('cue'), start, end, text: '', items: [], _dirty: true };
  cues.push(cue);
  clearSelection({ silent: true, commitCuePanel: false });
  (role === 'extension' ? selectedExtensionIdxs : selectedIdxs).add(cues.length - 1);
  projectImportDirty = true; renderAll();
  const index = cues.indexOf(cue);
  if (track) setCurrentCuePanelExtensionIndex(index, track); else setCurrentCuePanelIndex(index);
  cuePanelText.focus(); return true;
}
function layerPlaybackElement(time) {
  const target = getCurrentCuePanelTarget();
  if (target && isSubtitlePreviewActive(target.segment, time)) {
    const attr = target.kind === 'extension' ? 'ext-idx' : 'idx';
    const row = container.querySelector(`.cue[data-${attr}="${target.index}"]`);
    if (row && !row.hidden && !row.classList.contains('hidden')) return row;
  }
  const mode = multiSubtitleVisible() ? getMultiSubtitleState().display_mode : 'main';
  const candidates = [];
  if (mode !== 'extension') for (const index of layerActive(DATA.segments, time)) candidates.push({ index, role: 'main', start: DATA.segments[index].start });
  const extensions = getActiveExtensionTrack()?.segments || [];
  if (multiSubtitleVisible() && mode !== 'main') for (const index of layerActive(extensions, time)) candidates.push({ index, role: 'extension', start: extensions[index].start });
  candidates.sort((a, b) => a.start - b.start || (a.role === b.role ? a.index - b.index : a.role === 'main' ? -1 : 1));
  for (const hit of candidates) {
    const attr = hit.role === 'extension' ? 'ext-idx' : 'idx';
    const row = container.querySelector(`.cue[data-${attr}="${hit.index}"]`);
    if (row && !row.hidden && !row.classList.contains('hidden')) return row;
  }
  return null;
}
function layerMergeSelected(indices, role = 'main', track = null) {
  const initial = role === 'main' ? DATA.segments : track?.segments;
  const wanted = new Set(indices.map(index => initial?.[index]?.id));
  commitProcessingEdits();
  const cues = role === 'main' ? DATA.segments : getExtensionTrack(track?.id)?.segments;
  const chosen = (cues || []).filter(cue => wanted.has(cue.id))
    .sort((a, b) => a.start - b.start || cues.indexOf(a) - cues.indexOf(b));
  if (chosen.length < 2) return false;
  const start = Math.min(...chosen.map(cue => cue.start)), end = Math.max(...chosen.map(cue => cue.end));
  const ids = new Set(chosen.map(cue => cue.id));
  if (!layerAllowOverlap() && cues.some(cue => !ids.has(cue.id) && layerCore.intersects(cue, { start, end })
      && !chosen.some(item => layerCore.intersects(item, cue)))) {
    flashHint('合并范围会新增重叠，请先启用“允许字幕重叠”', 'warning'); return false;
  }
  const generation = mswProjectGeneration;
  const signature = JSON.stringify(chosen);
  const dialog = document.createElement('dialog');
  dialog.className = 'msw-layer-merge';
  const heading = document.createElement('h3'); heading.textContent = '合并所选字幕';
  const summary = document.createElement('p');
  summary.textContent = `${role === 'main' ? '主字幕' : '副字幕'} · ${chosen.length} 条 · ${formatTimelineMilliseconds(start)} → ${formatTimelineMilliseconds(end)}`;
  const preview = document.createElement('pre'); preview.textContent = chosen.map(cue => cue.text).join('\n');
  const explanation = document.createElement('p');
  explanation.textContent = '按开始时间拼接，只合并所选条目。新字幕保留首条颜色和样式；旧绑定解除，原配音来源保留并待复核。';
  const actions = document.createElement('div'); actions.className = 'msw-layer-actions';
  const cancel = document.createElement('button'); cancel.textContent = '取消'; cancel.onclick = () => dialog.close();
  const confirm = document.createElement('button'); confirm.textContent = '合并'; confirm.className = 'primary';
  confirm.onclick = () => {
    if (generation !== mswProjectGeneration || signature !== JSON.stringify(chosen)
        || !chosen.every(cue => cues.includes(cue))) {
      dialog.close(); flashHint('字幕已变化，请重新选择合并内容', 'warning'); return;
    }
    pushUndo('合并所选字幕', { captureView: true });
    // Resolve colors/group references before removing heads or sorting.
    layerCore.materializeReferences(cues);
    const merged = { ...structuredClone(chosen[0]), id: window.MSWProject.id('merged'), start, end,
      text: chosen.map(cue => cue.text).join(mergeJoinSeparatorForMode(DATA.split_mode)), items: [], _dirty: true };
    for (const field of ['color', 'sticker']) if (merged[field]) Object.assign(merged[field], { start, end });
    removeBindingsForSegmentIds(role === 'main' ? [...ids] : [], role === 'extension' ? [...ids] : []);
    for (let i = cues.length - 1; i >= 0; i--) if (ids.has(cues[i].id)) cues.splice(i, 1);
    cues.push(merged); currentCuePanelIdx = -1; resetCuePanelEditState();
    clearSelection({ silent: true, commitCuePanel: false });
    (role === 'main' ? selectedIdxs : selectedExtensionIdxs).add(cues.length - 1);
    projectImportDirty = true; renderAll();
    if (track) setCurrentCuePanelExtensionIndex(cues.indexOf(merged), track); else setCurrentCuePanelIndex(cues.indexOf(merged));
    dialog.close();
  };
  actions.append(cancel, confirm); dialog.append(heading, summary, preview, explanation, actions);
  dialog.addEventListener('close', () => dialog.remove()); document.body.append(dialog); dialog.showModal();
  return true;
}
document.addEventListener('DOMContentLoaded', () => {
  layerSyncControls();
  document.getElementById('subtitle-legacy-visible')?.addEventListener('change', event => {
    if (!layerMode()) return;
    pushUndo('显示旧叠加组'); DATA.subtitle_layers.legacy_overlay.visible = event.target.checked;
    renderAll({ waveform: 'full' });
  });
  // Reject unadapted export routes before their handlers run. Backend serialization
  // has the same guard; opening TTS/translation for selection inspection still works.
  document.addEventListener('click', event => {
    if (!layerMode()) return;
    const item = event.target.closest('[id]');
    if (item && /^(download-|msw-(asr|tts|translation)-start)/.test(item.id)) {
      event.preventDefault(); event.stopImmediatePropagation(); layerBlockProduction();
    }
  }, true);
});
