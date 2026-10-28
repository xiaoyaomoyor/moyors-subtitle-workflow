(function(global) {
  'use strict';
  const host=global.MSWE?.resolve('processing-host'), S=global.MSWProjectStyle;
  if(!host || !S) return;
  const propertyRoot=waveformEditor?.properties||document.getElementById('subtitle-properties');
  const t=s=>global.MSWE_I18N?.translateText?.(s)||s, $=id=>document.getElementById(id)||(id===propertyRoot.id?propertyRoot:propertyRoot.querySelector('#'+id));
  const old=document.querySelector('.subtitle-preview-settings-section');
  old.hidden=true;
  const panel=document.createElement('section');panel.className='settings-panel-section msw-project-style';
  panel.id='project-subtitle-style';$('subtitle-properties-content').append(panel);
  const icons={save:'<path d="M14 21H3V3h14l4 4v6M7 3v6h10V3M7 21v-7h7m4 2v6m-3-3h6"/>',reset:'<path d="M3 10a9 9 0 1 1 2 8M3 3v7h7"/>',delete:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',fonts:'<path d="M3 6V3h18v3M12 3v18m-4 0h8"/>'};
  const iconButton=(id,name,icon)=>`<button type="button" id="${id}" class="msw-style-icon" title="${t(name)}" aria-label="${t(name)}"><svg viewBox="0 0 24 24" aria-hidden="true">${icons[icon]}</svg></button>`;
  icons.swap='<path d="M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4"/>';
  icons.overwrite='<path d="M20 11V7l-4-4H3v18h10M7 3v6h9V3M7 21v-7h5m3 3h7m-3-3 3 3-3 3"/>';
  panel.innerHTML=`
    <div class="media-settings-grid msw-style-selectors">
      <label class="media-settings-field" data-option-help="跟随工程，或使用预设校对；预览选择不影响导出。"><span class="msw-option-label">预览样式</span><select id="style-preview-mode"></select></label>
      <label class="media-settings-field" data-option-help="作用于当前对象。修改立即生效；覆盖或另存才更新预设。所选字幕只应用外观。"><span class="msw-option-label">工程样式</span><select id="style-project-preset"></select></label>
    </div>
    <div class="msw-style-toolbar"><div class="msw-style-tabs" role="tablist" aria-label="字幕样式轨道"><button type="button" role="tab" id="style-main" aria-selected="true">主字幕</button><button type="button" role="tab" id="style-secondary" aria-selected="false" tabindex="-1">副字幕</button></div><div class="msw-style-actions" role="group" aria-label="样式预设操作">${iconButton('style-save-as','另存为新预设','save')}${iconButton('style-reset','恢复默认','reset')}${iconButton('style-delete-preset','删除预设','delete')}</div></div>
    <form id="style-save-form" class="msw-style-save-form" hidden><label class="media-settings-field"><span>预设名称</span><input id="style-preset-name" maxlength="80" required></label><button type="submit" id="style-save-preset">保存</button><button type="button" id="style-save-cancel">取消</button></form>
    <div id="style-delete-confirm" class="msw-style-delete-confirm" hidden><p id="style-delete-question"></p><div class="msw-processing-actions"><button type="button" id="style-delete-confirm-button">删除预设</button><button type="button" id="style-delete-cancel">取消</button></div></div>
    <details id="style-general" class="msw-style-section" open><summary>基础</summary><div id="style-basic-fields" class="msw-style-fields"></div></details>
    <details id="style-more" class="msw-style-section"><summary>进阶</summary><div id="style-emphasis-fields" class="msw-style-checks"></div><div id="style-advanced-fields" class="msw-style-fields"></div></details>
    <details id="style-animation" class="msw-style-section"><summary><span class="msw-option-label">动画</span></summary><div id="style-animation-fields"></div></details>
    <small data-help-for="style-animation" hidden>按比例随字幕长度变化；固定时长分别从起点、终点计算。所选字幕未覆盖的效果跟随轨道，恢复轨道动画可取消单条覆盖。</small>
    <p id="style-message" class="msw-processing-message" role="status"></p><button type="button" id="style-retry" hidden>重新加载样式</button>`;
  $('style-main').insertAdjacentHTML('afterend',iconButton('style-swap','交换主副样式（保留位置）','swap'));
  $('style-save-as').insertAdjacentHTML('beforebegin',iconButton('style-overwrite','覆盖预设','overwrite'));
  panel.querySelector('.msw-style-selectors').insertAdjacentHTML('beforebegin',`<div id="style-track-controls" class="media-settings-grid" hidden>
    <label class="media-settings-field" data-option-help="旧工程保留原画面排布。固定轨道排布统一用于预览、ASS 和烧录；各轨道可在下方选择自动排布或固定位置。"><span class="msw-option-label">画面排布</span><select id="style-track-layout"><option value="legacy">保留旧排布</option><option value="fixed">固定轨道排布</option></select></label>
  </div>`);
  const targetTabs=document.createElement('div');targetTabs.className='msw-style-target-tabs';
  const tabs=panel.querySelector('.msw-style-tabs');tabs.before(targetTabs);targetTabs.innerHTML='<select id="style-track-target" aria-label="字幕轨道组"></select>';targetTabs.append(tabs);
  panel.querySelector('#style-more').insertAdjacentHTML('beforeend',`<div id="style-track-position" class="msw-position-group" hidden>
    <div id="style-position-layout" class="msw-style-fields"></div>
    <div id="style-position-fields"><div class="media-settings-grid">
      <label class="media-settings-field" data-option-help="只调整当前对象；多选以首条为基准平移，保留相对距离。"><span class="msw-option-label">定位对象</span><select id="style-position-scope"><option value="track">轨道默认</option><option value="cue">所选字幕</option></select></label>
      <label class="media-settings-field"><span>横向 (%)</span><input id="style-position-x" type="number" min="0" max="100" step="any" required></label>
      <label class="media-settings-field"><span>纵向 (%)</span><input id="style-position-y" type="number" min="0" max="100" step="any" required></label>
      <div class="style-position-actions"><button type="button" id="style-position-drag">在画面中定位</button><button type="button" id="style-position-cancel" hidden>取消定位</button><button type="button" id="style-position-finish" hidden>完成定位</button></div>
    </div><p id="style-position-note" class="msw-processing-hint"></p></div>
  </div>`);
  panel.querySelector('#style-general').insertAdjacentHTML('beforebegin',`<div id="style-pair-controls" class="media-settings-grid">
    <label class="media-settings-field"><span class="msw-option-label">主副排列</span><select id="style-pair-order"><option value="main-above">主字幕在上</option><option value="secondary-above">副字幕在上</option></select></label>
    <label class="media-settings-field" data-option-help="两行文字之间的附加间距，负值让字幕靠近；过小可能重叠。以 1080p 为基准。"><span class="msw-option-label">主副字幕间距</span><span class="gap-remove-number-control"><input id="style-pair-gap" type="number" min="-240" max="240" step="1" required><span class="gap-remove-unit">px</span></span></label>
  </div>`);
  panel.querySelector('.msw-style-tabs').setAttribute('role','group');
  for(const r of ['main','secondary']){$('style-'+r).removeAttribute('role');$('style-'+r).removeAttribute('aria-selected');$('style-'+r).removeAttribute('tabindex');}
  const fontScripts=global.AsrEditorUtils.ASS_FONT_SCRIPTS;
  const basic=[...fontScripts.map(([,key])=>[key,'字体','text']),['fontSize','字号','number',1,512],['wrapMode','换行方式','select',[['auto','自动'],['characters','按字数']]],['charsPerLine','每行字数','number',1,200],['primaryColor','文字颜色','color'],['outlineColor','描边颜色','color'],['outline','描边宽度','number',0,100],['alignment','位置','select',[[7,'左上'],[8,'顶部居中'],[9,'右上'],[4,'左中'],[5,'居中'],[6,'右中'],[1,'左下'],[2,'底部居中'],[3,'右下']]]];
  const advanced=[['bold','粗体','checkbox'],['italic','斜体','checkbox'],['underline','下划线','checkbox'],['strikeOut','删除线','checkbox'],['borderStyle','边框样式','select',[[1,'描边'],[3,'背景框']]],['backColor','阴影／背景颜色','color'],['shadow','阴影距离','number',0,100],['spacing','字距','number',-100,100],['marginL','左边距','number',0,9999],['marginR','右边距','number',0,9999],['marginV','垂直边距','number',0,9999],['angle','旋转角度','number',-360,360],['scaleX','横向缩放 %','number',0,1000],['scaleY','纵向缩放 %','number',0,1000]];
  function fields(rows,target,animation=false) {
    for(const [key,caption,type,min,max,step] of rows) {
      const label=document.createElement('label');label.className='msw-style-field';
      const title=document.createElement('span');title.className='msw-option-label';title.textContent=t(caption);
      const input=document.createElement(type==='select'?'select':'input'); input.id=`style-field-${key.replaceAll('.','-')}`;
      label.htmlFor=input.id;
      input.dataset[animation?'animation':'styleField']=key;
      if(type==='select') for(const [value,name] of min) input.add(new Option(t(name),String(value)));
      else { input.type=type;if(type==='number'){input.min=min;input.max=max;input.step=step||1;}if(type==='text')input.maxLength=128; }
      if(type==='checkbox'){label.classList.add('msw-style-check');label.append(input,title);}else label.append(title,input);
      $(target).append(label);
    }
  }
  basic.splice(basic.findIndex(r=>r[0]==='primaryColor'),0,['textAlign','文字对齐','select',[['left','左对齐'],['center','居中'],['right','右对齐']]]);
  fields(basic,'style-basic-fields');fields(advanced.filter(r=>r[2]==='checkbox'),'style-emphasis-fields');fields(advanced.filter(r=>r[2]!=='checkbox'),'style-advanced-fields');
  const backgroundSection=document.createElement('div');backgroundSection.id='style-background';backgroundSection.className='msw-property-group';
  backgroundSection.innerHTML='<div id="style-background-fields" class="msw-style-fields"></div>';
  $('style-more').append(backgroundSection);
  fields([['backgroundShape','文字背景','select',[['none','无'],['rounded','矩形']]],
    ['backgroundColor','填充颜色','color'],['backgroundOpacity','不透明度 %','number',0,100],
    ['backgroundPaddingX','左右内边距','number',0,240],['backgroundPaddingY','上下内边距','number',0,240],
    ['backgroundRadius','圆角半径','number',0,240]],'style-background-fields');
  const gradientSection=document.createElement('div');gradientSection.id='style-gradient';gradientSection.className='msw-property-group';
  gradientSection.innerHTML='<div id="style-gradient-fields" class="msw-style-fields"></div>';
  backgroundSection.before(gradientSection);
  fields([['gradientMode','文字渐变','select',[['none','关闭'],['characters','双色逐字']]],['gradientStart','起始颜色','color'],['gradientEnd','结束颜色','color']],'style-gradient-fields');
  const decorationFields=document.createElement('div');decorationFields.className='msw-style-fields msw-decoration-fields';decorationFields.id='style-decoration-fields';
  $('style-more').append(decorationFields);decorationFields.append(gradientSection,backgroundSection);
  $('style-field-backgroundShape').closest('label').dataset.optionHelp='随全文大小伸缩；圆角为 0 时使用直角。打字机保留完整背景。';
  $('style-field-gradientMode').closest('label').dataset.optionHelp='沿阅读顺序逐字渐变，单字内部保持纯色。';
  icons.pick='<path d="m14 5 5 5M12 7l5 5-9 9H3v-5l9-9Zm1-1 3-3a2.1 2.1 0 0 1 3 0l2 2a2.1 2.1 0 0 1 0 3l-3 3"/>';
  for(const input of panel.querySelectorAll('[data-style-field][type=color]')) {
    const control=document.createElement('span');control.className='msw-style-color-control';input.before(control);control.append(input);
    control.insertAdjacentHTML('beforeend',iconButton('style-pick-'+input.dataset.styleField,'从视频画面取色','pick'));
    const button=control.lastElementChild;
    button.onclick=event=>{
      event.preventDefault();if(input.disabled||fixedPositionEditing)return;
      const context=JSON.stringify([host.generation,selectionKey(),role]);
      global.MSWVideoColorPicker.pick({video:player,stage:playerStage,rect:fixedVideoRect,
        valid:()=>ready&&propertiesVisible()&&!input.disabled&&!fixedPositionEditing&&JSON.stringify([host.generation,selectionKey(),role])===context,
        onPick:color=>{input.value=color;input.dispatchEvent(new Event('change',{bubbles:true}));},
        onError:text=>message(text,true)});
    };
  }
  $('style-field-fontSize').closest('label').dataset.optionHelp='字号、边距和动画坐标以 1080p 为基准，随画面尺寸缩放。';
  const fontInputs=fontScripts.map(([script,key])=>{const input=$('style-field-'+key);input.dataset.fontScript=script;return input;});
  const fontRow=document.createElement('div');fontRow.className='msw-property-font';
  const languageLabel=document.createElement('label');languageLabel.className='msw-style-field';
  languageLabel.innerHTML='<span class="msw-option-label">目标语言</span><select id="style-font-script" aria-label="目标语言"></select>';
  fontInputs[0].closest('label').before(fontRow);fontRow.append(languageLabel);
  const fontLanguage=$('style-font-script');fontLanguage.replaceChildren(...fontScripts.map(([script,,label])=>new Option(t(label),script)));
  languageLabel.dataset.optionHelp='按文字类别设置。汉字共用字体；拉丁字母、数字及半角标点共用字体。未设置的类别沿用汉字字体。';
  for(const input of fontInputs)fontRow.append(input.closest('label'));
  const showFontCategory=()=>{for(const input of fontInputs)input.closest('label').hidden=input.dataset.fontScript!==fontLanguage.value;};
  const fontPicker=global.MSWFontPicker.create(fontInputs,()=>host.config?.processingUrl?request('subtitle-fonts'):Promise.reject());
  fontLanguage.onchange=()=>{fontPicker.close();showFontCategory();};
  showFontCategory();
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
  $('style-field-wrapMode').closest('label').dataset.optionHelp='自动适应画面宽度，或限制每行字符数（含空格、标点）。保留手动换行，不改写正文。';
  global.MSWHelp?.hydrate(panel);
  // Proofreading remains a player preference. Authoring lives in one dock.
  const proofPanel=document.createElement('section');proofPanel.className='settings-panel-section msw-project-style';
  proofPanel.innerHTML='<span class="settings-panel-title">字幕预览</span>';
  const proofControls=document.createElement('div');proofControls.className='msw-proof-controls';proofPanel.append(proofControls);
  proofControls.append($('style-preview-mode').closest('label'));
  const openProperties=document.createElement('button');openProperties.type='button';openProperties.id='subtitle-properties-open';openProperties.textContent='字幕样式与画面位置';proofControls.append(openProperties);old.before(proofPanel);
  const speakerPreview=document.createElement('label');speakerPreview.className='toggle settings-panel-item';
  speakerPreview.innerHTML='<input id="style-preview-speakers" type="checkbox"><span>预览说话人</span>';
  document.querySelector('.media-preview-checks').append(speakerPreview);
  $('style-preview-speakers').onchange=()=>{
    pushPreviewUndo('切换预览说话人名称',snapshotPreviewState());
    host.data.preview.speaker_labels_visible=$('style-preview-speakers').checked;
    fixedPreviewInvalidate();refresh();scheduleAutoSaveFlush();
  };
  const scopeBar=document.createElement('div');scopeBar.className='msw-properties-scope';
  scopeBar.innerHTML='<select id="style-edit-scope" aria-label="属性对象"></select><select id="style-speaker-target" aria-label="说话人对象" hidden></select><span id="style-selection-label"></span>';
  const general=$('style-general'),basicFields=$('style-basic-fields'),presetRow=panel.querySelector('.msw-style-selectors');
  general.insertBefore(scopeBar,basicFields);
  scopeBar.insertBefore(tabs,$('style-selection-label'));
  general.insertBefore(presetRow,basicFields);
  presetRow.append(panel.querySelector('.msw-style-actions'));
  targetTabs.hidden=true;panel.querySelector('.msw-style-toolbar').hidden=true;
  for(const node of [$('style-save-form'),$('style-delete-confirm'),$('style-track-controls')])general.insertBefore(node,basicFields);
  $('style-advanced-fields').append($('style-track-position'));
  $('style-position-layout').append($('style-pair-controls'));
  const anchor=$('style-field-alignment').closest('label');
  anchor.querySelector('.msw-option-label').textContent='对齐锚点';$('style-position-layout').append(anchor);
  anchor.dataset.optionHelp='锚点决定文字向哪个方向展开。百分比相对视频画面，不含黑边。';
  for(const key of ['marginL','marginR','marginV'])$('style-position-layout').append($('style-field-'+key).closest('label'));
  $('style-position-scope').closest('label').hidden=true;
  const restoreAppearance=document.createElement('button');restoreAppearance.type='button';restoreAppearance.id='style-inherit-appearance';restoreAppearance.className='msw-style-icon';
  restoreAppearance.title='恢复轨道外观';restoreAppearance.setAttribute('aria-label','恢复轨道外观');
  restoreAppearance.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4v11h13M14 11l4 4-4 4M9 4h11M9 8h11"/></svg>';
  presetRow.querySelector('.msw-style-actions').prepend(restoreAppearance);
  for(const input of panel.querySelectorAll('[data-style-field]')) {
    const caption=input.closest('label').querySelector('.msw-option-label');
    const reset=fieldName(caption,()=>resetAppearanceField(input.dataset.styleField));
    reset.dataset.resetStyle=input.dataset.styleField;
  }
  // The field name is the recovery control; help icons stay separate.
  function fieldName(caption,restore) {
    const name=document.createElement('button');name.type='button';name.className='msw-style-field-name';name.textContent=caption.textContent;
    caption.replaceChildren(name);name.disabled=true;
    name.onclick=event=>{event.preventDefault();event.stopPropagation();if(!name.disabled)restore();};
    return name;
  }
  function recoveryState(name,changed,blocked,hint='点击恢复轨道参数') {
    name.disabled=!changed||blocked;name.classList.toggle('is-overridden',!!changed);
    name.title=changed?hint:'';
    name.setAttribute('aria-label',name.textContent+(changed?'，'+hint:''));
  }
  for(const key of ['x','y']){
    const input=$('style-position-'+key),caption=input.closest('label').firstElementChild;caption.classList.add('msw-option-label');
    input.closest('label').htmlFor=input.id;
    fieldName(caption,()=>{positionDrafts.clear();fixedCommitPosition(null);sync();refresh();}).id='style-position-'+key+'-name';
  }
  function resetAppearanceField(field) {
    const options={reset:[field]};
    // Rectangle/rounded are one control now. Its radius also owns the legacy
    // shape switch; restoring a radius must recover a straight track rectangle.
    if(field==='backgroundRadius')options.restoreRadius=true;
    commitCueAppearance({},options);
  }
  let role='main',library=[],selectedPreset='default',override=null,ready=false,styleGeneration=-1,loadError='',pendingAction=null,saving=false;
  let editScope='cue',speakerId='';fixedPositionScope='cue';
  const M=global.MSWSubtitleAnimation;
  const cueScope=()=>editScope==='cue'&&productionFlatMode();
  const selectedRows=()=>fixedSelectedRows();
  const speakerScope=()=>editScope==='speaker'&&productionFlatMode();
  const appearanceScope=()=>cueScope()||speakerScope();
  const speakers=()=>global.MSWSpeaker.ensure(host.data).rows;
  const speaker=()=>speakers().find(r=>r.id===speakerId)||speakers()[0];
  function speakerReference(){
    const id=speaker()?.id;
    for(const source of layerCore.tracks(host.data))for(let index=0;index<source.segments.length;index++){
      const cue=source.segments[index];
      if(global.MSWSpeaker.profile(host.data,cue,source.segments[cue.color_ref?.headIdx])?.id===id)
        return {cue,index,...fixedRef(cue,source.role,source.track_id)};
    }
    return null;
  }
  function speakerBase(){const row=speakerReference();return row?trackAppearance(row):global.MSWCueStyle.apply(projectStyle().main,{});}
  function speakerAppearance(){return global.MSWSpeaker.appearance(speakerBase(),{},speaker());}
  function commitSpeaker(update,label){
    if(!ready||styleGeneration!==host.generation)return;
    const current=speaker(),next=structuredClone(current);update(next);
    if(JSON.stringify(current)===JSON.stringify(next))return;
    if(!global.MSWSpeaker.valid({version:1,rows:[next]}))throw Error('说话人样式参数无效');
    commitProcessingEdits();pushPreviewUndo(label,snapshotPreviewState());Object.assign(current,next);
    for(const key of ['style','style_preset','animation'])if(!(key in next))delete current[key];
    speakerPaletteChanged({appearanceOnly:true});
  }
  function commitSpeakerAppearance(patch,options={}){
    commitSpeaker(row=>{
      if(options.preset){row.style=global.MSWCueStyle.appearance(options.preset.main);row.style_preset=options.presetId;}
      else {
        row.style=options.replace?{...patch}:{...row.style,...patch};
        for(const key of options.reset||[])delete row.style[key];
        if(patch.backgroundRadius>0&&speakerAppearance().backgroundShape==='rect')row.style.backgroundShape='rounded';
        if(options.restoreRadius&&speakerBase().backgroundShape==='rect')delete row.style.backgroundShape;
        if(options.presetId)row.style_preset=options.presetId;
        if(!Object.keys(row.style).length){delete row.style;if(!options.presetId)delete row.style_preset;}
      }
    },'修改说话人外观');
  }
  const speakerPresetMatches=preset=>{const effective=speakerAppearance();return global.MSWCueStyle.fields.every(k=>preset.main[k]===effective[k]);};
  // Cache only during a synchronous form refresh. A multi-selection often
  // shares a track; resolving its style for each field/cue repeats the same work.
  // Discard on return so later edits, undo and project changes cannot go stale.
  let propertyReadCache=null;
  function readProperties(fn) {
    const previous=propertyReadCache;propertyReadCache||={tracks:new Map(),appearances:new Map()};
    try{return fn();}finally{propertyReadCache=previous;}
  }
  function readTrackStyle(track) {
    if(!propertyReadCache)return global.MSWTrackPresentation.styleFor(host.data,track);
    if(!propertyReadCache.tracks.has(track.id))propertyReadCache.tracks.set(track.id,global.MSWTrackPresentation.styleFor(host.data,track));
    return propertyReadCache.tracks.get(track.id);
  }
  const trackAppearance=row=>{
    const track=fixedTrack(row.cue,row.role,row.track_id),style=readTrackStyle(track);
    return global.MSWCueStyle.apply(style[track.flat_style_slot||'main'],{});
  };
  const rowAppearance=row=>{
    const calculate=()=>global.MSWSpeaker.appearance(global.MSWCueStyle.apply(trackAppearance(row),row.cue),row.cue,global.MSWSpeaker.profile(host.data,row.cue));
    if(!propertyReadCache)return calculate();
    if(!propertyReadCache.appearances.has(row.cue.id))propertyReadCache.appearances.set(row.cue.id,calculate());
    return propertyReadCache.appearances.get(row.cue.id);
  };
  const displayedAppearance=(style,field)=>field==='backgroundShape'&&style.backgroundShape==='rect'?'rounded':
    field==='backgroundRadius'&&style.backgroundShape==='rect'?0:
    field==='textAlign'?style.textAlign||['left','center','right'][((style.alignment||2)-1)%3]:style[field];
  const presetMatches=(preset,rows=selectedRows())=>rows.length&&rows.every(row=>{
    const track=fixedTrack(row.cue,row.role,row.track_id),candidate=S.forKind(preset,fixedTrackCore.styleKind(track))[track.flat_style_slot||'main'],effective=rowAppearance(row);
    return global.MSWCueStyle.fields.every(k=>candidate[k]===effective[k]);
  });
  const selectionKey=()=>JSON.stringify([editScope,speakerId,fixedStyleTrackId,...selectedRows().map(r=>r.cue_id).sort()]);
  let lastSelectionKey='',lastCueSelection='';
  const propertiesVisible=()=>!!$('subtitle-properties').getClientRects().length;
  function open(scope=editScope){
    if(fixedPositionEditing)fixedStopPositioning(false);
    editScope=scope;fixedPositionScope=scope;
    waveformEditor?.showModule('properties',{recordUndo:false});waveformEditor?.activateModuleTab('properties');rebuildShowModuleMenu();
    global.MSWHelp?.hydrate(panel);
    rebuild();sync();refresh();
  }
  openProperties.onclick=()=>{host.closeMediaSettings?.();if($('media-settings-modal').getAttribute('aria-hidden')==='false')$('media-settings-close')?.click();open('track');};
  $('style-edit-scope').onchange=()=>{
    if(fixedPositionEditing)fixedStopPositioning(false);
    const selection=$('style-edit-scope').value;cancelAction();
    if(selection==='cue'){editScope='cue';fixedPositionScope='cue';rebuild();sync();}
    else if(selection==='speaker'){editScope='speaker';rebuild();sync();}
    else editTrack(selection,false);
    refresh();
  };
  $('style-speaker-target').onchange=()=>{speakerId=$('style-speaker-target').value;cancelAction();rebuild();sync();refresh();};
  restoreAppearance.onclick=()=>commitCueAppearance({}, {replace:true});
  function commitCueAppearance(patch,options={}) {
    if(speakerScope()){try{commitSpeakerAppearance(patch,options);}catch(error){message(error.message,true);sync();}return;}
    if(!ready||styleGeneration!==host.generation||!cueScope())return;
    try {
      const rows=selectedRows();if(!rows.length)return;
      const edit=global.MSWFlatEditing.appearanceFields;
      const cues=rows.map(row=>{
        let fields=edit(row.cue,patch,options);
        if(patch.backgroundRadius>0&&rowAppearance(row).backgroundShape==='rect')fields=edit({...row.cue,...fields},{backgroundShape:'rounded'});
        if(options.restoreRadius&&trackAppearance(row).backgroundShape==='rect'&&row.cue.subtitle_style?.backgroundShape==='rounded')fields=edit({...row.cue,...fields},{},{reset:['backgroundShape']});
        if(options.preset) {
          const track=fixedTrack(row.cue,row.role,row.track_id),slot=track.flat_style_slot||'main';
          const appearance=global.MSWCueStyle.appearance(S.forKind(options.preset,fixedTrackCore.styleKind(track))[slot]);
          fields=edit(row.cue,appearance,{replace:true,presetId:options.presetId});
        }
        return {id:row.cue_id,fields};
      });
      if(!fixedCommitAppearance({cues},options.reset||options.replace&&!Object.keys(patch).length?'字幕恢复轨道外观':'修改所选字幕外观'))return;
    }catch(error){message(error.message,true);sync();}
  }
  const legacyAnimation=document.createElement('details');legacyAnimation.id='motion-legacy';legacyAnimation.className='msw-style-section';
  legacyAnimation.innerHTML='<summary><span class="msw-option-label">原有 ASS 动画</span></summary>';
  legacyAnimation.dataset.optionHelp='原工程的 ASS 动画保持原样。使用上方新动画时替换旧动画；新动画支持所选字幕、叠加和统一时间规则。';
  $('style-animation-fields').before(legacyAnimation);legacyAnimation.append($('style-animation-fields'));
  const motionRoot=document.createElement('div');motionRoot.id='subtitle-motion-controls';legacyAnimation.before(motionRoot);
  function motionContext(){
    const cue=cueScope(),profileScope=speakerScope(),rows=cue?selectedRows():[],target=fixedStyleTarget();
    const reference=profileScope?speakerReference():null;
    const sources=profileScope?[{row:reference,track:reference?fixedTrack(reference.cue,reference.role,reference.track_id):target}]:cue?rows.map(row=>({row,track:fixedTrack(row.cue,row.role,row.track_id)})):target?[{track:target}]:[];
    const owned=cue||profileScope||!target?[]:layerCore.tracks(host.data).flatMap(source=>source.segments.flatMap((c,index)=>
      fixedOwner(c,source.role,source.track_id)===target.id?[{cue:c,index,...fixedRef(c,source.role,source.track_id),subtitle_track_id:target.id}]:[]));
    const items=sources.map(({row,track})=>{
      const style=readTrackStyle(track),trackBase=style[track.flat_style_slot||'main'].animation;
      const base=cue?M.resolve(trackBase,global.MSWSpeaker.profile(host.data,row.cue)?.animation):trackBase;
      const override=profileScope?speaker()?.animation:row?.cue.subtitle_animation;
      const previewRow=row||owned.find(r=>r.cue.start<=player.currentTime*1000&&r.cue.end>player.currentTime*1000)||owned[0];
      return {row,track,style,override,base,legacy:!base&&!override&&Object.values(style.animations).some(e=>e.enabled),value:M.resolve(base,override)||M.defaults(),duration:previewRow?previewRow.cue.end-previewRow.cue.start:1000,preview:previewRow};
    });
    return {cue:cue||profileScope,inheritLabel:profileScope?'恢复各轨道动画':'恢复继承动画',items,playhead:player.currentTime*1000,preview:items[0]?.preview,blocked:!ready||saving||fixedPositionEditing||!productionFlatMode()||!items.length||!profileScope&&items.some(i=>i.track.locked)};
  }
  function commitMotion(name,key,value){
    const context=motionContext();if(context.blocked)return;
    commitProcessingEdits();
    const updates=context.items.map(item=>{
      if(key==='author'){
        if(value.type==='playhead'&&!item.preview)throw Error('当前轨道没有可参考的字幕');
        const action=value.type==='playhead'?{...value,time:context.playhead-item.preview.cue.start}:value;
        return {id:item.row?.cue_id,animation:M.authorPatch(item.value,name,action,item.duration),item};
      }
      if(key==='preset')return {id:item.row?.cue_id,animation:M.presetPatch(item.value,name,item.duration),item};
      if(key.startsWith('channel:')){
        const current=structuredClone(item.value);
        current.effects.curves=M.convertUnit(current.effects.curves,context.items[0].value.effects.curves.unit,item.duration);
        const animation=M.editChannel(current,key.slice(8),value);
        if(!M.valid(animation))throw Error('关键帧时间须递增且不能重合，数值须在允许范围内');
        return {id:item.row?.cue_id,animation,item};
      }
      const effects={};
      for(const effect of name==='all'?M.names:[name]){
        let state=structuredClone(item.value.effects[effect]);
        if(key==='disable')state.enabled=false;
        else if(key!=='reset'){
          if(key==='unit')state=M.convertUnit(state,value,item.duration);
          else if(key==='range')Object.assign(state,value);
          else state[key]=value;
        }
        effects[effect]=state;
      }
      const animation={schema:M.schema,effects};if(key!=='reset'&&!M.valid(animation))throw Error('动画参数无效：时间须递增且不能重合，数值须在允许范围内');
      return {id:item.row?.cue_id,animation,item};
    });
    if(speakerScope()) {
      commitSpeaker(row=>{
        if(key==='reset') {
          if(name==='all')delete row.animation;
          else if(row.animation){delete row.animation.effects[name];if(!Object.keys(row.animation.effects).length)delete row.animation;}
        }else {
          const patch=updates[0].animation,old=row.animation||{schema:M.schema,effects:{}};
          row.animation={...old,...patch,effects:{...old.effects,...patch.effects}};
        }
      },key==='reset'?'恢复说话人动画':'修改说话人动画');return;
    }
    let changes;
    if(context.cue)changes={cues:updates.map(u=>({id:u.id,fields:global.MSWFlatEditing.animationFields(u.item.row.cue,u.animation,key==='reset'?{reset:name}:{})}))};
    else{
      const {item,animation}=updates[0],style=S.normalize(item.style),slot=item.track.flat_style_slot||'main';
      style[slot].animation=key==='reset'?M.defaults():M.resolve(item.base,animation);
      changes={tracks:[{id:item.track.id,style:{...item.track.style,mode:'snapshot',value:style}}]};
    }
    if(!fixedCommitAppearance(changes,key==='reset'?'恢复轨道动画':'修改字幕动画'))return;
  }
  const motionUI=global.MSWSubtitleAnimationUI.create(motionRoot,{context:motionContext,commit:commitMotion,message:(text,error)=>message(text,error)});
  let proof={mode:'project'};
  try {
    const saved=JSON.parse((globalThis.MSWConfig?.storage || localStorage).getItem('msw.subtitle-proof.v1')||'{}');proof.mode=saved.mode||'project';
  } catch(_) {}
  const projectStyle=()=>host.data.preview?.project_style || S.defaults();
  const all=()=>[...S.presets(),...library];
  const find=id=>all().find(s=>s.id===id);
  const value=()=>{
    if(speakerScope()){const style=S.normalize(projectStyle());delete style.annotation;style.main=style.secondary=speakerAppearance();return style;}
    if(cueScope()) {const style=S.normalize(projectStyle()),row=selectedRows()[0];delete style.annotation;if(row)style.main=style.secondary=rowAppearance(row);return style;}
    return fixedTrackMode()&&fixedStyleTarget()?fixedStyleValue():projectStyle();
  };
  function presetSnapshot(project) {
    if(speakerScope()){const snapshot=S.normalize(project.preview?.project_style||S.defaults());snapshot.main={...snapshot.main,...global.MSWCueStyle.appearance(speakerAppearance())};return snapshot;}
    if(!cueScope())return S.presetSnapshot(project,value(),fixedTrackMode()&&fixedStyleTarget()?fixedTrackCore.styleKind(fixedStyleGroup()?.main||fixedStyleTarget()):'dialogue');
    // A cue updates only its appearance slot, preserving the other role,
    // positioning and animation of an existing preset.
    const snapshot=S.normalize(project.preview?.project_style||S.defaults());
    for(const row of selectedRows()) {
      const track=fixedTrack(row.cue,row.role,row.track_id),kind=fixedTrackCore.styleKind(track),slot=track.flat_style_slot||'main';
      if(kind==='annotation'&&!snapshot.annotation)snapshot.annotation=S.forKind(snapshot,'dialogue');
      const target=kind==='annotation'?snapshot.annotation:snapshot;
      target[slot]={...target[slot],...global.MSWCueStyle.appearance(rowAppearance(row))};
    }
    return snapshot;
  }
  // A library preset may carry both dialogue and annotation styles. Compare
  // the part used by this group, just as the renderer does, not the envelope.
  const comparable=s=>fixedTrackMode()&&fixedStyleTarget()?S.forKind(s,fixedTrackCore.styleKind(fixedStyleGroup()?.main||fixedStyleTarget())):S.normalize(s);
  const same=(a,b)=>speakerScope()?global.MSWCueStyle.fields.every(k=>a.main[k]===b.main[k]):JSON.stringify({...comparable(a),name:''})===JSON.stringify({...comparable(b),name:''});
  const activePreset=()=>selectedPreset;
  const message=(text,error=false)=>{$('style-message').textContent=t(text);$('style-message').classList.toggle('is-error',error);};
  const persistProof=()=>{try{(globalThis.MSWConfig?.storage || localStorage).setItem('msw.subtitle-proof.v1',JSON.stringify(proof));}catch(_){message('无法保存本机预览偏好',true);}};
  async function request(route,payload) {
    const response=await fetch(`${host.config.processingUrl}/${route}`,{method:payload?'POST':'GET',headers:{'X-MSW-Token':host.config.requestToken,...(payload?{'Content-Type':'application/json'}:{})},...(payload?{body:JSON.stringify(payload)}:{})});
    const result=await response.json();
    if(!response.ok || !result.ok){
      // Older running Python processes can serve the latest JS while retaining
      // an older animation validator. Diagnose that mismatch, not corrupt data.
      if(route==='subtitle-preview'&&/字幕动画.*无效参数/.test(result.error||'')){
        const capability=await request('capabilities').catch(()=>null);
        if(capability&&!(capability.subtitleAnimation>=3))throw Error('编辑器服务仍使用旧版动画规则，请重启编辑器服务并刷新页面；当前动画设置已保留');
      }
      throw Error(result.error||'样式请求失败');
    }
    return result;
  }
  function rebuild() {
    return readProperties(rebuildControls);
  }
  function rebuildControls() {
    const fill=(element,items,selection)=>{element.replaceChildren(...items.map(([id,name])=>new Option(t(name),id)));element.value=selection;};
    fill($('style-preview-mode'),[['project','跟随工程样式'],['default','默认字幕样式'],...all().filter(s=>s.id!=='default').map(s=>[s.id,s.name])],proof.mode);
    if(!$('style-preview-mode').value){proof.mode='project';$('style-preview-mode').value='project';persistProof();}
    if(productionFlatMode()&&!fixedStyleTarget()){
      const tracks=host.data.subtitle_tracks.tracks,occupied=new Set(host.data.subtitle_tracks.assignments.map(a=>a.subtitle_track_id));
      fixedStyleTrackId=(tracks.find(t=>!t.secondary_for&&(occupied.has(t.id)||tracks.some(s=>s.secondary_for===t.id&&occupied.has(s.id))))||tracks[0]).id;role='main';
    }
    const track=fixedTrackMode()?fixedStyleTarget():null;
    $('style-track-controls').hidden=!fixedTrackMode()||productionFlatMode();
    $('style-track-target').hidden=!fixedTrackMode();
    if(fixedTrackMode()) {
      fill($('style-track-target'),productionFlatMode()?host.data.subtitle_tracks.tracks.filter(t=>!t.secondary_for).map(t=>[t.id,'S'+t.display_number]):[['','工程默认'],...host.data.subtitle_tracks.tracks.map(t=>[t.id,t.name])],fixedStyleGroup()?.main.id||track?.id||'');
      $('style-track-layout').value=host.data.subtitle_tracks.presentation;
      $('style-track-layout').closest('label').hidden=productionFlatMode();
    }
    fill($('style-edit-scope'),[['cue','所选字幕'],['speaker','说话人'],...Array.from($('style-track-target').options,o=>[o.value,o.textContent])],speakerScope()?'speaker':cueScope()?'cue':fixedStyleGroup()?.main.id||track?.id||'');
    speakerId=speaker()?.id||'';fill($('style-speaker-target'),speakers().map(r=>[r.id,r.name]),speakerId);
    const chosen=track?fixedStyleGroup()?.main.style.selection||track.style.selection:host.data.preview?.project_style_selection;
    const group=fixedStyleGroup(),inherited=group?[group.main,group.secondary].filter(Boolean).every(t=>t.style.mode==='inherit'):track?.style.mode==='inherit';
    selectedPreset=find(chosen)?chosen:all().find(s=>same(s,value()))?.id||(inherited?'default':'');
    if(cueScope()) {
      const rows=selectedRows();
      const saved=rows[0]?.cue.subtitle_style_preset;
      selectedPreset=find(saved)&&rows.every(r=>r.cue.subtitle_style_preset===saved)?saved:all().find(s=>presetMatches(s,rows))?.id||'';
    }
    if(speakerScope()){const row=speaker(),saved=row.style_preset;selectedPreset=find(saved)?saved:Object.keys(row.style||{}).length?all().find(speakerPresetMatches)?.id||'':'speaker-palette';}
    fill($('style-project-preset'),[...(speakerScope()?[['speaker-palette','跟随说话人色系']]:[]),...(!selectedPreset?[['','未保存为预设']]:[]),...all().map(s=>[s.id,t(s.name)+(s.id===selectedPreset&&!(speakerScope()?speakerPresetMatches(s):cueScope()?presetMatches(s):same(s,value()))?' · '+t('已修改'):'')])],selectedPreset);
    if(!selectedPreset)Array.from($('style-project-preset').options).find(o=>o.value==='').disabled=true;
    if(cueScope()&&!selectedPreset)$('style-project-preset').options[0].textContent=selectedRows().some(r=>r.cue.subtitle_style)?'已单独调整':'跟随轨道';
    $('style-project-preset').closest('label').querySelector('.msw-option-label').firstChild.textContent='样式预设';
    const selected=$('video-export-style-source').value;
    fill($('video-export-style-source'),[['project','跟随工程样式'],...all().map(s=>['preset:'+s.id,s.name])],selected || 'project');
    if(!$('video-export-style-source').value)$('video-export-style-source').value='project';
  }
  function sync() {
    return readProperties(syncControls);
  }
  function syncControls() {
    // Undo/project reload can clear selection without passing syncSelection.
    // Cache the selection actually rendered, not the one from before undo.
    lastSelectionKey=selectionKey();
    lastCueSelection=JSON.stringify([...fixedPositionSelectedIds()].sort());
    const style=S.normalize(value()||S.defaults());
    const track=fixedTrackMode()?fixedStyleTarget():null;
    const group=fixedStyleGroup();
    const rows=cueScope()?selectedRows():[],appearances=rows.map(rowAppearance);
    panel.classList.toggle('editing-cues',cueScope());
    const blocked=speakerScope()?!speaker():cueScope()?(!rows.length||rows.some(r=>fixedTrack(r.cue,r.role,r.track_id)?.locked)):!!track&&(track.locked||group?.main.locked||group?.secondary?.locked||!fixedPresentationMode());
    $('style-speaker-target').hidden=!speakerScope();$('style-speaker-target').disabled=fixedPositionEditing;
    $('style-edit-scope').value=speakerScope()?'speaker':cueScope()?'cue':group?.main.id||track?.id||'';$('style-edit-scope').disabled=fixedPositionEditing;
    $('style-selection-label').textContent=cueScope()?(rows.length===1?fixedCueLabel(rows[0].cue,rows[0].role,rows[0].track_id):rows.length?`已选 ${rows.length} 条 · ${new Set(rows.map(r=>r.subtitle_track_id)).size} 轨`:'请选择字幕'):'';
    $('style-track-target').hidden=cueScope();
    restoreAppearance.hidden=!appearanceScope();restoreAppearance.disabled=blocked||!(speakerScope()?speaker()?.style:rows.some(r=>r.cue.subtitle_style));
    restoreAppearance.title=speakerScope()?'恢复说话人色系外观':'恢复继承外观';restoreAppearance.setAttribute('aria-label',restoreAppearance.title);
    $('style-animation').hidden=false;
    legacyAnimation.hidden=appearanceScope()||!motionContext().items.some(i=>i.legacy);
    $('style-track-position').hidden=speakerScope()||!fixedPresentationMode();
    $('style-position-fields').hidden=!productionFlatMode()&&(!track||fixedTrackCore.placement(track)!=='fixed');
    if(productionFlatMode()&&!speakerScope())syncPosition();
    else if(track&&fixedTrackCore.placement(track)==='fixed') {
      const p=fixedPositionCurrent(),group=fixedSelectedPositionGroup();
      $('style-position-scope').value=fixedPositionScope;
      for(const key of ['x','y']){$('style-position-'+key).value=Math.round(p[key]*1000)/10;$('style-position-'+key).disabled=blocked||fixedPositionScope==='cue'&&!group;}
      $('style-position-drag').disabled=blocked;
      $('style-position-note').textContent=fixedPositionScope==='cue'?(group?'当前字幕：'+group.rows[0].cue.text:'点击“在画面中定位”，选择要调整的字幕。'):'轨道位置作用于未单独定位的字幕。';
    }
    const removable=library.find(s=>s.id===activePreset());
    const mixed=cueScope()&&appearances.some(a=>global.MSWCueStyle.fields.some(k=>a[k]!==appearances[0][k]));
    $('style-overwrite').disabled=saving||blocked||mixed||!removable||(speakerScope()?speakerPresetMatches(removable):cueScope()?presetMatches(removable):same(removable,style));
    $('style-overwrite').title=t(removable?'将当前样式覆盖到所选预设':'内置样式不能覆盖，请另存为新预设');
    $('style-delete-preset').disabled=saving||!removable;
    $('style-delete-preset').title=removable?t('删除预设')+': '+removable.name:t('只能删除当前选用的用户预设');
    for(const id of ['style-save-as','style-reset','style-save-preset','style-save-cancel','style-delete-confirm-button','style-delete-cancel'])$(id).disabled=saving;
    $('style-save-as').disabled=saving||blocked||mixed;
    $('style-save-as').title=mixed?'所选字幕外观不同，请选择单条字幕保存预设':'另存为新预设';
    for(const node of panel.querySelectorAll('[data-style-field],[data-animation],#style-project-preset,#style-pair-order,#style-pair-gap,#style-swap,#style-reset,#style-transform-preset'))node.disabled=saving||blocked;
    $('style-preset-name').disabled=saving;
    $('style-reset').disabled=saving||blocked||!find(selectedPreset);
    $('style-reset').title=find(selectedPreset)?t('恢复所选预设保存的参数')+'：'+find(selectedPreset).name:t('请先选择或保存预设');
    if(blocked)message(cueScope()?rows.length?'所选字幕包含锁定轨道。':'':track.locked||group?.main.locked||group?.secondary?.locked?'此轨道已锁定。':'切换为固定轨道排布后，可调整轨道样式与位置。');
    else if(['此轨道已锁定。','所选字幕包含锁定轨道。','切换为固定轨道排布后，可调整轨道样式与位置。'].some(text=>$('style-message').textContent===t(text)))message('');
    const secondary=!appearanceScope()&&(productionFlatMode()?!!group?.secondary:host.data.multi_subtitle?.enabled===true);
    $('style-secondary').hidden=!secondary;$('style-swap').hidden=!secondary;if(!secondary)role='main';
    if(group&&!appearanceScope())role=group.secondary?.id===track.id?'secondary':'main';
    for(const r of ['main','secondary']) {
      $('style-'+r).textContent=t(r==='main'?'主字幕':'副字幕');
      $('style-'+r).hidden=appearanceScope()|| (productionFlatMode()?!secondary:r==='secondary'&&!secondary);
    }

    $('style-pair-controls').hidden=!secondary;const pair=S.pairSettings(style);$('style-pair-order').value=pair.order;$('style-pair-gap').value=pair.gap;
    for(const r of ['main','secondary'])$('style-'+r).setAttribute('aria-pressed',String(role===r));
    for(const input of panel.querySelectorAll('[data-style-field]')) {const v=displayedAppearance(style[role],input.dataset.styleField);if(input.type==='checkbox')input.checked=!!v;else input.value=v??'';}
    for(const input of panel.querySelectorAll('[data-style-field]')) {
      const field=input.dataset.styleField,label=input.closest('label'),reset=label.querySelector('[data-reset-style]');
      label.hidden=appearanceScope()&&!global.MSWCueStyle.fields.includes(field);
      const changed=speakerScope()?Object.hasOwn(speaker()?.style||{},field):cueScope()&&rows.some(r=>Object.hasOwn(r.cue.subtitle_style||{},field));
      const different=cueScope()&&appearances.some(a=>displayedAppearance(a,field)!==displayedAppearance(appearances[0],field));
      label.classList.toggle('is-overridden',changed);label.classList.toggle('is-mixed',different);
      input.setAttribute('aria-description',different?'多个值':changed?'已单独设置':'跟随轨道');
      if(input.type==='checkbox')input.indeterminate=different;
      else if(different){input.value='';input.placeholder='多个值';}
      else input.placeholder='';
      recoveryState(reset,changed,saving||blocked);
    }
    for(const input of fontInputs)fontPicker.sync(input,input.value,input.closest('label').classList.contains('is-mixed'));
    showFontCategory();
    for(const key of ['marginL','marginR','marginV'])$('style-field-'+key).closest('label').hidden=appearanceScope()||track&&fixedTrackCore.placement(track)==='fixed';
    for(const input of panel.querySelectorAll('[data-animation]')) {const [g,k]=input.dataset.animation.split('.'),v=style.animations[g][k];if(input.type==='checkbox')input.checked=!!v&&!(g==='fad'&&style.animations.fade.enabled);else input.value=v??'';}
    $('style-field-charsPerLine').closest('label').hidden=style[role].wrapMode!=='characters';
    const backgroundValues=cueScope()?appearances:[style[role]];
    const withBackground=backgroundValues.some(s=>global.MSWSubtitleBackground.enabled(s));
    for(const key of global.MSWSubtitleBackground.fields.filter(k=>k!=='backgroundShape')) {
      const input=$('style-field-'+key);
      input.closest('label').hidden=!withBackground;
    }
    $('style-field-borderStyle').disabled ||= withBackground;
    const withGradient=backgroundValues.some(s=>global.MSWSubtitleGradient.enabled(s));
    for(const key of ['gradientStart','gradientEnd'])$('style-field-'+key).closest('label').hidden=!withGradient;
    for(const input of panel.querySelectorAll('[data-style-field][type=color]'))$('style-pick-'+input.dataset.styleField).disabled=input.disabled||fixedPositionEditing;
    $('style-preview-mode').value=proof.mode;
    $('style-preview-speakers').checked=host.data.preview?.speaker_labels_visible??speakers().some(r=>r.mode==='speaker');
    for(const group of Object.keys(A))$(`style-effect-${group}-fields`).hidden=!$(`style-field-${group}-enabled`).checked;
    $('style-transform-preset').value=transformTags.some(([tags])=>tags===style.animations.t.tags)?style.animations.t.tags:'custom';
    $('style-field-t-tags').closest('label').hidden=$('style-transform-preset').value!=='custom';
    motionUI.sync();
  }
  const positionDrafts=new Map();
  const positionContext=()=>JSON.stringify([host.generation,fixedPositionEditing,fixedPositionScope,fixedStyleTrackId,
    fixedPositionScope==='cue'?[...fixedPositionSelectedIds()].sort():null]);
  function positionValue(key,value,enabled=true) {
    const input=$('style-position-'+key);
    if(enabled&&positionDrafts.get(key)===positionContext())return;
    positionDrafts.delete(key);
    input.value=enabled&&value!==null?Math.round(value*100000)/1000:'';
  }
  function syncPosition() {
    if(speakerScope())return;
    if(!propertiesVisible()&&!fixedPositionEditing)return;
    if(!fixedPositionEditing&&!$('style-more').open)return;
    $('style-position-drag').hidden=fixedPositionEditing;
    $('style-position-cancel').hidden=$('style-position-finish').hidden=!fixedPositionEditing;
    for(const id of ['style-position-scope','style-edit-scope','style-track-target','style-main','style-secondary'])$(id).disabled=fixedPositionEditing;
    if(!productionFlatMode()) {
      if(fixedPositionEditing)for(const key of ['x','y'])positionValue(key,fixedPositionCurrent()[key]);
      return;
    }
    const track=fixedStyleTarget(),selected=fixedPositionScope==='cue',rows=selected?fixedPositionSelection():[];
    const locked=selected?rows.some(r=>fixedTrack(r.cue,r.role,r.track_id)?.locked):track?.locked;
    const enabled=!locked&&(selected?rows.length>0&&rows.every(r=>r.position):!!track);
    const p=fixedPositionCurrent();$('style-position-scope').value=fixedPositionScope;
    for(const key of ['x','y']) {
      const input=$('style-position-'+key);input.disabled=!enabled;
      positionValue(key,p[key],enabled);
      input.placeholder=enabled&&p[key]===null?'多个值':'';
    }
    const custom=rows.filter(r=>r.cue.subtitle_position).length;
    for(const key of ['x','y'])recoveryState($('style-position-'+key+'-name'),
      selected?custom>0:track&&fixedTrackCore.placement(track)==='fixed',
      fixedPositionEditing||locked||!track,selected?'点击恢复轨道位置（横纵坐标一起）':'点击恢复自动排布（横纵坐标一起）');
    $('style-position-fields').hidden=false;
    $('style-position-drag').disabled=!enabled||selected&&rows.some(r=>!r.entry);
    $('style-position-note').textContent=locked?'所选轨道已锁定':selected&&rows.length&&!enabled?'请先启用字幕及轨道':'';
  }
  function refresh() {
    host.useProjectStylePreview();host.refreshStylePreview();global.MSWSubtitleRenderer?.invalidate();
    global.MSWPreviewControls?.refresh();
  }
  function change(style,selection=find(selectedPreset)?selectedPreset:'current',label='修改工程字幕样式') {
    if(!ready||styleGeneration!==host.generation)return;
    if(appearanceScope()){commitCueAppearance({}, {preset:style,...(find(selection)?{presetId:selection}:{})});return;}
    if(fixedTrackMode()&&fixedStyleTarget()) {
      if(!fixedCommitStyle(style,selection)){sync();message(fixedLastMessage||'无法修改轨道样式',true);return;}
      // The commit broadcasts msw:burn-style, which updates this panel once.
      return;
    }
    else host.commitProjectStyle(style,label,selection);
    rebuild();sync();refresh();
  }
  function cancelAction(){pendingAction=null;$('style-save-form').hidden=true;$('style-delete-confirm').hidden=true;}
  $('style-track-layout').onchange=()=>{cancelAction();fixedSetPresentation($('style-track-layout').value);rebuild();sync();refresh();};
  function editTrack(id,show=true){cancelAction();message('');editScope='track';fixedPositionScope='track';fixedStyleTrackId=id;fixedPositionRef=null;if(productionFlatMode()&&fixedStyleTarget())role=fixedStyleTarget().secondary_for?'secondary':'main';rebuild();sync();if(show)open('track');}
  $('style-track-target').onchange=()=>editTrack($('style-track-target').value,false);
  $('style-position-scope').onchange=()=>{fixedPositionScope=$('style-position-scope').value;fixedPreviewInvalidate();sync();refresh();};
  $('style-position-drag').onclick=()=>fixedStartPositioning();
  $('style-position-cancel').onclick=()=>fixedStopPositioning(false);
  $('style-position-finish').onclick=()=>fixedStopPositioning(true);
  for(const key of ['x','y']) {
    const input=$('style-position-'+key);
    input.oninput=()=>positionDrafts.set(key,positionContext());
    input.onkeydown=event=>{if(event.key==='Enter'&&!fixedPositionEditing){event.preventDefault();event.stopPropagation();input.blur();}};
    input.onchange=()=>{
      if(!ready||styleGeneration!==host.generation)return;
      if(!input.reportValidity())return;
      positionDrafts.delete(key);
      if(productionFlatMode()&&fixedPositionScope==='cue')fixedCommitPosition({[key]:Number(input.value)/100});
      else {
        if(!['x','y'].every(k=>$('style-position-'+k).reportValidity()))return;
        fixedCommitPosition({x:Number($('style-position-x').value)/100,y:Number($('style-position-y').value)/100});
      }
      sync();refresh();
    };
  }
  panel.addEventListener('change',event=>{
    // Becoming inert on project switch can flush a native change event from
    // the previously focused input. Never commit it into the new project.
    if(!ready||styleGeneration!==host.generation)return;
    const input=event.target,field=input.dataset.styleField,animation=input.dataset.animation;if(!field&&!animation)return;
    if(!input.checkValidity()){input.reportValidity();sync();return;}
    const style=S.normalize(value()),v=input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.tagName==='SELECT'&&!['wrapMode','textAlign','backgroundShape','gradientMode'].includes(field)?Number(input.value):input.value;
    if(appearanceScope()){if(field)commitCueAppearance({[field]:v});return;}
    // Exact legacy burn parameters survive until the user deliberately edits them.
    if(style.legacyBurn&&!['wrapMode','charsPerLine'].includes(field)){
      const mapped={fontName:'font_family',fontSize:'font_size',primaryColor:'color',outlineColor:'outline_color',outline:'outline',backColor:'background_color'}[field];
      if(mapped && !(field==='fontSize'&&(v<8||v>200)) && !(field==='outline'&&v>12)) {style.legacyBurn[role] ||= {};style.legacyBurn[role][mapped]=v;}
      else {delete style.legacyBurn;message('已转换为工程 ASS 样式，请在播放器确认背景与位置。');}
    }
    if(field==='marginV'&&fixedTrackMode()){
      const edited=S.editMargin(style,role,v);
      if(!edited.name.endsWith(' · 已修改'))edited.name+=' · 已修改';change(edited);return;
    }
    if(field){style[role][field]=v;if(field==='backgroundRadius'&&v>0&&style[role].backgroundShape==='rect')style[role].backgroundShape='rounded';}else{
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
  function selectRole(r){role=r;const group=fixedStyleGroup();if(group)fixedStyleTrackId=(r==='secondary'?group.secondary:group.main)?.id||group.main.id;fixedPositionRef=null;sync();}
  for(const r of ['main','secondary'])$('style-'+r).onclick=()=>selectRole(r);
  $('style-swap').onclick=()=>{cancelAction();change(S.swapAppearance(value()),undefined,'交换主副字幕样式');};
  for(const id of ['style-pair-order','style-pair-gap'])$(id).onchange=()=>{
    if(!$('style-pair-gap').checkValidity()){$('style-pair-gap').reportValidity();sync();return;}
    cancelAction();change(S.arrangePair(value(),{order:$('style-pair-order').value,gap:Number($('style-pair-gap').value)}),undefined,'调整主副字幕排列');
  };
  panel.querySelector('.msw-style-tabs').addEventListener('keydown',event=>{
    if(!['style-main','style-secondary'].includes(event.target.id)||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)||$('style-secondary').hidden)return;
    event.preventDefault();selectRole(event.key==='Home'?'main':event.key==='End'?'secondary':role==='main'?'secondary':'main');$('style-'+role).focus();
  });
  $('style-project-preset').onchange=()=>{
    const selection=$('style-project-preset').value;
    if(speakerScope()&&selection==='speaker-palette'){cancelAction();commitCueAppearance({}, {replace:true});return;}
    const track=fixedTrackMode()?fixedStyleTarget():null;
    const preset=find(selection);
    if(!preset){rebuild();return;}cancelAction();change(track&&!productionFlatMode()?S.forKind(preset,fixedTrackCore.styleKind(track)):preset,selection);
  };
  $('style-reset').onclick=()=>{const preset=find(selectedPreset);if(!preset)return;cancelAction();change(preset,selectedPreset,'恢复所选预设');};
  $('style-transform-preset').onchange=()=>{
    const tags=$('style-transform-preset').value;
    if(tags==='custom'){$('style-field-t-tags').closest('label').hidden=false;$('style-field-t-tags').focus();return;}
    $('style-field-t-tags').value=tags;$('style-field-t-tags').dispatchEvent(new Event('change',{bubbles:true}));
  };
  async function saveLibrary(next) {
    if(global.MSWConfig?.connected){ global.MSWConfig.storage.setItem('msw.subtitle-presets.v1',JSON.stringify(next)); await global.MSWConfig.flush(); }
    else if(host.config?.processingUrl)await request('subtitle-presets',{version:1,presets:next});
    else (globalThis.MSWConfig?.storage || localStorage).setItem('msw.subtitle-presets.v1',JSON.stringify(next));
    library=next;
  }
  $('style-save-as').onclick=()=>{
    cancelAction();pendingAction={kind:'save',generation:host.generation};
    $('style-preset-name').value=value().name;$('style-save-form').hidden=false;$('style-preset-name').focus();$('style-preset-name').select();
  };
  $('style-overwrite').onclick=()=>{
    const previous=library.find(s=>s.id===activePreset());if(!previous||saving)return;
    cancelAction();const action=pendingAction={kind:'overwrite',generation:host.generation};
    const savedStyle=S.normalize(value()),target=selectionKey();
    const preset={...presetSnapshot({preview:{project_style:previous}}),id:previous.id,name:previous.name};
    void runLibraryAction(action,library.map(s=>s.id===preset.id?preset:s),()=>{
      if(!cueScope()&&target===selectionKey()&&same(value(),savedStyle))change(savedStyle,preset.id,'覆盖字幕预设');
      message('预设已更新。');$('style-overwrite').focus();
    });
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
    const preset={...presetSnapshot(host.data),name,id:global.MSWProject.id('style')};
    const savedStyle=S.normalize(value());
    const target=selectionKey();
    void runLibraryAction(action,[...library,preset],()=>{if(target===selectionKey()&&same(value(),savedStyle)){if(appearanceScope())commitCueAppearance({}, {presetId:preset.id});else change(fixedTrackMode()&&fixedStyleTarget()?S.forKind(preset,fixedTrackCore.styleKind(fixedStyleTarget())):preset,preset.id,'另存为字幕预设');}message('预设已保存。');$('style-save-as').focus();});
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
    $('video-export-speaker-wrap').hidden=target==='none';
    override=enabled?{style:S.normalize(other?(exportPreset()||S.defaults()):projectStyle()),target,other,label:other?(exportPreset()?.name||'默认白字'):'工程样式'}:null;
    refresh();
  }
  for(const id of ['video-export-burn-subtitles','video-export-style-source','video-export-speaker-labels'])$(id).addEventListener('change',syncExport);
  global.addEventListener('msw:export-tracks',syncExport);
  new MutationObserver(syncExport).observe(exportPanel,{attributes:true,attributeFilter:['aria-hidden']});
  const settingsPanel=$('media-settings-modal');
  new MutationObserver(()=>{
    if(settingsPanel.getAttribute('aria-hidden')==='true')cancelAction();
    if(ready){sync();fixedPreviewInvalidate();refresh();}
  }).observe(settingsPanel,{attributes:true,attributeFilter:['aria-hidden']});
  $('style-more').addEventListener('toggle',()=>{if(ready){syncPosition();refresh();}});
  function currentPreview() {
    if(fixedPositionEditing)return {style:projectStyle(),target:host.subtitlePreviewTarget(),scope:'project',label:'定位中：Esc取消，Enter完成'};
    if(override)return {...override,speakerLabels:$('video-export-speaker-labels').checked,trackIds:global.MSWVideoSubtitleScope?.ids()??null,scope:'export',label:'导出预览：'+override.label};
    if(propertiesVisible())return {style:projectStyle(),target:host.subtitlePreviewTarget(),scope:'project',label:'属性预览：工程样式'};
    const target=host.subtitlePreviewTarget();
    return {style:proof.mode==='project'?projectStyle():S.normalize(find(proof.mode)||S.defaults()),target,scope:proof.mode==='project'?'project':'proof',label:proof.mode==='project'?'工程字幕样式':'仅影响预览'};
  }
  global.MSWSubtitleStyle={currentPreview,editTrack,open,propertiesVisible,syncSelection:()=>{
    if(!ready)return;
    const ids=[...fixedPositionSelectedIds()].sort();
    if(!speakerScope()&&!fixedPositionEditing&&ids.length&&JSON.stringify(ids)!==lastCueSelection){editScope='cue';fixedPositionScope='cue';}
    // A hidden dock follows selection when reopened; do not build its forms,
    // animation graphs or full-project preview geometry for a context menu.
    if(!propertiesVisible()&&!fixedPositionEditing)return;
    const key=selectionKey();if(key!==lastSelectionKey){lastSelectionKey=key;cancelAction();rebuild();sync();}else syncPosition();
  },syncPosition,previewLibrary:()=>S.toLibrary(currentPreview().style),
    applyExport:project=>{
      project.preview||={};project.preview.speaker_label_export=$('video-export-speaker-labels').checked;
      if($('video-export-burn-subtitles').value==='none')return;
      if(!ready)throw Error('工程字幕样式尚未加载，请稍后导出');
      const other=$('video-export-style-source').value!=='project';
      if(other)S.applyPreset(project,exportPreset()||S.defaults());else S.apply(project,projectStyle());
    },
    get ready(){return ready;},get error(){return loadError;},request};
  let wasVisible=propertiesVisible();
  new ResizeObserver(()=>{
    const visible=propertiesVisible();if(visible===wasVisible)return;wasVisible=visible;
    if(!visible){cancelAction();if(fixedPositionEditing)fixedStopPositioning(false);}
    if(ready){global.MSWHelp?.hydrate(panel);rebuild();sync();fixedPreviewInvalidate();refresh();}
  }).observe(propertyRoot);
  async function initialize() {
    ready=false;loadError='';panel.inert=true;$('style-retry').hidden=true;
    const generation=host.generation;
    try {
      if(host.config?.processingUrl && !global.MSWConfig?.connected) {
        library=(await request('subtitle-presets')).presets;
      } else library=JSON.parse((globalThis.MSWConfig?.storage || localStorage).getItem('msw.subtitle-presets.v1')||'[]');
      if(!Array.isArray(library))library=[];
      library=library.filter(s=>!/^legacy-(profile|style|srt-burn)/.test(s.id||''));
      if(generation!==host.generation)return;
      if(S.migrate(host.data))host.persistStyleMigration();
      styleGeneration=generation;ready=true;message('');rebuild();sync();syncExport();
    } catch(error) {if(generation===host.generation){loadError=error.message;message('字幕样式加载失败：'+error.message,true);$('style-retry').hidden=false;}}
    finally {if(generation===host.generation)panel.inert=false;}
  }
  $('style-retry').onclick=()=>void initialize();
  global.addEventListener('msw:project-changed',()=>{cancelAction();override=null;role='main';void initialize();});
  global.addEventListener('msw:speakers-changed',()=>{if(ready){rebuild();sync();refresh();}});
  global.addEventListener('msw:burn-style',()=>{if(ready){rebuild();sync();if(override)syncExport();else refresh();}});
  global.addEventListener('msw:subtitles-changed',()=>{if(ready){if(fixedTrackMode())rebuild();sync();}});
  global.addEventListener('msw:media-changed',()=>{if(ready){sync();refresh();}});
  void initialize();
})(window);
