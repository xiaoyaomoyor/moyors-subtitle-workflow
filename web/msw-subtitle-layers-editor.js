// Unified production adapter. Old arrays remain storage; role and cue IDs are identity.
// Keep legacy numeric UI handles at the boundary; identity survives all sorting.
const layerCore = window.MSWSubtitleLayers;
const layerUpgradeRequested = new URLSearchParams(location.search).get('subtitle-layers') !== '0';
let layerIndexes = new WeakMap();
let layerPendingDragHistory = null;
let layerPresentationCache = null;
function prepareLayerProject(project) {
  if (project?.schema && !['moy.asr.project.v1', 'msw.project.v2'].includes(project.schema)) {
    throw new Error('工程版本不受支持，请使用兼容的编辑器打开');
  }
  return layerUpgradeRequested || layerCore.enabled(project) ? layerCore.migrate(project) : project;
}
function layerMode() { return layerCore.enabled(DATA); }
function layerAllowOverlap() { return DATA.subtitle_layers?.allow_overlap !== false; }
function layerInvalidate() { layerIndexes = new WeakMap(); layerPresentationCache = null; }
function layerUpdateDrag(drag) {
  const cues=drag.track==='extension'?getActiveExtensionTrack()?.segments:DATA.segments;
  if(cues)layerIndexes.get(cues)?.update(drag.indices);
  if(drag.track==='main'&&drag.boundOriginals?.size) {
    const followers=getActiveExtensionTrack()?.segments;
    if(followers) {
      drag.layerFollowerIndexes ||= new Map(followers.map((cue,index)=>[cue,index]));
      layerIndexes.get(followers)?.update([...drag.boundOriginals.values()].map(entry=>drag.layerFollowerIndexes.get(entry.target)).filter(Number.isInteger));
    }
  }
  // Keep screen groups stable during the gesture. Commit/cancel invalidates
  // their complete presentation; live hit testing uses the updated cue ranges.
}
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
  document.documentElement.classList.toggle('msw-unified-subtitles', layerMode());
  document.querySelectorAll('option[value="overlay"]').forEach(option => {
    option.hidden = layerMode();
    if (layerMode() && option.selected) option.parentElement.value = 'main';
  });
  for (const id of ['subtitle-layer-presentation-settings','subtitle-layer-auto-wrap','download-merged-srt','download-legacy-project']) { const node=document.getElementById(id);if(node)node.hidden=!layerMode(); }
  const order=document.getElementById('subtitle-layer-order');if(order)order.value=DATA.subtitle_layers?.presentation?.order||'earlier-bottom';
  const auto=document.getElementById('subtitle-layer-auto'),gap=document.getElementById('subtitle-layer-gap');
  if(auto)auto.checked=DATA.subtitle_layers?.presentation?.mode!=='manual';if(gap)gap.value=DATA.subtitle_layers?.presentation?.gap??12;
  const control = document.getElementById('subtitle-legacy-visible');
  if (control) {
    control.closest('label').hidden = !layerMode() || !DATA.subtitle_layers.legacy_overlay.cue_ids.length;
    control.checked = DATA.subtitle_layers?.legacy_overlay?.visible === true;
  }
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
function layerMergeSelected(indices, role = 'main', track = null, mode = 'union') {
  if (pendingLinkedSplit) { flashHint('请先确认或取消当前切分', 'warning'); return false; }
  const initial = role === 'main' ? DATA.segments : role === 'overlay' ? getOverlayTrack()?.segments : track?.segments;
  const ids = [...new Set(indices.map(index => initial?.[index]?.id).filter(Boolean))];
  commitProcessingEdits();
  const source = role === 'main' ? DATA.segments : role === 'overlay' ? getOverlayTrack()?.segments : getExtensionTrack(track?.id)?.segments;
  const sourceEl = container.querySelector(role === 'extension' ? `.cue[data-ext-idx="${indices[0]}"]`
    : role === 'overlay' ? `.overlay-track-cue[data-overlay-idx="${indices[0]}"]` : `.cue[data-idx="${indices[0]}"]`);
  const anchor = captureVisibleCueListVisualAnchor(sourceEl);
  let plan;
  try {
    plan = layerCore.planMerge(DATA, {role, track_id: role === 'extension' ? track?.id : null}, ids, {
      mode, makeId: () => window.MSWProject.id('merged'),
      joinText: (cues, target) => {
        const text = cues.map(c => c.text || '').join('\n');
        const splitMode = target.role === 'extension' ? getExtensionSubtitleSplitMode(getExtensionTrack(target.track_id), {text}) : getMainSubtitleSplitMode({text});
        return window.AsrEditorUtils.joinSegmentTexts(cues, mergeJoinSeparatorForMode(splitMode));
      },
    });
    for (const change of plan.changes) if (change.changed) syncSegmentTimebase(change.merged, projectTimebase(), {preferFrames:false});
  } catch (error) { flashHint(error.message, 'warning'); return false; }
  const feedback = captureMergeFeedback(plan);
  pushUndo(mode === 'common' ? '共有状态合并' : '累加状态合并', {captureView:true});
  clearSelection({silent:true, commitCuePanel:false});
  for (const change of plan.changes) {
    if (!change.changed) continue;
    const cues = change.role === 'main' ? DATA.segments : change.role === 'overlay' ? getOverlayTrack().segments : getExtensionTrack(change.track_id).segments;
    cues.splice(0,cues.length,...change.segments);
    if (change.role === 'main' && DATA.subtitle_layers?.legacy_overlay) {
      const legacy = DATA.subtitle_layers.legacy_overlay;
      const allLegacy = [...change.ids].every(id => legacy.cue_ids.includes(id));
      legacy.cue_ids = legacy.cue_ids.filter(id => !change.ids.has(id));
      if (allLegacy) legacy.cue_ids.push(change.merged.id);
    }
  }
  if (DATA.multi_subtitle) DATA.multi_subtitle.bindings = plan.bindings;
  syncBindingOffsets();
  currentCuePanelIdx = -1; resetCuePanelEditState();
  const primary = plan.changes[0].merged;
  const primaryIndex = source.findIndex(c => c.id === primary.id);
  (role === 'main' ? selectedIdxs : role === 'overlay' ? selectedOverlayIdxs : selectedExtensionIdxs).add(primaryIndex);
  for (const change of plan.changes) temporaryVisibleSplitCueKeys.add(splitCueVisibilityKey(change.role, change.merged, change.track_id));
  projectImportDirty = true;
  renderAll({cueListAnchor:anchor});
  const index = source.findIndex(c => c.id === primary.id);
  setCuePanelTarget(role,index,track?.id || null);
  updateSelectionCountText();
  if (role === 'main') lastClickedIdx=index; else if (role === 'extension') lastClickedExtensionIdx=index; else lastClickedOverlayIdx=index;
  updateWithoutCueListAutoScroll(); scheduleAutoSaveFlush();
  triggerMergeFeedback(feedback);
  const label = mode === 'common' ? '共有状态合并完成' : '累加状态合并完成';
  const suffix = plan.conflicts.length ? '；不同颜色或表情包已保留时间最早的标记' : '';
  const message = [label, plan.linked ? '，主副字幕已联动并保留绑定' : '', suffix]
    .map(text => window.MSWE_I18N?.translateText?.(text) || text).join('');
  if (plan.conflicts.length) flashHint(message, 'warning');
  return true;
}

