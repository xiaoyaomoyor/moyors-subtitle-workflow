// Fixed-track browser presentation. Geometry is in video-content 1080p units.
let fixedPreviewCache = null;
let fixedExactGeometry = null;
let fixedGeometrySerial=0;
function fixedGeometryKey() { const preview=window.MSWSubtitleStyle?.currentPreview();return JSON.stringify([mswProjectGeneration,DATA.segments,DATA.multi_subtitle,DATA.subtitle_tracks,preview&&{style:preview.style,target:preview.target,scope:preview.scope,trackIds:preview.trackIds},getSpeakerLabelSettings()]); }
function fixedReceiveGeometry(geometry) {
  if(productionFlatMode()) {
    const refs=new Map(layerCore.tracks(DATA).flatMap(s=>s.segments.map(c=>[c.id,fixedTrackCore.key({role:s.role,track_id:s.track_id,cue_id:c.id})])));
    geometry=geometry.map(r=>({...r,key:refs.get(JSON.parse(r.key)[2])||r.key}));
  }
  fixedExactGeometry={key:fixedGeometryKey(),serial:++fixedGeometrySerial,rows:geometry};fixedPreviewCache=null;
  if(fixedPositionSession?.rows&&!fixedPositionDrag&&!fixedPositionSession.dx&&!fixedPositionSession.dy) {
    const rows=fixedPositionSelection();
    if(rows.length&&rows.every(r=>r.position))Object.assign(fixedPositionSession,{rows,start:{...rows[0].position},value:{...rows[0].position}});
  }
  refreshSubtitlePreview();
  if(!document.activeElement?.matches('#style-position-x,#style-position-y'))window.MSWSubtitleStyle?.syncPosition();
}
const fixedTextMeasures = new Map();
let fixedMeasureRoot = null;
let fixedStyleTrackId = '';
let fixedPositionScope = 'track';
let fixedPositionRef = null;
let fixedPositionEditing = false;
let fixedPositionSession = null;
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
  if(fixedPositionEditing)fixedStopPositioning(false);
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
  if(style.latinFontName)node.replaceChildren(...window.MSWProjectStyle.characters(text).map(unit=>{
    const span=document.createElement('span');span.textContent=unit;span.style.fontFamily=subtitleFontFamilyCss(window.AsrEditorUtils.assTextFont(unit,style));return span;
  }));
  const metrics={resolution:{width,height:1080},stageWidth:width,stageHeight:1080,scaleX:1,scaleY:1};
  applyAssPreviewElement(node,style,{opacity:1},metrics,{x:0,y:0},{left:style.marginL,right:style.marginR});
  const padding=(Math.max(0,style.outline)+Math.max(0,style.shadow))*Math.max(1,(style.scaleX||100)/100,(style.scaleY||100)/100);
  const background=window.MSWSubtitleBackground,bg=background.enabled(style);
  const maxWidth=Math.max(1,(width-style.marginL-style.marginR-2*(padding+(bg?style.backgroundPaddingX:0)))/Math.max(.01,(style.scaleX||100)/100));
  Object.assign(node.style,{width:'max-content',maxWidth:maxWidth+'px',
    textAlign:['left','center','right'][((style.alignment||2)-1)%3],whiteSpace:'pre-wrap',overflowWrap:'anywhere'});
  fixedMeasureRoot.replaceChildren(node);
  const rect=node.getBoundingClientRect(),root=fixedMeasureRoot.getBoundingClientRect();
  const result={width:rect.width+2*padding,height:rect.height+2*padding,css:node.style.cssText,text,prefix,maxWidth,
    innerX:padding-(rect.left-root.left),innerY:padding-(rect.top-root.top),padding,
    textWidth:node.offsetWidth*style.scaleX/100,textHeight:node.offsetHeight*style.scaleY/100};
  if(bg) {
    const b=background.bounds(style,result,style.alignment);
    result.width=b.width;result.height=b.height;
  }
  fixedMeasureRoot.replaceChildren();
  if(fixedTextMeasures.size>=3000)fixedTextMeasures.clear();fixedTextMeasures.set(key,result);return result;
}
function fixedPreviewLayout(rect=fixedVideoRect()) {
  const preview=window.MSWSubtitleStyle?.currentPreview(),proof=preview?.scope==='proof'||preview?.other?preview.style:null;
  const key=JSON.stringify([rect.referenceWidth,getActiveExtensionTrack()?.id,proof,preview?.scope,preview?.trackIds,DATA.preview?.project_style,getSpeakerLabelSettings(),fixedExactGeometry?.serial]);
  if(!fixedPreviewCache||fixedPreviewCache.key!==key) {
    const project=preview?.scope==='export'&&productionFlatMode()?MSWProductionProject.fromProject(MSWProductionProject.exportScope(DATA,preview.trackIds)):DATA;
    const layout=window.MSWTrackPresentation.layout(project,{width:rect.referenceWidth,languageId:getActiveExtensionTrack()?.id,
      measure:fixedMeasureText,resolveStyle:track=>window.MSWTrackPresentation.styleFor(project,track,proof)});
    if(fixedExactGeometry?.key===fixedGeometryKey()) {
      const measured=new Map(fixedExactGeometry.rows.map(r=>[r.key,r]));
      for(const entry of layout.entries) {
        const exact=measured.get(entry.key);if(!exact)continue;
        Object.assign(entry,{x:exact.x,y:exact.y,width:exact.width,height:exact.height,position:exact.position});
        if(exact.backgroundSize)Object.assign(entry.size,exact.backgroundSize);
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
    if(text.childNodes.length!==2||text.lastChild.nodeType!==Node.TEXT_NODE)text.replaceChildren(document.createElement('span'),document.createTextNode(''));
    const speaker=text.firstElementChild;
    if(speaker.textContent!==size.prefix)speaker.textContent=size.prefix;
    if(text.lastChild.nodeValue!==size.text.slice(size.prefix.length))text.lastChild.nodeValue=size.text.slice(size.prefix.length);
    text.style.cssText=size.css;
    const segments=entry.role==='main'?DATA.segments:getExtensionTrack(entry.track_id)?.segments||[];
    const variant=assPreviewStyleVariant(style,entry.cue,segments,getSubtitleAppearance());
    for(const key of ['primaryColor','outlineColor'])if(entry.cue.subtitle_style?.[key])variant[key]=entry.cue.subtitle_style[key];
    const paletteColor=COLOR_BY_NAME[MULTI_SUBTITLE_UTILS.effectiveColorName(entry.cue,segments)]?.value;
    speaker.style.color=['text','speaker'].includes(getSubtitleAppearance().ass_color_style||DEFAULT_ASS_COLOR_STYLE)?paletteColor||'':'';
    const profile={animations:entry.animations};
    const motion=entry.motion?window.MSWSubtitleAnimation.sample(entry.motion,tMs-entry.cue.start,entry.cue.end-entry.cue.start,window.MSWProjectStyle.characters(size.text).filter(c=>c.trim()).length):null;
    const animation=motion?{opacity:motion.opacity,transformProgress:null}:window.AsrEditorUtils.assPreviewAnimationState(profile,tMs-entry.cue.start,entry.cue.end-entry.cue.start,
      {playResX:rect.referenceWidth,playResY:1080,stageWidth:rect.referenceWidth,stageHeight:1080});
    const animated=motion?{...variant,scaleX:variant.scaleX*motion.scale/100,scaleY:variant.scaleY*motion.scale/100,angle:variant.angle+motion.rotation}:assPreviewAnimatedStyle(variant,profile,animation);
    applyAssPreviewElement(text,animated,animation,metrics,{x:0,y:0},{left:style.marginL,right:style.marginR});
    const gradient=window.MSWSubtitleGradient.enabled(style);
    if(motion||gradient||style.latinFontName){
      text.replaceChildren();let seen=0,prefix=0;
      const units=window.MSWProjectStyle.characters(size.text),count=units.filter(u=>u.trim()).length;
      for(const unit of units){
        if(unit.trim())seen++;const span=document.createElement('span');span.textContent=unit;
        if(style.latinFontName)span.style.fontFamily=subtitleFontFamilyCss(window.AsrEditorUtils.assTextFont(unit,style));
        if(motion&&seen>motion.revealed)span.style.visibility='hidden';
        if(gradient)span.style.color=window.MSWSubtitleGradient.color(style,seen-1,count);
        else if(prefix<size.prefix.length)span.style.color=speaker.style.color;
        text.append(span);if(unit!=='\n')prefix+=unit.length;
      }
    }
    Object.assign(text.style,{position:'absolute',left:size.innerX+'px',top:size.innerY+'px',maxWidth:size.maxWidth+'px'});
    let backdrop=element.querySelector('.fixed-subtitle-background');
    if(window.MSWSubtitleBackground.enabled(style)) {
      if(!backdrop){backdrop=document.createElement('div');backdrop.className='fixed-subtitle-background';element.append(backdrop);}
      const p=window.MSWTrackPresentation.positionOf(entry,rect.referenceWidth),b=window.MSWSubtitleBackground.box(style,size,p.alignment);
      const ax=p.x*rect.referenceWidth-entry.x,ay=p.y*1080-entry.y,scale=motion?.scale/100||1,angle=animated.angle||0;
      Object.assign(backdrop.style,{left:ax+b.x+'px',top:ay+b.y+'px',width:b.width+'px',height:b.height+'px',
        background:style.backgroundColor,opacity:style.backgroundOpacity/100*animation.opacity,
        borderRadius:style.backgroundShape==='rounded'?Math.min(style.backgroundRadius,b.width/2,b.height/2)+'px':'0',
        transformOrigin:`${-b.x}px ${-b.y}px`,transform:`rotate(${-angle}deg) scale(${scale})`});
      // Keep the CSS fallback anchored to the same point while exact ASS loads.
      const horizontal=(p.alignment-1)%3,vertical=Math.floor((p.alignment-1)/3);
      Object.assign(text.style,{left:ax-horizontal*size.textWidth/2+'px',top:ay-(2-vertical)*size.textHeight/2+'px',
        transformOrigin:`${horizontal*50}% ${(2-vertical)*50}%`});
    } else backdrop?.remove();
    let dx=motion?.x||0,dy=motion?.y||0;
    if(!motion&&profile.animations.move?.enabled){dx=(animation.moveX||0)-profile.animations.move.x1;dy=(animation.moveY||0)-profile.animations.move.y1;}
    if(fixedPositionDragAffects(entry)){const offset=fixedPositionDrag||fixedPositionSession;dx+=offset.dx;dy+=offset.dy;}
    Object.assign(element.style,{left:entry.x+dx+'px',top:entry.y+dy+'px',width:entry.width+'px',height:entry.height+'px'});
    const selected=fixedPositionScope==='track'?(productionFlatMode()?entry.subtitle_track_id:entry.group.trackId)===fixedStyleTrackId:productionFlatMode()?fixedPositionSelectedIds().has(entry.cue_id):entry.group.rows.some(r=>fixedTrackCore.key(r)===fixedTrackCore.key(fixedPositionRef||{}));
    element.classList.toggle('selected-position',fixedPositionEditing&&selected);
    element.classList.toggle('annotation',entry.group.kind==='annotation');
    element.classList.toggle('position-target',fixedPositionEditing&&selected);
    element.dataset.groupId=entry.group.id;element.dataset.trackId=entry.group.trackId;
  }
  fixedApplyPositionOffsets(layout);renderStickerOverlay(tMs);
}
function fixedSelectedPositionGroup() {
  if(!fixedPresentationMode())return null;
  const {layout}=fixedPreviewLayout();
  return fixedPositionRef?layout.groups.find(g=>g.rows.some(r=>fixedTrackCore.key(r)===fixedTrackCore.key(fixedPositionRef))):null;
}
function fixedPositionCurrent() {
  if(fixedPositionSession) {
    const session=fixedPositionDrag||fixedPositionSession;
    if(session.rows)return Object.fromEntries(['x','y'].map(k=>[k,session.rows.every(r=>Math.abs(r.position[k]-session.start[k])<.00001)?session.value[k]:null]));
    return session.value;
  }
  if(productionFlatMode()&&fixedPositionScope==='cue') {
    const rows=fixedPositionSelection(),values=rows.map(r=>r.position).filter(Boolean);
    return Object.fromEntries(['x','y'].map(k=>[k,values.length&&values.every(p=>Math.abs(p[k]-values[0][k])<.00001)?values[0][k]:null]));
  }
  const group=fixedSelectedPositionGroup(),track=fixedStyleTarget();
  if(productionFlatMode()&&fixedPositionScope==='track'&&track&&fixedTrackCore.placement(track)==='auto') {
    const {layout}=fixedPreviewLayout(),now=player.currentTime*1000;
    const entries=layout.entries.filter(e=>e.subtitle_track_id===track.id&&!e.cue.subtitle_position);
    const entry=entries.find(e=>e.cue.start<=now&&now<e.cue.end)||entries[0];
    // Track coordinates anchor the top centre of its text block. Start from
    // its actual automatic placement so typing one axis does not jump the other.
    if(entry)return {x:Math.max(0,Math.min(1,(entry.x+entry.width/2)/layout.width)),y:Math.max(0,Math.min(1,entry.y/1080))};
    const style=window.MSWTrackPresentation.styleFor(DATA,track)[track.flat_style_slot||'main'],a=style.alignment||2;
    return {x:((a-1)%3)/2,y:Math.floor((a-1)/3)===2?style.marginV/1080:Math.floor((a-1)/3)===1?.5:1-style.marginV/1080};
  }
  return fixedPositionScope==='cue'?(group?.rows.find(r=>r.cue.subtitle_position)?.cue.subtitle_position||track?.position||{x:.5,y:.08}):track?.position||{x:.5,y:.08};
}
function fixedCommitPosition(value) {
  if(fixedPositionSession)return value?fixedStagePosition(value):false;
  if(productionFlatMode()&&fixedPositionScope==='cue')return fixedCommitSelectedPosition(value);
  const track=fixedStyleTarget();if(!track||!fixedPresentationMode())return false;
  if(pendingLinkedSplit){fixedStatus('请先确认或取消当前切分');return false;}
  try {
    if(track.locked)throw Error('轨道已锁定，请先解锁');
    const next=fixedContent();
    if(fixedPositionScope==='track') {
      const target=next.subtitle_tracks.tracks.find(t=>t.id===track.id);
      if(value){target.position=value;target.layout='fixed';}
      else {delete target.position;target.layout='auto';}
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
  } catch(error){fixedStatus(error.message);return false;}
}
// Position scope follows the actual editor selection, never related-only highlights.
function fixedPositionSelectedIds() {
  const selection=processingSelection();return new Set([...selection.mainIds,...selection.extensionIds]);
}
function fixedPositionPreviewActive() {
  return productionFlatMode()&&(fixedPositionEditing||fixedPositionScope==='cue'
    &&document.getElementById('style-more')?.open
    &&window.MSWSubtitleStyle?.propertiesVisible());
}
function fixedSchedulePositionSelectionSync() {
  if(fixedSchedulePositionSelectionSync.pending)return;
  fixedSchedulePositionSelectionSync.pending=true;
  queueMicrotask(()=>{
    fixedSchedulePositionSelectionSync.pending=false;
    if(!productionFlatMode())return;
    if(fixedPositionSession?.rows) {
      const ids=fixedPositionSelectedIds();
      if(ids.size!==fixedPositionSession.ids.size||[...ids].some(id=>!fixedPositionSession.ids.has(id)))fixedStopPositioning(false);
    }
    window.MSWSubtitleStyle?.syncSelection();
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
  const offset=fixedPositionDrag||fixedPositionSession;
  return offset&&(offset.rows||productionFlatMode()?offset.ids.has(entry.cue_id):offset.groupIds.has(entry.group.id));
}
function fixedApplyPositionOffsets(layout) {
  const exact=window.MSWSubtitleRenderer;if(!exact?.applyPositionOffsets||exact.status!=='libass')return;
  if(fixedPositionHold?.revision!==exact.revision)fixedPositionHold=null;
  const keys=new Map(exact.geometry.map(r=>[JSON.parse(r.key)[2],r.key]));
  const offset=fixedPositionDrag||fixedPositionSession;
  const offsets=offset?new Map(layout.entries.filter(fixedPositionDragAffects).map(r=>[keys.get(r.cue_id)||r.key,{x:offset.dx,y:offset.dy}])):fixedPositionHold?.offsets||new Map();
  const key=JSON.stringify([exact.revision,[...offsets]]);if(key===fixedPositionOffsetsKey)return;
  fixedPositionOffsetsKey=key;void exact.applyPositionOffsets(offsets).catch(()=>{});
}
function fixedStopPositioning(commit=true) {
  const session=fixedPositionDrag||fixedPositionSession,root=document.getElementById('fixed-subtitle-preview'),id=fixedPositionDrag?.pointerId;
  fixedPositionEditing=false;fixedPositionSession=null;fixedPositionDrag=null;fixedPositionHold=null;
  if(id!==undefined&&root?.hasPointerCapture(id))root.releasePointerCapture(id);
  if(commit&&session&&(session.dx||session.dy)) {
    const exact=window.MSWSubtitleRenderer;
    if(exact?.status==='libass')fixedPositionHold={revision:exact.revision,offsets:new Map(exact.geometry.filter(r=>session.ids.has(JSON.parse(r.key)[2])).map(r=>[r.key,{x:session.dx,y:session.dy}]))};
    const saved=session.rows?fixedCommitSelectedPosition(session.value,session.rows):fixedCommitPosition(session.value);
    if(!saved)fixedPositionHold=null;
  }
  fixedPreviewInvalidate();window.MSWSubtitleStyle?.syncPosition();
  window.dispatchEvent(new Event('msw:burn-style'));refreshSubtitlePreview();
}
function fixedStagePosition(value) {
  const s=fixedPositionSession;if(!s)return false;
  const delta=s.rows?fixedPositionDelta(s.rows,value):Object.fromEntries(['x','y'].map(k=>[k,value[k]===undefined?0:Math.max(0,Math.min(1,value[k]))-s.start[k]]));
  for(const k of ['x','y'])if(value[k]!==undefined)s.value[k]=s.rows?s.start[k]+delta[k]:Math.max(0,Math.min(1,value[k]));
  s.dx=(s.value.x-s.start.x)*s.rect.referenceWidth;s.dy=(s.value.y-s.start.y)*1080;
  window.MSWSubtitleStyle?.syncPosition();refreshSubtitlePreview();return true;
}
function fixedBeginPositionSession() {
  fixedPositionEditing=true;fixedPositionNotice='';fixedPreviewInvalidate();
  const {layout}=fixedPreviewLayout(),rows=productionFlatMode()&&fixedPositionScope==='cue'?fixedPositionSelection():null;
  const start=rows?rows[0].position:fixedPositionCurrent(),group=fixedSelectedPositionGroup();
  const groups=fixedPositionScope==='track'?layout.groups.filter(g=>g.trackId===fixedStyleTrackId&&!g.rows.some(r=>r.cue.subtitle_position)):[group].filter(Boolean);
  const groupIds=new Set(groups.map(g=>g.id)),ids=new Set(rows?rows.map(r=>r.cue_id):layout.entries.filter(e=>productionFlatMode()&&fixedPositionScope==='track'?e.subtitle_track_id===fixedStyleTrackId&&!e.cue.subtitle_position:groupIds.has(e.group.id)).map(e=>e.cue_id));
  fixedPositionSession={rows,ids,groupIds,start:{...start},value:{...start},dx:0,dy:0,rect:fixedVideoRect()};
  window.MSWSubtitleStyle?.syncPosition();window.dispatchEvent(new Event('msw:burn-style'));refreshSubtitlePreview();
}
function fixedStartPositioning() {
  if(fixedPositionEditing)return;
  commitProcessingEdits();
  if(productionFlatMode()&&fixedPositionScope==='cue') {
    const rows=fixedPositionSelection();if(!rows.length||rows.some(r=>!r.entry||fixedTrack(r.cue,r.role,r.track_id)?.locked))return;
    player.pause();
    const now=player.currentTime*1000;if(!rows.some(r=>r.cue.start<=now&&now<r.cue.end))player.currentTime=rows[0].cue.start/1000;
    fixedBeginPositionSession();return;
  }
  const track=fixedStyleTarget();if(!track||track.locked||!fixedPresentationMode())return;
  const role=currentCuePanelKind==='extension'?'extension':'main',source=role==='main'?DATA.segments:getExtensionTrack(currentCuePanelTrackId)?.segments||[];
  const cue=source[currentCuePanelIdx];
  if(cue&&fixedOwner(cue,role,currentCuePanelTrackId)===track.id)fixedPositionRef=fixedRef(cue,role,currentCuePanelTrackId);
  const now=player.currentTime*1000,groups=fixedPreviewLayout().layout.groups.filter(g=>g.rows.some(r=>r.subtitle_track_id===track.id));
  const chosen=fixedSelectedPositionGroup()||groups.find(g=>g.rows.some(r=>r.cue.start<=now&&now<r.cue.end))||groups[0];
  if(chosen){fixedPositionRef=fixedRef(chosen.rows[0].cue,chosen.rows[0].role,chosen.rows[0].track_id);if(!chosen.rows.some(r=>r.cue.start<=now&&now<r.cue.end))player.currentTime=chosen.start/1000;}
  player.pause();fixedBeginPositionSession();
}
function fixedInstallPositionDrag(root) {
  root.addEventListener('pointerdown',event=>{
    const node=event.target.closest('.annotation,.position-target');if(!fixedPositionEditing||event.button!==0||!node)return;
    const session=fixedPositionSession;if(!session?.ids.has(node.dataset.cueId))return;
    event.preventDefault();event.stopPropagation();
    document.activeElement?.blur();player.pause();
    fixedPositionDrag={...session,value:{...session.value},pointerStart:{...session.value},pointerId:event.pointerId,x:event.clientX,y:event.clientY,rect:fixedVideoRect()};root.setPointerCapture(event.pointerId);
    refreshSubtitlePreview();
  });
  root.addEventListener('pointermove',event=>{
    const drag=fixedPositionDrag;if(!drag||event.pointerId!==drag.pointerId)return;
    const value={x:drag.pointerStart.x+(event.clientX-drag.x)/drag.rect.width,y:drag.pointerStart.y+(event.clientY-drag.y)/drag.rect.height};
    const delta=drag.rows?fixedPositionDelta(drag.rows,value):{x:Math.max(0,Math.min(1,value.x))-drag.start.x,y:Math.max(0,Math.min(1,value.y))-drag.start.y};
    drag.value={x:drag.start.x+delta.x,y:drag.start.y+delta.y};drag.dx=delta.x*drag.rect.referenceWidth;drag.dy=delta.y*1080;refreshSubtitlePreview();
  });
  const end=(event,cancel=false)=>{
    const drag=fixedPositionDrag;if(!drag)return;fixedPositionDrag=null;
    if(root.hasPointerCapture(drag.pointerId))root.releasePointerCapture(drag.pointerId);
    if(!cancel&&fixedPositionSession)Object.assign(fixedPositionSession,{value:drag.value,dx:drag.dx,dy:drag.dy});
    window.MSWSubtitleStyle?.syncPosition();refreshSubtitlePreview();
  };
  root.addEventListener('pointerup',event=>end(event));root.addEventListener('pointercancel',event=>end(event,true));
  root.addEventListener('click',event=>{if(fixedPositionEditing){event.preventDefault();event.stopPropagation();}});
}
window.addEventListener('keydown',event=>{
  if(!fixedPositionEditing||event.isComposing||event.ctrlKey||event.metaKey||event.altKey)return;
  const key=event.key,field=event.target.closest?.('input,textarea,select,[contenteditable="true"]');
  if(key==='Escape'||key==='Enter'&&(!field||field.matches('#style-position-x,#style-position-y'))) {
    event.preventDefault();event.stopImmediatePropagation();
    if(key==='Enter')field?.blur();fixedStopPositioning(key==='Enter');return;
  }
  if(field||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(key))return;
  event.preventDefault();event.stopImmediatePropagation();
  if(fixedPositionDrag)return;
  const s=fixedPositionSession,axis=key==='ArrowLeft'||key==='ArrowRight'?'x':'y',step=(key==='ArrowLeft'||key==='ArrowUp'?-1:1)/(axis==='x'?s.rect.referenceWidth:1080);
  fixedStagePosition({[axis]:s.value[axis]+step});
},true);
document.addEventListener('input',event=>{if(event.target.matches('textarea,[contenteditable="true"]'))fixedPreviewInvalidate();},true);
window.addEventListener('msw:project-changed',()=>{fixedStyleTrackId='';fixedPositionRef=null;fixedPositionEditing=false;fixedPositionSession=null;fixedPositionDrag=null;fixedPositionHold=null;fixedPositionOffsetsKey='';fixedPositionNotice='';fixedTextMeasures.clear();fixedPreviewInvalidate();});
window.addEventListener('msw:burn-style',fixedPreviewInvalidate);
document.fonts?.addEventListener('loadingdone',()=>{fixedTextMeasures.clear();fixedPreviewInvalidate();if(fixedPresentationMode())refreshSubtitlePreview();});
document.addEventListener('DOMContentLoaded',()=>{new ResizeObserver(()=>{if(fixedPresentationMode())refreshSubtitlePreview();}).observe(playerStage);});
