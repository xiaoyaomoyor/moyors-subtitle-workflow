// Browser preview and backend processing share one committed source identity.
(function (global) {
  'use strict';
  const host = global.MSWE?.resolve('processing-host');
  if (!host) return;
  const available = () => Boolean(host.config?.processingUrl);
  const t = value => global.MSWE_I18N?.translateText?.(value) || value;
  const pageId = global.MSWProject.id('media-page');
  const projectId = () => global.MSWProject.ensure(host.data).project_id;
  let operation = null, current = null;
  const status = document.getElementById('msw-media-progress');
  const cancelButton = document.getElementById('msw-media-cancel');
  function message(text) {
    document.getElementById('msw-source-toolbar').hidden = !available() || !operation;
    status.hidden = !text; status.textContent = t(text);
  }
  function payload(extra = {}) {
    return { project_id: projectId(), binding: host.config.processingContext?.binding,
      client_token: `${pageId}.${host.generation}`, ...extra };
  }
  async function request(route, body = null, signal = null) {
    const response = await fetch(`${host.config.processingUrl}/${route}`, {
      method: body ? 'POST' : 'GET', cache: 'no-store', signal,
      headers: { 'X-MSW-Token': host.config.requestToken, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      const error = Error(result.error || `HTTP ${response.status}`); error.status = response.status; throw error;
    }
    return result;
  }
  function valid(action) { return operation === action && action.generation === host.generation && !action.controller.signal.aborted; }
  async function cancel({ restore = true } = {}) {
    const action = operation;
    if (!action) return;
    operation = null; action.controller.abort();
    if (action.upload) void request('media-upload-cancel', { ...action.scope, upload_id: action.upload }).catch(() => {});
    if (restore && action.generation === host.generation && action.preview) await host.restoreMedia(action.previous);
    cancelButton.hidden = true; message('媒体导入已取消');
  }
  async function begin() {
    const previous = operation?.previous || host.mediaSnapshot();
    await cancel({ restore: false });
    const action = { previous, generation: host.generation, scope: payload(), controller: new AbortController(), preview: false };
    operation = action; cancelButton.hidden = false;
    return action;
  }
  async function accept(action, media, file = null) {
    if (!valid(action)) return false;
    if (!action.preview) action.preview = await host.previewMedia(file || {
      name: media.name, type: media.video ? 'video/mp4' : 'audio/wav', url: media.url });
    if (!valid(action)) return false;
    await request('media-bind', { ...action.scope, media_id: media.id }, action.controller.signal);
    if (!valid(action)) return false;
    host.acceptMedia(media, { playable: action.preview, previous: action.previous });
    media.needs_proxy = !action.preview || (media.metadata.audio_tracks?.length || 0) > 1;
    current = media; operation = null; cancelButton.hidden = true;
    message(action.preview ? '媒体已就绪' : '媒体已导入；当前浏览器无法预览，可继续处理');
    global.dispatchEvent(new CustomEvent('msw:media-changed', { detail: media }));
    return true;
  }
  async function failure(action, error) {
    if (!valid(action)) return false;
    await cancel(); message(error.message); host.flashHint(error.message, 'warning'); return false;
  }
  async function choose() {
    await host.ensureMediaProject();
    const action = await begin(); message('正在选择媒体…');
    try {
      const result = await request('media-choose', action.scope, action.controller.signal);
      if (result.cancelled) { if (valid(action)) await cancel(); return false; }
      return await accept(action, result.media);
    } catch (error) { return failure(action, error); }
  }
  async function importFile(file) {
    const action = await begin(); message('正在导入媒体…');
    try {
      action.preview = await host.previewMedia(file);
      if (!valid(action)) return false;
      const start = await request('media-upload-begin', { ...action.scope, name: file.name, size: file.size }, action.controller.signal);
      action.upload = start.upload_id;
      let offset = start.offset;
      while (offset < file.size) {
        if (!valid(action)) return false;
        const chunk = file.slice(offset, offset + start.chunk_bytes);
        let result;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const query = new URLSearchParams({ upload_id: action.upload, project_id: action.scope.project_id, offset });
            const response = await fetch(`${host.config.processingUrl}/media-upload-chunk?${query}`, {
              method: 'POST', signal: action.controller.signal,
              headers: { 'X-MSW-Token': host.config.requestToken, 'Content-Type': 'application/octet-stream' }, body: chunk,
            });
            result = await response.json();
            if (!response.ok || !result.ok) throw Error(result.error || `HTTP ${response.status}`);
            break;
          } catch (error) { if (attempt === 2 || !valid(action)) throw error; }
        }
        if (!Number.isInteger(result.offset) || result.offset <= offset || result.offset > file.size) throw Error('媒体传输进度无效');
        offset = result.offset; message(`${t('正在导入媒体')} ${Math.round(offset * 100 / file.size)}%`);
      }
      const result = await request('media-upload-finish', { ...action.scope, upload_id: action.upload }, action.controller.signal);
      return await accept(action, result.media, file);
    } catch (error) { return failure(action, error); }
  }
  async function refresh() {
    if (!available() || operation) return current;
    const generation = host.generation, id = projectId(), reference = host.data.media;
    if (!reference) { current = null; return null; }
    try {
      const result = await request(`media-context?${new URLSearchParams({ project_id: id, reference })}`);
      if (generation !== host.generation || operation || host.data.media !== reference) return null;
      current = result.media;
      if (current) current.needs_proxy = (current.metadata.audio_tracks?.length || 0) > 1;
      if (current) global.dispatchEvent(new CustomEvent('msw:media-ready', { detail: current }));
      return current;
    } catch (error) { if (generation === host.generation) message(error.message); return null; }
  }
  cancelButton.addEventListener('click', () => void cancel());
  async function changeTrack(audio_index) {
    if (!current || operation) return false;
    const action = await begin();
    try {
      const result = await request('media-track', {...action.scope, media_id: current.id, audio_index}, action.controller.signal);
      return await accept(action, result.media);
    } catch (error) { return failure(action, error); }
  }
  global.addEventListener('msw:project-changed', () => { void cancel({ restore: false }); current = null; queueMicrotask(refresh); });
  global.MSWE.register('media', () => ({ available, choose, importFile, refresh, request, changeTrack,
    get current() { return current; }, get busy() { return Boolean(operation); }, payload, message }));
  if (available()) void refresh();
})(window);