document.addEventListener('DOMContentLoaded', () => {
  layerSyncControls();
  for(const id of ['subtitle-layer-auto','subtitle-layer-gap','subtitle-layer-order']) document.getElementById(id)?.addEventListener('change',()=>{
    if(!layerMode())return;const gap=document.getElementById('subtitle-layer-gap');if(!gap.validity.valid)return;
    pushUndo('多层字幕排布');DATA.subtitle_layers.presentation={mode:document.getElementById('subtitle-layer-auto').checked?'auto':'manual',gap:Number(gap.value),order:document.getElementById('subtitle-layer-order').value};layerInvalidate();projectImportDirty=true;refreshSubtitlePreview();scheduleAutoSaveFlush();
  });
  document.getElementById('download-legacy-project')?.addEventListener('click',async()=>{
    try {commitProcessingEdits();const project=layerCore.legacyExport(JSON.parse(buildJson()));await downloadFile(JSON.stringify(project,null,2),`${FILENAME_BASE}.v1.mosp`,'application/json');}
    catch(error){flashHint(error.message,'warning');}
  });
  document.getElementById('download-merged-srt')?.addEventListener('click',async()=>{
    commitProcessingEdits();const cues=window.MSWSubtitlePresentation.mergedSrtRows(DATA);
    await downloadFile(window.AsrEditorUtils.buildSrtPayload(cues,{formatTime:fmtSrtTime}),`${FILENAME_BASE}.merged.srt`,'text/plain',{desc:'合并显示 SRT',types:{'text/plain':['.srt']}});
  });
  document.getElementById('subtitle-legacy-visible')?.addEventListener('change', event => {
    if (!layerMode()) return;
    pushUndo('显示旧叠加组'); DATA.subtitle_layers.legacy_overlay.visible = event.target.checked;
    renderAll({ waveform: 'full' });
  });

});


