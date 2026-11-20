// Local ASR additions use the MSW queue form and existing tools navigation.
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const launcher = window.MSWLauncher;
  const labels = [
    ["FireRed 标点", "FireRed punctuation"], ["不使用", "None"], ["使用 ct-punc（需下载）", "ct-punc (download required)"],
    ["识别后补齐字词时间码", "Fill word timestamps after ASR"], ["不额外对齐", "No additional alignment"],
    ["只为本次识别结果补齐时间码，不修改其他轨道。", "Align only the newly recognized source text; existing translations are preserved."],
    ["扫描对齐模型", "Scan alignment models"], ["下载所选对齐模型", "Download selected aligner"], ["取消下载", "Cancel download"],
    ["字词时间码对齐", "Word timestamp alignment"], ["字幕工程或 SRT", "Subtitle project or SRT"],
    ["目标字幕轨", "Target subtitle track"], ["先选择输入文件", "Choose an input file first"],
    ["对应媒体", "Matching media"], ["对应音轨（从 0 起）", "Matching audio stream (0-based)"],
    ["对齐模型", "Alignment model"], ["处理方式", "Mode"], ["仅补齐缺失时间码", "Fill missing timestamps"],
    ["重新生成并覆盖已有时间码", "Regenerate and replace existing timestamps"],
    ["开始对齐", "Start alignment"], ["取消对齐", "Cancel alignment"], ["字幕对比工具", "Subtitle comparison tools"],
    ["在浏览器本地读取文件，按实际轨道比较；不上传、不修改原文件。", "Compare selected tracks locally in your browser, without uploading or modifying files."],
    ["转写文本对比", "Transcription comparison"], ["字词时间码查看与对比", "View and compare word timestamps"],
    ["字词时间码", "Word timestamps"], ["字幕对比", "Subtitle comparison"],
    ["运行环境版本与组件", "Runtime version and components"], ["刷新组件清单", "Refresh component inventory"],
    ["选择要处理的字幕轨道，以及与文本匹配的媒体和音轨。默认只补齐缺失时间码并输出新工程；覆盖已有时间码请选择“重新生成”。",
      "Choose a subtitle track and matching media/audio stream. Fill missing timestamps and save a new project, or choose Regenerate to replace existing timestamps."],
    ["管理对齐模型", "Manage alignment models"], ["对齐模型目录（可选）", "Alignment model folder (optional)"],
    ["运行环境设置", "Runtime settings"],
  ];
  const text = (zh, en) => document.documentElement.lang.startsWith('en') ? en : zh;
  const call = (method, payload = {}) => launcher.callBackend(method, payload);
  const storage = globalThis.MSWConfig?.storage || localStorage;
  const optionsKey = 'msw.local-asr-options';
  const alignmentPaths = Object.create(null);
  let modelsById = new Map();
  let sharedInventory = null;
  let scanRevision = 0;
  let download = null;

  function syncModelPaths() {
    $('alignmentModelPath').value = alignmentPaths[$('alignmentModel').value] || '';
    $('alignmentModelPath').disabled = !$('alignmentModel').value;
    $('alignmentDownloadPath').value = alignmentPaths[$('alignmentDownloadModel').value] || '';
  }

  try {
    const saved = JSON.parse(storage.getItem(optionsKey) || '{}');
    for (const key of ['fireredPunc', 'alignmentModel']) {
      if (typeof saved[key] === 'string') $(key).value = saved[key];
    }
    for (const option of $('alignmentDownloadModel').options) {
      const value = saved.alignmentModelPaths?.[option.value] ??
        (option.value === $('alignmentModel').value ? saved.alignmentModelPath : '');
      if (typeof value === 'string' && value) alignmentPaths[option.value] = value;
    }
  } catch { /* Older settings remain usable. */ }
  syncModelPaths();

  function saveAlignmentOptions() {
    storage.setItem(optionsKey, JSON.stringify({
      fireredPunc: $('fireredPunc').value,
      alignmentModel: $('alignmentModel').value,
      alignmentModelPaths: alignmentPaths,
    }));
  }

  function localVisibility() {
    const local = $('provider').value === 'local';
    $('fireredPunc').closest('.field').classList.toggle('hidden', !local || $('model').value !== 'firered-asr2-ctc-local');
  }

  function modelStatus(model) {
    if (!model) return text('等待扫描', 'Waiting for scan');
    if (model.status === 'path_invalid') return text('指定目录无有效模型', 'No valid model in the selected folder');
    const installed = model.installed ? text('已下载', 'Downloaded') : text('未下载', 'Not downloaded');
    const weight = model.installedSize ? `${installed} · ${model.installedSize}` : installed;
    if (model.runtimeAvailable) return `${weight} · ${text('运行环境就绪', 'Runtime ready')}`;
    const components = sharedInventory?.components || [];
    const missing = components.length ? (model.runtimePackages || []).filter(name =>
      components.some(item => item.name === name && !item.installed)) : model.missingRuntimePackages || [];
    if (missing.length) return `${weight} · ${text('缺少依赖', 'Missing dependencies')} ${missing.join(', ')}`;
    const runtime = sharedInventory?.runtimeVersionInstalled && sharedInventory.runtimeVersionInstalled !== sharedInventory.runtimeVersionExpected
      ? text('运行环境需要升级', 'Runtime needs an upgrade')
      : text('运行环境不可用', 'Runtime unavailable');
    return `${weight} · ${runtime}`;
  }

  function renderAlignmentModels() {
    const list = $('alignmentModelsInventory');
    list.replaceChildren(...[...modelsById.values()].map(model => {
      const item = document.createElement('li');
      item.textContent = `${model.label || model.id} · ${modelStatus(model)}`;
      return item;
    }));
    for (const [select, target] of [['alignmentModel', 'recognitionAlignmentStatus'], ['timestampModel', 'timestampAlignmentStatus']]) {
      const id = $(select).value;
      const model = modelsById.get(id);
      $(target).textContent = id ? modelStatus(model) : '';
      $(target).className = `local-status ${model?.installed && model.runtimeAvailable ? 'ready' : 'warn'}`;
    }
    const model = modelsById.get($('alignmentDownloadModel').value);
    $('prepareAlignmentModel').disabled = Boolean(download) || !model || !model.runtimeAvailable ||
      model.installed || model.status === 'path_invalid';
    $('alignmentDownloadModel').disabled = Boolean(download);
    $('alignmentDownloadPath').disabled = Boolean(download);
    $('cancelAlignmentModel').hidden = !download;
    $('cancelAlignmentModel').disabled = !download?.started || download.cancelling;
  }

  function localize() {
    document.querySelectorAll('[data-msw5]').forEach(node => { node.textContent = text(...labels[Number(node.dataset.msw5)]); });
    $('alignmentModelPath').placeholder = text(...labels[31]);
    renderAlignmentModels();
  }

  async function scanModels({ explicit = false } = {}) {
    const revision = ++scanRevision;
    if (explicit && !download) $('alignmentModelsStatus').textContent = text('正在扫描对齐模型……', 'Scanning alignment models…');
    try {
      const result = await call('get_alignment_models', { modelPaths: { ...alignmentPaths } });
      if (revision !== scanRevision) return;
      if (!result.ok) throw new Error(result.detail || result.error || text('读取模型状态失败', 'Could not read alignment model status'));
      modelsById = new Map((result.models || []).map(model => [model.id, model]));
      sharedInventory = result.runtimeInventory || null;
      launcher.setLocalRuntimeInventory(sharedInventory);
      $('runtimeInventory').textContent = (sharedInventory?.components || [])
        .map(item => `${item.installed ? '✓' : '—'} ${item.name}`).join('\n');
      renderAlignmentModels();
      if (explicit && !download) $('alignmentModelsStatus').textContent = '';
    } catch (error) {
      if (revision === scanRevision && !download) $('alignmentModelsStatus').textContent = error.message;
    }
  }

  function openModelManager(select) {
    if (select.value && !download) $('alignmentDownloadModel').value = select.value;
    syncModelPaths();
    renderAlignmentModels();
    launcher.openSettings('alignmentModelsSettings', 'alignmentDownloadModel', { sharedRuntime: true });
  }

  function rememberAlignmentPath(select, field) {
    if (!select.value) return;
    alignmentPaths[select.value] = field.value.trim();
    syncModelPaths();
    saveAlignmentOptions();
    void scanModels();
  }

  function finishDownload(message) {
    download = null;
    $('alignmentModelsStatus').textContent = message;
    renderAlignmentModels();
    void scanModels();
  }

  $('provider').addEventListener('change', localVisibility);
  $('model').addEventListener('change', localVisibility);
  $('fireredPunc').addEventListener('change', saveAlignmentOptions);
  $('alignmentModel').addEventListener('change', () => {
    syncModelPaths();
    saveAlignmentOptions();
    renderAlignmentModels();
    void scanModels();
  });
  $('alignmentModelPath').addEventListener('change', () => rememberAlignmentPath($('alignmentModel'), $('alignmentModelPath')));
  $('timestampModel').addEventListener('change', renderAlignmentModels);
  $('alignmentDownloadModel').addEventListener('change', () => { syncModelPaths(); renderAlignmentModels(); });
  $('alignmentDownloadPath').addEventListener('change', () => rememberAlignmentPath($('alignmentDownloadModel'), $('alignmentDownloadPath')));
  $('manageRecognitionAlignment').onclick = () => openModelManager($('alignmentModel'));
  $('manageTimestampAlignment').onclick = () => openModelManager($('timestampModel'));
  $('openAlignmentRuntime').onclick = () => launcher.openSettings('localRuntimePanel', '', { sharedRuntime: true });
  $('refreshAlignmentModels').onclick = () => void scanModels({ explicit: true });
  $('refreshRuntimeInventory').onclick = () => void scanModels();
  $('refreshLocalRuntime').addEventListener('click', () => void scanModels());
  $('prepareAlignmentModel').onclick = async () => {
    if (download) return;
    const modelId = $('alignmentDownloadModel').value;
    const task = { modelId, started: false, cancelling: false };
    download = task;
    $('alignmentModelsStatus').textContent = text('正在准备对齐模型……', 'Preparing alignment model…');
    renderAlignmentModels();
    try {
      const result = await call('prepare_alignment_model', { modelId, modelPath: alignmentPaths[modelId] || '' });
      if (download !== task) return;
      if (result.alreadyInstalled) finishDownload(text('模型已下载。', 'Model already downloaded.'));
      else if (!result.ok) finishDownload(result.detail || result.error || text('无法开始下载', 'Could not start the download'));
      else { task.started = true; renderAlignmentModels(); }
    } catch (error) {
      if (download === task) finishDownload(error.message);
    }
  };
  $('cancelAlignmentModel').onclick = async () => {
    const task = download;
    if (!task?.started || task.cancelling) return;
    task.cancelling = true;
    renderAlignmentModels();
    try {
      const result = await call('cancel_alignment_model');
      if (download !== task) return;
      if (result.ok && result.cancelling) {
        $('alignmentModelsStatus').textContent = text('正在取消下载……', 'Cancelling download…');
        return;
      }
      if (result.ok) finishDownload(text('下载已结束。', 'Download has ended.'));
      else throw new Error(result.detail || result.error || text('取消失败', 'Could not cancel'));
    } catch (error) {
      if (download !== task) return;
      task.cancelling = false;
      $('alignmentModelsStatus').textContent = error.message;
      renderAlignmentModels();
    }
  };
  document.addEventListener('mswlauncherbackend', ({ detail: event }) => {
    if (['localRuntimeReady', 'localRuntimeCancelled'].includes(event.type) ||
        ['local_runtime_install_failed', 'local_runtime_cancelled'].includes(event.code)) void scanModels();
    if (!download || (event.modelId && event.modelId !== download.modelId)) return;
    if (event.type === 'alignmentModelProgress' && !download.cancelling) $('alignmentModelsStatus').textContent = event.message || '';
    if (event.type === 'alignmentModelPrepared') finishDownload(text('模型下载完成。', 'Model download complete.'));
    if (event.type === 'alignmentPrepareCancelled') finishDownload(text('已取消下载。', 'Download cancelled.'));
    if (event.code === 'alignment_prepare_failed') finishDownload(event.detail || text('下载失败', 'Download failed'));
  });
  document.addEventListener('mswlanguage', localize);
  document.addEventListener('mswlocalruntimepath', () => void scanModels());
  window.addEventListener('mawlauncherready', () => void scanModels(), { once: true });
  window.addEventListener('msw:launcher-settings-tab', event => {
    if (event.detail.tab === 'runtime' && launcher.config) void scanModels();
  });
  localize();

  let inspectRevision = 0;
  let inspectedPath = '';
  let inputSupported = false;
  let alignmentRunning = false;
  $('runTimestampTool').disabled = true;
  async function inspectInput() {
    const path = $('timestampInput').value.trim();
    if (path && path === inspectedPath) return inputSupported;
    const revision = ++inspectRevision;
    inspectedPath = ''; inputSupported = false;
    $('timestampTrack').replaceChildren();
    $('runTimestampTool').disabled = true;
    $('timestampResult').textContent = '';
    if (!path) return false;
    try {
      const result = await call('inspect_alignment_input', { path });
      if (revision !== inspectRevision || path !== $('timestampInput').value.trim()) return false;
      if (!result.ok) { $('timestampResult').textContent = result.error || '无法读取输入'; return false; }
      inspectedPath = path;
      inputSupported = result.alignment?.supported !== false;
      $('timestampTrack').replaceChildren(...result.tracks.map(track => {
        const option = new Option(track.label, track.id);
        option.disabled = track.locked === true || track.enabled === false || track.editableSubtitleCount === 0;
        return option;
      }));
      const firstAvailable = [...$('timestampTrack').options].find(option => !option.disabled);
      if (firstAvailable) $('timestampTrack').value = firstAvailable.value;
      inputSupported = inputSupported && Boolean(firstAvailable);
      $('timestampTrack').disabled = !inputSupported;
      $('runTimestampTool').disabled = !inputSupported || alignmentRunning;
      $('timestampResult').textContent = result.alignment?.reason || '';
      return inputSupported;
    } catch (error) {
      if (revision === inspectRevision) $('timestampResult').textContent = error.message;
      return false;
    }
  }
  $('timestampInput').addEventListener('input', () => {
    ++inspectRevision; inspectedPath = ''; inputSupported = false;
    $('timestampTrack').replaceChildren(); $('runTimestampTool').disabled = true;
    $('timestampResult').textContent = '';
  });
  $('timestampInput').addEventListener('change', () => void inspectInput());
  for (const [button, field, kind] of [['pickTimestampInput', 'timestampInput', 'subtitle'], ['pickTimestampMedia', 'timestampMedia', 'media']]) {
    $(button).onclick = async () => { const result = await call('choose_file', { kind }); if (result.ok) { $(field).value = result.path || ''; if (field === 'timestampInput') await inspectInput(); } };
  }
  $('runTimestampTool').onclick = async () => {
    if (alignmentRunning || !await inspectInput()) return;
    const path = $('timestampInput').value.trim(), mediaPath = $('timestampMedia').value.trim();
    const audioText = $('timestampAudio').value, targetTrack = $('timestampTrack').value;
    if (!path || (targetTrack !== 'main' && (!mediaPath || audioText === ''))) {
      $('timestampResult').textContent = '请选择输入；所选字幕轨道需明确指定匹配音频和音轨。'; return;
    }
    alignmentRunning = true;
    $('runTimestampTool').disabled = true;
    $('timestampResult').textContent = '正在对齐，原工程保持不变…';
    try {
      const result = await call('run_timestamp_alignment', {
        projectPath: /\.(mosp|json)$/i.test(path) ? path : '', srtPath: /\.srt$/i.test(path) ? path : '',
        mediaPath, targetTrack, audioIndex: audioText === '' ? null : Number(audioText),
        modelId: $('timestampModel').value, modelPath: alignmentPaths[$('timestampModel').value] || '', alignmentMode: $('timestampMode').value,
      });
      $('timestampResult').textContent = result.ok ? `${result.projectPath}\n成功 ${result.report?.alignedSegments || 0} 段；跳过 ${result.report?.skippedSegments || 0} 段；失败 ${result.report?.failedSegments || 0} 段\n${(result.warnings || []).join('\n')}` : result.detail || result.error || '对齐失败';
    } catch (error) { $('timestampResult').textContent = error.message; }
    finally { alignmentRunning = false; $('runTimestampTool').disabled = !inputSupported; }
  };
  $('cancelTimestampTool').onclick = () => void call('cancel_media_tool');
  document.querySelectorAll('[data-comparison-tool]').forEach(button => button.onclick = async () => {
    const result = await call('open_comparison_tool', { tool: button.dataset.comparisonTool });
    $('comparisonResult').textContent = result.ok ? '' : result.error || '打开失败';
  });
  localVisibility();
})();
