# pyright: reportAny=false, reportExplicitAny=false, reportMissingTypeArgument=false, reportOptionalSubscript=false, reportReturnType=false, reportUnknownArgumentType=false, reportUnknownMemberType=false, reportUnknownParameterType=false, reportUnknownVariableType=false, reportUnusedCallResult=false

"""Compact, streaming waveform peak extraction for the subtitle editor.

The browser UI consumes a small min/max envelope instead of decoded PCM.  The
format deliberately uses only JSON-compatible values so it can travel with an
editor project and later be reused by a desktop shell.
"""

from __future__ import annotations

import base64
import json
import math
import struct
import subprocess
import sys
import threading
from array import array
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from maw.ffmpeg import resolve_ffmpeg_tool
from maw.output_naming import maw_root, maw_root_candidates


WAVEFORM_SCHEMA = "moy.asr.waveform.v1"
WAVEFORM_ENCODING = "i8-minmax-base64"
DEFAULT_PEAKS_PER_SECOND = 100


class WaveformError(RuntimeError):
    """Raised when a media file cannot be converted to waveform peaks."""


@dataclass(frozen=True, slots=True)
class EmbeddedWaveformResult:
    project: dict[str, Any]
    error: Exception | None = None


def media_signature(media_path: Path) -> dict[str, int | str]:
    """Return a browser-compatible signature used to invalidate stale peaks."""
    stat = media_path.stat()
    return {
        "name": media_path.name,
        "size": stat.st_size,
        "modified_ms": stat.st_mtime_ns // 1_000_000,
    }


def _is_positive_number(value: Any) -> bool:
    """True for a real int/float count. bool is rejected despite being an int."""
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
        and value > 0
    )


def waveform_peaks_per_second(payload: Any) -> float:
    """Return the authoritative bin rate (peaks per second of audio).

    ``peaks_per_second`` is a display-friendly approximation.  For caches
    derived from ``.ReaPeaks`` the real rate is ``sample_rate / division``,
    which is fractional for most sample rates (16 kHz with ``div=53`` is
    301.8868, not 302).  Any geometry that maps a peak index to a timestamp
    must use this function, otherwise the rounding error scales the whole time
    axis and the drift grows linearly with the media length.
    """
    if not isinstance(payload, dict):
        return 0.0
    sample_rate = payload.get("sample_rate")
    division = payload.get("division")
    has_sample_rate = sample_rate is not None
    has_division = division is not None
    if has_sample_rate != has_division:
        return 0.0
    if has_sample_rate:
        if (
            _is_positive_number(sample_rate)
            and isinstance(division, int)
            and not isinstance(division, bool)
            and division > 0
        ):
            return sample_rate / division
        return 0.0
    peaks_per_second = payload.get("peaks_per_second")
    return float(peaks_per_second) if _is_positive_number(peaks_per_second) else 0.0


def is_waveform_payload(value: Any) -> bool:
    """Check the cheap structural invariants of a cached waveform payload."""
    if not isinstance(value, dict):
        return False
    if value.get("schema") != WAVEFORM_SCHEMA:
        return False
    if value.get("encoding") != WAVEFORM_ENCODING:
        return False
    if not isinstance(value.get("data"), str):
        return False
    peak_count = value.get("peak_count")
    peaks_per_second = value.get("peaks_per_second")
    duration_ms = value.get("duration_ms")
    if not (
        isinstance(peak_count, int)
        and not isinstance(peak_count, bool)
        and peak_count >= 0
        and _is_positive_number(peaks_per_second)
        and isinstance(duration_ms, int)
        and not isinstance(duration_ms, bool)
        and duration_ms >= 0
    ):
        return False
    # The exact-rate pair is optional (older payloads only carry the rounded
    # peaks_per_second), but when present it must be usable as a ratio.
    sample_rate = value.get("sample_rate")
    division = value.get("division")
    if sample_rate is None and division is None:
        return True
    return (
        _is_positive_number(sample_rate)
        and isinstance(division, int)
        and not isinstance(division, bool)
        and division > 0
    )


def audio_track_from_payloads(*payloads: Any) -> int:
    """Return the first valid logical audio-track number from cache payloads."""
    for payload in payloads:
        if not isinstance(payload, dict):
            continue
        value = payload.get("audio_track")
        if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
            return value
    return 0


