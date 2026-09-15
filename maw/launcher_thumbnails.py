"""Launcher cover thumbnails for recent-project cards（修正案 H01/§6）.

设计要点（PLAN_LAUNCHER_CORRECTIONS.md §6）：

- 只读工程 JSON 与媒体元数据，不启动编辑器、不生成波形、不修改工程；
- 从工程实际 ``media`` 引用解析视频（复用 :func:`maw.media.resolve_project_media`），
  不猜测同名文件，不使用启动器输入框里的媒体路径；
- 封面绑定解析后的源媒体版本：规范路径 + 大小 + mtime + 输出尺寸 + 策略版本；
- 缓存位于本机应用数据目录 ``cover-cache/``，不写入 ``.mosp``、不污染 ``.assets``；
- 同一媒体请求去重、最多两个并发提取、失败短期缓存（避免窗口反复获得焦点时
  重复启动 FFmpeg）；
- 图片约 480x270 JPEG，经 pywebview 桥接以 data URI 返回——不新增任意本机
  文件读取接口。

封面失败不阻止打开工程：前端对未知状态一律回退占位图。
"""

from __future__ import annotations

import base64
import hashlib
import json
import re
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Final

from maw.app_paths import default_app_data_root
from maw.ffmpeg import FfmpegTools, media_duration_seconds, resolve_ffmpeg_tools
from maw.launcher_projects import STATS_SIZE_LIMIT
from maw.media import (
    AUDIO_EXTENSIONS,
    MediaResolution,
    MediaStatus,
    resolve_project_media,
)

COVER_CACHE_DIR_NAME: Final = "cover-cache"
COVER_WIDTH: Final = 480
COVER_HEIGHT: Final = 270
#: 取帧策略版本：候选时间点或亮度判定变化时递增，旧缓存自然失效。
COVER_STRATEGY_VERSION: Final = "v1"
#: 亮度可接受区间（YAVG，0-255）：接近全黑/全白的候选帧换下一个。
LUMA_MIN: Final = 16.0
LUMA_MAX: Final = 240.0
MAX_CANDIDATES: Final = 3
EXTRACT_TIMEOUT_SECONDS: Final = 15
PROBE_TIMEOUT_SECONDS: Final = 10
#: 提取失败的短期缓存（秒）：窗口多次获得焦点时不重复启动 FFmpeg。
NEGATIVE_CACHE_TTL_SECONDS: Final = 600
MAX_PARALLEL_EXTRACTIONS: Final = 2

STATE_IMAGE: Final = "image"
STATE_AUDIO: Final = "audio"
STATE_NO_MEDIA: Final = "no_media"
STATE_MEDIA_MISSING: Final = "media_missing"
STATE_PROJECT_MISSING: Final = "project_missing"
STATE_PROJECT_BROKEN: Final = "project_broken"
STATE_FAILED: Final = "failed"

_YAVG_PATTERN = re.compile(r"lavfi\.signalstats\.YAVG=([0-9]+(?:\.[0-9]+)?)")
_VIDEO_STREAM_PATTERN = re.compile(r"^\s*video\s*$", re.IGNORECASE)

_EXTRACTION_SEMAPHORE = threading.Semaphore(MAX_PARALLEL_EXTRACTIONS)
_INFLIGHT_LOCK = threading.Lock()
_INFLIGHT: dict[str, "_Job"] = {}
_NEGATIVE_LOCK = threading.Lock()
_NEGATIVE: dict[str, float] = {}


@dataclass(slots=True)
class _Job:
    done: threading.Event
    result: dict[str, Any] | None = None


def cover_cache_dir(cache_dir: Path | None = None) -> Path:
    return cache_dir or default_app_data_root() / COVER_CACHE_DIR_NAME