async function layerChooseAsrTargets(jobs, target) {
  if (!layerMode()) return {};
  const choices = window.MSWResultApply.targetChoices(DATA, jobs, target);
  if (!choices.required) return {};
  const generation = mswProjectGeneration;
  return new Promise(resolve => {
    const dialog = document.createElement('dialog'); dialog.className = 'msw-layer-merge';
    const title = document.createElement('h3'); title.textContent = '选择本次 ASR 替换目标';
    const tip = document.createElement('p'); tip.textContent = '只替换勾选的字幕，其他层保持原样。不勾选则作为新字幕插入。';
    const list = document.createElement('div'); list.className = 'msw-layer-targets';
    const selected = new Set(target === 'main' ? processingSelection().mainIds : processingSelection().extensionIds);
    const inputs = choices.rows.map(cue => {
      const label = document.createElement('label'), input = document.createElement('input'), text = document.createElement('span');
      input.type = 'checkbox'; input.value = cue.id; input.checked = selected.has(cue.id);
      text.textContent = `${fmtShort(cue.start)} → ${fmtShort(cue.end)} · ${cue.text}`;
      text.dataset.i18nSkip = '';
      label.append(input, text); list.append(label); return input;
    });
    const actions = document.createElement('div'); actions.className = 'msw-layer-actions';
    const cancel = document.createElement('button'); cancel.textContent = '取消'; cancel.onclick = () => dialog.close();
    const apply = document.createElement('button'); apply.className = 'primary'; apply.textContent = '确认目标';
    let result = null;
    apply.onclick = () => { if (generation === mswProjectGeneration) result = {targetIds: inputs.filter(i => i.checked).map(i => i.value)}; dialog.close(); };
    actions.append(cancel, apply); dialog.append(title, tip, list, actions); document.body.append(dialog);
    dialog.addEventListener('close', () => {dialog.remove(); resolve(result);}, {once:true}); dialog.showModal();
  });
}


function layerExportMainSegments() {
  const cues=DATA.segments.map(cue=>({...cue}));
  layerCore.materializeReferences(cues);
  return cues.filter(cue=>layerCore.visible(DATA,cue));
}

