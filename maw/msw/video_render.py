"""MP4 export over the canonical audio plan, with continuous encoding per retained interval."""

from fractions import Fraction
from pathlib import Path
import math
import os
import tempfile

from maw.msw.audio_plan import compile_plan, round_sample, options
from maw.msw.audio_render import check_cancel, command_prefix, fingerprint, probe_source, render, run
from maw.msw.subtitle_export import burning_cues, slice_burning_cues
from maw.postprocess_ffmpeg import build_subtitle_filter
from maw.msw.subtitle_style import styled_ass
from maw.msw.video_encoders import LABELS, choose_encoder, cpu_threads, encoder_args

# A continuous interval needs only one encoder invocation. Streaming keeps memory
# bounded without restarting libass/the codec every 30 seconds.
CHUNK_SECONDS = 12 * 3600


def frame_rate(video):
    try:
        rate = Fraction(video.get("frame_rate") or "30")
        if 1 <= rate <= 240:
            return rate
    except (ValueError, ZeroDivisionError):
        pass
    return Fraction(30)


def audio_end(project, settings, info):
    """End of the selected audio content on the source timeline, before gap cuts."""
    from maw.msw.audio_plan import clip_end
    ext = project.get('msw') or {}
    assets = {a['id']: a for a in ext.get('assets', [])}
    tracks = {t['id']: t for t in ext.get('audio_tracks', [])}
    end = 0
    if settings['mode'] == 'mix':
        selected = next((t for t in info.get('audio_tracks', [])
                         if t['audio_index'] == settings['source_audio_index']), None)
        if selected:
            end = selected.get('duration_ms', info.get('duration_ms', 0))
    for clip in ext.get('audio_clips', []):
        if not clip['muted'] and not tracks[clip['track_id']]['muted']:
            end = max(end, math.ceil(clip_end(clip, assets[clip['asset_id']])))
    return end


def video_options(project, settings, info):
    """Contract: MSWAudioRender.videoOptions; user range caps either alignment."""
    settings = options(settings)
    policy = settings.setdefault('video_tail', 'truncate')
    end = info['video']['duration_ms']
    if policy in {'freeze', 'black'}:
        end = audio_end(project, settings, info)
        if end <= settings['start_ms']:
            raise ValueError('所选范围内没有音频内容，请选择对齐至视频或调整范围')
    settings['duration_ms'] = end
    if policy != 'ask':
        settings['end_ms'] = min(settings['end_ms'] if settings['end_ms'] is not None else end, end)
    else:
        # Keep old clients' explicit overflow confirmation, absent from the new UI.
        for track in (project.get('multi_subtitle') or {}).get('tracks', []):
            for cue in track.get('segments', []):
                if project.get('schema') == 'msw.project.v2' and (cue.get('disabled') or not project['multi_subtitle'].get('enabled')):
                    continue
                settings['duration_ms'] = max(settings['duration_ms'], cue['end'])
        if settings['end_ms'] is not None:
            settings['duration_ms'] = max(settings['duration_ms'], settings['end_ms'])
    return settings


def prepare(project, settings, info):
    video = info.get("video")
    if not video or video["duration_ms"] <= 0:
        raise ValueError("原媒体没有可导出的视频画面，请使用导出音频")
    settings = video_options(project, settings, info)
    plan = compile_plan(project, settings)
    if plan["source_end_ms"] > video["duration_ms"]:
        if settings["video_tail"] == "ask":
            raise ValueError("导出范围超出画面尾部，请选择截断到画面结尾或定格延长画面")
        if settings["video_tail"] == "truncate":
            settings["end_ms"] = video["duration_ms"]
            plan = compile_plan(project, settings)
    return plan


def can_copy(plan, video, settings):
    return (settings.get('burn_subtitles', 'none') == 'none'
            and settings["video_encoding"] == "auto" and video["codec"] == "h264"
            and video["pixel_format"] == "yuv420p" and len(plan["intervals"]) == 1
            and plan["source_start_ms"] == 0
            and abs(plan["source_end_ms"] - video["duration_ms"]) <= 1)


