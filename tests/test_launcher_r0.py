"""R0 修正案回归：多会话隔离、媒体工程开关、可取消任务与打开记录时序。"""

from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import mock

from maw.gui_web import LauncherApi, LauncherPaths


class RunningProcess:
    def __init__(self) -> None:
        self.returncode = None

    def poll(self) -> int | None:
        return self.returncode

    def terminate(self) -> None:
        self.returncode = -15

    def wait(self, timeout: float | None = None) -> int:
        return self.returncode or 0


def _project(root: Path, name: str) -> Path:
    path = root / name
    path.write_text(json.dumps({"segments": []}), encoding="utf-8")
    return path


class MultiSessionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.paths = LauncherPaths(
            root=self.root,
            env_path=self.root / ".env",
            launcher_html=self.root / "launcher.html",
            recent_metadata=self.root / "launcher-recent.json",
        )
        self.api = LauncherApi(paths=self.paths)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def _start(self, payload: dict) -> dict:
        with mock.patch("maw.gui_web.subprocess.Popen", return_value=RunningProcess()):
            with mock.patch("maw.gui_web._probe_existing_server", return_value=None):
                with mock.patch("maw.gui_web._wait_for_server", return_value=True):
                    return self.api.start_server(payload)

    def test_independent_port_keeps_primary_session_alive(self) -> None:
        """R0/F01：独立端口启动不得停止旧受管会话。"""
        primary_project = _project(self.root, "primary.mosp")
        other_project = _project(self.root, "other.mosp")
        first = self._start({"intent": "project", "jsonPath": str(primary_project), "port": "8765"})
        self.assertTrue(first["ok"])
        primary_process = self.api.editor_sessions[8765].process

        second = self._start({
            "intent": "project",
            "jsonPath": str(other_project),
            "port": "8765",
            "independentPort": True,
        })
        self.assertTrue(second["ok"])
        independent_port = second["port"]
        self.assertNotEqual(independent_port, 8765)

        # 旧会话仍在运行且句柄未被覆盖；两个会话并存。
        self.assertIsNone(primary_process.poll())
        self.assertIn(8765, self.api.editor_sessions)
        self.assertIn(independent_port, self.api.editor_sessions)
        self.assertEqual(self.api.editor_sessions[independent_port].project_path, str(other_project))

    def test_normal_start_replaces_only_same_port_session(self) -> None:
        primary_project = _project(self.root, "a.mosp")
        other_project = _project(self.root, "b.mosp")
        self._start({"intent": "project", "jsonPath": str(primary_project), "port": "8765"})
        independent = self._start({
            "intent": "project", "jsonPath": str(other_project), "port": "8765", "independentPort": True,
        })
        independent_port = independent["port"]
        independent_process = self.api.editor_sessions[independent_port].process

        # 普通启动同端口：只替换 8765 的会话，独立端口会话不受影响。
        third = self._start({"intent": "project", "jsonPath": str(other_project), "port": "8765"})
        self.assertTrue(third["ok"])
        self.assertIsNone(independent_process.poll())
        self.assertIn(independent_port, self.api.editor_sessions)

    def test_stop_server_by_url_targets_that_session_only(self) -> None:
        first = self._start({"intent": "blank", "port": "8765"})
        second = self._start({"intent": "blank", "port": "8765", "independentPort": True})
        independent_port = second["port"]
        primary_process = self.api.editor_sessions[8765].process

        result = self.api.stop_server({"url": f"http://127.0.0.1:{independent_port}/"})
        self.assertTrue(result["ok"])
        self.assertTrue(result["stopped"])
        # 被指向的独立会话已停止并移除；主端口会话不受影响。
        self.assertNotIn(independent_port, self.api.editor_sessions)
        self.assertIn(8765, self.api.editor_sessions)
        self.assertIsNone(primary_process.poll())

    def test_get_server_status_reports_managed_sessions(self) -> None:
        self._start({"intent": "blank", "port": "8765"})
        with mock.patch("maw.gui_web._wait_for_server", return_value=False):
            status = self.api.get_server_status({"port": "8765"})
        self.assertTrue(status["ok"])
        self.assertTrue(status["owned"])
        self.assertEqual(len(status["managedSessions"]), 1)
        self.assertEqual(status["managedSessions"][0]["port"], 8765)

    def test_project_opened_recorded_only_after_success(self) -> None:
        """R0/H06：启动失败不得记为「最近打开」。"""
        project = _project(self.root, "failed.mosp")
        with mock.patch("maw.gui_web.subprocess.Popen", return_value=RunningProcess()):
            with mock.patch("maw.gui_web._probe_existing_server", return_value=None):
                with mock.patch("maw.gui_web._wait_for_server", return_value=False):
                    with mock.patch("maw.gui_web._stop_external_maw_server", return_value=False):
                        with mock.patch("maw.gui_web._maw_server_process_id", return_value=None):
                            result = self.api.start_server({
                                "intent": "project", "jsonPath": str(project), "port": "8766",
                            })
        self.assertFalse(result["ok"])
        metadata_text = (self.root / "launcher-recent.json").read_text(encoding="utf-8") if (self.root / "launcher-recent.json").exists() else "{}"
        self.assertNotIn(str(project), metadata_text)

        # 成功路径记录打开时间。
        self._start({"intent": "project", "jsonPath": str(project), "port": "8767"})
        metadata = json.loads((self.root / "launcher-recent.json").read_text(encoding="utf-8"))
        self.assertIn(str(project), metadata.get("openedAt", {}))


class MediaProjectSwitchTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.paths = LauncherPaths(
            root=self.root,
            env_path=self.root / ".env",
            launcher_html=self.root / "launcher.html",
            recent_metadata=self.root / "launcher-recent.json",
        )
        self.api = LauncherApi(paths=self.paths)
        self.media = self.root / "clip.wav"
        self.media.write_bytes(b"riff")

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def _payload(self, **extra: object) -> dict[str, object]:
        payload: dict[str, object] = {"mediaPath": str(self.media)}
        payload.update(extra)
        return payload

    @mock.patch("maw.gui_web.resolve_default_audio_track", return_value=0)
    @mock.patch("maw.gui_web._postprocess_ffmpeg_tools")
    def test_waveform_disabled_writes_media_only_project(self, _tools, _track) -> None:
        """R0/F04：关闭波形模块时产出无波形纯媒体工程。"""
        with mock.patch("maw.gui_web.embed_media_caches") as embed:
            with mock.patch("maw.gui_web.write_mosp") as write:
                result = self.api.generate_waveform_project(self._payload(waveform=False))
        self.assertTrue(result["ok"])
        self.assertTrue(result["waveform"] is False)
        embed.assert_not_called()
        write.assert_called_once()
        self.assertTrue(result["projectPath"].endswith(".media.mosp"))

    @mock.patch("maw.gui_web.resolve_default_audio_track", return_value=0)
    @mock.patch("maw.gui_web._postprocess_ffmpeg_tools")
    def test_waveform_enabled_keeps_existing_contract(self, _tools, _track) -> None:
        cached = mock.Mock()
        cached.project = {"media": str(self.media), "segments": [], "waveform": {"peak_count": 3, "peaks_per_second": 100}}
        cached.waveform_error = None
        cached.reapeaks_path = None
        with mock.patch("maw.gui_web.embed_media_caches", return_value=cached) as embed:
            with mock.patch("maw.gui_web.write_mosp") as write:
                with mock.patch("maw.gui_web.is_waveform_payload", return_value=True):
                    result = self.api.generate_waveform_project(self._payload(generateSpectral=True))
        self.assertTrue(result["ok"])
        self.assertTrue(result["waveform"] is True)
        embed.assert_called_once()
        self.assertTrue(result["projectPath"].endswith(".waveform.mosp"))
        write.assert_called_once()

    @mock.patch("maw.gui_web.resolve_default_audio_track", return_value=0)
    @mock.patch("maw.gui_web._postprocess_ffmpeg_tools")
    def test_start_waveform_project_reports_cancellation(self, _tools, _track) -> None:
        """R0/F08：后台任务绑定取消事件并上报 cancelled。"""
        events: list[dict] = []
        self.api._emit = lambda event: events.append(event)

        def slow_generate(payload, media_path, audio_track, default_audio_track, ffmpeg_tools, cancel_event):
            cancel_event.wait(timeout=2)
            return {"ok": False, "code": "waveform_cancelled", "cancelled": True, "field": "mediaPath", "error": "cancelled"}

        with mock.patch.object(self.api, "_generate_media_project_sync", side_effect=slow_generate):
            started = self.api.start_waveform_project(self._payload())
            self.assertTrue(started["ok"])
            task_id = started["taskId"]
            cancel_result = self.api.cancel_waveform_project()
            self.assertTrue(cancel_result["cancelled"])
            self.api.waveform_worker.join(timeout=3)

        statuses = [event.get("status") for event in events]
        self.assertIn("running", statuses)
        self.assertIn("cancelled", statuses)
        self.assertTrue(all(event.get("taskId") == task_id for event in events))

    @mock.patch("maw.gui_web.resolve_default_audio_track", return_value=0)
    @mock.patch("maw.gui_web._postprocess_ffmpeg_tools")
    def test_start_waveform_project_emits_completed(self, _tools, _track) -> None:
        events: list[dict] = []
        self.api._emit = lambda event: events.append(event)

        def fast_generate(payload, media_path, audio_track, default_audio_track, ffmpeg_tools, cancel_event):
            return {"ok": True, "mediaPath": str(media_path), "projectPath": "D:/out/x.waveform.mosp", "warnings": [], "waveform": True}

        with mock.patch.object(self.api, "_generate_media_project_sync", side_effect=fast_generate):
            started = self.api.start_waveform_project(self._payload())
            self.assertTrue(started["ok"])
            self.api.waveform_worker.join(timeout=3)

        completed = [event for event in events if event.get("status") == "completed"]
        self.assertEqual(len(completed), 1)
        self.assertEqual(completed[0]["projectPath"], "D:/out/x.waveform.mosp")


if __name__ == "__main__":
    unittest.main()
