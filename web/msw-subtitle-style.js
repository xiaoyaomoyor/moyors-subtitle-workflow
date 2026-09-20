(function(global) {
  'use strict';
  const host=global.MSWE?.resolve('processing-host');if(!host)return;
  const t=s=>global.MSWE_I18N?.translateText?.(s)||s;
  const defaults={main:{font_family:'Arial',font_size:48,color:'#ffffff',outline_color:'#000000',outline:2,background_color:'#000000',background_alpha:0,x:.5,y:.86,width:.8},
    secondary:{font_family:'Arial',font_size:40,color:'#ffffff',outline_color:'#000000',outline:2,background_color:'#000000',background_alpha:0,x:.5,y:.94,width:.8}};
  const panel=document.createElement('aside');panel.id='burn-style-panel';panel.className='gap-remove-panel msw-processing-panel';
  panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','false');panel.setAttribute('aria-hidden','true');panel.setAttribute('aria-labelledby','burn-style-title');
  panel.innerHTML=`<header class="gap-remove-panel-header" id="burn-style-drag"><div class="gap-remove-heading"><span class="gap-remove-eyebrow">视频导出</span><h3 id="burn-style-title">字幕样式与预览</h3></div><button type="button" class="gap-remove-close" id="burn-style-close" aria-label="关闭字幕样式">${document.querySelector('#video-export-close').innerHTML}</button></header>
    <div class="gap-remove-panel-body"><div class="msw-processing-fields">
    <label>字幕轨道<select id="burn-style-track"><option value="main">主字幕</option><option value="secondary">副字幕</option></select></label>
    <label>预览内容<select id="burn-style-target"><option value="main">主字幕</option><option value="secondary">副字幕</option><option value="both">主字幕 + 副字幕</option></select></label></div>
    <div id="burn-style-fields" class="msw-processing-fields"></div>
    <div class="msw-processing-actions"><button type="button" id="burn-style-copy">从当前预览样式复制</button><button type="button" id="burn-style-reset">恢复默认</button></div>
    <p class="msw-processing-hint" data-help-for="burn-style-title">样式随工程保存。字号按画面高度百分比设置，位置为文字框底部中心。当前帧与样片使用和正式导出相同的字体渲染；复制播放器样式后请确认实际换行。播放器中的说话人下划线与表情包不复制。</p>
    <div class="msw-processing-actions"><button type="button" id="burn-style-frame">预览当前帧</button><span id="burn-style-sample-help"><button type="button" id="burn-style-sample">生成五秒样片</button></span></div>
    <p data-help-for="burn-style-sample-help" class="msw-processing-hint">从播放头生成五秒样片，保留空隙，超出视频时定格延长。使用当前导出音量和字幕样式，不改变正式导出范围。</p>
    <p id="burn-style-message" class="msw-processing-message" role="status"></p><img id="burn-style-image" hidden alt="实际烧录效果预览"></div>`;
  document.body.append(panel);
  const el=id=>document.getElementById('burn-style-'+id);
  const fields=[['font_family','字体','text'],['font_size','字号（画面高度 %）','number',.75,18.5,'any'],['color','文字颜色','color'],['outline_color','描边颜色','color'],
    ['outline','描边宽度（1080p 基准）','number',0,12,.5],['background_color','背景颜色','color'],['background_alpha','背景不透明度（%）','number',0,100,1],
    ['x','水平位置（%）','number',0,100,1],['y','垂直位置（%）','number',0,100,1],['width','文字框宽度（%）','number',10,100,1]];
  for(const [key,label,type,min,max,step] of fields){const row=document.createElement('label');row.textContent=t(label);const input=document.createElement('input');input.id='burn-style-'+key;input.type=type;
    if(type==='number'){input.min=min;input.max=max;input.step=step;}if(type==='text')input.maxLength=128;row.append(input);el('fields').append(row);}
  const floating=host.createFloatingPanel({panel,dragHandle:el('drag'),anchorButton:document.getElementById('video-export-style-open'),positionKey:'msw.burn.style.position'});
  let styles,revision=0,controller=null,previewKey=null;
  const subtitleKey=()=>JSON.stringify([host.data.segments,host.data.multi_subtitle?.tracks?.[0]?.segments].map(cues=>(cues||[]).map(c=>[c.start,c.end,c.text,c.disabled])));
  const clone=value=>JSON.parse(JSON.stringify(value));
  function read(){styles={main:{...defaults.main,...host.data.preview?.burn_subtitles?.main},secondary:{...defaults.secondary,...host.data.preview?.burn_subtitles?.secondary}};}
  function display(){const s=styles[el('track').value];for(const [key]of fields)el(key).value=key==='font_size'?Number((s[key]/10.8).toFixed(3)):['x','y','width','background_alpha'].includes(key)?Number((s[key]*100).toFixed(3)):s[key];}
  function stale(){revision++;controller?.abort();controller=null;el('image').hidden=true;el('message').textContent='';el('frame').disabled=false;}
  function save(){host.setBurnStyles(styles);stale();global.dispatchEvent(new Event('msw:burn-style'));}
  el('fields').addEventListener('change',event=>{
    const key=event.target.id.replace('burn-style-','');if(!fields.some(f=>f[0]===key))return;
    if(!event.target.validity.valid||!event.target.value.trim()){event.target.reportValidity();return;}
    let value=event.target.type==='number'?Number(event.target.value):event.target.value;
    if(key==='font_family'&&/[,{}\\\x00-\x1f]/.test(value)){el('message').textContent=t('字幕字体名称无效');return;}
    if(key==='font_size')value*=10.8;else if(['x','y','width','background_alpha'].includes(key))value/=100;
    styles[el('track').value][key]=value;save();
  });
  el('track').onchange=display;el('target').onchange=()=>{document.getElementById('video-export-burn-subtitles').value=el('target').value;document.getElementById('video-export-burn-subtitles').dispatchEvent(new Event('input',{bubbles:true}));stale();};
  el('reset').onclick=()=>{styles[el('track').value]=clone(defaults[el('track').value]);save();display();};
  el('copy').onclick=()=>{
    const source=host.subtitlePreviewAppearance(),geo=source.main;
    const family=name=>({default:'Arial',sans:'Arial',yahei:'Microsoft YaHei',hei:'SimHei',song:'SimSun'}[name]||name||'Arial').replace(/[,{}\\\x00-\x1f]/g,' ');
    for(const key of ['main','secondary']){const appearance=source[key];styles[key]={...styles[key],font_family:family(appearance.font_family),
      font_size:Math.max(8,Math.min(200,(appearance.font_size|| (key==='main'?24:22))*1080/source.viewportHeight)),color:appearance.color||defaults[key].color,
      background_color:appearance.background_color||'#000000',background_alpha:appearance.background_alpha??(key==='main'?.65:0),
      x:Math.min(1,geo.x+geo.width/2),width:Math.max(.1,geo.width),y:Math.min(.99,geo.y+geo.height-(key==='main'?.06:0))};}
    save();display();
  };
  el('frame').onclick=async()=>{
    controller?.abort();const request=new AbortController();controller=request;const ticket=++revision,generation=host.generation;
    el('frame').disabled=true;el('image').hidden=true;el('message').textContent=t('正在生成实际预览…');
    try{const project=host.exportProject();previewKey=subtitleKey();for(const key of ['waveform','spectral','waveform_reapeaks'])delete project[key];
      const response=await fetch(host.config.processingUrl+'/video-export-preview',{method:'POST',signal:request.signal,headers:{'Content-Type':'application/json','X-MSW-Token':host.config.requestToken},
        body:JSON.stringify({project_id:project.msw.project_id,project,binding:host.config.processingContext?.binding,at_ms:Math.max(0,Math.round(host.player.currentTime*1000)||0),burn_subtitles:el('target').value})});
      const result=await response.json();if(!response.ok||!result.ok)throw Error(result.error||'生成预览失败');
      if(ticket!==revision||generation!==host.generation)return;
      el('image').src=result.image;el('image').hidden=false;el('message').textContent=t('实际渲染预览')+` · ${(result.at_ms/1000).toFixed(3)} s`;
    }catch(error){if(ticket===revision&&generation===host.generation&&error.name!=='AbortError')el('message').textContent=error.message;}
    finally{if(ticket===revision){el('frame').disabled=false;controller=null;}}
  };
  el('sample').onclick=()=>{global.dispatchEvent(new CustomEvent('msw:video-sample',{detail:{target:el('target').value}}));floating.close();};
  document.getElementById('video-export-style-open').onclick=()=>{stale();read();display();const target=document.getElementById('video-export-burn-subtitles').value;el('target').value=target==='none'?'main':target;floating.open();global.MSWHelp?.hydrate(panel);};
  el('close').onclick=()=>{stale();floating.close();};
  global.addEventListener('msw:project-changed',()=>{stale();floating.close();});
  global.addEventListener('msw:media-changed',stale);
  global.addEventListener('msw:subtitles-changed',()=>{if(previewKey!==null&&previewKey!==subtitleKey()){previewKey=null;stale();}});
  global.MSWBurnStyle={defaults};
})(window);
