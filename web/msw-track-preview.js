// Fixed-track browser presentation. Geometry is in video-content 1080p units.
let fixedPreviewCache = null;
let fixedExactGeometry = null;
let fixedGeometrySerial=0;
function fixedGeometryKey() { return JSON.stringify([mswProjectGeneration,DATA.segments,DATA.multi_subtitle,DATA.subtitle_tracks,window.MSWSubtitleStyle?.currentPreview(),getSpeakerLabelSettings()]); }
function fixedReceiveGeometry(geometry) {
  if(productionFlatMode()) {
    const refs=new Map(layerCore.tracks(DATA).flatMap(s=>s.segments.map(c=>[c.id,fixedTrackCore.key({role:s.role,track_id:s.track_id,cue_id:c.id})])));
    geometry=geometry.map(r=>({...r,key:refs.get(JSON.parse(r.key)[2])||r.key}));
  }
  fixedExactGeometry={key:fixedGeometryKey(),serial:++fixedGeometrySerial,rows:geometry};fixedPreviewCache=null;refreshSubtitlePreview();
  if(!document.activeElement?.matches('#style-position-x,#style-position-y'))window.MSWSubtitleStyle?.syncPosition();
}
const fixedTextMeasures = new Map();
let fixedMeasureRoot = null;
let fixedStyleTrackId = '';
let fixedPositionScope = 'track';
let fixedPositionRef = null;
let fixedPositionEditing = false;
let fixedPositionDrag = null;
let fixedPositionHold = null;
let fixedPositionOffsetsKey = '';
let fixedPositionNotice = '';
function fixedPresentationMode() { return fixedTrackMode() && DATA.subtitle_tracks.presentation === 'fixed'; }
function fixedPreviewInvalidate() { fixedPreviewCache = null; }
function fixedStyleTarget() { return DATA.subtitle_tracks?.tracks.find(t => t.id === fixedStyleTrackId) || null; }
function fixedStyleGroup(track=fixedStyleTarget()) {
  if(!productionFlatMode()||!track)return null;
  const tracks=DATA.subtitle_tracks.tracks,main=tracks.find(t=>t.id===track.secondary_for)||track;
  return {main,secondary:tracks.find(t=>t.secondary_for===main.id)||null};
}
function fixedStyleValue(custom=false) {
  const group=fixedStyleGroup(),S=window.MSWProjectStyle;
  const own=t=>custom&&t.style.custom?S.forKind(t.style.custom,fixedTrackCore.styleKind(t)):window.MSWTrackPresentation.styleFor(DATA,t);
  if(!group)return own(fixedStyleTarget()||{style:{mode:'inherit'}});
  const style=S.normalize(own(group.main));style.main=structuredClone(own(group.main)[group.main.flat_style_slot||'main']);
  if(group.secondary)style.secondary=structuredClone(own(group.secondary)[group.secondary.flat_style_slot||'main']);
  return style;
}
function fixedCommitStyle(style, selection) {
  const track=fixedStyleTarget(); if(!track)return false;
  const next=fixedContent(), target=next.subtitle_tracks.tracks.find(t=>t.id===track.id),group=fixedStyleGroup();
  const value=window.MSWProjectStyle.normalize(style);
  const members=group?[[group.main,'main'],...(group.secondary?[[group.secondary,'secondary']]:[])]:[[target,null]];
  for(const [member,role] of members) {
    const dest=next.subtitle_tracks.tracks.find(t=>t.id===member.id),mapped=window.MSWProjectStyle.forKind(value,fixedTrackCore.styleKind(member));
    if(role)mapped[member.flat_style_slot||'main']=structuredClone(mapped[role]);
    const custom=selection==='current'?mapped:member.style.custom||window.MSWTrackPresentation.styleFor(DATA,member);
    dest.style=selection==='inherit'?{mode:'inherit',custom}:{mode:'snapshot',value:mapped,selection,custom};
  }
  const ok=fixedCommitProject(next,'修改轨道字幕样式');
  if(ok)window.dispatchEvent(new Event('msw:burn-style'));
  return ok;
}
function fixedSetPresentation(mode) {
  const next=fixedContent();next.subtitle_tracks.presentation=mode;
  fixedPositionEditing=false;
  if(fixedCommitProject(next,'切换字幕画面排布'))window.dispatchEvent(new Event('msw:burn-style'));
}
function fixedVideoRect() {
  const stage=playerStage.getBoundingClientRect(), video=player.getBoundingClientRect();
  const ratio=player.videoWidth>0&&player.videoHeight>0?player.videoWidth/player.videoHeight:16/9;
  const availableWidth=video.width||stage.width,availableHeight=video.height||stage.height;
  const width=Math.min(availableWidth,availableHeight*ratio),height=width/ratio;
  return {left:video.left-stage.left+(availableWidth-width)/2,top:video.top-stage.top+(availableHeight-height)/2,
    width,height,referenceWidth:1080*ratio,clientLeft:video.left+(availableWidth-width)/2,clientTop:video.top+(availableHeight-height)/2};
}
function fixedMeasureText(row, projectStyle, width) {
  const role=row.role==='main'?'main':'secondary',style=projectStyle[role];
  const labels=getSpeakerLabelSettings(),segments=row.role==='main'?DATA.segments:getExtensionTrack(row.track_id)?.segments||[];
  const speaker=labels.enabled&&labels.mapping_enabled?window.AsrEditorUtils.speakerLabelForSegment(row.cue,segments,labels.names):'';
  const prefix=speaker?speaker+labels.separator:'';
  const text=prefix+window.MSWProjectStyle.wrapText(row.cue.text,style);
  const key=JSON.stringify([text,prefix,style,width]);if(fixedTextMeasures.has(key))return fixedTextMeasures.get(key);
  if(!fixedMeasureRoot){fixedMeasureRoot=document.createElement('div');fixedMeasureRoot.className='fixed-subtitle-measure';document.body.append(fixedMeasureRoot);}
  fixedMeasureRoot.style.width=width+'px';
  const node=document.createElement('div');node.textContent=text;node.className='fixed-subtitle-text';
  const metrics={resolution:{width,height:1080},stageWidth:width,stageHeight:1080,scaleX:1,scaleY:1};
  applyAssPreviewElement(node,style,{opacity:1},metrics,{x:0,y:0},{left:style.marginL,right:style.marginR});
  const padding=(Math.max(0,style.outline)+Math.max(0,style.shadow))*Math.max(1,(style.scaleX||100)/100,(style.scaleY||100)/100);
  const maxWidth=Math.max(1,(width-style.marginL-style.marginR-2*padding)/Math.max(.01,(style.scaleX||100)/100));
  Object.assign(node.style,{width:'max-content',maxWidth:maxWidth+'px',
    textAlign:['left','center','right'][((style.alignment||2)-1)%3],whiteSpace:'pre-wrap',overflowWrap:'anywhere'});
  fixedMeasureRoot.replaceChildren(node);
  const rect=node.getBoundingClientRect(),root=fixedMeasureRoot.getBoundingClientRect();
  const result={width:rect.width+2*padding,height:rect.height+2*padding,css:node.style.cssText,text,prefix,maxWidth,
    innerX:padding-(rect.left-root.left),innerY:padding-(rect.top-root.top)};
  fixedMeasureRoot.replaceChildren();
  if(fixedTextMeasures.size>=3000)fixedTextMeasures.clear();fixedTextMeasures.set(key,result);return result;
}
function fixedPreviewLayout(rect=fixedVideoRect()) {
  const preview=window.MSWSubtitleStyle?.currentPreview(),proof=preview?.scope==='proof'?preview.style:null;
  const key=JSON.stringify([rect.referenceWidth,getActiveExtensionTrack()?.id,proof,DATA.preview?.project_style,getSpeakerLabelSettings(),fixedExactGeometry?.serial]);
  if(!fixedPreviewCache||fixedPreviewCache.key!==key) {
    const layout=window.MSWTrackPresentation.layout(DATA,{width:rect.referenceWidth,languageId:getActiveExtensionTrack()?.id,
      measure:fixedMeasureText,resolveStyle:track=>window.MSWTrackPresentation.styleFor(DATA,track,proof)});
    if(fixedExactGeometry?.key===fixedGeometryKey()) {
      const measured=new Map(fixedExactGeometry.rows.map(r=>[r.key,r]));
      for(const entry of layout.entries) {
        const exact=measured.get(entry.key);if(!exact)continue;
        Object.assign(entry,{x:exact.x,y:exact.y,width:exact.width,height:exact.height,position:exact.position});
      }
      for(const group of layout.groups) {
        const rows=layout.entries.filter(e=>e.group===group);if(!rows.length)continue;
        group.x=Math.min(...rows.map(r=>r.x));group.y=Math.min(...rows.map(r=>r.y));
        group.width=Math.max(...rows.map(r=>r.x+r.width))-group.x;group.height=Math.max(...rows.map(r=>r.y+r.height))-group.y;
      }
    }
    fixedPreviewCache={key,layout,index:new layerCore.IntervalIndex(layout.entries.map(e=>e.cue))};
  }
  return fixedPreviewCache;
}
function fixedHidePreview() {
  const root=document.getElementById('fixed-subtitle-preview');if(root)root.hidden=true;
  const tools=document.getElementById('fixed-position-toolbar');if(tools)tools.hidden=true;
  playerStage.classList.remove('fixed-presentation');
}
function fixedRefreshSubtitlePreview(tMs) {
  const rect=fixedVideoRect();if(!rect.width||!rect.height)return;
  playerStage.classList.add('fixed-presentation');
  const old=document.getElementById('msw-layer-preview');if(old)old.hidden=true;
  let root=document.getElementById('fixed-subtitle-preview');
  if(!root){root=document.createElement('div');root.id='fixed-subtitle-preview';playerStage.append(root);fixedInstallPositionDrag(root);}
  root.hidden=false;
  Object.assign(root.style,{left:rect.left+'px',top:rect.top+'px',width:rect.referenceWidth+'px',height:'1080px',transform:`scale(${rect.height/1080})`});
  root.classList.toggle('positioning',fixedPositionEditing);
  playerStage.classList.toggle('fixed-position-drag',!!fixedPositionDrag&&window.MSWSubtitleRenderer?.status!=='libass');
  const {layout,index}=fixedPreviewLayout(rect), allowed={main:overlayToggle.checked&&!subtitleTrackMuted('main'),
    extension:extensionOverlayToggle?.checked&&!subtitleTrackMuted('extension')};
  const active=index.at(tMs).map(i=>layout.entries[i]).filter(e=>allowed[e.role]);
  const keys=new Set(active.map(e=>e.key));for(const element of [...root.children])if(!keys.has(element.dataset.key))element.remove();
  const metrics={resolution:{width:rect.referenceWidth,height:1080},stageWidth:rect.referenceWidth,stageHeight:1080,scaleX:1,scaleY:1};
  for(const entry of active) {
    let element=[...root.children].find(e=>e.dataset.key===entry.key);
    if(!element){element=document.createElement('div');element.className='fixed-subtitle-row';element.dataset.key=entry.key;
      element.dataset.cueId=entry.cue_id;element.dataset.role=entry.role;const text=document.createElement('div');text.className='fixed-subtitle-text';element.append(text);root.append(element);}
    const text=element.firstElementChild,size=entry.size,style=entry.style;
    if(!text.firstElementChild)text.replaceChildren(document.createElement('span'),document.createTextNode(''));
    const speaker=text.firstElementChild;
    if(speaker.textContent!==size.prefix)speaker.textContent=size.prefix;
    if(text.lastChild.nodeValue!==size.text.slice(size.prefix.length))text.lastChild.nodeValue=size.text.slice(size.prefix.length);
    text.style.cssText=size.css;
    const segments=entry.role==='main'?DATA.segments:getExtensionTrack(entry.track_id)?.segments||[];
    const variant=assPreviewStyleVariant(style,entry.cue,segments,getSubtitleAppearance());
    const paletteColor=COLOR_BY_NAME[MULTI_SUBTITLE_UTILS.effectiveColorName(entry.cue,segments)]?.value;
    speaker.style.color=['text','speaker'].includes(getSubtitleAppearance().ass_color_style||DEFAULT_ASS_COLOR_STYLE)?paletteColor||'':'';
    const profile={animations:entry.group.style.animations};
    const animation=window.AsrEditorUtils.assPreviewAnimationState(profile,tMs-entry.cue.start,entry.cue.end-entry.cue.start,
      {playResX:rect.referenceWidth,playResY:1080,stageWidth:rect.referenceWidth,stageHeight:1080});
    const animated=assPreviewAnimatedStyle(variant,profile,animation);
    applyAssPreviewElement(text,animated,animation,metrics,{x:0,y:0},{left:style.marginL,right:style.marginR});
    Object.assign(text.style,{position:'absolute',left:size.innerX+'px',top:size.innerY+'px',maxWidth:size.maxWidth+'px'});
    let dx=0,dy=0;
    if(profile.animations.move?.enabled){dx=(animation.moveX||0)-profile.animations.move.x1;dy=(animation.moveY||0)-profile.animations.move.y1;}
    if(fixedPositionDragAffects(entry)){dx+=fixedPositionDrag.dx;dy+=fixedPositionDrag.dy;}
    Object.assign(element.style,{left:entry.x+dx+'px',top:entry.y+dy+'px',width:entry.width+'px',height:entry.height+'px'});
    const selected=fixedPositionScope==='track'?entry.group.trackId===fixedStyleTrackId:productionFlatMode()?fixedPositionSelectedIds().has(entry.cue_id):entry.group.rows.some(r=>fixedTrackCore.key(r)===fixedTrackCore.key(fixedPositionRef||{}));
    element.classList.toggle('selected-position',fixedPositionEditing&&selected);
    element.classList.toggle('annotation',entry.group.kind==='annotation');
    element.classList.toggle('position-target',fixedPositionEditing&&selected&&(fixedPositionScope==='cue'||entry.group.kind==='annotation'));
    element.dataset.groupId=entry.group.id;element.dataset.trackId=entry.group.trackId;
  }
  fixedApplyPositionOffsets(layout);fixedPositionFeedback(layout,tMs);renderStickerOverlay(tMs);
}
function fixedSelectedPositionGroup() {
  if(!fixedPresentationMode())return null;
  const {layout}=fixedPreviewLayout();
  return fixedPositionRef?layout.groups.find(g=>g.rows.some(r=>fixedTrackCore.key(r)===fixedTrackCore.key(fixedPositionRef))):null;
}
function fixedPositionCurrent() {
  if(productionFlatMode()&&fixedPositionScope==='cue') {
    const rows=fixedPositionSelection(),values=rows.map(r=>r.position).filter(Boolean);
    return Object.fromEntries(['x','y'].map(k=>[k,values.length&&values.every(p=>Math.abs(p[k]-values[0][k])<.00001)?values[0][k]:null]));
  }
  const group=fixedSelectedPositionGroup(),track=fixedStyleTarget();
  return fixedPositionScope==='cue'?(group?.rows.find(r=>r.cue.subtitle_position)?.cue.subtitle_position||track?.position||{x:.5,y:.08}):track?.position||{x:.5,y:.08};
}
function fixedCommitPosition(value) {
  if(productionFlatMode()&&fixedPositionScope==='cue')return fixedCommitSelectedPosition(value);
  const track=fixedStyleTarget();if(!track||fixedTrackCore.placement(track)!=='fixed')return false;
  if(pendingLinkedSplit){fixedStatus('请先确认或取消当前切分');return false;}
  try {
    if(track.locked)throw Error('轨道已锁定，请先解锁');
    const next=fixedContent();
    if(fixedPositionScope==='track') {
      const target=next.subtitle_tracks.tracks.find(t=>t.id===track.id);
      if(value)target.position=value;else delete target.position;
    } else {
      if(!fixedPositionRef)throw Error('请先在播放器中选择字幕');
      const refs=fixedTrackCore.boundRefs(next,[fixedPositionRef]);fixedTrackCore.assertEditable(next,refs);
      const index=fixedTrackCore.createIndex(next);
      for(const ref of refs){const cue=index.resolve(ref).cue;if(value)cue.subtitle_position=value;else delete cue.subtitle_position;}
    }
    fixedTrackCore.validate(next);fixedTrackCore.assertLocks(DATA,next);
    commitProcessingEdits();pushUndo(fixedPositionScope==='track'?'调整轨道位置':'调整当前字幕位置',{captureView:true});
    DATA.subtitle_tracks=next.subtitle_tracks;
    // Preserve cue object identities used by the editor while applying just positions.
    const index=fixedTrackCore.createIndex(next);
    for(const row of fixedTrackCore.createIndex(DATA).records({includeHidden:true})){
      const p=index.resolve(row).cue.subtitle_position;if(p)row.cue.subtitle_position=structuredClone(p);else delete row.cue.subtitle_position;
    }
    fixedPreviewInvalidate();projectImportDirty=true;fixedStatus();renderAll({waveform:'full'});scheduleAutoSaveFlush();
    window.dispatchEvent(new Event('msw:burn-style'));return true;
  } catch(error){fixedStatus(error.message);const note=document.getElementById('fixed-position-message');if(note)note.textContent=error.message;return false;}
}
// Position scope follows the actual editor selection, never related-only highlights.
function fixedPositionSelectedIds() {
  const selection=processingSelection();return new Set([...selection.mainIds,...selection.extensionIds]);
}
function fixedPositionPreviewActive() {
  return productionFlatMode()&&(fixedPositionEditing||fixedPositionScope==='cue'
    &&document.getElementById('style-track-position')?.open
    &&document.getElementById('media-settings-modal')?.getAttribute('aria-hidden')==='false');
}
function fixedSchedulePositionSelectionSync() {
  if(fixedSchedulePositionSelectionSync.pending)return;
  fixedSchedulePositionSelectionSync.pending=true;
  queueMicrotask(()=>{
    fixedSchedulePositionSelectionSync.pending=false;
    if(!productionFlatMode())return;
    window.MSWSubtitleStyle?.syncPosition();
    if(fixedPositionEditing)refreshSubtitlePreview();
  });
}
function fixedPositionSelection() {
  if(!productionFlatMode())return [];
  const ids=fixedPositionSelectedIds(),{layout}=fixedPreviewLayout();
  const entries=new Map(layout.entries.map(e=>[e.cue_id,e]));
  return fixedTrackCore.createIndex(DATA).records({includeHidden:true}).filter(r=>ids.has(r.cue_id)).map(row=>{
    const entry=entries.get(row.cue_id),position=entry?window.MSWTrackPresentation.positionOf(entry,layout.width):row.cue.subtitle_position?.alignment?{...row.cue.subtitle_position}:null;
    return {...row,entry,position};
  });
}
function fixedPositionSelectionLabel(rows=fixedPositionSelection()) {
  if(!rows.length)return '请先在字幕列表或波形区选择字幕';
  return rows.length===1?fixedCueLabel(rows[0].cue,rows[0].role,rows[0].track_id):`已选 ${rows.length} 条字幕`;
}
function fixedPositionDelta(rows,value) {
  const result={};
  for(const key of ['x','y']) {
    const values=rows.map(r=>r.position[key]);
    const delta=value[key]===undefined?0:value[key]-values[0];
    result[key]=Math.max(-Math.min(...values),Math.min(1-Math.max(...values),delta));
  }
  return result;
}
function fixedCommitSelectedPosition(value,rows=fixedPositionSelection()) {
  if(pendingLinkedSplit){fixedStatus('请先确认或取消当前切分');return false;}
  if(!rows.length)return false;
  try {
    if(value&&(!rows.every(r=>r.position)||Object.values(value).some(v=>!Number.isFinite(v))))throw Error('请先启用所选字幕及其轨道，再调整画面位置');
    commitProcessingEdits();
    const next=fixedContent(),index=fixedTrackCore.createIndex(next);
    fixedTrackCore.assertEditable(next,rows,false);
    const delta=value?fixedPositionDelta(rows,value):null;
    let changed=false;
    for(const row of rows) {
      const cue=index.resolve(row)?.cue;if(!cue)throw Error('所选字幕已发生变化，请重新选择');
      const p=value?{x:row.position.x+delta.x,y:row.position.y+delta.y,alignment:row.position.alignment}:null;
      // Retain a legacy pair's layout basis without changing its unselected
      // partner or turning that partner into an individually positioned cue.
      const previous=cue.subtitle_position,base=previous?.alignment?previous.base:previous;
      if(p&&base)p.base=structuredClone(base);
      if(p&&delta.x===0&&delta.y===0)continue;
      if(p){cue.subtitle_position=p;changed=true;}
      else if(cue.subtitle_position){delete cue.subtitle_position;changed=true;}
    }
    if(!changed)return false;
    fixedTrackCore.validate(next);fixedTrackCore.assertLocks(DATA,next);
    pushUndo(value?'调整所选字幕位置':'字幕跟随轨道位置',{captureView:true});
    const current=fixedTrackCore.createIndex(DATA);
    for(const row of rows){const cue=current.resolve(row).cue,p=index.resolve(row).cue.subtitle_position;if(p)cue.subtitle_position=structuredClone(p);else delete cue.subtitle_position;}
    fixedPreviewInvalidate();projectImportDirty=true;fixedStatus();renderAll({waveform:'full'});scheduleAutoSaveFlush();
    window.dispatchEvent(new Event('msw:burn-style'));return true;
  }catch(error){fixedPositionNotice=error.message;fixedStatus(error.message);refreshSubtitlePreview();return false;}
}
function fixedPositionDragAffects(entry) {
  return fixedPositionDrag&&(fixedPositionDrag.rows?fixedPositionDrag.ids.has(entry.cue_id):fixedPositionDrag.groupIds.has(entry.group.id));
}
function fixedApplyPositionOffsets(layout) {
  const exact=window.MSWSubtitleRenderer;if(!exact?.applyPositionOffsets||exact.status!=='libass')return;
  if(fixedPositionHold?.revision!==exact.revision)fixedPositionHold=null;
  const keys=new Map(exact.geometry.map(r=>[JSON.parse(r.key)[2],r.key]));
  const offsets=fixedPositionDrag?new Map(layout.entries.filter(fixedPositionDragAffects).map(r=>[keys.get(r.cue_id)||r.key,{x:fixedPositionDrag.dx,y:fixedPositionDrag.dy}])):fixedPositionHold?.offsets||new Map();
  const key=JSON.stringify([exact.revision,[...offsets]]);if(key===fixedPositionOffsetsKey)return;
  fixedPositionOffsetsKey=key;void exact.applyPositionOffsets(offsets).catch(()=>{});
}
function fixedStopPositioning() {
  fixedPositionEditing=false;fixedPositionDrag=null;fixedPreviewInvalidate();
  window.dispatchEvent(new Event('msw:burn-style'));refreshSubtitlePreview();
}
function fixedPositionFeedback(layout,time) {
  let tools=document.getElementById('fixed-position-toolbar');
  if(!tools){
    tools=document.createElement('div');tools.id='fixed-position-toolbar';
    tools.innerHTML='<select aria-label="画面定位对象"><option value="track">轨道默认</option><option value="cue">所选字幕</option></select><span id="fixed-position-message" role="status"></span><button type="button">完成定位</button>';
    tools.querySelector('select').onchange=event=>{fixedPositionScope=event.target.value;fixedPositionNotice='';refreshSubtitlePreview();};
    tools.querySelector('button').onclick=fixedStopPositioning;playerStage.before(tools);
  }
  tools.hidden=!fixedPositionEditing;
  if(!fixedPositionEditing)return;
  tools.querySelector('select').value=fixedPositionScope;
  tools.querySelector('option[value="track"]').disabled=productionFlatMode()&&fixedTrackCore.placement(fixedStyleTarget()||{})!=='fixed';
  const display=fixedPositionDrag?{...layout,entries:layout.entries.map(e=>fixedPositionDragAffects(e)?{...e,x:e.x+fixedPositionDrag.dx,y:e.y+fixedPositionDrag.dy}:e)}:layout;
  const issues=window.MSWTrackPresentation.warnings(display,time);
  const note=issues.some(i=>i.type==='outside')?'字幕超出画面，请调整位置':issues.length?'字幕发生重叠，可拖动字幕避让':'拖动字幕定位 · Esc 取消本次拖动';
  const track=fixedStyleTarget(),label=productionFlatMode()&&fixedPositionScope==='cue'?fixedPositionSelectionLabel():track?.name||'字幕';
  document.getElementById('fixed-position-message').textContent=`${label} · ${fixedPositionNotice||note}`;
}
function fixedStartPositioning() {
  if(productionFlatMode()&&fixedPositionScope==='cue') {
    const rows=fixedPositionSelection();if(!rows.length||rows.some(r=>!r.entry||fixedTrack(r.cue,r.role,r.track_id)?.locked))return;
    fixedPositionEditing=true;fixedPositionNotice='';fixedPreviewInvalidate();player.pause();
    const now=player.currentTime*1000;if(!rows.some(r=>r.cue.start<=now&&now<r.cue.end))player.currentTime=rows[0].cue.start/1000;
    setSubtitlePreviewSettingsPanelOpen(false);window.dispatchEvent(new Event('msw:burn-style'));refreshSubtitlePreview();return;
  }
  const track=fixedStyleTarget();if(!track||fixedTrackCore.placement(track)!=='fixed'||track.locked||!fixedPresentationMode())return;
  const role=currentCuePanelKind==='extension'?'extension':'main',source=role==='main'?DATA.segments:getExtensionTrack(currentCuePanelTrackId)?.segments||[];
  const cue=source[currentCuePanelIdx];
  if(cue&&fixedOwner(cue,role,currentCuePanelTrackId)===track.id)fixedPositionRef=fixedRef(cue,role,currentCuePanelTrackId);
  const now=player.currentTime*1000,groups=fixedPreviewLayout().layout.groups.filter(g=>g.kind==='annotation'&&g.trackId===track.id);
  const chosen=fixedSelectedPositionGroup()||groups.find(g=>g.rows.some(r=>r.cue.start<=now&&now<r.cue.end))||groups[0];
  if(chosen){fixedPositionRef=fixedRef(chosen.rows[0].cue,chosen.rows[0].role,chosen.rows[0].track_id);if(!chosen.rows.some(r=>r.cue.start<=now&&now<r.cue.end))player.currentTime=chosen.start/1000;}
  fixedPositionEditing=true;fixedPositionNotice='';player.pause();setSubtitlePreviewSettingsPanelOpen(false);refreshSubtitlePreview();
}
function fixedInstallPositionDrag(root) {
  root.addEventListener('pointerdown',event=>{
    const node=event.target.closest('.annotation,.position-target');if(!fixedPositionEditing||event.button!==0||!node)return;
    if(productionFlatMode()&&fixedPositionScope==='cue') {
      const rows=fixedPositionSelection();if(!rows.some(r=>r.cue_id===node.dataset.cueId)||rows.some(r=>!r.position||fixedTrack(r.cue,r.role,r.track_id)?.locked))return;
      event.preventDefault();event.stopPropagation();player.pause();
      fixedPositionDrag={pointerId:event.pointerId,x:event.clientX,y:event.clientY,start:rows[0].position,rect:fixedVideoRect(),rows,ids:new Set(rows.map(r=>r.cue_id)),dx:0,dy:0};
      root.setPointerCapture(event.pointerId);refreshSubtitlePreview();return;
    }
    const {layout}=fixedPreviewLayout(),group=layout.groups.find(g=>g.id===node.dataset.groupId),track=DATA.subtitle_tracks.tracks.find(t=>t.id===group.trackId);
    event.preventDefault();event.stopPropagation();
    if(track.locked){fixedPositionNotice='轨道已锁定，请先解锁';refreshSubtitlePreview();return;}
    if(fixedPositionScope==='track'&&group.rows.some(r=>r.cue.subtitle_position)) {
      fixedPositionNotice='此字幕已单独定位，请切换“当前字幕位置”后调整';refreshSubtitlePreview();return;
    }
    fixedPositionNotice='';
    player.pause();
    fixedStyleTrackId=track.id;
    const row=group.rows.find(r=>r.cue_id===node.dataset.cueId&&r.role===node.dataset.role)||group.rows[0];fixedPositionRef=fixedRef(row.cue,row.role,row.track_id);
    const start=fixedPositionCurrent(),rect=fixedVideoRect();
    const groupIds=new Set((fixedPositionScope==='track'?layout.groups.filter(g=>g.trackId===track.id&&!g.rows.some(r=>r.cue.subtitle_position)):[group]).map(g=>g.id));
    fixedPositionDrag={pointerId:event.pointerId,x:event.clientX,y:event.clientY,start,rect,groupIds,dx:0,dy:0,value:start};root.setPointerCapture(event.pointerId);
    refreshSubtitlePreview();
  });
  root.addEventListener('pointermove',event=>{
    const drag=fixedPositionDrag;if(!drag||event.pointerId!==drag.pointerId)return;
    if(drag.rows) {
      const delta=fixedPositionDelta(drag.rows,{x:drag.start.x+(event.clientX-drag.x)/drag.rect.width,y:drag.start.y+(event.clientY-drag.y)/drag.rect.height});
      drag.value={x:drag.start.x+delta.x,y:drag.start.y+delta.y};drag.dx=delta.x*drag.rect.referenceWidth;drag.dy=delta.y*1080;refreshSubtitlePreview();return;
    }
    const x=Math.max(0,Math.min(1,drag.start.x+(event.clientX-drag.x)/drag.rect.width));
    const y=Math.max(0,Math.min(1,drag.start.y+(event.clientY-drag.y)/drag.rect.height));
    drag.value={x,y};drag.dx=(x-drag.start.x)*drag.rect.referenceWidth;drag.dy=(y-drag.start.y)*1080;refreshSubtitlePreview();
  });
  const end=(event,cancel=false)=>{
    const drag=fixedPositionDrag;if(!drag)return;fixedPositionDrag=null;
    if(root.hasPointerCapture(drag.pointerId))root.releasePointerCapture(drag.pointerId);
    if(!cancel&&(drag.dx||drag.dy)) {
      const exact=window.MSWSubtitleRenderer;
      // Keep the precise moved frame until the newly committed ASS arrives.
      if(exact?.status==='libass')fixedPositionHold={revision:exact.revision,offsets:new Map(exact.geometry.filter(r=>drag.rows?drag.ids.has(JSON.parse(r.key)[2]):fixedPreviewLayout().layout.entries.some(e=>e.cue_id===JSON.parse(r.key)[2]&&drag.groupIds.has(e.group.id))).map(r=>[r.key,{x:drag.dx,y:drag.dy}]))};
      const saved=drag.rows?fixedCommitSelectedPosition(drag.value,drag.rows):fixedCommitPosition(drag.value);
      if(!saved)fixedPositionHold=null;
    }else fixedPositionHold=null;
    refreshSubtitlePreview();
  };
  root.addEventListener('pointerup',event=>end(event));root.addEventListener('pointercancel',event=>end(event,true));
  root.addEventListener('click',event=>{if(fixedPositionEditing){event.preventDefault();event.stopPropagation();}});
}
document.addEventListener('keydown',event=>{
  if(event.key!=='Escape'||!fixedPositionEditing)return;
  event.preventDefault();event.stopImmediatePropagation();
  if(fixedPositionDrag){const root=document.getElementById('fixed-subtitle-preview'),id=fixedPositionDrag.pointerId;fixedPositionDrag=null;if(root?.hasPointerCapture(id))root.releasePointerCapture(id);}else fixedStopPositioning();refreshSubtitlePreview();
},true);
document.addEventListener('input',event=>{if(event.target.matches('textarea,[contenteditable="true"]'))fixedPreviewInvalidate();},true);
window.addEventListener('msw:project-changed',()=>{fixedStyleTrackId='';fixedPositionRef=null;fixedPositionEditing=false;fixedPositionDrag=null;fixedPositionHold=null;fixedPositionOffsetsKey='';fixedPositionNotice='';fixedTextMeasures.clear();fixedPreviewInvalidate();});
window.addEventListener('msw:burn-style',fixedPreviewInvalidate);
document.fonts?.addEventListener('loadingdone',()=>{fixedTextMeasures.clear();fixedPreviewInvalidate();if(fixedPresentationMode())refreshSubtitlePreview();});
document.addEventListener('DOMContentLoaded',()=>{new ResizeObserver(()=>{if(fixedPresentationMode())refreshSubtitlePreview();}).observe(playerStage);});
