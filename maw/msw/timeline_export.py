"""Editable OTIOZ: independent audio clips, portable references and provenance.

Gain is baked into float WAV derivatives, keeping headroom before the NLE's
final mix. Original TTS WAVs remain available for relinking and further edits.
"""

from collections import defaultdict
import copy
import hashlib
import heapq
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
import zipfile

from maw.msw.audio_plan import compile_plan, round_sample
from maw.msw.audio_render import check_cancel, command_prefix, fingerprint, render, run
from maw.msw.video_render import frame_rate
from maw.msw.subtitle_export import mapped_subtitles, srt


def editable_plan(project, plan):
    """Include muted clips without allowing them to change gap protection."""
    snapshot = copy.deepcopy(project)
    for item in snapshot['msw'].get('audio_clips', []) + snapshot['msw'].get('audio_tracks', []):
        item['muted'] = False
    snapshot['msw'].setdefault('audio_settings', {})['gap_policy'] = 'follow'
    gaps, cursor = [], plan['source_start_ms']
    for interval in plan['intervals']:
        if cursor < interval['start_ms']:
            gaps.append(dict(start=cursor, end=interval['start_ms'], removed=True))
        cursor = interval['end_ms']
    if cursor < plan['source_end_ms']:
        gaps.append(dict(start=cursor, end=plan['source_end_ms'], removed=True))
    snapshot['gap_remove'] = dict(gaps=gaps)
    return compile_plan(snapshot, dict(duration_ms=plan['source_end_ms'], start_ms=plan['source_start_ms'],
                        end_ms=plan['source_end_ms'], sample_rate=plan['sample_rate'], remove_gaps=True))


def time(value, rate):
    return dict(OTIO_SCHEMA='RationalTime.1', value=value, rate=rate)


def time_range(start, duration, rate):
    return dict(OTIO_SCHEMA='TimeRange.1', start_time=time(start, rate), duration=time(duration, rate))


def gap(duration, rate):
    return dict(OTIO_SCHEMA='Gap.1', name='', metadata={}, source_range=time_range(0, duration, rate), effects=[], markers=[])


def track(name, kind):
    return dict(OTIO_SCHEMA='Track.1', name=name, kind=kind, metadata={}, source_range=None,
                effects=[], markers=[], enabled=True, children=[])


def clip(name, url, start, duration, rate, *, available=None, metadata=None, muted=False):
    return dict(OTIO_SCHEMA='Clip.2', name=name, metadata=metadata or {},
                source_range=time_range(start, duration, rate), effects=[], markers=[], enabled=not muted,
                media_references={'DEFAULT_MEDIA': dict(OTIO_SCHEMA='ExternalReference.1', name=name,
                    metadata={}, target_url=url, available_range=time_range(0, available or duration, rate))},
                active_media_reference_key='DEFAULT_MEDIA')


def build_timeline(project, plan, pieces, references, source_url, info, source_audio):
    rate, length = plan['sample_rate'], plan['sample_count']
    tracks = []
    video = info.get('video')
    if source_url and video:
        picture = track('视频', 'Video')
        fps = float(frame_rate(video))
        for k in plan['intervals']:
            end = min(k['end_ms'], video['duration_ms'])
            if end > k['start_ms']:
                picture['children'].append(clip('原视频', source_url, k['start_ms'] * fps / 1000,
                    (end - k['start_ms']) * fps / 1000, fps, available=video['duration_ms'] * fps / 1000))
            tail = k['end_ms'] - max(k['start_ms'], end)
            if tail > 0:
                picture['children'].append(gap(tail * rate / 1000, rate))
        tracks.append(picture)
    if source_audio:
        original = track('原声', 'Audio')
        original['metadata'] = dict(msw=dict(source_audio_index=plan['source']['audio_index']))
        for url, frames in source_audio:
            original['children'].append(clip('原声', url, 0, frames, rate))
        tracks.append(original)
    clip_map = {c['id']: c for c in project['msw'].get('audio_clips', [])}
    track_map = {t['id']: t for t in project['msw'].get('audio_tracks', [])}
    lanes, queues = defaultdict(list), defaultdict(list)
    for piece in pieces:
        c = clip_map[piece['clip_id']]
        group = c['track_id']
        start, end = piece['output_start_sample'], piece['output_end_sample']
        if queues[group] and queues[group][0][0] <= start:
            previous, lane = heapq.heappop(queues[group])
        else:
            previous, lane = 0, len(lanes[group])
            if lane >= 256:
                raise ValueError('同时重叠的音频过多，剪辑工程每个配音轨最多导出 256 个子轨')
            lanes[group].append(track(f"{track_map[group]['name']} {lane + 1}", 'Audio'))
        children = lanes[group][lane]['children']
        if start > previous:
            children.append(gap(start - previous, rate))
        muted = c['muted'] or track_map[group]['muted']
        metadata = dict(msw=dict(clip_id=c['id'], asset_id=c['asset_id'], source_in_sample=piece['source_in_sample'],
            source_out_sample=piece['source_out_sample'], gain_db=piece['gain_db'], muted=muted,
            original=f"originals/{c['asset_id']}.wav"))
        children.append(clip(c['label'], references[id(piece)], 0, end - start, rate, metadata=metadata, muted=muted))
        heapq.heappush(queues[group], (end, lane))
    for group in lanes:
        for end, index in queues[group]:
            if end < length:
                lanes[group][index]['children'].append(gap(length - end, rate))
        tracks.extend(lanes[group])
    if not tracks:
        empty = track('配音', 'Audio')
        empty['children'].append(gap(length, rate))
        tracks.append(empty)
    markers = []
    for name, cues in mapped_subtitles(project, plan):
        for c in cues:
            markers.append(dict(OTIO_SCHEMA='Marker.2', name=c['text'], color='BLUE',
                metadata=dict(msw=dict(subtitle_track=name)), marked_range=time_range(c['start'], c['end'] - c['start'], 1000)))
    return dict(OTIO_SCHEMA='Timeline.1', name='MSW 配音剪辑工程', global_start_time=time(0, rate),
                metadata=dict(msw=dict(schema='msw.otio-bundle.v1', gap_policy=plan['gap_policy'])),
                tracks=dict(OTIO_SCHEMA='Stack.1', name='tracks', source_range=None, metadata={},
                            effects=[], markers=markers, enabled=True, children=tracks))


