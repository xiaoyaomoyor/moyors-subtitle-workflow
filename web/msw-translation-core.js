// Pure translation selection, placement and optimistic reconciliation.
(function (global) {
  'use strict';
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const uid = (prefix) => global.MSWProject.id(prefix);
  const tracks = (project) => project.multi_subtitle?.tracks || [];
  const bindings = (project) => project.multi_subtitle?.bindings || [];
  const overlaps = (a, b) => a.start < b.end && b.start < a.end;
  function lowerBound(rows, value, field) {
    let low = 0, high = rows.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (rows[middle][field] < value) low = middle + 1;
      else high = middle;
    }
    return low;
  }
  const mainBindingMap = (project) => new Map(bindings(project).flatMap(binding =>
    (binding.main_segment_ids || []).map(id => [id, binding])));

  function scope(project, mainIds = [], extensionIds = [], trackId = null, hasSelection = false) {
    const selected = new Set(mainIds);
    const byExtension = new Map(bindings(project).filter(binding => binding.track_id === trackId)
      .flatMap(binding => (binding.extension_segment_ids || []).map(id => [id, binding])));
    let ignored = 0;
    for (const id of extensionIds) {
      const binding = byExtension.get(id);
      if (binding?.main_segment_ids?.length === 1) selected.add(binding.main_segment_ids[0]);
      else ignored += 1;
    }
    const sources = (project.segments || []).filter((source) => (!hasSelection || selected.has(source.id))
      && typeof source.text === 'string' && source.text.trim());
    return { sources, ignored, all: !hasSelection };
  }

  function sourceCopy(source) {
    const result = { id: source.id, start: source.start, end: source.end, text: source.text };
    if (source.disabled) result.disabled = true;
    return result;
  }

  function snapshot(project, selection) {
    const selected = scope(project, selection.mainIds, selection.extensionIds, selection.trackId, selection.hasSelection);
    if (!selected.sources.length) throw new Error('没有可翻译的主字幕；未绑定的副字幕不会触发全量翻译');
    const track = tracks(project)[0] || null;
    const byMain = mainBindingMap(project);
    const byTarget = new Map((track?.segments || []).map(cue => [cue.id, cue]));
    const ordered = [...(track?.segments || [])].sort((a, b) => a.start - b.start);
    const used = new Set(bindings(project).filter((binding) => binding.track_id === track?.id)
      .flatMap((binding) => binding.extension_segment_ids || []));
    const entries = selected.sources.map((source) => {
      const binding = byMain.get(source.id);
      let target = binding?.track_id === track?.id
        ? byTarget.get(binding?.extension_segment_ids?.[0]) : null;
      if (!target && !binding && track) {
        const nearby = ordered.slice(lowerBound(ordered, source.start - 300, 'start'), lowerBound(ordered, source.start + 301, 'start'));
        const candidates = nearby.filter((cue) => !used.has(cue.id)
          && Math.abs(cue.start - source.start) <= 300 && Math.abs(cue.end - source.end) <= 300 && overlaps(cue, source))
          .map((cue) => ({ cue, score: Math.abs(cue.start - source.start) + Math.abs(cue.end - source.end) }))
          .sort((a, b) => a.score - b.score);
        // A tie is ambiguous: leave it for conflict handling rather than guess.
        if (candidates.length && (candidates.length === 1 || candidates[0].score < candidates[1].score)) {
          target = candidates[0].cue;
          used.add(target.id);
        }
      }
      return { source: sourceCopy(source), target: target ? sourceCopy(target) : null, binding_id: binding?.id || null };
    });
    return { project_id: project.msw.project_id, track_id: track?.id || null, entries };
  }

  function reconcile(project, input, result, { onlyIds = null, createdTrackId = null } = {}) {
    if (project.msw?.project_id !== input.project_id) throw new Error('翻译结果属于其他工程');
    const translations = new Map();
    const expected = new Set(input.entries.map((entry) => entry.source.id));
    for (const row of result.translations || []) {
      if (!expected.has(row.id) || translations.has(row.id) || typeof row.text !== 'string' || !row.text.trim()) {
        throw new Error('翻译结果包含无效、重复或空白字幕，未应用');
      }
      translations.set(row.id, row.text);
    }
    if (translations.size !== expected.size) throw new Error('翻译结果缺少字幕，未应用');
    const multi = clone(project.multi_subtitle || {
      schema: 'moy.asr.multi_subtitle.v1', enabled: false, display_mode: 'both', tracks: [], bindings: [],
    });
    const currentTrack = multi.tracks[0] || null;
    const trackChanged = (currentTrack?.id || null) !== (input.track_id || createdTrackId);
    const track = currentTrack || {
      id: uid('extension'), role: 'extension', name: '副字幕',
      language: result.language === 'zh' ? 'Chinese' : 'English',
      split_mode: result.language === 'zh' ? 'continuous' : 'word', source_name: '字幕翻译', segments: [],
    };
    const appliedIds = [];
    const conflicts = [];
    const allowed = onlyIds ? new Set(onlyIds) : null;
    const bySource = new Map(project.segments.map(cue => [cue.id, cue]));
    const byMain = mainBindingMap(project);
    const byTarget = new Map(track.segments.map(cue => [cue.id, cue]));
    const byTargetBinding = new Map(multi.bindings.filter(binding => binding.track_id === track.id)
      .flatMap(binding => (binding.extension_segment_ids || []).map(id => [id, binding])));
    track.segments.sort((a, b) => a.start - b.start || a.end - b.end);
    for (const entry of input.entries) {
      if (allowed && !allowed.has(entry.source.id)) continue;
      const source = bySource.get(entry.source.id);
      const binding = byMain.get(entry.source.id);
      let reason = '';
      if (!source) reason = '主字幕已删除、拆分或合并';
      else if (source.text !== entry.source.text) reason = '主字幕文本已修改';
      else if (trackChanged) reason = '副字幕轨已变化';
      else if ((binding?.id || null) !== entry.binding_id) reason = '字幕绑定已变化';
      else if (binding && binding.track_id !== track.id) reason = '主字幕已绑定到其他副字幕轨';
      let target = entry.target ? byTarget.get(entry.target.id) : null;
      if (!reason && entry.target) {
        const targetBinding = byTargetBinding.get(entry.target.id);
        if (!target) reason = '目标副字幕已删除';
        else if (target.text !== entry.target.text) reason = '副字幕文本已修改';
        else if (targetBinding && (targetBinding.id !== entry.binding_id
          || targetBinding.main_segment_ids?.[0] !== source.id)) reason = '副字幕已绑定到其他字幕';
        else if (binding && (binding.track_id !== track.id
          || binding.extension_segment_ids?.[0] !== target.id)) reason = '字幕绑定目标已变化';
      }
      if (!reason && !target) {
        const slot = lowerBound(track.segments, source.start, 'start');
        if ((slot > 0 && overlaps(track.segments[slot - 1], source))
          || (slot < track.segments.length && overlaps(track.segments[slot], source))) reason = '没有可用副字幕位置，新建会与已有字幕重叠';
        else {
          target = { id: uid('translation'), start: source.start, end: source.end, text: '' };
          if (Number.isInteger(source.start_frame) && Number.isInteger(source.end_frame)) {
            target.start_frame = source.start_frame;
            target.end_frame = source.end_frame;
          }
          if (source.disabled) target.disabled = true;
          track.segments.splice(slot, 0, target);
          byTarget.set(target.id, target);
        }
      }
      if (reason) {
        conflicts.push({ id: entry.source.id, source: entry.source.text, text: translations.get(entry.source.id), reason });
        continue;
      }
      if (target.text !== translations.get(source.id)) delete target.items;
      target.text = translations.get(source.id);
      target._dirty = true;
      if (!binding) {
        multi.bindings.push({ id: uid('binding'), track_id: track.id,
          main_segment_ids: [source.id], extension_segment_ids: [target.id],
          start_offset_ms: target.start - source.start, end_offset_ms: target.end - source.end });
      }
      appliedIds.push(source.id);
    }
    if (appliedIds.length) {
      track.segments.sort((a, b) => a.start - b.start || a.end - b.end);
      for (let index = 1; index < track.segments.length; index += 1) {
        if (track.segments[index].start < track.segments[index - 1].end) throw new Error('副字幕存在重叠，翻译结果未应用');
      }
      if (!currentTrack) multi.tracks.push(track);
      multi.enabled = true;
      multi._dirty = true;
      if (!currentTrack) multi.display_mode = 'both';
      for (const binding of multi.bindings) {
        const source = bySource.get(binding.main_segment_ids?.[0]);
        const targetTrack = multi.tracks.find((candidate) => candidate.id === binding.track_id);
        const target = targetTrack?.id === track.id ? byTarget.get(binding.extension_segment_ids?.[0])
          : targetTrack?.segments.find((cue) => cue.id === binding.extension_segment_ids?.[0]);
        if (source && target) {
          binding.start_offset_ms = target.start - source.start;
          binding.end_offset_ms = target.end - source.end;
        }
      }
    }
    return { multi, appliedIds, conflicts };
  }
  global.MSWTranslation = Object.freeze({ scope, snapshot, reconcile });
  global.MSWE?.register('msw-translation', () => global.MSWTranslation);
})(window);