def encode_frames(command, cancel, *, cwd, frames, on_frame):
    """Read FFmpeg progress without a blocking pipe or sharing its file cursor."""
    path = cwd / 'encoding-progress.txt'
    with path.open('wb') as output, path.open('rb') as updates:
        pending = b''
        last = 0

        def tick():
            nonlocal pending, last
            pending += updates.read(65536)
            lines = pending.split(b'\n')
            pending = lines.pop()
            for line in lines:
                if line.startswith(b'frame='):
                    try:
                        frame = min(frames, max(0, int(line[6:])))
                    except ValueError:
                        continue
                    if frame > last:
                        last = frame
                        on_frame(frame)

        run(command[:1] + ['-progress', 'pipe:1', '-stats_period', '0.5', '-nostats'] + command[1:],
            cancel, stdout=output, on_tick=tick, cwd=cwd, timeout=12*3600,
            failure_message='视频编码或字幕烧录失败，请检查编码器、系统字体、FFmpeg 的 libass 支持及磁盘空间')


def encode_picture(plan, root, tools, cancel, progress, source, video, rate, captions, project, settings, encoder, duration):
    progress('video', .55)
    listing = root / "parts.ffconcat"
    count, completed = 0, 0
    total_frames = max(1, round_sample(duration * float(rate)))
    # Quantize cumulative output boundaries, never round each cut's
    # duration independently: many short gaps must not accumulate drift.
    with listing.open("w", encoding="utf-8", newline="\n") as manifest:
        manifest.write("ffconcat version 1.0\n")
        for interval in plan["intervals"]:
            begin = round_sample(interval["output_start_ms"] * float(rate) / 1000)
            end = round_sample((interval["output_start_ms"] + interval["end_ms"] - interval["start_ms"]) * float(rate) / 1000)
            while begin < end:
                check_cancel(cancel)
                frames = min(end - begin, max(1, math.floor(CHUNK_SECONDS * float(rate))))
                at = interval["start_ms"] / 1000 + begin / float(rate) - interval["output_start_ms"] / 1000
                # Seek near the source point. For tail-only pieces read
                # the last source second and clone its final frame.
                seek = max(0, min(at, video["duration_ms"] / 1000 - 1))
                offset = max(0, at - seek)
                piece = root / f"part-{count}.mp4"
                filters = (f"setpts=PTS-STARTPTS,fps={rate},"
                           f"tpad=start_duration={max(0, video.get('start_ms', 0) / 1000 - seek):.9f}:"
                           f"stop_mode={'add' if settings.get('video_tail') == 'black' else 'clone'}:"
                           f"color=black:stop_duration={offset + frames / float(rate) + 1:.9f},"
                           f"trim=start={offset:.9f},setpts=PTS-STARTPTS,"
                           "pad=ceil(iw/2)*2:ceil(ih/2)*2,format=yuv420p")
                local_captions = slice_burning_cues(captions, begin * 1000 / float(rate), (begin + frames) * 1000 / float(rate))
                if local_captions:
                    subtitle = root / 'subtitles.ass'
                    subtitle.write_text(styled_ass(project,plan,settings['burn_subtitles'],video,
                        start_ms=begin*1000/float(rate),end_ms=(begin+frames)*1000/float(rate)),encoding='utf-8-sig',newline='\n')
                    filters += ',' + build_subtitle_filter(subtitle)
                encode_frames(command_prefix(tools.ffmpeg) + ["-protocol_whitelist", "file,pipe", "-ss", f"{seek:.9f}",
                    "-threads", str(cpu_threads()), "-i", str(source), "-map", f"0:{video['index']}", "-an", "-sn", "-dn",
                    "-vf", filters, "-frames:v", str(frames), *encoder_args(encoder), "-video_track_timescale", str(rate.numerator), str(piece)], cancel,
                    cwd=root, frames=frames, on_frame=lambda frame: progress('video', .55 + .37 * (completed + frame) / total_frames))
                # Very short MP4 segments may report a rounded duration.
                # Explicit frame-derived lengths avoid concat DTS drift;
                # no B-frame reordering across independently encoded cuts.
                manifest.write(f"file '{piece.name}'\nduration {frames / float(rate):.12f}\n")
                begin += frames
                completed += frames
                count += 1
                progress("video", .55 + .37 * completed / total_frames)
    picture = root / "picture.mp4"
    run(command_prefix(tools.ffmpeg) + ["-f", "concat", "-safe", "1", "-i", str(listing),
        "-map", "0:v:0", "-c:v", "copy", "-an", str(picture)], cancel)
    return picture