function layerAssMargins(options, project = DATA, target = 'both') {
  if(options.projectStyle)project={...project,preview:{...project.preview,project_style:options.projectStyle}};
  if(project.subtitle_layers?.presentation?.mode==='manual'&&!project.preview?.project_style?.pairLayout)return {main:{},secondary:{}};
  const resolution=window.AsrEditorUtils.normalizeAssPlayResolution(options.playResX,options.playResY);
  const styles={}, bases={};
  for (const role of ['main','secondary']) {
    const raw=role==='main'?options.assStyle:options.assExtensionStyle;
    const font=options.assProfile && raw ? raw.fontSize : window.AsrEditorUtils.resolveAssFontSize(options.appearance?.font_size,resolution.height)*1080/resolution.height;
    const margin=raw?.marginV ?? (role==='main'?80:20);
    bases[role]=margin;
    styles[role]={font_size:font,scale_y:raw?.scaleY??100,width:Math.max(.1,1-((raw?.marginL??10)+(raw?.marginR??10))/resolution.width),y:1-margin/resolution.height};
  }
  const layout=window.MSWSubtitlePresentation.layout(project,styles,target,1080*resolution.width/resolution.height);
  const result={main:{},secondary:{}};
  for(const entry of layout.entries) result[entry.role][entry.cue.id]=Math.round(bases[entry.role]+layout.offsets.get(entry.key).offset*resolution.height/1080);
  return result;
}

