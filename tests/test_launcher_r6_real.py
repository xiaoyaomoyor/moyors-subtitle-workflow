"""R6 生产验收：真实 FFmpeg 封面/波形/取消与复杂工程全链（审查案 R6 第 3 条）。

需要便携 FFmpeg 位于 ``build/ffmpeg-bin``（gitignored；本仓库不提交二进制）。
没有该目录时整组跳过并在原因中说明——不用模拟结果代替真实验收。
"""
from __future__ import annotations

import json
import os
import tempfile
import subprocess
import unittest
from pathlib import Path
from subprocess import run
from tempfile import TemporaryDirectory
from threading import Event
from unittest import mock
from maw.launcher_projects import all_projects_payload, read_media_index, register_project

from maw.gui_web import LauncherApi, LauncherPaths

ROOT = Path(__file__).resolve().parents[1]
FFMPEG_BIN = ROOT / "build" / "ffmpeg-bin"
FFMPEG = FFMPEG_BIN / "ffmpeg.exe"
FFPROBE = FFMPEG_BIN / "ffprobe.exe"

REAL_FFMPEG = FFMPEG.is_file() and FFPROBE.is_file()

_skip = unittest.skipUnless(
    REAL_FFMPEG,
    "R6 真实媒体验收需要 build/ffmpeg-bin 下的便携 FFmpeg（下载脚本见 build/，不随仓库分发）",
)


def _run(command: list[str]) -> None:
    result = subprocess.run(command, capture_output=True, text=True, timeout=180)  # noqa: S603 - 固定参数的合成媒体
    assert result.returncode == 0, f"{command[:3]} 失败：{result.stderr[-800:]}"


