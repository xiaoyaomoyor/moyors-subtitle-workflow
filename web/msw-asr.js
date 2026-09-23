(function (global) {
  'use strict';
  const host=global.MSWE.resolve('processing-host'),media=global.MSWE.resolve('media'),ranges=global.MSWE.resolve('time-range');
  if (!host||!media) return;
  const el=id=>document.getElementById(`msw-asr-${id}`),t=value=>global.MSWE_I18N?.translateText?.(value)||value;
  const available=media.available(),panel=el('panel'),settingsRoot=el('settings'),jobs=new Map(),details=new Map();
  const pageId=global.MSWProject.id('asr-page'),token=()=>`${pageId}.${host.generation}`;
  const fields=['providerId','modelId','language','region','workspaceId','openaiModel','openaiBaseUrl','maxLen','minLen',
    'device','localModelPath','fireredPunc','alignmentModel','alignmentModelPath',
    'maxWords','minWords','gapSplit','qwenAudioContext','qwenAudioHotwords','qwenAudioVocabularyId','qwenAudioHotwordWeight',
    'openaiPrompt','openaiKeywords','sonioxContextGeneral','sonioxContextText','sonioxContextTerms','sonioxContextTranslationTerms','doubaoHotwords'];
  const terminal=new Set(['succeeded','failed','cancelled','interrupted']);
  let providers=[],savedConnection={},cursor=0,timer=null,polling=false,submission=null,batchSubmission=false,busy=false,selected=null,loading=null;
  let retrying = null, retrySource = null;
  const retries = new Map();
  function message(value) {el('message').textContent=t(value);}
  function options(node,values,selectedValue='') {
    node.replaceChildren(...values.map(item=>{const option=document.createElement('option');option.value=item.id;option.textContent=t(item.label);return option;}));
    if (values.some(item=>item.id===selectedValue)) node.value=selectedValue;
  }
  const connectionFields=['region','workspaceId','openaiBaseUrl'];
  function providerReady() {
    const provider=providers.find(item=>item.id===el('providerId').value);
    return provider?.kind==='local' ? provider.models.find(item=>item.id===el('modelId').value)?.localStatus?.installed===true : Boolean(provider?.hasApiKey);
  }
  const readinessMessage=()=>providers.find(item=>item.id===el('providerId').value)?.kind==='local'
    ? '请先准备所选本地模型和运行环境，然后刷新状态' : '请先在环境配置中保存此服务的 API Key';
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
    settingsRoot.querySelectorAll('[data-asr-local]').forEach(node=>node.hidden=provider.kind!=='local');
    selectModel();
  }
  function selectEnvironment() {
    const provider=providers.find(item=>item.id===el('environment-provider').value);
    if (!provider) return;
    options(el('region'),provider.regions,savedConnection.region||'beijing');
    for (const key of connectionFields) if(key!=='region')el(key).value=savedConnection[key]||'';
    el('apiKey').value='';el('key-state').textContent=t(provider.hasApiKey?'已配置本机密钥，留空继续使用':'尚未配置此服务密钥');
    el('apiKey').closest('label').hidden=provider.kind==='local';
    if(provider.kind==='local')el('key-state').textContent=t('本地识别不需要 API Key，请在 ASR 面板准备模型');
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
    settingsRoot.querySelectorAll('[data-asr-firered]').forEach(node=>node.hidden=model.engine!=='firered');
    el('local-status').textContent=model.localStatus?.detail||'';
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
    const caps=openaiOptions(),ready=providerReady()&&caps?.timestamps!==false;
    el('scope-actions').hidden=mode!=='range';
    const clips=global.MSWE.resolve('audio-timeline')?.selectedClips()||[];
    el('source').textContent=mode==='clips'?`${t('所选音频贴片')} · ${clips.length}`:current?`${current.name} · ${t('源音轨')} ${current.audio_index+1}`:t('请先导入包含音轨的媒体');
    el('edit-range').hidden=mode!=='range';el('edit-range').disabled=!selection.length;
    let issue='',snapshot=null;
    try {global.MSWProject.ensure(host.data);snapshot=snapshots();} catch(error){issue=error.message;}
    if(mode==='clips'&&snapshot)el('source').textContent+=` · ${(snapshot.reduce((sum,item)=>sum+item.range.end-item.range.start,0)/1000).toFixed(3)} s`;
    const boundaries=mode==='range'?selection.map(range=>global.MSWAsr.boundaries(host.data,range,current?.metadata.duration_ms||0)):[];
    el('expand').hidden=!boundaries.some(boundary=>boundary.crossing.length);el('expand').disabled=boundaries.some(boundary=>!boundary.canExpand);
    el('scope').textContent=issue||(!ready?t(readinessMessage()):snapshot.map(item=>`${(item.range.start/1000).toFixed(3)}–${(item.range.end/1000).toFixed(3)} s · ${t('受影响主字幕')} ${item.targets.length}`).join('\n'));
    el('start').disabled=!available||busy||Boolean(retrying)||media.busy||(!submission&&(!snapshot||!ready));
    el('start').textContent=t(submission?'确认上次提交':'开始识别');el('forget').hidden=!submission||busy;
    el('save-settings').disabled=!available||busy||Boolean(loading)||!providers.length;
    el('save-environment').disabled=!available||busy||Boolean(loading);
    for (const input of document.querySelectorAll('#msw-asr-settings input,#msw-asr-settings select,#msw-asr-settings textarea,#msw-asr-environment-fields input,#msw-asr-environment-fields select')) input.disabled=busy||Boolean(loading);
    return snapshot;
  }
  function snapshots() {
    const mode=el('mode').value,selection=mode==='range'?ranges?.ranges:[];
    if(mode==='clips')return global.MSWAsr.clipSnapshots(host.data,global.MSWE.resolve('audio-timeline')?.selectedClips());
    return (selection?.length?selection:[null]).map(range=>global.MSWAsr.snapshot(host.data,media.current,mode,range));
  }
  async function submit() {
    if (busy) return;
    if (media.busy) {message('媒体正在导入，请等待完成后再识别');return;}
    const generation=host.generation;
    try {
      host.commitEdits();
      if (!submission) {
        if (!providerReady()) throw Error(readinessMessage());
        const provider=providerInput();
        const batchId=global.MSWProject.id('asr-batch');
        const inputs=snapshots();
        submission=inputs.map(snapshot=>({...media.payload(),client_token:token(),kind:'asr',request_key:global.MSWProject.id('asr-request'),snapshot:{...snapshot,batch_id:batchId,
          batch_overlap:snapshot.mode==='clips'&&inputs.some(other=>other!==snapshot&&other.range.start<snapshot.range.end&&snapshot.range.start<other.range.end)},provider}));
        batchSubmission=submission.length>1;
      }
      busy=true;updateScope();renderJobs();
      while (submission?.length) {
        const result=await media.request('jobs',submission[0]);
        if (generation!==host.generation) return;
        jobs.set(result.job.id,result.job);
        if (retrySource) { retries.set(retrySource, result.job.id); retrySource = null; }
        submission.shift();renderJobs();schedule(0);
      }
      submission=null;
      message('识别已开始');renderJobs();schedule(0);
    } catch(error) {
      if (generation!==host.generation) return;
      if (error.status>=400&&error.status<500&&error.status!==429&&!batchSubmission) {submission=null;retrySource=null;}
      message(`${error.message}${submission?'；再次点击将确认上次提交，不会重复创建任务':''}`);
    } finally {if(generation===host.generation){busy=false;updateScope();renderJobs();}}
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
      function button(label,action) {const node=document.createElement('button');node.type='button';node.textContent=t(label);node.addEventListener('click',action);actions.append(node);return node;}
      if (!terminal.has(job.status)) button('取消',async()=>{
        const generation=host.generation;
        try {
          await media.request(`jobs/${job.id}/cancel`,{project_id:job.project_id});
          if (generation!==host.generation) return;
          jobs.set(job.id,{...job,status:'cancel_requested'});renderJobs();schedule(0);
        }catch(error){if(generation===host.generation)message(error.message);}
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
      if (['failed','cancelled','interrupted'].includes(job.status)) {
        const retried = jobs.get(retries.get(job.id)), activeRetry = retried && !terminal.has(retried.status);
        const retryButton = button(activeRetry ? '正在重试' : '使用此范围重试',async()=>{
        if (busy || submission || retrying || activeRetry) return;
        const generation=host.generation;
        retrying=job.id;updateScope();renderJobs();
        try {
          const result=await media.request(`jobs/${job.id}/result?${new URLSearchParams({project_id:job.project_id})}`);
          if(generation!==host.generation) return;
          if (!providerReady()) throw Error(readinessMessage());
          host.commitEdits();
          let snapshot;
          if(result.job.snapshot.mode==='clips') {
            const snap=result.job.snapshot, clips=host.data.msw?.audio_clips||[], clip=clips.find(c=>c.id===snap.source.clip.id);
            if(host.data.msw?.project_id!==job.project_id||!clip||Object.keys(snap.source.clip).some(k=>clip[k]!==snap.source.clip[k])
              ||host.data.msw.assets.find(a=>a.id===snap.source.id)?.sha256!==snap.source.revision)throw Error('贴片已改变，请重新选择识别范围');
            snapshot=global.MSWAsr.clipSnapshots(host.data,[clip])[0];el('mode').value='clips';
          } else {
            if (host.data.msw?.project_id!==job.project_id||media.current?.revision!==result.job.snapshot.source.revision
              ||media.current?.audio_index!==result.job.snapshot.source.audio_index) throw Error('媒体已改变，请重新选择识别范围');
            el('mode').value=result.job.snapshot.mode;ranges.setRange(result.job.snapshot.range);
            snapshot=global.MSWAsr.snapshot(host.data,media.current,result.job.snapshot.mode,result.job.snapshot.range);
          }
          submission=[{...media.payload(),client_token:token(),kind:'asr',request_key:global.MSWProject.id('asr-request'),snapshot,provider:providerInput()}];
          batchSubmission=false;retrySource=job.id;el('history').open=true;await submit();
        }catch(error){if(generation===host.generation)message(error.message);}
        finally{if(generation===host.generation){retrying=null;updateScope();renderJobs();}}
        });
        retryButton.disabled=busy||Boolean(submission)||Boolean(retrying)||Boolean(activeRetry);
      }
      fragment.append(card);
    }
    el('jobs').replaceChildren(fragment);el('count').textContent=String(jobs.size);refreshFooter();
  }
  function resultStatus(job) {
    const rows=job.result?.segments||[],conflict=global.MSWAsr.conflict(host.data,media.current,job.snapshot);
    const applied=host.data.msw?.applied_results?.includes(job.id);
    let text=applied?t('此结果已应用'):conflict||t(rows.length?'候选字幕':'没有识别到语音；保留现有字幕');
    if(stored(job))text+=' · '+t('已存入素材库');
    if(rows.length&&!applied&&!conflict)text+=' '+rows.length+' · '+t('替换主字幕')+' '+job.snapshot.targets.length+' → '+rows.length;
    if(rows.length>300)text+=' · '+t('仅预览前 300 条，入库保留全部');
    if(job.result?.warnings?.length)text+=' · '+job.result.warnings.join('；');
    return text;
  }
  function refreshFooter() {
    const rows=selected?.result?.segments||[];
    el('apply').disabled=!selected||!rows.length||!host.applyASR||Boolean(global.MSWAsr.conflict(host.data,media.current,selected.snapshot))||host.data.msw?.applied_results?.includes(selected.id)||overlappingBatch(selected);
    el('apply').title=selected&&overlappingBatch(selected)?t('同批识别范围重叠，请先存入素材库'):'';
    el('store').disabled=!selected||!batchResults(selected).some(j=>j.result?.segments?.length&&!stored(j));
    el('selected').textContent=selected?t('当前结果')+' · '+selected.result.model+' · '+(selected.snapshot.range.start/1000).toFixed(3)+'–'+(selected.snapshot.range.end/1000).toFixed(3)+' s':'';
    const status=el('result-status');if(status&&selected)status.textContent=resultStatus(selected);
  }
  const stored=job=>(host.data.msw?.asset_batches||[]).some(b=>b.result_ids?.includes(job.id));
  const batchId=job=>job.snapshot?.batch_id||job.batch_id||job.id;
  const batchResults=job=>[...details.values()].filter(j=>batchId(j)===batchId(job)&&j.project_id===host.data.msw?.project_id&&j.status==='succeeded');
  function overlappingBatch(job) {
      if(job.snapshot?.mode!=='clips')return false;
      if(job.snapshot.batch_overlap)return true;
    const range=job.snapshot.range;
    return [...jobs.values()].some(j=>j.id!==job.id&&batchId(j)===batchId(job)&&j.source_range
      &&j.source_range.start<range.end&&range.start<j.source_range.end);
  }
  function storeBatch() {
    try {
      if(!selected)return;
      host.commitEdits();
      const result=global.MSWAssets.asrResults(host.data.msw,batchResults(selected));
      if(!result.count)return;
      host.commitSubtitleAssets('ASR 结果存入素材库',ext=>Object.assign(ext,result.extension));
      host.showAssets({automatic:true});global.MSWE.resolve('asset-library')?.showBatch(batchId(selected));
      message(`${t('已存入素材库')} ${result.count} ${t('条字幕')} · ${t('本批完成结果已入库')}`);renderJobs();
    }catch(error){message(error.message);}
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
  async function apply(job) {
    if (!host.applyASR) return;
    const generation=host.generation;
    try {
      if(overlappingBatch(job))throw Error('同批识别范围重叠，请先存入素材库');
      await media.request('asr-validate',{...media.payload(),job_id:job.id});
      if (generation!==host.generation) return;
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
    if (panel.classList.contains('show')&&!selected) preview(result.job,false);
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
  let localTimer=null;
  async function pollLocal() {
    clearTimeout(localTimer);
    try {
      const result=await media.request('asr-local-models');
      el('local-progress').textContent=result.message||'';
      if(result.status==='running')localTimer=setTimeout(()=>void pollLocal(),1000);
      else await refreshLocal();
    } catch(error) {el('local-progress').textContent=error.message;}
  }
  async function refreshLocal() {
    await media.request('asr-settings',{section:'call',provider:providerInput()});
    await loadSettings();
  }
  el('local-refresh').onclick=()=>void refreshLocal().catch(error=>message(error.message));
  settingsRoot.querySelectorAll('[data-asr-prepare]').forEach(button=>button.onclick=async()=>{
    try {
      const action=button.dataset.asrPrepare;
      const modelId=action==='aligner'?el('alignmentModel').value:el('modelId').value;
      if(action==='aligner'&&!modelId)throw Error('请先选择对齐模型');
      const result=await media.request('asr-local-models',{action,modelId});
      el('local-progress').textContent=result.message||'';void pollLocal();
    }catch(error){el('local-progress').textContent=error.message;}
  });
  settingsRoot.addEventListener('input',updateScope);
  el('providerId').addEventListener('change',()=>selectProvider());el('modelId').addEventListener('change',selectModel);
  el('mode').addEventListener('change',updateScope);el('edit-range').addEventListener('click',()=>ranges.openEditor());
  el('expand').addEventListener('click',()=>{
    const reports=ranges.ranges.map(range=>global.MSWAsr.boundaries(host.data,range,media.current?.metadata.duration_ms||0));
    if(reports.every(report=>report.canExpand))ranges.setRange(reports.map(report=>report.expanded));
  });
  el('start').addEventListener('click',()=>void submit());el('forget').addEventListener('click',()=>{submission=null;retrySource=null;updateScope();renderJobs();message('已放弃未确认提交；此前请求若已到达服务，仍会显示在任务列表');});
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
  el('store').addEventListener('click',storeBatch);
  for (const event of ['msw:range-changed','msw:media-changed','msw:media-ready','msw:subtitles-changed','msw:audio-selection','msw:audio-changed']) global.addEventListener(event,()=>{if(panel.classList.contains('show'))updateScope();});
  global.addEventListener('msw:project-changed',()=>{cursor=0;jobs.clear();details.clear();retries.clear();retrying=null;retrySource=null;busy=false;selected=null;submission=null;renderJobs();updateScope();if(available)schedule(0);});
  global.MSWE.register('asr',()=>({open,submit,showResult,get jobs(){return [...jobs.values()];}}));
  refreshFooter();
  if (available) {void loadSettings();schedule(0);}
})(window);
