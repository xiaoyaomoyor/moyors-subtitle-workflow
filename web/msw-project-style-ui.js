(function(global) {
  'use strict';
  const host=global.MSWE?.resolve('processing-host'), S=global.MSWProjectStyle;
  if(!host || !S) return;
  const t=s=>global.MSWE_I18N?.translateText?.(s)||s, $=id=>document.getElementById(id);
  const old=document.querySelector('.subtitle-preview-settings-section');
  old.hidden=true;
  const panel=document.createElement('section');panel.className='settings-panel-section msw-project-style';
  panel.id='project-subtitle-style';old.before(panel);
  panel.innerHTML=`<div class="msw-style-heading"><span class="settings-panel-title">字幕样式</span><span id="style-scope" class="msw-style-badge"></span></div>
    <label class="settings-panel-item" data-option-help="默认跟随工程样式。默认、大字、高对比及自定义校对样式只影响播放器，不改变 ASS 或视频输出。">预览样式<select id="style-preview-mode"></select></label>
    <div id="style-custom-preview" hidden><button type="button" id="style-edit-proof">调整自定义预览</button></div>
    <p id="style-migration-note" class="msw-processing-hint" hidden></p>
    <div class="msw-style-heading"><strong id="style-editor-title">工程字幕样式</strong><button type="button" id="style-manage">管理预设</button><button type="button" id="style-back" hidden>返回工程</button></div>
    <label class="settings-panel-item" id="style-preset-label" data-option-help="工程样式随工程保存，用于 ASS 导出和默认视频烧录；SRT 仅保存文字和时间。应用预设后调整只影响本工程。">样式预设<select id="style-project-preset"></select></label>
    <div id="style-library-actions" hidden><label class="settings-panel-item">预设名称<input id="style-preset-name" maxlength="80"></label><div class="msw-processing-actions"><button id="style-new-preset" type="button">新建</button><button id="style-save-preset" type="button">保存预设</button><button id="style-delete-preset" type="button">删除预设</button></div></div>
    <div class="msw-style-tabs" role="tablist" aria-label="字幕样式轨道"><button type="button" role="tab" id="style-main" aria-selected="true">主字幕</button><button type="button" role="tab" id="style-secondary" aria-selected="false">副字幕</button></div>
    <div id="style-basic-fields" class="msw-style-fields"></div>
    <details id="style-more"><summary>更多设置</summary><div id="style-advanced-fields" class="msw-style-fields"></div><details><summary>字幕动画</summary><div id="style-animation-fields" class="msw-style-fields"></div></details></details>
    <div class="msw-processing-actions" id="style-project-actions"><button type="button" id="style-reset">恢复默认</button><button type="button" id="style-save-as">另存为预设</button></div>
    <p id="style-message" class="msw-processing-message" role="status"></p><button type="button" id="style-retry" hidden>重新加载样式</button>`;
  const basic=[['fontName','字体','text'],['fontSize','字号（1080p 基准）','number',1,512],['primaryColor','文字颜色','color'],['outlineColor','描边颜色','color'],['outline','描边宽度','number',0,100,.5],['alignment','位置','select',[[7,'左上'],[8,'顶部居中'],[9,'右上'],[4,'左中'],[5,'居中'],[6,'右中'],[1,'左下'],[2,'底部居中'],[3,'右下']]]];
  const advanced=[['bold','粗体','checkbox'],['italic','斜体','checkbox'],['underline','下划线','checkbox'],['strikeOut','删除线','checkbox'],['borderStyle','边框样式','select',[[1,'描边'],[3,'背景框']]],['backColor','阴影／背景颜色','color'],['shadow','阴影距离','number',0,30,.5],['marginL','左边距','number',0,4000],['marginR','右边距','number',0,4000],['marginV','垂直边距','number',0,4000],['spacing','字距','number',-100,100,.5],['scaleX','横向缩放 %','number',1,1000],['scaleY','纵向缩放 %','number',1,1000],['angle','旋转角度','number',-360,360]];
  function fields(rows,target,animation=false) {
    for(const [key,caption,type,min,max,step] of rows) {
      const label=document.createElement('label');label.textContent=t(caption);
      const input=document.createElement(type==='select'?'select':'input'); input.id=`style-field-${key.replaceAll('.','-')}`;
      input.dataset[animation?'animation':'styleField']=key;
      if(type==='select') for(const [value,name] of min) input.add(new Option(t(name),String(value)));
      else { input.type=type;if(type==='number'){input.min=min;input.max=max;input.step=step||1;}if(type==='text')input.maxLength=128; }
      label.append(input);$(target).append(label);
    }
  }
  fields(basic,'style-basic-fields');fields(advanced,'style-advanced-fields');
  const fontList=document.createElement('datalist');fontList.id='style-local-fonts';panel.append(fontList);
  $('style-field-fontName').setAttribute('list',fontList.id);
  const scanFonts=document.createElement('button');scanFonts.type='button';scanFonts.textContent=t('读取本机字体');
  $('style-field-fontName').after(scanFonts);
  scanFonts.onclick=async()=>{try{if(!global.queryLocalFonts)throw Error('当前浏览器不支持读取字体，可直接输入字体名称');const fonts=await global.queryLocalFonts();fontList.replaceChildren(...[...new Set(fonts.map(f=>f.family))].sort().map(name=>new Option(name,name)));message('本机字体已载入，可输入名称筛选。');}catch(e){message(e.message,true);}};
  const A=global.AsrEditorUtils.ASS_DEFAULT_ANIMATIONS;
  const captions={fad:'淡入淡出',fade:'分段透明度',move:'移动',t:'渐变标签',inMs:'淡入毫秒',outMs:'淡出毫秒',alpha1:'起始透明度',alpha2:'中间透明度',alpha3:'结束透明度',t1:'起始毫秒',t2:'第二时间',t3:'第三时间',t4:'结束毫秒',x1:'起点 X',y1:'起点 Y',x2:'终点 X',y2:'终点 Y',startMs:'起始毫秒',endMs:'结束毫秒',accel:'加速度',tags:'ASS 渐变标签'};
  for(const [group,values] of Object.entries(A)) {
    const rows=Object.entries(values).map(([key,value])=>[`${group}.${key}`,key==='enabled'?captions[group]:captions[key]||key,typeof value==='boolean'?'checkbox':typeof value==='string'?'text':'number',key.startsWith('alpha')?0:key==='accel'?.1:-100000, key.startsWith('alpha')?255:100000,key==='accel'?.1:1]);
    fields(rows,'style-animation-fields',true);
  }
  let role='main',context='project',library=[],legacyLibrary=host.legacyAssLibrary(),draft=null,selectedPreset='default',override=null,ready=false,loadError='';
  let proof={mode:'project',style:S.defaults()};
  try { proof={...proof,...JSON.parse(localStorage.getItem('msw.subtitle-proof.v1')||'{}')};proof.style=S.normalize(proof.style); } catch(_) {}
  const projectStyle=()=>host.data.preview?.project_style || S.defaults();
  const all=()=>[...S.presets(),...library,...(host.data.preview?.style_migration?.presets||[]).map((s,i)=>({id:`migrated-${i}`,...s}))];
  const find=id=>all().find(s=>s.id===id);
  const value=()=>context==='library'?draft:context==='proof'?proof.style:projectStyle();
  const message=(text,error=false)=>{$('style-message').textContent=t(text);$('style-message').classList.toggle('is-error',error);};
  const persistProof=()=>{try{localStorage.setItem('msw.subtitle-proof.v1',JSON.stringify(proof));}catch(_){message('无法保存本机预览偏好',true);}};
  async function request(route,payload) {
    const response=await fetch(`${host.config.processingUrl}/${route}`,{method:payload?'POST':'GET',headers:{'X-MSW-Token':host.config.requestToken,...(payload?{'Content-Type':'application/json'}:{})},...(payload?{body:JSON.stringify(payload)}:{})});
    const result=await response.json();if(!response.ok || !result.ok)throw Error(result.error||'样式请求失败');return result;
  }
  function rebuild() {
    const fill=(element,items,selection)=>{element.replaceChildren(...items.map(([id,name])=>new Option(t(name),id)));element.value=selection;};
    fill($('style-preview-mode'),[['project','跟随工程样式'],['default','默认字幕样式'],...all().filter(s=>s.id!=='default').map(s=>[s.id,s.name]),['custom','自定义预览样式']],proof.mode);
    if(!$('style-preview-mode').value){proof.mode='custom';$('style-preview-mode').value='custom';persistProof();}
    fill($('style-project-preset'),[['current',context==='project'?projectStyle().name:'当前自定义'],...all().map(s=>[s.id,s.name])],context==='library'?selectedPreset:'current');
    if(!$('style-project-preset').value)$('style-project-preset').value='current';
    const selected=$('video-export-style-preset').value;
    fill($('video-export-style-preset'),all().map(s=>[s.id,s.name]),selected || 'default');
    if(!$('video-export-style-preset').value)$('video-export-style-preset').value='default';
  }
  function sync() {
    const style=value()||S.defaults();
    $('style-editor-title').textContent=t(context==='library'?'字幕样式预设':context==='proof'?'自定义预览 · 仅影响预览':'工程字幕样式');
    $('style-back').hidden=context==='project';$('style-manage').hidden=context!=='project';
    $('style-library-actions').hidden=context!=='library';$('style-project-actions').hidden=context==='library';
    $('style-preset-name').value=style.name;$('style-preset-label').hidden=context==='proof';
    $('style-delete-preset').disabled=!library.some(s=>s.id===selectedPreset);
    $('style-save-preset').textContent=t(library.some(s=>s.id===selectedPreset)?'保存预设':'保存为新预设');
    $('style-custom-preview').hidden=proof.mode!=='custom';
    const secondary=host.data.multi_subtitle?.enabled===true || context==='library';
    $('style-secondary').hidden=!secondary;if(!secondary)role='main';
    for(const r of ['main','secondary'])$('style-'+r).setAttribute('aria-selected',String(role===r));
    for(const input of panel.querySelectorAll('[data-style-field]')) {const v=style[role][input.dataset.styleField];if(input.type==='checkbox')input.checked=!!v;else input.value=v??'';}
    for(const input of panel.querySelectorAll('[data-animation]')) {const [g,k]=input.dataset.animation.split('.'),v=style.animations[g][k];if(input.type==='checkbox')input.checked=!!v;else input.value=v??'';}
    $('style-preview-mode').value=proof.mode;
    $('style-scope').textContent=t(proof.mode==='project'?'跟随工程':'仅影响预览');
    const note=host.data.preview?.style_migration;
    $('style-migration-note').hidden=!note?.notice;
    $('style-migration-note').textContent=t('已保留旧输出样式；原预览和 ASS 配置可在预设中找回。');
    if(note?.notice && !$('style-migration-dismiss')) {const b=document.createElement('button');b.id='style-migration-dismiss';b.type='button';b.textContent=t('知道了');b.onclick=()=>{const current=host.data.preview?.style_migration;if(current)current.notice=false;host.persistStyleMigration();sync();};$('style-migration-note').after(b);}
    if($('style-migration-dismiss'))$('style-migration-dismiss').hidden=!note?.notice;
  }
  function refresh() {
    host.useProjectStylePreview();host.refreshStylePreview();global.MSWSubtitleRenderer?.invalidate();
  }
  function change(style) {
    if(context==='library')draft=S.normalize(style);
    else if(context==='proof'){proof.style=S.normalize(style);persistProof();}
    else {proof.mode='project';persistProof();host.commitProjectStyle(style);}
    rebuild();sync();refresh();
  }
  panel.addEventListener('change',event=>{
    const input=event.target,field=input.dataset.styleField,animation=input.dataset.animation;if(!field&&!animation)return;
    if(!input.checkValidity()){input.reportValidity();sync();return;}
    const style=S.clone(value()),v=input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.tagName==='SELECT'?Number(input.value):input.value;
    // Exact legacy burn parameters survive until the user deliberately edits them.
    if(style.legacyBurn){
      const mapped={fontName:'font_family',fontSize:'font_size',primaryColor:'color',outlineColor:'outline_color',outline:'outline',backColor:'background_color'}[field];
      if(mapped && !(field==='fontSize'&&(v<8||v>200)) && !(field==='outline'&&v>12)) {style.legacyBurn[role] ||= {};style.legacyBurn[role][mapped]=v;}
      else {delete style.legacyBurn;message('已转换为工程 ASS 样式，请在播放器确认背景与位置。');}
    }
    if(field)style[role][field]=v;else{const [g,k]=animation.split('.');style.animations[g][k]=v;}
    if(context==='project'&&!style.name.endsWith(' · 已修改'))style.name+=' · 已修改';change(style);
  });
  $('style-preview-mode').onchange=()=>{proof.mode=$('style-preview-mode').value;if(proof.mode!=='project'&&proof.mode!=='custom')proof.style=S.normalize(find(proof.mode)||S.defaults());context=proof.mode==='custom'?'proof':'project';persistProof();rebuild();sync();refresh();};
  $('style-edit-proof').onclick=()=>{context='proof';sync();};
  for(const r of ['main','secondary'])$('style-'+r).onclick=()=>{role=r;sync();};
  $('style-project-preset').onchange=()=>{const preset=find($('style-project-preset').value);if(!preset)return;if(context==='library'){selectedPreset=preset.id;draft=S.normalize(preset);sync();refresh();}else{change(preset);rebuild();}};
  $('style-manage').onclick=()=>{context='library';selectedPreset='default';draft=S.defaults();rebuild();sync();refresh();$('style-editor-title').scrollIntoView({block:'start'});};
  $('style-back').onclick=()=>{context='project';draft=null;rebuild();sync();refresh();};
  $('style-reset').onclick=()=>change(S.defaults());
  async function saveLibrary(next) {
    if(host.config?.processingUrl)await request('subtitle-presets',{version:1,presets:next});
    else localStorage.setItem('msw.subtitle-presets.v1',JSON.stringify(next));
    library=next;rebuild();sync();message('预设已保存；已应用到工程的样式不受影响。');
  }
  $('style-save-as').onclick=()=>{draft=S.normalize(value());context='library';selectedPreset='new';rebuild();sync();$('style-preset-name').focus();};
  $('style-new-preset').onclick=()=>{draft=S.defaults();draft.name='新预设';selectedPreset='new';rebuild();sync();refresh();};
  $('style-save-preset').onclick=async()=>{try{const existing=library.find(s=>s.id===selectedPreset),id=existing?.id||global.MSWProject.id('style');const preset={...S.normalize({...draft,name:$('style-preset-name').value}),id};await saveLibrary([...library.filter(s=>s.id!==id),preset]);selectedPreset=id;draft=S.normalize(preset);rebuild();sync();refresh();}catch(e){message(e.message,true);}};
  $('style-delete-preset').onclick=async()=>{try{await saveLibrary(library.filter(s=>s.id!==selectedPreset));selectedPreset='default';draft=S.defaults();rebuild();sync();}catch(e){message(e.message,true);}};
  const exportPanel=$('video-export-panel');
  function syncExport() {
    const opened=exportPanel.getAttribute('aria-hidden')==='false',target=$('video-export-burn-subtitles').value;
    const enabled=opened&&target!=='none',other=$('video-export-style-source').value==='preset';
    $('video-export-style-choice').hidden=target==='none';$('video-export-preset-field').hidden=!other;
    override=enabled?{style:S.normalize(other?(find($('video-export-style-preset').value)||S.defaults()):projectStyle()),target,label:other?(find($('video-export-style-preset').value)?.name||'默认白字'):'工程样式'}:null;
    refresh();
  }
  for(const id of ['video-export-burn-subtitles','video-export-style-source','video-export-style-preset'])$(id).addEventListener('change',syncExport);
  new MutationObserver(syncExport).observe(exportPanel,{attributes:true,attributeFilter:['aria-hidden']});
  const settingsPanel=$('media-settings-modal');
  new MutationObserver(()=>{
    if(settingsPanel.getAttribute('aria-hidden')==='true' && context==='library') {
      context='project';draft=null;rebuild();sync();refresh();
    }
  }).observe(settingsPanel,{attributes:true,attributeFilter:['aria-hidden']});
  function currentPreview() {
    if(override)return {...override,scope:'export',label:'导出预览：'+override.label};
    const target=host.subtitlePreviewTarget();
    if(context==='library')return {style:draft||S.defaults(),target,scope:'preset',label:'预设预览：'+(draft?.name||'')};
    return {style:proof.mode==='project'?projectStyle():proof.style,target,scope:proof.mode==='project'?'project':'proof',label:proof.mode==='project'?'工程字幕样式':'仅影响预览'};
  }
  global.MSWSubtitleStyle={currentPreview,previewLibrary:()=>S.toLibrary(currentPreview().style),
    applyExport:project=>{
      if($('video-export-burn-subtitles').value==='none')return;
      if(!ready)throw Error('工程字幕样式尚未加载，请稍后导出');
      const other=$('video-export-style-source').value==='preset';
      S.apply(project,(other?find($('video-export-style-preset').value):projectStyle())||S.defaults());
    },
    get ready(){return ready;},get error(){return loadError;},request};
  async function initialize() {
    ready=false;loadError='';panel.inert=true;$('style-retry').hidden=true;
    const generation=host.generation;
    try {
      if(host.config?.processingUrl) {
        const response=await fetch(host.config.assStylesUrl);if(!response.ok)throw Error('无法读取旧 ASS 样式库');legacyLibrary=await response.json();
        library=(await request('subtitle-presets')).presets;
      } else library=JSON.parse(localStorage.getItem('msw.subtitle-presets.v1')||'[]');
      if(!Array.isArray(library))library=[];
      if(generation!==host.generation)return;
      if(S.migrate(host.data,legacyLibrary,host.originalSubtitlePreview()))host.persistStyleMigration();
      ready=true;message('');rebuild();sync();syncExport();
    } catch(error) {if(generation===host.generation){loadError=error.message;message('字幕样式加载失败：'+error.message,true);$('style-retry').hidden=false;}}
    finally {if(generation===host.generation)panel.inert=false;}
  }
  $('style-retry').onclick=()=>void initialize();
  global.addEventListener('msw:project-changed',()=>{override=null;context='project';role='main';void initialize();});
  global.addEventListener('msw:burn-style',()=>{if(ready){rebuild();sync();if(override)syncExport();else refresh();}});
  global.addEventListener('msw:subtitles-changed',()=>{if(ready)sync();});
  global.addEventListener('msw:media-changed',()=>{if(ready){sync();refresh();}});
  void initialize();
})(window);