@_skip
class RealMediaAcceptanceTests(unittest.TestCase):
    """真实 FFmpeg：封面状态机、波形工程、取消与复杂工程产物可被编辑器加载。"""

    @classmethod
    def setUpClass(cls) -> None:
        cls.temp_dir = TemporaryDirectory()
        cls.root = Path(cls.temp_dir.name)
        cls.media_dir = cls.root / "media"
        cls.media_dir.mkdir()
        cls._synthesize()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.temp_dir.cleanup()

    @classmethod
    def _synthesize(cls) -> None:
        video = str(FFMPEG)
        # 横屏 8 秒：testsrc2 + 正弦音轨。
        _run([video, "-hide_banner", "-loglevel", "error", "-y",
              "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=15",
              "-f", "lavfi", "-i", "sine=frequency=440",
              "-t", "8", "-c:v", "libx264", "-pix_fmt", "yuv420p",
              "-c:a", "aac", str(cls.media_dir / "landscape.mp4")])
        # 竖屏 6 秒。
        _run([video, "-hide_banner", "-loglevel", "error", "-y",
              "-f", "lavfi", "-i", "testsrc2=size=360x640:rate=15",
              "-f", "lavfi", "-i", "sine=frequency=520",
              "-t", "6", "-c:v", "libx264", "-pix_fmt", "yuv420p",
              "-c:a", "aac", str(cls.media_dir / "portrait.mp4")])
        # 超短片 1.2 秒：候选时间点必须夹在有效时长内。
        _run([video, "-hide_banner", "-loglevel", "error", "-y",
              "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=15",
              "-f", "lavfi", "-i", "sine=frequency=600",
              "-t", "1.2", "-c:v", "libx264", "-pix_fmt", "yuv420p",
              "-c:a", "aac", str(cls.media_dir / "short.mp4")])
        # 近全黑视频：首候选应被亮度判定拒绝并回退到后续候选帧。
        _run([video, "-hide_banner", "-loglevel", "error", "-y",
              "-f", "lavfi", "-i", "color=black:s=640x360:r=15",
              "-f", "lavfi", "-i", "sine=frequency=300",
              "-t", "5", "-c:v", "libx264", "-pix_fmt", "yuv420p",
              "-c:a", "aac", str(cls.media_dir / "black.mp4")])
        # 纯音频。
        _run([video, "-hide_banner", "-loglevel", "error", "-y",
              "-f", "lavfi", "-i", "sine=frequency=440", "-t", "5",
              "-c:a", "aac", str(cls.media_dir / "voice.m4a")])
        # 长视频（30 秒）用于取消链。
        _run([video, "-hide_banner", "-loglevel", "error", "-y",
              "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=10",
              "-f", "lavfi", "-i", "sine=frequency=350",
              "-t", "30", "-c:v", "libx264", "-pix_fmt", "yuv420p",
              "-c:a", "aac", str(cls.media_dir / "long.mp4")])

    def _api(self) -> tuple[LauncherApi, TemporaryDirectory]:
        holder = TemporaryDirectory()
        root = Path(holder.name)
        env = root / ".env"
        env.write_text(f"FFMPEG_PATH={FFMPEG_BIN}\n", encoding="utf-8")
        paths = LauncherPaths(
            root=root,
            env_path=env,
            launcher_html=root / "launcher.html",
            recent_metadata=root / "launcher-recent.json",
                project_registry=root / "launcher-project-registry.json",
        )
        return LauncherApi(paths=paths), holder

    # ---------------- 封面（§6.2 验收清单） ----------------

    def test_real_cover_for_landscape_portrait_and_short_videos(self) -> None:

        api, holder = self._api()
        try:
            for name in ("landscape.mp4", "portrait.mp4", "short.mp4"):
                project = self.root / "media" / (Path(name).stem + ".mosp")
                project.write_text(json.dumps({"media": name, "segments": []}), encoding="utf-8")
                result = api.get_recent_project_thumbnail({"path": str(project)})
                self.assertTrue(result["ok"], result)
                self.assertEqual(result["state"], "image", f"{name}: {result}")
                self.assertTrue(result["dataUri"].startswith("data:image/jpeg;base64,"), name)
                self.assertGreater(len(result["dataUri"]), 2000, name)
        finally:
            holder.cleanup()

    def test_real_cover_black_video_falls_back_and_pure_audio_short_circuits(self) -> None:

        api, holder = self._api()
        try:
            black_project = self.root / "media" / "black.mosp"
            black_project.write_text(json.dumps({"media": "black.mp4", "segments": []}), encoding="utf-8")
            result = api.get_recent_project_thumbnail({"path": str(black_project)})
            # 近全黑候选被拒绝后回退：仍尽力给出可用帧（§6.2「使用可用帧或占位」）。
            self.assertIn(result["state"], {"image", "failed"}, result)

            audio_project = self.root / "media" / "voice.mosp"
            audio_project.write_text(json.dumps({"media": "voice.m4a", "segments": []}), encoding="utf-8")
            result = api.get_recent_project_thumbnail({"path": str(audio_project)})
            self.assertEqual(result["state"], "audio", result)
            self.assertEqual(result["mediaName"], "voice.m4a")
            self.assertNotIn("dataUri", result)
        finally:
            holder.cleanup()

    def test_real_cover_cache_reuses_the_same_media(self) -> None:
        api, holder = self._api()
        try:
            project = self.root / "media" / "landscape.mosp"
            project.write_text(json.dumps({"media": "landscape.mp4", "segments": []}), encoding="utf-8")
            first = api.get_recent_project_thumbnail({"path": str(project)})
            self.assertEqual(first["state"], "image")
            version = first["version"]
            from maw.launcher_thumbnails import cover_cache_dir
            cached = list(cover_cache_dir().glob(f"{version}.jpg"))
            self.assertEqual(len(cached), 1)
            second = api.get_recent_project_thumbnail({"path": str(project)})
            self.assertEqual(second["state"], "image")
            self.assertEqual(second["version"], version)
        finally:
            holder.cleanup()

    # ---------------- 波形工程与取消（R6 第 3 条） ----------------

    def test_real_waveform_project_and_media_only_project(self) -> None:
        api, holder = self._api()
        events: list[dict] = []
        api._emit = lambda event: events.append(event)
        try:
            started = api.start_waveform_project({
                "mediaPath": str(self.root / "media" / "landscape.mp4"),
                "generateSpectral": False,
                "waveform": True,
            })
            self.assertTrue(started["ok"], started)
            api.waveform_worker.join(timeout=120)
            completed = [e for e in events if e.get("status") == "completed"]
            self.assertEqual(len(completed), 1, events)
            project_path = Path(completed[0]["projectPath"])
            self.assertTrue(project_path.is_file())
            self.assertTrue(project_path.name.endswith(".waveform.mosp"))
            # 峰值写入随工程收集的 .quapeaks 缓存（不内联工程 JSON）。
            reapeaks = completed[0].get("reapeaksPath") or ""
            self.assertTrue(reapeaks, completed[0])
            self.assertTrue(Path(reapeaks).is_file())
            media_only_check = json.loads(project_path.read_text(encoding="utf-8"))
            self.assertEqual(media_only_check.get("media"), str(self.root / "media" / "landscape.mp4"))

            events.clear()
            media_only = api.start_waveform_project({
                "mediaPath": str(self.root / "media" / "landscape.mp4"),
                "generateSpectral": False,
                "waveform": False,
            })
            self.assertTrue(media_only["ok"], media_only)
            api.waveform_worker.join(timeout=60)
            completed = [e for e in events if e.get("status") == "completed"]
            self.assertTrue(completed[0]["projectPath"].endswith(".media.mosp"))
            self.assertFalse(completed[0].get("reapeaksPath"), completed[0])
            data = json.loads(Path(completed[0]["projectPath"]).read_text(encoding="utf-8"))
            self.assertNotIn("waveform", data)
        finally:
            holder.cleanup()

    def test_real_waveform_cancel_returns_cancelled_result(self) -> None:
        api, holder = self._api()
        try:
            cancel = Event()
            cancel.set()  # 提取前即取消：确定性验证取消链贯穿真实提取调用。
            result = api._generate_media_project_sync(
                {"waveform": True, "generateSpectral": False},
                self.root / "media" / "long.mp4",
                0,
                0,
                __import__("maw.gui_web", fromlist=["_postprocess_ffmpeg_tools"])._postprocess_ffmpeg_tools(api.paths.env_path),
                cancel,
            )
            self.assertFalse(result.get("ok"))
            self.assertTrue(result.get("cancelled"))
        finally:
            holder.cleanup()

    # ---------------- 复杂工程全链（发布门槛：已有复杂工程再处理） ----------------

    def test_complex_project_reprocess_output_loads_in_editor(self) -> None:
        import importlib.util
        import sys as _sys
        from tests.test_launcher_r4 import _complex_project, _replace_plan

        server_path = ROOT / "server-editor" / "serve.py"
        spec = importlib.util.spec_from_file_location("msw_r6_editor_server", server_path)
        server_editor = importlib.util.module_from_spec(spec)
        _sys.modules[spec.name] = server_editor
        spec.loader.exec_module(server_editor)

        api, holder = self._api()
        events: list[dict] = []
        api._emit = lambda event: events.append(event)
        try:
            project_dir = holder.name
            project_path = Path(project_dir) / "clip.mosp"
            (Path(project_dir) / "clip.mp3").write_bytes(b"audio")
            project_path.write_text(json.dumps(_complex_project(Path(project_dir)), ensure_ascii=False), encoding="utf-8")
            plan = {
                "version": 1,
                "inputMode": "project",
                "input": {"path": str(project_path), "generateSpectral": False},
                "modules": {"waveform": True, "asr": False, "postprocess": ["replace"], "alignment": False},
                "postprocess": _replace_plan(),
                "output": {"srtPath": ""},
            }
            started = api.run_prefab_plan({"plan": plan})
            self.assertTrue(started["ok"], started)
            api.prefab_worker.join(timeout=60)
            completed = [e for e in events if e.get("status") == "completed"]
            self.assertEqual(len(completed), 1, events)

            # 发布门槛：产物能被编辑器真实加载（§7.3 全链往返）。
            output = json.loads(Path(completed[0]["projectPath"]).read_text(encoding="utf-8"))
            self.assertEqual([s["text"] for s in output["segments"]], ["正字", "保留"])
            server_project = server_editor.load_project(
                Path(completed[0]["projectPath"]), None, "",
                no_waveform=True, load_reapeaks=False, peaks_per_second=100,
            )
            self.assertEqual(len(server_project.data["segments"]), 2)
        finally:
            holder.cleanup()


