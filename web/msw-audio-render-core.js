// Versioned render contract. Times are on the source timeline; output positions
// are integer sample frames. No DOM, HTTP, media decoding or project mutations.
(function (global) {
  'use strict';
  const VERSION = 'msw.audio-render.v1', MAX_MS = 12 * 60 * 60 * 1000;
  function integer(value, min, max, label) {
    if (!Number.isInteger(value) || value < min || value > max) throw Error(label);
    return value;
  }
  function gain(value) {
    if (!Number.isFinite(value) || value < -60 || value > 12) throw Error('导出音量无效');
    return value;
  }
  function options(raw = {}) {
    const out = { mode: 'voice', sample_rate: 48000, duration_ms: 0, start_ms: 0, end_ms: null,
      remove_gaps: false, source_audio_index: 0, source_gain_db: 0, voice_gain_db: 0, peak_protection: true, ...raw };
    if (!['voice', 'mix'].includes(out.mode) || ![44100, 48000].includes(out.sample_rate)) throw Error('音频导出格式无效');
    for (const key of ['remove_gaps', 'peak_protection']) if (typeof out[key] !== 'boolean') throw Error('音频导出选项无效');
    integer(out.duration_ms, 0, MAX_MS, '工程时长超过音频导出范围');
    integer(out.start_ms, 0, MAX_MS, '导出起点无效');
    if (out.end_ms !== null) integer(out.end_ms, 1, MAX_MS, '导出终点无效');
    integer(out.source_audio_index, 0, 127, '原声音轨无效');
    gain(out.source_gain_db); gain(out.voice_gain_db);
    if (out.monitor !== undefined) monitorGains(out);
    return out;
  }
  function monitorGains(o) {
    const m=o.monitor;
    if (m === undefined) return {source:o.source_gain_db,voice:o.voice_gain_db,sourceMuted:false,voiceMuted:false};
    if (!m || typeof m !== 'object') throw Error('试听音量快照无效');
    if (!['none','source','voice','both'].includes(m.mode)||typeof m.muted!=='boolean'||!Number.isFinite(m.volume)||m.volume<0||m.volume>1)throw Error('试听音量快照无效');
    gain(m.source_gain_db);
    const source=['source','both'].includes(m.mode),voice=['voice','both'].includes(m.mode),db=m.volume>0?20*Math.log10(m.volume):0;
    return {source:source?m.source_gain_db+db:o.source_gain_db,voice:voice?db:o.voice_gain_db,
      sourceMuted:source&&(m.muted||m.volume===0),voiceMuted:voice&&(m.muted||m.volume===0)};
  }
  function removedRanges(project) {
    const gaps = project.gap_remove?.gaps || [];
    if (!Array.isArray(gaps) || gaps.length > 50000) throw Error('空隙数据无效');
    const sorted = gaps.map(g => {
      integer(g.start, 0, 1e12, '空隙时间无效'); integer(g.end, g.start + 1, 1e12, '空隙时间无效');
      if (g.removed !== undefined && typeof g.removed !== 'boolean') throw Error('空隙状态无效');
      return g;
    }).filter(g => g.removed !== false).sort((a, b) => a.start - b.start || a.end - b.end);
    const merged = [];
    for (const g of sorted) {
      const last = merged.at(-1);
      if (last && g.start <= last.end) last.end = Math.max(last.end, g.end);
      else merged.push({ start: g.start, end: g.end });
    }
    return merged;
  }
  // A video's native audio/container tail is not authored timeline content.
  // Keep this contract aligned with video_render.video_options.
  function videoOptions(project, raw, info, applyTail = true) {
    const out = options(raw), videoEnd = info?.video?.duration_ms;
    if (!Number.isSafeInteger(videoEnd) || videoEnd <= 0) return out;
    out.duration_ms = videoEnd;
    for (const track of project.multi_subtitle?.tracks || [])
      for (const cue of track.segments || []) out.duration_ms = Math.max(out.duration_ms, cue.end);
    if (out.end_ms !== null) out.duration_ms = Math.max(out.duration_ms, out.end_ms);
    if (out.video_tail === 'freeze') out.duration_ms = Math.max(out.duration_ms, info.duration_ms || 0);
    if (applyTail && out.video_tail === 'truncate') out.end_ms = Math.min(out.end_ms ?? Infinity, videoEnd);
    return out;
  }
  function compile(project, rawOptions = {}) {
    const o = options(rawOptions), ext = project.msw || {}, core = global.MSWAudio;
    const levels = monitorGains(o);
    core.validate(ext);
    const assets = new Map((ext.assets || []).map(a => [a.id, a]));
    const tracks = new Map((ext.audio_tracks || []).map(t => [t.id, t]));
    const clips = ext.audio_clips || [];
    const subtitleSegments = [...(project.segments || []),
      ...(project.overlay_track?.enabled === true ? project.overlay_track.segments || [] : []),
      ...(project.multi_subtitle?.enabled === true ? (project.multi_subtitle.tracks || []).flatMap(track => track.segments || []) : [])];
    const duration = clips.reduce((n, c) => Math.max(n, Math.ceil(core.end(c, assets.get(c.asset_id)))),
      subtitleSegments.reduce((n, s) => Math.max(n, s.end), o.duration_ms));
    integer(duration, 1, MAX_MS, '没有有效的音频导出范围，或工程超过 12 小时');
    const finish = o.end_ms === null ? duration : Math.min(o.end_ms, duration);
    if (o.start_ms >= finish) throw Error('导出终点必须晚于起点');
    const removed = o.remove_gaps ? core.protectGaps(removedRanges(project), ext) : [];
    const intervals = []; let cursor = o.start_ms, output = 0;
    const keep = (start, end) => {
      if (end > start) { intervals.push({ start_ms: start, end_ms: end, output_start_ms: output }); output += end - start; }
    };
    for (const gap of removed) {
      if (gap.end <= cursor || gap.start >= finish) continue;
      keep(cursor, Math.min(finish, gap.start)); cursor = Math.min(finish, Math.max(cursor, gap.end));
    }
    keep(cursor, finish);
    if (!output) throw Error('移除空隙后没有剩余音频');
    const frame = ms => Math.round(ms * o.sample_rate / 1000), pieces = [];
    for (const c of core.audible(ext)) {
      const a = assets.get(c.asset_id), end = core.end(c, a);
      let left = 0, right = intervals.length;
      while (left < right) { const mid = (left + right) >>> 1; if (intervals[mid].end_ms <= c.start_ms) left = mid + 1; else right = mid; }
      for (let i = left; i < intervals.length; i++) {
        const k = intervals[i];
        if (k.end_ms <= c.start_ms) continue;
        if (k.start_ms >= end) break;
        const lo = Math.max(k.start_ms, c.start_ms), hi = Math.min(k.end_ms, end);
        const start = frame(k.output_start_ms + lo - k.start_ms), finish = frame(k.output_start_ms + hi - k.start_ms);
        const sourceIn = Math.max(c.source_in_sample, Math.round(c.source_in_sample + (lo - c.start_ms) * a.sample_rate / 1000));
        const sourceOut = Math.min(c.source_out_sample, Math.round(c.source_in_sample + (hi - c.start_ms) * a.sample_rate / 1000));
        if (finish <= start || sourceOut <= sourceIn) continue;
        pieces.push({ clip_id: c.id, asset_id: a.id, source_in_sample: sourceIn, source_out_sample: sourceOut,
          output_start_sample: start, output_end_sample: finish, gain_db: core.levelDb(c, tracks.get(c.track_id)) + levels.voice,
          ...(levels.voiceMuted?{muted:true}:{}) });
        if (pieces.length > 100000) throw Error('空隙切分产生过多音频片段，请缩小导出范围');
      }
    }
    pieces.sort((a, b) => a.output_start_sample - b.output_start_sample || (a.clip_id < b.clip_id ? -1 : a.clip_id > b.clip_id ? 1 : 0));
    return { schema: VERSION, sample_rate: o.sample_rate, channels: 2, sample_count: frame(output),
      source_start_ms: o.start_ms, source_end_ms: finish, gap_policy: ext.audio_settings?.gap_policy || 'protect',
      intervals, pieces, source: o.mode === 'mix' ? { audio_index: o.source_audio_index, gain_db: levels.source,...(levels.sourceMuted?{muted:true}:{}) } : null,
      peak_protection: o.peak_protection };
  }
  global.MSWAudioRender = Object.freeze({ VERSION, options, monitorGains, videoOptions, removedRanges, compile });
})(window);
