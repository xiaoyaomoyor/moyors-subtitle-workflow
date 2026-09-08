// Project save UI. Native targets and collection belong to the local server.
(function (global) {
  'use strict';
  const host = global.MSWE?.resolve('persistence-host');
  if (!host) return;
  const el = id => document.getElementById(id);
  const t = text => global.MSWE_I18N?.translateText?.(text) || text;
  let active = null, target = null, working = false;
  let recovering = false, draftBusy = false, draftTimer = null, lastDraft = null, lastGeneration = host.generation;
  let session = global.MSWProject.id('session');
  const recoveryModal = el('project-recovery-modal');
  const modal = el('project-save-as-modal');
  const available = () => Boolean(host.config?.projectPersistence && host.config?.processingUrl);
  async function request(route, payload) {
    const response = await fetch(`${host.config.processingUrl}/${route}`, {
      method: payload ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-MSW-Token': host.config.requestToken },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw Error(result.error || `HTTP ${response.status}`);
    return result;
  }
  function busy(value) {
    working = value;
    el('project-save-choose').disabled = value;
    el('project-save-confirm').disabled = value || !target;
    el('project-save-cancel').disabled = value;
  }
  function finish(value) {
    modal.classList.remove('show');
    const previous = active; active = null; target = null;
    if (previous) host.setSaving(false);
    previous?.resolve(value);
  }
  function status(report, label = '工程已保存', warning = null) {
    const output = el('project-persistence-status');
    const missing = report?.missing?.length || 0;
    output.textContent = t(label);
    if (report) output.textContent += ` · ${t('音频素材')} ${report.available}/${report.total}`;
    if (missing) output.textContent += ` · ${t('素材缺失')} ${missing}`;
    if (report?.stagedOnly?.length) output.textContent += ` · ${t('仅本机暂存')} ${report.stagedOnly.length}`;
    if (warning) output.textContent += ` · ${t(warning)}`;
    output.classList.toggle('warning', missing > 0 || Boolean(warning));
    output.hidden = false;
  }
  function saveAs({ project = null, name = host.name(), newProject = false } = {}) {
    if (!available() || active || host.saving() || recoveryModal.classList.contains('show')) return Promise.resolve(false);
    host.commitEdits(); target = null; busy(false); host.setSaving(true);
    el('project-save-path').textContent = t('尚未选择保存位置');
    el('project-save-message').textContent = '';
    el('project-save-local').hidden = true;
    el('project-save-collect-media').checked = false;
    el('project-save-collect-media').disabled = newProject || !(project || host.data).media;
    modal.classList.add('show');
    return new Promise(resolve => {
      active = { project, name, newProject, resolve, generation: host.generation };
      void captureDraft();
    });
  }
  el('project-save-choose').addEventListener('click', async () => {
    if (!active || working) return;
    const action = active; busy(true);
    try {
      const result = await request('save-target', { filename: action.name, binding: host.config.processingContext?.binding });
      if (action !== active || action.generation !== host.generation) return finish(false);
      if (!result.cancelled) {
        target = result.target;
        el('project-save-path').textContent = `${result.directory} / ${result.filename}`;
      }
    } catch (error) {
      el('project-save-message').textContent = error.message;
      el('project-save-local').hidden = false;
    }
    finally { busy(false); }
  });
  el('project-save-cancel').addEventListener('click', () => { if (!working) finish(false); });
  el('project-save-local').addEventListener('click', async () => {
    if (!active || working) return;
    const action = active; finish(false);
    try { await host.downloadLocal(action.project, action.name); }
    catch (error) { host.hint(error.message); }
  });
  el('project-save-confirm').addEventListener('click', async () => {
    if (!active || !target || working) return;
    const action = active;
    if (action.generation !== host.generation) return finish(false);
    host.commitEdits();
    const project = action.project || host.snapshot();
    const source = JSON.stringify(project);
    busy(true); host.setSaving(true);
    el('project-save-message').textContent = t('正在收集素材并保存工程…');
    try {
      const result = await request('save-as', { target, project,
        recovery: recovering && !action.newProject,
        collectMedia: el('project-save-collect-media').checked, binding: host.config.processingContext?.binding });
      if (action.generation !== host.generation) return finish(false);
      host.adopt(result, { source, newProject: action.newProject });
      recovering = false;
      status(result.assets, '工程已保存', result.recoveryWarning); finish(true);
    } catch (error) {
      target = null; el('project-save-message').textContent = error.message;
      el('project-save-local').hidden = false;
    } finally { if (!active) host.setSaving(false); busy(false); }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && (active || recoveryModal.classList.contains('show'))) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (!working) { finish(false); recoveryModal.classList.remove('show'); }
    }
  }, true);
  el('project-check-assets').hidden = !available();
  el('project-check-assets').addEventListener('click', async () => {
    const generation = host.generation;
    try {
      const result = await request('project-health');
      if (generation === host.generation) status(result.assets, '已检查磁盘工程');
    } catch (error) { host.hint(error.message); }
  });
  async function captureDraft({ force = false } = {}) {
    if (!available() || (host.saving() && !(active && !working)) || draftBusy) return false;
    draftBusy = true;
    const generation = host.generation;
    try {
      const project = host.draftSnapshot();
      const source = JSON.stringify(project);
      if (!force && generation === lastGeneration && source === lastDraft) return true;
      await request('recovery-draft', { project, session, filename: host.name(), recovery: recovering,
        binding: host.config.processingContext?.binding });
      if (generation === host.generation) { lastDraft = source; lastGeneration = generation; }
      return true;
    } catch (error) {
      // A failed draft is never acknowledged as a saved project.
      status(null, '本机恢复草稿暂不可用', error.message);
      return false;
    } finally { draftBusy = false; }
  }
  el('project-recovery-open').hidden = !available();
  el('project-recovery-open').addEventListener('click', async () => {
    if (host.saving() || working) return;
    recoveryModal.classList.add('show');
    el('project-recovery-message').textContent = t('正在读取恢复记录…');
    el('project-recovery-list').replaceChildren();
    const generation = host.generation;
    try {
      const { records } = await request('recovery-list');
      if (generation !== host.generation || !recoveryModal.classList.contains('show')) return;
      el('project-recovery-message').textContent = records.length ? '' : t('暂无恢复记录');
      for (const record of records) {
        const row = document.createElement('div'); row.className = 'msw-recovery-row';
        const label = document.createElement('span'); label.textContent = record.name;
        const meta = document.createElement('small');
        meta.textContent = `${t({ draft: '恢复草稿', saved: '最近保存', history: '历史备份' }[record.kind])} · ${new Date(record.created * 1000).toLocaleString()}`;
        label.append(meta);
        const button = document.createElement('button'); button.type = 'button'; button.textContent = t('载入副本');
        button.addEventListener('click', async () => {
          if (working || host.saving() || generation !== host.generation) return;
          working = true; el('project-recovery-close').disabled = true;
          try {
            // Fetch before preserving current edits: loading our own draft may
            // otherwise replace its contents before the user can restore it.
            const result = await request('recovery-load', { id: record.id });
            if (!await captureDraft({ force: true })) throw Error(t('当前草稿未能保存，未切换恢复内容'));
            if (generation !== host.generation) return;
            host.restore(result); recovering = true; lastDraft = null;
            session = global.MSWProject.id('session');
            recoveryModal.classList.remove('show');
            status(null, '恢复内容尚未另存为工程');
          } catch (error) { el('project-recovery-message').textContent = error.message; }
          finally { working = false; el('project-recovery-close').disabled = false; }
        });
        row.append(label, button); el('project-recovery-list').append(row);
      }
    } catch (error) { el('project-recovery-message').textContent = error.message; }
  });
  el('project-recovery-close').addEventListener('click', () => { if (!working) recoveryModal.classList.remove('show'); });
  if (available()) {
    // No browser storage quota dependency; the server owns bounded snapshots.
    lastDraft = JSON.stringify(host.draftSnapshot());
    document.addEventListener('input', event => {
      if (!event.target.closest('.cues-container, #cue-panel')) return;
      clearTimeout(draftTimer); draftTimer = setTimeout(() => { void captureDraft(); }, 1500);
    });
    setInterval(() => { if (!working) void captureDraft(); }, 5000);
  }
  global.MSWE.register('project-persistence', () => Object.freeze({ available, saveAs, status, captureDraft }));
})(window);
