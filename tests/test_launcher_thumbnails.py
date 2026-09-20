"""Launcher cover-thumbnail service tests（修正案 R3/H01，§6）."""

from __future__ import annotations

import subprocess
import threading
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import mock

from maw import launcher_thumbnails
from maw.ffmpeg import FfmpegTools
from maw.launcher_thumbnails import (
    STATE_AUDIO,
    STATE_FAILED,
    STATE_IMAGE,
    STATE_MEDIA_MISSING,
    STATE_PROJECT_BROKEN,
    STATE_PROJECT_MISSING,
    candidate_timestamps,
    clear_cover_cache,
    cover_cache_key,
    luma_acceptable,
    parse_luma,
    thumbnail_payload,
)

JPEG_BYTES = b"\xff\xd8\xff\xe0fake-jpeg-payload"


class _FakeRunner:
    """记录调用并伪造 ffmpeg/ffprobe 结果的替身。

    ffmpeg 提取命令：向输出路径写入 JPEG 字节，stderr 按脚本给出 YAVG。
    ffprobe 流探测：返回 "video"。
    """

    def __init__(self, lumas: list[float] | None = None, fail: bool = False) -> None:
        self.ffmpeg_calls: list[list[str]] = []
        self.lumas = list(lumas or [128.0])
        self.fail = fail
        self.on_call: object = None

    def __call__(self, command: list[str], **_kwargs: object) -> subprocess.CompletedProcess[str]:
        tool = Path(command[0]).name.lower()
        if callable(self.on_call):
            self.on_call(tool)
        if tool.startswith("ffprobe"):
            return subprocess.CompletedProcess(command, 0, stdout="video\n", stderr="")
        output = command[-1]
        Path(output).write_bytes(JPEG_BYTES)
        luma = self.lumas.pop(0) if self.lumas else 128.0
        stderr = f"[Parsed_metadata_1 @ 0x1] lavfi.signalstats.YAVG={luma}\n"
        returncode = 1 if self.fail else 0
        if self.fail:
            Path(output).unlink(missing_ok=True)
        self.ffmpeg_calls.append(command)
        return subprocess.CompletedProcess(command, returncode, stdout="", stderr=stderr)


class HelperTests(unittest.TestCase):
    def test_candidate_timestamps_for_known_duration(self) -> None:
        # 约 10% 处并限制在 1~5 秒：120 秒视频 → [5.0, 2.0]。
        self.assertEqual(candidate_timestamps(120.0), [5.0, 2.0])

    def test_candidate_timestamps_clamped_to_short_clips(self) -> None:
        # 短片限制在有效时长内且不重复。
        self.assertEqual(candidate_timestamps(1.5), [1.0, 0.75])

    def test_candidate_timestamps_unknown_duration_falls_back_early(self) -> None:
        self.assertEqual(candidate_timestamps(None), [0.5, 1.0, 2.0])
        self.assertEqual(candidate_timestamps(0.0), [0.5, 1.0, 2.0])

    def test_candidate_timestamps_at_most_three_unique(self) -> None:
        self.assertLessEqual(len(candidate_timestamps(600.0)), 3)

    def test_parse_luma_and_bounds(self) -> None:
        self.assertEqual(parse_luma("x lavfi.signalstats.YAVG=200.5 y"), 200.5)
        self.assertIsNone(parse_luma("no metadata here"))
        self.assertIsNone(parse_luma("lavfi.signalstats.YAVG=999"))
        # 几乎全黑/全白被拒绝；无亮度数据时按可用帧接受。
        self.assertFalse(luma_acceptable(8.0))
        self.assertFalse(luma_acceptable(250.0))
        self.assertTrue(luma_acceptable(120.0))
        self.assertTrue(luma_acceptable(None))

    def test_cover_cache_key_tracks_media_version(self) -> None:
        with TemporaryDirectory() as temp:
            media = Path(temp) / "clip.mp4"
            media.write_bytes(b"v1")
            first = cover_cache_key(media, media.stat())
            self.assertEqual(cover_cache_key(media, media.stat()), first)
            media.write_bytes(b"version-two-longer")
            self.assertNotEqual(cover_cache_key(media, media.stat()), first)


class ThumbnailPayloadTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = TemporaryDirectory()
        self.root = Path(self.temp_dir.name).resolve()
        self.cache = self.root / "cover-cache"
        self.ffmpeg = self.root / "ffmpeg.exe"
        self.ffprobe = self.root / "ffprobe.exe"
        self.ffmpeg.write_bytes(b"")
        self.ffprobe.write_bytes(b"")
        self.tools = FfmpegTools(ffmpeg=self.ffmpeg, ffprobe=self.ffprobe)
        self.runner = _FakeRunner()

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def _project(self, name: str = "clip.mosp", media: str | None = "clip.mp4", payload: str | None = None) -> Path:
        project = self.root / name
        if payload is not None:
            project.write_text(payload, encoding="utf-8")
        else:
            data = {} if media is None else {"media": media}
            project.write_text(__import__("json").dumps(data), encoding="utf-8")
        if media:
            (self.root / media).write_bytes(b"fake-media")
        return project

    def _payload(self, project: Path, **kwargs: object) -> dict:
        with mock.patch.object(launcher_thumbnails, "media_duration_seconds", return_value=100.0):
            return thumbnail_payload(
                project,
                ffmpeg_tools=self.tools,
                cache_dir=self.cache,
                runner=kwargs.pop("runner", self.runner),
                **kwargs,
            )

    def test_missing_project_file_uses_placeholder_state(self) -> None:
        result = self._payload(self.root / "ghost.mosp")
        self.assertEqual(result["state"], STATE_PROJECT_MISSING)
        self.assertEqual(self.runner.ffmpeg_calls, [])

    def test_broken_project_json_uses_broken_state(self) -> None:
        project = self._project(payload="{not json")
        result = self._payload(project)
        self.assertEqual(result["state"], STATE_PROJECT_BROKEN)

    def test_project_without_media_reports_media_missing(self) -> None:
        project = self._project(media=None, payload='{"segments": []}')
        result = self._payload(project)
        self.assertEqual(result["state"], STATE_MEDIA_MISSING)
        self.assertEqual(self.runner.ffmpeg_calls, [])

    def test_audio_project_short_circuits_without_extraction(self) -> None:
        project = self._project(media="voice.wav")
        result = self._payload(project)
        self.assertEqual(result["state"], STATE_AUDIO)
        self.assertEqual(result["mediaName"], "voice.wav")
        self.assertEqual(self.runner.ffmpeg_calls, [])
        self.assertNotIn("dataUri", result)

    def test_video_project_extracts_16x9_frame_with_luma_check(self) -> None:
        project = self._project()
        result = self._payload(project)
        self.assertEqual(result["state"], STATE_IMAGE)
        self.assertTrue(result["dataUri"].startswith("data:image/jpeg;base64,"))
        self.assertEqual(result["mediaName"], "clip.mp4")
        command = self.runner.ffmpeg_calls[0]
        self.assertIn("signalstats", " ".join(command))
        self.assertIn("crop=480:270", " ".join(command))
        # 命中的候选帧：120 秒时长的第一候选是 5 秒。
        self.assertIn("5.000", command)

    def test_near_black_first_candidate_falls_through_to_next(self) -> None:
        runner = _FakeRunner(lumas=[3.0, 128.0])
        project = self._project()
        result = self._payload(project, runner=runner)
        self.assertEqual(result["state"], STATE_IMAGE)
        self.assertEqual(len(runner.ffmpeg_calls), 2)
        # 第二候选 2 秒被采用。
        self.assertEqual(runner.ffmpeg_calls[1][4], "2.000")

    def test_extraction_failure_short_caches_and_force_retries(self) -> None:
        runner = _FakeRunner(fail=True)
        project = self._project()
        first = self._payload(project, runner=runner)
        self.assertEqual(first["state"], STATE_FAILED)
        calls_after_first = len(runner.ffmpeg_calls)
        self.assertGreater(calls_after_first, 0)
        second = self._payload(project, runner=runner)
        # 失败短期缓存：不再启动 FFmpeg。
        self.assertEqual(second["state"], STATE_FAILED)
        self.assertEqual(len(runner.ffmpeg_calls), calls_after_first)
        forced = thumbnail_payload(
            project, ffmpeg_tools=self.tools, cache_dir=self.cache, runner=runner, force=True,
        )
        self.assertEqual(forced["state"], STATE_FAILED)
        self.assertGreater(len(runner.ffmpeg_calls), calls_after_first)

    @mock.patch.object(launcher_thumbnails, "media_duration_seconds", return_value=100.0)
    def test_same_media_deduplicates_parallel_requests(self, _duration: mock.Mock) -> None:
        project = self._project()
        media = self.root / "clip.mp4"
        key = cover_cache_key(media, media.stat())
        release = threading.Event()
        runner = _FakeRunner()
        # 仅阻塞 ffmpeg 提取（ffprobe 探测不经过提取去重段）。
        runner.on_call = lambda tool: release.wait(timeout=5) if tool.startswith("ffmpeg") else None
        results: list[dict] = []
        errors: list[BaseException] = []

        def worker() -> None:
            try:
                results.append(thumbnail_payload(
                    project, ffmpeg_tools=self.tools, cache_dir=self.cache, runner=runner,
                ))
            except BaseException as error:  # noqa: BLE001 - 测试线程收集
                errors.append(error)

        owner = threading.Thread(target=worker)
        owner.start()
        try:
            deadline = 50
            while launcher_thumbnails._INFLIGHT.get(key) is None and deadline > 0:
                deadline -= 1
                threading.Event().wait(0.02)
            self.assertIsNotNone(launcher_thumbnails._INFLIGHT.get(key))
            # 同媒体并发请求：等待进行中的提取，而不是再次启动 FFmpeg。
            follower = thumbnail_payload(
                project, ffmpeg_tools=self.tools, cache_dir=self.cache, runner=runner,
            )
            self.assertEqual(follower["state"], STATE_IMAGE)
            self.assertEqual(len(runner.ffmpeg_calls), 1)
        finally:
            release.set()
            owner.join(timeout=5)
        self.assertEqual(errors, [])
        self.assertEqual(results and results[0]["state"], STATE_IMAGE)

    def test_clear_cover_cache_removes_cached_images(self) -> None:
        self.cache.mkdir(parents=True, exist_ok=True)
        (self.cache / "a.jpg").write_bytes(b"x")
        (self.cache / "b.jpg").write_bytes(b"y")
        result = clear_cover_cache(self.cache)
        self.assertTrue(result["ok"])
        self.assertEqual(result["removed"], 2)
        self.assertEqual(list(self.cache.iterdir()), [])

    def test_project_file_is_not_modified(self) -> None:
        project = self._project()
        before = project.read_bytes()
        self._payload(project)
        self.assertEqual(project.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
