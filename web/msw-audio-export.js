// Non-modal offline audio export UI; rendering owns an immutable job snapshot.
(function (global) {
  'use strict';
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
    let context = null, busy = null, pending = null, timer = null, polling = false, jobs = [], rendered = '', contextRequest = 0;
    const terminal = new Set(['succeeded', 'failed', 'cancelled', 'interrupted']);
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
    function selectedOptions() {
      const custom = el('audio-export-range').value === 'custom';
      const numeric = id => el(id).value.trim() ? Number(el(id).value) : NaN;
      const settings = core.options({ mode: el('audio-export-mode').value, sample_rate: Number(el('audio-export-rate').value),
        duration_ms: host.audioExportDuration(), start_ms: custom ? Math.round(numeric('audio-export-start-time') * 1000) : 0,
        end_ms: custom ? Math.round(numeric('audio-export-end-time') * 1000) : null,
        remove_gaps: el('audio-export-remove-gaps').checked, source_audio_index: Number(el('audio-export-stream').value || 0),
        source_gain_db: numeric('audio-export-source-gain'), voice_gain_db: numeric('audio-export-voice-gain'), peak_protection: el('audio-export-peak').checked });
      if (video) {
        settings.format = format;
        settings.video_tail = el('audio-export-tail').value;
        settings.video_encoding = el('audio-export-encoding').value;
        settings.burn_subtitles = el('audio-export-burn-subtitles').value;
        settings.duration_ms = Math.max(settings.duration_ms, context?.duration_ms || 0);
        if (settings.video_tail === 'truncate' && context?.video) {
          settings.end_ms = Math.min(settings.end_ms ?? Infinity, context.video.duration_ms);
        }
      }
      if (timeline) {
        settings.format = format;
        settings.collect_media = el('audio-export-collect-media').checked;
        settings.duration_ms = Math.max(settings.duration_ms, context?.duration_ms || 0);
      }
      return settings;
    }
    const sourceAvailable = () => Boolean(context?.source_available && context.media_reference === host.data.media);
    function update() {
      const mix = el('audio-export-mode').value === 'mix';
      el('audio-export-source').hidden = !mix;
      el('audio-export-custom').hidden = el('audio-export-range').value !== 'custom';
      el('audio-export-start').textContent = t(pending ? '确认上次导出请求' : '开始导出');
      el('audio-export-start').disabled = Boolean(busy) || !available || !context?.available;
      el('audio-export-gap-hint').textContent = t(host.data.msw?.audio_settings?.gap_policy === 'follow'
        ? '移除空隙时，配音随媒体一起裁切。' : '移除空隙时，保留未静音贴片覆盖的区间。');
      try {
        const o = selectedOptions(), plan = core.compile(host.audioExportPreview(), o);
        if ((mix || video) && !sourceAvailable()) throw Error('原媒体尚未由本机服务接管，请保存并在本机服务中重新打开工程');
        if (video && context && !context.video) throw Error('原媒体没有可导出的视频画面，请使用导出音频');
        if (video && context?.video && plan.source_end_ms > context.video.duration_ms && o.video_tail === 'ask') {
          throw Error('导出范围超出画面尾部，请选择截断到画面结尾或定格延长画面');
        }
        if (video && o.burn_subtitles !== 'none') {
          const groups = [host.data.segments || [], host.data.multi_subtitle?.tracks?.[0]?.segments || []];
          const candidates = o.burn_subtitles === 'main' ? groups[0] : o.burn_subtitles === 'secondary' ? groups[1] : groups.flat();
          if (!candidates.some(c => !c.disabled && c.text?.trim() && plan.intervals.some(k => c.start < k.end_ms && c.end > k.start_ms))) {
            throw Error('导出范围内没有所选轨道的可压制字幕');
          }
        }
        if (!video && !timeline && !mix && !plan.pieces.length) throw Error('导出范围内没有可发声的音频贴片');
        if (plan.sample_count * 4 + 44 > 0xFFFFFF00) throw Error('WAV 将超过 4 GB，请分段导出');
        el('audio-export-summary').textContent = `${t('成品时长')} ${(plan.sample_count / plan.sample_rate).toFixed(3)} s · `
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
    function renderJobs() {
      const key = JSON.stringify(jobs) + token(); if (key === rendered) return; rendered = key;
      const focused = document.activeElement?.closest(`#${kind}-export-jobs button`);
      const focusId = focused?.dataset.jobId, focusAction = focused?.dataset.action;
      const fragment = document.createDocumentFragment();
      for (const job of jobs) {
        const card = document.createElement('article'); card.className = 'msw-processing-job'; card.dataset.jobId = job.id;
        const title = document.createElement('strong');
        title.textContent = t(job.mode === 'mix' ? '原声 + 配音混音' : '配音轨（仅音频贴片）');
        if (video) title.textContent = `${t('导出视频')} · ${title.textContent}`;
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
          if (video) note.textContent += ` · ${t(result.video_encoding === 'copy' ? '画面直接复制' : '画面已重新编码')}`;
          if (video && result.burn_subtitles && result.burn_subtitles !== 'none') note.textContent += ` · ${t('已压制字幕')}`;
          if (timeline && result.external_media) note.textContent += ` · ${t('原视频仍引用本机文件')}`;
          card.append(note);
          actions.append(action('下载 WAV', job, async () => {
            const data = await request(`audio-exports/${job.id}/download`, { project_id: job.project_id });
            const link = document.createElement('a'); link.href = data.url;
            link.download = video ? 'msw-video.mp4' : timeline ? 'msw-timeline.otioz' : job.mode === 'mix' ? 'msw-mix.wav' : 'msw-voice.wav';
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
      if (focusId && focusAction) [...el('audio-export-jobs').querySelectorAll('button')]
        .find(b => b.dataset.jobId === focusId && b.dataset.action === focusAction)?.focus({ preventScroll: true });
    }
    function schedule(delay = 1200) { clearTimeout(timer); timer = setTimeout(poll, delay); }
    async function poll() {
      if (!available || polling) { if (available) schedule(); return; }
      const id = projectId(), generation = host.generation; polling = true;
      try {
        const data = await request(`audio-exports?project_id=${encodeURIComponent(id)}`);
        if (generation !== host.generation || id !== projectId()) return;
        const filtered = data.jobs.filter(j => (j.format || 'wav') === format);
        const completed = filtered.some(j => j.status === 'succeeded' && jobs.some(old => old.id === j.id && !terminal.has(old.status)));
        jobs = filtered; renderJobs();
        if (completed && !floating.isOpen()) host.flashHint(t(timeline ? '剪辑工程导出完成，可在「更多导出 → OTIO」下载 OTIOZ' : '音频导出完成，可在「文件 → 导出音频」下载 WAV'), 'success');
      } catch (error) { if (floating.isOpen() && generation === host.generation) message(error.message, true); }
      finally { polling = false; if (floating.isOpen() || jobs.some(j => !terminal.has(j.status))) schedule(); }
    }
    async function start() {
      if (busy) return;
      const generation = host.generation, ticket = {}; busy = ticket;
      try {
        if (!pending) {
          const project = host.exportProject();
          for (const key of ['waveform', 'spectral', 'waveform_reapeaks']) delete project[key];
          const options = selectedOptions(); core.compile(project, options);
          pending = { project, options, plan_schema: core.VERSION, project_id: projectId(), client_token: token(),
            request_key: global.MSWProject.id('export-request'), binding: host.config.processingContext?.binding };
        }
        update();
        const result = await request('audio-exports', pending);
        if (generation !== host.generation || busy !== ticket) return;
        pending = null;
        jobs = [result.job, ...jobs.filter(j => j.id !== result.job.id)]; renderJobs();
        message('音频导出已开始；可继续编辑，关闭面板不会取消任务'); schedule(0);
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
      el('audio-export-remove-gaps').checked = host.audioExportPreview().gap_remove?.skip_playback === true;
      el('audio-export-end-time').value = String(Math.max(.001, host.audioExportDuration() / 1000));
      floating.open(); update(); void loadContext(); schedule(0);
    });
    el('audio-export-close').addEventListener('click', () => floating.close());
    el('audio-export-start').addEventListener('click', () => void start());
    for (const input of panel.querySelectorAll('input, select')) input.addEventListener('input', update);
    global.addEventListener('msw:audio-changed', () => { if (floating.isOpen()) update(); });
    global.addEventListener('msw:project-changed', () => {
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
      for (const attr of ['id', 'for', 'aria-labelledby']) {
        if (node.hasAttribute(attr)) node.setAttribute(attr, node.getAttribute(attr).replaceAll('audio-export-', `${kind}-export-`));
      }
    }
    copy.querySelector(`#${kind}-export-title`).textContent = kind === 'video' ? '导出视频' : '配音剪辑工程（OTIOZ）';
    copy.querySelector(`#${kind}-export-close`).setAttribute('aria-label', kind === 'video' ? '关闭视频导出' : '关闭剪辑工程导出');
    copy.querySelector('section').setAttribute('aria-label', kind === 'video' ? '视频导出任务' : '剪辑工程导出任务');
    copy.querySelector(`#${kind}-export-mode`).value = 'mix';
    copy.querySelector(`#${kind}-export-format-hint`).replaceWith(document.getElementById(`${kind}-export-fields`).content.cloneNode(true));
    blueprint.after(copy);
  }
  mount('audio');
  mount('video');
  mount('timeline');
})(window);
