// One ASS document feeds libass in the browser and the FFmpeg burn compiler.
(function(global) {
  'use strict';
  const host=global.MSWE?.resolve('processing-host'),styles=global.MSWSubtitleStyle;
  if(!host||!styles)return;
  let renderer=null,video=null,observedPlayer=null,source='',key='',pending=false,again=false,timer,serial=0,modulePromise=null;
  const fontBytes=new Map();
  const fontManifests=new Map();let loadedFontIds=new Set();
  const badge=document.createElement('span');badge.id='subtitle-render-status';badge.className='msw-style-render-status';badge.setAttribute('role','status');
  const stage=document.querySelector('.player-stage');stage.append(badge);
  function fallback(text) {stage.dataset.subtitleRenderer='approximate';badge.textContent=text;}
  // A previous video's offscreen canvas must leave the DOM synchronously. Worker
  // cleanup can take longer, especially when the project changes during startup.
  function disposeRenderer() {
    const previous=renderer;renderer=null;
    video?.removeEventListener('seeked',repaintAfterEvent);video?.removeEventListener('pause',repaintAfterEvent);
    video=null;source='';loadedFontIds.clear();
    stage.querySelectorAll('.JASSUB').forEach(canvas=>canvas.remove());
    if(previous)void previous.destroy().catch(()=>{});
  }
  const mediaSource=player=>player.currentSrc || player.querySelector('source')?.src || player.src || '';
  function resetMedia() {
    serial++;key='';
    fallback('正在等待视频与字幕画面…');disposeRenderer();invalidate();
  }
  function observePlayer() {
    const next=host.player;
    if(next!==observedPlayer) {
      observedPlayer?.removeEventListener('emptied',resetMedia);
      observedPlayer?.removeEventListener('loadeddata',invalidate);
      observedPlayer=next;
      next.addEventListener('emptied',resetMedia);
      next.addEventListener('loadeddata',invalidate);
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
  async function fonts(style) {
    const families=[style.main.fontName,style.secondary.fontName],fontKey=JSON.stringify(families);
    if(!fontManifests.has(fontKey))fontManifests.set(fontKey,styles.request('subtitle-fonts',{families}).catch(error=>{fontManifests.delete(fontKey);throw error;}));
    const manifest=await fontManifests.get(fontKey);
    const bytes=await Promise.all(manifest.fonts.map(async item=>{
      if(!fontBytes.has(item.id)) {const response=await fetch(`${host.config.processingUrl}/subtitle-font?id=${encodeURIComponent(item.id)}`,{headers:{'X-MSW-Token':host.config.requestToken}});if(!response.ok)throw Error('无法加载字幕字体');fontBytes.set(item.id,new Uint8Array(await response.arrayBuffer()));}
      return fontBytes.get(item.id);
    }));
    return {bytes,manifest};
  }
  function signature(preview) {
    return JSON.stringify([host.generation,mediaSource(host.player),preview,host.player.videoWidth,host.player.videoHeight,
      host.data.segments,host.data.multi_subtitle,host.data.overlay_track,host.data.subtitle_layers,host.subtitleRenderSettings()]);
  }
  async function update() {
    observePlayer();
    if(!styles.ready){fallback(styles.error?'字幕样式加载失败：'+styles.error:'正在加载工程字幕样式…');return;}
    if(pending){again=true;return;}
    const preview=styles.currentPreview(),signatureKey=signature(preview);
    // Player replacement resets key; a failed renderer should not be recreated
    // by every poll while the media and subtitle settings remain unchanged.
    if(key===signatureKey)return;
    key=signatureKey;
    if(!host.config?.processingUrl || host.player.tagName!=='VIDEO') {fallback(preview.label+' · 近似预览'+(!host.config?.processingUrl?'（便携模式）':''));return;}
    if(host.player.readyState<2||!host.player.videoWidth){key='';fallback(preview.label+' · 等待视频画面');return;}
    pending=true;const ticket=++serial,generation=host.generation,target=host.player,targetSource=mediaSource(host.player);
    const current=()=>ticket===serial&&generation===host.generation&&target===host.player&&targetSource===mediaSource(target);
    try {
      const project=host.exportProject();global.MSWProjectStyle.apply(project,preview.style);
      for(const field of ['waveform','spectral','waveform_reapeaks','workspace'])delete project[field];
      const [payload,loaded,mod]=await Promise.all([
        styles.request('subtitle-preview',{project,target:preview.target,video:{width:host.player.videoWidth,height:host.player.videoHeight}}),
        fonts(preview.style),modulePromise||=import('/subtitle-renderer/jassub.js')]);
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
      await renderer.resize(true);
      if(!current())return;
      await repaint();
      // Let Chromium composite the resized transparent canvas before revealing
      // it. A settings-window repaint must not be needed to reveal the video.
      await new Promise(resolve=>requestAnimationFrame(resolve));
      if(!current())return;
      stage.dataset.subtitleRenderer='libass';
      badge.textContent=preview.label+(loaded.manifest.missing.length?' · 缺少字体：'+loaded.manifest.missing.join('、')+'（已回退）':'');
      badge.title='播放器与烧录使用同一份字幕布局及 libass 渲染。';
    } catch(error) {if(current()){fallback(preview.label+' · 近似预览：'+error.message);modulePromise=null;disposeRenderer();host.refreshStylePreview();}}
    finally {pending=false;if(again){again=false;invalidate();}}
  }
  function invalidate(){key='';clearTimeout(timer);timer=setTimeout(update,100);}
  global.addEventListener('msw:player-changed',observePlayer);
  global.addEventListener('msw:project-changed',resetMedia);
  for(const name of ['msw:media-changed','msw:subtitles-changed','msw:burn-style'])global.addEventListener(name,invalidate);
  for(const id of ['overlay-toggle','extension-overlay-toggle'])document.getElementById(id)?.addEventListener('change',invalidate);
  // Existing editing paths do not all dispatch an event; compare state without
  // rebuilding an ASS document or starting a network request unless it changed.
  setInterval(()=>{if(!document.hidden)void update();},750);
  global.MSWSubtitleRenderer={invalidate,repaint,get renderer(){return renderer;},get pending(){return pending||again;},get status(){return stage.dataset.subtitleRenderer;}};
  invalidate();
})(window);
