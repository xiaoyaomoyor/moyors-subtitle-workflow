// Mixed file queue. Pairing is always an explicit user decision.
(function () {
  "use strict";
  const KEY = "MSW_LAUNCHER_INPUT_QUEUE_V2";
  const state = { files: [], pairs: [], separate: [], running: false, inspecting: false, runId: "", results: {}, opened: new Set() };
  const $ = id => document.getElementById(id);
  const t = key => window.MSWLauncher.translate(key);
  const bridge = (name, payload) => window.MSWLauncher.callBackend(name, payload);
  const pathKey = path => String(path || "").replace(/\\/g, "/").toLowerCase();
  const basename = path => String(path || "").split(/[\\/]/).pop();
  const pairKey = (a, b) => [a, b].sort().join("|");
  const stem = path => pathKey(path).replace(/\.[^/.]+$/, "");
  const id = () => crypto.randomUUID();
  function persist() {
    // Only file identities and local choices. Never serialize the live ASR payload.
    const files = state.files.map(({ id, path, audioTrack, mediaPath, scriptPath, ocrVideoPath }) => ({ id, path, audioTrack, mediaPath, scriptPath, ocrVideoPath }));
    const results = Object.fromEntries(Object.entries(state.results).map(([id, value]) => [id, { status: value.status === 'done' ? 'done' : 'cancelled', result: value.status === 'done' ? { projectPath: value.result?.projectPath || '', srtPath: value.result?.srtPath || '', translatedSrtPath: value.result?.translatedSrtPath || '', bilingualSrtPath: value.result?.bilingualSrtPath || '' } : null }]));
    try { localStorage.setItem(KEY, JSON.stringify({ version: 2, files, pairs: state.pairs, separate: state.separate, results, asrPolicy: $('queueAsrPolicy').value })); } catch (_) { /* optional draft */ }
  }
  function candidates() {
    const paired = new Set(state.pairs.flat());
    const list = [];
    for (const media of state.files.filter(f => f.meta?.kind === "media" && !paired.has(f.id))) {
      for (const subtitle of state.files.filter(f => f.meta?.kind === "subtitle" && !paired.has(f.id))) {
        if (stem(media.path) === stem(subtitle.path) && !state.separate.includes(pairKey(media.id, subtitle.id))) list.push([media.id, subtitle.id]);
      }
    }
    return list;
  }
  function tasks() {
    const attached = new Set(state.pairs.map(p => p[1]));
    return state.files.filter(f => !attached.has(f.id)).map(f => {
      const pair = state.pairs.find(p => p[0] === f.id);
      const subtitle = pair && state.files.find(s => s.id === pair[1]);
      return { id: f.id, path: f.path, mediaPath: f.mediaPath || f.meta?.mediaPath || "", subtitlePath: subtitle?.path || "", audioTrack: f.audioTrack ?? f.meta?.audioTrack ?? null, scriptPath: f.scriptPath || "", ocrVideoPath: f.ocrVideoPath || "" };
    });
  }
  function node(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function button(label, action, cls = "ghost small") { const b = node("button", cls, label); b.type = "button"; b.disabled = state.running || state.inspecting; b.addEventListener("click", action); return b; }
  function changed() { persist(); render(); document.dispatchEvent(new CustomEvent("mswqueuechange")); window.MSWWorkflow?.renderCards(); }
  async function inspect(files) {
    state.inspecting = true; render();
    try {
      const result = await bridge("inspect_queue_inputs", { paths: files.map(f => f.path) });
      if (!result.ok) throw Error(result.error || t("failed"));
      result.items.forEach((meta, i) => {
        const f = files[i]; if (!state.files.includes(f)) return;
        f.meta = meta; f.error = meta.ok ? "" : meta.error; f.path = meta.path || f.path;
      });
      for (const file of files.filter(f => f.mediaPath)) await inspectLinkedMedia(file);
      const seen = new Set();
      state.files = state.files.filter(f => { const key = pathKey(f.path); if (seen.has(key)) return false; seen.add(key); return true; });
      state.pairs = state.pairs.filter(p => p.every(id => state.files.some(f => f.id === id)));
    } catch (error) { files.forEach(f => { f.error = error.message; }); }
    finally { state.inspecting = false; changed(); }
  }
  let additions = Promise.resolve();
  function addPaths(paths) {
    if (state.running) return Promise.resolve();
    additions = additions.then(async () => {
      if (state.running) return;
      const added = [];
      for (const path of paths) {
        if (!path || state.files.some(f => pathKey(f.path) === pathKey(path))) continue;
        const file = { id: id(), path }; state.files.push(file); added.push(file);
      }
      if (added.length) await inspect(added);
    });
    return additions;
  }
  async function chooseFiles() { if (state.running) return; const r = await bridge("choose_file", { kind: "prefab", multiple: true }); if (r.ok) await addPaths(r.paths || [r.path]); }
  function remove(fileId) {
    state.files = state.files.filter(f => f.id !== fileId);
    state.pairs = state.pairs.filter(p => !p.includes(fileId));
    state.separate = state.separate.filter(key => !key.split("|").includes(fileId));
    delete state.results[fileId]; changed();
  }
  async function inspectLinkedMedia(file) {
    file.linkedMeta = null; file.linkedError = '';
    if (!file.mediaPath) { file.audioTrack = file.meta?.audioTrack; return; }
    try {
      const inspected = await bridge('inspect_queue_inputs', { paths: [file.mediaPath] });
      const meta = inspected.items?.[0];
      if (!meta?.ok || meta.kind !== 'media') throw Error(meta?.error || t('media_not_found'));
      file.linkedMeta = meta;
      if (!meta.audioTracks?.some(track => track.audio_index === file.audioTrack)) file.audioTrack = meta.audioTrack;
    } catch (error) { file.linkedError = error.message; }
  }
  async function updateDetail(file, field, value) {
    file[field] = value;
    delete state.results[file.id];
    if (field === 'mediaPath') {
      state.inspecting = true; render();
      try { await inspectLinkedMedia(file); } finally { state.inspecting = false; }
    }
    changed();
  }
  async function chooseDetail(file, field, kind) {
    const r = await bridge("choose_file", { kind }); if (!r.ok) return;
    await updateDetail(file, field, r.path);
  }
  function detailPath(box, file, field, label, kind) {
    const row = node("div", "queue-detail-field");
    const input = node("input"); input.type = "text"; input.value = file[field] || ""; input.placeholder = t("queue_optional"); input.disabled = state.running || state.inspecting; input.setAttribute("aria-label", label);
    input.addEventListener("change", () => { void updateDetail(file, field, input.value.trim()); });
    const name = node("label", "", label); input.id = `queue-${file.id}-${field}`; name.htmlFor = input.id;
    const controls = node("div", "path-row"); controls.append(input, button(t("choose"), () => chooseDetail(file, field, kind)));
    row.append(name, controls); box.append(row);
  }
  function render() {
    const root = $("batchQueue"); if (!root) return;
    root.replaceChildren();
    $("batchQueueCount").textContent = t("queue_counts").replace("{files}", state.files.length).replace("{tasks}", tasks().length);
    $("dropZone").classList.toggle("compact", state.files.length > 0);
    $("dropZone").disabled = state.running || state.inspecting;
    $("batchClear").disabled = state.running || state.inspecting || !state.files.length;
    $("start").disabled = state.running || state.inspecting || !state.files.length;
    for (const [a, b] of candidates()) {
      const media = state.files.find(f => f.id === a), subtitle = state.files.find(f => f.id === b);
      const candidate = node("div", "queue-candidate");
      candidate.append(node("span", "", t("queue_pair_candidate") + " " + basename(media.path) + " + " + basename(subtitle.path)));
      const actions = node("div", "queue-inline-actions");
      actions.append(button(t("queue_pair"), () => { state.pairs.push([a, b]); delete state.results[a]; delete state.results[b]; changed(); }), button(t("queue_separate"), () => { state.separate.push(pairKey(a, b)); changed(); }));
      candidate.append(actions); root.append(candidate);
    }
    for (const task of tasks()) {
      const file = state.files.find(f => f.id === task.id), outcome = state.results[task.id];
      const item = node("article", "queue-file"); item.dataset.taskId = task.id; item.setAttribute("role", "listitem");
      const head = node("div", "queue-file-head");
      const icon = node("span", "queue-file-icon"); icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6"/></svg>';
      const title = node("div", "queue-file-title"); title.append(node("strong", "", basename(file.path)), node("span", "hint", t("queue_kind_" + (file.meta?.kind || "file")) + (task.subtitlePath ? " + " + basename(task.subtitlePath) : "")));
      const status = file.error || file.linkedError ? t("queue_invalid") : outcome ? t("queue_status_" + outcome.status) : state.inspecting && !file.meta ? t("queue_reading") : t("queue_ready");
      const badge = node("span", "queue-status" + (file.error || file.linkedError || outcome?.status === "failed" ? " error" : ""), status);
      head.append(icon, title, badge, button(t("batch_remove"), () => remove(file.id))); item.append(head);
      if (file.error || file.linkedError || outcome?.message) item.append(node("p", "field-error visible", file.error || file.linkedError || outcome.message));
      const warnings = [...file.meta?.warnings || [], ...outcome?.result?.warnings || []];
      if (warnings.length) item.append(node("p", "hint", warnings.join(" · ")));
      const details = node("details", "queue-details"); details.open = state.opened.has(file.id);
      details.addEventListener("toggle", () => { if (details.open) state.opened.add(file.id); else state.opened.delete(file.id); });
      details.append(node("summary", "", t("queue_details")), node("p", "queue-path", file.path));
      if (task.subtitlePath) {
        details.append(node("p", "queue-path", task.subtitlePath), button(t("queue_unpair"), () => { const pair = state.pairs.find(p => p[0] === file.id); state.separate.push(pairKey(...pair)); delete state.results[file.id]; state.pairs = state.pairs.filter(p => p !== pair); changed(); }));
      }
      if (file.meta?.kind !== "media") detailPath(details, file, "mediaPath", t("queue_link_media"), "media");
      const tracks = file.linkedMeta?.audioTracks || file.meta?.audioTracks || [];
      if (tracks.length > 1) {
        const label = node("label", "queue-detail-field", t("audio_track")); const select = node("select");
        select.setAttribute("aria-label", t("audio_track")); select.disabled = state.running || state.inspecting;
        tracks.forEach(track => select.add(new Option(`${track.audio_index + 1} · ${track.language || track.title || track.codec_name || t("audio_track")}`, track.audio_index)));
        select.value = String(task.audioTrack ?? 0); select.addEventListener("change", () => { file.audioTrack = Number(select.value); delete state.results[file.id]; persist(); }); label.append(select); details.append(label);
      }
      if (window.MSWModules?.isEnabled("match")) detailPath(details, file, "scriptPath", t("queue_manuscript"), "script");
      if (window.MSWModules?.isEnabled("ocr")) detailPath(details, file, "ocrVideoPath", t("queue_ocr_video"), "video");
      item.append(details);
      if (outcome?.result?.projectPath) item.append(button(t("open_project_result"), () => { window.MSWLauncher.setJsonPath(outcome.result.projectPath); window.MSWLauncher.openServerEditor(); }));
      const artifact = outcome?.result?.projectPath || outcome?.result?.srtPath || outcome?.result?.translatedSrtPath || outcome?.result?.bilingualSrtPath;
      if (artifact) item.append(button(t('artifact_open_folder'), async () => { const result = await bridge('open_containing_folder', { path: artifact }); if (!result.ok) window.MSWLauncher.onBatchError(result); }));
      root.append(item);
    }
  }
  const locked = new Map();
  function setBusy(busy) {
    state.running = busy;
    window.MSWLauncher.setQueueRunning(busy);
    if (busy) document.querySelectorAll('[data-page-id="prefab"] input, [data-page-id="prefab"] select, [data-page-id="prefab"] textarea, #prefabRail button, [data-page-id="prefab"] .module-body button').forEach(el => { locked.set(el, el.disabled); el.disabled = true; });
    else { locked.forEach((disabled, el) => { el.disabled = disabled; }); locked.clear(); }
    render();
  }
  function showErrors(errors) {
    for (const error of errors) { if (error.taskId) state.results[error.taskId] = { status: "failed", message: error.message }; }
    const first = errors[0]; if (!first) return;
    window.MSWWorkflow?.setCollapsed(first.module || "media", false);
    document.querySelector(`[data-module-card="${first.module || "media"}"]`)?.scrollIntoView({ block: "nearest" });
    window.MSWLauncher.onBatchError({ code: "queue_preflight", detail: first.message, error: first.message });
    render();
  }
  async function start() {
    if (state.running || state.inspecting) return;
    let plan = window.MSWPlan.build();
    const check = window.MSWPlan.preflight(plan);
    if (!check.ok) { showErrors([{ taskId: check.taskId, module: check.module, message: t(check.code) }]); return; }
    const failed = state.files.filter(f => f.error || f.linkedError);
    if (failed.length) { showErrors(failed.map(f => ({ taskId: f.id, module: "media", message: f.error || f.linkedError }))); return; }
    const asrTask = plan.modules.asr && plan.tasks.find(task => plan.asrPolicy === 'replace' || (!task.subtitlePath && !state.files.find(f => f.id === task.id)?.meta?.hasSubtitles));
    if (asrTask && !window.MSWLauncher.validateQueueRecognition(asrTask.mediaPath)) { window.MSWWorkflow?.setCollapsed('asr', false); return; }
    const allCount = plan.tasks.length;
    // Shared manuscript applies only to an original one-task queue, including retries.
    if (allCount === 1 && !plan.tasks[0].scriptPath) plan.tasks[0].scriptPath = plan.postprocess.steps?.find(s => s.id === "match")?.scriptPath || "";
    if (allCount > 1) plan.postprocess.steps?.forEach(step => { if (step.id === "match") step.scriptPath = ""; });
    if (plan.tasks.some(task => state.results[task.id]?.status === "done")) {
      const skip = await window.MSWLauncher.confirm(t("queue_rerun"));
      if (skip) plan.tasks = plan.tasks.filter(task => state.results[task.id]?.status !== "done");
    }
    if (!plan.tasks.length) return;
    plan = JSON.parse(JSON.stringify(plan));
    state.runId = ""; state.pendingEvents = []; state.cancelRequested = false;
    state.activeIds = plan.tasks.map(task => task.id);
    plan.tasks.forEach(task => { state.results[task.id] = { status: "queued" }; });
    setBusy(true);
    try {
      const r = await bridge("start_prefab_queue", { plan });
      if (!r.ok) { state.activeIds.forEach(id => delete state.results[id]); setBusy(false); showErrors(r.errors || [{ message: r.detail || r.error || t("failed") }]); return; }
      state.runId = r.runId;
      if (state.cancelRequested) await bridge("cancel_prefab_queue", { runId: r.runId });
      const pending = state.pendingEvents; state.pendingEvents = [];
      pending.forEach(handleEvent);
    } catch (error) { state.activeIds.forEach(id => delete state.results[id]); setBusy(false); showErrors([{ message: error.message }]); }
  }
  async function stop() {
    if (!state.running) return;
    state.cancelRequested = true;
    $("stop").disabled = true;
    if (!state.runId) return;
    try { const r = await bridge("cancel_prefab_queue", { runId: state.runId }); if (!r.ok) throw Error(r.error); }
    catch (error) { $("stop").disabled = false; window.MSWLauncher.appendLog(error.message); }
  }
  function handleEvent(event) {
    if (!state.running) return;
    if (!state.runId) { state.pendingEvents.push(event); return; }
    if (event.runId !== state.runId) return;
    if (event.type === "queueItem") { state.results[event.taskId] = event; render(); }
    if (event.type === "queueProgress") {
      const module = event.step || ({ asr: 'asr', waveform: 'waveform', postprocess: 'replace' })[event.stage];
      const message = event.message || (module ? t('mod_' + module) : '');
      if (message) window.MSWLauncher.appendLog(String(message));
    }
    if (event.type === 'queueItem' && event.status === 'running') window.MSWLauncher.setQueueProgress(`${event.index + 1}/${state.activeIds.length} · ${basename(state.files.find(f => f.id === event.taskId)?.path)}`);
    if (event.type === "queueDone") {
      event.results?.forEach(item => { state.results[item.taskId] = item; });
      for (const id of state.activeIds) {
        if (!['done', 'failed', 'cancelled'].includes(state.results[id]?.status)) state.results[id] = { taskId: id, status: event.cancelled ? 'cancelled' : 'failed', message: event.cancelled ? '' : t('queue_missing_result') };
      }
      event = { ...event, results: state.activeIds.map(id => state.results[id]) };
      setBusy(false);
      persist();
      const done = event.results?.filter(r => r.status === "done") || [];
      window.MSWLauncher.finishQueue(event, done.at(-1)?.result?.projectPath || "");
    }
  }
  async function initialize() {
    $("dropZone").addEventListener("click", chooseFiles);
    $('queueAsrPolicy').addEventListener('change', persist);
    $("batchClear").addEventListener("click", () => { state.files = []; state.pairs = []; state.separate = []; state.results = {}; changed(); });
    document.addEventListener("mswmodules", render);
    document.addEventListener("mswlanguage", render);
    window.MSWLauncher.onQueueEvent = handleEvent;
    window.MSWLauncher.onBatchDrop = path => { if (document.querySelector('.page.active')?.dataset.pageId !== "prefab") return false; if (path && !state.running) void addPaths([path]); return true; };
    window.MSWLauncher.onBatchDropReject = window.MSWLauncher.onBatchDrop;
    try {
      const draft = JSON.parse(localStorage.getItem(KEY) || "null");
      if (draft?.version === 2 && Array.isArray(draft.files)) { state.files = draft.files.filter(f => f.id && typeof f.path === "string"); state.pairs = Array.isArray(draft.pairs) ? draft.pairs.filter(p => Array.isArray(p) && p.length === 2) : []; state.separate = Array.isArray(draft.separate) ? draft.separate : []; state.results = draft.results && typeof draft.results === 'object' ? draft.results : {}; }
      if (draft?.asrPolicy === 'replace') $('queueAsrPolicy').value = 'replace';
    } catch (_) { /* ignore invalid drafts */ }
    if (state.files.length) await inspect(state.files.slice()); else render();
    window.MSWWorkflow?.renderCards();
  }
  window.MSWQueue = { state, tasks, candidates, addPaths, start, stop, render };
  window.MSWBatch = { get state() { return { ...state, items: tasks(), mode: tasks().length > 1 ? "batch" : "single" }; } };
  window.addEventListener("mawlauncherready", initialize, { once: true });
})();
