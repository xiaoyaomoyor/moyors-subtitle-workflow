// Read-only track views for both offline tools. Never rewrite imported projects.
(function (global) {
  'use strict';
  const flat = typeof module !== 'undefined' && module.exports ? require('../msw-flat-subtitles.js') : global.MSWFlatSubtitles;
  function tracks(project) {
    if (!project || typeof project !== 'object' || Array.isArray(project)) throw Error('不是有效的字幕工程');
    const schema = project.schema;
    if (schema !== undefined && !['moy.asr.project.v1', 'msw.project.v2', 'msw.project.v3', 'msw.project.v4'].includes(schema)) {
      throw Error('不支持的工程版本：' + String(schema));
    }
    let native = project;
    if (schema === 'msw.project.v2' || schema === 'msw.project.v3') native = flat.migrate(project);
    if (native.schema === 'msw.project.v4') {
      // This is a diagnostic reader: invalid item timing remains visible to the
      // timecode tool. Check identities/ownership without repairing any content.
      const model = native.subtitles;
      if (!model || !Array.isArray(model.tracks) || !model.tracks.length || !Array.isArray(model.cues)) throw Error('工程缺少有效的字幕轨道或字幕块');
      const ids = new Set(), cueIds = new Set(), groups = new Map();
      for (const track of model.tracks) {
        if (!track || typeof track.id !== 'string' || !track.id || ids.has(track.id)) throw Error('字幕轨道 ID 缺失或重复');
        ids.add(track.id); groups.set(track.id, []);
      }
      for (const cue of model.cues) {
        if (!cue || typeof cue.id !== 'string' || !cue.id || cueIds.has(cue.id) || !ids.has(cue.track_id) || !cue.content || typeof cue.content !== 'object') throw Error('字幕块 ID 或轨道归属无效');
        cueIds.add(cue.id);
        groups.get(cue.track_id).push({...cue.content, id: cue.id, hidden: cue.hidden === true});
      }
      return model.tracks.map((track, index) => ({...track, name: track.name || `S${index + 1}`,
        native: true, segments: groups.get(track.id), timestamp_granularity: track.timestamp_granularity || project.timestamp_granularity}));
    }
    if (!Array.isArray(project.segments)) throw Error('工程缺少字幕内容');
    const result = [{id: 'legacy-main', name: 'S1', enabled: true, segments: project.segments}];
    const multi = project.multi_subtitle;
    for (const [index, track] of (multi?.tracks || []).entries()) {
      if (Array.isArray(track.segments)) result.push({id: `legacy-secondary:${track.id || index}`, name: `S${result.length + 1} · ${track.name || track.language || '译文'}`,
        enabled: multi.enabled !== false && track.enabled !== false, segments: track.segments, timestamp_granularity: track.timestamp_granularity});
    }
    const overlay = project.overlay_track;
    if (Array.isArray(overlay?.segments)) result.push({id: 'legacy-overlay', name: `S${result.length + 1} · 旧叠加`, enabled: overlay.enabled === true, segments: overlay.segments});
    return result.map(track => ({...track, timestamp_granularity: track.timestamp_granularity || project.timestamp_granularity}));
  }
  function view(project, trackId) {
    const options = tracks(project);
    const active = track => track.enabled !== false && track.segments.some(c => c && !c.hidden && !c.disabled && typeof c.text === 'string' && c.text.trim());
    const track = trackId === undefined ? options.find(active) || options[0] : options.find(t => t.id === trackId);
    if (!track) throw Error('所选字幕轨道不存在');
    const warnings = [];
    const hidden = track.segments.filter(c => c?.hidden).length;
    if (hidden) warnings.push(`忽略 ${hidden} 个已隐藏的字幕块`);
    if (track.enabled === false) warnings.push('所选轨道已禁用，没有参与比较的字幕');
    return {options, track, warnings, segments: track.enabled === false ? [] : track.segments.filter(c => !c?.hidden)};
  }
  function picker(entry, onChange) {
    if (!entry.tracks) return null;
    const label = document.createElement('label');
    label.className = 'compare-track-picker';
    label.textContent = '字幕轨道 ';
    const select = document.createElement('select');
    select.setAttribute('aria-label', '字幕轨道 · ' + entry.name);
    for (const track of entry.tracks) {
      const option = document.createElement('option');
      option.value = track.id;
      const count = track.segments.filter(c => c && !c.hidden && !c.disabled).length;
      option.textContent = track.name + ` · ${count} 条` + (track.enabled === false ? '（已禁用）' : '') + (track.locked ? '（已锁定）' : '') + (track.collapsed ? '（已折叠）' : '');
      select.appendChild(option);
    }
    select.value = entry.trackId;
    select.addEventListener('change', () => onChange(select.value));
    label.appendChild(select);
    return label;
  }
  function pairSegments(files) {
    const left = files[0]?.segments || [], right = files[1]?.segments || [];
    const shared = new Set(left.filter(c => c.id).map(c => c.id));
    const byId = files.length === 2 && files.every(f => f.nativeTrack)
      && right.some(c => c.id && shared.has(c.id));
    if (!byId) return {mode: 'index', cells: Array.from({length: Math.max(left.length, right.length)}, (_, i) => files.length === 2 ? [left[i] || null, right[i] || null] : [left[i]])};
    const rightMap = new Map(right.map(c => [c.id, c]));
    const cells = left.map(c => [c, rightMap.get(c.id) || null]);
    for (const cue of right) if (!shared.has(cue.id)) cells.push([null, cue]);
    cells.sort((a, b) => (a[0] || a[1]).start - (b[0] || b[1]).start);
    return {mode: 'id', cells};
  }
  const api = {tracks, view, picker, pairSegments};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.MSWCompareTracks = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
