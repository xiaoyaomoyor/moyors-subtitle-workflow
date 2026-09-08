// Bounded Web Audio cache and cancellable scheduling on the source timeline.
(function (global) {
  'use strict';
  function create({ player, getState, load, changed, hint, frame, beforePlay = () => {}, skipAt = () => null }) {
    let context, epoch = 0, timer, anchor, virtual = null, busy = 0, buffering = null, internalPause = false;
    const buffers = new Map(), heats = new Map(), pending = new Map(), failures = new Map(), nodes = new Map(), queue = [];
    const reportedErrors = new Set();
    const LIMIT = 128 * 1024 * 1024;
    const clock = () => performance.now() / 1000;
    const ctx = () => context ||= new (global.AudioContext || global.webkitAudioContext)();
    const time = () => virtual ? virtual.time + (virtual.playing ? (clock() - virtual.stamp) * 1000 : 0) : player.currentTime * 1000;
    const playing = () => !buffering && (virtual ? virtual.playing : !player.paused && !player.ended && !player.seeking && player.readyState >= 3);
    const reset = () => {
      anchor = null;
      for (const item of nodes.values()) { try { item.source?.stop(); } catch (_) {} item.source?.disconnect(); item.gain?.disconnect(); }
      nodes.clear();
    };
    async function analyze(buffer) {
      const step = Math.max(1, Math.round(buffer.sampleRate / 10)), energy = [], counts = [], db = [];
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
      for (let start = 0; start < buffer.length; start += step) {
        const finish = Math.min(start + step, buffer.length); let sum = 0;
        for (const channel of channels) for (let i = start; i < finish; i++) sum += channel[i] * channel[i];
        energy.push(sum); counts.push((finish - start) * channels.length);
        const lo = Math.max(0, energy.length - 4); let total = 0, count = 0;
        for (let i = lo; i < energy.length; i++) { total += energy[i]; count += counts[i]; }
        db.push(total > 0 ? Math.max(-120, 10 * Math.log10(total / count)) : -120);
        if (energy.length % 32 === 0) await new Promise(resolve => setTimeout(resolve, 0));
      }
      return { step_ms: step / buffer.sampleRate * 1000, db };
    }
    function pump() {
      while (busy < 2 && queue.length) {
        const work = queue.shift(); busy++;
        (async () => {
          try {
            if (work.epoch !== epoch) return work.resolve(null);
            const audioContext = ctx(), estimate = Math.ceil(work.asset.sample_count * audioContext.sampleRate / work.asset.sample_rate) * work.asset.channels * 4;
            if (estimate > LIMIT / 2) throw Error('此素材超出试听解码内存限制，请先裁短源音频');
            const data = await load(work.asset, work.controller.signal);
            if (work.epoch !== epoch) return work.resolve(null);
            const buffer = await audioContext.decodeAudioData(data), heat = await analyze(buffer);
            if (work.epoch !== epoch) return work.resolve(null);
            const bytes = buffer.length * buffer.numberOfChannels * 4;
            let total = [...buffers.values()].reduce((n, item) => n + item.bytes, 0);
            for (const [id, item] of buffers) {
              if (total + bytes <= LIMIT) break;
              if (buffering?.ids.has(id) || [...nodes.values()].some(n => n.assetId === id && !n.done)) continue;
              buffers.delete(id); total -= item.bytes;
            }
            if (total + bytes > LIMIT) throw Error('同时播放的素材超出解码内存限制');
            const item = { buffer, heat, bytes }; buffers.set(work.asset.id, item); heats.set(work.asset.id, heat);
            work.resolve(item); changed();
          } catch (error) {
            if (work.epoch === epoch && error.name !== 'AbortError') {
              failures.set(work.asset.id, error.message); changed();
              if (!reportedErrors.has(error.message)) { reportedErrors.add(error.message); hint(error.message); }
            }
            work.resolve(null);
          } finally {
            if (pending.get(work.asset.id) === work) pending.delete(work.asset.id);
            busy--; pump();
          }
        })();
      }
    }
    function ensure(asset, urgent = false) {
      if (buffers.has(asset.id)) { const item = buffers.get(asset.id); buffers.delete(asset.id); buffers.set(asset.id, item); return Promise.resolve(item); }
      if (failures.has(asset.id)) return Promise.resolve(null);
      if (pending.has(asset.id)) {
        const work = pending.get(asset.id), index = queue.indexOf(work);
        if (urgent && index > 0) { queue.splice(index, 1); queue.unshift(work); }
        return work.promise;
      }
      const work = { asset, epoch, controller: new AbortController() };
      work.promise = new Promise(resolve => { work.resolve = resolve; });
      pending.set(asset.id, work); urgent ? queue.unshift(work) : queue.push(work); pump(); return work.promise;
    }
    function cancelBuffering() { buffering = null; }
    function bufferBeforePlay(assets, now) {
      const ticket = { ids: new Set(assets.map(a => a.id)), epoch };
      buffering = ticket; stop();
      if (virtual) virtual = { time: now, stamp: clock(), playing: false };
      if (!player.paused) { internalPause = true; player.pause(); }
      hint('正在准备配音，加载完成后继续播放'); frame();
      void Promise.all(assets.map(a => ensure(a, true))).then(() => {
        if (buffering !== ticket || ticket.epoch !== epoch) return;
        buffering = null;
        if (virtual) { virtual = { time: now, stamp: clock(), playing: true }; wake(); }
        else void player.play().catch(() => { stop(); frame(); });
        frame();
      });
    }
    function tick() {
      clearTimeout(timer);
      if (!playing()) return;
      const state = getState(), now = time(), audioContext = ctx();
      if (!virtual && player.playbackRate !== 1 && state.audible.length) {
        player.playbackRate = 1; hint('带配音贴片时使用 1× 播放');
      }
      if (virtual && now >= state.end) {
        virtual = { time: state.end, stamp: clock(), playing: false }; reset(); frame(); return;
      }
      const skipped = skipAt(now);
      if (skipped) {
        reset();
        if (virtual) { virtual = { time: skipped.end, stamp: clock(), playing: true }; frame(); timer = setTimeout(tick, 0); }
        else player.currentTime = skipped.end / 1000;
        return;
      }
      const required = state.audible.filter(c => {
        const asset = state.assets.get(c.asset_id);
        return asset && global.MSWAudio.plan(c, asset, now) && !failures.has(asset.id);
      }).map(c => state.assets.get(c.asset_id));
      if (required.some(a => !buffers.has(a.id))) { bufferBeforePlay([...new Map(required.map(a => [a.id, a])).values()], now); return; }
      if (anchor && Math.abs(now - (anchor.media + (audioContext.currentTime - anchor.context) * 1000)) > 100) reset();
      anchor ||= { media: now, context: audioContext.currentTime };
      for (const clip of state.audible) {
        const asset = state.assets.get(clip.asset_id);
        if (!asset || clip.start_ms > now + 5000 || global.MSWAudio.end(clip, asset) <= now) continue;
        const item = buffers.get(asset.id);
        if (!item) { void ensure(asset); continue; }
        if (nodes.has(clip.id)) continue;
        const plan = global.MSWAudio.plan(clip, asset, now);
        if (!plan || audioContext.state !== 'running') continue;
        const source = audioContext.createBufferSource(), gain = audioContext.createGain();
        source.buffer = item.buffer;
        const level = Math.pow(10, global.MSWAudio.levelDb(clip, state.tracks.get(clip.track_id)) / 20);
        gain.gain.value = level * (player.muted ? 0 : player.volume);
        source.connect(gain); gain.connect(audioContext.destination);
        const node = { source, gain, level, assetId: asset.id, done: false }; nodes.set(clip.id, node);
        source.onended = () => {
          node.done = true; source.disconnect(); gain.disconnect(); source.onended = null;
          // Retain only the completion marker. Finished source nodes retain
          // their AudioBuffer and would defeat cache eviction on long projects.
          node.source = null; node.gain = null;
        };
        source.start(audioContext.currentTime + plan.when, plan.offset, plan.duration);
      }
      if (virtual) frame();
      timer = setTimeout(tick, 50);
    }
    function wake() {
      if (buffering) return;
      if (!getState().audible.length) {
        if (virtual) virtual = { time: time(), stamp: clock(), playing: false };
        stop(); frame(); return;
      }
      const audioContext = ctx();
      beforePlay();
      void audioContext.resume().then(tick).catch(() => hint('点击播放以启用配音试听'));
    }
    function stop() { clearTimeout(timer); reset(); }
    function onPause() {
      if (internalPause) { internalPause = false; return; }
      if (!virtual) { cancelBuffering(); stop(); }
    }
    const events = { play: wake, playing: wake, pause: onPause, waiting: stop, seeking: stop,
      seeked: () => { if (playing()) wake(); }, ratechange: () => { reset(); if (playing()) wake(); },
      volumechange: () => { for (const node of nodes.values()) if (node.gain) node.gain.gain.value = node.level * (player.muted ? 0 : player.volume); },
      ended: () => {
        stop(); const state = getState(), end = player.duration * 1000;
        if (state.audible.length && state.end > end) { virtual = { time: end, stamp: clock(), playing: true }; wake(); }
      }, emptied: () => { cancelBuffering(); virtual = null; stop(); } };
    events.seeking = () => { cancelBuffering(); stop(); };
    for (const [event, listener] of Object.entries(events)) player.addEventListener(event, listener);
    return Object.freeze({
      ensure, buffers, heats, failures,
      reset: () => { const resume = !!buffering; cancelBuffering(); reset();
        if (resume) { if (virtual) { virtual.playing = true; virtual.stamp = clock(); } else void player.play().catch(() => {}); }
        if (playing()) wake(); },
      currentTime: () => virtual ? time() : null,
      virtualPlaying: () => buffering ? true : virtual?.playing ?? null,
      pause: () => { cancelBuffering(); if (virtual) virtual = { time: time(), stamp: clock(), playing: false }; player.pause(); stop(); frame(); },
      toggle: () => {
        if (buffering) { cancelBuffering(); stop(); frame(); return true; }
        if (!virtual && Number.isFinite(player.duration) && player.duration > 0) return false;
        const state = getState(); if (!state.audible.length) return false;
        const now = time(); const nextPlaying = !virtual?.playing;
        if (now >= state.end && nextPlaying && Number.isFinite(player.duration) && player.duration > 0) {
          virtual = null; stop(); player.currentTime = 0; void player.play().catch(() => {}); frame(); return true;
        }
        virtual = { time: now >= state.end ? 0 : now || 0, stamp: clock(), playing: nextPlaying };
        stop(); if (nextPlaying) wake(); frame(); return true;
      },
      seek: ms => {
        const mediaEnd = Number.isFinite(player.duration) ? player.duration * 1000 : 0;
        const wasBuffering = !!buffering, wasPlaying = playing() || wasBuffering; cancelBuffering();
        if (ms <= mediaEnd && mediaEnd > 0) {
          if (virtual || wasBuffering) { virtual = null; reset(); if (wasPlaying) queueMicrotask(() => void player.play().catch(() => {})); }
          return false;
        }
        if (!getState().end) return false;
        virtual = { time: ms, stamp: clock(), playing: wasPlaying }; player.pause(); reset(); if (wasPlaying) wake(); frame(); return true;
      },
      clear: () => {
        epoch++; cancelBuffering(); virtual = null; stop();
        for (const work of pending.values()) work.controller.abort();
        for (const work of queue.splice(0)) work.resolve(null);
        pending.clear(); buffers.clear(); heats.clear(); failures.clear(); reportedErrors.clear();
      },
      diagnostics: () => ({ active: [...nodes.values()].filter(n => !n.done).length, decoded: buffers.size, bytes: [...buffers.values()].reduce((n, item) => n + item.bytes, 0), time: time(), virtual: !!virtual, buffering: !!buffering }),
    });
  }
  global.MSWAudioTransport = Object.freeze({ create });
})(window);
