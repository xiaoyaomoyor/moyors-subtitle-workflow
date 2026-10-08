"""Verified H.264 backends; enumeration alone does not prove driver availability."""

import copy
import os
from pathlib import Path
import tempfile
import threading
import time

from maw.msw.audio_render import check_cancel, command_prefix, run

LABELS = {'libx264': '软件编码（CPU）', 'h264_nvenc': 'NVIDIA NVENC',
          'h264_qsv': 'Intel Quick Sync', 'h264_amf': 'AMD AMF'}
HARDWARE = ('h264_nvenc', 'h264_qsv', 'h264_amf')
_cache = {}
_lock = threading.Lock()


def cpu_threads():
    # Leave headroom for playback and editing; no longer fixed at two threads.
    return max(1, min(8, (os.cpu_count() or 2) // 2))


def encoder_args(encoder):
    quality = {
        'libx264': ['-preset', 'medium', '-crf', '18', '-threads', str(cpu_threads())],
        'h264_nvenc': ['-preset', 'p5', '-rc', 'vbr', '-cq', '19', '-b:v', '0'],
        'h264_qsv': ['-preset', 'medium', '-global_quality', '19'],
        'h264_amf': ['-quality', 'quality', '-rc', 'cqp', '-qp_i', '18', '-qp_p', '20'],
    }
    if encoder not in quality:
        raise ValueError('未知的视频编码器')
    return ['-c:v', encoder, *quality[encoder], '-bf', '0', '-pix_fmt',
            'yuv420p' if encoder == 'libx264' else 'nv12']


def capabilities(ffmpeg, cancel=None):
    """Five-minute cache per executable; exercise the same options as export."""
    cancel = cancel or threading.Event()
    check_cancel(cancel)
    path = Path(ffmpeg)
    try:
        stat = path.stat()
        key = (str(path.resolve()), stat.st_size, stat.st_mtime_ns)
    except OSError:
        return [dict(id=e, label=LABELS[e], available=False, reason='FFmpeg 不可用') for e in HARDWARE]
    # Avoid concurrent driver initialization from multiple context requests.
    while not _lock.acquire(timeout=.1):
        check_cancel(cancel)
    try:
        cached = _cache.get(key)
        if cached and time.monotonic() - cached[0] < 300:
            return copy.deepcopy(cached[1])
        result = []
        for encoder in HARDWARE:
            check_cancel(cancel)
            entry = dict(id=encoder, label=LABELS[encoder], available=False, reason='')
            try:
                # Real encoded frames, without reading any user media.
                with tempfile.TemporaryDirectory(prefix='msw-encoder-') as folder:
                    target = Path(folder) / 'probe.mp4'
                    run(command_prefix(ffmpeg) + ['-f', 'lavfi', '-i', 'color=size=256x144:rate=24',
                        '-frames:v', '3', '-an', *encoder_args(encoder), str(target)], cancel, timeout=8,
                        failure_message='短编码检测未通过，请检查显卡驱动及 FFmpeg 编码器支持')
                    if not target.is_file() or target.stat().st_size == 0:
                        raise ValueError('短编码检测未产生视频')
                entry['available'] = True
            except ValueError:
                entry['reason'] = '短编码检测未通过；显卡、驱动或当前 FFmpeg 不支持此编码器，也可能正被占用'
            result.append(entry)
        _cache.clear()
        _cache[key] = (time.monotonic(), result)
        return copy.deepcopy(result)
    finally:
        _lock.release()


def choose_encoder(settings, ffmpeg, cancel):
    mode = settings.get('video_encoding', 'auto')
    if mode == 'h264':
        return 'libx264', ''
    available = capabilities(ffmpeg, cancel)
    requested = settings.get('hardware_encoder', 'auto')
    usable = [e for e in available if e['available'] and
              (mode == 'auto' or requested == 'auto' or e['id'] == requested)]
    if usable:
        return usable[0]['id'], ''
    if mode == 'hardware':
        raise ValueError('硬件编码不可用：短编码检测未通过。请检查显卡驱动与 FFmpeg，或选择自动／软件编码（CPU）')
    return 'libx264', '未检测到可用硬件编码器，使用软件编码（CPU）'
