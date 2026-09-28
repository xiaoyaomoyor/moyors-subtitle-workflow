// Compact call controls; credentials remain in environment settings.
(function(global){
  'use strict';
  function create({engine,el,t,request,updateScope}){
    const mini=engine==='minimax',prefix='tts-'+engine+'-',panel=el(prefix+'fields'),env=el(prefix+'management');
    let data={voices:[],regions:[],aliases:{}},busy=false,version=0,creationToken='';
    const keys=new Map(), fields={};
    function field(parent,key,title,type){const label=document.createElement('label');label.className='msw-processing-field';
      const span=document.createElement('span');span.className='msw-option-label';span.textContent=t(title);const input=document.createElement(type==='select'?'select':'input');
      if(type!=='select')input.type=type;input.id=prefix+key;label.append(span,input);parent.append(label);fields[key]=input;return input;}
    function grid(parent){const box=document.createElement('div');box.className='msw-processing-grid';parent.append(box);return box;}
    function button(parent,id,title,fn){const b=document.createElement('button');b.type='button';b.id=prefix+id;b.textContent=t(title);b.onclick=fn;parent.append(b);return b;}
    const environment=grid(env),region=field(environment,'region','服务地域','select');
    region.replaceChildren(...(mini?[['cn','中国大陆'],['global','国际']]:[['default','Moss API']]).map(([v,n])=>new Option(t(n),v)));
    if(!mini)region.parentElement.hidden=true;
    const key=field(environment,'key','API Key','password');key.autocomplete='off';
    const timeout=field(environment,'timeout','单次等待上限（秒）','number');Object.assign(timeout,{min:'30',max:'600',value:'180'});
    const controls=grid(panel),model=field(controls,'model','模型','select'),language=field(controls,'language','语言','select');
    const picker=document.createElement('div');picker.className='msw-voice-picker';panel.append(picker);
    const search=field(picker,'search','音色库','search'),catalog=field(picker,'catalog','选择音色','select');
    search.placeholder=t('搜索名称或音色 ID');
    catalog.setAttribute('data-i18n-skip','');
    const voiceDetails=document.createElement('details'),voiceSummary=document.createElement('summary');voiceSummary.textContent=t('音色详情与别名');voiceDetails.append(voiceSummary);picker.append(voiceDetails);
    const voice=field(voiceDetails,'voice','音色 ID','text');voice.maxLength=255;voice.setAttribute('data-i18n-skip','');
    const footer=document.createElement('div');footer.className='msw-voice-picker-footer';picker.append(footer);
    const current=document.createElement('p');current.id=prefix+'current';current.className='msw-processing-hint';current.dataset.i18nSkip='';current.setAttribute('aria-live','polite');footer.append(current);
    const alias=field(voiceDetails,'alias','本机别名','text');alias.maxLength=80;alias.placeholder=t('留空使用平台名称');alias.dataset.i18nSkip='';
    const aliasActions=document.createElement('div');aliasActions.className='msw-processing-actions';voiceDetails.append(aliasActions);
    let aliasVoice='';
    const shortId=id=>id.length>22?id.slice(0,10)+'…'+id.slice(-6):id;
    function voiceLabel(id){const row=data.voices.find(v=>v.id===id);return data.aliases?.[id]||(row?.name&&row.name!==id?row.name:shortId(id));}
    function currentVoice(){const id=voice.value.trim();current.textContent=`${t('当前音色')}：${id?voiceLabel(id):t('未选择')}`;current.title=id;
      if(aliasVoice!==id){aliasVoice=id;alias.value=data.aliases?.[id]||'';}aliasSave.disabled=busy||!id;}
    const aliasSave=button(aliasActions,'alias-save','保存别名',async()=>{if(busy||!voice.value.trim())return;const epoch=version,id=voice.value.trim();busy=true;setBusy();aliasSave.disabled=true;
      try{const out=await request(engine+'-tts',{action:'alias',recipe:recipe(),...connection(),voice_id:id,name:alias.value});if(epoch!==version)return;data.aliases=out.aliases||{};aliasVoice=null;renderVoices();notify('音色别名已保存');global.dispatchEvent(new Event('msw:voice-alias-changed'));}
      catch(e){notify(e.message);}finally{busy=false;setBusy();currentVoice();}});
    button(aliasActions,'voice-copy','复制音色 ID',async()=>{try{await navigator.clipboard.writeText(voice.value.trim());notify('音色 ID 已复制');}catch{notify('无法复制，请选中音色 ID 手动复制');}});
    if(mini){
      const adjustments=grid(panel);
      for(const [name,title,min,max,step,value] of [['speed','语速倍率',.5,2,.05,1],['volume','合成音量倍率',.01,10,.01,1],['pitch','音高（半音）',-12,12,1,0]]){
        const f=field(adjustments,name,title,'number');Object.assign(f,{min:String(min),max:String(max),step:String(step),value:String(value)});f.oninput=updateScope;
      }
      field(adjustments,'emotion','情绪','select');
      const pronunciation=field(panel,'pronunciation','朗读修正','text');pronunciation.maxLength=600;
      pronunciation.parentElement.dataset.optionHelp='只改变这条字幕的实际朗读文本，字幕原文保持不变。可使用 MiniMax 支持的读音标记；重新生成时沿用此文本。';
    }
    if(!mini){const row=grid(panel);const duration=field(row,'expected_duration_sec','期望时长（秒，可选）','number');Object.assign(duration,{min:'0.1',max:'600',step:'0.1'});duration.placeholder=t('自动');duration.oninput=updateScope;const follow=field(row,'follow_subtitle_duration','跟随字幕时长','checkbox');follow.parentElement.classList.add('msw-follow-duration');follow.parentElement.prepend(follow);follow.onchange=updateScope;duration.parentElement.dataset.optionHelp='留空由模型决定。填写后引导每条语音的生成时长，不是硬性上限，也不会裁切音频。勾选跟随字幕时长后，每条使用提交时对应字幕的时长；独立草稿使用手动值。短句异常续说时可尝试合理时长，并明确选择目标语言。';}
    const status=document.createElement('p');status.id=prefix+'status';status.className='msw-processing-message';status.setAttribute('role','status');panel.append(status);
    const actions=document.createElement('div');actions.className='msw-processing-actions';panel.append(actions);
    const envActions=document.createElement('div');envActions.className='msw-processing-actions';env.append(envActions);
    const envStatus=document.createElement('p');envStatus.className='msw-processing-message';envStatus.setAttribute('role','status');env.append(envStatus);
    function notify(text){status.textContent=envStatus.textContent=t(text);}
    function connection(target=null){return {apiKey:target?.region&&target.region!==region.value?'':key.value,timeout:Number(timeout.value)};}
    function recipe(){const value={provider:engine,model:model.value,voice:voice.value.trim(),language_type:language.value||'auto'};
      if(mini)Object.assign(value,{region:region.value,speed:Number(fields.speed.value),volume:Number(fields.volume.value),pitch:Number(fields.pitch.value),emotion:fields.emotion.value});
      if(!mini){if(fields.follow_subtitle_duration.checked&&!fields.follow_subtitle_duration.disabled)value.follow_subtitle_duration=true;else if(fields.expected_duration_sec.value!=='')value.expected_duration_sec=Number(fields.expected_duration_sec.value);}return value;}
    function renderVoices(){const query=search.value.trim().toLowerCase();const rows=new Map(data.voices.map(v=>[v.id,v]));
      for(const id of Object.keys(data.aliases||{}))if(!rows.has(id))rows.set(id,{id,name:id});
      catalog.replaceChildren(new Option(t('选择已有音色或填写 ID'),''),...[...rows.values()].filter(v=>v.id===voice.value||`${voiceLabel(v.id)} ${v.name} ${v.id}`.toLowerCase().includes(query)).map(v=>new Option(voiceLabel(v.id),v.id)));
      catalog.value=voice.value;currentVoice();}
    function support(){
      const current=language.value;
      const languages=!mini&&model.value.includes('1.0-pro')?['auto']:(data.languages||['auto']).filter(v=>!mini||!/^speech-0[12]/.test(model.value)||!['Persian','Filipino','Tamil'].includes(v));
      language.replaceChildren(...languages.map(v=>new Option(v==='auto'?t('自动'):t(v),v)));language.value=languages.includes(current)?current:'auto';
      language.disabled=!mini&&model.value.includes('1.0-pro');
      if(mini){const old=fields.emotion.value;const choices=[['','自动'],['happy','高兴'],['sad','悲伤'],['angry','生气'],['fearful','害怕'],['disgusted','厌恶'],['surprised','惊讶'],['calm','平静']];
        if(model.value.startsWith('speech-2.6-'))choices.push(['fluent','流畅'],['whisper','低语']);
        fields.emotion.replaceChildren(...choices.map(([v,n])=>new Option(t(n),v)));fields.emotion.value=choices.some(([v])=>v===old)?old:'';
      }
      updateScope();
    }
    function hasKey(){return !!key.value.trim()||!!data.regions.find(v=>v.id===region.value)?.hasApiKey;}
    function showKey(){key.placeholder=t(data.regions.find(v=>v.id===region.value)?.hasApiKey?'已持有本地密钥':'请输入 API Key');updateScope();}
    async function refresh(){if(busy)return;busy=true;setBusy();notify('正在验证连接并加载音色…');const epoch=version;try{
      const out=await request(engine+'-tts',{action:'refresh',recipe:recipe(),...connection()});
      if(epoch!==version)return;data.voices=out.voices;data.aliases=out.aliases||{};renderVoices();notify('音色列表已更新');
    }catch(e){if(epoch===version)notify(e.message);}finally{busy=false;setBusy();}}
    const refreshButton=button(actions,'refresh','刷新音色',refresh),envRefresh=button(envActions,'refresh-environment','检测连接／刷新音色',refresh);
    function setBusy(){aliasSave.disabled=busy||!voice.value.trim();refreshButton.disabled=envRefresh.disabled=busy;status.setAttribute('aria-busy',String(busy));envStatus.setAttribute('aria-busy',String(busy));refreshButton.textContent=t(busy?'正在验证…':'刷新音色');envRefresh.textContent=t(busy?'正在验证…':'检测连接／刷新音色');if(createButton)createButton.disabled=busy;updateScope();}
    let createButton=null;
    if(!mini){
      const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=t('从参考创建音色');details.append(summary);panel.append(details);
      summary.dataset.optionHelp='参考音频会上传到 Mossland 创建音色；支持 WAV、MP3、M4A、FLAC，不超过 10 MB／30 秒。只在点击创建时提交，选择音色不会自动合成。';
      const items=grid(details),name=field(items,'name','音色名称','text'),file=field(items,'reference','参考音频','file');
      file.accept='.wav,.mp3,.m4a,.flac';name.maxLength=255;
      file.onchange=()=>{creationToken=global.MSWProject.id('voice');};
      const row=document.createElement('div');row.className='msw-processing-actions';details.append(row);
      createButton=button(row,'create','上传并创建音色',async()=>{if(busy)return;const selected=file.files[0];if(!selected)return notify('请选择参考音频');
        if(selected.size>10*1024*1024)return notify('参考音频须小于 10 MB');
        busy=true;setBusy();notify('正在上传并创建音色…');const epoch=version;
        try{const audio=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error(t('读取参考失败')));reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(selected);});
          const out=await request(engine+'-tts',{action:'create-voice',recipe:recipe(),...connection(),name:name.value,audio,
            suffix:'.'+selected.name.split('.').pop().toLowerCase(),request_key:creationToken||(creationToken=global.MSWProject.id('voice'))});
          if(epoch!==version)return;data.voices=out.voices;voice.value=out.created_voice.id;renderVoices();notify('音色已创建并选中');
        }catch(e){if(epoch===version)notify(e.message);}finally{busy=false;setBusy();}
      });
    }
    region.onchange=()=>{version++;key.value=keys.get(region.value)||'';data.voices=[];data.aliases={};voice.value='';renderVoices();showKey();};
    key.oninput=()=>{version++;keys.set(region.value,key.value);data.voices=[];data.aliases={};aliasVoice=null;renderVoices();showKey();};
    model.onchange=support;language.onchange=updateScope;voice.oninput=()=>{catalog.value=voice.value;currentVoice();updateScope();};
    catalog.onchange=()=>{if(catalog.value)voice.value=catalog.value;else voiceDetails.open=true;currentVoice();updateScope();};search.oninput=renderVoices;
    function configure(value,{preserve=false}={}){const previous=preserve?recipe():null,oldKey=key.value,oldRegion=region.value;
      data={...data,...value};const r=previous||data.recipe;if(!r)return;
      model.replaceChildren(...(data.models||[]).map(v=>new Option(v,v)));model.value=r.model;
      if(mini){region.value=r.region;for(const k of ['speed','volume','pitch'])fields[k].value=String(r[k]);}
      key.value=preserve&&oldRegion===region.value?oldKey:keys.get(region.value)||'';
      timeout.value=String(preserve?timeout.value:data.timeout||180);voice.value=r.voice||'';
      support();language.value=r.language_type||'auto';if(mini)fields.emotion.value=r.emotion||'';else {fields.expected_duration_sec.value=r.expected_duration_sec==null?'':String(r.expected_duration_sec);fields.follow_subtitle_duration.checked=!!r.follow_subtitle_duration;}
      // A saved catalog must never replace an unsaved account/region's catalog.
      if(key.value||r.region!==value?.recipe?.region){data.voices=[];data.aliases={};}
      aliasVoice=null;renderVoices();showKey();
    }
    return {configure,recipe,connection,voiceLabel:(r)=>r.region&&r.region!==region.value?shortId(r.voice||''):voiceLabel(r.voice||''),ready:()=>!busy&&hasKey()&&!!voice.value.trim()&&(mini||fields.expected_duration_sec.disabled||fields.expected_duration_sec.checkValidity()),
      problem:()=>hasKey()?'':'请在环境配置填写当前服务地域的 API Key',
      saved:()=>{keys.delete(region.value);key.value='';},
      scope:(single,changed,text=false)=>{if(mini){fields.pronunciation.parentElement.hidden=!single;if(changed)fields.pronunciation.value='';}else{fields.follow_subtitle_duration.disabled=text;fields.expected_duration_sec.disabled=!text&&fields.follow_subtitle_duration.checked;}},
      pronunciation:()=>mini?fields.pronunciation.value.trim():''};
  }
  global.MSWCloudTts=Object.freeze({create});
})(window);
