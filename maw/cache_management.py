"""Media-scoped cache inspection and reversible removal of verified duplicates."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from maw import mopeaks, quapeaks
from maw.output_naming import waveform_dirs, waveform_local_root, audio_track_cache_suffix
from maw.waveform import load_waveform_sidecar, _waveform_sidecar_candidates
from maw.launcher_projects import _registry_file_lock


def cache_lock(media):
    # Keep locks away from the user's project directory; all tracks share one lock.
    return _registry_file_lock(waveform_local_root(media) / 'generation')


def cached_waveform(media, *, audio_track=0, default_audio_track=0):
    media = Path(media)
    options = dict(audio_track=audio_track, default_audio_track=default_audio_track)
    for reader in (quapeaks.load_self_wave_payload, mopeaks.load_mopeaks):
        value = reader(media, **options)
        if value and value.get('audio_track', 0) == audio_track:
            return value
    return load_waveform_sidecar(media, audio_track=audio_track)


def _stamp(path):
    stat = path.stat()
    return [str(path.resolve()), stat.st_size, stat.st_mtime_ns]


def _inspect(media, tracks, default_audio_track):
    media = Path(media).resolve(strict=True)
    state = [_stamp(media)]
    rows, removable = [], []
    for track in sorted(set(tracks)):
        options = dict(audio_track=track, default_audio_track=default_audio_track)
        complete = quapeaks.find_self_wave_container(media, **options)
        full = quapeaks.load_self_wave_payload(media, **options) if complete else None
        if complete and full:
            state.append(_stamp(complete))
            rows.append(dict(name=complete.name, track=track + 1, bytes=complete.stat().st_size,
                             removable=False, reason='完整缓存，保留'))
        suffix = audio_track_cache_suffix(track, default_audio_track=default_audio_track)
        candidates = [p / (media.name + suffix + '.mopeaks') for p in waveform_dirs(media)]
        if track == default_audio_track:
            candidates += _waveform_sidecar_candidates(media)
        for path in dict.fromkeys(candidates):
            if not path.is_file() or path.is_symlink() or path.resolve().parent != path.parent.resolve():
                continue
            state.append(_stamp(path))
            if path.suffix == '.mopeaks':
                value = mopeaks.read_mopeaks(path, media, audio_track=track)
            else:
                try:
                    from maw.waveform import waveform_matches_media
                    value = json.loads(path.read_text(encoding='utf-8'))
                    if not waveform_matches_media(value, media, audio_track=track):
                        value = None
                except (OSError, ValueError):
                    value = None
            # Comparing actual peaks prevents removal of higher-resolution/custom envelopes.
            duplicate = bool(full and value and full['data'] == value['data']
                             and full['peak_count'] == value['peak_count']
                             and full.get('sample_rate') == value.get('sample_rate')
                             and full.get('division') == value.get('division'))
            rows.append(dict(name=path.name, track=track + 1, bytes=path.stat().st_size,
                             removable=duplicate, reason='已包含在完整缓存中' if duplicate else '回退或不同数据，保留'))
            if duplicate:
                removable.append(path)
    token = hashlib.sha256(json.dumps([state, rows, default_audio_track], sort_keys=True).encode()).hexdigest()
    return dict(media=media.name, files=rows, token=token, count=len(removable),
                bytes=sum(p.stat().st_size for p in removable)), removable


def manage(media, *, tracks=(0,), default_audio_track=0, token=None):
    """No caller-provided deletion paths. Recheck the authoritative scan before trashing."""
    with cache_lock(media):
        report, removable = _inspect(media, tracks, default_audio_track)
        if token is None:
            return report
        if token != report['token']:
            raise ValueError('媒体或缓存已改变，请重新分析')
        from send2trash import send2trash
        removed = 0
        warnings = []
        for path in removable:
            try:
                send2trash(str(path))
                removed += 1
            except OSError:
                warnings.append(f'{path.name}：未能移入回收站，已保留')
        result, _ = _inspect(media, tracks, default_audio_track)
        return {**result, 'removed': removed, 'warnings': warnings}
