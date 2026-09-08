"""Bounded offline audio mixer. FFmpeg decodes/mixes; Python streams files.

At most 16 inputs and 30 seconds per mix graph. Float intermediates retain
headroom; one final global gain prevents clipping without changing balance.
"""

from array import array
from collections import OrderedDict
from pathlib import Path
import math
import os
import shutil
import subprocess
import sys
import tempfile
import time
import wave

from maw.gui_platform import popen_process_tree, process_group_kwargs, release_process_tree, terminate_process_tree
from maw.msw.audio_plan import round_sample

CHUNK_SECONDS = 30
BATCH_INPUTS = 16
CACHE_BYTES = 256 * 1024 * 1024
MAX_WAV_BYTES = 0xFFFFFF00


class RenderCancelled(Exception):
    pass


def check_cancel(cancel):
    if cancel.is_set():
        raise RenderCancelled()


def run(command, cancel, *, timeout=3600, stdout=None, cwd=None, failure_message=None):
    """Poll the child even if it produces no stdout; never pipe unbounded logs."""
    check_cancel(cancel)
    with tempfile.TemporaryFile() as errors:
        try:
            process = popen_process_tree(command, stdin=subprocess.DEVNULL,
                                       stdout=stdout or subprocess.DEVNULL, stderr=errors, cwd=cwd,
                                       **process_group_kwargs())
        except OSError as error:
            raise ValueError("FFmpeg 无法启动，请检查启动器的 FFmpeg 配置") from error
        deadline = time.monotonic() + timeout
        try:
            while process.poll() is None:
                check_cancel(cancel)
                if time.monotonic() >= deadline:
                    raise ValueError("音频处理超时，请缩小导出范围")
                cancel.wait(.1)
            check_cancel(cancel)
            if process.returncode:
                # FFmpeg diagnostics can contain filenames/URLs, so keep the
                # user-facing error actionable without echoing arbitrary logs.
                raise ValueError(failure_message or "音频解码或混音失败，请检查媒体是否完整、原声音轨是否存在及磁盘空间")
        finally:
            if process.poll() is None:
                terminate_process_tree(process, timeout=3)
            release_process_tree(process)


def fingerprint(path):
    stat = Path(path).stat()
    return stat.st_size, stat.st_mtime_ns, stat.st_ino


def command_prefix(ffmpeg):
    return [str(ffmpeg), "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-filter_complex_threads", "1"]


def probe_source(ffprobe, source, cancel):
    import json
    with tempfile.TemporaryFile() as output:
        run([str(ffprobe), "-v", "error", "-protocol_whitelist", "file,pipe", "-show_streams", "-show_format",
             "-of", "json", str(source)], cancel, timeout=30, stdout=output)
        if output.tell() > 1024 * 1024:
            raise ValueError("原媒体包含过多音轨信息")
        output.seek(0)
        info = json.load(output)
    streams = [s for s in info.get("streams", []) if s.get("codec_type") == "audio"]
    durations = []
    for item in [info.get("format", {}), *info.get("streams", [])]:
        try:
            number = float(item.get("duration", 0))
            if math.isfinite(number) and number > 0:
                durations.append(number)
        except (TypeError, ValueError):
            pass
    duration_ms = round_sample(max(durations, default=0) * 1000)
    videos = [s for s in info.get("streams", []) if s.get("codec_type") == "video" and not s.get("disposition", {}).get("attached_pic")]
    video = None
    if videos:
        s = videos[0]
        duration_is_length = False
        try:
            seconds = float(s.get("duration", 0))
            duration_is_length = math.isfinite(seconds) and seconds > 0
            if not math.isfinite(seconds) or seconds <= 0:
                tag = s.get('tags', {}).get('DURATION', '')
                parts = tag.split(':')
                seconds = (float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2])) if len(parts) == 3 else 0
            video_ms = round_sample(seconds * 1000) if math.isfinite(seconds) and seconds > 0 else duration_ms
        except (TypeError, ValueError, OverflowError):
            video_ms = duration_ms
        try:
            offset = float(s.get('start_time', 0)) - float(info.get('format', {}).get('start_time', 0))
            start_ms = round_sample(max(0, offset) * 1000) if math.isfinite(offset) else 0
        except (TypeError, ValueError, OverflowError):
            start_ms = 0
        if duration_is_length:
            video_ms += start_ms
        video = dict(index=s["index"], duration_ms=video_ms, codec=s.get("codec_name"),
                     start_ms=start_ms,
                     width=s.get("width", 0), height=s.get("height", 0), pixel_format=s.get("pix_fmt"),
                     frame_rate=s.get("avg_frame_rate") or s.get("r_frame_rate"),
                     color_transfer=s.get("color_transfer"))
    return dict(duration_ms=duration_ms, video=video, audio_tracks=[
        dict(audio_index=i, channels=s.get("channels", 0), title=str(s.get("tags", {}).get("title", ""))[:160],
             language=str(s.get("tags", {}).get("language", ""))[:40]) for i, s in enumerate(streams)])


