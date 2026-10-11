// Processing and presentation for the independent v4 workspace.
(function(global){
  'use strict';
  const copy=v=>structuredClone(v),$=id=>document.getElementById(id),id=p=>MSWProject.id(p);
  const node=(tag,cls='',text='')=>{const n=document.createElement(tag);n.className=cls;n.textContent=text;return n;};
  const btn=(label,fn)=>{const n=node('button','',label);n.type='button';n.onclick=fn;return n;};
  const field=(label,input)=>{const n=node('label','flat-processing-field');input.setAttribute('aria-label',label);n.append(node('span','',label),input);return n;};
  function setup(editor){
    const config=global.MSWFlatServerConfig,core=MSWFlatProcessing,S=MSWProjectStyle,client=id('flat-page');
    let media=null,audition=false,settingsTicket=0,settingsReady=false,epoch=0,jobTimer,jobBusy=false,submitting=false,pending=null,asrConfig,translationConfig,ttsConfig;
    let presets=S.presets(),presetError='',jobs=new Map(),details=new Map(),assetURLs=new Map(),transport;
    const context=()=>({project_id:editor.data.msw.project_id,client_token:client,binding:config?.processingContext?.binding});
    async function request(route,body){
      if(!config?.processingUrl)throw Error('此操作需要本机编辑器服务；请从启动器打开工程');
      const response=await fetch(`${config.processingUrl}/${route}`,{method:body?'POST':'GET',cache:'no-store',headers:{'X-MSW-Token':config.requestToken,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
      const result=await response.json().catch(()=>({}));if(!response.ok||!result.ok){const e=Error(result.error||`本机服务请求失败 (${response.status})`);e.status=response.status;throw e;}return result;
    }
    const attempt=fn=>async()=>{try{await fn();}catch(error){editor.report(error.message,true);status.textContent=error.message;status.classList.add('error');}};
    function dialog(title){const d=node('dialog','flat-processing-panel');const header=node('header');header.append(node('strong','',title),btn('关闭',()=>d.close()));d.append(header);document.body.append(d);return d;}
    const panel=dialog('字幕处理'),controls=node('div','flat-processing-grid'),results=node('div','flat-processing-results');
    panel.id='flat-processing-panel';const kind=document.createElement('select');kind.id='flat-processing-kind';for(const [v,label] of [['asr','语音识别'],['translation','翻译字幕'],['tts','字幕配音']])kind.add(new Option(label,v));
    const target=document.createElement('select');target.id='flat-processing-target';const provider=document.createElement('select');provider.id='flat-processing-provider';
    const model=document.createElement('select');model.id='flat-processing-model';const language=document.createElement('select');language.id='flat-processing-language';language.add(new Option('中文','zh'));language.add(new Option('英文','en'));
    const voice=document.createElement('input');voice.id='flat-processing-voice';const range=document.createElement('select');range.id='flat-asr-range';range.add(new Option('整个媒体','whole'));range.add(new Option('指定时间范围','range'));
    const start=document.createElement('input'),end=document.createElement('input');for(const n of [start,end]){n.type='number';n.min='0';n.step='.001';}start.value='0';
    const scope=node('p','flat-note'),status=node('p','flat-processing-status');status.role='status';
    const targetField=field('目标轨道',target),modelField=field('模型',model),langField=field('译文语言',language),voiceField=field('音色 ID',voice),rangeField=field('识别范围',range),startField=field('开始（秒）',start),endField=field('结束（秒）',end);
    controls.append(field('处理类型',kind),targetField,field('服务',provider),modelField,langField,voiceField,rangeField,startField,endField);
    const submit=btn('开始处理',attempt(submitJob));submit.id='flat-processing-start';const actions=node('div','flat-actions');actions.append(submit,btn('刷新配置',attempt(loadSettings)),btn('导入媒体',attempt(chooseMedia)));
    const hint=node('span');MSWHelp.attach(hint,'识别替换目标轨道在所选范围内的字幕；已对应的字幕请使用新轨道。翻译只处理选中字幕，写入指定轨道并保留对应关系。配音读取选中字幕的原文。结果完成后检查并手动应用，可一次撤销。服务调用使用本机已保存配置；关闭面板不会取消任务。');actions.append(hint);
    panel.append(controls,scope,actions,status,results);
    function trackOptions(){const old=target.value;target.replaceChildren(new Option('新建轨道',''),...editor.data.subtitles.tracks.filter(t=>t.enabled&&!t.locked).map(t=>new Option(t.name,t.id)));if([...target.options].some(o=>o.value===old))target.value=old;}
    function scopeText(){scope.textContent=kind.value==='asr'?`媒体：${media?.name||'尚未导入'}${media?' · 音轨 '+(media.audio_index+1):''}`:`已选择 ${editor.selection.length} 条字幕`;}
    function updateFields(){const k=kind.value;targetField.hidden=k==='tts';modelField.hidden=k!=='asr';langField.hidden=k!=='translation';voiceField.hidden=k!=='tts';rangeField.hidden=k!=='asr';startField.hidden=endField.hidden=k!=='asr'||range.value!=='range';scopeText();}
    function ttsRecipe(){const engine=provider.value,key={qwen:null,yukkuri:'yukkuri',indextts:'index_tts','gpt-sovits':'gpt_sovits',edge:'edge_tts',minimax:'minimax',mossland:'mossland'}[engine];return copy((key?ttsConfig?.[key]:ttsConfig)?.recipe||{});}
    function providerChanged(){model.replaceChildren();if(kind.value==='asr'){for(const m of asrConfig?.providers.find(p=>p.id===provider.value)?.models||[])model.add(new Option(m.label,m.id));if([...model.options].some(o=>o.value===asrConfig.options.modelId))model.value=asrConfig.options.modelId;}
      if(kind.value==='tts'){const recipe=ttsRecipe();voice.value=recipe.voice||recipe.voice_id||'';voiceField.hidden=!('voice' in recipe||'voice_id' in recipe);}
    }
    function fillServices(){provider.replaceChildren();if(kind.value==='asr'){for(const p of asrConfig?.providers||[])provider.add(new Option(p.label,p.id));provider.value=asrConfig?.options.providerId||provider.value;}
      else if(kind.value==='translation'){for(const p of translationConfig?.providers||[])provider.add(new Option(p.label,p.id));provider.value=translationConfig?.selectedProvider||provider.value;}
      else {for(const p of ttsConfig?.engines||[])provider.add(new Option(p.label,p.id));provider.value=ttsConfig?.engine||provider.value;}updateFields();providerChanged();}
    async function loadSettings(){const serial=epoch,ticket=++settingsTicket;settingsReady=false;submit.disabled=true;status.textContent='正在读取本机配置…';const route={asr:'asr-settings',translation:'providers',tts:'tts-settings'}[kind.value],k=kind.value;
      const value=await request(route);if(serial!==epoch||kind.value!==k||ticket!==settingsTicket)return;settingsReady=true;submit.disabled=submitting;if(k==='asr')asrConfig=value;else if(k==='translation')translationConfig=value;else ttsConfig=value;fillServices();status.textContent='使用本机已保存配置。任务完成后可在下方检查结果。';status.classList.remove('error');}
    kind.onchange=attempt(loadSettings);provider.onchange=providerChanged;range.onchange=updateFields;
    function newTarget(p){const track={id:id('track'),name:kind.value==='asr'?'识别字幕':language.value==='zh'?'中文译文':'英文译文',purpose:kind.value==='asr'?'source':'translation',layout:'auto',enabled:true,locked:false,collapsed:false,style:{mode:'inherit',slot:kind.value==='asr'?'main':'secondary',base:'dialogue'}};return {project:MSWFlatSubtitles.addTrack(p,track),track};}
    async function submitJob(){if(submitting)return;if(!settingsReady)throw Error('请等待本机配置加载完成，或点击刷新配置重试');editor.flush();const serial=epoch,k=kind.value;
      if(pending&&pending.kind!==k)throw Error('上次提交尚未确认，请切回相同处理类型重试，避免重复调用');
      if(!pending){let p=editor.snapshot(),dest=target.value,created;if(k!=='tts'&&!dest){created=newTarget(p);p=created.project;dest=created.track.id;}
        let snapshot,options;if(k==='asr'){snapshot=core.asr(p,media,dest,range.value==='range'?{start:Math.round(Number(start.value)*1000),end:Math.round(Number(end.value)*1000)}:null);options={...asrConfig.options,providerId:provider.value,modelId:model.value};}
        else if(k==='translation'){snapshot=core.translation(p,editor.selection,dest);options={providerId:provider.value};}
        else {snapshot=core.tts(p,editor.selection,id);const recipe=ttsRecipe();if('voice' in recipe)recipe.voice=voice.value.trim();else if('voice_id' in recipe)recipe.voice_id=voice.value.trim();options={recipe};}
        if(created){editor.apply('新建处理目标轨道',()=>p);trackOptions();target.value=dest;}
        pending={...context(),kind:k,request_key:id('request'),snapshot,provider:options,language:language.value};
      }
      submitting=true;submit.disabled=true;status.textContent='正在提交…';
      try{const response=await request('jobs',pending);pending=null;if(serial!==epoch)return;jobs.set(response.job.id,response.job);renderJobs();status.textContent='已开始处理；可关闭面板继续编辑。';schedulePoll(0);}
      catch(error){if(error.status&&error.status<500)pending=null;throw Error(error.message+(pending?'；再次开始将核对上次提交，不会重复创建任务。':''));}
      finally{submitting=false;submit.disabled=false;}
    }
    const terminal=new Set(['succeeded','failed','cancelled','interrupted']);
    const statusLabel={queued:'等待处理',running:'正在处理',succeeded:'待检查',failed:'失败',cancelled:'已取消',cancel_requested:'正在取消',interrupted:'服务中断'};
    const jobLabel={asr:'识别',translation:'翻译',tts:'配音'};
    async function poll(){if(jobBusy||!config?.processingUrl)return;jobBusy=true;const serial=epoch;
      try{const response=await request(`jobs?project_id=${encodeURIComponent(context().project_id)}`);if(serial!==epoch)return;
        for(const brief of response.jobs){if(!jobLabel[brief.kind])continue;const cached=details.get(brief.id);if(!cached||cached.revision!==brief.revision){const r=await request(`jobs/${brief.id}/result?project_id=${encodeURIComponent(context().project_id)}`);if(serial!==epoch)return;if(r.job.snapshot?.project_schema!=='msw.project.v4')continue;details.set(brief.id,r.job);}jobs.set(brief.id,brief);}
        renderJobs();if([...jobs.values()].some(j=>!terminal.has(j.status)))schedulePoll();
      }catch(error){if(serial===epoch){status.textContent=`无法更新任务：${error.message}。重新打开面板可继续检查。`;}}
      finally{jobBusy=false;}
    }
    function schedulePoll(delay=1000){clearTimeout(jobTimer);jobTimer=setTimeout(()=>void poll(),delay);}
    async function assetsFor(job){let cursor=0,assets=[];for(;;){const r=await request(`assets?project_id=${encodeURIComponent(job.project_id)}&since=${cursor}`);assets.push(...r.assets);if(!r.more)break;if(r.cursor===cursor)throw Error('素材列表分页未前进');cursor=r.cursor;}return {...job,result:{...job.result,items:job.result.items.map(i=>({...i,asset:assets.find(a=>a.id===i.asset_id)}))}};}
    async function applyJob(job){const serial=epoch;let result=job;if(job.kind==='tts')result=await assetsFor(job);if(job.kind==='asr')await request('asr-validate',{...context(),job_id:job.id});if(serial!==epoch)return;
      editor.apply(`应用${jobLabel[job.kind]}结果`,p=>job.kind==='asr'?core.applyAsr(p,result,media,id):job.kind==='translation'?core.applyTranslation(p,result,id):core.applyTts(p,result));
      renderJobs();editor.report('处理结果已应用，可一次撤销。');}
    async function audioURL(assetId,projectId=context().project_id){const key=projectId+':'+assetId;if(!assetURLs.has(key)){const r=await fetch(`${config.processingUrl}/asset-audio?project_id=${encodeURIComponent(projectId)}&asset_id=${encodeURIComponent(assetId)}`,{headers:{'X-MSW-Token':config.requestToken}});if(!r.ok)throw Error('配音素材不可用，请检查本机服务或素材目录');assetURLs.set(key,URL.createObjectURL(await r.blob()));}return assetURLs.get(key);}
    function renderJobs(){const active=document.activeElement;if(results.contains(active)&&active.tagName==='AUDIO')return;results.replaceChildren();
      for(const brief of [...jobs.values()].sort((a,b)=>b.created_at-a.created_at).slice(0,30)){const job=details.get(brief.id)||brief,card=node('article','flat-job');card.dataset.jobId=job.id;
        const applied=editor.data.msw.applied_results?.includes(job.id);card.append(node('strong','',`${jobLabel[job.kind]} · ${applied?'已应用':statusLabel[job.status]||job.status}`));
        if(job.error)card.append(node('p','error',job.error));
        if(job.progress?.message)card.append(node('p','flat-note',job.progress.message));
        const rows=job.kind==='asr'?job.result?.segments:job.kind==='translation'?job.result?.translations:job.result?.items;
        if(rows){const review=node('details'),summary=node('summary','',`检查结果 · ${rows.length} 条`);review.append(summary);for(const row of rows){const line=node('div','flat-result-row');if(job.kind==='tts'){const input=job.snapshot.entries.find(e=>e.key===row.key);line.append(node('span','',input?.text||'配音结果'));if(row.status==='ready')line.append(btn('试听',attempt(async()=>{let audio=line.querySelector('audio');if(!audio){audio=node('audio');audio.controls=true;audio.src=await audioURL(row.asset_id,job.project_id);line.append(audio);}await audio.play();})));else line.append(node('span','error',row.error||row.status));}
            else line.textContent=row.text;review.append(line);}card.append(review);}
        for(const warning of job.result?.warnings||[])card.append(node('p','flat-note',warning));
        const buttons=node('div','flat-actions');if((job.status==='succeeded'||job.kind==='tts'&&terminal.has(job.status)&&rows?.some(r=>r.status==='ready'))&&!applied)buttons.append(btn(job.kind==='tts'?'收入配音素材':'应用到目标轨道',attempt(()=>applyJob(job))));
        if(!terminal.has(job.status))buttons.append(btn('取消任务',attempt(async()=>{await request(`jobs/${job.id}/cancel`,{project_id:job.project_id});schedulePoll(0);})));card.append(buttons);results.append(card);
      }
      renderAudio();
    }
    async function chooseMedia(){const serial=epoch;const response=await request('media-choose',context());if(serial!==epoch||response.cancelled)return;await bindMedia(response.media,serial);}
    async function bindMedia(value,serial){const response=await request('media-bind',{...context(),media_id:value.id,detached:true});if(serial!==epoch)return;media=response.media;audition=false;
      editor.apply('导入媒体',p=>({...copy(p),media:media.reference,media_metadata:copy(media.metadata),msw:{...p.msw,source_audio_index:media.audio_index}}));
      // Media URLs are grants issued by the local service, never arbitrary paths.
      const player=editor.player;player.src=media.url;player.load();end.value=String(media.metadata.duration_ms/1000);scopeText();editor.report(`已导入 ${media.name}`);
      await waveform();
    }
    async function waveform(){if(!media)return;const serial=epoch,source=media.id;const r=await request('media-analysis',{...context(),media_id:source,kind:'waveform'});
      const jobId=r.job.id;for(;;){if(serial!==epoch||media?.id!==source)return;const out=await request(`media-analysis?project_id=${encodeURIComponent(context().project_id)}&job_id=${encodeURIComponent(jobId)}`);
        if(out.job.status==='succeeded'){const ready=await request(`media-analysis-result?project_id=${encodeURIComponent(context().project_id)}&job_id=${encodeURIComponent(jobId)}`);if(serial===epoch&&media?.id===source){const payload=ready.result?.waveform||ready.waveform; if(payload){editor.apply('载入波形',p=>({...copy(p),waveform:payload}));waveformEditor?.setPayload(payload);}}return;}
        if(terminal.has(out.job.status))throw Error(out.job.error||'波形分析失败');await new Promise(r=>setTimeout(r,600));}
    }
    const stylesPanel=dialog('字幕样式');stylesPanel.id='flat-style-panel';const styleGrid=node('div','flat-processing-grid'),styleTrack=document.createElement('select'),preset=document.createElement('select'),font=document.createElement('input'),size=document.createElement('input'),color=document.createElement('input'),wrap=document.createElement('select'),count=document.createElement('input'),positionX=document.createElement('input'),positionY=document.createElement('input');
    size.type=count.type=positionX.type=positionY.type='number';size.min='1';size.max='400';count.min='1';count.max='200';color.type='color';for(const n of [positionX,positionY]){n.min='0';n.max='100';n.step='.1';}wrap.add(new Option('自动','auto'));wrap.add(new Option('按字数','characters'));
    const xField=field('水平位置（%）',positionX),yField=field('垂直位置（%）',positionY),countField=field('每行字数',count),styleNotice=node('p','flat-note');
    styleTrack.id='flat-style-track';preset.id='flat-style-preset';size.id='flat-style-size';
    styleGrid.append(field('编辑对象',styleTrack),field('样式预设',preset),field('字体',font),field('字号',size),field('颜色',color),field('换行方式',wrap),countField,xField,yField);
    function currentStyle(){const t=editor.data.subtitles.tracks.find(t=>t.id===styleTrack.value),value=S.normalize(t?.style.mode==='snapshot'?t.style.value:editor.data.preview?.project_style||S.defaults());return {track:t,value,base:t?.style.base==='annotation'&&value.annotation?value.annotation:value,slot:t?.style.slot||'main'};}
    function fillStyle(){const c=currentStyle(),s=c.base[c.slot];font.value=s.fontName;size.value=s.fontSize;color.value=s.primaryColor;wrap.value=s.wrapMode||'auto';count.value=s.charsPerLine||20;countField.hidden=wrap.value==='auto';preset.value=c.track?.style.mode==='snapshot'?'custom':'inherit';xField.hidden=yField.hidden=c.track?.layout!=='fixed';positionX.value=String((c.track?.position?.x??.5)*100);positionY.value=String((c.track?.position?.y??.08)*100);styleNotice.textContent=presetError||'轨道样式用于预览、ASS 和烧录；用途不限制样式。已对应的自动轨道组合排布。';}
    function fillStyleOptions(){const selected=styleTrack.value;styleTrack.replaceChildren(new Option('工程默认',''),...editor.data.subtitles.tracks.map(t=>new Option(t.name,t.id)));styleTrack.value=selected;const choices=[new Option('跟随工程','inherit'),new Option('当前自定义','custom'),...presets.map(p=>new Option(p.name,p.id))];preset.replaceChildren(...choices);fillStyle();}
    function saveStyle(value){const c=currentStyle();editor.apply('修改字幕样式',p=>{const n=copy(p);if(c.track){if(c.track.locked)throw Error('轨道已锁定');const t=n.subtitles.tracks.find(t=>t.id===c.track.id);t.style={...t.style,mode:'snapshot',value:S.normalize(value)};if(t.layout==='fixed')t.position={x:Number(positionX.value)/100,y:Number(positionY.value)/100};}else S.apply(n,value);return n;});}
    stylesPanel.append(styleGrid,styleNotice,btn('应用样式',attempt(()=>{const c=currentStyle();Object.assign(c.base[c.slot],{fontName:font.value,fontSize:Number(size.value),primaryColor:color.value,wrapMode:wrap.value,charsPerLine:Number(count.value)});saveStyle(c.value);fillStyle();})),btn('导出 ASS',attempt(exportAss)));
    styleTrack.onchange=fillStyle;wrap.onchange=()=>{countField.hidden=wrap.value==='auto';};preset.onchange=attempt(()=>{const c=currentStyle();if(preset.value==='custom')return;if(preset.value==='inherit'){if(c.track)editor.apply('跟随工程样式',p=>MSWFlatEditing.updateTrack(p,c.track.id,{style:{mode:'inherit',slot:c.slot,base:c.track.style.base}}));}else saveStyle(presets.find(p=>p.id===preset.value));fillStyle();});
    const audioPanel=dialog('配音素材与贴片'),audioList=node('div','flat-processing-results');audioPanel.id='flat-audio-panel';audioPanel.append(btn('下载工程与配音包',attempt(downloadBundle)),node('p','flat-note','收入配音素材后，可按来源时间放入配音轨。字幕后续修改不会自动拉伸或改写音频。'),audioList);
    function insertAudio(asset){editor.apply('添加配音贴片',p=>{const n=copy(p),ext=n.msw;ext.audio_tracks||=[];ext.audio_clips||=[];if(!ext.audio_tracks.length)ext.audio_tracks.push({id:id('voice'),name:'配音',gain_db:0,muted:false});const source=MSWFlatSubtitles.createIndex(n).resolveSource(asset.source_ref);if(!source)throw Error('来源字幕已删除，无法按来源时间放置');ext.audio_clips.push(MSWAudio.create(asset,ext.audio_tracks[0].id,source.content.start,id('clip')));MSWAudio.validate(ext);MSWAudio.assertCapacity(ext);return n;});renderAudio();}
    function renderAudio(){audioList.replaceChildren();for(const asset of editor.data.msw.assets||[]){const row=node('article','flat-job');row.append(node('span','',asset.generation.display_text),btn('试听',attempt(async()=>{let a=row.querySelector('audio');if(!a){a=node('audio');a.controls=true;a.src=await audioURL(asset.id);row.append(a);}await a.play();})),btn('按来源时间放入配音轨',attempt(()=>insertAudio(asset))));audioList.append(row);}
      for(const clip of editor.data.msw.audio_clips||[]){const row=node('article','flat-job');row.append(node('span','',`贴片 · ${(clip.start_ms/1000).toFixed(3)} s · ${clip.label}`),btn(clip.muted?'取消静音':'静音',attempt(()=>editor.apply('切换贴片静音',p=>{const n=copy(p);n.msw.audio_clips.find(c=>c.id===clip.id).muted=!clip.muted;return n;}))),btn('移除贴片',attempt(()=>editor.apply('移除配音贴片',p=>{const n=copy(p);n.msw.audio_clips=n.msw.audio_clips.filter(c=>c.id!==clip.id);return n;}))));audioList.append(row);}}
    function audioState(){const ext=editor.data.msw,assets=new Map((ext.assets||[]).map(a=>[a.id,a])),tracks=new Map((ext.audio_tracks||[]).map(t=>[t.id,t])),clips=ext.audio_clips||[];return {assets,tracks,clips,audible:MSWAudio.audible(ext),end:Math.max(0,...clips.map(c=>assets.has(c.asset_id)?MSWAudio.end(c,assets.get(c.asset_id)):0))};}
    transport=MSWAudioTransport.create({player:editor.player,getState:audioState,changed:()=>{},hint:s=>editor.report(s,true),frame:()=>{},load:async(asset,signal)=>{const r=await fetch(await audioURL(asset.id),{signal});return r.arrayBuffer();}});
    global.addEventListener('msw:player-changed',()=>transport.attachPlayer(editor.player));
    global.addEventListener('msw:flat-audition',()=>{media=null;audition=true;scopeText();});
    async function downloadBundle(){if(!config?.processingUrl)throw Error('工程与配音包需要本机编辑器服务');editor.flush();const response=await fetch(`${config.processingUrl}/asset-bundle`,{method:'POST',headers:{'X-MSW-Token':config.requestToken,'Content-Type':'application/json'},body:JSON.stringify({project_id:context().project_id,project:editor.snapshot()})});if(!response.ok){const r=await response.json();throw Error(r.error||'配音包下载失败');}const url=URL.createObjectURL(await response.blob()),a=node('a');a.href=url;a.download='MSW-工程与配音.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
    async function exportAss(){editor.flush();const p=editor.snapshot();for(const k of ['waveform','workspace','spectral','waveform_reapeaks'])delete p[k];const r=await request('subtitle-preview',{project:p,target:'both',video:{width:editor.player.videoWidth||1920,height:editor.player.videoHeight||1080}});const url=URL.createObjectURL(new Blob([r.ass],{type:'text/plain;charset=utf-8'})),a=node('a');a.href=url;a.download=($('flat-project-name').textContent.replace(/(?:\.flat)?\.(mosp|json)$/i,'')||'工程')+'_MSW.ass';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
    const bar=$('flat-trial-bar');bar.append(btn('字幕处理',attempt(async()=>{editor.flush();trackOptions();panel.show();await loadSettings();schedulePoll(0);})),btn('字幕样式',()=>{fillStyleOptions();stylesPanel.show();}),btn('配音素材',()=>{renderAudio();audioPanel.show();}),btn('导入媒体',attempt(chooseMedia)));
    const exportPanel=dialog('导出视频／音频'),exportGrid=node('div','flat-processing-grid'),exportList=node('div','flat-processing-results');exportPanel.id='flat-export-panel';
    const select=(rows)=>{const n=document.createElement('select');for(const [value,label] of rows)n.add(new Option(label,value));return n;};
    const format=select([['mp4','视频（MP4）'],['wav','音频（WAV）']]),mix=select([['mix','原声与配音'],['voice','仅配音']]),burn=select([['both','所有启用的字幕轨道'],['none','不烧录']]);
    const encoding=select([['auto','自动'],['hardware','显卡硬件编码'],['h264','CPU 编码']]),alignment=select([['truncate','对齐至视频'],['freeze','对齐至音频（定格）'],['black','对齐至音频（黑屏）']]),exportStyle=document.createElement('select'),skip=document.createElement('input');skip.type='checkbox';skip.checked=false;
    const burnField=field('烧录字幕',burn),encodingField=field('视频编码',encoding),alignmentField=field('导出范围对齐',alignment),exportStyleField=field('字幕样式',exportStyle);
    exportGrid.append(field('导出格式',format),field('音频内容',mix),burnField,exportStyleField,encodingField,alignmentField,field('跳过空隙',skip));
    const exportNote=node('p','flat-note','预览与烧录使用同一字幕排布。导出开始时固定工程快照，之后编辑不会改变本次输出。');
    let exportTimer,exportPending=null,exportBusy=false;const exportJobs=new Map();
    function exportFields(){const video=format.value==='mp4';burnField.hidden=encodingField.hidden=alignmentField.hidden=!video;exportStyleField.hidden=!video||burn.value==='none';}
    format.onchange=burn.onchange=exportFields;
    async function exportPoll(){const serial=epoch;try{const response=await request(`audio-exports?project_id=${encodeURIComponent(context().project_id)}`);if(serial!==epoch)return;for(const j of response.jobs)exportJobs.set(j.id,j);renderExports();if([...exportJobs.values()].some(j=>!terminal.has(j.status)))exportTimer=setTimeout(()=>void exportPoll(),1000);}catch(e){if(serial===epoch)editor.report(e.message,true);}}
    function renderExports(){exportList.replaceChildren();for(const job of [...exportJobs.values()].sort((a,b)=>b.created_at-a.created_at).slice(0,20)){const card=node('article','flat-job');card.dataset.exportId=job.id;card.append(node('strong','',`${job.format.toUpperCase()} · ${job.status==='succeeded'?'已完成':statusLabel[job.status]||job.status}`));
        if(job.status==='running')card.append(node('p','flat-note',`${job.progress||0}%${Number.isFinite(job.encoding_eta_seconds)?' · 预计剩余 '+Math.ceil(job.encoding_eta_seconds)+' 秒':''}${job.encoder_label?' · '+job.encoder_label:''}`));
        if(job.error)card.append(node('p','error',job.error));
        if(job.status==='succeeded')card.append(btn('下载文件',attempt(async()=>{const result=await request(`audio-exports/${job.id}/download`,{project_id:job.project_id});const a=node('a');a.href=result.url;a.download=job.download_name||'';a.click();})));
        else if(!terminal.has(job.status))card.append(btn('取消导出',attempt(async()=>{await request(`audio-exports/${job.id}/cancel`,{project_id:job.project_id});void exportPoll();})));exportList.append(card);}}
    const exportStart=btn('开始导出',attempt(async()=>{if(exportBusy)return;if(audition&&(format.value==='mp4'||mix.value==='mix'))throw Error('当前为临时试听媒体，请先使用“导入媒体”选择本次导出的视频或音频');editor.flush();if(!exportPending){const p=editor.snapshot();for(const key of ['waveform','workspace','spectral','waveform_reapeaks'])delete p[key];
        if(format.value==='mp4'&&burn.value!=='none'&&exportStyle.value){const selected=presets.find(p=>p.id===exportStyle.value);if(!selected)throw Error('所选样式已不存在');S.apply(p,selected);for(const t of p.subtitles.tracks)t.style={...t.style,mode:'snapshot',value:S.normalize(selected)};}
        exportPending={...context(),request_key:id('export'),plan_schema:'msw.audio-render.v1',project:p,project_name:$('flat-project-name').textContent.replace(/(?:\.flat)?\.(mosp|json)$/i,''),options:{format:format.value,mode:mix.value,burn_subtitles:format.value==='mp4'?burn.value:'none',video_encoding:encoding.value,video_tail:alignment.value,remove_gaps:skip.checked,duration_ms:media?.metadata.duration_ms||0,source_audio_index:media?.audio_index||0}};}
      const serial=epoch;exportBusy=true;exportStart.disabled=true;try{const r=await request('audio-exports',exportPending);exportPending=null;if(serial!==epoch)return;exportJobs.set(r.job.id,r.job);renderExports();void exportPoll();}catch(e){if(e.status&&e.status<500)exportPending=null;throw e;}finally{exportBusy=false;exportStart.disabled=false;}}));exportStart.id='flat-export-start';
    exportPanel.append(exportGrid,exportNote,exportStart,exportList);bar.append(btn('导出',attempt(async()=>{exportStyle.replaceChildren(new Option('跟随工程样式',''),...presets.map(p=>new Option(p.name,p.id)));exportFields();exportPanel.show();await exportPoll();})));
    const rendererHost={flat:true,get data(){return editor.snapshot();},get generation(){return editor.generation;},get player(){return editor.player;},config,
      exportProject:()=>editor.snapshot(),subtitlePreviewTarget:()=> 'both',subtitleRenderSettings:()=>null,refreshStylePreview:()=>{}};
    const styleAPI={ready:true,currentPreview:()=>({style:S.normalize(editor.data.preview?.project_style||S.defaults()),target:'both',label:'工程字幕样式'}),request};
    global.MSWCreateSubtitleRenderer(rendererHost,styleAPI);
    let audioSignature='';global.addEventListener('msw:flat-changed',()=>{global.MSWSubtitleRenderer?.invalidate();scopeText();const next=JSON.stringify(editor.data.msw);if(next!==audioSignature){audioSignature=next;transport.reset();renderAudio();}});
    async function onLoad(){epoch++;settingsTicket++;clearTimeout(jobTimer);media=null;audition=false;pending=null;jobs.clear();details.clear();transport.clear();for(const url of assetURLs.values())URL.revokeObjectURL(url);assetURLs.clear();trackOptions();renderJobs();if(!config?.processingUrl)return;const serial=epoch;
      try{const c=await request('capabilities');if(serial!==epoch)return;if(c.flatSubtitles!==1)throw Error('请保存工程并重启本机编辑器服务，以加载平级轨道处理与渲染支持');config.processingContext=c;
        const r=await request(`media-context?project_id=${encodeURIComponent(context().project_id)}&reference=${encodeURIComponent(editor.data.media||'')}`);if(serial!==epoch)return;media=r.media;scopeText();if(media){editor.player.src=media.url;editor.player.load();end.value=String(media.metadata.duration_ms/1000);}schedulePoll(0);
      }catch(error){if(serial===epoch)editor.report(error.message,true);}}
    global.addEventListener('msw:flat-loaded',()=>void onLoad());
    global.addEventListener('msw:flat-loaded',()=>{clearTimeout(exportTimer);exportPending=null;exportJobs.clear();renderExports();});
    if(config?.processingUrl)void request('subtitle-presets').then(r=>{presets=[...S.presets(),...r.presets.filter(p=>!S.presets().some(b=>b.id===p.id))];}).catch(e=>{presetError='本机预设未加载：'+e.message;});
    global.MSWFlatServices={request,get media(){return media;},get transport(){return transport;},exportAss,refresh:poll};void onLoad();
  }
  global.MSWFlatProcessingUI={setup};
})(window);
