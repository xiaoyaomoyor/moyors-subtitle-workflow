// Independent inputs and lifecycle; cache generation is shared with prefab tasks.
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const call = (name, value) => window.MSWLauncher.callBackend(name, value);
  const t = key => window.MSWLauncher.translate(key);
  let busy = false, taskId = '', project = '', probeToken = 0, pending = [], dropField = 'waveToolInput';
  function status(message, error = false) {
    $('waveToolStatus').textContent = message;
    $('waveToolStatus').classList.toggle('error', error);
  }
  function setBusy(value) {
    busy = value;
    $('waveformToolPanel').querySelectorAll('input, select, button').forEach(node => { node.disabled = value; });
    $('waveToolStop').disabled = value && !taskId;
    $('waveToolStop').classList.toggle('hidden', !value);
    $('waveToolStart').classList.toggle('hidden', value);
    $('waveToolProgress').classList.toggle('hidden', !value);
    $('waveToolOpen').classList.toggle('hidden', !project || value);
    $('waveToolFolder').classList.toggle('hidden', !project || value);
  }
  async function inspect() {
    const token = ++probeToken;
    const path = $('waveToolMedia').value.trim() || $('waveToolInput').value.trim();
    $('waveToolTrack').replaceChildren();
    if (!path) return;
    try {
      const result = await call('inspect_queue_inputs', { paths: [path] });
      if (token !== probeToken) return;
      const item = result.items?.[0];
      if (!item?.ok) throw Error(item?.error || result.error || t('failed'));
      if (!['media', 'project'].includes(item.kind)) throw Error(t('waveform_tool_input'));
      for (const track of item.audioTracks || []) {
        const option = new Option(`${Number(track.audio_index) + 1} · ${track.language || track.codec || 'audio'}`, String(track.audio_index));
        option.selected = item.audioTrack != null ? item.audioTrack === track.audio_index : Boolean(track.default);
        $('waveToolTrack').add(option);
      }
      status((item.warnings || []).join(' · '));
    } catch (error) { if (token === probeToken) status(error.message, true); }
  }
  function onEvent(event) {
    if (!busy) return;
    if (!taskId) { pending.push(event); return; }
    if (event.taskId !== taskId) return;
    if (event.status === 'running' || event.status === 'progress') { status(event.message || t('waveform_tool_running')); return; }
    project = event.status === 'completed' ? event.projectPath || '' : '';
    status(event.status === 'completed' ? [t('waveform_done'), project, ...(event.warnings || [])].join('\n') : event.status === 'cancelled' ? t('waveform_cancelled') : event.error || t('failed'), event.status === 'failed');
    setBusy(false);
  }
  function acceptDrop(path) {
    if (window.MSWNavigation.current() !== 'tools' || window.MSWTools.current() !== 'waveform') return false;
    if (!busy && path) { $(dropField).value = path; if (dropField === 'waveToolInput') $('waveToolMedia').value = ''; dropField = 'waveToolInput'; void inspect(); }
    return true;
  }
  function initialize() {
    $('waveformToolPanel').addEventListener('dragenter', event => { dropField = event.target.closest('#waveToolMedia') ? 'waveToolMedia' : 'waveToolInput'; });
    for (const [button, field, kind] of [['waveToolPick','waveToolInput','waveform'], ['waveToolPickMedia','waveToolMedia','media'], ['waveToolPickDirectory','waveToolDirectory','folder']]) {
      $(button).addEventListener('click', async () => {
        try {
          const result = await call(kind === 'folder' ? 'choose_folder' : 'choose_file', { kind, multiple: false });
          if (!result.ok) throw Error(result.error || t('failed'));
          if (result.path) { $(field).value = result.path; if (field === 'waveToolInput') $('waveToolMedia').value = ''; if (kind !== 'folder') await inspect(); }
        } catch (error) { status(error.message, true); }
      });
    }
    ['waveToolInput','waveToolMedia'].forEach(id => $(id).addEventListener('change', () => { project = ''; setBusy(false); void inspect(); }));
    $('waveToolStart').addEventListener('click', async () => {
      project = ''; taskId = ''; pending = []; ++probeToken; setBusy(true); status(t('waveform_tool_running'));
      try {
        const result = await call('start_waveform_tool', { path: $('waveToolInput').value.trim(), mediaPath: $('waveToolMedia').value.trim(), audioTrack: $('waveToolTrack').value === '' ? null : Number($('waveToolTrack').value), spectral: $('waveToolSpectral').checked, rebuild: $('waveToolCacheMode').value === 'rebuild', directory: $('waveToolDirectory').value.trim() });
        if (!result.ok) throw Error(result.error || result.detail || t('failed'));
        taskId = result.taskId;
        $('waveToolStop').disabled = false;
        const events = pending; pending = []; events.forEach(onEvent);
      } catch (error) { setBusy(false); status(error.message, true); }
    });
    $('waveToolStop').addEventListener('click', async () => {
      if (!taskId) return;
      $('waveToolStop').disabled = true;
      try { const result = await call('cancel_waveform_tool', { taskId }); if (!result.ok) throw Error(result.error || t('failed')); if (busy) status(t('waveform_project_cancelling')); }
      catch (error) { status(error.message, true); $('waveToolStop').disabled = false; }
    });
    $('waveToolOpen').addEventListener('click', () => { if (project) { window.MSWLauncher.setJsonPath(project); window.MSWLauncher.openServerEditor(); } });
    $('waveToolFolder').addEventListener('click', async () => { if (project) { const result = await call('open_containing_folder', { path: project }); if (!result.ok) status(result.error || t('failed'), true); } });
    setBusy(false);
  }
  window.MSWWaveformTool = { onEvent, acceptDrop };
  window.addEventListener('mawlauncherready', initialize, { once: true });
})();