def waveform_matches_media(
    value: Any,
    media_path: Path,
    *,
    audio_track: int | None = None,
) -> bool:
    """Return true when a valid payload was derived from this exact file."""
    if not is_waveform_payload(value):
        return False
    if audio_track is not None and audio_track_from_payloads(value) != audio_track:
        return False
    return value.get("source") == media_signature(media_path)


def waveform_sidecar_path(media_path: Path) -> Path:
    """Return the historical JSON path (new writes use ``save_mopeaks``).

    The sidecar is a rebuildable cache, so it lives in the media's ``_msw``
    directory instead of cluttering the folder that holds the source media.
    When ``per_video`` is enabled the folder is ``<名称>_msw``, otherwise the
    shared ``_msw``; both are decided by :func:`maw.output_naming.maw_root`.
    """
    media_path = Path(media_path)
    return maw_root(media_path) / f"{media_path.stem}.waveform.json"


def _waveform_sidecar_candidates(media_path: Path) -> list[Path]:
    """Locations to check when reading a sidecar, newest layout first.

    Order: the active MSW root, other shared/per-video MSW and MAW roots,
    then the legacy media-adjacent path. Legacy files are read in place;
    this module never migrates them.
    """
    media_path = Path(media_path)
    candidates = [
        root / name
        for root in [*maw_root_candidates(media_path), media_path.parent]
        for name in (f"{media_path.stem}.waveform.json", f"{media_path.name}.waveform.json")
    ]
    legacy = media_path.with_suffix(".waveform.json")
    if legacy not in candidates:
        candidates.append(legacy)
    return list(dict.fromkeys(candidates))


def load_waveform_sidecar(media_path: Path, *, audio_track: int | None = None) -> dict[str, Any] | None:
    """Read a valid-looking waveform sidecar, ignoring missing/corrupt files."""
    for candidate in _waveform_sidecar_candidates(media_path):
        try:
            value = json.loads(candidate.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError):
            continue
        if is_waveform_payload(value) and (audio_track is None or audio_track_from_payloads(value) == audio_track) and (
            not Path(media_path).is_file() or waveform_matches_media(value, media_path, audio_track=audio_track)
        ):
            return value
    return None


def save_waveform_sidecar(payload: dict[str, Any], media_path: Path, *, default_audio_track: int | None = None) -> Path:
    """Compatibility writer: new output is binary; legacy JSON is read-only."""
    from maw.mopeaks import save_mopeaks
    return save_mopeaks(payload, media_path, audio_track=audio_track_from_payloads(payload),
                       default_audio_track=default_audio_track)


def _quantize_sample(value: int) -> int:
    scaled = round(value * 127 / 32768)
    return max(-127, min(127, scaled))


def _append_bucket(output: bytearray, samples: array) -> None:
    if not samples:
        return
    low = _quantize_sample(min(samples))
    high = _quantize_sample(max(samples))
    output.extend((low & 0xFF, high & 0xFF))


def parse_ffmpeg_wav_header(header: bytes) -> tuple[int, int, int] | None:
    """Read the PCM layout from a bounded FFmpeg WAV pipe header.

    FFmpeg uses WAVE_FORMAT_EXTENSIBLE for surround audio; Python 3.11's
    wave reader cannot read it. Data sizes on non-seekable pipes are unknown.
    """
    if len(header) < 12 or header[:4] != b"RIFF" or header[8:12] != b"WAVE":
        return None
    layout = None
    offset = 12
    while offset + 8 <= len(header):
        tag = header[offset:offset + 4]
        size = struct.unpack_from("<I", header, offset + 4)[0]
        if tag == b"data":
            return (*layout, offset + 8) if layout else None
        if offset + 8 + size > len(header):
            return None
        if tag == b"fmt ":
            if size < 16:
                return None
            codec, channels, rate, _, alignment, bits = struct.unpack_from("<HHIIHH", header, offset + 8)
            if codec == 0xFFFE:
                pcm_guid = bytes.fromhex("0100000000001000800000aa00389b71")
                if size < 40 or header[offset + 32:offset + 48] != pcm_guid:
                    return None
            elif codec != 1:
                return None
            if not (1 <= channels <= 64 and rate > 0 and bits == 16 and alignment == channels * 2):
                return None
            layout = (channels, rate)
        offset += 8 + size + (size & 1)
    return None