def render_video(plan, output, tools, cancel, progress, resolve_asset, *, source, source_channels, info, settings, project=None, on_encoding=None):
    output = Path(output)
    stamp = fingerprint(source)
    video = info["video"]
    copied = can_copy(plan, video, settings)
    encoder, encoding_note = "copy", ""
    rate = frame_rate(video)
    captions = burning_cues(project or {}, plan, settings.get('burn_subtitles', 'none'))
    if not copied and video.get("color_transfer") in {"smpte2084", "arib-std-b67"}:
        raise ValueError("当前重新编码暂不支持 HDR 色彩转换，请导出完整原画面或先转换为 SDR")
    duration = plan["sample_count"] / plan["sample_rate"]
    if round_sample(duration * float(rate)) < 1:
        raise ValueError("视频导出范围短于一帧，请扩大范围")
    if not copied:
        encoder, encoding_note = choose_encoder(settings, tools.ffmpeg, cancel)
    if on_encoding:
        on_encoding(encoder, encoding_note)
    with tempfile.TemporaryDirectory(prefix=f"render-{output.stem}-", dir=output.parent) as temporary:
        root = Path(temporary)
        audio = root / "mix.wav"
        result = render(plan, audio, tools.ffmpeg, cancel, lambda stage, f: progress(stage, f * .55),
                        resolve_asset, source=source if plan["source"] else None,
                        source_channels=source_channels, allow_silence=True)
        picture = source
        if not copied:
            try:
                picture = encode_picture(plan, root, tools, cancel, progress, source, video, rate, captions, project, settings, encoder, duration)
            except ValueError as error:
                check_cancel(cancel)
                if settings.get('video_encoding') != 'auto' or encoder == 'libx264':
                    raise
                # Restart the video stage uniformly; never concatenate different
                # codec configurations after a driver fails midway through a job.
                encoding_note = f'{LABELS[encoder]} 编码未完成，已改用软件编码（CPU）重新编码'
                encoder = 'libx264'
                if on_encoding:
                    on_encoding(encoder, encoding_note)
                try:
                    picture = encode_picture(plan, root, tools, cancel, progress, source, video, rate, captions, project, settings, encoder, duration)
                except ValueError as retry_error:
                    raise retry_error from error
        progress("muxing", .94)
        target = root / "result.mp4"
        run(command_prefix(tools.ffmpeg) + ["-protocol_whitelist", "file,pipe", "-i", str(picture), "-i", str(audio),
            "-map", f"0:{video['index']}" if copied else "0:v:0", "-map", "1:a:0", "-c:v", "copy",
            "-c:a", "aac", "-b:a", "192k", "-t", f"{duration:.9f}", "-map_metadata", "-1",
            "-movflags", "+faststart", str(target)], cancel)
        actual = probe_source(tools.ffprobe, target, cancel)
        tolerance = max(80, math.ceil(1000 / float(rate)) + 25)
        if (not actual["video"] or len(actual["audio_tracks"]) != 1
                or abs(actual["duration_ms"] - duration * 1000) > tolerance
                or abs(actual["video"]["duration_ms"] - duration * 1000) > math.ceil(500 / float(rate)) + 2):
            raise ValueError("视频成品的音画时长校验失败，请缩小范围重试")
        if fingerprint(source) != stamp:
            raise ValueError("原媒体在导出期间发生变化，请重新导出")
        check_cancel(cancel)
        result.update(byte_size=target.stat().st_size, video_encoding="copy" if copied else "h264",
                      video_encoder=encoder, encoder_label="画面直接复制" if copied else LABELS[encoder],
                      encoding_note=encoding_note, video_frame_rate=str(rate), format="mp4", burn_subtitles=settings.get('burn_subtitles', 'none'))
        os.replace(target, output)
        return result
