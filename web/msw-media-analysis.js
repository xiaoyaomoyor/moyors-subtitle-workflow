(function (global) {
  'use strict';
  const host = global.MSWE.resolve('processing-host'), media = global.MSWE.resolve('media');
  if (!host || !media?.available()) return;
  const byId = id => document.getElementById(`msw-${id}`);
  const tasks = new Map();
  const terminal = new Set(['succeeded', 'failed', 'cancelled', 'interrupted']);
  const auto = byId('waveform-auto'), track = byId('source-track');
  const confirmTrack = document.createElement('button');
  confirmTrack.type = 'button'; confirmTrack.hidden = true;
  confirmTrack.textContent = '确认使用此源音轨';
  track.after(confirmTrack);
  confirmTrack.addEventListener('click', () => void media.changeTrack(Number(track.value)));
  // 默认开启「自动波形」：清掉历史遗留的关闭记录，每次加载都默认勾选。
  if (localStorage.getItem('msw.waveform.auto') === 'false') localStorage.removeItem('msw.waveform.auto');
  auto.checked = localStorage.getItem('msw.waveform.auto') !== 'false';
  byId('waveform-auto-label').hidden = false;
  byId('analysis-unavailable').hidden = true;
  byId('analysis-controls').hidden = false;
  function status(kind, text) {
    const node = byId(`${kind}-status`);
    if (kind === 'waveform' && media.current?.track_conflict && !text.includes('冲突')) {
      text = `公共音轨与旧 MSW 音轨记录冲突，请确认源音轨后再识别${text ? ' · ' + text : ''}`;
    }
    node.textContent = text; node.hidden = !text;
  }
  const valid = action => tasks.get(action.kind) === action && action.generation === host.generation
    && media.current?.id === action.media.id;
  function controls(kind, running) {
    byId(`${kind}-cancel`).hidden = !running;
    byId(`${kind}-generate`).hidden = !media.current;
    byId(`${kind}-generate`).disabled = running || (kind === 'waveform' && !media.current?.metadata.audio_tracks?.length);
    byId(`${kind}-generate`).textContent = kind === 'waveform' && host.data.waveform ? '重新生成波形' : kind === 'waveform' ? '生成波形' : '生成播放代理';
  }
  async function cancel(kind, quiet = false) {
    const action = tasks.get(kind);
    if (!action) return;
    tasks.delete(kind); clearTimeout(action.timer);
    if (action.job) void media.request('media-analysis-cancel', {...action.scope, job_id: action.job.id}).catch(() => {});
    controls(kind, false);
    if (!quiet) status(kind, kind === 'waveform' ? '波形已取消；可继续编辑' : '代理已取消；可继续处理源媒体');
  }
  async function poll(action) {
    if (!valid(action)) return;
    try {
      const query = new URLSearchParams({project_id: action.scope.project_id, job_id: action.job.id});
      const result = await media.request(`media-analysis?${query}`);
      if (!valid(action)) return;
      action.job = result.job;
      if (!terminal.has(result.job.status)) {
        status(action.kind, action.kind === 'waveform' ? `解析波形 ${result.job.progress}%` : '正在生成播放代理…');
        action.timer = setTimeout(() => void poll(action), 500); return;
      }
      if (result.job.status === 'succeeded') {
        const output = await media.request(`media-analysis-result?${query}`);
        if (!valid(action)) return;
        if (action.kind === 'waveform') {
          host.applyWaveform(output.waveform, output); status(action.kind, '波形已就绪');
        } else {
          const playable = await host.previewProxy(action.media, output.url);
          if (!valid(action)) return;
          status(action.kind, playable ? '播放代理已就绪' : '播放代理无法预览，可继续处理源媒体');
        }
      } else status(action.kind, result.job.error || '媒体分析已取消');
      tasks.delete(action.kind); controls(action.kind, false);
    } catch (error) {
      if (valid(action)) { tasks.delete(action.kind); controls(action.kind, false); status(action.kind, error.message); }
    }
  }
  async function start(kind, force = false) {
    if (!media.current) return;
    await cancel(kind, true);
    const action = {kind, generation: host.generation, media: media.current, scope: media.payload(), job: null};
    tasks.set(kind, action); controls(kind, true); status(kind, '正在准备媒体分析…');
    try {
      const result = await media.request('media-analysis', {...action.scope, media_id: action.media.id, kind, force});
      action.job = result.job;
      if (!valid(action)) {
        await media.request('media-analysis-cancel', {...action.scope, job_id: result.job.id}).catch(() => {}); return;
      }
      void poll(action);
    } catch (error) {
      if (valid(action)) { tasks.delete(kind); controls(kind, false); status(kind, error.message); }
    }
  }
  function ready(event) {
    const source = event.detail;
    byId('analysis-source').textContent = source.name;
    for (const kind of ['waveform', 'proxy']) { void cancel(kind, true); controls(kind, false); status(kind, ''); }
    track.replaceChildren();
    for (const item of source.metadata.audio_tracks || []) {
      const option = document.createElement('option'); option.value = item.audio_index;
      option.textContent = `源音轨 ${item.audio_index + 1}${item.title ? ` · ${item.title}` : ''}${item.language ? ` (${item.language})` : ''}`;
      track.append(option);
    }
    track.value = source.audio_index; track.hidden = !track.options.length;
    byId('source-track-field').hidden = track.hidden;
    confirmTrack.hidden = !source.track_conflict;
    if (!track.options.length) status('waveform', '无音轨；可继续编辑或使用 TTS');
    else if (host.data.waveform?.audio_track === source.audio_index && host.data.waveform?.source?.size === source.stamp[0]
      && host.data.waveform?.source?.modified_ms === Math.floor(source.stamp[1] / 1e6)) status('waveform', '使用已有波形');
    else if (auto.checked) void start('waveform');
    else status('waveform', '自动波形已关闭；使用占位波形');
    if (source.track_conflict) status('waveform', '公共音轨与旧 MSW 音轨记录冲突，请确认源音轨后再识别');
    if (source.needs_proxy) { host.suspendSourcePlayback(); void start('proxy'); }
  }
  track.addEventListener('change', async () => {
    track.disabled = true;
    await media.changeTrack(Number(track.value));
    track.value = media.current?.audio_index ?? 0; track.disabled = false;
  });
  auto.addEventListener('change', () => {
    localStorage.setItem('msw.waveform.auto', String(auto.checked));
    if (auto.checked) void start('waveform'); else void cancel('waveform');
  });
  for (const kind of ['waveform', 'proxy']) {
    byId(`${kind}-generate`).addEventListener('click', () => void start(kind, true));
    byId(`${kind}-cancel`).addEventListener('click', () => void cancel(kind));
  }
  global.addEventListener('msw:media-changed', ready);
  let toolsLoading = false, toolsReadOnly = true, toolsDirty = false, toolsSaving = false;
  byId('tools-unavailable').hidden = true; byId('tools-controls').hidden = false;
  byId('tools-path').addEventListener('input', () => {toolsDirty = true;});
  async function loadTools() {
    if (toolsLoading || toolsSaving || toolsDirty) return;
    toolsLoading = true; byId('tools-save').disabled = true; byId('tools-path').disabled = true;
    byId('tools-status').textContent = '正在读取工具配置…';
    try {
      const result = await media.request('media-tools');
      toolsReadOnly = result.read_only;
      byId('tools-path').value = result.ffmpeg_path;
      byId('tools-status').textContent = result.read_only ? '路径由启动环境设置。' : result.ready ? 'FFmpeg 与 FFprobe 已就绪。' : '未找到完整媒体工具。';
    } catch (error) { toolsReadOnly = true; byId('tools-status').textContent = error.message; }
    finally {toolsLoading = false; byId('tools-save').disabled = toolsReadOnly; byId('tools-path').disabled = toolsReadOnly;}
  }
  byId('tools-open').addEventListener('click', () => host.openMediaToolsEnvironment());
  global.addEventListener('msw:settings-opened', () => void loadTools());
  byId('tools-save').addEventListener('click', async () => {
    if (toolsReadOnly || toolsSaving || toolsLoading) return;
    toolsSaving = true; byId('tools-save').disabled = true; byId('tools-path').disabled = true;
    try {
      const result = await media.request('media-tools', {ffmpeg_path: byId('tools-path').value});
      toolsDirty = false; toolsReadOnly = result.read_only;
      byId('tools-status').textContent = '已保存；可重新导入媒体以刷新音轨信息。';
    } catch (error) { byId('tools-status').textContent = error.message; }
    finally { toolsSaving = false; byId('tools-save').disabled = toolsReadOnly; byId('tools-path').disabled = toolsReadOnly; }
  });
  global.addEventListener('msw:media-ready', ready);
  global.addEventListener('msw:project-changed', () => {
    for (const kind of ['waveform', 'proxy']) { void cancel(kind, true); controls(kind, false); status(kind, ''); }
    track.hidden = true;
    confirmTrack.hidden = true;
    byId('source-track-field').hidden = true;
    byId('analysis-source').textContent = '导入媒体后可生成波形或播放代理。';
  });
  global.MSWE.register('media-analysis', () => ({start, cancel, get tasks() { return [...tasks.values()].map(item => item.job); }}));
})(window);
