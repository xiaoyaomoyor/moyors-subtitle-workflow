(function(global) {
  'use strict';
  const host=global.MSWE?.resolve('processing-host'), S=global.MSWProjectStyle;
  if(!host || !S) return;
  const t=s=>global.MSWE_I18N?.translateText?.(s)||s, $=id=>document.getElementById(id);
  const old=document.querySelector('.subtitle-preview-settings-section');
  old.hidden=true;
  const panel=document.createElement('section');panel.className='settings-panel-section msw-project-style';
  panel.id='project-subtitle-style';old.before(panel);
  const icons={save:'<path d="M14 21H3V3h14l4 4v6M7 3v6h10V3M7 21v-7h7m4 2v6m-3-3h6"/>',reset:'<path d="M3 10a9 9 0 1 1 2 8M3 3v7h7"/>',delete:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',fonts:'<path d="M3 6V3h18v3M12 3v18m-4 0h8"/>'};
  const iconButton=(id,name,icon)=>`<button type="button" id="${id}" class="msw-style-icon" title="${t(name)}" aria-label="${t(name)}"><svg viewBox="0 0 24 24" aria-hidden="true">${icons[icon]}</svg></button>`;
  icons.swap='<path d="M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4"/>';
  panel.innerHTML=`<span class="settings-panel-title">字幕样式</span>
    <div class="media-settings-grid msw-style-selectors">
      <label class="media-settings-field" data-option-help="跟随工程样式时预览工程输出；也可选择已有预设，仅用于播放器校对。下方始终编辑工程样式，修改不会切换预览选择。"><span class="msw-option-label">预览样式</span><select id="style-preview-mode"></select></label>
      <label class="media-settings-field" data-option-help="工程样式随工程保存，用于 ASS 导出和默认视频烧录；SRT 仅保存文字和时间。应用预设后调整只影响本工程。"><span class="msw-option-label">工程样式</span><select id="style-project-preset"></select></label>
    </div>
    <div id="style-migration-row" class="msw-style-notice" hidden><p id="style-migration-note" class="msw-processing-hint" hidden></p></div>
    <div class="msw-style-toolbar"><div class="msw-style-tabs" role="tablist" aria-label="字幕样式轨道"><button type="button" role="tab" id="style-main" aria-selected="true">主字幕</button><button type="button" role="tab" id="style-secondary" aria-selected="false" tabindex="-1">副字幕</button></div><div class="msw-style-actions" role="group" aria-label="样式预设操作">${iconButton('style-save-as','另存为新预设','save')}${iconButton('style-reset','恢复默认','reset')}${iconButton('style-delete-preset','删除预设','delete')}</div></div>
    <form id="style-save-form" class="msw-style-save-form" hidden><label class="media-settings-field"><span>预设名称</span><input id="style-preset-name" maxlength="80" required></label><button type="submit" id="style-save-preset">保存</button><button type="button" id="style-save-cancel">取消</button></form>
    <div id="style-delete-confirm" class="msw-style-delete-confirm" hidden><p id="style-delete-question"></p><div class="msw-processing-actions"><button type="button" id="style-delete-confirm-button">删除预设</button><button type="button" id="style-delete-cancel">取消</button></div></div>
    <details id="style-general" class="msw-style-section" open><summary>通用</summary><div id="style-basic-fields" class="msw-style-fields"></div></details>
    <details id="style-more" class="msw-style-section"><summary>进阶</summary><div id="style-emphasis-fields" class="msw-style-checks"></div><div id="style-advanced-fields" class="msw-style-fields"></div></details>
    <details id="style-animation" class="msw-style-section"><summary><span class="msw-option-label">动画</span></summary><div id="style-animation-fields"></div></details>
    <small data-help-for="style-animation" hidden>动画同时作用于主、副字幕。时间从每条字幕开始计算，单位为毫秒。</small>
    <p id="style-message" class="msw-processing-message" role="status"></p><button type="button" id="style-retry" hidden>重新加载样式</button>`;
  $('style-main').insertAdjacentHTML('afterend',iconButton('style-swap','交换主副样式（保留位置）','swap'));
  panel.querySelector('.msw-style-selectors').insertAdjacentHTML('beforebegin',`<div id="style-track-controls" class="media-settings-grid" hidden>
    <label class="media-settings-field" data-option-help="旧工程保留原画面排布。切换后对白按固定轨道顺序稳定避让，画面文字独立定位；处理和导出将在下一阶段接入。"><span class="msw-option-label">画面排布</span><select id="style-track-layout"><option value="legacy">保留旧排布</option><option value="fixed">固定轨道排布</option></select></label>
    <label class="media-settings-field"><span class="msw-option-label">编辑对象</span><select id="style-track-target"></select></label>
  </div>`);
  panel.querySelector('.msw-style-toolbar').insertAdjacentHTML('beforebegin',`<details id="style-track-position" class="msw-style-section" hidden open><summary>画面位置</summary>
    <div class="media-settings-grid">
      <label class="media-settings-field" data-option-help="横向为字幕组中心，纵向为字幕组顶部；百分比相对于视频内容，不包含黑边。轨道位置作用于没有位置覆盖的字幕；当前字幕以明确绑定的主副字幕为一组。"><span class="msw-option-label">定位对象</span><select id="style-position-scope"><option value="track">轨道位置</option><option value="cue">当前字幕位置</option></select></label>
      <button type="button" id="style-position-drag">在画面中定位</button>
      <label class="media-settings-field"><span>横向 (%)</span><input id="style-position-x" type="number" min="0" max="100" step="0.1" required></label>
      <label class="media-settings-field"><span>纵向 (%)</span><input id="style-position-y" type="number" min="0" max="100" step="0.1" required></label>
    </div><div class="msw-processing-actions"><button type="button" id="style-position-reset">恢复默认位置</button></div><p id="style-position-note" class="msw-processing-hint"></p>
  </details>`);
  panel.querySelector('.msw-style-toolbar').insertAdjacentHTML('beforebegin',`<div id="style-pair-controls" class="media-settings-grid">
    <label class="media-settings-field"><span class="msw-option-label">主副排列</span><select id="style-pair-order"><option value="main-above">主字幕在上</option><option value="secondary-above">副字幕在上</option></select></label>
    <label class="media-settings-field" data-option-help="以 1080p 为基准，随视频画面等比缩放。数值是文字行框之间的附加间距：0 不额外留空，负值压缩行框，过小时可能重叠。字号、字体、描边和纵向缩放会影响可见距离；相同数值不代表不同样式的字形边缘距离相同。压缩到极限后仍保留上下顺序。"><span class="msw-option-label">主副字幕间距</span><span class="gap-remove-number-control"><input id="style-pair-gap" type="number" min="-240" max="240" step="1" required><span class="gap-remove-unit">px</span></span></label>
  </div>`);
  panel.querySelector('.msw-style-tabs').setAttribute('role','group');
  for(const r of ['main','secondary']){$('style-'+r).removeAttribute('role');$('style-'+r).removeAttribute('aria-selected');$('style-'+r).removeAttribute('tabindex');}
  const basic=[['fontName','字体','text'],['fontSize','字号','number',1,512],['wrapMode','换行方式','select',[['auto','自动'],['characters','按字数']]],['charsPerLine','每行字数','number',1,200],['primaryColor','文字颜色','color'],['outlineColor','描边颜色','color'],['outline','描边宽度','number',0,100],['alignment','位置','select',[[7,'左上'],[8,'顶部居中'],[9,'右上'],[4,'左中'],[5,'居中'],[6,'右中'],[1,'左下'],[2,'底部居中'],[3,'右下']]]];
  const advanced=[['bold','粗体','checkbox'],['italic','斜体','checkbox'],['underline','下划线','checkbox'],['strikeOut','删除线','checkbox'],['borderStyle','边框样式','select',[[1,'描边'],[3,'背景框']]],['backColor','阴影／背景颜色','color'],['shadow','阴影距离','number',0,100],['spacing','字距','number',-100,100],['marginL','左边距','number',0,9999],['marginR','右边距','number',0,9999],['marginV','垂直边距','number',0,9999],['angle','旋转角度','number',-360,360],['scaleX','横向缩放 %','number',0,1000],['scaleY','纵向缩放 %','number',0,1000]];
  function fields(rows,target,animation=false) {
    for(const [key,caption,type,min,max,step] of rows) {
      const label=document.createElement('label');label.className='msw-style-field';
      const title=document.createElement('span');title.className='msw-option-label';title.textContent=t(caption);
      const input=document.createElement(type==='select'?'select':'input'); input.id=`style-field-${key.replaceAll('.','-')}`;
      input.dataset[animation?'animation':'styleField']=key;
      if(type==='select') for(const [value,name] of min) input.add(new Option(t(name),String(value)));
      else { input.type=type;if(type==='number'){input.min=min;input.max=max;input.step=step||1;}if(type==='text')input.maxLength=128; }
      if(type==='checkbox'){label.classList.add('msw-style-check');label.append(input,title);}else label.append(title,input);
      $(target).append(label);
    }
  }
  fields(basic,'style-basic-fields');fields(advanced.filter(r=>r[2]==='checkbox'),'style-emphasis-fields');fields(advanced.filter(r=>r[2]!=='checkbox'),'style-advanced-fields');
  $('style-field-fontSize').closest('label').dataset.optionHelp='字号、边距和动画坐标以 1080p 为基准，随画面尺寸缩放。';
  const fontList=document.createElement('datalist');fontList.id='style-local-fonts';panel.append(fontList);
  $('style-field-fontName').setAttribute('list',fontList.id);
  const fontInput=$('style-field-fontName'),fontControl=document.createElement('span');fontControl.className='msw-style-font-control';fontInput.before(fontControl);fontControl.append(fontInput);
  fontControl.insertAdjacentHTML('beforeend',iconButton('style-scan-fonts','读取本机字体','fonts'));const scanFonts=$('style-scan-fonts');
  scanFonts.onclick=async()=>{try{if(!global.queryLocalFonts)throw Error('当前浏览器不支持读取字体，可直接输入字体名称');const fonts=await global.queryLocalFonts();fontList.replaceChildren(...[...new Set(fonts.map(f=>f.family))].sort().map(name=>new Option(name,name)));message('本机字体已载入，可输入名称筛选。');}catch(e){message(e.message,true);}};
  const A=global.AsrEditorUtils.ASS_DEFAULT_ANIMATIONS;
  const captions={fad:'淡入淡出',fade:'分段透明度',move:'移动',t:'样式渐变',inMs:'淡入 (ms)',outMs:'淡出 (ms)',alpha1:'起始透明度',alpha2:'中间透明度',alpha3:'结束透明度',t1:'开始 (ms)',t2:'结束 (ms)',t3:'第三时间 (ms)',t4:'第四时间 (ms)',x1:'起点 X',y1:'起点 Y',x2:'终点 X',y2:'终点 Y',startMs:'开始 (ms)',endMs:'结束 (ms)',accel:'变化速率',tags:'ASS 渐变标签'};
  const animationHelp={fad:'字幕出现和结束时的淡入淡出时长。与分段透明度二选一。',move:'按字幕开始后的时间，从起点移动到终点；坐标以画面左上角为原点。',fade:'按四个时间点在三种透明度间过渡：0 为不透明，255 为完全透明。与淡入淡出二选一。',t:'在指定时间段逐渐改变样式。变化速率为 1 时匀速；自定义可填写 ASS 标签。'};
  for(const group of ['fad','move','fade','t']) {
    const card=document.createElement('div');card.className='msw-style-effect';card.id=`style-effect-${group}`;card.innerHTML=`<div id="style-effect-${group}-toggle"></div><div id="style-effect-${group}-fields" class="msw-style-fields" hidden></div>`;$('style-animation-fields').append(card);
    fields([[`${group}.enabled`,captions[group],'checkbox']],`style-effect-${group}-toggle`,true);
    $(`style-field-${group}-enabled`).closest('label').dataset.optionHelp=animationHelp[group];
    const rows=Object.entries(A[group]).filter(([key])=>key!=='enabled').map(([key,v])=>[`${group}.${key}`,group==='fade'&&/^t[1-4]$/.test(key)?t('时间点')+' '+key.slice(1)+' (ms)':captions[key],typeof v==='string'?'text':'number',/^[xy]/.test(key)?-65535:key==='accel'?.01:0,key.startsWith('alpha')?255:/^[xy]/.test(key)?65535:key==='accel'?100:60000,key==='accel'?.01:1]);
    fields(rows,`style-effect-${group}-fields`,true);
  }
  const opacityRow=document.createElement('div');opacityRow.className='msw-style-opacity-row';$('style-effect-fade-fields').prepend(opacityRow);
  for(const key of ['alpha1','alpha2','alpha3'])opacityRow.append($('style-field-fade-'+key).closest('label'));
  const transformTags=[['\\fscx120\\fscy120','放大至 120%'],['\\fscx80\\fscy80','缩小至 80%'],['\\blur3','逐渐模糊']];
  const transformChoice=document.createElement('label');transformChoice.className='msw-style-field msw-style-wide';transformChoice.innerHTML='<span class="msw-option-label">变化效果</span><select id="style-transform-preset"></select>';
  $('style-effect-t-fields').prepend(transformChoice);
  $('style-transform-preset').replaceChildren(...[...transformTags,['custom','自定义标签']].map(([id,name])=>new Option(t(name),id)));
  $('style-field-t-tags').closest('label').classList.add('msw-style-wide');$('style-field-t-tags').maxLength=512;
  $('style-field-t-tags').placeholder='\\fscx120\\fscy120';
  $('style-field-wrapMode').closest('label').dataset.optionHelp='自动按画面宽度换行；按字数为每行字幕正文设置上限（1–200）。汉字、英文字母、标点、空格各计 1，常见组合表情不拆开；保留手动换行。画面过窄时仍可能提前换行。仅影响预览、ASS 和烧录，不改写正文或 SRT。';
  global.MSWHelp?.hydrate(panel);
  let role='main',library=[],legacyLibrary=host.legacyAssLibrary(),selectedPreset='default',override=null,ready=false,styleGeneration=-1,loadError='',pendingAction=null,saving=false;
  let proof={mode:'project'},legacyProof=null;
  try {
    const saved=JSON.parse(localStorage.getItem('msw.subtitle-proof.v1')||'{}');proof.mode=saved.mode||'project';
    const old=saved.customStyle||(saved.mode==='custom'?saved.style:null);if(old)legacyProof=S.normalize(old);
  } catch(_) {}
  const projectStyle=()=>host.data.preview?.project_style || S.defaults();
  const all=()=>[...S.presets(),...library,...(host.data.preview?.style_migration?.presets||[]).map((s,i)=>({id:`migrated-${i}`,...s}))];
  const find=id=>all().find(s=>s.id===id);
  const value=()=>fixedTrackMode()&&fixedStyleTarget()?fixedStyleValue():projectStyle();
  const comparable=s=>fixedTrackMode()&&fixedStyleTarget()?S.forKind(s,fixedStyleTarget().kind):S.normalize(s);
  const same=(a,b)=>JSON.stringify({...comparable(a),name:''})===JSON.stringify({...comparable(b),name:''});
  const activePreset=()=>selectedPreset;
  const message=(text,error=false)=>{$('style-message').textContent=t(text);$('style-message').classList.toggle('is-error',error);};
  const persistProof=()=>{try{localStorage.setItem('msw.subtitle-proof.v1',JSON.stringify(proof));}catch(_){message('无法保存本机预览偏好',true);}};
  async function request(route,payload) {
    const response=await fetch(`${host.config.processingUrl}/${route}`,{method:payload?'POST':'GET',headers:{'X-MSW-Token':host.config.requestToken,...(payload?{'Content-Type':'application/json'}:{})},...(payload?{body:JSON.stringify(payload)}:{})});
    const result=await response.json();if(!response.ok || !result.ok)throw Error(result.error||'样式请求失败');return result;
  }
  function rebuild() {
    const fill=(element,items,selection)=>{element.replaceChildren(...items.map(([id,name])=>new Option(t(name),id)));element.value=selection;};
    fill($('style-preview-mode'),[['project','跟随工程样式'],['default','默认字幕样式'],...all().filter(s=>s.id!=='default').map(s=>[s.id,s.name])],proof.mode);
    if(!$('style-preview-mode').value){proof.mode='project';$('style-preview-mode').value='project';persistProof();}
    const track=fixedTrackMode()?fixedStyleTarget():null;
    $('style-track-controls').hidden=!fixedTrackMode();
    if(fixedTrackMode()) {
      fill($('style-track-target'),[['','工程默认'],...host.data.subtitle_tracks.tracks.map(t=>[t.id,t.name])],track?.id||'');
      $('style-track-layout').value=host.data.subtitle_tracks.presentation;
    }
    const chosen=track?track.style.selection:host.data.preview?.project_style_selection;
    selectedPreset=track?.style.mode==='inherit'?'inherit':chosen==='current'?'current':find(chosen)&&same(find(chosen),value())?chosen:all().find(s=>same(s,value()))?.id||'current';
    fill($('style-project-preset'),[...(track?[['inherit','继承工程样式']]:[]),['current','当前自定义'],...all().map(s=>[s.id,s.name])],selectedPreset);
    $('style-project-preset').closest('label').querySelector('.msw-option-label').firstChild.textContent=track?'轨道样式':'工程样式';
    const selected=$('video-export-style-source').value;
    fill($('video-export-style-source'),[['project','跟随工程样式'],...all().map(s=>['preset:'+s.id,s.name])],selected || 'project');
    if(!$('video-export-style-source').value)$('video-export-style-source').value='project';
  }
  function sync() {
    const style=S.normalize(value()||S.defaults());
    const track=fixedTrackMode()?fixedStyleTarget():null;
    const blocked=!!track&&(track.locked||!fixedPresentationMode());
    $('style-track-position').hidden=track?.kind!=='annotation'||!fixedPresentationMode();
    if(track?.kind==='annotation') {
      const p=fixedPositionCurrent(),group=fixedSelectedPositionGroup();
      $('style-position-scope').value=fixedPositionScope;
      for(const key of ['x','y']){$('style-position-'+key).value=Math.round(p[key]*1000)/10;$('style-position-'+key).disabled=blocked||fixedPositionScope==='cue'&&!group;}
      $('style-position-drag').disabled=blocked;$('style-position-reset').disabled=blocked||fixedPositionScope==='cue'&&!group;
      $('style-position-reset').textContent=fixedPositionScope==='cue'?'跟随轨道位置':'恢复默认位置';
      $('style-position-note').textContent=fixedPositionScope==='cue'?(group?'当前字幕：'+group.rows[0].cue.text:'点击“在画面中定位”，选择要调整的画面文字。'):'轨道位置作用于未单独定位的字幕。';
    }
    const removable=library.find(s=>s.id===activePreset()&&same(s,style));
    $('style-delete-preset').disabled=saving||!removable;
    $('style-delete-preset').title=removable?t('删除预设')+': '+removable.name:t('只能删除当前选用的用户预设');
    for(const id of ['style-save-as','style-reset','style-save-preset','style-save-cancel','style-delete-confirm-button','style-delete-cancel'])$(id).disabled=saving;
    for(const node of panel.querySelectorAll('[data-style-field],[data-animation],#style-project-preset,#style-pair-order,#style-pair-gap,#style-swap,#style-reset,#style-transform-preset'))node.disabled=saving||blocked;
    $('style-preset-name').disabled=saving;
    $('style-reset').title=t(track?'恢复本轨道的主、副字幕和动画默认值':'恢复工程的主、副字幕和动画默认值');
    if(track)message(track.locked?'此轨道已锁定。':!fixedPresentationMode()?'切换为固定轨道排布后，可调整轨道样式与位置。':'');
    const secondary=host.data.multi_subtitle?.enabled===true;
    $('style-secondary').hidden=!secondary;$('style-swap').hidden=!secondary;if(!secondary)role='main';
    $('style-pair-controls').hidden=!secondary;const pair=S.pairSettings(style);$('style-pair-order').value=pair.order;$('style-pair-gap').value=pair.gap;
    for(const r of ['main','secondary'])$('style-'+r).setAttribute('aria-pressed',String(role===r));
    for(const input of panel.querySelectorAll('[data-style-field]')) {const v=style[role][input.dataset.styleField];if(input.type==='checkbox')input.checked=!!v;else input.value=v??'';}
    for(const input of panel.querySelectorAll('[data-animation]')) {const [g,k]=input.dataset.animation.split('.'),v=style.animations[g][k];if(input.type==='checkbox')input.checked=!!v&&!(g==='fad'&&style.animations.fade.enabled);else input.value=v??'';}
    $('style-field-charsPerLine').closest('label').hidden=style[role].wrapMode!=='characters';
    $('style-preview-mode').value=proof.mode;
    for(const group of Object.keys(A))$(`style-effect-${group}-fields`).hidden=!$(`style-field-${group}-enabled`).checked;
    $('style-transform-preset').value=transformTags.some(([tags])=>tags===style.animations.t.tags)?style.animations.t.tags:'custom';
    $('style-field-t-tags').closest('label').hidden=$('style-transform-preset').value!=='custom';
    const note=host.data.preview?.style_migration;
    $('style-migration-row').hidden=!note?.notice;
    $('style-migration-note').hidden=!note?.notice;
    $('style-migration-note').textContent=t('已保留旧输出样式；原预览和 ASS 配置可在预设中找回。');
    if(note?.notice && !$('style-migration-dismiss')) {const b=document.createElement('button');b.id='style-migration-dismiss';b.type='button';b.textContent=t('知道了');b.onclick=()=>{const current=host.data.preview?.style_migration;if(current)current.notice=false;host.persistStyleMigration();sync();};$('style-migration-note').after(b);}
    if($('style-migration-dismiss'))$('style-migration-dismiss').hidden=!note?.notice;
  }
  function refresh() {
    host.useProjectStylePreview();host.refreshStylePreview();global.MSWSubtitleRenderer?.invalidate();
  }
  function change(style,selection='current',label='修改工程字幕样式') {
    if(!ready||styleGeneration!==host.generation)return;
    if(fixedTrackMode()&&fixedStyleTarget()) {
      if(!fixedCommitStyle(style,selection)){sync();message($('fixed-track-status')?.textContent||'无法修改轨道样式',true);return;}
    }
    else host.commitProjectStyle(style,label,selection);
    rebuild();sync();refresh();
  }
  function cancelAction(){pendingAction=null;$('style-save-form').hidden=true;$('style-delete-confirm').hidden=true;}
  $('style-track-layout').onchange=()=>{cancelAction();fixedSetPresentation($('style-track-layout').value);rebuild();sync();refresh();};
  function editTrack(id,open=true){cancelAction();fixedStyleTrackId=id;fixedPositionRef=null;rebuild();sync();if(open)host.openMediaSettings();}
  $('style-track-target').onchange=()=>editTrack($('style-track-target').value,false);
  $('style-position-scope').onchange=()=>{fixedPositionScope=$('style-position-scope').value;sync();};
  $('style-position-drag').onclick=()=>fixedStartPositioning();
  $('style-position-reset').onclick=()=>{fixedCommitPosition(null);sync();refresh();};
  for(const key of ['x','y'])$('style-position-'+key).onchange=()=>{
    if(!['x','y'].every(k=>$('style-position-'+k).checkValidity())){sync();return;}
    fixedCommitPosition({x:Number($('style-position-x').value)/100,y:Number($('style-position-y').value)/100});sync();refresh();
  };
  panel.addEventListener('change',event=>{
    // Becoming inert on project switch can flush a native change event from
    // the previously focused input. Never commit it into the new project.
    if(!ready||styleGeneration!==host.generation)return;
    const input=event.target,field=input.dataset.styleField,animation=input.dataset.animation;if(!field&&!animation)return;
    if(!input.checkValidity()){input.reportValidity();sync();return;}
    const style=S.normalize(value()),v=input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.tagName==='SELECT'&&field!=='wrapMode'?Number(input.value):input.value;
    // Exact legacy burn parameters survive until the user deliberately edits them.
    if(style.legacyBurn&&!['wrapMode','charsPerLine'].includes(field)){
      const mapped={fontName:'font_family',fontSize:'font_size',primaryColor:'color',outlineColor:'outline_color',outline:'outline',backColor:'background_color'}[field];
      if(mapped && !(field==='fontSize'&&(v<8||v>200)) && !(field==='outline'&&v>12)) {style.legacyBurn[role] ||= {};style.legacyBurn[role][mapped]=v;}
      else {delete style.legacyBurn;message('已转换为工程 ASS 样式，请在播放器确认背景与位置。');}
    }
    if(field)style[role][field]=v;else{
      const [g,k]=animation.split('.');style.animations[g][k]=v;
      if(k==='enabled'&&v){
        if(g==='fad')style.animations.fade.enabled=false;
        if(g==='fade')style.animations.fad.enabled=false;
        if(g==='t'&&!style.animations.t.tags)style.animations.t.tags=transformTags[0][0];
      }
    }
    // Direct position edits take precedence over the paired arrangement.
    if(['alignment','marginV'].includes(field))delete style.pairLayout;
    if(!style.name.endsWith(' · 已修改'))style.name+=' · 已修改';change(style);
  });
  $('style-preview-mode').onchange=()=>{
    cancelAction();proof.mode=$('style-preview-mode').value;persistProof();rebuild();sync();refresh();
  };
  for(const r of ['main','secondary'])$('style-'+r).onclick=()=>{role=r;sync();};
  $('style-swap').onclick=()=>{cancelAction();change(S.swapAppearance(value()),'current','交换主副字幕样式');};
  for(const id of ['style-pair-order','style-pair-gap'])$(id).onchange=()=>{
    if(!$('style-pair-gap').checkValidity()){$('style-pair-gap').reportValidity();sync();return;}
    cancelAction();change(S.arrangePair(value(),{order:$('style-pair-order').value,gap:Number($('style-pair-gap').value)}),'current','调整主副字幕排列');
  };
  panel.querySelector('.msw-style-tabs').addEventListener('keydown',event=>{
    if(!['style-main','style-secondary'].includes(event.target.id)||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)||$('style-secondary').hidden)return;
    event.preventDefault();role=event.key==='Home'?'main':event.key==='End'?'secondary':role==='main'?'secondary':'main';sync();$('style-'+role).focus();
  });
  $('style-project-preset').onchange=()=>{
    const selection=$('style-project-preset').value;
    const track=fixedTrackMode()?fixedStyleTarget():null;
    const preset=selection==='inherit'?projectStyle():selection==='current'?(track?(track.style.custom||value()):(host.data.preview?.project_style_custom||projectStyle())):find(selection);
    if(!preset){rebuild();return;}cancelAction();change(track?S.forKind(preset,track.kind):preset,selection);
  };
  $('style-reset').onclick=()=>{cancelAction();change(S.defaults());};
  $('style-transform-preset').onchange=()=>{
    const tags=$('style-transform-preset').value;
    if(tags==='custom'){$('style-field-t-tags').closest('label').hidden=false;$('style-field-t-tags').focus();return;}
    $('style-field-t-tags').value=tags;$('style-field-t-tags').dispatchEvent(new Event('change',{bubbles:true}));
  };
  async function saveLibrary(next) {
    if(host.config?.processingUrl)await request('subtitle-presets',{version:1,presets:next});
    else localStorage.setItem('msw.subtitle-presets.v1',JSON.stringify(next));
    library=next;
  }
  $('style-save-as').onclick=()=>{
    cancelAction();pendingAction={kind:'save',generation:host.generation};
    $('style-preset-name').value=value().name;$('style-save-form').hidden=false;$('style-preset-name').focus();$('style-preset-name').select();
  };
  $('style-save-cancel').onclick=()=>{cancelAction();$('style-save-as').focus();};
  $('style-delete-cancel').onclick=()=>{cancelAction();$('style-delete-preset').focus();};
  async function runLibraryAction(action,next,success){
    if(saving)return;saving=true;sync();
    try{
      await saveLibrary(next);
      if(action.generation!==host.generation)return;
      if(action===pendingAction){success();cancelAction();}
      rebuild();sync();syncExport();
    }catch(error){if(action.generation===host.generation)message(error.message,true);}
    finally{saving=false;sync();}
  }
  $('style-save-form').onsubmit=event=>{
    event.preventDefault();const action=pendingAction;if(action?.kind!=='save'||saving)return;
    const name=$('style-preset-name').value.trim();if(!name){$('style-preset-name').focus();message('请输入预设名称',true);return;}
    if(all().some(s=>s.name===name)){message('已有同名预设，请使用新名称',true);return;}
    const preset={...S.presetSnapshot(host.data,value(),fixedTrackMode()?fixedStyleTarget()?.kind:'dialogue'),name,id:global.MSWProject.id('style')};
    const savedStyle=S.normalize(value());
    const target=fixedStyleTrackId;
    void runLibraryAction(action,[...library,preset],()=>{if(target===fixedStyleTrackId&&same(value(),savedStyle))change(fixedTrackMode()&&fixedStyleTarget()?S.forKind(preset,fixedStyleTarget().kind):preset,preset.id,'另存为字幕预设');message('预设已保存；包含对白和画面文字基础样式。');$('style-save-as').focus();});
  };
  $('style-delete-preset').onclick=()=>{
    const preset=library.find(s=>s.id===activePreset());if(!preset)return;cancelAction();pendingAction={kind:'delete',id:preset.id,generation:host.generation};
    $('style-delete-question').textContent=t('删除预设')+'「'+preset.name+'」？'+t('已应用到工程的样式会保留。');$('style-delete-confirm').hidden=false;$('style-delete-cancel').focus();
  };
  $('style-delete-confirm-button').onclick=()=>{
    const action=pendingAction;if(action?.kind!=='delete')return;
    void runLibraryAction(action,library.filter(s=>s.id!==action.id),()=>{message('预设已删除；工程样式保持不变。');$('style-save-as').focus();});
  };
  const exportPanel=$('video-export-panel');
  const exportPreset=()=>find($('video-export-style-source').value.replace(/^preset:/,''));
  function syncExport() {
    const opened=exportPanel.getAttribute('aria-hidden')==='false',target=$('video-export-burn-subtitles').value;
    const enabled=opened&&target!=='none',other=$('video-export-style-source').value!=='project';
    $('video-export-style-choice').hidden=target==='none';
    override=enabled?{style:S.normalize(other?(exportPreset()||S.defaults()):projectStyle()),target,other,label:other?(exportPreset()?.name||'默认白字'):'工程样式'}:null;
    refresh();
  }
  for(const id of ['video-export-burn-subtitles','video-export-style-source'])$(id).addEventListener('change',syncExport);
  new MutationObserver(syncExport).observe(exportPanel,{attributes:true,attributeFilter:['aria-hidden']});
  const settingsPanel=$('media-settings-modal');
  new MutationObserver(()=>{
    if(settingsPanel.getAttribute('aria-hidden')==='true')cancelAction();
  }).observe(settingsPanel,{attributes:true,attributeFilter:['aria-hidden']});
  function currentPreview() {
    if(override)return {...override,scope:'export',label:'导出预览：'+override.label};
    const target=host.subtitlePreviewTarget();
    return {style:proof.mode==='project'?projectStyle():S.normalize(find(proof.mode)||S.defaults()),target,scope:proof.mode==='project'?'project':'proof',label:proof.mode==='project'?'工程字幕样式':'仅影响预览'};
  }
  global.MSWSubtitleStyle={currentPreview,editTrack,previewLibrary:()=>S.toLibrary(currentPreview().style),
    applyExport:project=>{
      if($('video-export-burn-subtitles').value==='none')return;
      if(!ready)throw Error('工程字幕样式尚未加载，请稍后导出');
      const other=$('video-export-style-source').value!=='project';
      if(other)S.applyPreset(project,exportPreset()||S.defaults());else S.apply(project,projectStyle());
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
      // Preserve the removed custom-preview preference as an ordinary preset.
      if(legacyProof){
        let preset=all().find(s=>same(s,legacyProof));
        if(!preset){
          let name='已保存的预览样式',suffix=2;while(all().some(s=>s.name===name))name='已保存的预览样式 '+suffix++;
          preset={...legacyProof,name,id:global.MSWProject.id('style')};await saveLibrary([...library,preset]);
        }
        if(generation!==host.generation)return;
        if(proof.mode==='custom')proof.mode=preset.id;legacyProof=null;persistProof();
      }
      if(S.migrate(host.data,legacyLibrary,host.originalSubtitlePreview()))host.persistStyleMigration();
      styleGeneration=generation;ready=true;message('');rebuild();sync();syncExport();
    } catch(error) {if(generation===host.generation){loadError=error.message;message('字幕样式加载失败：'+error.message,true);$('style-retry').hidden=false;}}
    finally {if(generation===host.generation)panel.inert=false;}
  }
  $('style-retry').onclick=()=>void initialize();
  global.addEventListener('msw:project-changed',()=>{cancelAction();override=null;role='main';void initialize();});
  global.addEventListener('msw:burn-style',()=>{if(ready){rebuild();sync();if(override)syncExport();else refresh();}});
  global.addEventListener('msw:subtitles-changed',()=>{if(ready){if(fixedTrackMode())rebuild();sync();}});
  global.addEventListener('msw:media-changed',()=>{if(ready){sync();refresh();}});
  void initialize();
})(window);
