// One ASS document feeds libass in the browser and the FFmpeg burn compiler.
(function(global) {
  'use strict';
  function create(host,styles) {
  if(!host||!styles)return;
  let renderer=null,video=null,observedPlayer=null,source='',key='',pending=false,again=false,timer,serial=0,modulePromise=null;
  let inputRevision=0,observedStamp=null,projected=null;
  let previewRevision=0,previewEvents=[],previewGeometry=[],previewWrites=Promise.resolve();
  let controlsOffsets=new Map(),positionOffsets=new Map(),queuedWrites=0;
  const diagnostics=[];
  function trace(event,detail={}) {
    diagnostics.push({event,at:Math.round(performance.now()),time:host.player.currentTime,
      status:stage.dataset.subtitleRenderer,video:[host.player.videoWidth,host.player.videoHeight],
      canvas:renderer?{width:renderer._canvas?.width,height:renderer._canvas?.height}:null,...detail});
    if(diagnostics.length>80)diagnostics.shift();
  }
  function clearPreviewDocument() {
    previewRevision++;previewEvents=[];previewGeometry=[];
    controlsOffsets=new Map();positionOffsets=new Map();
    global.MSWPreviewControls?.refresh();
  }
  function applyPreviewOffsets(offsets) {
    controlsOffsets=new Map(offsets);return applyOffsets();
  }
  function applyPositionOffsets(offsets) {
    positionOffsets=new Map(offsets);return applyOffsets();
  }
  function applyOffsets() {
    const revision=previewRevision,active=renderer;
    queuedWrites++;
    const write=async()=>{
      if(revision!==previewRevision||active!==renderer||!active?.renderer)return;
      const offsets=e=>({x:positionOffsets.get(e.key)?.x||0,y:(controlsOffsets.get(e.key)||0)+(positionOffsets.get(e.key)?.y||0)});
      const changes=previewEvents.filter(e=>{const p=offsets(e);return p.x!==e.offsetX||p.y!==e.offset;});
      if(!changes.length)return;
      await Promise.all(changes.map(e=>{
        const p=offsets(e);e.offset=p.y;e.offsetX=p.x;
        return active.renderer.setEvent({...e.original,Text:global.MSWPreviewAvoidanceCore.shiftText(e.original.Text,p.y,p.x)},e.index);
      }));
      if(revision===previewRevision&&active===renderer)await repaint();
    };
    const result=previewWrites.then(write).catch(error=>{
      if(revision===previewRevision&&active===renderer){
        fallback('字幕预览位置更新失败，已使用近似预览：'+error.message);disposeRenderer();host.refreshStylePreview();
      }
      throw error;
    }).finally(()=>{queuedWrites--;});
    // Leave the queue usable after a destroyed worker. The caller owns errors.
    previewWrites=result.catch(()=>{});return result;
  }
  const fontBytes=new Map();
  const fontManifests=new Map();let loadedFontIds=new Set();
  const badge=document.createElement('span');badge.id='subtitle-render-status';badge.className='msw-style-render-status';badge.setAttribute('role','status');
  const stage=document.querySelector('.player-stage');stage.append(badge);
  new ResizeObserver(()=>trace('viewport',{box:[Math.round(stage.clientWidth),Math.round(stage.clientHeight)],
    frame:renderer?[renderer._videoWidth,renderer._videoHeight]:null})).observe(stage);
  function syncBadge(){badge.hidden=host.subtitlePreviewTarget()==='none';}
  syncBadge();
  function fallback(text) {if(stage.dataset.subtitleRenderer!=='approximate')trace('fallback',{reason:text});stage.dataset.subtitleRenderer='approximate';badge.textContent=host.flat?text.replace(/近似预览/g,'字幕预览不可用'):text;}
  // A previous video's offscreen canvas must leave the DOM synchronously. Worker
  // cleanup can take longer, especially when the project changes during startup.
  function disposeRenderer() {
    clearPreviewDocument();
    const previous=renderer;renderer=null;
    video?.removeEventListener('seeked',repaintAfterEvent);video?.removeEventListener('pause',repaintAfterEvent);
    video=null;source='';loadedFontIds.clear();
    stage.querySelectorAll('.JASSUB').forEach(canvas=>canvas.remove());
    if(previous)void previous.destroy().catch(()=>{});
  }
  const mediaSource=player=>player.currentSrc || player.querySelector('source')?.src || player.src || '';
  function resetMedia() {
    serial++;key='';observedStamp=null;projected=null;
    fallback('正在等待视频与字幕画面…');disposeRenderer();invalidate();
  }
  function observePlayer() {
    const next=host.player;
    if(next!==observedPlayer) {
      observedPlayer?.removeEventListener('emptied',resetMedia);
      observedPlayer?.removeEventListener('loadeddata',invalidate);
      observedPlayer?.removeEventListener('timeupdate',playbackWindow);
      observedPlayer?.removeEventListener('seeking',playbackWindow);
      observedPlayer=next;
      next.addEventListener('emptied',resetMedia);
      next.addEventListener('loadeddata',invalidate);
      next.addEventListener('timeupdate',playbackWindow);
      next.addEventListener('seeking',playbackWindow);
      resetMedia();
    }
  }
  async function repaint() {
    if(!renderer?.renderer||video!==host.player||video.readyState<2||!video.videoWidth)return;
    await renderer.manualRender({mediaTime:video.currentTime,width:video.videoWidth,height:video.videoHeight,expectedDisplayTime:performance.now()},true);
  }
  function repaintAfterEvent() {
    const active=renderer;
    void repaint().catch(error=>{
      if(renderer!==active)return;
      fallback('字幕渲染失败，已使用近似预览：'+error.message);disposeRenderer();host.refreshStylePreview();
    });
  }
  async function fonts(style,project) {
    const scriptFamilies=s=>global.AsrEditorUtils.ASS_FONT_SCRIPTS.map(([,k])=>s?.[k]);
    const familyNames=s=>[s.main,s.secondary,s.annotation?.main,s.annotation?.secondary].flatMap(scriptFamilies);
    const cueFonts=[...(project.subtitles?.cues||[]).map(c=>c.content),...(project.segments||[]),...(project.multi_subtitle?.tracks||[]).flatMap(t=>t.segments)].flatMap(c=>scriptFamilies(c.subtitle_style));
    const speakerFonts=(project.preview?.speaker_palette?.rows||[]).flatMap(r=>
      [r.style,r.role_styles?.main?.style,r.role_styles?.secondary?.style].flatMap(scriptFamilies));
    const families=[...new Set([...familyNames(style),...speakerFonts,...cueFonts,...(project.subtitles?.tracks||project.subtitle_tracks?.tracks||[]).flatMap(t=>t.style.mode==='snapshot'?familyNames(t.style.value):[])].filter(Boolean))].sort(),fontKey=JSON.stringify(families);
    if(!fontManifests.has(fontKey)) {
      if(fontManifests.size>=32)fontManifests.delete(fontManifests.keys().next().value);
      fontManifests.set(fontKey,styles.request('subtitle-fonts',{families}).catch(error=>{fontManifests.delete(fontKey);throw error;}));
    }
    const manifest=await fontManifests.get(fontKey);
    const bytes=await Promise.all(manifest.fonts.map(async item=>{
      if(!fontBytes.has(item.id)) {
        // Share in-flight reads as well as completed bytes. Failed reads are
        // retryable, and the JS cache is bounded independently of worker fonts.
        const entry={size:item.bytes||0,promise:null};
        entry.promise=(async()=>{
          const response=await fetch(`${host.config.processingUrl}/subtitle-font?id=${encodeURIComponent(item.id)}`,{headers:{'X-MSW-Token':host.config.requestToken}});
          if(!response.ok)throw Error('无法加载字幕字体');
          const bytes=new Uint8Array(await response.arrayBuffer());entry.size=bytes.byteLength;
          return bytes;
        })().catch(error=>{fontBytes.delete(item.id);fontManifests.delete(fontKey);throw error;});
        fontBytes.set(item.id,entry);
      }
      const entry=fontBytes.get(item.id);fontBytes.delete(item.id);fontBytes.set(item.id,entry);
      return entry.promise;
    }));
    let total=[...fontBytes.values()].reduce((sum,e)=>sum+e.size,0);
    for(const [id,e] of fontBytes){if(total<=128*1024*1024)break;fontBytes.delete(id);total-=e.size;}
    return {bytes,manifest};
  }
  let windowBucket=-1;
  function playbackWindow() {
    const bucket=Math.floor(host.player.currentTime/30);
    if(bucket!==windowBucket)invalidate();
  }
  function snapshot() {
    const bucket=Math.floor(Math.max(0,host.player.currentTime)/30);
    const range={start:Math.max(0,(bucket-1)*30000),end:(bucket+2)*30000};
    return {bucket,project:host.subtitlePreviewProject?host.subtitlePreviewProject(range):host.exportProject()};
  }
  function signature(preview,project) {
    return JSON.stringify([host.generation,mediaSource(host.player),preview,host.player.videoWidth,host.player.videoHeight,
      project,host.subtitleRenderSettings()],(name,value)=>{
        if(name==='items'||name.startsWith('_')||name==='start_frame'||name==='end_frame')return undefined;
        // The adapter's original migration snapshots are not live render data.
        if(name==='flat_context')return {bindingSources:value?.bindingSources};
        return value;
      });
  }
  // A cheap version/settings token replaces whole-project polling. Hosts
  // without edit revisions keep the conservative content-fingerprint path.
  function inputStamp(preview=styles.currentPreview()) {
    if(host.subtitlePreviewRevision===undefined)return null;
    return JSON.stringify([host.generation,host.subtitlePreviewRevision,inputRevision,
      Math.floor(Math.max(0,host.player.currentTime)/30),mediaSource(host.player),
      host.player.videoWidth,host.player.videoHeight,preview,host.subtitleRenderSettings()]);
  }
  function projection(preview,stamp) {
    if(stamp!==null&&projected?.stamp===stamp)return projected;
    const state=snapshot();
    return projected={stamp,state,signatureKey:signature(preview,state.project)};
  }
  async function update() {
    syncBadge();
    observePlayer();
    // Defer expensive ASS generation until release. Polling during a drag used
    // to commit the editor's old time fields and snap the cue back to its start.
    if(host.editingGestureActive)return;
    if(!styles.ready){fallback(styles.error?'字幕样式加载失败：'+styles.error:'正在加载工程字幕样式…');return;}
    const started=performance.now(),preview=styles.currentPreview();
    if(!host.config?.processingUrl || host.player.tagName!=='VIDEO') {fallback(preview.label+' · 近似预览'+(!host.config?.processingUrl?'（便携模式）':''));return;}
    // Seeking can briefly drop readyState without replacing the media. Keep
    // the existing ASS renderer instead of flashing the CSS fallback.
    if(host.player.readyState<2||!host.player.videoWidth){if(!renderer){key='';fallback(preview.label+' · 等待视频画面');}return;}
    let state,signatureKey,stamp;
    try {
      stamp=inputStamp(preview);
      if(stamp!==null&&stamp===observedStamp)return;
      // Do not clone or project thousands of cues while an older request is
      // running. Its completion checks the token and schedules the latest edit.
      if(pending){again=true;return;}
      ({state,signatureKey}=projection(preview,stamp));
      observedStamp=stamp;
    }
    catch(error){
      trace('snapshot-error',{reason:error.message});
      if(renderer)badge.textContent=preview.label+' · 更新失败：'+error.message;
      else fallback(preview.label+' · 字幕预览不可用：'+error.message);
      return;
    }
    windowBucket=state.bucket;
    // Player replacement resets key; a failed renderer should not be recreated
    // by every poll while the media and subtitle settings remain unchanged.
    if(key===signatureKey)return;
    key=signatureKey;
    pending=true;const ticket=++serial,generation=host.generation,target=host.player,targetSource=mediaSource(host.player);
    const current=()=>ticket===serial&&generation===host.generation&&target===host.player&&targetSource===mediaSource(target);
    const unchanged=()=>{
      const next=styles.currentPreview(),nextStamp=inputStamp(next);
      if(stamp!==null&&nextStamp===stamp)return true;
      // Validation and UI refresh can advance the revision without changing
      // render inputs. Check once on completion, not on every pending poll.
      // A real newer edit keeps this projection for the next request.
      if(projection(next,nextStamp).signatureKey!==signatureKey)return false;
      stamp=nextStamp;observedStamp=nextStamp;return true;
    };
    let swapping=false;
    try {
      let project=state.project;
      if(preview.scope==='export')project.preview.speaker_label_export=document.getElementById('video-export-speaker-labels').checked;
      if(preview.scope==='export'&&project.schema==='msw.project.v4')project=global.MSWProductionProject.exportScope(project,preview.trackIds);
      if(preview.scope==='proof'||preview.other)global.MSWProjectStyle.applyPreset(project,preview.style,{proof:preview.scope==='proof'});else global.MSWProjectStyle.apply(project,preview.style);
      for(const field of ['waveform','spectral','waveform_reapeaks','workspace'])delete project[field];
      const [payload,loaded,mod]=await Promise.all([
        styles.request('subtitle-preview',{project,target:preview.target,video:{width:host.player.videoWidth,height:host.player.videoHeight}}),
        fonts(preview.style,project),modulePromise||=import('/subtitle-renderer/jassub.js')]);
      if(!current())return;
      // An old request must not overwrite more recent edits. Keep the current
      // canvas until the latest document is ready, and coalesce interim edits.
      if(!unchanged()){key='';observedStamp=null;again=true;trace('discard');return;}
      if(payload.layoutVersion!==global.MSWProjectStyle.layoutVersion)throw Error('编辑器服务尚未加载更新，请保存工程并重新启动本机编辑器；仅刷新页面无效。');
      swapping=true;clearPreviewDocument();await previewWrites;
      if(!current())return;
      if(!renderer || video!==target || source!==targetSource) {
        disposeRenderer();fallback(preview.label+' · 正在加载字幕渲染…');
        video=target;source=targetSource;
        renderer=new mod.default({video,subContent:payload.ass,fonts:loaded.bytes,queryFonts:false,defaultFont:loaded.manifest.fallback,
          workerUrl:'/subtitle-renderer/worker.js',wasmUrl:'/subtitle-renderer/libass.wasm',modernWasmUrl:'/subtitle-renderer/libass.wasm',prescaleHeightLimit:0});
        let timeout;
        try {await Promise.race([renderer.ready,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('字幕渲染器加载超时')),20000);})]);}
        finally {clearTimeout(timeout);}
        if(!current())return;
        loadedFontIds=new Set(loaded.manifest.fonts.map(f=>f.id));
        video.addEventListener('seeked',repaintAfterEvent);video.addEventListener('pause',repaintAfterEvent);
      } else {
        const extra=loaded.bytes.filter((_,i)=>!loadedFontIds.has(loaded.manifest.fonts[i].id));
        if(extra.length){await renderer.renderer.addFonts(extra);for(const f of loaded.manifest.fonts)loadedFontIds.add(f.id);}
        await renderer.renderer.setTrack(payload.ass);
      }
      if(!current())return;
      const [events,eventStyles]=await Promise.all([renderer.renderer.getEvents(),renderer.renderer.getStyles()]);
      if(!current())return;
      previewGeometry=(payload.geometry||[]).filter(r=>r.visible!==false);
      const geometryByStyle=new Map(previewGeometry.map(r=>[r.style,r]));
      previewEvents=events.flatMap((original,index)=>{
        const row=geometryByStyle.get(eventStyles[original.Style]?.Name);
        return row?[{original,index,key:row.key,offset:0,offsetX:0}]:[];
      });
      await renderer.resize(true);
      if(!current())return;
      await repaint();
      // Let Chromium composite the resized transparent canvas before revealing
      // it. A settings-window repaint must not be needed to reveal the video.
      await new Promise(resolve=>requestAnimationFrame(resolve));
      if(!current())return;
      if(!unchanged()){key='';observedStamp=null;again=true;trace('discard');return;}
      stage.dataset.subtitleRenderer='libass';
      trace('document',{elapsed:Math.round(performance.now()-started),cues:payload.geometry?.length,scope:preview.scope,
        fontSizes:[...new Set(eventStyles.map(s=>s.FontSize))],frame:renderer?[renderer._videoWidth,renderer._videoHeight]:null});
      global.MSWPreviewControls?.refresh();
      if(payload.geometry)global.fixedReceiveGeometry?.(payload.geometry);
      const unavailable=loaded.manifest.unavailable||[];
      badge.textContent=preview.label+(loaded.manifest.missing.length?' · 缺少字体：'+loaded.manifest.missing.join('、')+'（已回退）':'')+
        (unavailable.length?' · 字体未完整加载：'+unavailable.map(f=>`${f.family}（${f.reason}）`).join('、'):'');
      badge.title='播放器与烧录使用同一份字幕布局及 libass 渲染。播放控制条避让仅临时调整预览位置。';
    } catch(error) {if(current()){
      if(renderer&&!swapping){trace('update-error',{reason:error.message});badge.textContent=preview.label+' · 更新失败：'+error.message;}
      else {fallback(preview.label+' · 近似预览：'+error.message);modulePromise=null;disposeRenderer();host.refreshStylePreview();}
    }}
    finally {pending=false;if(again){again=false;schedule();}}
  }
  function invalidate(){
    syncBadge();
    inputRevision++;
    // Explicit retries can recover a failed worker/server; unchanged healthy
    // documents must retain their geometry and temporary control-bar offsets.
    if(!pending&&!renderer)key='';
    schedule();
  }
  function schedule(){
    clearTimeout(timer);timer=setTimeout(()=>{timer=undefined;void update();},100);
  }
  global.addEventListener('msw:player-changed',observePlayer);
  global.addEventListener('msw:project-changed',resetMedia);
  for(const name of ['msw:media-changed','msw:subtitles-changed','msw:burn-style'])global.addEventListener(name,invalidate);
  for(const id of ['overlay-toggle','extension-overlay-toggle'])document.getElementById(id)?.addEventListener('change',invalidate);
  // Poll only revision/settings on the main editor. Compatibility hosts without
  // revisions still compare contents; ordinary idle playback never copies cues.
  setInterval(()=>{if(!document.hidden)void update();},750);
  global.MSWSubtitleRenderer={invalidate,repaint,applyPreviewOffsets,applyPositionOffsets,get diagnostics(){return structuredClone(diagnostics);},get geometry(){return previewGeometry;},get revision(){return previewRevision;},get renderer(){return renderer;},get pending(){return pending||again||timer!==undefined||queuedWrites>0;},get status(){return stage.dataset.subtitleRenderer;}};
  invalidate();
  }
  global.MSWCreateSubtitleRenderer=create;
  if(!global.MSWFlatTrialRequested)create(global.MSWE?.resolve('processing-host'),global.MSWSubtitleStyle);
})(window);