def render(plan, output, ffmpeg, cancel, progress, resolve_asset, *, source=None, source_channels=0, allow_silence=False):
    """resolve_asset(id) supplies a verified asset + path in a trusted scope."""
    rate, frames = plan["sample_rate"], plan["sample_count"]
    if frames * 4 + 44 > MAX_WAV_BYTES:
        raise ValueError("WAV 将超过 4 GB，请分段导出")
    if not plan["pieces"] and not plan["source"] and not allow_silence:
        raise ValueError("导出范围内没有可发声的音频贴片")
    output = Path(output)
    source_stamp = fingerprint(source) if source else None
    source_bytes = math.ceil(plan["source_end_ms"] * rate / 1000) * 8 if source else 0
    if shutil.disk_usage(output.parent).free < frames * 12 + source_bytes + 2 * CACHE_BYTES:
        raise ValueError("导出临时目录的磁盘空间不足，请释放空间或缩小导出范围")
    with tempfile.TemporaryDirectory(prefix=f"render-{output.stem}-", dir=output.parent) as temporary:
        root = Path(temporary)
        cache, cache_size, serial = OrderedDict(), 0, 0

        def fresh():
            nonlocal serial
            serial += 1
            return root / f"part-{serial}.f32"

        def decode(path, destination, *, audio_index=0, source_media=False, channels=0):
            cmd = command_prefix(ffmpeg) + ["-protocol_whitelist", "file,pipe"]
            if not source_media:
                cmd += ["-f", "wav"]
            cmd += ["-threads", "1", "-i", str(path), "-map", f"0:a:{audio_index}", "-vn", "-sn", "-dn"]
            if source_media:
                cmd += ["-t", f'{plan["source_end_ms"] / 1000:.9f}']
            # first_pts=0 retains an audio stream's delayed start relative to
            # the container and fills internal timestamp gaps with silence.
            audio_filter = f"aresample={rate}:async=1:first_pts=0" if source_media else f"aresample={rate}"
            if channels == 1:
                audio_filter += ",pan=stereo|c0=c0|c1=c0"
            cmd += ["-af", audio_filter,
                    "-ar", str(rate), "-ac", "2", "-c:a", "pcm_f32le", "-f", "f32le", str(destination)]
            run(cmd, cancel)

        def proxy(asset_id):
            nonlocal cache_size
            if asset_id in cache:
                path = cache.pop(asset_id)
                cache[asset_id] = path
                return path
            check_cancel(cancel)
            asset, path = resolve_asset(asset_id)
            stamp = fingerprint(path)
            # Copy the small immutable WAV before decoding. A project move or
            # concurrent save cannot swap the input while FFmpeg reads it.
            local = root / "input.wav"
            shutil.copyfile(path, local)
            import hashlib
            if hashlib.sha256(local.read_bytes()).hexdigest() != asset["sha256"] or fingerprint(path) != stamp:
                raise ValueError("音频素材在导出期间发生变化，请重新导出")
            dest = fresh()
            decode(local, dest, channels=asset["channels"])
            local.unlink()
            size = dest.stat().st_size
            expected = round_sample(asset["sample_count"] * rate / asset["sample_rate"])
            if size % 8 or abs(size // 8 - expected) > 2:
                raise ValueError("音频素材解码长度与工程记录不一致")
            while cache and cache_size + size > CACHE_BYTES:
                _, old = cache.popitem(last=False)
                cache_size -= old.stat().st_size
                old.unlink()
            cache[asset_id], cache_size = dest, cache_size + size
            return dest

        progress("preparing", 0)
        source_proxy = None
        if plan["source"]:
            if source is None:
                raise ValueError("请在本机服务中重新打开带原媒体的工程")
            source_proxy = root / "source.f32"
            progress("source", 0)
            decode(source, source_proxy, audio_index=plan["source"]["audio_index"], source_media=True, channels=source_channels)
            if not source_proxy.stat().st_size or source_proxy.stat().st_size % 8:
                raise ValueError("原声音轨没有可解码的音频")
            if fingerprint(source) != source_stamp:
                raise ValueError("原媒体在导出期间发生变化，请重新导出")

        def mix(parts, length):
            dest = fresh()
            cmd = command_prefix(ffmpeg)
            filters, labels = [], []
            for i, (path, offset, count, delay, db) in enumerate(parts):
                cmd += ["-f", "f32le", "-ar", str(rate), "-ac", "2", "-ss", f"{offset / rate:.12f}",
                        "-t", f"{count / rate:.12f}", "-i", str(path)]
                label = f"a{i}"
                filters.append(f"[{i}:a]atrim=end_sample={count},asetpts=PTS-STARTPTS,volume={db:.12g}dB:precision=double,"
                               f"adelay={delay}S:all=1,apad=whole_len={length},atrim=end_sample={length}[{label}]")
                labels.append(f"[{label}]")
            filters.append("".join(labels) + f"amix=inputs={len(parts)}:normalize=0:duration=longest:dropout_transition=0,"
                           f"apad=whole_len={length},atrim=end_sample={length}[out]")
            # A script avoids Windows command length limits even with paths
            # containing Unicode, quotes or shell metacharacters.
            script = root / "mix.txt"
            script.write_text(";\n".join(filters), encoding="utf-8", newline="\n")
            cmd += ["-filter_complex_script", str(script), "-map", "[out]", "-c:a", "pcm_f32le", "-f", "f32le", str(dest)]
            run(cmd, cancel)
            if dest.stat().st_size != length * 8:
                raise ValueError("混音长度异常，未发布不完整的 WAV")
            return dest

        # Materialize original-audio pieces on the same kept-interval mapping.
        pieces = list(plan["pieces"])
        if source_proxy:
            for k in plan["intervals"]:
                start = round_sample(k["output_start_ms"] * rate / 1000)
                end = round_sample((k["output_start_ms"] + k["end_ms"] - k["start_ms"]) * rate / 1000)
                pieces.append(dict(asset_id=None, source_in_sample=round_sample(k["start_ms"] * rate / 1000),
                                   output_start_sample=start, output_end_sample=end, gain_db=plan["source"]["gain_db"]))
        pieces.sort(key=lambda p: p["output_start_sample"])
        active, next_piece, peak = [], 0, 0.0
        spool = root / "mix.f32"
        with spool.open("wb") as target:
            for start in range(0, frames, CHUNK_SECONDS * rate):
                check_cancel(cancel)
                end = min(frames, start + CHUNK_SECONDS * rate)
                active = [p for p in active if p["output_end_sample"] > start]
                while next_piece < len(pieces) and pieces[next_piece]["output_start_sample"] < end:
                    p = pieces[next_piece]
                    if p["output_end_sample"] > start:
                        active.append(p)
                    next_piece += 1
                batches, parts = [], []

                def reduce_batches():
                    if len(batches) >= BATCH_INPUTS:
                        combined = mix([(p, 0, end - start, 0, 0) for p in batches], end - start)
                        for old in batches:
                            old.unlink()
                        batches[:] = [combined]

                for p in active:
                    check_cancel(cancel)
                    lo, hi = max(start, p["output_start_sample"]), min(end, p["output_end_sample"])
                    if p["asset_id"] is None:
                        path, source_in = source_proxy, p["source_in_sample"]
                    else:
                        # Decode before a batch, then pin its proxy until that
                        # batch finishes. Eviction is deferred by flushing when
                        # adding another asset could exceed the cache budget.
                        asset, _ = resolve_asset(p["asset_id"])
                        estimate = (round_sample(asset["sample_count"] * rate / asset["sample_rate"]) + 2) * 8
                        if parts and p["asset_id"] not in cache and cache_size + estimate > CACHE_BYTES:
                            batches.append(mix(parts, end - start))
                            parts = []
                            reduce_batches()
                        path = proxy(p["asset_id"])
                        source_in = round_sample(p["source_in_sample"] * rate / asset["sample_rate"])
                    offset, count = source_in + lo - p["output_start_sample"], hi - lo
                    if p["asset_id"] is not None:
                        source_end = round_sample(p["source_out_sample"] * rate / asset["sample_rate"])
                        count = min(count, max(0, source_end - offset))
                    # Quantization can leave one output frame past the native
                    # source trim. Pad that frame instead of leaking later audio.
                    if not count:
                        continue
                    parts.append((path, offset, count, lo - start, p["gain_db"]))
                    if len(parts) == BATCH_INPUTS:
                        batches.append(mix(parts, end - start))
                        parts = []
                        reduce_batches()
                if parts:
                    batches.append(mix(parts, end - start))
                    reduce_batches()
                if not batches:
                    target.write(bytes((end - start) * 8))
                else:
                    mixed = batches[0] if len(batches) == 1 else mix([(p, 0, end - start, 0, 0) for p in batches], end - start)
                    with mixed.open("rb") as data:
                        while block := data.read(256 * 1024):
                            check_cancel(cancel)
                            values = array("f")
                            values.frombytes(block)
                            if sys.byteorder != "little":
                                values.byteswap()
                            level = max(abs(min(values)), abs(max(values)))
                            if not math.isfinite(level):
                                raise ValueError("混音包含无效采样值")
                            peak = max(peak, level)
                            target.write(block)
                    for old in set([mixed, *batches]):
                        old.unlink()
                progress("mixing", end / frames * .9)
        scale = min(1.0, .999 / peak) if plan["peak_protection"] and peak > .999 else 1.0
        progress("encoding", .92)
        temporary_wav = root / "result.wav"
        run(command_prefix(ffmpeg) + ["-f", "f32le", "-ar", str(rate), "-ac", "2", "-i", str(spool),
             "-af", f"volume={scale:.15g}:precision=double", "-map_metadata", "-1", "-c:a", "pcm_s16le", str(temporary_wav)], cancel)
        with wave.open(str(temporary_wav), "rb") as audio:
            if (audio.getnframes(), audio.getframerate(), audio.getnchannels(), audio.getsampwidth()) != (frames, rate, 2, 2):
                raise ValueError("WAV 校验失败，未发布不完整的导出")
        if source and fingerprint(source) != source_stamp:
            raise ValueError("原媒体在导出期间发生变化，请重新导出")
        check_cancel(cancel)
        os.replace(temporary_wav, output)
        return dict(sample_rate=rate, sample_count=frames, channels=2, byte_size=output.stat().st_size,
                    peak_db=20 * math.log10(peak) if peak > 0 else None,
                    attenuation_db=20 * math.log10(scale), clipped=not plan["peak_protection"] and peak > 1)
