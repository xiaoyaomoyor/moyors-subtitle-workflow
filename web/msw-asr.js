(function (global) {
  'use strict';
  const host=global.MSWE.resolve('processing-host'),media=global.MSWE.resolve('media'),ranges=global.MSWE.resolve('time-range');
  if (!host||!media) return;
  const el=id=>document.getElementById(`msw-asr-${id}`),t=value=>global.MSWE_I18N?.translateText?.(value)||value;
  const available=media.available(),panel=el('panel'),settingsRoot=el('settings'),jobs=new Map(),details=new Map();
  const pageId=global.MSWProject.id('asr-page'),token=()=>`${pageId}.${host.generation}`;
  const fields=['providerId','modelId','language','region','workspaceId','openaiModel','openaiBaseUrl','maxLen','minLen',
    'maxWords','minWords','gapSplit','qwenAudioContext','qwenAudioHotwords','qwenAudioVocabularyId','qwenAudioHotwordWeight',
    'openaiPrompt','openaiKeywords','sonioxContextGeneral','sonioxContextText','sonioxContextTerms','sonioxContextTranslationTerms','doubaoHotwords'];
  const terminal=new Set(['succeeded','failed','cancelled','interrupted']);
  let providers=[],savedConnection={},cursor=0,timer=null,polling=false,submission=null,batchSubmission=false,busy=false,selected=null,loading=null;
  function message(value) {el('message').textContent=t(value);}
  function options(node,values,selectedValue='') {
    node.replaceChildren(...values.map(item=>{const option=document.createElement('option');option.value=item.id;option.textContent=t(item.label);return option;}));
    if (values.some(item=>item.id===selectedValue)) node.value=selectedValue;
  }
  const connectionFields=['region','workspaceId','openaiBaseUrl'];
  function providerInput() {
    const caps=openaiOptions(),diarize=Boolean(caps?.diarize||(caps?.customDiarize&&el('openaiDiarize').checked));
    return {...Object.fromEntries(fields.map(key=>[key,connectionFields.includes(key)?savedConnection[key]:el(key).value])),
      speakerColors:el('speakerColors').checked,openaiDiarize:diarize,apiKey:'',
      openaiPrompt:caps?.prompt&&!diarize?el('openaiPrompt').value:'',
      openaiKeywords:caps?.keywords&&!diarize?el('openaiKeywords').value:''};
  }
  function selectProvider(modelId=null) {
    const provider=providers.find(item=>item.id===el('providerId').value);
    if (!provider) return;
    options(el('modelId'),provider.models,modelId||provider.models[0].id);
    for (const kind of ['qwen','soniox','openai','doubao']) settingsRoot.querySelectorAll(`[data-asr-${kind}]`).forEach(node=>node.hidden=provider.id!==kind);
    selectModel();
  }
  function selectEnvironment() {
    const provider=providers.find(item=>item.id===el('environment-provider').value);
    if (!provider) return;
    options(el('region'),provider.regions,savedConnection.region||'beijing');
    for (const key of connectionFields) if(key!=='region')el(key).value=savedConnection[key]||'';
    el('apiKey').value='';el('key-state').textContent=t(provider.hasApiKey?'已配置本机密钥，留空继续使用':'尚未配置此服务密钥');
    for(const kind of ['qwen','openai'])el('environment-fields').querySelectorAll('[data-asr-'+kind+']').forEach(node=>node.hidden=provider.id!==kind);
  }
  function openaiOptions() {
    const provider=providers.find(item=>item.id===el('providerId').value);
    if(provider?.id!=='openai')return null;
    let name=el('modelId').value==='custom-asr'?el('openaiModel').value.trim():el('modelId').value;
    let hostname='';try{hostname=new URL(savedConnection.openaiBaseUrl).hostname.toLowerCase().replace(/\.$/,'');}catch{}
    const family=hostname==='api.openai.com'?'openai':['openrouter.ai','www.openrouter.ai'].includes(hostname)?'openrouter':'compatible';
    const model=provider.models.find(m=>m.id===name.replace(/^openai\//,''))||provider.models.find(m=>m.id==='custom-asr');
    const caps=model.openaiCapabilities[family],diarize=caps.diarize||el('openaiDiarize').checked;
    el('openaiHint').textContent=t(caps.timestamps?'接口必须返回可靠时间戳；Keywords 每行一个':'此模型在当前接口没有可靠字幕时间戳，请更换模型');
    el('openaiPrompt').closest('label').hidden=!caps.prompt||diarize;
    el('openaiKeywords').closest('label').hidden=!caps.keywords||diarize;
    el('openaiDiarize').closest('label').hidden=!caps.diarize&&!caps.customDiarize;
    return caps;
  }
  function selectModel() {
    const provider=providers.find(item=>item.id===el('providerId').value),model=provider?.models.find(item=>item.id===el('modelId').value);
    if (!model) return;
    options(el('languages'),model.languages);
    el('openaiModel').closest('label').hidden=provider.id!=='openai'||model.id!=='custom-asr';
    for (const [kind,key] of [['context','supportsContext'],['hotwords','supportsHotwords'],['vocabulary','supportsVocabulary'],['speaker','supportsSpeaker']])
      settingsRoot.querySelectorAll(`[data-asr-${kind}]`).forEach(node=>node.hidden=!model[key]||(['context','hotwords'].includes(kind)&&provider.id!=='qwen'));
    el('openaiDiarize').checked=provider.id==='openai'&&model.id==='gpt-4o-transcribe-diarize';
    if(el('openaiDiarize').checked){el('openaiPrompt').value='';el('openaiKeywords').value='';}
    updateScope();
  }
  async function loadSettings() {
    if (loading) return loading;
    loading=(async()=>{
      const config=await media.request('asr-settings');providers=config.providers;
      savedConnection=Object.fromEntries(connectionFields.map(key=>[key,config.options[key]||'']));
      options(el('environment-provider'),providers,config.options.providerId);selectEnvironment();
      options(el('providerId'),providers,config.options.providerId);selectProvider(config.options.modelId);
      for (const key of fields) if (!['providerId','modelId'].includes(key)&&config.options[key]!==undefined) el(key).value=config.options[key];
      el('speakerColors').checked=config.options.speakerColors===true;selectModel();el('openaiDiarize').checked=config.options.openaiDiarize===true||el('modelId').value==='gpt-4o-transcribe-diarize';
    })();
    try {await loading;} catch(error){message(error.message);} finally {loading=null;updateScope();}
  }
  function updateScope() {
    const current=media.current,mode=el('mode').value,selection=ranges?.ranges||[];
    const provider=providers.find(item=>item.id===el('providerId').value);
    const caps=openaiOptions(),ready=Boolean(provider?.hasApiKey)&&caps?.timestamps!==false;
    el('scope-actions').hidden=mode!=='range';
    el('source').textContent=current?`${current.name} · ${t('源音轨')} ${current.audio_index+1}`:t('请先导入包含音轨的媒体');
    el('edit-range').hidden=mode!=='range';el('edit-range').disabled=!selection.length;
    let issue='',snapshot=null;
    try {global.MSWProject.ensure(host.data);snapshot=snapshots();} catch(error){issue=error.message;}
    const boundaries=mode==='range'?selection.map(range=>global.MSWAsr.boundaries(host.data,range,current?.metadata.duration_ms||0)):[];
    el('expand').hidden=!boundaries.some(boundary=>boundary.crossing.length);el('expand').disabled=boundaries.some(boundary=>!boundary.canExpand);
    el('scope').textContent=issue||(!ready?t('请先在环境配置中保存此服务的 API Key'):snapshot.map(item=>`${(item.range.start/1000).toFixed(3)}–${(item.range.end/1000).toFixed(3)} s · ${t('受影响主字幕')} ${item.targets.length}`).join('\n'));
    el('start').disabled=!available||busy||media.busy||(!submission&&(!snapshot||!ready));
    el('start').textContent=t(submission?'确认上次提交':'开始识别');el('forget').hidden=!submission||busy;
    el('save-settings').disabled=!available||busy||Boolean(loading)||!providers.length;
    el('save-environment').disabled=!available||busy||Boolean(loading);
    for (const input of document.querySelectorAll('#msw-asr-settings input,#msw-asr-settings select,#msw-asr-settings textarea,#msw-asr-environment-fields input,#msw-asr-environment-fields select')) input.disabled=busy||Boolean(loading);
    return snapshot;
  }
  function snapshots() {
    const mode=el('mode').value,selection=mode==='range'?ranges?.ranges:[];
    return (selection?.length?selection:[null]).map(range=>global.MSWAsr.snapshot(host.data,media.current,mode,range));
  }
  async function submit() {
    if (busy) return;
    if (media.busy) {message('媒体正在导入，请等待完成后再识别');return;}
    try {
      host.commitEdits();
      if (!submission) {
        if (!providers.find(item=>item.id===el('providerId').value)?.hasApiKey) throw Error('请先在环境配置中保存此服务的 API Key');
        const provider=providerInput();
        submission=snapshots().map(snapshot=>({...media.payload(),client_token:token(),kind:'asr',request_key:global.MSWProject.id('asr-request'),snapshot,provider}));
        batchSubmission=submission.length>1;
      }
      busy=true;updateScope();
      const generation=host.generation;
      while (submission?.length) {
        const result=await media.request('jobs',submission[0]);
        if (generation!==host.generation) return;
        jobs.set(result.job.id,result.job);submission.shift();renderJobs();schedule(0);
      }
      submission=null;
      message('识别已开始');renderJobs();schedule(0);
    } catch(error) {
      if (error.status>=400&&error.status<500&&error.status!==429&&!batchSubmission) submission=null;
      message(`${error.message}${submission?'；再次点击将确认上次提交，不会重复创建任务':''}`);
    } finally {busy=false;updateScope();}
  }
  function renderJobs() {
    const opened=new Set([...el('jobs').querySelectorAll('details[open]')].map(node=>node.dataset.resultId));
    const fragment=document.createDocumentFragment();
    const labels={queued:'等待识别',running:'正在识别',cancel_requested:'正在取消',succeeded:'识别完成',failed:'识别失败',cancelled:'已取消',interrupted:'服务中断'};
    for (const job of [...jobs.values()].sort((a,b)=>b.created_at-a.created_at).slice(0,30)) {
      const card=document.createElement('div');card.className='msw-processing-job';card.dataset.asrJob=job.id;
      const line=document.createElement('p');line.textContent=`${job.model} · ${t(labels[job.status]||job.status)}${job.error?` · ${job.error}`:''}`;
      const range=job.source_range||details.get(job.id)?.snapshot?.range;
      if (range) line.textContent+=` · ${(range.start/1000).toFixed(3)}–${(range.end/1000).toFixed(3)} s`;
      const status=document.createElement('small');status.textContent=t(job.progress?.message||'');
      const actions=document.createElement('div');actions.className='msw-processing-actions';card.append(line,status,actions);
      function button(label,action) {const node=document.createElement('button');node.type='button';node.textContent=t(label);node.addEventListener('click',action);actions.append(node);}
      if (!terminal.has(job.status)) button('取消',async()=>{
        try {await media.request(`jobs/${job.id}/cancel`,{project_id:job.project_id});schedule(0);}catch(error){message(error.message);}
      });
      if (job.status==='succeeded') {
        const choose=document.createElement('label');choose.className='msw-asr-result-choice';
        const radio=document.createElement('input');radio.type='radio';radio.name='msw-asr-result';radio.checked=selected?.id===job.id;
        radio.addEventListener('change',()=>void showResult(job.id));choose.append(radio,t('选择结果'));actions.append(choose);
        const result=details.get(job.id),view=document.createElement('details');view.dataset.resultId=job.id;view.className='msw-asr-result-preview';
        const summary=document.createElement('summary');summary.textContent=t('预览结果');view.append(summary);
        if (result) {
          const status=document.createElement('p');status.className='msw-processing-hint';status.textContent=resultStatus(result);
          const candidates=document.createElement('div');candidates.className='msw-asr-candidates';
          for(const cue of (result.result?.segments||[]).slice(0,300)) {
            const line=document.createElement('p');line.textContent=[(cue.start/1000).toFixed(3),(cue.end/1000).toFixed(3)].join('–')+'  '+cue.text;candidates.append(line);
          }
          if(selected?.id===job.id){view.id='msw-asr-preview';status.id='msw-asr-result-status';candidates.id='msw-asr-candidates';card.classList.add('is-selected');}
          view.append(status,candidates);
        }
        view.open=opened.has(job.id);
        view.addEventListener('toggle',()=>{if(view.isConnected&&view.open&&!details.has(job.id))void showResult(job.id);});
        card.append(view);
      }
      if (['failed','cancelled','interrupted'].includes(job.status)) button('使用此范围重试',async()=>{
        try {
          const result=await media.request(`jobs/${job.id}/result?${new URLSearchParams({project_id:job.project_id})}`);
          if (host.data.msw?.project_id!==job.project_id||media.current?.revision!==result.job.snapshot.source.revision) throw Error('媒体已改变，请重新选择识别范围');
          el('mode').value=result.job.snapshot.mode;ranges.setRange(result.job.snapshot.range);updateScope();message('范围已恢复；检查当前配置后点击开始识别');
        }catch(error){message(error.message);}
      });
      fragment.append(card);
    }
    el('jobs').replaceChildren(fragment);el('count').textContent=String(jobs.size);refreshFooter();
  }
  function resultStatus(job) {
    const rows=job.result?.segments||[],conflict=global.MSWAsr.conflict(host.data,media.current,job.snapshot);
    const applied=host.data.msw?.applied_results?.includes(job.id);
    let text=conflict||t(applied?'此结果已应用':rows.length?'候选字幕':'没有识别到语音；保留现有字幕');
    if(rows.length&&!applied&&!conflict)text+=' '+rows.length+' · '+t('替换主字幕')+' '+job.snapshot.targets.length+' → '+rows.length;
    if(rows.length>300)text+=' · '+t('仅预览前 300 条，可导出全部');
    if(job.result?.warnings?.length)text+=' · '+job.result.warnings.join('；');
    return text;
  }
  function refreshFooter() {
    const rows=selected?.result?.segments||[];
    el('apply').disabled=!selected||!rows.length||!host.applyASR||Boolean(global.MSWAsr.conflict(host.data,media.current,selected.snapshot))||host.data.msw?.applied_results?.includes(selected.id);
    for(const key of ['discard','export-json','export-srt'])el(key).disabled=!selected?.result;
    el('selected').textContent=selected?t('当前结果')+' · '+selected.result.model+' · '+(selected.snapshot.range.start/1000).toFixed(3)+'–'+(selected.snapshot.range.end/1000).toFixed(3)+' s':'';
    const status=el('result-status');if(status&&selected)status.textContent=resultStatus(selected);
  }
  function preview(job,reveal=true) {
    selected=job;details.set(job.id,job);renderJobs();
    if(reveal){el('history').open=true;if(el('preview'))el('preview').open=true;}
  }
  async function showResult(id) {
    const projectId=host.data.msw?.project_id,generation=host.generation;
    try {
      const result=await media.request(`jobs/${id}/result?${new URLSearchParams({project_id:projectId})}`);
      if (generation!==host.generation) return;
      details.set(id,result.job);preview(result.job);
    }catch(error){message(error.message);}
  }
  async function apply(job,automatic=false) {
    if (!host.applyASR) return;
    const generation=host.generation;
    try {
      await media.request('asr-validate',{...media.payload(),job_id:job.id});
      if (generation!==host.generation) return;
      if (automatic&&(job.client_token!==token()||host.data.segments.length||host.isEditing())) return;
      const result=host.applyASR(job,media.current);
      if (!result.applied) {preview(job);return;}
      await media.request(`jobs/${job.id}/ack`,{project_id:job.project_id,application:'applied'});
      if (generation!==host.generation) return;
      preview(job);message('ASR 结果已应用，可一次撤销');
    }catch(error){message(error.message);}
  }
  async function handleReady(job) {
    if (details.has(job.id)) return;
    const result=await media.request(`jobs/${job.id}/result?${new URLSearchParams({project_id:job.project_id})}`);
    if (host.data.msw?.project_id!==job.project_id) return;
    details.set(job.id,result.job);
    if (job.client_token===token()&&job.application==='pending'&&!host.data.segments.length
      &&!result.job.snapshot.targets.length&&!host.isEditing()&&result.job.result?.segments?.length) await apply(result.job,true);
    else if (panel.classList.contains('show')&&!selected) preview(result.job,false);
  }
  function schedule(delay=1000) {clearTimeout(timer);timer=setTimeout(()=>void poll(),delay);}
  async function poll() {
    if (polling||!available) return;
    polling=true;const generation=host.generation,id=global.MSWProject.ensure(host.data).project_id;
    try {
      const result=await media.request(`jobs?${new URLSearchParams({project_id:id,since:cursor})}`);
      if (generation!==host.generation) return;
      cursor=result.revision;
      for (const job of result.jobs) if (job.kind==='asr') {
        jobs.set(job.id,job);
      }
      for (const job of jobs.values()) if (job.status==='succeeded'&&!details.has(job.id)) await handleReady(job);
      if (result.jobs.some(job=>job.kind==='asr')) renderJobs();
      if (selected&&panel.classList.contains('show')) refreshFooter();
    }catch(error){if(panel.classList.contains('show'))message(error.message);}
    finally {polling=false;schedule([...jobs.values()].some(job=>!terminal.has(job.status))?750:2500);}
  }
  function download(kind) {
    if (!selected?.result) return;
    const project={schema:'moy.asr.project.v1',media:selected.snapshot.source.reference,segments:selected.result.segments,
      language:selected.result.language,model:selected.result.model};
    const stamp=ms=>`${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`;
    const content=kind==='mosp'?JSON.stringify(project,null,2):project.segments.map((cue,index)=>`${index+1}\n${stamp(cue.start)} --> ${stamp(cue.end)}\n${cue.text}\n`).join('\n');
    const url=URL.createObjectURL(new Blob([content],{type:kind==='mosp'?'application/json':'text/plain;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download=`${selected.snapshot.source.name.replace(/\.[^.]+$/,'').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_')}.asr-candidates.${kind}`;
    link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  const floating=host.createFloatingPanel({panel,dragHandle:el('drag'),anchorButton:document.querySelector('[data-menubar-item="media"] > button'),positionKey:'msw.asr.panel.position'});
  async function open(mode='whole') {
    host.commitEdits();el('mode').value=mode;floating.open();updateScope();
    if (available) {if (!media.current) await media.refresh();if (!providers.length) await loadSettings();updateScope();schedule(0);}
  }
  el('open').addEventListener('click',()=>void open());el('close').addEventListener('click',()=>floating.close());
  el('unavailable').hidden=available;el('controls').hidden=!available;
  el('environment-unavailable').hidden=available;el('environment-controls').hidden=!available;
  el('environment-return').addEventListener('click',()=>{host.closeProcessingEnvironment();void open(el('mode').value);});
  el('openaiDiarize').addEventListener('change',()=>{if(el('openaiDiarize').checked){el('openaiPrompt').value='';el('openaiKeywords').value='';}updateScope();});
  el('environment-provider').addEventListener('change',selectEnvironment);
  settingsRoot.addEventListener('input',updateScope);
  el('providerId').addEventListener('change',()=>selectProvider());el('modelId').addEventListener('change',selectModel);
  el('mode').addEventListener('change',updateScope);el('edit-range').addEventListener('click',()=>ranges.openEditor());
  el('expand').addEventListener('click',()=>{
    const reports=ranges.ranges.map(range=>global.MSWAsr.boundaries(host.data,range,media.current?.metadata.duration_ms||0));
    if(reports.every(report=>report.canExpand))ranges.setRange(reports.map(report=>report.expanded));
  });
  el('start').addEventListener('click',()=>void submit());el('forget').addEventListener('click',()=>{submission=null;updateScope();message('已放弃未确认提交；此前请求若已到达服务，仍会显示在任务列表');});
  el('save-settings').addEventListener('click',async()=>{
    if (busy||!available) return;
    busy=true;updateScope();
    try {await media.request('asr-settings',{section:'call',provider:providerInput()});message('识别设置已保存');}
    catch(error){message(error.message);}finally{busy=false;updateScope();}
  });
  el('save-environment').addEventListener('click',async()=>{
    if (busy||!available) return;
    busy=true;updateScope();
    try {
      const config=await media.request('asr-settings',{section:'environment',provider:{providerId:el('environment-provider').value,
        ...Object.fromEntries(connectionFields.map(key=>[key,el(key).value])),apiKey:el('apiKey').value}});
      providers=config.providers;savedConnection=Object.fromEntries(connectionFields.map(key=>[key,config.options[key]||'']));
      selectEnvironment();el('environment-message').textContent=t('ASR 环境配置已保存');
    }catch(error){el('environment-message').textContent=error.message;}finally{busy=false;updateScope();}
  });
  el('apply').addEventListener('click',()=>{if(selected)void apply(selected);});
  el('discard').addEventListener('click',async()=>{
    if(!selected)return;
    const job=selected,generation=host.generation;
    try {await media.request(`jobs/${job.id}/ack`,{project_id:job.project_id,application:'discarded'});
      if(generation===host.generation){if(el('preview'))el('preview').open=false;selected=null;renderJobs();message('候选结果已搁置，仍可在任务列表预览或导出');schedule(0);}
    }catch(error){message(error.message);}
  });
  el('export-json').addEventListener('click',()=>download('mosp'));el('export-srt').addEventListener('click',()=>download('srt'));
  for (const event of ['msw:range-changed','msw:media-changed','msw:media-ready','msw:subtitles-changed']) global.addEventListener(event,()=>{if(panel.classList.contains('show'))updateScope();});
  global.addEventListener('msw:project-changed',()=>{cursor=0;jobs.clear();details.clear();selected=null;submission=null;renderJobs();updateScope();if(available)schedule(0);});
  global.MSWE.register('asr',()=>({open,submit,showResult,get jobs(){return [...jobs.values()];}}));
  refreshFooter();
  if (available) {void loadSettings();schedule(0);}
})(window);
