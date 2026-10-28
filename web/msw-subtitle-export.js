// One export form; options are applied to snapshots, never to stored cues.
(function (global) {
  'use strict';
  const host=global.MSWE.resolve('processing-host'),U=global.AsrEditorUtils;
  const el=id=>document.getElementById('subtitle-export-'+id),panel=el('panel');
  const floating=host.createFloatingPanel({panel,dragHandle:el('drag'),
    anchorButton:document.querySelector('[data-menubar-item="file"] > button'),positionKey:'msw.subtitle.export.position'});
  let busy=false,trackKey='',legacyScope=null,filenameProject=null;
  const dynamic=()=>['lottie','ograf'].includes(el('format').value);
  const scope=()=>fixedTrackMode()?fixedExportTracks:legacyScope;
  const setScope=value=>{if(fixedTrackMode())fixedExportTracks=value;else legacyScope=value;};
  function tracks() {
    if(fixedTrackMode())return DATA.subtitle_tracks.tracks;
    return [{id:'main',name:'S1',enabled:true},...(DATA.multi_subtitle?.tracks||[]).map((t,i)=>({id:t.id,name:`S${i+2}`,enabled:DATA.multi_subtitle.enabled!==false&&t.enabled!==false}))];
  }
  function message(text) {el('message').textContent=text;el('message').hidden=!text;}
  function selectedIds() {
    return dynamic()?[el('single-track').value]:tracks().filter(t=>t.enabled&&(!scope()||scope().includes(t.id))).map(t=>t.id);
  }
  function refresh() {
    if(!floating.isOpen()||busy)return;
    const list=tracks(),key=JSON.stringify(list.map(t=>[t.id,t.name,t.enabled]));
    if(key!==trackKey) {
      trackKey=key;el('scope').replaceChildren();
      const add=(id,name,disabled=false)=>{
        const label=document.createElement('label');label.className='media-preview-toggle';
        const input=document.createElement('input');input.type='checkbox';input.dataset.track=id;input.disabled=disabled;
        input.onchange=()=>{
          if(id==='all')setScope(input.checked?null:[]);
          else {const ids=new Set(list.filter(t=>t.enabled&&(!scope()||scope().includes(t.id))).map(t=>t.id));if(input.checked)ids.add(id);else ids.delete(id);setScope([...ids]);}
          message('');refresh();
        };
        label.append(input,document.createTextNode(name));el('scope').append(label);
      };
      add('all','全部轨道');for(const t of list)add(t.id,t.name+(t.enabled?'':' · 已禁用'),!t.enabled);
      const previous=el('single-track').value;el('single-track').replaceChildren(...list.filter(t=>t.enabled).map(t=>new Option(t.name,t.id)));
      if(list.some(t=>t.enabled&&t.id===previous))el('single-track').value=previous;
    }
    const enabled=list.filter(t=>t.enabled),chosen=enabled.filter(t=>!scope()||scope().includes(t.id));
    for(const input of el('scope').querySelectorAll('input')) {
      const id=input.dataset.track;input.checked=id==='all'?enabled.length>0&&chosen.length===enabled.length:chosen.some(t=>t.id===id);
      if(id==='all')input.indeterminate=chosen.length>0&&chosen.length<enabled.length;
    }
    const format=el('format').value,isDynamic=dynamic(),split=format==='srt'&&el('mode').value==='speaker';
    el('scope').hidden=isDynamic;el('single-track-field').hidden=!isDynamic;el('mode-field').hidden=format!=='srt';
    el('dynamic').hidden=!isDynamic;el('render-field').hidden=format!=='lottie';
    el('speaker-field').hidden=isDynamic;el('gaps-field').hidden=format==='txt';
    el('zero-field').hidden=!['srt','ass'].includes(format);
    el('unified-field').hidden=!split;el('suffix-field').hidden=!split;
    el('more').hidden=!['srt','ass'].includes(format);
    el('custom-size').hidden=el('resolution').value!=='custom';
    const ids=new Set(selectedIds());let count=0;
    if(fixedTrackMode()) {
      const index=fixedTrackCore.createIndex(DATA);
      for(const r of index.records({includeDisabled:false}))if(ids.has(index.trackFor(r)?.id)&&layerCore.visible(DATA,r.cue,r.role)&&r.cue.text?.trim())count++;
    } else for(const t of layerCore.tracks(DATA))if(ids.has(t.track_id||'main'))count+=t.segments.filter(c=>!c.disabled&&c.text?.trim()&&layerCore.visible(DATA,c,t.role)).length;
    const capability='can'+format[0].toUpperCase()+format.slice(1)+'Export';
    const available=format==='ass'?!!SERVER_CONFIG?.processingUrl:!isDynamic||!!(SERVER_CONFIG?.[capability]&&SERVER_CONFIG?.[format+'ExportUrl']);
    el('summary').textContent=!available?'此格式需要通过启动器打开本机编辑器':`轨道：${ids.size} | 字幕块：${count}`;
    el('start').disabled=!count||!available||!el('filename').value.trim();
  }
  function snapshot(ids) {
    if(fixedTrackMode()) {
      const previous=fixedExportTracks;
      try {fixedExportTracks=ids;return fixedSrtProject();}finally{fixedExportTracks=previous;}
    }
    const project=structuredClone(DATA);
    for(const t of layerCore.tracks(project)) {
      layerCore.materializeReferences(t.segments);
      const rows=ids.includes(t.track_id||'main')?t.segments.filter(c=>!c.disabled&&c.text?.trim()&&layerCore.visible(DATA,c,t.role)):[];
      if(t.role==='main')project.segments=rows;else project.multi_subtitle.tracks.find(track=>track.id===t.track_id).segments=rows;
    }
    return project;
  }
  function textFiles(project,{format,mode,removeGaps}) {
    const sources=layerCore.tracks(project),rows=sources.flatMap(t=>t.segments).sort((a,b)=>a.start-b.start||a.end-b.end);
    const speaker=speakerExportOptions(),removed=removeGaps?getRemovedGapRanges():[];
    const options={...speaker,alignFirstStart:EDITOR_SETTINGS.exportStartAtZero,formatTime:fmtSrtTime,
      mapTime:removed.length?ms=>U.mapGapRemovedTime(ms,removed):undefined,ensurePositiveDuration:removed.length>0};
    // Resolve names against original track/language identities before merging.
    if(format==='txt')return [{suffix:'',text:rows.map(c=>speaker.speakerLabelsEnabled?speaker.speakerTextResolver(c,rows):c.text).join('\n')}];
    if(mode==='merged') {
      if(speaker.speakerLabelsEnabled)for(const t of sources)for(const c of t.segments)c.text=speaker.speakerTextResolver(c,t.segments);
      return [{suffix:'',text:U.buildSrtPayload(global.MSWSubtitlePresentation.mergedSrtRows(project),{...options,speakerLabelsEnabled:false,speakerLabels:null})}];
    }
    if(mode==='speaker') {
      const colors=[...new Set(rows.map(c=>c.color?.name||'default'))];
      const suffixes=U.colorExportSuffixes(colors,{names:EDITOR_SETTINGS.exportSpeakerNamesAsSuffix?speakerSettings().names:null,language:global.MSWE_I18N?.language});
      return colors.map(color=>({suffix:'_'+suffixes[color],text:U.buildSrtPayload(rows.filter(c=>(c.color?.name||'default')===color),options)}));
    }
    return [{suffix:'',text:U.buildSrtPayload(rows,options)}];
  }
  async function dynamicFile(project,format,ids,removeGaps) {
    const rows=layerCore.tracks(project).flatMap(t=>t.segments).sort((a,b)=>a.start-b.start);
    const data=buildDynamicCaptionExportData(rows,removeGaps);if(!data)throw Error('没有可导出的动态字幕');
    const size=dynamicExportCanvasSize(el('resolution'),el('width'),el('height'));
    let appearance={...getPreviewGeometry(),...getSubtitleAppearance()};
    const owner=DATA.subtitle_tracks?.tracks.find(t=>t.id===ids[0]);
    if(owner) {
      const style=global.MSWTrackPresentation.styleFor(DATA,owner);
      appearance={...appearance,font_family:style.fontName,font_size:style.fontSize*960/1920,color:style.primaryColor};
    }
    const options={...size,durationMs:Math.max(data.durationMs||0,...data.segments.map(c=>c.end)),fps:el('fps').value,renderMode:el('render-mode').value,subtitle:appearance};
    const payload=format==='lottie'?{animation:U.buildLottieAnimation(data.segments,options)}:{graphic:U.buildOgrafGraphic(data.segments,options)};
    const response=await fetch(new URL(SERVER_CONFIG[format+'ExportUrl'],location.href),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestToken:SERVER_CONFIG.requestToken,...payload})});
    if(!response.ok){const error=await response.json().catch(()=>({}));throw Error(error.error||`服务器返回 ${response.status}`);}
    return response.blob();
  }
  async function start() {
    if(busy||el('start').disabled)return;
    host.commitEdits();refresh();if(el('start').disabled)return;
    const generation=host.generation,format=el('format').value,mode=el('mode').value,ids=selectedIds();
    const removeGaps=format!=='txt'&&el('remove-gaps').checked&&getRemovedGapRanges().length>0;
    const filename=el('filename').value.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/\.(srt|ass|txt|lottie|ograf\.zip)$/i,'');
    const unified=EDITOR_SETTINGS.exportColorUnified,extension=format==='ograf'?'ograf.zip':format;
    const mime=format==='ograf'?'application/zip':format==='lottie'?'application/zip+dotlottie':'text/plain';
    busy=true;el('fields').disabled=true;el('start').disabled=true;el('start').textContent='正在导出…';message('');
    try {
      let files;
      if(format==='ass') {
        // fixedAssDocument captures the project and scope before its first await.
        if(fixedTrackMode())files=[{text:await fixedAssDocument('both',removeGaps),suffix:''}];
        else throw Error('请通过启动器重新打开工程，升级轨道后导出 ASS');
      } else {
        const project=snapshot(ids);
        files=dynamic()?[{text:await dynamicFile(project,format,ids,removeGaps),suffix:''}]:textFiles(project,{format,mode,removeGaps});
      }
      if(generation!==host.generation)return;
      let saved=0;
      for(const file of files.filter(f=>typeof f.text!=='string'||f.text.trim())) {
        if(generation!==host.generation)return;
        const result=await downloadFile(file.text,`${filename}${file.suffix}.${extension}`,mime,
          {desc:'字幕文件',types:{[mime]:['.'+(format==='ograf'?'zip':format)]}},
          {usePicker:!(format==='srt'&&mode==='speaker'&&unified),detailed:true});
        if(result.status==='cancelled'){message(saved?`已导出 ${saved} 份，剩余已取消`:'已取消导出');return;}
        if(result.status==='failed')throw Error('文件保存失败，请检查保存位置后重试');
        saved++;
      }
      if(generation===host.generation)message(saved?`已导出 ${saved} 份文件`:'当前范围没有可导出的字幕');
    } catch(error){if(generation===host.generation)message(error.message||String(error));}
    finally {busy=false;el('fields').disabled=false;el('start').textContent='开始导出';refresh();}
  }
  function open(format) {
    host.commitEdits();if(format)el('format').value=format;
    for(const [id,key] of [['export-speaker-labels','exportSpeakerLabels'],['export-speaker-names-suffix','exportSpeakerNamesAsSuffix'],['export-start-at-zero','exportStartAtZero'],['export-color-unified','exportColorUnified']])document.getElementById(id).checked=EDITOR_SETTINGS[key]===true;
    if(filenameProject!==host.generation){filenameProject=host.generation;el('filename').value=FILENAME_BASE;}
    applyMediaSizeToResolutionModal(el('resolution'),el('custom-size'),el('width'),el('height'));
    message('');floating.open();refresh();
  }
  el('btn').addEventListener('click',()=>open());el('close').addEventListener('click',()=>floating.close());el('start').addEventListener('click',()=>void start());
  panel.addEventListener('input',event=>{if(event.target.type!=='checkbox'){message('');refresh();}});panel.addEventListener('change',refresh);
  global.addEventListener('msw:subtitles-changed',refresh);
  global.addEventListener('msw:project-changed',()=>{setScope(null);trackKey='';filenameProject=null;message('');if(floating.isOpen())queueMicrotask(()=>open());});
  global.MSWSubtitleExport={open,refresh};
})(window);
