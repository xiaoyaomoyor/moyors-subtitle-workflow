// Fixed-track browser presentation. Geometry is in video-content 1080p units.
let fixedPreviewCache = null;
let fixedExactGeometry = null;
let fixedGeometrySerial=0;
function fixedGeometryKey() { return JSON.stringify([mswProjectGeneration,DATA.segments,DATA.multi_subtitle,DATA.subtitle_tracks,window.MSWSubtitleStyle?.currentPreview(),getSpeakerLabelSettings()]); }
function fixedReceiveGeometry(geometry) { fixedExactGeometry={key:fixedGeometryKey(),serial:++fixedGeometrySerial,rows:geometry};fixedPreviewCache=null;refreshSubtitlePreview(); }
const fixedTextMeasures = new Map();
let fixedMeasureRoot = null;
let fixedStyleTrackId = '';
let fixedPositionScope = 'track';
let fixedPositionRef = null;
let fixedPositionEditing = false;
let fixedPositionDrag = null;
let fixedPositionNotice = '';
function fixedPresentationMode() { return fixedTrackMode() && DATA.subtitle_tracks.presentation === 'fixed'; }
function fixedPreviewInvalidate() { fixedPreviewCache = null; }
function fixedStyleTarget() { return DATA.subtitle_tracks?.tracks.find(t => t.id === fixedStyleTrackId) || null; }
function fixedStyleValue() { return window.MSWTrackPresentation.styleFor(DATA, fixedStyleTarget() || {style:{mode:'inherit'}}); }
function fixedCommitStyle(style, selection) {
  const track=fixedStyleTarget(); if(!track)return false;
  const next=fixedContent(), target=next.subtitle_tracks.tracks.find(t=>t.id===track.id);
  const value=window.MSWProjectStyle.normalize(style);
  const custom=selection==='current'?value:track.style.custom || fixedStyleValue();
  target.style=selection==='inherit'?{mode:'inherit',custom}:{mode:'snapshot',value,selection,custom};
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
        Object.assign(entry,{x:exact.x,y:exact.y,width:exact.width,height:exact.height});
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
  playerStage.classList.toggle('fixed-position-drag',!!fixedPositionDrag);
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
    if(fixedPositionDrag?.groupIds.has(entry.group.id)){dx+=fixedPositionDrag.dx;dy+=fixedPositionDrag.dy;}
    Object.assign(element.style,{left:entry.x+dx+'px',top:entry.y+dy+'px',width:entry.width+'px',height:entry.height+'px'});
    const selected=fixedPositionScope==='track'?entry.group.trackId===fixedStyleTrackId:entry.group.rows.some(r=>fixedTrackCore.key(r)===fixedTrackCore.key(fixedPositionRef||{}));
    element.classList.toggle('selected-position',fixedPositionEditing&&selected);
    element.classList.toggle('annotation',entry.group.kind==='annotation');
    element.dataset.groupId=entry.group.id;element.dataset.trackId=entry.group.trackId;
  }
  fixedPositionFeedback(layout,tMs);renderStickerOverlay(tMs);
}
function fixedSelectedPositionGroup() {
  if(!fixedPresentationMode())return null;
  const {layout}=fixedPreviewLayout();
  return fixedPositionRef?layout.groups.find(g=>g.rows.some(r=>fixedTrackCore.key(r)===fixedTrackCore.key(fixedPositionRef))):null;
}
function fixedPositionCurrent() {
  const group=fixedSelectedPositionGroup(),track=fixedStyleTarget();
  return fixedPositionScope==='cue'?(group?.rows.find(r=>r.cue.subtitle_position)?.cue.subtitle_position||track?.position||{x:.5,y:.08}):track?.position||{x:.5,y:.08};
}
function fixedCommitPosition(value) {
  const track=fixedStyleTarget();if(!track||track.kind!=='annotation')return false;
  if(pendingLinkedSplit){fixedStatus('请先确认或取消当前切分');return false;}
  try {
    if(track.locked)throw Error('轨道已锁定，请先解锁');
    const next=fixedContent();
    if(fixedPositionScope==='track') {
      const target=next.subtitle_tracks.tracks.find(t=>t.id===track.id);
      if(value)target.position=value;else delete target.position;
    } else {
      if(!fixedPositionRef)throw Error('请先在播放器中选择画面文字');
      const refs=fixedTrackCore.boundRefs(next,[fixedPositionRef]);fixedTrackCore.assertEditable(next,refs);
      const index=fixedTrackCore.createIndex(next);
      for(const ref of refs){const cue=index.resolve(ref).cue;if(value)cue.subtitle_position=value;else delete cue.subtitle_position;}
    }
    fixedTrackCore.validate(next);fixedTrackCore.assertLocks(DATA,next);
    commitProcessingEdits();pushUndo(fixedPositionScope==='track'?'调整注释轨道位置':'调整当前注释位置',{captureView:true});
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
function fixedPositionFeedback(layout,time) {
  let tools=document.getElementById('fixed-position-toolbar');
  if(!tools){
    tools=document.createElement('div');tools.id='fixed-position-toolbar';
    tools.innerHTML='<select aria-label="画面定位对象"><option value="track">轨道位置</option><option value="cue">当前字幕位置</option></select><span id="fixed-position-message" role="status"></span><button type="button">完成定位</button>';
    tools.querySelector('select').onchange=event=>{fixedPositionScope=event.target.value;fixedPositionNotice='';refreshSubtitlePreview();};
    tools.querySelector('button').onclick=()=>{fixedPositionEditing=false;fixedPositionDrag=null;refreshSubtitlePreview();};playerStage.before(tools);
  }
  tools.hidden=!fixedPositionEditing;
  if(!fixedPositionEditing)return;
  tools.querySelector('select').value=fixedPositionScope;
  const display=fixedPositionDrag?{...layout,entries:layout.entries.map(e=>fixedPositionDrag.groupIds.has(e.group.id)?{...e,x:e.x+fixedPositionDrag.dx,y:e.y+fixedPositionDrag.dy}:e)}:layout;
  const issues=window.MSWTrackPresentation.warnings(display,time);
  const note=issues.some(i=>i.type==='outside')?'字幕超出画面，请调整位置':issues.length?'字幕发生重叠，可拖动注释避让':'拖动画面文字定位 · Esc 取消本次拖动';
  const track=fixedStyleTarget();document.getElementById('fixed-position-message').textContent=`${track?.name||'画面文字'} · ${fixedPositionNotice||note}`;
}
function fixedStartPositioning() {
  const track=fixedStyleTarget();if(!track||track.kind!=='annotation'||track.locked||!fixedPresentationMode())return;
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
    const node=event.target.closest('.annotation');if(!fixedPositionEditing||event.button!==0||!node)return;
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
    const x=Math.max(0,Math.min(1,drag.start.x+(event.clientX-drag.x)/drag.rect.width));
    const y=Math.max(0,Math.min(1,drag.start.y+(event.clientY-drag.y)/drag.rect.height));
    drag.value={x,y};drag.dx=(x-drag.start.x)*drag.rect.referenceWidth;drag.dy=(y-drag.start.y)*1080;refreshSubtitlePreview();
  });
  const end=(event,cancel=false)=>{
    const drag=fixedPositionDrag;if(!drag)return;fixedPositionDrag=null;
    if(root.hasPointerCapture(drag.pointerId))root.releasePointerCapture(drag.pointerId);
    if(!cancel&&(drag.dx||drag.dy))fixedCommitPosition(drag.value);refreshSubtitlePreview();
  };
  root.addEventListener('pointerup',event=>end(event));root.addEventListener('pointercancel',event=>end(event,true));
  root.addEventListener('click',event=>{if(fixedPositionEditing){event.preventDefault();event.stopPropagation();}});
}
document.addEventListener('keydown',event=>{
  if(event.key!=='Escape'||!fixedPositionEditing)return;
  event.preventDefault();event.stopImmediatePropagation();
  if(fixedPositionDrag){fixedPositionDrag=null;}else fixedPositionEditing=false;refreshSubtitlePreview();
},true);
document.addEventListener('input',event=>{if(event.target.matches('textarea,[contenteditable="true"]'))fixedPreviewInvalidate();},true);
window.addEventListener('msw:project-changed',()=>{fixedStyleTrackId='';fixedPositionRef=null;fixedPositionEditing=false;fixedPositionDrag=null;fixedPositionNotice='';fixedTextMeasures.clear();fixedPreviewInvalidate();});
window.addEventListener('msw:burn-style',fixedPreviewInvalidate);
document.fonts?.addEventListener('loadingdone',()=>{fixedTextMeasures.clear();fixedPreviewInvalidate();if(fixedPresentationMode())refreshSubtitlePreview();});
document.addEventListener('DOMContentLoaded',()=>{new ResizeObserver(()=>{if(fixedPresentationMode())refreshSubtitlePreview();}).observe(playerStage);});