function layerRefreshSubtitlePreview(tMs) {
  const lib=window.AsrEditorUtils.normalizeAssStyleLibrary(window.MSWSubtitleStyle?.previewLibrary() || ASS_STYLE_LIBRARY);
  const profile=window.AsrEditorUtils.assProfileForId(lib,lib.assignments.assExportProfileId);
  const assStyles={main:window.AsrEditorUtils.assStyleForId(lib,profile.styleId),secondary:window.AsrEditorUtils.assStyleForId(lib,lib.assignments.assExtensionStyleId)};
  const geo=getPreviewGeometry(), metrics=assPreviewMetrics(), scale=metrics.stageHeight/1080;
  const ass=EDITOR_SETTINGS.assMode===true;
  const appearances={main:getSubtitleAppearance(),secondary:getExtensionSubtitleAppearance()};
  const styles={};
  for(const role of ['main','secondary']) {
    const a=appearances[role], s=assStyles[role];
    styles[role]=ass?{font_family:s.fontName,bold:s.bold,italic:s.italic,font_size:s.fontSize,scale_x:s.scaleX,scale_y:s.scaleY,spacing:s.spacing,width:Math.max(.1,1-(s.marginL+s.marginR)/metrics.resolution.width),y:1-s.marginV/1080}
      : {font_size:(parseFloat(getComputedStyle(role==='main'?overlayTextEl:overlayExtensionTextEl).fontSize)||24)/Math.max(.01,scale),width:geo.width,y:geo.y+geo.height-(role==='main'&&multiSubtitleVisible()?.06:0)};
  }
  const previewStyle=window.MSWSubtitleStyle?.currentPreview().style||DATA.preview?.project_style;
  const cacheKey=JSON.stringify([styles,previewStyle?.pairLayout,previewStyle?.main.wrapMode,previewStyle?.main.charsPerLine,previewStyle?.secondary.wrapMode,previewStyle?.secondary.charsPerLine,DATA.subtitle_layers.presentation,metrics.stageWidth,metrics.stageHeight]);
  if(!layerPresentationCache||layerPresentationCache.key!==cacheKey) layerPresentationCache={key:cacheKey,layout:window.MSWSubtitlePresentation.layout({...DATA,preview:{...DATA.preview,project_style:previewStyle}},styles,'both',1080*metrics.stageWidth/metrics.stageHeight)};
  const layout=layerPresentationCache.layout;
  layout.byKey ||= new Map(layout.entries.map(entry=>[entry.key,entry]));
  let root=document.getElementById('msw-layer-preview');
  if(!root){root=document.createElement('div');root.id='msw-layer-preview';root.className='msw-layer-preview';playerStage.append(root);}
  root.hidden=false;overlayEl.classList.remove('hidden');
  overlayEl.classList.add('msw-layer-geometry');
  const allowed={main:overlayToggle.checked&&!subtitleTrackMuted('main'),secondary:extensionOverlayToggle?.checked&&!subtitleTrackMuted('extension')};
  const mainHits=new Set(layerActive(DATA.segments,tMs).map(i=>DATA.segments[i].id));
  const ext=getActiveExtensionTrack()?.segments||[],extHits=new Set(layerActive(ext,tMs).map(i=>ext[i].id));
  const active=[...[...mainHits].map(id=>layout.byKey.get(window.MSWSubtitlePresentation.key('main',id))),...[...extHits].map(id=>layout.byKey.get(window.MSWSubtitlePresentation.key('secondary',id)))].filter(e=>e&&allowed[e.role]);
  const keys=new Set(active.map(e=>e.key));for(const element of [...root.children])if(!keys.has(element.dataset.key))element.remove();
  const labels=getSpeakerLabelSettings();
  for(const entry of active) {
    let element=[...root.children].find(e=>e.dataset.key===entry.key);
    if(!element){element=document.createElement('div');element.className='msw-layer-preview-text';element.dataset.key=entry.key;element.dataset.cueId=entry.cue.id;element.dataset.role=entry.role;root.append(element);}
    const segments=entry.role==='main'?DATA.segments:ext, appearance=appearances[entry.role];
    const speaker=labels.mapping_enabled&&labels.enabled?window.AsrEditorUtils.speakerLabelForSegment(entry.cue,segments,labels.names):'';
    const prefix=speaker?`${speaker}${labels.separator}`:'';
    if(!element.firstElementChild){const label=document.createElement('span');label.className='msw-layer-speaker';element.replaceChildren(label,document.createTextNode(''));}
    const speakerNode=element.firstElementChild;
    if(speakerNode.textContent!==prefix)speakerNode.textContent=prefix;
    if(element.lastChild.nodeValue!==entry.cue.text)element.lastChild.nodeValue=entry.cue.text;
    speakerNode.removeAttribute('style');
    const paletteColor=COLOR_BY_NAME[MULTI_SUBTITLE_UTILS.effectiveColorName(entry.cue,segments)]?.value;
    const offset=layout.offsets.get(entry.key).offset;
    element.dataset.layerOffset=String(offset);
    element.removeAttribute('style');
    if(ass) {
      const base=assPreviewStyleVariant(assStyles[entry.role],entry.cue,segments,getSubtitleAppearance());
      const animation=window.AsrEditorUtils.assPreviewAnimationState(profile,tMs-entry.cue.start,entry.cue.end-entry.cue.start,{playResX:metrics.resolution.width,playResY:metrics.resolution.height,stageWidth:metrics.stageWidth,stageHeight:metrics.stageHeight});
      const style=assPreviewAnimatedStyle(base,profile,animation), alignment=assPreviewAlignment(style.alignment);
      const colorMode=getSubtitleAppearance().ass_color_style||DEFAULT_ASS_COLOR_STYLE;
      if(prefix&&['text','speaker'].includes(colorMode)&&paletteColor)speakerNode.style.color=paletteColor;
      const margins={left:style.marginL*metrics.scaleX,right:style.marginR*metrics.scaleX,vertical:style.marginV*metrics.scaleY};
      if(entry.role==='main'&&profile.animations.move?.enabled) {
        applyAssPreviewElement(element,{...style,__assMove:{x:animation.moveX,y:animation.moveY-offset*scale}},animation,metrics,alignment,margins);
      } else {
        applyAssAnchoredPreviewElement(element,style,animation,metrics,alignment,margins,margins.vertical+offset*scale);
        if(alignment.y===.5)element.style.top=`calc(50% - ${offset*scale}px)`;
      }
      element.style.whiteSpace='pre-wrap';
    } else {
      const colorName=MULTI_SUBTITLE_UTILS.effectiveColorName(entry.cue,segments),color=appearance.color_underline!==false?COLOR_BY_NAME[colorName]?.value:null;
      const colorStyle=appearance.color_style||DEFAULT_SUBTITLE_COLOR_STYLE;
      if(prefix&&paletteColor&&colorStyle!=='stroke')speakerNode.style.color=paletteColor;
      Object.assign(element.style,{left:`${(geo.x+geo.width/2)*100}%`,bottom:`${(1-styles[entry.role].y)*100+offset/10.8}%`,width:'max-content',maxWidth:`${geo.width*100}%`,
        transform:'translateX(-50%)',fontSize:`${styles[entry.role].font_size*scale}px`,fontFamily:getComputedStyle(entry.role==='main'?overlayTextEl:overlayExtensionTextEl).fontFamily,
        color:colorStyle==='text'&&color?color:appearance.color||'#ffffff',backgroundColor:subtitleBackgroundCss(appearance),
        opacity:'1',padding:'0 .35em',borderRadius:'var(--radius-sm)',textDecorationLine:appearance.color_underline!==false&&colorStyle==='underline'&&color?'underline':'none',textDecorationColor:color||'',textUnderlineOffset:'.25em',webkitTextStroke:colorStyle==='stroke'&&color?`.1em ${color}`:'',textShadow:colorStyle==='shadow'&&color?`0 .08em .1em ${color}`:'0 1px 2px rgba(0,0,0,.8)',paintOrder:'stroke fill'});
    }
  }
  renderStickerOverlay(tMs);
}