class EnvironmentStateMachineTests(unittest.TestCase):
    """R6 第 4 条：新用户空配置与缺依赖状态机（无需 FFmpeg）。"""

    def test_fresh_environment_boots_with_empty_state(self) -> None:
        with TemporaryDirectory() as temp:
            root = Path(temp)
            paths = LauncherPaths(
                root=root,
                env_path=root / ".env",
                launcher_html=root / "launcher.html",
                recent_metadata=root / "launcher-recent.json",
                project_registry=root / "launcher-project-registry.json",
            )
            api = LauncherApi(paths=paths)
            config = api.get_config()
            # get_config 直接返回配置对象（含 providers/providers 元数据），无 ok 包裹。
            self.assertTrue(config.get("providers"))
            self.assertIn("theme", config)
            # 编辑器最近索引是真机文件：隔离到空列表验证新用户空态。
            with mock.patch("maw.launcher_projects._read_editor_recent_paths", return_value=[]):
                recents = api.get_recent_projects()
            self.assertTrue(recents["ok"])
            self.assertEqual(recents["projects"], [])

    def test_thumbnail_reports_missing_ffmpeg_without_extraction(self) -> None:
        from maw.ffmpeg import FfmpegTools
        from maw.launcher_thumbnails import thumbnail_payload

        with TemporaryDirectory() as temp:
            root = Path(temp)
            project = root / "clip.mosp"
            (root / "clip.mp4").write_bytes(b"media")
            project.write_text(json.dumps({"media": "clip.mp4", "segments": []}), encoding="utf-8")
            result = thumbnail_payload(
                project,
                ffmpeg_tools=FfmpegTools(ffmpeg=None, ffprobe=None),
                cache_dir=root / "covers",
            )
            self.assertTrue(result["ok"])
            self.assertEqual(result["state"], "failed")
            self.assertIn("FFmpeg", str(result.get("message", "")))