def render_bundle(project, plan, output, tools, cancel, progress, resolve_asset, *, source, source_channels, info, settings):
    output = Path(output)
    stamp = fingerprint(source) if source else None
    edited = editable_plan(project, plan)
    pieces = edited['pieces']
    if len(pieces) > 10000:
        raise ValueError('剪辑工程包含过多音频片段，请分段导出')
    # editable_plan retains timing, but the user's master gain belongs to this
    # export rather than the project. Apply it once to each derivative.
    for p in pieces:
        p['gain_db'] += settings['voice_gain_db']
    asset_map = {a['id']: a for a in project['msw'].get('assets', [])}
    needed = plan['sample_count'] * 12 + sum(p['output_end_sample'] - p['output_start_sample'] for p in pieces) * 8
    needed += sum(asset_map[key]['byte_size'] for key in {p['asset_id'] for p in pieces})
    if source:
        needed += (plan['source_end_ms'] * plan['sample_rate'] // 1000) * 8
        if settings['collect_media'] and info.get('video'):
            needed += Path(source).stat().st_size
    if shutil.disk_usage(output.parent).free < needed + 512 * 1024**2:
        raise ValueError('剪辑工程打包空间不足，请取消收集原视频、缩小范围或释放空间')
    with tempfile.TemporaryDirectory(prefix=f'render-{output.stem}-', dir=output.parent) as temporary:
        root = Path(temporary)
        mix = root / 'reference.wav'
        result = render(plan, mix, tools.ffmpeg, cancel, lambda stage, f: progress(stage, f * .35), resolve_asset,
                        source=source if plan['source'] else None, source_channels=source_channels, allow_silence=True)
        target = root / 'result.otioz'
        references, provenance, original_parts = {}, [], []
        with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
            def add(path, name, expected_hash=None):
                before = fingerprint(path)
                digest = hashlib.sha256()
                with Path(path).open('rb') as src, archive.open(name, 'w', force_zip64=True) as dst:
                    while data := src.read(256 * 1024):
                        check_cancel(cancel)
                        digest.update(data)
                        dst.write(data)
                if fingerprint(path) != before or (expected_hash and digest.hexdigest() != expected_hash):
                    raise ValueError('工程素材在打包期间发生变化，请重新导出')

            add(mix, 'reference/mix.wav')
            mix.unlink()
            def decode(path, proxy, *, original=False, channels=0):
                filters = f"aresample={plan['sample_rate']}" + (':async=1:first_pts=0' if original else '')
                if channels == 1:
                    filters += ',pan=stereo|c0=c0|c1=c0'
                cmd = command_prefix(tools.ffmpeg) + ['-protocol_whitelist', 'file,pipe', '-threads', '1']
                if not original:
                    cmd += ['-f', 'wav']
                cmd += ['-i', str(path), '-map', f"0:a:{plan['source']['audio_index']}" if original else '0:a:0',
                        '-vn', '-sn', '-dn', '-af', filters, '-ar', str(plan['sample_rate']), '-ac', '2', '-c:a', 'pcm_f32le']
                if original:
                    cmd += ['-t', f"{plan['source_end_ms'] / 1000:.9f}"]
                run(cmd + ['-f', 'f32le', str(proxy)], cancel)

            def derivative(proxy, start, end, frames, gain, name, *, muted=False):
                dest = root / 'piece.wav'
                filters = (f'atrim=start_sample={start}:end_sample={end},asetpts=PTS-STARTPTS,'
                           f"volume={0 if muted else 10 ** ((gain + result['attenuation_db']) / 20):.15g}:precision=double,"
                           f'apad=whole_len={frames},atrim=end_sample={frames}')
                run(command_prefix(tools.ffmpeg) + ['-f', 'f32le', '-ar', str(plan['sample_rate']), '-ac', '2', '-i', str(proxy),
                    '-af', filters, '-map_metadata', '-1', '-c:a', 'pcm_f32le', str(dest)], cancel)
                add(dest, name)
                dest.unlink()

            proxy = root / 'input.f32'
            grouped = defaultdict(list)
            for p in pieces:
                grouped[p['asset_id']].append(p)
            clip_map = {c['id']: c for c in project['msw'].get('audio_clips', [])}
            track_map = {t['id']: t for t in project['msw'].get('audio_tracks', [])}
            completed = 0
            for asset_id, group in grouped.items():
                check_cancel(cancel)
                asset, path = resolve_asset(asset_id)
                asset_stamp = fingerprint(path)
                add(path, f'originals/{asset_id}.wav', asset['sha256'])
                decode(path, proxy, channels=asset['channels'])
                if fingerprint(path) != asset_stamp:
                    raise ValueError('音频素材在导出期间发生变化，请重新导出')
                expected = round_sample(asset['sample_count'] * plan['sample_rate'] / asset['sample_rate'])
                if proxy.stat().st_size % 8 or abs(proxy.stat().st_size // 8 - expected) > 2:
                    raise ValueError('音频素材解码长度与工程记录不一致')
                provenance.append({**asset, 'path': f'originals/{asset_id}.wav'})
                for p in group:
                    c = clip_map[p['clip_id']]
                    name = f'media/voice-{completed:06}.wav'
                    derivative(proxy, round_sample(p['source_in_sample'] * plan['sample_rate'] / asset['sample_rate']),
                               round_sample(p['source_out_sample'] * plan['sample_rate'] / asset['sample_rate']),
                               p['output_end_sample'] - p['output_start_sample'], p['gain_db'], name,
                               muted=c['muted'] or track_map[c['track_id']]['muted'])
                    references[id(p)] = name
                    completed += 1
                    progress('packaging', .35 + .4 * completed / max(1, len(pieces)))
                proxy.unlink()
            if plan['source']:
                decode(source, proxy, original=True, channels=source_channels)
                for i, k in enumerate(plan['intervals']):
                    frames = (round_sample((k['output_start_ms'] + k['end_ms'] - k['start_ms']) * plan['sample_rate'] / 1000)
                              - round_sample(k['output_start_ms'] * plan['sample_rate'] / 1000))
                    name = f'media/original-{i:06}.wav'
                    derivative(proxy, round_sample(k['start_ms'] * plan['sample_rate'] / 1000),
                               round_sample(k['end_ms'] * plan['sample_rate'] / 1000), frames, plan['source']['gain_db'], name)
                    original_parts.append((name, frames))
                    progress('packaging', .75 + .15 * (i + 1) / len(plan['intervals']))
                proxy.unlink()
            source_url = None
            if source and info.get('video'):
                if settings['collect_media']:
                    suffix = Path(source).suffix.lower()
                    suffix = suffix if re.fullmatch(r'\.[a-z0-9]{1,8}', suffix) else '.media'
                    source_url = 'media/source' + suffix
                    progress('packaging', .92)
                    add(source, source_url)
                else:
                    source_url = Path(source).resolve().as_uri()
            timeline = build_timeline(project, plan, pieces, references, source_url, info, original_parts)
            archive.writestr('content.otio', json.dumps(timeline, ensure_ascii=False, indent=2) + '\n')
            archive.writestr('version.txt', '1.0.0')
            archive.writestr('msw-export.json', json.dumps(dict(schema='msw.otio-bundle.v1', options=settings, plan=plan,
                assets=provenance, audio_clips=project['msw'].get('audio_clips', []),
                attenuation_db=result['attenuation_db']), ensure_ascii=False, indent=2) + '\n')
            for i, (_, cues) in enumerate(mapped_subtitles(project, plan)):
                archive.writestr(f'subtitles/track-{i + 1}.srt', srt(cues).encode('utf-8-sig'))
            archive.writestr('README.txt', 'MSW OTIOZ\nImport content.otio after extraction if your editor cannot open OTIOZ.\n'
                'Keep media/ beside content.otio. Audio gain and peak attenuation are baked into float WAV clips.\n'
                'Muted clips contain silence; originals/ retains the original TTS for relinking.\n'
                'reference/mix.wav is a listening reference, not an extra timeline track.\n'
                'Subtitles are markers and separate SRT files; visual subtitle styling and stickers are not rendered.\n'
                'Picture ends at the source media end; voice can continue over an empty video region.\n'
                'msw-export.json records export provenance; it is not an MSW save file.\n')
        if source and fingerprint(source) != stamp:
            raise ValueError('原媒体在打包期间发生变化，请重新导出')
        check_cancel(cancel)
        result.update(byte_size=target.stat().st_size, format='otioz', editable_clip_count=len(pieces),
                      external_media=bool(source_url and source_url.startswith('file:')))
        os.replace(target, output)
        return result