def candidate_timestamps(duration: float | None) -> list[float]:
    """取帧候选时间点（§6.2）：约 10% 处并限制在 1~5 秒，最多三次尝试。

    时长未知时安全回退较早的帧。列表内时间点互不相同。
    """
    if duration is None or duration <= 0:
        base = [0.5, 1.0, 2.0]
    else:
        ceiling = duration * 0.9
        raw = [
            min(max(1.0, duration * 0.10), 5.0),
            min(max(1.0, duration * 0.25), 5.0),
            min(2.0, duration * 0.5),
        ]
        base = [min(value, ceiling) for value in raw]
    ordered: list[float] = []
    for value in base:
        if value < 0:
            value = 0.0
        if all(abs(value - seen) > 0.05 for seen in ordered):
            ordered.append(round(value, 3))
    return ordered[:MAX_CANDIDATES]


def cover_cache_key(media_path: Path, stat: Any) -> str:
    """缓存键：媒体规范路径 + 大小 + mtime + 输出尺寸 + 策略版本。"""
    digest = hashlib.sha1(
        "|".join(
            (
                str(media_path),
                str(getattr(stat, "st_size", 0)),
                str(getattr(stat, "st_mtime_ns", 0)),
                f"{COVER_WIDTH}x{COVER_HEIGHT}",
                COVER_STRATEGY_VERSION,
            )
        ).encode("utf-8", errors="replace")
    ).hexdigest()
    return digest[:24]


def parse_luma(stderr: str) -> float | None:
    """从 signalstats 的 metadata 输出里取平均亮度；无输出返回 None。"""
    match = _YAVG_PATTERN.search(stderr or "")
    if not match:
        return None
    try:
        value = float(match.group(1))
    except ValueError:
        return None
    return value if 0.0 <= value <= 255.0 else None


def luma_acceptable(luma: float | None) -> bool:
    return luma is None or LUMA_MIN <= luma <= LUMA_MAX


def _run_ffmpeg(
    command: list[str],
    *,
    timeout: int,
    runner: Callable[..., subprocess.CompletedProcess[str]] | None = None,
) -> subprocess.CompletedProcess[str]:
    run = runner or subprocess.run  # noqa: S603 - 固定参数的媒体子进程
    return run(command, capture_output=True, text=True, timeout=timeout)


def _has_video_stream(
    media_path: Path,
    *,
    ffprobe: Path | None,
    runner: Callable[..., subprocess.CompletedProcess[str]] | None = None,
) -> bool | None:
    """探测是否含视频流；探测不可用返回 None（按扩展名判断）。"""
    if ffprobe is None or not ffprobe.is_file():
        return None
    command = [
        str(ffprobe), "-v", "quiet", "-show_entries", "stream=codec_type",
        "-of", "csv=p=0", str(media_path),
    ]
    try:
        result = _run_ffmpeg(command, timeout=PROBE_TIMEOUT_SECONDS, runner=runner)
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    lines = str(result.stdout or "").splitlines()
    if not lines:
        return False
    return any(_VIDEO_STREAM_PATTERN.match(line) for line in lines)


