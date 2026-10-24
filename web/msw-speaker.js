// Translation metadata is independent of track roles and reference formats.
(function (global) {
  'use strict';
  function inherit(source, target, colorHead = null) {
    if (source.speaker != null && !target.speaker) target.speaker = source.speaker;
    const color = source.color || colorHead?.color;
    if (color && !target.color && !target.color_ref) {
      target.color = { ...JSON.parse(JSON.stringify(color)), start: target.start, end: target.end };
    }
  }
  const api = { inherit };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.MSWSpeaker = api;
})(typeof window !== 'undefined' ? window : globalThis);
