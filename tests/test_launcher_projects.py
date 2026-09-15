"""Launcher recent-project index tests (C 阶段)."""

from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import mock

from maw import launcher_projects
from maw.launcher_projects import (
    LauncherRecentMetadata,
    note_project_opened,
    project_stats_payload,
    recent_projects_payload,
    relocate_recent_project,
    remove_recent_project,
    set_recent_project_pinned,
)


def _write_json(path: Path, payload: object) -> Path:
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return path


class RecentProjectsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.settings = _write_json(self.root / "server-editor-settings.json", {"recent_projects": []})
        self.metadata = self.root / "launcher-recent.json"

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def _set_editor_recent(self, *paths: Path) -> None:
        _write_json(self.settings, {
            "recent_projects": [{"path": str(path), "name": path.name} for path in paths],
        })

    def test_merges_editor_list_with_launcher_view_state(self) -> None:
        first = self.root / "first.mosp"
        second = self.root / "second.mosp"
        first.write_text("{}", encoding="utf-8")
        second.write_text("{}", encoding="utf-8")
        self._set_editor_recent(first, second)
        set_recent_project_pinned(second, True, metadata_path=self.metadata)
        remove_recent_project(first, metadata_path=self.metadata)

        result = recent_projects_payload(settings_path=self.settings, metadata_path=self.metadata)

        self.assertTrue(result["ok"])
        self.assertEqual([item["path"] for item in result["projects"]], [str(second)])
        self.assertTrue(result["projects"][0]["pinned"])
        self.assertTrue(result["projects"][0]["exists"])

    def test_last_opened_takes_newer_of_editor_and_launcher_records(self) -> None:
        # H06：编辑器记录时间与启动器记录时间取较新者。
        project = self.root / "timed.mosp"
        project.write_text("{}", encoding="utf-8")
        _write_json(self.settings, {
            "recent_projects": [
                {"path": str(project), "name": project.name, "openedAt": "2020-01-01T00:00:00+00:00"},
            ],
        })
        result = recent_projects_payload(settings_path=self.settings, metadata_path=self.metadata)
        self.assertEqual(result["projects"][0]["lastOpenedAt"], "2020-01-01T00:00:00+00:00")

        note_project_opened(project, metadata_path=self.metadata)
        result = recent_projects_payload(settings_path=self.settings, metadata_path=self.metadata)
        newer = result["projects"][0]["lastOpenedAt"]
        self.assertNotEqual(newer, "2020-01-01T00:00:00+00:00")
        self.assertGreater(newer, "2020-01-01T00:00:00+00:00")

        # 编辑器记录更新时再次取较新者（远未来时间与真实时钟无关）。
        _write_json(self.settings, {
            "recent_projects": [
                {"path": str(project), "name": project.name, "openedAt": "2099-01-01T00:00:00+00:00"},
            ],
        })
        result = recent_projects_payload(settings_path=self.settings, metadata_path=self.metadata)
        self.assertEqual(result["projects"][0]["lastOpenedAt"], "2099-01-01T00:00:00+00:00")

    def test_stats_payload_reports_media_file_name(self) -> None:
        # H01/H04：卡片媒体文件名来自工程实际 media 引用。
        project = self.root / "withmedia.mosp"
        _write_json(project, {"segments": [], "media": "D:/Videos/clip.mp4"})
        result = project_stats_payload(project)
        self.assertTrue(result["ok"])
        self.assertEqual(result["mediaName"], "clip.mp4")

    def test_removed_entry_returns_when_opened_again(self) -> None:
        project = self.root / "project.mosp"
        project.write_text("{}", encoding="utf-8")
        self._set_editor_recent(project)
        remove_recent_project(project, metadata_path=self.metadata)
        note_project_opened(project, metadata_path=self.metadata)

        result = recent_projects_payload(settings_path=self.settings, metadata_path=self.metadata)
        self.assertEqual([item["path"] for item in result["projects"]], [str(project)])
        self.assertTrue(result["projects"][0]["lastOpenedAt"])

    def test_relocate_maps_missing_path_to_new_file(self) -> None:
        old = self.root / "moved" / "old.mosp"
        new = self.root / "new.mosp"
        new.write_text("{}", encoding="utf-8")
        self._set_editor_recent(old)

        result = relocate_recent_project(old, new, metadata_path=self.metadata)
        self.assertTrue(result["ok"])

        payload = recent_projects_payload(settings_path=self.settings, metadata_path=self.metadata)
        self.assertEqual([item["path"] for item in payload["projects"]], [str(new)])
        self.assertTrue(payload["projects"][0]["exists"])

    def test_stats_counts_main_sub_and_audio(self) -> None:
        project = self.root / "stats.mosp"
        _write_json(project, {
            "segments": [{"start": 0, "end": 100, "items": []}],
            "multi_subtitle": {
                "tracks": [
                    {"id": "main", "segments": [{"start": 0, "end": 100}]},
                    {"id": "translation-en", "segments": [{}, {}]},
                ],
            },
            "msw": {"audio_clips": [{"id": "a1"}]},
        })

        result = project_stats_payload(project)
        self.assertTrue(result["ok"])
        self.assertEqual(result["mainSubtitles"], 1)
        self.assertEqual(result["subSubtitles"], 2)
        self.assertEqual(result["audioClips"], 1)

    def test_stats_tolerates_missing_and_broken_files(self) -> None:
        missing = self.root / "missing.mosp"
        self.assertFalse(project_stats_payload(missing)["ok"])
        broken = self.root / "broken.mosp"
        broken.write_text("{not json", encoding="utf-8")
        self.assertFalse(project_stats_payload(broken)["ok"])

    def test_metadata_round_trip_keeps_unknown_fields_out(self) -> None:
        metadata = LauncherRecentMetadata()
        metadata.pinned[str(self.root / "a.mosp")] = "2026-09-14T00:00:00+00:00"
        metadata.removed.add(str(self.root / "b.mosp"))
        metadata.aliases[str(self.root / "c.mosp")] = str(self.root / "d.mosp")
        launcher_projects.write_launcher_metadata(metadata, self.metadata)
        loaded = launcher_projects.read_launcher_metadata(self.metadata)
        self.assertEqual(loaded.pinned, metadata.pinned)
        self.assertEqual(loaded.removed, metadata.removed)
        self.assertEqual(loaded.aliases, metadata.aliases)