def _read_project_data(project_path: Path) -> dict[str, Any] | None:
    """读取工程 JSON（大小受限）；损坏/超限返回 None。"""
    try:
        if project_path.stat().st_size > STATS_SIZE_LIMIT:
            return None
        data = json.loads(project_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def _classify_resolution(resolution: MediaResolution) -> tuple[str, str]:
    """把媒体解析结果映射为封面状态与说明。"""
    if resolution.status is MediaStatus.MISSING:
        return STATE_MEDIA_MISSING, resolution.message or "工程关联的媒体文件不存在"
    if resolution.status is MediaStatus.CONFLICT:
        return STATE_MEDIA_MISSING, resolution.message or "工程目录存在多个同名媒体"
    if resolution.status is MediaStatus.UNSUPPORTED:
        return STATE_FAILED, resolution.message or "不支持的媒体格式"
    return STATE_FAILED, resolution.message


def _extract_frame(
    media_path: Path,
    timestamp: float,
    output_path: Path,
    *,
    ffmpeg: Path,
    runner: Callable[..., subprocess.CompletedProcess[str]] | None = None,
) -> tuple[bool, float | None]:
    """提取单帧并返回 (是否成功, 平均亮度)。

    一遍完成：缩放居中裁切到 480x270 的同时经 signalstats 打出 YAVG，
    亮度用于拒绝几乎全黑/全白的候选帧。
    """
    command = [
        str(ffmpeg), "-nostdin", "-hide_banner",
        "-ss", f"{timestamp:.3f}",
        "-i", str(media_path),
        "-frames:v", "1",
        "-vf",
        ",".join(
            (
                f"scale={COVER_WIDTH}:{COVER_HEIGHT}:force_original_aspect_ratio=increase",
                f"crop={COVER_WIDTH}:{COVER_HEIGHT}",
                "signalstats",
                "metadata=print:key=lavfi.signalstats.YAVG",
            )
        ),
        "-q:v", "4",
        "-y",
        str(output_path),
    ]
    try:
        result = _run_ffmpeg(command, timeout=EXTRACT_TIMEOUT_SECONDS, runner=runner)
    except (OSError, subprocess.SubprocessError):
        return False, None
    if result.returncode != 0 or not output_path.is_file() or output_path.stat().st_size == 0:
        return False, None
    return True, parse_luma(str(result.stderr or ""))


def _produce_image(
    media_path: Path,
    *,
    ffmpeg: Path,
    ffprobe: Path | None,
    cache_root: Path,
    force: bool,
    runner: Callable[..., subprocess.CompletedProcess[str]] | None = None,
) -> dict[str, Any]:
    try:
        stat = media_path.stat()
    except OSError:
        return {"state": STATE_MEDIA_MISSING, "message": "媒体文件不可访问"}

    key = cover_cache_key(media_path, stat)
    cached = cache_root / f"{key}.jpg"
    cache_root.mkdir(parents=True, exist_ok=True)

    if not force and cached.is_file() and cached.stat().st_size > 0:
        try:
            return {"state": STATE_IMAGE, "version": key, "data": cached.read_bytes()}
        except OSError:
            pass  # 缓存读失败时退回重新提取

    if not force:
        with _NEGATIVE_LOCK:
            expiry = _NEGATIVE.get(key)
            if expiry is not None and expiry > time.monotonic():
                return {"state": STATE_FAILED, "message": "近期提取失败，稍后自动重试"}

    with _INFLIGHT_LOCK:
        job = _INFLIGHT.get(key)
        owner = job is None
        if owner:
            job = _Job(done=threading.Event())
            _INFLIGHT[key] = job
    if not owner:
        # 同一媒体已有提取在进行：等待其结果，避免重复启动 FFmpeg。
        job.done.wait(timeout=EXTRACT_TIMEOUT_SECONDS * MAX_CANDIDATES + 5)
        if job.result is not None:
            return dict(job.result)
        return {"state": STATE_FAILED, "message": "封面提取等待超时"}

    try:
        with _EXTRACTION_SEMAPHORE:
            outcome = _extract_with_candidates(
                media_path, cached,
                ffmpeg=ffmpeg, ffprobe=ffprobe, runner=runner,
            )
    finally:
        with _INFLIGHT_LOCK:
            _INFLIGHT.pop(key, None)
        job.result = outcome
        job.done.set()

    if outcome.get("state") == STATE_IMAGE:
        outcome["version"] = key
        with _NEGATIVE_LOCK:
            _NEGATIVE.pop(key, None)
    elif not force:
        with _NEGATIVE_LOCK:
            _NEGATIVE[key] = time.monotonic() + NEGATIVE_CACHE_TTL_SECONDS
    return outcome


def _extract_with_candidates(
    media_path: Path,
    output_path: Path,
    *,
    ffmpeg: Path,
    ffprobe: Path | None,
    runner: Callable[..., subprocess.CompletedProcess[str]] | None = None,
) -> dict[str, Any]:
    duration = media_duration_seconds(media_path, ffprobe_path=ffprobe)
    for timestamp in candidate_timestamps(duration):
        ok, luma = _extract_frame(
            media_path, timestamp, output_path,
            ffmpeg=ffmpeg, runner=runner,
        )
        if ok and luma_acceptable(luma):
            try:
                return {"state": STATE_IMAGE, "data": output_path.read_bytes()}
            except OSError:
                continue
        # 提取成功但几乎全黑/全白：换下一个候选，最多 MAX_CANDIDATES 次。
    if output_path.is_file() and output_path.stat().st_size > 0:
        # 所有候选都不理想：使用最后可用帧而不是占位图。
        try:
            return {"state": STATE_IMAGE, "data": output_path.read_bytes()}
        except OSError:
            pass
    return {"state": STATE_FAILED, "message": "未能从媒体提取到可用画面"}


def thumbnail_payload(
    project_path: Path,
    *,
    ffmpeg_tools: FfmpegTools | None = None,
    force: bool = False,
    cache_dir: Path | None = None,
    runner: Callable[..., subprocess.CompletedProcess[str]] | None = None,
) -> dict[str, Any]:
    """返回最近工程卡片的封面载荷（状态 + 可选 data URI）。"""
    tools = ffmpeg_tools or resolve_ffmpeg_tools()
    try:
        resolved_project = project_path.expanduser().resolve()
    except OSError:
        resolved_project = project_path
    if not resolved_project.is_file():
        return {"ok": True, "state": STATE_PROJECT_MISSING}

    data = _read_project_data(resolved_project)
    if data is None:
        return {"ok": True, "state": STATE_PROJECT_BROKEN}

    try:
        resolution = resolve_project_media(resolved_project, data)
    except Exception:
        return {"ok": True, "state": STATE_PROJECT_BROKEN}

    if not resolution.loadable:
        state, message = _classify_resolution(resolution)
        return {"ok": True, "state": state, "message": message}

    media_path = resolution.resolved_path
    assert media_path is not None  # loadable 意味着已解析
    payload: dict[str, Any] = {"ok": True, "mediaName": media_path.name}

    if media_path.suffix.lower() in AUDIO_EXTENSIONS:
        payload["state"] = STATE_AUDIO
        return payload
    has_video = _has_video_stream(media_path, ffprobe=tools.ffprobe, runner=runner)
    if has_video is False:
        payload["state"] = STATE_AUDIO
        return payload

    if tools.ffmpeg is None or not tools.ffmpeg.is_file():
        payload.update({"state": STATE_FAILED, "message": "FFmpeg 不可用，无法生成封面"})
        return payload

    outcome = _produce_image(
        media_path,
        ffmpeg=tools.ffmpeg,
        ffprobe=tools.ffprobe,
        cache_root=cover_cache_dir(cache_dir),
        force=force,
        runner=runner,
    )
    payload["state"] = outcome.get("state", STATE_FAILED)
    if outcome.get("message"):
        payload["message"] = outcome["message"]
    image = outcome.get("data")
    if image:
        payload["version"] = outcome.get("version", "")
        payload["dataUri"] = "data:image/jpeg;base64," + base64.b64encode(image).decode("ascii")
    return payload


def clear_cover_cache(cache_dir: Path | None = None) -> dict[str, Any]:
    """清空封面缓存目录；失败条目短期缓存一并丢弃。"""
    target = cover_cache_dir(cache_dir)
    removed = 0
    errors: list[str] = []
    if target.is_dir():
        for item in target.iterdir():
            try:
                if item.is_file():
                    item.unlink()
                    removed += 1
            except OSError as error:
                errors.append(str(error))
    with _NEGATIVE_LOCK:
        _NEGATIVE.clear()
    payload: dict[str, Any] = {"ok": True, "removed": removed}
    if errors:
        payload["errors"] = errors[:5]
    return payload