document.addEventListener('input',event=>{if(event.target.matches('textarea,[contenteditable="true"]'))layerPresentationCache=null;},true);


async function layerProtectHandle(handle, content, silent = false) {
  let next;
  try { next = typeof content === 'string' ? JSON.parse(content) : content; } catch { return; }
  if (!handle.getFile) return;
  const original = await handle.getFile(); if (!original.size) return;
  const text = await original.text(); const previous = JSON.parse(text);
  if (previous.schema === 'msw.project.v2') {
    if(next?.schema!=='msw.project.v2')throw Error('不能用旧版结构覆盖多层字幕工程，请另存为新文件');
    return;
  }
  if(next?.schema!=='msw.project.v2')return;
  if (previous.schema && previous.schema !== 'moy.asr.project.v1') throw Error('目标工程版本不兼容，未覆盖');
  if (silent) throw Error('首次升级需先保留旧工程，请手动保存一次');
  const backup = await window.showSaveFilePicker({suggestedName:handle.name.replace(/\.[^.]+$/,'')+`.v1-backup.${Date.now()}.mosp`,
    types:[{description:'旧工程升级备份',accept:{'application/json':['.mosp']}}]});
  if (await backup.isSameEntry?.(handle) || (await backup.getFile()).size) throw Error('请选择空白备份文件；未覆盖原工程或已有备份');
  const output=await backup.createWritable(); await output.write(original); await output.close();
  if ((await (await handle.getFile()).text())!==text) throw Error('备份期间原工程已变化，未覆盖');
}

function layerMatchImportedSubtitles(main, secondary, tolerance) {
  const match=MULTI_SUBTITLE_UTILS.matchSubtitleSegments(main,secondary,tolerance);
  if(!layerMode())return match;
  match.matches=match.matches.filter(candidate=>match.candidates.filter(c=>c.mainIndex===candidate.mainIndex).length===1 && match.candidates.filter(c=>c.extensionIndex===candidate.extensionIndex).length===1);
  const mains=new Set(match.matches.map(c=>c.mainIndex)), extensions=new Set(match.matches.map(c=>c.extensionIndex));
  match.unmatchedMain=main.map((_,i)=>i).filter(i=>!mains.has(i));
  match.unmatchedExtension=secondary.map((_,i)=>i).filter(i=>!extensions.has(i));
  return match;
}