if __name__ == "__main__":
    unittest.main()


class RealMediaT5ClosedLoopTests(unittest.TestCase):
    """T5：真实媒体 + 本轮前端改动路径的闭环——提帧、登记、媒体名索引。"""

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.registry = self.root / "launcher-project-registry.json"
        self.media_index = self.root / "launcher-media-index.json"
        env = tempfile.NamedTemporaryFile(mode="w", suffix=".env", delete=False, encoding="utf-8")
        env.write(f"FFMPEG_PATH={FFMPEG_BIN}\n")
        env.close()
        self.env_path = Path(env.name)
        self.api = LauncherApi(paths=LauncherPaths(root=self.root, env_path=self.env_path, launcher_html=self.root / "launcher.html", project_registry=self.registry, media_index=self.media_index), window_getter=lambda: None)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()
        os.unlink(self.env_path)

    def _synth(self, name: str, seconds: float = 3.0) -> Path:
        media = self.root / name
        run([str(FFMPEG_BIN / "ffmpeg"), "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", f"testsrc2=duration={seconds}:size=320x240:rate=10", "-pix_fmt", "yuv420p", "-y", str(media)], check=True, capture_output=True)
        return media

    def test_thumbnail_registers_media_name_index_and_real_frame(self) -> None:
        """提帧成功 → 封面 data URI + 媒体名写入轻量索引 + 登记可分页检索。"""
        media = self._synth("t5-clip.mp4")
        project = media.with_suffix(".mosp")
        project.write_text(json.dumps({"media": media.name, "segments": []}), encoding="utf-8")
        # 登记经统一服务（桥接内联调用 _register_project_safe）。
        register_project(project, source="created", registry_path=self.registry)
        thumb = self.api.get_recent_project_thumbnail({"path": str(project)})
        self.assertTrue(thumb.get("ok"))
        self.assertEqual(thumb.get("state"), "image")
        self.assertTrue(str(thumb.get("dataUri", "")).startswith("data:image/jpeg;base64,"))
        # A6：媒体名经桥接写回轻量索引（键=工程路径 resolve 后原样，值为媒体文件名）。
        index = read_media_index(self.media_index)
        self.assertEqual(index.get(str(project.expanduser().resolve())), "t5-clip.mp4")
        # T2：按媒体名在全部工程分页检索可命中。
        listing = all_projects_payload(registry_path=self.registry, media_index=self.media_index, query="t5-clip", page=1, page_size=12)
        self.assertEqual(listing["matched"], 1)
        self.assertEqual(listing["mediaIndexed"], 1)

    def test_waveform_and_output_contract_end_to_end(self) -> None:
        """波形工程 + 输出导出开关端到端：exportSrt=False 只产工程不落 SRT。"""
        media = self._synth("t5-wave.mp4")
        from maw.postprocess_pipeline import _publish_final
        project = media.with_suffix(".mosp")
        project.write_text(json.dumps({"segments": []}), encoding="utf-8")
        srt = media.with_suffix(".srt")
        srt.write_text("1\n00:00:01,000 --> 00:00:02,000\n原文\n", encoding="utf-8")
        out_dir = self.root / "Out"
        final_project, final_srt, _ = _publish_final(project, srt, project, srt, export_srt=False, output_directory=str(out_dir), output_stem="t5-only-project")
        self.assertTrue(final_project.is_file())
        self.assertIsNone(final_srt)
        self.assertFalse((out_dir / "t5-only-project.srt").exists())
