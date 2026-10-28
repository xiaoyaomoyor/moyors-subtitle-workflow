// Non-modal offline audio export UI; rendering owns an immutable job snapshot.
(function (global) {
  'use strict';
  function durationText(ms) {
    if(!Number.isFinite(ms))return '—';
    ms=Math.max(0,Math.round(ms));
    return `${String(Math.floor(ms/60000)).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`;
  }
  function subtitleCount(project,mode,intervals) {
    if(mode==='none')return 0;
    const groups=[project.segments||[],project.multi_subtitle?.tracks?.[0]?.segments||[]];
    const cues=project.schema==='msw.project.v4'?project.subtitles.cues.filter(c=>!c.hidden&&project.subtitles.tracks.some(t=>t.id===c.track_id&&t.enabled)).map(c=>c.content)
      :mode==='main'?groups[0]:mode==='secondary'?groups[1]:groups.flat();
    return cues.filter(c=>!c.disabled&&c.text?.trim()&&intervals.some(k=>c.start<k.end_ms&&c.end>k.start_ms)).length;
  }
  function mount(kind) {
    const video = kind === 'video', timeline = kind === 'timeline', format = video ? 'mp4' : timeline ? 'otioz' : 'wav';
    const host = global.MSWE?.resolve('processing-host'), core = global.MSWAudioRender;
    if (!host || !core) return;
    const el = id => document.getElementById(id.replace('audio-export-', `${kind}-export-`));
    const t = value => {
      const s = video ? value.replaceAll('音频导出', '视频导出').replaceAll('下载 WAV', '下载 MP4').replace('文件 → 导出音频', '文件 → 导出视频')
        : timeline ? value.replaceAll('音频导出', '剪辑工程导出').replaceAll('下载 WAV', '下载 OTIOZ').replaceAll('导出音频', '配音剪辑工程') : value;
      return global.MSWE_I18N?.translateText?.(s) || s;
    };
    const panel = el('audio-export-panel'), button = el('audio-export-btn');
    const available = Boolean(host.config?.processingUrl), pageId = global.MSWProject.id('export-page');
    const projectId = () => global.MSWProject.ensure(host.data).project_id;
    const token = () => `${pageId}.${host.generation}`;
    let context = null, busy = null, pending = null, timer = null, polling = false, jobs = [], rendered = '', contextRequest = 0, jobsRevision = 0;
    const terminal = new Set(['succeeded', 'failed', 'cancelled', 'interrupted']);
    const monitorSnapshot = () => ({mode:timeline?'none':el('audio-export-monitor').value,volume:host.player.volume,muted:host.player.muted,
      source_gain_db:global.MSWE.resolve('audio-timeline')?.sourceGainDb()||0});
    function syncMonitorControls() {
      el('audio-export-monitor-field').hidden=timeline;
      const snapshot=monitorSnapshot(), levels=core.monitorGains({monitor:snapshot,source_gain_db:0,voice_gain_db:0});
      for(const key of ['source','voice']) {
        const input=el(`audio-export-${key}-gain`), synced=snapshot.mode===key||snapshot.mode==='both';
        if(synced) {
          if(!input.readOnly)input.dataset.manualValue=input.value;
          input.type='text';input.readOnly=true;
          input.value=levels[key+'Muted']?t('静音'):levels[key].toFixed(2);
        } else if(input.readOnly) {
          input.readOnly=false;input.type='number';input.value=input.dataset.manualValue??'0';
        }
      }
    }
    const labels = { queued: '等待导出', running: '正在导出', cancel_requested: '正在取消', cancelled: '已取消',
      succeeded: '导出完成', failed: '导出失败', interrupted: '导出中断，请重新开始' };
    const stages = { preparing: '检查音频素材', source: '准备原声', mixing: '渲染音频', encoding: '编码 WAV', video: '编码视频', muxing: '合并音画', packaging: '打包剪辑素材' };
    function message(value, error = false) {
      el('audio-export-message').textContent = t(value);
      el('audio-export-message').classList.toggle('is-error', error);
    }
    async function request(route, payload) {
      const response = await fetch(`${host.config.processingUrl}/${route}`, {
        method: payload ? 'POST' : 'GET', cache: 'no-store',
        headers: { 'X-MSW-Token': host.config.requestToken, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) {
        const error = Error(result.error || `HTTP ${response.status}`); error.status = response.status; throw error;
      }
      return result;
    }
    function sourceRange() {
      const mode=el('audio-export-range').value;
      if(video&&mode==='playhead') {
        const end=Math.round(global.MSWE.resolve('audio-timeline')?.currentTimeMs()??host.player.currentTime*1000);
        if(!Number.isFinite(end)||end<=0)throw Error('请将播放头移到起点之后');
        return {start_ms:0,end_ms:end};
      }
      if(mode!=='custom')return {start_ms:0,end_ms:null};
      const time=key=>{
        const text=el('audio-export-'+key+'-time').value;
        if(!video)return text.trim()?Math.round(Number(text)*1000):NaN;
        try{return core.parseSourceTime(text);}catch(error){throw Error(t(key==='start'?'源起点':'源终点')+'：'+t(error.message));}
      };
      return {start_ms:time('start'),end_ms:time('end')};
    }
    function selectedOptions() {
      const numeric = id => {if(el(id).readOnly)return 0;const value=el(id).value;return value?.trim()?Number(value):NaN;};
      const settings = core.options({ mode: el('audio-export-mode').value, sample_rate: Number(el('audio-export-rate').value),
        duration_ms: host.audioExportDuration(), ...sourceRange(),
        remove_gaps: el('audio-export-remove-gaps').checked, source_audio_index: Number(el('audio-export-stream').value || 0),
        source_gain_db: numeric('audio-export-source-gain'), voice_gain_db: numeric('audio-export-voice-gain'), peak_protection: el('audio-export-peak').checked,
        ...(!timeline?{monitor:monitorSnapshot()}:{}) });
      if (video) {
        settings.format = format;
        settings.video_tail = el('audio-export-tail').value;
        settings.video_encoding = el('audio-export-encoding').value;
        settings.hardware_encoder = el('audio-export-hardware').value || 'auto';
        settings.burn_subtitles = el('audio-export-burn-subtitles').value;
        settings.subtitle_scope = subtitleTracks===null?'all':'selected';
        return core.videoOptions(host.audioExportPreview(), settings, context);
      }
      if (timeline) {
        settings.format = format;
        settings.collect_media = el('audio-export-collect-media').checked;
        settings.duration_ms = Math.max(settings.duration_ms, context?.duration_ms || 0);
      }
      return settings;
    }
    const sourceAvailable = () => Boolean(context?.source_available && context.media_reference === host.data.media);
    let subtitleTracks=null,subtitleTrackKey='';
    function syncSubtitleTracks() {
      if(!video)return;
      const p=host.audioExportPreview(),flat=p.schema==='msw.project.v4',select=el('audio-export-burn-subtitles');
      if(flat&&!select.dataset.physical) {
        const value=select.value;select.replaceChildren(new Option(t('不烧录'),'none'),new Option(t('烧录字幕'),'both'));
        select.value=value==='none'?'none':'both';select.dataset.physical='true';
      }
      const details=el('audio-export-track-scope');details.hidden=!flat||select.value==='none';if(!flat)return;
      const chosen=p.subtitles.tracks.filter(t=>t.enabled&&(subtitleTracks===null||subtitleTracks.includes(t.id)));
      details.querySelector('summary').textContent=t('字幕轨道')+' · '+(subtitleTracks===null?t('全部轨道'):`${chosen.map(t=>t.name).join('、')||t('未选择')}`);
      const choices=el('audio-export-track-choices'),key=JSON.stringify(p.subtitles.tracks.map(t=>[t.id,t.name,t.enabled]));
      if(subtitleTrackKey===key){for(const input of choices.querySelectorAll('input')){input.checked=input.dataset.track==='all'?subtitleTracks===null:chosen.some(t=>t.id===input.dataset.track);if(input.dataset.track==='all')input.indeterminate=subtitleTracks!==null&&chosen.length>0;}return;}
      subtitleTrackKey=key;choices.replaceChildren();
      const add=(id,label,checked,disabled,change)=>{const row=document.createElement('label');row.className='dropdown-setting-toggle';const input=document.createElement('input');input.type='checkbox';input.dataset.track=id;input.checked=checked;input.disabled=disabled;if(id==='all')input.indeterminate=subtitleTracks!==null&&chosen.length>0;input.onchange=()=>{change(input.checked);update();global.dispatchEvent(new Event('msw:export-tracks'));};row.append(input,document.createTextNode(label));choices.append(row);};
      add('all',t('全部轨道'),subtitleTracks===null,false,checked=>{subtitleTracks=checked?null:[];});
      for(const track of p.subtitles.tracks)add(track.id,track.name+(track.enabled?'':' · '+t('已禁用')),chosen.some(t=>t.id===track.id),!track.enabled,()=>{
        const next=new Set(subtitleTracks===null?p.subtitles.tracks.filter(t=>t.enabled).map(t=>t.id):subtitleTracks);
        if(next.has(track.id))next.delete(track.id);else next.add(track.id);subtitleTracks=p.subtitles.tracks.filter(t=>t.enabled).every(t=>next.has(t.id))?null:[...next];
      });
    }
    if(video)global.MSWVideoSubtitleScope={ids:()=>subtitleTracks===null?null:[...subtitleTracks],
      project:p=>p.schema==='msw.project.v4'?global.MSWProductionProject.exportScope(p,subtitleTracks):p};
    function update() {
      syncSubtitleTracks();
      syncMonitorControls();
      const mix = el('audio-export-mode').value === 'mix';
      el('audio-export-source').hidden = !mix;
      el('audio-export-custom').hidden = el('audio-export-range').value !== 'custom';
      el('audio-export-start').textContent = t(pending ? '确认上次导出请求' : '开始导出');
      el('audio-export-start').disabled = Boolean(busy) || !available || !context?.available;
      el('audio-export-gap-hint').textContent = t(host.data.msw?.audio_settings?.gap_policy === 'follow'
        ? '移除空隙时，配音随媒体一起裁切。' : '移除空隙时，保留未静音贴片覆盖的区间。');
      if(video) {
        const hardware = context?.video_encoders?.filter(e => e.available) || [];
        const mode = el('audio-export-encoding').value;
        el('audio-export-hardware-field').hidden = mode !== 'hardware' || hardware.length < 2;
        el('audio-export-encoder-status').textContent = !context ? t('正在检测编码器…')
          : mode === 'h264' ? t('使用 CPU 编码')
          : hardware.length ? `${t('可用硬件')}：${hardware.map(e=>e.label).join('、')}`
          : mode === 'hardware' ? t('未检测到可用硬件编码器，请检查驱动与 FFmpeg，或选择自动／软件编码（CPU）')
          : t('未检测到可用硬件；需要编码时使用 CPU');
        el('audio-export-encoder-status').classList.toggle('is-error', mode === 'hardware' && context && !hardware.length);
        let status=t('正在读取音画时长');
        if(context?.video) {
          try {
            const range=sourceRange(),start=range.start_ms,end=range.end_ms??Infinity;
            const audioEnd=core.audioEnd(host.audioExportPreview(),{mode:el('audio-export-mode').value,source_audio_index:Number(el('audio-export-stream').value||0)},context);
            const delta=Math.round(Math.max(start,Math.min(end,audioEnd))-Math.max(start,Math.min(end,context.video.duration_ms)));
            status=delta===0?t('音视频一致'):`${t(delta>0?'音频领先视频':'视频领先音频')} ${(Math.abs(delta)/1000).toFixed(3)} ${t('秒')}`;
          } catch(_) {status=t('请先填写有效的导出范围');}
        }
        el('audio-export-tail-help').textContent=[status,
          t('对齐至视频：以画面结尾为准，裁去超出的音频；不足处补静音。'),
          t('对齐至音频（定格）：以所选音频结尾为准，画面不足时定格末帧，过长时裁切。'),
          t('对齐至音频（黑屏）：以所选音频结尾为准，画面不足时补黑屏，过长时裁切。')].join('\n');
        global.MSWHelp?.refresh(el('audio-export-tail-field'));
      }
      try {
        if (!context) throw Error('正在读取导出信息…');
        if(video&&context?.video&&context.video_alignment_version!==2)throw Error('视频对齐功能已更新，请重启本机编辑器服务并刷新页面');
        if(video&&context?.video&&context.video_encoding_version!==1)throw Error('视频编码功能已更新，请重启本机编辑器服务并刷新页面');
        if(video&&context&&el('audio-export-encoding').value==='hardware'&&!context.video_encoders?.some(e=>e.available))throw Error('没有可用硬件编码器，请选择自动或软件编码（CPU）');
        const o = selectedOptions(), plan = core.compile(host.audioExportPreview(), o);
        if ((mix || video) && !sourceAvailable()) throw Error('原媒体尚未由本机服务接管，请保存并在本机服务中重新打开工程');
        if (video && context && !context.video) throw Error('原媒体没有可导出的视频画面，请使用导出音频');
        const count=video?subtitleCount(global.MSWVideoSubtitleScope.project(host.audioExportPreview()),o.burn_subtitles,plan.intervals):0;
        if (video && o.burn_subtitles !== 'none') {
          if (!count) {
            throw Error('导出范围内没有所选轨道的可压制字幕');
          }
        }
        if (!video && !timeline && !mix && !plan.pieces.length) throw Error('导出范围内没有可发声的音频贴片');
        if (plan.sample_count * 4 + 44 > 0xFFFFFF00) throw Error('WAV 将超过 4 GB，请分段导出');
        el('audio-export-summary').textContent = video
          ?`${t('成品时长')}：${durationText(plan.sample_count/plan.sample_rate*1000)} | ${t('字幕块')}：${count} | ${t('音频贴片')}：${new Set(plan.pieces.map(p=>p.clip_id)).size}`
          :`${t('成品时长')} ${(plan.sample_count / plan.sample_rate).toFixed(3)} s · `
          + `${new Set(plan.pieces.map(p => p.clip_id)).size} ${t('个音频贴片')}`
          + (video || timeline ? '' : ` · ${(plan.sample_count * 4 / 1024**2).toFixed(1)} MB`);
      } catch (error) {
        el('audio-export-summary').textContent = t(error.message);
        if (!pending) el('audio-export-start').disabled = true;
      }
    }
    async function loadContext() {
      const generation = host.generation, id = projectId(), serial = ++contextRequest;
      context = null; update();
      try {
        const result = await request(`${kind}-export-context?project_id=${encodeURIComponent(id)}`);
        if (generation !== host.generation || id !== projectId() || serial !== contextRequest) return;
        context = result;
        if(video) {
          const select=el('audio-export-hardware'), previous=select.value;
          select.replaceChildren(...(result.video_encoders || []).filter(e=>e.available).map(e=>new Option(e.label,e.id)));
          if([...select.options].some(o=>o.value===previous))select.value=previous;
        }
        const tracks = result.audio_tracks?.length ? result.audio_tracks : [{ audio_index: 0 }];
        el('audio-export-stream').replaceChildren(...tracks.map((track, i) => {
          const index = track.audio_index ?? i;
          return new Option([`${t('音轨')} ${index + 1}`, track.title, track.language].filter(Boolean).join(' · '), String(index));
        }));
        el('audio-export-stream').value = String(result.audio_index || 0);
        if (!el('audio-export-stream').value) el('audio-export-stream').selectedIndex = 0;
        if (!result.available) message('音频导出需要 FFmpeg 与 FFprobe，请在启动器配置后重试', true);
        update();
      } catch (error) {
        if (generation === host.generation && serial === contextRequest) {
          message(error.status === 404 ? '当前服务尚未加载音频导出，请重启本机编辑器服务并刷新页面' : error.message, true); update();
        }
      }
    }
    function action(label, job, callback) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = t(label);
      button.dataset.action = label; button.dataset.jobId = job.id;
      button.addEventListener('click', async () => {
        button.disabled = true;
        try { await callback(); }
        catch (error) { if (job.project_id === projectId()) message(error.message, true); }
        finally { button.disabled = false; }
      });
      return button;
    }
    const videoCards=new Map();
    function videoDetails(job) {
      const o=job.options||{},s=job.summary||{},r=job.result||{};
      const stamp=value=>{
        if(!Number.isFinite(value))return t('未记录');
        const d=new Date(value*1000),pad=n=>String(n).padStart(2,'0');
        return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      };
      const time=`${stamp(job.started_at||job.created_at)} ~ ${terminal.has(job.status)?stamp(job.finished_at||job.updated_at):t(job.status==='queued'?'等待开始':'导出中')}`;
      const encoder=job.video_encoder||r.video_encoder;
      const encoding=encoder==='copy'||r.video_encoding==='copy'?t('画面直接复制')
        :encoder==='libx264'?t('软件编码（CPU）')
        :encoder?`${t('硬件编码')}（${job.encoder_label||encoder}）`
        :t(o.video_encoding==='h264'?'软件编码（CPU）':o.video_encoding==='hardware'?'硬件编码（待确定）':'自动编码（待确定）');
      const scope=s.subtitle_scope==='all'?t('全部轨道'):s.subtitle_scope==='selected'?(s.subtitle_tracks||[]).join('、')
        :t(s.subtitle_scope==='main'?'主字幕':s.subtitle_scope==='secondary'?'副字幕':s.subtitle_scope==='both'?'主副字幕':'未记录');
      const burn=o.burn_subtitles||r.burn_subtitles;
      const captions=burn==='none'?t('不烧录字幕'):burn?`${t('烧录字幕')}（${scope}）`:t('烧录设置未记录');
      const monitor=t(({none:'不同步',source:'原声',voice:'配音',both:'原声+配音'})[o.monitor?.mode||'none']);
      const status=[t(job.mode==='mix'?'原声+配音':'仅配音'),encoding,captions,`${t('同步试听')}（${monitor}）`];
      if(job.encoding_note||r.encoding_note)status.push(t(job.encoding_note||r.encoding_note));
      if(r.clipped)status.push(t('声音超限，建议开启峰值保护'));
      else if(r.attenuation_db<-.001)status.push(`${t('峰值保护衰减')} ${(-r.attenuation_db).toFixed(2)} dB`);
      const duration=r.sample_rate?r.sample_count/r.sample_rate*1000:s.duration_ms;
      return [time,status.join(' | '),`${t('成品时长')}：${durationText(duration)} | ${t('字幕块')}：${s.subtitle_count??'—'} | ${t('音频贴片')}：${s.clip_count??job.clip_count??'—'}`].join('\n');
    }
    function renderVideoJobs(staleProgress) {
      const container=el('audio-export-jobs'),ids=new Set(jobs.map(j=>j.id));
      for(const [id,ui] of videoCards)if(!ids.has(id)){ui.card.remove();videoCards.delete(id);}
      jobs.forEach((job,index)=>{
        let ui=videoCards.get(job.id);
        if(!ui) {
          const card=document.createElement('article');card.className='msw-processing-job msw-video-job';card.dataset.jobId=job.id;
          const summary=document.createElement('div'),content=document.createElement('div');summary.className='msw-video-job-row';content.className='msw-video-job-content';
          const heading=document.createElement('div');heading.className='msw-video-job-heading';
          const number=document.createElement('span'),title=document.createElement('span');title.dataset.i18nSkip='';heading.append(number,title);
          const status=document.createElement('div');status.className='msw-video-job-progress';
          const spinner=document.createElement('span');spinner.className='msw-tts-state-icon';spinner.dataset.state='running';spinner.setAttribute('aria-hidden','true');
          const phase=document.createElement('span'),estimate=document.createElement('span');estimate.dataset.encodingEstimate='true';
          status.append(spinner,phase,estimate);content.append(heading,status);
          const controls=document.createElement('div');controls.className='msw-video-job-controls';
          summary.append(content,controls);card.append(summary);
          ui={card,number,title,status,spinner,phase,estimate,job};videoCards.set(job.id,ui);
          const iconAction=(label,path,callback)=>{
            const button=action(label,job,callback);button.className='msw-export-icon';button.title=t(label);button.setAttribute('aria-label',t(label));
            button.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
            button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();});controls.append(button);return button;
          };
          ui.cancel=iconAction('取消导出','m6 6 12 12M18 6 6 18',async()=>{
            await request(`audio-exports/${ui.job.id}/cancel`,{project_id:ui.job.project_id});schedule(0);
          });
          ui.info=document.createElement('button');ui.info.type='button';ui.info.className='msw-export-icon';
          ui.info.setAttribute('aria-label',t('导出详情'));ui.info.dataset.helpLayout='wide';
          ui.info.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v.5"/></svg>';
          global.MSWHelp?.bind(ui.info,()=>videoDetails(ui.job));controls.append(ui.info);
          ui.download=iconAction('下载 WAV','M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',async()=>{
            const data=await request(`audio-exports/${ui.job.id}/download`,{project_id:ui.job.project_id});
            const link=document.createElement('a');link.href=data.url;link.download=ui.job.download_name||'msw-video.mp4';document.body.append(link);link.click();link.remove();
          });
        }
        ui.job=job;const active=!terminal.has(job.status);
        ui.number.textContent='#'+String(job.sequence||jobs.length-index).padStart(2,'0');
        ui.title.textContent=job.download_name||t(job.options?.preview_sample?'五秒样片':job.mode==='mix'?'原声 + 配音混音':'配音轨（仅音频贴片）');ui.title.title=ui.title.textContent;
        const percent=job.status==='succeeded'?100:Math.max(0,Math.min(100,Math.round(job.progress||0)));
        ui.phase.textContent=t(active&&job.status==='running'?stages[job.stage]||labels.running:labels[job.status]||job.status)+(active||job.status==='succeeded'?` · ${percent}%`:'');
        if(job.status==='succeeded'&&job.download_available===false)ui.phase.textContent+=' · '+t('临时文件已清理');
        ui.spinner.hidden=!active;ui.estimate.hidden=!active;
        if(active){
          let estimate=t('剩余时长：正在估算');
          if(job.stage==='muxing'||job.progress>=92)estimate=t('正在收尾');
          else if(job.stage==='video'&&Number.isFinite(job.encoding_eta_seconds)&&!staleProgress(job)){
            const seconds=Math.max(1,Math.ceil(job.encoding_eta_seconds/5)*5),minutes=Math.floor(seconds/60),rest=seconds%60;
            estimate=`${t('预计编码剩余约')} ${minutes?`${minutes} ${t('分')} `:''}${rest} ${t('秒')}`;
          }
          ui.estimate.textContent=`（${estimate}）`;ui.estimate.title=t('根据近期编码速度估算，不包含最后的音画合并；复杂画面或设备负载变化会影响结果。');
          ui.status.setAttribute('role','progressbar');ui.status.setAttribute('aria-label',t('音频导出进度'));ui.status.setAttribute('aria-valuemin','0');ui.status.setAttribute('aria-valuemax','100');ui.status.setAttribute('aria-valuenow',String(percent));ui.status.setAttribute('aria-valuetext',ui.phase.textContent+ui.estimate.textContent);
        }else {
          ui.estimate.textContent='';
          for(const attr of ['role','aria-label','aria-valuemin','aria-valuemax','aria-valuenow','aria-valuetext'])ui.status.removeAttribute(attr);
        }
        ui.cancel.hidden=!active;ui.cancel.disabled=job.status==='cancel_requested';ui.download.hidden=job.status!=='succeeded'||job.download_available===false;
        global.MSWHelp?.refresh(ui.info);
        if(job.error&&!ui.error){
          ui.error=document.createElement('button');ui.error.type='button';ui.error.className='msw-export-icon';ui.error.setAttribute('aria-label',t('错误详情'));
          ui.error.innerHTML='<span class="msw-tts-state-icon" data-state="failed" aria-hidden="true"></span>';
          global.MSWHelp?.bind(ui.error,()=>ui.job.error||'');ui.download.after(ui.error);
        }
        if(ui.error){ui.error.hidden=!job.error;global.MSWHelp?.refresh(ui.error);}
        if(container.children[index]!==ui.card)container.insertBefore(ui.card,container.children[index]||null);
      });
      el('audio-export-history-count').textContent=`(${jobs.length})`;
    }
    function renderJobs() {
      const scroll = el('audio-export-jobs').scrollTop;
      const staleProgress = job => !job.progress_at || Date.now()/1000-job.progress_at > 15;
      const key = JSON.stringify(jobs) + token() + jobs.some(staleProgress); if (key === rendered) return; rendered = key;
      if(video){renderVideoJobs(staleProgress);return;}
      const focused = document.activeElement?.closest(`#${kind}-export-jobs button`);
      const focusId = focused?.dataset.jobId, focusAction = focused?.dataset.action;
      const fragment = document.createDocumentFragment();
      for (const job of jobs) {
        const card = document.createElement('article'); card.className = 'msw-processing-job'; card.dataset.jobId = job.id;
        const title = document.createElement('strong');
        title.textContent = t(job.mode === 'mix' ? '原声 + 配音混音' : '配音轨（仅音频贴片）');
        if (timeline) title.textContent = t('配音剪辑工程（OTIOZ）');
        const status = document.createElement('p'); status.className = 'msw-processing-hint';
        status.textContent = `${t(labels[job.status] || job.status)} · ${new Date(job.created_at * 1000).toLocaleTimeString()}`;
        if (job.client_token !== token()) status.textContent += ` · ${t('先前的工程快照')}`;
        card.append(title, status);
        if (!terminal.has(job.status)) {
          const progress = document.createElement('progress'); progress.max = 100; progress.value = job.progress || 0;
          progress.setAttribute('aria-label', t('音频导出进度'));
          const stage = document.createElement('p'); stage.className = 'msw-processing-hint';
          stage.textContent = `${t(stages[job.stage] || labels[job.status])} · ${Math.round(job.progress || 0)}%`;
          card.append(progress, stage);
        }
        if (job.error) { const text = document.createElement('p'); text.className = 'msw-processing-message is-error'; text.textContent = t(job.error); card.append(text); }
        const actions = document.createElement('div'); actions.className = 'msw-processing-actions';
        if (job.status === 'succeeded') {
          const result = job.result, note = document.createElement('p'); note.className = 'msw-processing-hint';
          note.textContent = `${(result.sample_count / result.sample_rate).toFixed(3)} s · ${(result.byte_size / 1024**2).toFixed(1)} MB`;
          if (result.attenuation_db < -.001) note.textContent += ` · ${t('峰值保护衰减')} ${(-result.attenuation_db).toFixed(2)} dB`;
          if (result.clipped) note.textContent += ` · ${t('部分声音超限，建议开启峰值保护重新导出')}`;
          if (timeline && result.external_media) note.textContent += ` · ${t('原视频仍引用本机文件')}`;
          card.append(note);
          if(job.download_available===false)note.textContent+=' · '+t('临时文件已清理');
          else actions.append(action('下载 WAV', job, async () => {
            const data = await request(`audio-exports/${job.id}/download`, { project_id: job.project_id });
            const link = document.createElement('a'); link.href = data.url;
            link.download = job.download_name || (timeline ? 'msw-timeline.otioz' : job.mode === 'mix' ? 'msw-mix.wav' : 'msw-voice.wav');
            document.body.append(link); link.click(); link.remove();
          }));
        } else if (!terminal.has(job.status)) {
          const cancel = action('取消导出', job, async () => {
            await request(`audio-exports/${job.id}/cancel`, { project_id: job.project_id }); schedule(0);
          });
          cancel.disabled = job.status === 'cancel_requested'; actions.append(cancel);
        }
        card.append(actions); fragment.append(card);
      }
      el('audio-export-jobs').replaceChildren(fragment);
      el('audio-export-jobs').scrollTop = scroll;
      el('audio-export-history-count').textContent = `(${jobs.length})`;
      if (focusId && focusAction) [...el('audio-export-jobs').querySelectorAll('button')]
        .find(b => b.dataset.jobId === focusId && b.dataset.action === focusAction)?.focus({ preventScroll: true });
    }
    function schedule(delay = 1200) { clearTimeout(timer); timer = setTimeout(poll, delay); }
    async function poll() {
      if (!available || polling) { if (available) schedule(); return; }
      if(video&&floating.isOpen()&&el('audio-export-range').value==='playhead')update();
      const id = projectId(), generation = host.generation, revision = jobsRevision; polling = true;
      try {
        const data = await request(`audio-exports?project_id=${encodeURIComponent(id)}`);
        if (generation !== host.generation || id !== projectId() || revision !== jobsRevision) return;
        const filtered = data.jobs.filter(j => (j.format || 'wav') === format);
        const completed = filtered.some(j => j.status === 'succeeded' && jobs.some(old => old.id === j.id && !terminal.has(old.status)));
        const failed = filtered.find(j => ['failed','interrupted'].includes(j.status) && jobs.some(old => old.id === j.id && !terminal.has(old.status)));
        jobs = filtered; renderJobs();
        if (failed && !floating.isOpen()) host.flashHint(`${t('音频导出失败')}：${t(failed.error || '请打开导出面板查看详情')}`, 'warning');
        if (completed && !floating.isOpen()) host.flashHint(t(timeline ? '剪辑工程导出完成，可在「更多导出 → OTIO」下载 OTIOZ' : '音频导出完成，可在「文件 → 导出音频」下载 WAV'), 'success');
      } catch (error) { if (floating.isOpen() && generation === host.generation) message(error.message, true); }
      finally { polling = false; if (floating.isOpen() || jobs.some(j => !terminal.has(j.status))) schedule(); }
    }
    async function start(overrides = null) {
      if (busy) return;
      const generation = host.generation, ticket = {}; busy = ticket;
      try {
        if (!pending) {
          let project = host.exportProject();
          if(video)project=global.MSWVideoSubtitleScope.project(project);
          if (video) global.MSWSubtitleStyle?.applyExport(project);
          for (const key of ['waveform', 'spectral', 'waveform_reapeaks']) delete project[key];
          let options = {...selectedOptions({applyTail:!overrides}),...(overrides || {})};
          if (video) options = core.videoOptions(project,options,context);
          core.compile(project, options);
          pending = { project, options, project_name: host.projectName(), plan_schema: core.VERSION, project_id: projectId(), client_token: token(),
            request_key: global.MSWProject.id('export-request'), binding: host.config.processingContext?.binding };
        }
        update();
        const result = await request('audio-exports', pending);
        if (generation !== host.generation || busy !== ticket) return;
        pending = null;
        ++jobsRevision;
        jobs = [result.job, ...jobs.filter(j => j.id !== result.job.id)]; renderJobs();
        message(video?'':'音频导出已开始；可继续编辑，关闭面板不会取消任务'); schedule(0);
      } catch (error) {
        if (generation !== host.generation || busy !== ticket) return;
        if (error.status && error.status < 500) pending = null;
        message(error.message, true);
      } finally { if (busy === ticket) { busy = null; update(); } }
    }
    const floating = host.createFloatingPanel({ panel, dragHandle: el('audio-export-drag'),
      anchorButton: document.querySelector('[data-menubar-item="file"] > button'), positionKey: `msw.${kind}.export.position` });
    button.disabled = !available;
    if (!available) button.title = t('音频导出需要通过本机编辑器服务打开工程');
    button.addEventListener('click', () => {
      host.commitEdits(); message('');
      el('audio-export-remove-gaps').checked = false;
      el('audio-export-end-time').value = video?durationText(Math.max(1,host.audioExportDuration())):String(Math.max(.001, host.audioExportDuration() / 1000));
      floating.open(); update(); void loadContext(); schedule(0);
    });
    el('audio-export-close').addEventListener('click', () => floating.close());
    el('audio-export-start').addEventListener('click', () => void start());
    if (video) global.addEventListener('msw:video-sample',async event=>{
      if(busy||pending){message('请先确认当前导出请求',true);return;}
      const generation=host.generation;
      floating.open();if(!context)await loadContext();
      if(generation!==host.generation||!context?.video)return;
      const at=Math.max(0,Math.round(host.player.currentTime*1000)||0);
      await start({start_ms:at,end_ms:at+5000,video_tail:'freeze',remove_gaps:false,burn_subtitles:event.detail.target,preview_sample:true});
    });
    for (const input of panel.querySelectorAll('input, select')) input.addEventListener('input', update);
    if(video) {
      for(const key of ['start','end'])el('audio-export-'+key+'-time').addEventListener('change',event=>{
        try{event.target.value=durationText(core.parseSourceTime(event.target.value));}catch(_){/* Keep invalid text visible for correction. */}update();
      });
      for(const event of ['timeupdate','seeked'])host.player.addEventListener(event,()=>{if(floating.isOpen()&&el('audio-export-range').value==='playhead')update();});
    }
    global.addEventListener('msw:audio-changed', () => { if (floating.isOpen()) update(); });
    global.addEventListener('msw:subtitles-changed', () => { if (floating.isOpen()) update(); });
    global.addEventListener('msw:burn-style', () => { if (floating.isOpen()) update(); });
    global.addEventListener('msw:source-gain', () => { if (floating.isOpen()) update(); });
    host.player.addEventListener('volumechange',()=>{if(floating.isOpen())update();});
    global.addEventListener('msw:project-changed', () => {
      subtitleTracks=null;
      ++contextRequest; context = null; busy = null; pending = null; jobs = []; rendered = ''; clearTimeout(timer);
      renderJobs(); message('');
      queueMicrotask(() => { update(); if (floating.isOpen()) { void loadContext(); schedule(0); } });
    });
  }
  // Clone the common, uninitialized form once. Both windows then use the same
  // controller, input layout and project-generation guards.
  const blueprint = document.getElementById('audio-export-panel');
  if (!blueprint) return;
  for (const kind of ['video', 'timeline']) {
    const copy = blueprint.cloneNode(true);
    for (const node of [copy, ...copy.querySelectorAll('*')]) {
      for (const attr of ['id', 'for', 'aria-labelledby', 'data-help-for']) {
        if (node.hasAttribute(attr)) node.setAttribute(attr, node.getAttribute(attr).replaceAll('audio-export-', `${kind}-export-`));
      }
    }
    copy.querySelector(`#${kind}-export-title`).textContent = kind === 'video' ? '导出视频' : '配音剪辑工程（OTIOZ）';
    copy.querySelector(`#${kind}-export-close`).setAttribute('aria-label', kind === 'video' ? '关闭视频导出' : '关闭剪辑工程导出');
    copy.querySelector(`#${kind}-export-jobs`).setAttribute('aria-label', kind === 'video' ? '视频导出任务' : '剪辑工程导出任务');
    copy.querySelector(`#${kind}-export-mode`).value = 'mix';
    copy.querySelector(`#${kind}-export-format-hint`).replaceWith(document.getElementById(`${kind}-export-fields`).content.cloneNode(true));
    if(kind==='video') arrangeVideoFields(copy);
    blueprint.after(copy);
  }
  mount('audio');
  mount('video');
  mount('timeline');
  function arrangeVideoFields(panel) {
    const body=panel.querySelector('.gap-remove-panel-body'),get=id=>panel.querySelector('#video-export-'+id);
    get('range').append(new Option('截止到当前播放头','playhead'));
    get('range').closest('label').dataset.optionHelp='截止到当前播放头：从源时间轴起点导出至点击开始时的播放头位置。指定范围可输入分:秒.毫秒、时:分:秒.毫秒或秒数，例如 20:39.478。';
    for(const key of ['start','end']) {
      const input=get(key+'-time');input.type='text';input.removeAttribute('min');input.removeAttribute('step');input.placeholder='00:00.000';input.autocomplete='off';input.spellcheck=false;
      input.value=durationText(Number(input.value)*1000);
      input.closest('label').firstChild.textContent=key==='start'?'源起点':'源终点';
    }
    const section=(name,id,folded=false)=>{
      const node=document.createElement(folded?'details':'section');node.id='video-export-'+id;
      node.className='settings-panel-section msw-export-section';
      const heading=document.createElement(folded?'summary':'span');heading.className='settings-panel-title';heading.textContent=name;node.append(heading);return node;
    };
    const grid=(section,fields)=>{const row=document.createElement('div');row.className='media-settings-grid';for(const key of fields){const label=get(key).closest('label');label.classList.remove('msw-processing-field');label.classList.add('media-settings-field');row.append(label);}section.append(row);};
    const common=section('导出设置','general'),subtitles=section('字幕','subtitles'),advanced=section('音频与其他选项','advanced',true);
    body.prepend(common,subtitles,advanced);
    grid(common,['mode','range']);common.append(get('custom'));grid(common,['tail','encoding']);
    common.append(get('hardware-field'),get('encoder-status'),get('remove-gaps').closest('label'));
    subtitles.append(get('subtitle-fields'),get('track-scope'),get('speaker-wrap'));
    grid(advanced,['monitor','rate']);advanced.append(get('source'));grid(advanced,['voice-gain']);advanced.append(get('peak').closest('label'));
    const footer=get('start').parentElement;footer.classList.add('msw-export-footer');footer.prepend(get('summary'));
    // All controls keep their IDs and listeners; discard only empty layout wrappers.
    for(const node of body.querySelectorAll(':scope > .msw-processing-fields'))if(!node.children.length)node.remove();
    for(const label of panel.querySelectorAll('.msw-processing-fields > label'))label.classList.add('media-settings-field');
  }
})(window);
