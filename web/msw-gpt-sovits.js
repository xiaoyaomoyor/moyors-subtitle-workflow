// API v2's everyday controls; model paths and credentials stay on the server.
(function (global) {
  'use strict';
  function create({el, t, request, updateScope, playReference, stopReference}) {
    let data = {models:[], references:[], presets:{}}, busy = false;
    const fields = new Map();
    const panel = el('tts-gpt-fields'), env = el('tts-gpt-management');
    function grid(parent) { const box = document.createElement('div'); box.className = 'msw-processing-grid'; parent.append(box); return box; }
    function field(parent, key, title, type='text', options=[]) {
      const label = document.createElement('label'); label.className = type === 'checkbox' ? 'msw-tts-check' : 'msw-processing-field';
      const span = document.createElement('span'); span.textContent = t(title);
      const input = document.createElement(type === 'select' ? 'select' : type === 'textarea' ? 'textarea' : 'input');
      if(['preset','speaker_ref','gpt_model','sovits_model','aux_refs','manage_ref','preset_manage'].includes(key))input.dataset.i18nSkip='';
      input.id = 'tts-gpt-' + key; if (input.tagName === 'INPUT') input.type = type;
      if (type === 'textarea') { input.rows = 2; input.maxLength = 2000; }
      if (type === 'select') input.replaceChildren(...options.map(([v,s]) => new Option(t(s),v)));
      label.append(span,input); parent.append(label); fields.set(key,input);
      input.addEventListener('input', () => { stopReference('gpt-sovits'); updateScope(); });
      return input;
    }
    function button(parent, id, title, task) {
      const b=document.createElement('button');b.type='button';b.id='tts-gpt-'+id;b.textContent=t(title);
      b.onclick=async()=>{if(busy)return;busy=true;b.disabled=true;b.setAttribute('aria-busy','true');if(['check','scan'].includes(id)){b.textContent=t('正在验证…');status.textContent=t(id==='check'?'正在验证连接…':'正在扫描本机模型…');status.setAttribute('aria-busy','true');}updateScope();try{await task();}catch(e){status.textContent=e.message;}finally{busy=false;b.disabled=false;b.textContent=t(title);b.setAttribute('aria-busy','false');status.setAttribute('aria-busy','false');updateScope();}};
      if(parent.classList.contains('msw-processing-actions')||parent.classList.contains('msw-voice-picker-footer'))parent.append(b);
      else {const row=document.createElement('div');row.className='msw-processing-actions';row.append(b);parent.append(row);}return b;
    }
    function details(parent,title) {const d=document.createElement('details'),s=document.createElement('summary');s.textContent=t(title);d.append(s);parent.append(d);return d;}
    field(panel,'preset','配音预设','select',[['','选择已保存预设']]);
    const common=grid(panel);
    field(common,'gpt_model','GPT 模型','select');field(common,'sovits_model','SoVITS 模型','select');
    const languages=[['zh','中文（中英混合）'],['all_zh','中文'],['en','English'],['ja','日本語（日英混合）'],['all_ja','日本語'],['yue','粤语'],['ko','한국어'],['auto','多语种自动'],['auto_yue','多语种自动（含粤语）']];
    field(common,'language_type','生成语言','select',languages);field(common,'prompt_lang','参考语言','select',languages);
    const picker=document.createElement('div');picker.className='msw-voice-picker';panel.append(picker);
    const search=field(picker,'voice_search','参考音色','search');search.placeholder=t('搜索参考名称');
    field(picker,'speaker_ref','选择音色','select',[['','请选择或上传参考音频']]);
    const preview=document.createElement('div');preview.className='msw-voice-picker-footer';picker.append(preview);
    const current=document.createElement('p');current.id='tts-gpt-current';current.className='msw-processing-hint';current.dataset.i18nSkip='';current.setAttribute('aria-live','polite');preview.append(current);
    function currentVoice(){const row=data.references.find(v=>v.id===fields.get('speaker_ref').value);current.textContent=`${t('当前音色')}：${row?.name||t('未选择')}`;el('tts-gpt-preview').disabled=!row;}
    search.oninput=()=>{const id=fields.get('speaker_ref').value,query=search.value.trim().toLowerCase();choices('speaker_ref',data.references.filter(v=>v.id===id||v.name.toLowerCase().includes(query)),id);currentVoice();};
    fields.get('speaker_ref').addEventListener('change',currentVoice);
    field(panel,'prompt_text','参考音频文字','textarea');
    const secondary=grid(panel);
    const speed=field(secondary,'speed_factor','语速（倍）','number');speed.min='.5';speed.max='2';speed.step='.05';speed.value='1';
    field(secondary,'text_split_method','断句方式','select',[['cut0','不切分'],['cut1','每四句'],['cut2','约 50 字'],['cut3','中文句号'],['cut4','英文句号'],['cut5','按标点切分']]);
    button(preview,'preview','试听参考',async()=>{const id=fields.get('speaker_ref').value;if(!id)throw Error(t('请选择或上传参考音频'));
      await playReference('gpt-sovits',t('试听参考'),()=>request('gpt-reference?id='+encodeURIComponent(id),null,true),()=>fields.get('speaker_ref').value===id);});
    const advanced=details(panel,'高级生成参数'), ag=grid(advanced);
    const noPrompt=field(ag,'no_prompt','不使用参考文字','checkbox');
    noPrompt.parentElement.firstChild.classList.add('msw-option-label');
    noPrompt.parentElement.dataset.optionHelp='仍需 3–10 秒参考音频。V3/V4 必须填写参考文字；跨语言时参考语言与生成语言分别设置。';
    const aux=field(ag,'aux_refs','辅助参考音频（最多 8 条）','select');aux.multiple=true;aux.size=3;
    for(const [key,title,min,max,step,value] of [['top_k','Top K',1,100,1,15],['top_p','Top P',.01,1,.01,1],['temperature','温度',.01,2,.01,1],['seed','随机种子（−1 为随机）',-1,4294967295,1,-1],['repetition_penalty','重复惩罚',1,2,.05,1.35],['sample_steps','采样步数',4,128,1,32]]) {
      const f=field(ag,key,title,'number');Object.assign(f,{min:String(min),max:String(max),step:String(step),value:String(value)});
    }
    field(ag,'super_sampling','V3 超采样','checkbox');
    const status=document.createElement('p');status.id='tts-gpt-status';status.className='msw-processing-message';status.setAttribute('role','status');env.append(status);
    const conn=grid(env);field(conn,'url','本机服务地址','url').value='http://127.0.0.1:9880';
    const timeout=field(conn,'timeout','单次等待上限（秒）','number');timeout.min='60';timeout.max='3600';timeout.value='600';
    const actions=document.createElement('div');actions.className='msw-processing-actions';env.append(actions);
    button(actions,'check','连接／检测',async()=>{const result=await request('gpt-sovits',{action:'check',...connection()});status.textContent=t(result.message);});
    button(actions,'scan','扫描本机模型',async()=>{const r=recipe();data={...data,...await request('gpt-sovits',{action:'scan'})};fill(r);status.textContent=`${t('可用模型')} · ${data.models.length}`;});
    const ref=details(env,'参考音频'), rg=grid(ref);
    field(rg,'manage_ref','选择参考','select');
    const refInfo=document.createElement('p');refInfo.id='tts-gpt-ref-info';refInfo.className='msw-processing-hint';ref.append(refInfo);
    function referenceInfo(){const row=data.references.find(v=>v.id===fields.get('manage_ref').value);refInfo.textContent=row?`${row.name} · ${(row.sample_count/row.sample_rate).toFixed(2)} s`:'';}
    fields.get('manage_ref').onchange=referenceInfo;
    button(ref,'manage-preview','试听参考',async()=>{const id=fields.get('manage_ref').value;if(!id)return;
      await playReference('gpt-sovits',t('试听参考'),()=>request('gpt-reference?id='+encodeURIComponent(id),null,true),()=>fields.get('manage_ref').value===id);});
    const input=document.createElement('input');input.type='file';input.accept='.wav,.mp3,.flac,.m4a,.aac,.ogg,.opus';input.hidden=true;input.id='tts-gpt-upload-file';ref.append(input);
    button(ref,'upload','上传参考',async()=>input.click());
    input.onchange=async()=>{const f=input.files[0];if(!f)return;input.value='';if(f.size>32*1024*1024){status.textContent=t('单个导入文件须小于等于 32 MiB');return;}
      busy=true;updateScope();try{const encoded=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(f);});
        const out=await request('gpt-sovits',{action:'upload',filename:f.name,audio_base64:encoded});data.references=out.references;fill({...recipe(),speaker_ref:out.reference.id});fields.get('manage_ref').value=out.reference.id;
        status.textContent=t('参考已保存，可试听或裁切后使用');}catch(e){status.textContent=e.message;}finally{busy=false;updateScope();}};
    const trim=grid(ref);field(trim,'trim_start','裁切开始（秒）','number').value='0';field(trim,'trim_end','裁切结束（秒）','number').value='5';
    for(const key of ['trim_start','trim_end']){fields.get(key).min='0';fields.get(key).step='.01';}
    button(ref,'trim','保存裁切副本',async()=>{const out=await request('gpt-sovits',{action:'trim',id:fields.get('manage_ref').value,start:Number(fields.get('trim_start').value),end:Number(fields.get('trim_end').value)});
      data.references=out.references;fill({...recipe(),speaker_ref:out.reference.id});fields.get('manage_ref').value=out.reference.id;status.textContent=t('裁切副本已保存，原参考保持不变');});
    const presets=details(env,'配音预设');field(presets,'preset_name','预设名称');
    const pa=document.createElement('div');pa.className='msw-processing-actions';presets.append(pa);
    button(pa,'preset-save','保存为本机预设',async()=>{const name=fields.get('preset_name').value.trim();const out=await request('gpt-sovits',{action:'save_preset',name,recipe:recipe()});data.presets=out.presets;fill(recipe());fields.get('preset').value=name;status.textContent=t('配音预设已保存');});
    field(presets,'preset_manage','选择已保存预设','select');
    button(pa,'preset-rename','重命名预设',async()=>{const out=await request('gpt-sovits',{action:'rename_preset',name:fields.get('preset_manage').value,new_name:fields.get('preset_name').value});data.presets=out.presets;fill(recipe());});
    button(pa,'preset-delete','移除预设',async()=>{const name=fields.get('preset_manage').value;if(!name)return;const out=await request('gpt-sovits',{action:'delete_preset',name});data.presets=out.presets;fill(recipe());});
    fields.get('preset').onchange=()=>{const name=fields.get('preset').value;if(data.presets[name]){fill(data.presets[name]);fields.get('preset').value=name;fields.get('preset_manage').value=name;fields.get('preset_name').value=name;}};
    fields.get('preset_manage').onchange=()=>{fields.get('preset_name').value=fields.get('preset_manage').value;};
    fields.get('sovits_model').onchange=capability;
    function capability(){const family=data.models.find(m=>m.id===fields.get('sovits_model').value)?.family;
      fields.get('sample_steps').parentElement.hidden=!['v3','v4'].includes(family);fields.get('super_sampling').parentElement.hidden=family!=='v3';
      if(!['v3','v4'].includes(family))fields.get('sample_steps').value='32';if(family!=='v3')fields.get('super_sampling').checked=false;
      noPrompt.disabled=['v3','v4'].includes(family);if(noPrompt.disabled)noPrompt.checked=false;updateScope();}
    function choices(key,rows,value,empty='请选择'){const input=fields.get(key);input.replaceChildren(new Option(t(empty),''),...rows.map(r=>new Option(r.name,r.id)));
      if(value&&!rows.some(r=>r.id===value))input.add(new Option(`${t('不可用')} · ${value.slice(0,18)}`,value));input.value=value||'';}
    function fill(r){for(const key of ['gpt_model','sovits_model'])choices(key,data.models.filter(m=>m.kind===(key==='gpt_model'?'gpt':'sovits')),r[key]);
      choices('speaker_ref',data.references,r.speaker_ref);choices('manage_ref',data.references,r.speaker_ref);
      for(const key of ['preset','preset_manage'])choices(key,Object.keys(data.presets).map(name=>({name,id:name})),fields.get(key).value,'选择已保存预设');
      aux.replaceChildren(...data.references.map(row=>new Option(row.name,row.id,false,(r.aux_refs||[]).includes(row.id))));
      for(const id of r.aux_refs||[])if(!data.references.some(v=>v.id===id))aux.add(new Option(t('不可用')+' · '+id.slice(0,18),id,true,true));
      for(const [key,value] of Object.entries(r)){if(!fields.has(key)||['gpt_model','sovits_model','speaker_ref','aux_refs'].includes(key))continue;const f=fields.get(key);if(f.type==='checkbox')f.checked=!!value;else f.value=String(value);}
      referenceInfo();currentVoice();capability();}
    function recipe(){const r={provider:'gpt-sovits',model:'api-v2',voice:''};for(const key of ['gpt_model','sovits_model','speaker_ref','language_type','prompt_lang','prompt_text','text_split_method','speed_factor','top_k','top_p','temperature','seed','repetition_penalty','sample_steps','super_sampling','no_prompt']){const f=fields.get(key);r[key]=f.type==='checkbox'?f.checked:f.type==='number'?Number(f.value):f.value;}
      r.aux_refs=[...aux.selectedOptions].map(o=>o.value);return r;}
    function connection(){return {service_url:fields.get('url').value.trim(),timeout:Number(timeout.value)};}
    function hasResources(){const r=recipe();return data.models.some(v=>v.id===r.gpt_model)&&data.models.some(v=>v.id===r.sovits_model)&&data.references.some(v=>v.id===r.speaker_ref);}
    function ready(){const r=recipe();return !busy&&hasResources()&&(r.no_prompt||!!r.prompt_text.trim());}
    return {recipe,connection,ready,hasResources,configure(value){data={...data,...value};fields.get('url').value=data.service_url||'http://127.0.0.1:9880';timeout.value=String(data.timeout||600);if(data.recipe)fill(data.recipe);},
      stopPreview:()=>stopReference('gpt-sovits')};
  }
  global.MSWGptSovits=Object.freeze({create});
})(window);
