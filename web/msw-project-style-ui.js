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
  panel.innerHTML=`<span class="settings-panel-title">字幕样式</span>
    <div class="media-settings-grid msw-style-selectors">
      <label class="media-settings-field" data-option-help="跟随工程样式时预览工程输出；也可选择已有预设，仅用于播放器校对。下方始终编辑工程样式，修改不会切换预览选择。"><span class="msw-option-label">预览样式</span><select id="style-preview-mode"></select></label>
      <label class="media-settings-field" data-option-help="轨道默认：预设作用于所选轨道组。所选字幕：只应用外观，不改变时间、绑定、位置或动画；多选按各条字幕的轨道角色应用。调整立即用于工程，覆盖预设才更新用户预设。另存保存当前外观；多选外观不同时请先选择单条字幕。SRT 仅保存文字和时间。"><span class="msw-option-label">工程样式</span><select id="style-project-preset"></select></label>
    </div>
    <div class="msw-style-toolbar"><div class="msw-style-tabs" role="tablist" aria-label="字幕样式轨道"><button type="button" role="tab" id="style-main" aria-selected="true">主字幕</button><button type="button" role="tab" id="style-secondary" aria-selected="false" tabindex="-1">副字幕</button></div><div class="msw-style-actions" role="group" aria-label="样式预设操作">${iconButton('style-save-as','另存为新预设','save')}${iconButton('style-reset','恢复默认','reset')}${iconButton('style-delete-preset','删除预设','delete')}</div></div>
    <form id="style-save-form" class="msw-style-save-form" hidden><label class="media-settings-field"><span>预设名称</span><input id="style-preset-name" maxlength="80" required></label><button type="submit" id="style-save-preset">保存</button><button type="button" id="style-save-cancel">取消</button></form>
    <div id="style-delete-confirm" class="msw-style-delete-confirm" hidden><p id="style-delete-question"></p><div class="msw-processing-actions"><button type="button" id="style-delete-confirm-button">删除预设</button><button type="button" id="style-delete-cancel">取消</button></div></div>
    <details id="style-general" class="msw-style-section" open><summary>通用</summary><div id="style-basic-fields" class="msw-style-fields"></div></details>
    <details id="style-more" class="msw-style-section"><summary>进阶</summary><div id="style-emphasis-fields" class="msw-style-checks"></div><div id="style-advanced-fields" class="msw-style-fields"></div></details>
    <details id="style-animation" class="msw-style-section"><summary><span class="msw-option-label">动画</span></summary><div id="style-animation-fields"></div></details>
    <small data-help-for="style-animation" hidden>轨道默认只作用于当前主/副轨道；所选字幕按效果覆盖，其余跟随轨道。时间从每条字幕开始计算。新动画会替代原有 ASS 动画；恢复轨道动画可取消单条覆盖。</small>
    <p id="style-message" class="msw-processing-message" role="status"></p><button type="button" id="style-retry" hidden>重新加载样式</button>`;
  $('style-main').insertAdjacentHTML('afterend',iconButton('style-swap','交换主副样式（保留位置）','swap'));
  $('style-save-as').insertAdjacentHTML('beforebegin',iconButton('style-overwrite','覆盖预设','overwrite'));
  panel.querySelector('.settings-panel-title').after(panel.querySelector('.msw-style-toolbar'));
  panel.querySelector('.msw-style-selectors').insertAdjacentHTML('beforebegin',`<div id="style-track-controls" class="media-settings-grid" hidden>
    <label class="media-settings-field" data-option-help="旧工程保留原画面排布。固定轨道排布统一用于预览、ASS 和烧录；各轨道可在下方选择自动排布或固定位置。"><span class="msw-option-label">画面排布</span><select id="style-track-layout"><option value="legacy">保留旧排布</option><option value="fixed">固定轨道排布</option></select></label>
  </div>`);
  const targetTabs=document.createElement('div');targetTabs.className='msw-style-target-tabs';
  const tabs=panel.querySelector('.msw-style-tabs');tabs.before(targetTabs);targetTabs.innerHTML='<select id="style-track-target" aria-label="字幕轨道组"></select>';targetTabs.append(tabs);
  panel.querySelector('#style-more').insertAdjacentHTML('afterend',`<details id="style-track-position" class="msw-style-section" hidden open><summary>排布与画面位置</summary>
    <label class="media-settings-field"><span>排布</span><select id="style-track-placement"><option value="auto">自动排布</option><option value="fixed">固定位置</option></select></label>
    <div id="style-position-fields"><div class="media-settings-grid">
      <label class="media-settings-field" data-option-help="轨道默认作用于未单独定位的字幕。所选字幕使用列表或波形区的实际选区，不自动扩展到绑定的另一侧。坐标相对视频内容，不含黑边；沿用字幕原有对齐锚点。多选时保持相对距离，多个值以首条为基准整体平移。定位时临时预览工程样式，结束后恢复预览选择。"><span class="msw-option-label">定位对象</span><select id="style-position-scope"><option value="track">轨道默认</option><option value="cue">所选字幕</option></select></label>
      <div class="style-position-actions"><button type="button" id="style-position-drag">在画面中定位</button><button type="button" id="style-position-cancel" hidden>取消定位</button><button type="button" id="style-position-finish" hidden>完成定位</button></div>
      <label class="media-settings-field"><span>横向 (%)</span><input id="style-position-x" type="number" min="0" max="100" step="any" required></label>
      <label class="media-settings-field"><span>纵向 (%)</span><input id="style-position-y" type="number" min="0" max="100" step="any" required></label>
    </div><div class="msw-processing-actions"><button type="button" id="style-position-reset">恢复默认位置</button></div><p id="style-position-note" class="msw-processing-hint"></p></div>
  </details>`);
  panel.querySelector('#style-general').insertAdjacentHTML('beforebegin',`<div id="style-pair-controls" class="media-settings-grid">
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
  const backgroundSection=document.createElement('details');backgroundSection.id='style-background';backgroundSection.className='msw-style-section msw-style-background';
  backgroundSection.innerHTML='<summary><span class="msw-option-label">文字背景</span></summary><div id="style-background-fields" class="msw-style-fields"></div>';
  backgroundSection.querySelector('summary').dataset.optionHelp='矩形或圆角背景随整条字幕自动伸缩，包含所有换行；打字机动画保留完整背景。内边距和圆角以 1080p 为基准。开启后替代原有背景框，文字描边与阴影仍保留；预览、ASS 和烧录使用同一背景。';
  $('style-more').append(backgroundSection);
  fields([['backgroundShape','背景形状','select',[['none','无'],['rect','矩形'],['rounded','圆角矩形']]],
    ['backgroundColor','填充颜色','color'],['backgroundOpacity','不透明度 %','number',0,100],
    ['backgroundPaddingX','左右内边距','number',0,240],['backgroundPaddingY','上下内边距','number',0,240],
    ['backgroundRadius','圆角半径','number',0,240]],'style-background-fields');
  const gradientSection=document.createElement('details');gradientSection.id='style-gradient';gradientSection.className='msw-style-section msw-style-background';
  gradientSection.innerHTML='<summary><span class="msw-option-label">文字渐变</span></summary><div id="style-gradient-fields" class="msw-style-fields"></div>';
  gradientSection.querySelector('summary').dataset.optionHelp='双色按整条字幕阅读顺序逐字变化，空格不占步长、换行不重置；单个字内部保持纯色。开启后替代文字和说话人的填充颜色，不影响描边或背景。首尾颜色都支持视频取色，预览、ASS 和烧录一致。';
  backgroundSection.before(gradientSection);
  fields([['gradientMode','渐变方式','select',[['none','关闭'],['characters','双色逐字']]],['gradientStart','起始颜色','color'],['gradientEnd','结束颜色','color']],'style-gradient-fields');
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
  // Proofreading remains a player preference. Authoring lives in one dock.
  const proofPanel=document.createElement('section');proofPanel.className='settings-panel-section msw-project-style';
  proofPanel.innerHTML='<span class="settings-panel-title">字幕预览</span>';
  proofPanel.append($('style-preview-mode').closest('label'));
  const openProperties=document.createElement('button');openProperties.type='button';openProperties.id='subtitle-properties-open';openProperties.textContent='字幕样式与画面位置';proofPanel.append(openProperties);old.before(proofPanel);
  const scopeBar=document.createElement('div');scopeBar.className='msw-properties-scope';
  scopeBar.innerHTML='<label class="media-settings-field"><span>作用范围</span><select id="style-edit-scope"><option value="cue">所选字幕</option><option value="track">轨道默认</option></select></label><span id="style-selection-label"></span>';
  panel.prepend(scopeBar);
  $('style-position-scope').closest('label').hidden=true;
  const restoreAppearance=document.createElement('button');restoreAppearance.type='button';restoreAppearance.id='style-inherit-appearance';restoreAppearance.textContent='恢复轨道外观';
  $('style-project-preset').closest('label').after(restoreAppearance);
  for(const input of panel.querySelectorAll('[data-style-field]')) {
    const reset=document.createElement('button');reset.type='button';reset.className='msw-style-field-reset';reset.dataset.resetStyle=input.dataset.styleField;
    reset.title='此项跟随轨道';reset.setAttribute('aria-label',input.closest('label').querySelector('.msw-option-label').textContent+'跟随轨道');
    reset.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true">'+icons.reset+'</svg>';
    input.closest('label').append(reset);
    reset.onclick=event=>{event.preventDefault();commitCueAppearance({}, {reset:[input.dataset.styleField]});};
  }
  let role='main',library=[],selectedPreset='default',override=null,ready=false,styleGeneration=-1,loadError='',pendingAction=null,saving=false;
  let editScope='cue';fixedPositionScope='cue';
  const M=global.MSWSubtitleAnimation;
  const cueScope=()=>editScope==='cue'&&productionFlatMode();
  const selectedRows=()=>{
    if(!productionFlatMode())return [];
    const ids=fixedPositionSelectedIds();
    return fixedTrackCore.createIndex(host.data).records({includeHidden:true}).filter(r=>ids.has(r.cue_id));
  };
  const rowAppearance=row=>{
    const track=fixedTrack(row.cue,row.role,row.track_id),style=global.MSWTrackPresentation.styleFor(host.data,track);
    return global.MSWCueStyle.apply(style[track.flat_style_slot||'main'],row.cue);
  };
  const presetMatches=(preset,rows=selectedRows())=>rows.length&&rows.every(row=>{
    const track=fixedTrack(row.cue,row.role,row.track_id),candidate=S.forKind(preset,fixedTrackCore.styleKind(track))[track.flat_style_slot||'main'],effective=rowAppearance(row);
    return global.MSWCueStyle.fields.every(k=>candidate[k]===effective[k]);
  });
  const selectionKey=()=>JSON.stringify([editScope,fixedStyleTrackId,...selectedRows().map(r=>r.cue_id).sort()]);
  let lastSelectionKey='';
  const propertiesVisible=()=>!!$('subtitle-properties').getClientRects().length;
  function open(scope=editScope){
    if(fixedPositionEditing)fixedStopPositioning(false);
    editScope=scope;fixedPositionScope=scope;$('style-edit-scope').value=scope;
    waveformEditor?.showModule('properties',{recordUndo:false});waveformEditor?.activateModuleTab('properties');rebuildShowModuleMenu();
    global.MSWHelp?.hydrate(panel);
    rebuild();sync();refresh();
  }
  openProperties.onclick=()=>{host.closeMediaSettings?.();if($('media-settings-modal').getAttribute('aria-hidden')==='false')$('media-settings-close')?.click();open('track');};
  $('style-edit-scope').onchange=()=>{if(fixedPositionEditing)fixedStopPositioning(false);cancelAction();editScope=$('style-edit-scope').value;fixedPositionScope=editScope;rebuild();sync();refresh();};
  restoreAppearance.onclick=()=>commitCueAppearance({}, {replace:true});
  function commitCueAppearance(patch,options={}) {
    if(!ready||styleGeneration!==host.generation||!cueScope())return;
    try {
      const rows=selectedRows(),ids=rows.map(r=>r.cue_id);if(!ids.length)return;
      commitProcessingEdits();const before=global.MSWProductionProject.toProject(host.data);
      let next=global.MSWFlatEditing.updateAppearance(before,ids,patch,options);
      if(options.preset) {
        const batches=new Map();
        for(const row of rows) {
          const track=fixedTrack(row.cue,row.role,row.track_id),slot=track.flat_style_slot||'main';
          const appearance=global.MSWCueStyle.appearance(S.forKind(options.preset,fixedTrackCore.styleKind(track))[slot]),key=JSON.stringify(appearance);
          if(!batches.has(key))batches.set(key,{appearance,ids:[]});
          batches.get(key).ids.push(row.cue_id);
        }
        for(const batch of batches.values())next=global.MSWFlatEditing.updateAppearance(next,batch.ids,batch.appearance,{replace:true,presetId:options.presetId});
      }
      if(JSON.stringify(next)===JSON.stringify(before))return;
      productionCommitProject(next,options.reset||options.replace&&!Object.keys(patch).length?'字幕恢复轨道外观':'修改所选字幕外观',ids);
      fixedPreviewInvalidate();global.dispatchEvent(new Event('msw:burn-style'));
      rebuild();sync();refresh();
    }catch(error){message(error.message,true);sync();}
  }
  const legacyAnimation=document.createElement('details');legacyAnimation.id='motion-legacy';legacyAnimation.className='msw-style-section';
  legacyAnimation.innerHTML='<summary><span class="msw-option-label">原有 ASS 动画</span></summary>';
  legacyAnimation.dataset.optionHelp='原工程的 ASS 动画保持原样。使用上方新动画时替换旧动画；新动画支持所选字幕、叠加和统一时间规则。';
  $('style-animation-fields').before(legacyAnimation);legacyAnimation.append($('style-animation-fields'));
  const motionRoot=document.createElement('div');motionRoot.id='subtitle-motion-controls';legacyAnimation.before(motionRoot);
  function motionContext(){
    const cue=cueScope(),rows=cue?selectedRows():[],target=fixedStyleTarget();
    const sources=cue?rows.map(row=>({row,track:fixedTrack(row.cue,row.role,row.track_id)})):target?[{track:target}]:[];
    const owned=cue?[]:fixedTrackCore.createIndex(host.data).records({includeHidden:true}).filter(r=>r.subtitle_track_id===target?.id);
    const items=sources.map(({row,track})=>{
      const style=global.MSWTrackPresentation.styleFor(host.data,track),base=style[track.flat_style_slot||'main'].animation;
      const override=row?.cue.subtitle_animation;
      const previewRow=row||owned.find(r=>r.cue.start<=player.currentTime*1000&&r.cue.end>player.currentTime*1000)||owned[0];
      return {row,track,style,override,base,legacy:!base&&!override&&Object.values(style.animations).some(e=>e.enabled),value:M.resolve(base,override)||M.defaults(),duration:previewRow?previewRow.cue.end-previewRow.cue.start:1000,preview:previewRow};
    });
    return {cue,items,preview:items[0]?.preview,blocked:!ready||saving||fixedPositionEditing||!productionFlatMode()||!items.length||items.some(i=>i.track.locked)};
  }
  function commitMotion(name,key,value){
    const context=motionContext();if(context.blocked)return;
    commitProcessingEdits();const before=global.MSWProductionProject.toProject(host.data);
    const updates=context.items.map(item=>{
      const effects={};
      for(const effect of name==='all'?M.names:[name]){
        let state=structuredClone(item.value.effects[effect]);
        if(key==='disable')state.enabled=false;
        else if(key!=='reset'){
          if(key==='unit')state=M.convertUnit(state,value,item.duration);
          else if(key.startsWith('channel:')){
            state=M.convertUnit(state,context.items[0].value.effects.curves.unit,item.duration);
            const channel=key.slice(8);if(value===null)delete state.channels[channel];else state.channels[channel]=structuredClone(value);
          }else state[key]=value;
        }
        effects[effect]=state;
      }
      const animation={schema:M.schema,effects};if(key!=='reset'&&!M.valid(animation))throw Error('动画参数无效：时间须递增且不能重合，数值须在允许范围内');
      return {id:item.row?.cue_id,animation,item};
    });
    let next;
    if(context.cue)next=global.MSWFlatEditing.updateAnimation(before,updates,key==='reset'?{reset:name}:{});
    else{
      const {item,animation}=updates[0],style=S.normalize(item.style),slot=item.track.flat_style_slot||'main';
      style[slot].animation=key==='reset'?M.defaults():M.resolve(item.base,animation);
      next=global.MSWFlatEditing.updateTrack(before,item.track.id,{style:{...before.subtitles.tracks.find(t=>t.id===item.track.id).style,mode:'snapshot',value:style}});
    }
    if(JSON.stringify(next)===JSON.stringify(before))return;
    productionCommitProject(next,key==='reset'?'恢复轨道动画':'修改字幕动画',context.cue?updates.map(u=>u.id):[...fixedPositionSelectedIds()]);
    fixedPreviewInvalidate();global.dispatchEvent(new Event('msw:burn-style'));rebuild();sync();refresh();
  }
  const motionUI=global.MSWSubtitleAnimationUI.create(motionRoot,{context:motionContext,commit:commitMotion,message:(text,error)=>message(text,error),preview:()=>{
    const row=motionContext().preview;if(!row)return;player.currentTime=row.cue.start/1000;void player.play().catch(error=>message(error.message,true));
  }});
  let proof={mode:'project'};
  try {
    const saved=JSON.parse(localStorage.getItem('msw.subtitle-proof.v1')||'{}');proof.mode=saved.mode||'project';
  } catch(_) {}
  const projectStyle=()=>host.data.preview?.project_style || S.defaults();
  const all=()=>[...S.presets(),...library];
  const find=id=>all().find(s=>s.id===id);
  const value=()=>{
    if(cueScope()) {const style=S.normalize(projectStyle()),row=selectedRows()[0];delete style.annotation;if(row)style.main=style.secondary=rowAppearance(row);return style;}
    return fixedTrackMode()&&fixedStyleTarget()?fixedStyleValue():projectStyle();
  };
  function presetSnapshot(project) {
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
    const chosen=track?fixedStyleGroup()?.main.style.selection||track.style.selection:host.data.preview?.project_style_selection;
    const group=fixedStyleGroup(),inherited=group?[group.main,group.secondary].filter(Boolean).every(t=>t.style.mode==='inherit'):track?.style.mode==='inherit';
    selectedPreset=find(chosen)?chosen:all().find(s=>same(s,value()))?.id||(inherited?'default':'');
    if(cueScope()) {
      const rows=selectedRows();
      const saved=rows[0]?.cue.subtitle_style_preset;
      selectedPreset=find(saved)&&rows.every(r=>r.cue.subtitle_style_preset===saved)?saved:all().find(s=>presetMatches(s,rows))?.id||'';
    }
    fill($('style-project-preset'),[...(!selectedPreset?[['','未保存为预设']]:[]),...all().map(s=>[s.id,t(s.name)+(s.id===selectedPreset&&!(cueScope()?presetMatches(s):same(s,value()))?' · '+t('已修改'):'')])],selectedPreset);
    if(!selectedPreset)$('style-project-preset').options[0].disabled=true;
    if(cueScope()&&!selectedPreset)$('style-project-preset').options[0].textContent=selectedRows().some(r=>r.cue.subtitle_style)?'已单独调整':'跟随轨道';
    $('style-project-preset').closest('label').querySelector('.msw-option-label').firstChild.textContent=cueScope()?'应用外观预设':'工程样式';
    const selected=$('video-export-style-source').value;
    fill($('video-export-style-source'),[['project','跟随工程样式'],...all().map(s=>['preset:'+s.id,s.name])],selected || 'project');
    if(!$('video-export-style-source').value)$('video-export-style-source').value='project';
  }
  function sync() {
    // Undo/project reload can clear selection without passing syncSelection.
    // Cache the selection actually rendered, not the one from before undo.
    lastSelectionKey=selectionKey();
    const style=S.normalize(value()||S.defaults());
    const track=fixedTrackMode()?fixedStyleTarget():null;
    const group=fixedStyleGroup();
    const rows=cueScope()?selectedRows():[],appearances=rows.map(rowAppearance);
    panel.classList.toggle('editing-cues',cueScope());
    const blocked=cueScope()?(!rows.length||rows.some(r=>fixedTrack(r.cue,r.role,r.track_id)?.locked)):!!track&&(track.locked||group?.main.locked||group?.secondary?.locked||!fixedPresentationMode());
    $('style-edit-scope').value=editScope;$('style-edit-scope').disabled=fixedPositionEditing;
    $('style-selection-label').textContent=cueScope()?(rows.length===1?fixedCueLabel(rows[0].cue,rows[0].role,rows[0].track_id):rows.length?`已选 ${rows.length} 条 · ${new Set(rows.map(r=>r.subtitle_track_id)).size} 轨`:'请选择字幕'):'未单独设置的字幕跟随轨道';
    $('style-track-target').hidden=cueScope();
    restoreAppearance.hidden=!cueScope();restoreAppearance.disabled=blocked||!rows.some(r=>r.cue.subtitle_style);
    $('style-animation').hidden=false;
    legacyAnimation.hidden=cueScope()||!motionContext().items.some(i=>i.legacy);
    $('style-track-position').hidden=!fixedPresentationMode()||!cueScope()&&(!track||!productionFlatMode()&&fixedTrackCore.placement(track)!=='fixed');
    $('style-track-placement').value=track?fixedTrackCore.placement(track):'auto';$('style-track-placement').disabled=blocked;
    $('style-position-fields').hidden=!productionFlatMode()&&(!track||fixedTrackCore.placement(track)!=='fixed');
    if(productionFlatMode())syncPosition();
    else if(track&&fixedTrackCore.placement(track)==='fixed') {
      const p=fixedPositionCurrent(),group=fixedSelectedPositionGroup();
      $('style-position-scope').value=fixedPositionScope;
      for(const key of ['x','y']){$('style-position-'+key).value=Math.round(p[key]*1000)/10;$('style-position-'+key).disabled=blocked||fixedPositionScope==='cue'&&!group;}
      $('style-position-drag').disabled=blocked;$('style-position-reset').disabled=blocked||fixedPositionScope==='cue'&&!group;
      $('style-position-reset').textContent=fixedPositionScope==='cue'?'跟随轨道位置':'恢复默认位置';
      $('style-position-note').textContent=fixedPositionScope==='cue'?(group?'当前字幕：'+group.rows[0].cue.text:'点击“在画面中定位”，选择要调整的字幕。'):'轨道位置作用于未单独定位的字幕。';
    }
    const removable=library.find(s=>s.id===activePreset());
    const mixed=cueScope()&&appearances.some(a=>global.MSWCueStyle.fields.some(k=>a[k]!==appearances[0][k]));
    $('style-overwrite').disabled=saving||blocked||mixed||!removable||(cueScope()?presetMatches(removable):same(removable,style));
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
    const secondary=!cueScope()&&(productionFlatMode()?!!group?.secondary:host.data.multi_subtitle?.enabled===true);
    $('style-secondary').hidden=!secondary;$('style-swap').hidden=!secondary;if(!secondary)role='main';
    if(group&&!cueScope())role=group.secondary?.id===track.id?'secondary':'main';
    for(const r of ['main','secondary']) {
      $('style-'+r).textContent=t(r==='main'?'主字幕':'副字幕');
      $('style-'+r).hidden=cueScope()|| (productionFlatMode()?!secondary:r==='secondary'&&!secondary);
    }

    $('style-pair-controls').hidden=!secondary;const pair=S.pairSettings(style);$('style-pair-order').value=pair.order;$('style-pair-gap').value=pair.gap;
    for(const r of ['main','secondary'])$('style-'+r).setAttribute('aria-pressed',String(role===r));
    for(const input of panel.querySelectorAll('[data-style-field]')) {const v=style[role][input.dataset.styleField];if(input.type==='checkbox')input.checked=!!v;else input.value=v??'';}
    for(const input of panel.querySelectorAll('[data-style-field]')) {
      const field=input.dataset.styleField,label=input.closest('label'),reset=label.querySelector('[data-reset-style]');
      label.hidden=cueScope()&&!global.MSWCueStyle.fields.includes(field);
      const changed=cueScope()&&rows.some(r=>Object.hasOwn(r.cue.subtitle_style||{},field));
      const different=cueScope()&&appearances.some(a=>a[field]!==appearances[0][field]);
      label.classList.toggle('is-overridden',changed);label.classList.toggle('is-mixed',different);
      input.setAttribute('aria-description',different?'多个值':changed?'已单独设置':'跟随轨道');
      if(input.type==='checkbox')input.indeterminate=different;
      else if(different){input.value='';input.placeholder='多个值';}
      else input.placeholder='';
      reset.hidden=!changed;reset.disabled=saving||blocked;
    }
    for(const input of panel.querySelectorAll('[data-animation]')) {const [g,k]=input.dataset.animation.split('.'),v=style.animations[g][k];if(input.type==='checkbox')input.checked=!!v&&!(g==='fad'&&style.animations.fade.enabled);else input.value=v??'';}
    $('style-field-charsPerLine').closest('label').hidden=style[role].wrapMode!=='characters';
    const backgroundValues=cueScope()?selectedRows().map(rowAppearance):[style[role]];
    const withBackground=backgroundValues.some(s=>global.MSWSubtitleBackground.enabled(s));
    for(const key of global.MSWSubtitleBackground.fields.filter(k=>k!=='backgroundShape')) {
      const input=$('style-field-'+key);
      input.closest('label').hidden=!withBackground||(key==='backgroundRadius'&&!backgroundValues.some(s=>s.backgroundShape==='rounded'));
    }
    $('style-field-borderStyle').disabled ||= withBackground;
    const withGradient=backgroundValues.some(s=>global.MSWSubtitleGradient.enabled(s));
    for(const key of ['gradientStart','gradientEnd'])$('style-field-'+key).closest('label').hidden=!withGradient;
    for(const input of panel.querySelectorAll('[data-style-field][type=color]'))$('style-pick-'+input.dataset.styleField).disabled=input.disabled||fixedPositionEditing;
    $('style-preview-mode').value=proof.mode;
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
    $('style-position-drag').hidden=fixedPositionEditing;
    $('style-position-cancel').hidden=$('style-position-finish').hidden=!fixedPositionEditing;
    for(const id of ['style-position-scope','style-track-target','style-main','style-secondary'])$(id).disabled=fixedPositionEditing;
    if(!productionFlatMode()) {
      if(fixedPositionEditing)for(const key of ['x','y'])positionValue(key,fixedPositionCurrent()[key]);
      return;
    }
    const track=fixedStyleTarget(),selected=fixedPositionScope==='cue',rows=selected?fixedPositionSelection():[];
    const locked=selected?rows.some(r=>fixedTrack(r.cue,r.role,r.track_id)?.locked):track?.locked;
    const enabled=!locked&&(selected?rows.length>0&&rows.every(r=>r.position):track&&fixedTrackCore.placement(track)==='fixed');
    const p=fixedPositionCurrent();$('style-position-scope').value=fixedPositionScope;
    for(const key of ['x','y']) {
      const input=$('style-position-'+key);input.disabled=!enabled;
      positionValue(key,p[key],enabled);
      input.placeholder=enabled&&p[key]===null?'多个值':'';
    }
    $('style-track-placement').closest('label').hidden=selected;
    $('style-position-drag').disabled=!enabled||selected&&rows.some(r=>!r.entry);
    $('style-position-reset').disabled=fixedPositionEditing||locked||!track||(selected?!rows.some(r=>r.cue.subtitle_position):!enabled||!track.position);
    $('style-position-reset').textContent=selected?'跟随轨道位置':'恢复默认位置';
    $('style-position-note').textContent=selected?fixedPositionSelectionLabel(rows)+(locked?' · 所选轨道已锁定':rows.length&&!enabled?' · 请先启用字幕及轨道':rows.some(r=>r.cue.subtitle_position)?' · 已单独定位':rows.length?' · 跟随轨道位置':''):track&&fixedTrackCore.placement(track)==='auto'?'自动排布使用样式中的对齐与边距；可切换“所选字幕”单独定位。':'轨道位置作用于未单独定位的字幕。';
  }
  function refresh() {
    host.useProjectStylePreview();host.refreshStylePreview();global.MSWSubtitleRenderer?.invalidate();
    global.MSWPreviewControls?.refresh();
  }
  function change(style,selection=find(selectedPreset)?selectedPreset:'current',label='修改工程字幕样式') {
    if(!ready||styleGeneration!==host.generation)return;
    if(cueScope()){commitCueAppearance({}, {preset:style,...(find(selection)?{presetId:selection}:{})});return;}
    if(fixedTrackMode()&&fixedStyleTarget()) {
      if(!fixedCommitStyle(style,selection)){sync();message(fixedLastMessage||'无法修改轨道样式',true);return;}
    }
    else host.commitProjectStyle(style,label,selection);
    rebuild();sync();refresh();
  }
  function cancelAction(){pendingAction=null;$('style-save-form').hidden=true;$('style-delete-confirm').hidden=true;}
  $('style-track-layout').onchange=()=>{cancelAction();fixedSetPresentation($('style-track-layout').value);rebuild();sync();refresh();};
  function editTrack(id,show=true){cancelAction();message('');editScope='track';fixedPositionScope='track';fixedStyleTrackId=id;fixedPositionRef=null;if(productionFlatMode()&&fixedStyleTarget())role=fixedStyleTarget().secondary_for?'secondary':'main';rebuild();sync();if(show)open('track');}
  $('style-track-target').onchange=()=>editTrack($('style-track-target').value,false);
  $('style-track-placement').onchange=()=>{const track=fixedStyleTarget();if(track)fixedUpdateTrack(track.id,{layout:$('style-track-placement').value});sync();refresh();};
  $('style-position-scope').onchange=()=>{fixedPositionScope=$('style-position-scope').value;fixedPreviewInvalidate();sync();refresh();};
  $('style-position-drag').onclick=()=>fixedStartPositioning();
  $('style-position-cancel').onclick=()=>fixedStopPositioning(false);
  $('style-position-finish').onclick=()=>fixedStopPositioning(true);
  $('style-position-reset').onclick=()=>{positionDrafts.clear();fixedCommitPosition(null);sync();refresh();};
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
    const style=S.normalize(value()),v=input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.tagName==='SELECT'&&!['wrapMode','backgroundShape','gradientMode'].includes(field)?Number(input.value):input.value;
    if(cueScope()){if(field)commitCueAppearance({[field]:v});return;}
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
    if(host.config?.processingUrl)await request('subtitle-presets',{version:1,presets:next});
    else localStorage.setItem('msw.subtitle-presets.v1',JSON.stringify(next));
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
    void runLibraryAction(action,[...library,preset],()=>{if(target===selectionKey()&&same(value(),savedStyle)){if(cueScope())commitCueAppearance({}, {presetId:preset.id});else change(fixedTrackMode()&&fixedStyleTarget()?S.forKind(preset,fixedTrackCore.styleKind(fixedStyleTarget())):preset,preset.id,'另存为字幕预设');}message('预设已保存。');$('style-save-as').focus();});
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
  global.addEventListener('msw:export-tracks',syncExport);
  new MutationObserver(syncExport).observe(exportPanel,{attributes:true,attributeFilter:['aria-hidden']});
  const settingsPanel=$('media-settings-modal');
  new MutationObserver(()=>{
    if(settingsPanel.getAttribute('aria-hidden')==='true')cancelAction();
    if(ready){sync();fixedPreviewInvalidate();refresh();}
  }).observe(settingsPanel,{attributes:true,attributeFilter:['aria-hidden']});
  $('style-track-position').addEventListener('toggle',()=>{if(ready){fixedPreviewInvalidate();refresh();}});
  function currentPreview() {
    if(fixedPositionEditing)return {style:projectStyle(),target:host.subtitlePreviewTarget(),scope:'project',label:'定位中：Esc取消，Enter完成'};
    if(override)return {...override,trackIds:global.MSWVideoSubtitleScope?.ids()??null,scope:'export',label:'导出预览：'+override.label};
    if(propertiesVisible())return {style:projectStyle(),target:host.subtitlePreviewTarget(),scope:'project',label:'属性预览：工程样式'};
    const target=host.subtitlePreviewTarget();
    return {style:proof.mode==='project'?projectStyle():S.normalize(find(proof.mode)||S.defaults()),target,scope:proof.mode==='project'?'project':'proof',label:proof.mode==='project'?'工程字幕样式':'仅影响预览'};
  }
  global.MSWSubtitleStyle={currentPreview,editTrack,open,propertiesVisible,syncSelection:()=>{if(ready){const key=selectionKey();if(key!==lastSelectionKey){lastSelectionKey=key;cancelAction();rebuild();sync();}else syncPosition();}},syncPosition,previewLibrary:()=>S.toLibrary(currentPreview().style),
    applyExport:project=>{
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
      if(host.config?.processingUrl) {
        library=(await request('subtitle-presets')).presets;
      } else library=JSON.parse(localStorage.getItem('msw.subtitle-presets.v1')||'[]');
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
  global.addEventListener('msw:burn-style',()=>{if(ready){rebuild();sync();if(override)syncExport();else refresh();}});
  global.addEventListener('msw:subtitles-changed',()=>{if(ready){if(fixedTrackMode())rebuild();sync();}});
  global.addEventListener('msw:media-changed',()=>{if(ready){sync();refresh();}});
  void initialize();
})(window);