def extract_waveform(
    media_path: Path,
    *,
    peaks_per_second: int = DEFAULT_PEAKS_PER_SECOND,
    pcm_sample_rate: int | None = None,
    ffmpeg_bin: str | None = None,
    audio_track: int = 0,
    cancel_event: threading.Event | None = None,
    progress=None,
) -> dict[str, Any]:
    """Stream per-channel extrema without retaining decoded audio.

    At the default 100 peaks/second, three hours of audio produces about
    2.9 MiB of base64 data while extraction memory remains effectively flat.
    """
    media_path = Path(media_path).resolve()
    if not media_path.is_file():
        raise WaveformError(f"媒体文件不存在: {media_path}")
    if not isinstance(audio_track, int) or isinstance(audio_track, bool) or audio_track < 0:
        raise ValueError("audio_track must be a non-negative integer")
    if peaks_per_second <= 0:
        raise ValueError("peaks_per_second must be positive")
    if pcm_sample_rate is None:
        pcm_sample_rate = peaks_per_second * 10
    if pcm_sample_rate < peaks_per_second:
        raise ValueError("pcm_sample_rate must be >= peaks_per_second")

    ffmpeg = resolve_ffmpeg_tool(
        "ffmpeg",
        ffmpeg_bin,
        allow_missing_explicit=bool(ffmpeg_bin),
    )
    if not ffmpeg:
        raise WaveformError("找不到 ffmpeg，无法预生成波形")

    command = [
        ffmpeg,
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(media_path),
        "-map",
        f"0:a:{audio_track}",
        "-vn",
        "-ar",
        str(pcm_sample_rate),
        "-acodec",
        "pcm_s16le",
        "-f",
        "wav",
        "pipe:1",
    ]
    if cancel_event is not None and cancel_event.is_set():
        raise WaveformError('波形生成已取消')
    from maw.gui_platform import popen_process_tree, process_group_kwargs, release_process_tree, terminate_process_tree
    try:
        process = popen_process_tree(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            **process_group_kwargs(),
        )
    except OSError as exc:
        raise WaveformError(f"无法启动 ffmpeg: {exc}") from exc

    assert process.stdout is not None
    assert process.stderr is not None
    # Drain diagnostics concurrently; malformed inputs must not fill stderr
    # and deadlock the PCM reader. Keep only a bounded diagnostic tail.
    errors = bytearray()
    def drain_errors():
        while chunk := process.stderr.read(4096):
            errors.extend(chunk)
            if len(errors) > 16384:
                del errors[:-16384]
    reader = threading.Thread(target=drain_errors, daemon=True)
    reader.start()
    finished = threading.Event()
    def watch_cancel():
        while not finished.wait(.1):
            if cancel_event.is_set():
                terminate_process_tree(process, timeout=3)
                return
    watcher = threading.Thread(target=watch_cancel, daemon=True) if cancel_event is not None else None
    if watcher:
        watcher.start()
    encoded = bytearray()
    byte_carry = b""
    sample_carry = array("h")
    total_frames = 0

    try:
        header = bytearray()
        parsed = None
        while len(header) < 65536:
            chunk = process.stdout.read(4096)
            if not chunk:
                break
            header.extend(chunk)
            parsed = parse_ffmpeg_wav_header(header)
            if parsed is not None:
                break
        if parsed is None:
            if cancel_event is not None and cancel_event.is_set():
                raise WaveformError('波形生成已取消')
            raise WaveformError('FFmpeg 返回的 WAV 头无法解析')
        channels, sample_rate, data_offset = parsed
        frame_bytes = channels * 2
        bucket_frames = max(1, round(sample_rate / peaks_per_second))
        bucket_samples = bucket_frames * channels
        actual_peaks_per_second = round(sample_rate / bucket_frames)
        chunk = header[data_offset:]
        while True:
            if not chunk:
                chunk = process.stdout.read(64 * 1024)
            if not chunk:
                break
            raw = byte_carry + chunk
            complete_bytes = len(raw) - (len(raw) % frame_bytes)
            byte_carry = raw[complete_bytes:]
            values = array("h")
            values.frombytes(raw[:complete_bytes])
            if sys.byteorder != "little":
                values.byteswap()
            total_frames += len(values) // channels
            if progress:
                progress(round(total_frames * 1000 / sample_rate))
            if sample_carry:
                sample_carry.extend(values)
                values = sample_carry
            complete_length = (len(values) // bucket_samples) * bucket_samples
            for offset in range(0, complete_length, bucket_samples):
                _append_bucket(encoded, values[offset : offset + bucket_samples])
            sample_carry = array("h", values[complete_length:])
            chunk = b""
        if sample_carry:
            _append_bucket(encoded, sample_carry)
        return_code = process.wait()
    finally:
        finished.set()
        if process.poll() is None:
            terminate_process_tree(process, timeout=3)
        reader.join()
        if watcher:
            watcher.join()
        release_process_tree(process)
        process.stdout.close()
        process.stderr.close()
    stderr = errors.decode("utf-8", errors="replace").strip()
    if cancel_event is not None and cancel_event.is_set():
        raise WaveformError('波形生成已取消')
    if return_code != 0:
        raise WaveformError(stderr or f"ffmpeg 退出码 {return_code}")
    if byte_carry:
        raise WaveformError("ffmpeg 返回了不完整的 PCM 数据")

    peak_count = len(encoded) // 2
    duration_ms = round(total_frames * 1000 / sample_rate)
    return {
        "schema": WAVEFORM_SCHEMA,
        "encoding": WAVEFORM_ENCODING,
        "peaks_per_second": actual_peaks_per_second,
        # bin i covers [i * division / sample_rate, (i + 1) * ...): the exact
        # pair, so consumers never have to rely on the rounded rate above.
        "sample_rate": sample_rate,
        "division": bucket_frames,
        "peak_count": peak_count,
        "duration_ms": duration_ms,
        "data": base64.b64encode(encoded).decode("ascii"),
        "audio_track": audio_track,
        "source": media_signature(media_path),
    }


def embed_waveform(
    project: dict[str, Any],
    media_path: Path,
    *,
    peaks_per_second: int = DEFAULT_PEAKS_PER_SECOND,
    ffmpeg_bin: str | None = None,
    audio_track: int = 0,
    cancel_event: threading.Event | None = None,
    progress: Any = None,
) -> EmbeddedWaveformResult:
    """Return a project copy with embedded peaks, or the original project on failure."""
    try:
        payload = extract_waveform(
            media_path,
            peaks_per_second=peaks_per_second,
            ffmpeg_bin=ffmpeg_bin,
            audio_track=audio_track,
            cancel_event=cancel_event,
            **({'progress': progress} if progress is not None else {}),
        )
    except Exception as exc:  # noqa: BLE001
        return EmbeddedWaveformResult(project=project, error=exc)
    embedded = dict(project)
    embedded["waveform"] = payload
    return EmbeddedWaveformResult(project=embedded)


def load_or_extract_waveform(
    existing: Any,
    media_path: Path,
    *,
    peaks_per_second: int = DEFAULT_PEAKS_PER_SECOND,
    ffmpeg_bin: str | None = None,
    audio_track: int = 0,
    default_audio_track: int | None = None,
    cancel_event: Any = None,
    progress: Any = None,
    persist: bool = True,
) -> tuple[dict[str, Any], bool]:
    """Return cached peaks when valid, otherwise extract a fresh payload."""
    if not isinstance(audio_track, int) or isinstance(audio_track, bool) or audio_track < 0:
        raise ValueError("audio_track must be a non-negative integer")
    from maw import quapeaks, mopeaks
    for loader in (quapeaks.load_self_wave_payload, mopeaks.load_mopeaks):
        cached = loader(media_path, audio_track=audio_track, default_audio_track=default_audio_track)
        if (cached is not None and audio_track_from_payloads(cached) == audio_track
                and cached['peaks_per_second'] == peaks_per_second):
            # The shared producer calls with persist=False under its generation
            # lock and performs cleanup after releasing it.
            if persist and loader is quapeaks.load_self_wave_payload:
                from maw.cache_management import auto_cleanup
                auto_cleanup(media_path, audio_track=audio_track,
                             default_audio_track=default_audio_track)
            return cached, False
    if (
        waveform_matches_media(existing, media_path, audio_track=audio_track)
        and existing["peaks_per_second"] == peaks_per_second
    ):
        return existing, False
    sidecar = load_waveform_sidecar(media_path, audio_track=audio_track)
    if (
        waveform_matches_media(sidecar, media_path, audio_track=audio_track)
        and sidecar["peaks_per_second"] == peaks_per_second
    ):
        return sidecar, False
    payload = extract_waveform(
        media_path,
        peaks_per_second=peaks_per_second,
        ffmpeg_bin=ffmpeg_bin,
        audio_track=audio_track,
        cancel_event=cancel_event,
        progress=progress,
    )
    if persist:
        try:
            save_waveform_sidecar(payload, media_path, default_audio_track=default_audio_track)
        except OSError:
            # A read-only media folder must not prevent HTML generation.
            pass
    return payload, True
