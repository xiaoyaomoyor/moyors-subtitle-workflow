// Control-bar avoidance is a local viewing preference, never project geometry.
(function(global) {
  'use strict';
  const stage=document.querySelector('.player-stage'),controls=document.getElementById('media-controls');
  const toggle=document.getElementById('subtitle-avoid-controls'),core=global.MSWPreviewAvoidanceCore;
  if(!stage||!controls||!toggle||!core)return;
  toggle.checked=EDITOR_SETTINGS.subtitleAvoidControls!==false;
  let frame=0,signature='',current=new Map(),target=new Map(),animation=0,busy=false,revision=-1,overflow=false;
  let player=null;
  let hideTimer=0,controlsVisible=false;
  let rowSource=null,rowWidth=0,rowVisibility='',rowSerial=0,cachedRows=[];
  // Keep both the bar and its safe area through short pointer exits. Without
  // this hold, crossing the video edge repeatedly reverses the subtitle motion.
  function visibility(requested) {
    if(requested) {clearTimeout(hideTimer);hideTimer=0;controlsVisible=true;}
    else if(controlsVisible&&!hideTimer)hideTimer=setTimeout(()=>{hideTimer=0;controlsVisible=false;refresh();},350);
    stage.classList.toggle('media-controls-visible',controlsVisible);
    return controlsVisible;
  }
  const reduced=global.matchMedia('(prefers-reduced-motion: reduce)');
  function refresh(){if(!frame)frame=requestAnimationFrame(update);}
  function videoRect() {
    const r=player?.getBoundingClientRect();if(!r?.width||!r.height)return null;
    const ratio=player.videoWidth&&player.videoHeight?player.videoWidth/player.videoHeight:r.width/r.height;
    const width=Math.min(r.width,r.height*ratio),height=width/ratio;
    return {x:r.left+(r.width-width)/2,y:r.top+(r.height-height)/2,width,height};
  }
  function setDocked(value) {
    if(controls.classList.contains('media-controls-outside')===value)return;
    controls.classList.toggle('media-controls-outside',value);
    if(value)stage.after(controls);else stage.append(controls);
    refresh();
  }
  function sourceRows() {
    const exact=global.MSWSubtitleRenderer;
    const width=fixedVideoRect().referenceWidth;
    // Empty geometry is valid (a gap, disabled subtitles, or a document swap).
    // Never measure the whole CSS fallback while the libass picture is active.
    if(exact?.status==='libass'&&(exact.geometry.length||typeof fixedPresentationMode==='function'&&fixedPresentationMode())) {
      if(rowSource===exact.geometry&&rowWidth===width)return cachedRows;
      rowSource=exact.geometry;rowWidth=width;rowSerial++;
      return cachedRows=exact.geometry.map(r=>{
      if(r.motion)return global.MSWSubtitleAnimation.envelope(r,width);
      const dx=r.move?.enabled?r.move.x2-r.move.x1:0,dy=r.move?.enabled?r.move.y2-r.move.y1:0;
      return {...r,x:r.x+Math.min(0,dx),y:r.y+Math.min(0,dy),width:r.width+Math.abs(dx),height:r.height+Math.abs(dy)};
      });
    }
    if(typeof fixedPresentationMode==='function'&&fixedPresentationMode()) {
      const allowed={main:overlayToggle.checked&&!subtitleTrackMuted('main'),extension:extensionOverlayToggle?.checked&&!subtitleTrackMuted('extension')};
      const entries=fixedPreviewLayout().layout.entries,visibility=JSON.stringify(allowed);
      if(rowSource===entries&&rowWidth===width&&rowVisibility===visibility)return cachedRows;
      rowSource=entries;rowWidth=width;rowVisibility=visibility;rowSerial++;
      return cachedRows=entries.filter(r=>allowed[r.role]).map(r=>({...global.MSWSubtitleAnimation.envelope({...r,position:global.MSWTrackPresentation.positionOf(r,width)},width),groupId:r.group.id,start:r.cue.start,end:r.cue.end}));
    }
    return [];
  }
  function applyDom(offsets) {
    for(const el of stage.querySelectorAll('.fixed-subtitle-row')) {
      let key=el.dataset.key;
      // Native v4 rendering and the ordinary editor use distinct reference keys.
      // Cue IDs stay stable across the adapter and uniquely identify the row.
      if(!offsets.has(key)&&global.MSWSubtitleRenderer?.geometry.length)key=global.MSWSubtitleRenderer.geometry.find(r=>JSON.parse(r.key)[2]===el.dataset.cueId)?.key||key;
      const value=(offsets.get(key)||0)+'px';
      if(el.style.getPropertyValue('--controls-offset')!==value)el.style.setProperty('--controls-offset',value);
    }
  }
  async function animate(now) {
    animation=0;if(busy)return;
    const keys=new Set([...current.keys(),...target.keys()]),next=new Map();let settled=true;
    const dt=reduced.matches||target.size>120?1:Math.min(1,(now-(animate.last||now-16))/65);animate.last=now;
    for(const key of keys){const a=current.get(key)||0,b=target.get(key)||0,v=reduced.matches?b:a+(b-a)*dt;next.set(key,Math.abs(b-v)<.3?b:v);if(next.get(key)!==b)settled=false;}
    current=next;applyDom(current);busy=true;
    try {await global.MSWSubtitleRenderer?.applyPreviewOffsets(current);}
    catch(error){console.warn('字幕临时避让更新失败',error);}
    finally {busy=false;}
    // A new document or visibility event can replace the target while awaiting
    // the worker. Continue from the latest target, without concurrent writes.
    if(!settled||[...new Set([...target.keys(),...current.keys()])].some(k=>(current.get(k)||0)!==(target.get(k)||0)))animation=requestAnimationFrame(animate);
  }
  function legacy(obstacle,enabled) {
    const root=document.getElementById('overlay');
    const nodes=[root,...stage.querySelectorAll('.msw-layer-preview-text')].filter(n=>n&&!n.hidden&&getComputedStyle(n).display!=='none');
    let dy=0;
    if(enabled&&obstacle)for(const n of nodes){const b=n.getBoundingClientRect(),css=getComputedStyle(n);
      const prior=(css.transform==='none'?0:new DOMMatrixReadOnly(css.transform).m42)+(parseFloat(css.translate.split(' ')[1])||0);
      const bottom=b.bottom-prior;if(bottom>obstacle.y&&b.top-prior<obstacle.y+obstacle.height)dy=Math.min(dy,obstacle.y-8-bottom);
    }
    for(const n of nodes)n.style.setProperty('--controls-offset',dy+'px');
    // Legacy precise ASS has no per-cue render identities. Keep its complete
    // subtitle band together, using the legacy preview's measured text bounds.
    const canvas=stage.querySelector('.JASSUB');
    if(canvas)canvas.style.setProperty('--controls-offset',dy+'px');
  }
  function update() {
    frame=0;const nextPlayer=document.getElementById('player');
    if(player!==nextPlayer){if(player)resize.unobserve(player);player=nextPlayer;if(player)resize.observe(player);}
    if(!player){setDocked(false);return;}
    const pinned=player.paused;
    if(stage.classList.contains('media-controls-pinned')!==pinned)stage.classList.toggle('media-controls-pinned',pinned);
    const visible=visibility(pinned||stage.matches(':hover')||controls.matches(':hover,:focus-within'));
    if(player.tagName!=='VIDEO'){setDocked(false);return;}
    const positioning=fixedPositionPreviewActive()||!!stage.querySelector('#fixed-subtitle-preview.positioning:not([hidden])')||
      (!stage.classList.contains('fixed-presentation')&&!!stage.querySelector('#overlay.geometry-enabled:is(:focus,.editable,.dragging):not(.hidden)'));
    const enabled=toggle.checked&&!positioning&&visible;
    const exact=global.MSWSubtitleRenderer,newRevision=exact?.revision??0;
    if(newRevision!==revision){revision=newRevision;current=new Map();target=new Map();signature='';overflow=false;}
    if(!enabled)overflow=false;
    setDocked(positioning||overflow);
    const rect=videoRect();if(!rect)return;
    const bar=controls.getBoundingClientRect();
    const intersects=enabled&&!controls.classList.contains('media-controls-outside')&&bar.top<rect.y+rect.height&&bar.bottom>rect.y;
    const obstacle=intersects?{x:(bar.left-rect.x)*1080/rect.height,y:(bar.top-rect.y)*1080/rect.height,width:bar.width*1080/rect.height,height:bar.height*1080/rect.height}:null;
    const rows=sourceRows();
    if(rows.length) {
      const key=JSON.stringify([revision,obstacle,positioning,toggle.checked,rowSerial]);
      if(key!==signature){signature=key;const result=core.plan(rows,obstacle,8*1080/rect.height);
        target=result.offsets;
        if(result.overflow){overflow=true;setDocked(true);target=new Map();}
        if(positioning){current=new Map();applyDom(current);if(exact)void exact.applyPreviewOffsets(current).catch(()=>{});}
        if(!animation&&!busy){animate.last=0;animation=requestAnimationFrame(animate);}
      }
      applyDom(current);
      stage.querySelector('.JASSUB')?.style.removeProperty('--controls-offset');
    } else if(exact?.status!=='libass'||typeof fixedPresentationMode==='function'&&!fixedPresentationMode())legacy(intersects?{y:bar.top,height:bar.height}:null,enabled);
  }
  const resize=new ResizeObserver(refresh);resize.observe(stage);resize.observe(controls);
  new MutationObserver(refresh).observe(stage,{subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden','data-subtitle-renderer']});
  for(const type of ['pointerenter','pointerleave','focusin','focusout']){stage.addEventListener(type,refresh);controls.addEventListener(type,refresh);}
  for(const type of ['play','pause','loadedmetadata','seeked','timeupdate','emptied'])document.addEventListener(type,refresh,true);
  for(const type of ['msw:player-changed','msw:project-changed','msw:burn-style','msw:subtitles-changed'])global.addEventListener(type,refresh);
  document.addEventListener('fullscreenchange',refresh);
  for(const id of ['overlay-toggle','extension-overlay-toggle'])document.getElementById(id)?.addEventListener('change',refresh);
  toggle.addEventListener('change',()=>{updateEditorSettings({subtitleAvoidControls:toggle.checked});refresh();});
  global.MSWPreviewControls={refresh,get offsets(){return new Map(current);},get settled(){return !animation&&!busy&&!frame;}};
  refresh();
})(window);