class StartServerIntentTests(unittest.TestCase):
    """start_server 的显式意图与会话身份校验（C 阶段核心验收）。"""

    def setUp(self) -> None:
        self.temp_dir = TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        from maw.gui_web import LauncherApi, LauncherPaths

        self.paths = LauncherPaths(
            root=self.root,
            env_path=self.root / ".env",
            launcher_html=self.root / "launcher.html",
            recent_metadata=self.root / "launcher-recent.json",
        )
        self.api = LauncherApi(paths=self.paths)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_blank_intent_passes_blank_flag(self) -> None:
        class FakeProcess:
            returncode = None

            def poll(self) -> int | None:
                return None

        with mock.patch("maw.gui_web.subprocess.Popen", return_value=FakeProcess()) as popen:
            with mock.patch("maw.gui_web._wait_for_server", return_value=True):
                result = self.api.start_server({"intent": "blank", "port": "8765"})

        self.assertTrue(result["ok"])
        command = popen.call_args.args[0]
        self.assertIn("--blank", command)
        self.assertNotIn("serverAlreadyRunning", result)

    def test_conflicting_server_identity_is_reported_not_reused(self) -> None:
        other = self.root / "other.mosp"
        other.write_text("{}", encoding="utf-8")
        target = self.root / "target.mosp"
        target.write_text("{}", encoding="utf-8")

        with mock.patch("maw.gui_web._probe_existing_server", return_value={"projectPath": str(other)}):
            with mock.patch("maw.gui_web.subprocess.Popen") as popen:
                result = self.api.start_server({"intent": "project", "jsonPath": str(target), "port": "8765"})

        self.assertFalse(result["ok"])
        self.assertEqual(result["code"], "server_conflict")
        self.assertEqual(result["conflict"]["projectPath"], str(other))
        popen.assert_not_called()

    def test_same_project_reuses_existing_session(self) -> None:
        target = self.root / "target.mosp"
        target.write_text("{}", encoding="utf-8")
        with mock.patch("maw.gui_web._probe_existing_server", return_value={"projectPath": str(target)}):
            with mock.patch("maw.gui_web.subprocess.Popen") as popen:
                result = self.api.start_server({"intent": "project", "jsonPath": str(target), "port": "8765"})

        self.assertTrue(result["ok"])
        self.assertTrue(result["serverAlreadyRunning"])
        self.assertTrue(result["sameProject"])
        popen.assert_not_called()

    def test_blank_conflicts_with_running_project_session(self) -> None:
        other = self.root / "other.mosp"
        other.write_text("{}", encoding="utf-8")
        with mock.patch("maw.gui_web._probe_existing_server", return_value={"projectPath": str(other)}):
            with mock.patch("maw.gui_web.subprocess.Popen") as popen:
                result = self.api.start_server({"intent": "blank", "port": "8765"})

        self.assertFalse(result["ok"])
        self.assertEqual(result["code"], "server_conflict")
        popen.assert_not_called()

    def test_independent_port_conflict_starts_isolated_server(self) -> None:
        other = self.root / "other.mosp"
        other.write_text("{}", encoding="utf-8")
        target = self.root / "target.mosp"
        target.write_text("{}", encoding="utf-8")

        class FakeProcess:
            returncode = None

            def poll(self) -> int | None:
                return None

        with mock.patch("maw.gui_web._probe_existing_server", return_value={"projectPath": str(other)}):
            with mock.patch("maw.gui_web._free_local_port", return_value=9898):
                with mock.patch("maw.gui_web.subprocess.Popen", return_value=FakeProcess()) as popen:
                    with mock.patch("maw.gui_web._wait_for_server", return_value=True):
                        result = self.api.start_server({
                            "intent": "project",
                            "jsonPath": str(target),
                            "port": "8765",
                            "independentPort": True,
                        })

        self.assertTrue(result["ok"])
        self.assertEqual(result["url"], "http://127.0.0.1:9898/?lang=zh")
        command = popen.call_args.args[0]
        self.assertEqual(command[command.index("--port") + 1], "9898")


if __name__ == "__main__":
    unittest.main()
