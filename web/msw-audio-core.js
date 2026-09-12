// Pure sample/time math shared by timeline, playback and project validation.
(function (global) {
  'use strict';
  const duration = (clip, asset) => (clip.source_out_sample - clip.source_in_sample) * 1000 / asset.sample_rate;
  const end = (clip, asset) => clip.start_ms + duration(clip, asset);
  const levelDb = (clip, track) => clip.gain_db + (track?.gain_db || 0);
  function validTrack(track) {
    return track && global.MSWProject.validId(track.id) && typeof track.name === 'string' && [...track.name].length <= 160
      && Number.isFinite(track.gain_db) && track.gain_db >= -60 && track.gain_db <= 12 && typeof track.muted === 'boolean';
  }
  function validClip(clip, assets, tracks) {
    const asset = assets.get(clip?.asset_id);
    return !!asset && global.MSWProject.validId(clip.id) && tracks.has(clip.track_id)
      && Number.isInteger(clip.start_ms) && clip.start_ms >= 0 && clip.start_ms <= 1e12
      && Number.isInteger(clip.source_in_sample) && clip.source_in_sample >= 0
      && Number.isInteger(clip.source_out_sample) && clip.source_out_sample <= asset.sample_count
      && clip.source_in_sample < clip.source_out_sample && clip.playback_rate === 1
      && Number.isFinite(clip.gain_db) && clip.gain_db >= -60 && clip.gain_db <= 12
      && typeof clip.muted === 'boolean' && typeof clip.label === 'string' && [...clip.label].length <= 2000;
  }
  function validate(extension) {
    const { audio_tracks: tracks = [], audio_clips: clips = [], audio_settings: settings = {} } = extension;
    if (!Array.isArray(tracks) || tracks.length > 32 || !tracks.every(validTrack)
      || new Set(tracks.map(t => t.id)).size !== tracks.length) throw Error('MSW 配音轨格式无效或重复');
    const assets = new Map((extension.assets || []).map(a => [a.id, a])), trackMap = new Map(tracks.map(t => [t.id, t]));
    if (!Array.isArray(clips) || clips.length > 10000 || !clips.every(c => validClip(c, assets, trackMap))
      || new Set(clips.map(c => c.id)).size !== clips.length) throw Error('MSW 音频贴片格式无效或素材引用丢失');
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)
      || ('heatmap' in settings && typeof settings.heatmap !== 'boolean')
      || ('gap_policy' in settings && !['protect', 'follow'].includes(settings.gap_policy))) throw Error('MSW 配音设置格式无效');
  }
  function create(asset, trackId, startMs, id) {
    return { id, track_id: trackId, asset_id: asset.id, start_ms: Math.max(0, Math.round(startMs)),
      source_in_sample: 0, source_out_sample: asset.sample_count, playback_rate: 1, gain_db: 0, muted: false,
      label: asset.generation.display_text };
  }
  function edit(clip, asset, mode, deltaMs) {
    const next = { ...clip }, sampleDelta = Math.round(deltaMs * asset.sample_rate / 1000);
    if (mode === 'move') next.start_ms = Math.max(0, Math.round(clip.start_ms + deltaMs));
    if (mode === 'end') next.source_out_sample = Math.max(clip.source_in_sample + 1, Math.min(asset.sample_count, clip.source_out_sample + sampleDelta));
    if (mode === 'start') {
      // Commit at integer timeline milliseconds while keeping source offsets
      // in integer sample frames. Never move the start before timeline zero.
      const delta = Math.max(-clip.start_ms, Math.round(deltaMs));
      next.source_in_sample = Math.max(0, Math.min(clip.source_out_sample - 1, clip.source_in_sample + Math.round(delta * asset.sample_rate / 1000)));
      next.start_ms = clip.start_ms + Math.round((next.source_in_sample - clip.source_in_sample) * 1000 / asset.sample_rate);
    }
    return next;
  }
  function arrange(clips, assets, prevLanes = null) {
    // 按 start 顺序做区间装箱（首适应低位优先），带「重叠规则化粘性 lane」：
    // 一条贴片只在【与其他贴片仍有时间重叠】时保留上一次的轨道——重叠状态下
    // 拖动/松手都不与对方换位；一旦与所有贴片分离，立即回到贪心收纳
    // （自动折叠回单轨）。规则使 lane 记忆可以跨提交长期保存而不会
    // 阻碍折叠（分离即失粘）。
    const laneEnds = new Map(), lanes = new Map();
    const sorted = [...clips].sort((a, b) => a.start_ms - b.start_ms || a.id.localeCompare(b.id));
    const ends = sorted.map((clip) => {
      const asset = assets.get(clip.asset_id);
      return asset ? end(clip, asset) : -Infinity;
    });
    const overlapsAny = (index) => sorted.some((_, other) => other !== index
      && sorted[index].start_ms < ends[other] && sorted[other].start_ms < ends[index]);
    for (let index = 0; index < sorted.length; index += 1) {
      const clip = sorted[index];
      if (ends[index] === -Infinity) continue;
      const clipEnd = ends[index];
      const busy = (lane) => (laneEnds.get(lane) ?? -Infinity) > clip.start_ms;
      const sticky = prevLanes?.get(clip.id);
      let lane = Number.isInteger(sticky) && sticky >= 0 && overlapsAny(index) && !busy(sticky)
        ? sticky
        : null;
      if (lane == null) {
        lane = 0;
        while (busy(lane)) lane += 1;
      }
      laneEnds.set(lane, Math.max(laneEnds.get(lane) ?? -Infinity, clipEnd));
      lanes.set(clip.id, lane);
    }
    return { lanes, count: laneEnds.size };
  }
  function audible(extension) {
    const tracks = new Map((extension?.audio_tracks || []).map(t => [t.id, t]));
    return (extension?.audio_clips || []).filter(c => !c.muted && tracks.has(c.track_id) && !tracks.get(c.track_id).muted);
  }
  function protectGaps(gaps, extension) {
    if (extension?.audio_settings?.gap_policy === 'follow') return gaps;
    const assets = new Map((extension?.assets || []).map(a => [a.id, a]));
    const intervals = audible(extension).filter(c => assets.has(c.asset_id))
      .map(c => ({ start: c.start_ms, end: Math.ceil(end(c, assets.get(c.asset_id))) }))
      .sort((a, b) => a.start - b.start);
    if (!intervals.length) return gaps;
    const merged = [];
    for (const interval of intervals) {
      const last = merged.at(-1); if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end); else merged.push({ ...interval });
    }
    const result = []; let first = 0;
    for (const gap of gaps) {
      let cursor = gap.start;
      while (first < merged.length && merged[first].end <= cursor) first++;
      for (let i = first; i < merged.length && merged[i].start < gap.end; i++) {
        const keep = merged[i];
        if (keep.start > cursor) result.push({ ...gap, start: cursor, end: keep.start });
        cursor = Math.max(cursor, keep.end); if (cursor >= gap.end) break;
      }
      if (cursor < gap.end) result.push({ ...gap, start: cursor });
    }
    return result;
  }
  function plan(clip, asset, timeMs, horizonMs = 200) {
    const finish = end(clip, asset), start = Math.max(timeMs, clip.start_ms);
    if (finish <= timeMs || clip.start_ms > timeMs + horizonMs) return null;
    return { when: Math.max(0, (clip.start_ms - timeMs) / 1000),
      offset: clip.source_in_sample / asset.sample_rate + (start - clip.start_ms) / 1000,
      duration: (finish - start) / 1000 };
  }
  function dbColor(db) {
    const ratio = Math.max(0, Math.min(1, (db + 60) / 54));
    return `hsl(${Math.round(215 - ratio * 175)} 48% ${Math.round(18 + ratio * 28)}%)`;
  }
  global.MSWAudio = Object.freeze({ duration, end, levelDb, validate, validTrack, validClip, create, edit, arrange, audible, protectGaps, plan, dbColor });
})(window);
