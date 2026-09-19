"""Launcher recent-project index tests (C 阶段)."""

from __future__ import annotations

import json
import os
import time
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
            project_registry=self.root / "launcher-project-registry.json",
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


class ProjectRegistryTests(unittest.TestCase):
    """S3/§5.2：长期工程目录登记层（全部工程）。"""

    def setUp(self) -> None:
        self.temp_dir = TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.settings = _write_json(self.root / "server-editor-settings.json", {"recent_projects": []})
        self.metadata = self.root / "launcher-recent.json"
        self.registry = self.root / "launcher-project-registry.json"

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_register_dedupes_and_keeps_first_registration(self) -> None:
        project = self.root / "clip.mosp"
        project.write_text("{}", encoding="utf-8")
        launcher_projects.register_project(project, source="created", registry_path=self.registry)
        launcher_projects.register_project(project, source="editor", registry_path=self.registry)
        result = launcher_projects.all_projects_payload(
            settings_path=self.settings, metadata_path=self.metadata, registry_path=self.registry)

        self.assertTrue(result["ok"])
        self.assertEqual(len(result["projects"]), 1)
        entry = result["projects"][0]
        self.assertEqual(entry["source"], "created")  # 首个非迁移来源保留
        self.assertTrue(entry["exists"])
        self.assertEqual(result["total"], 1)

    def test_windows_identity_is_case_insensitive(self) -> None:
        project = self.root / "Clip.mosp"
        project.write_text("{}", encoding="utf-8")
        launcher_projects.register_project(project, source="created", registry_path=self.registry)
        # 同一文件的不同大小写写法归并为同一条。
        launcher_projects.register_project(self.root / "CLIP.mosp", source="editor", registry_path=self.registry)
        result = launcher_projects.all_projects_payload(
            settings_path=self.settings, metadata_path=self.metadata, registry_path=self.registry)
        if launcher_projects.os.name == "nt":
            self.assertEqual(len(result["projects"]), 1)
        else:
            self.assertEqual(len(result["projects"]), 2)

    def test_all_projects_sorts_by_update_time_and_filters_by_query(self) -> None:
        first = self.root / "first.mosp"
        second = self.root / "second.mosp"
        first.write_text("{}", encoding="utf-8")
        second.write_text("{}", encoding="utf-8")
        with mock.patch.object(launcher_projects, "_now_iso", side_effect=["2020-01-01T00:00:00+00:00", "2021-01-01T00:00:00+00:00"]):
            launcher_projects.register_project(first, source="created", registry_path=self.registry)
            launcher_projects.register_project(second, source="created", registry_path=self.registry)

        result = launcher_projects.all_projects_payload(
            settings_path=self.settings, metadata_path=self.metadata, registry_path=self.registry)
        self.assertEqual([item["name"] for item in result["projects"]], ["second.mosp", "first.mosp"])
        self.assertEqual(result["matched"], 2)

        filtered = launcher_projects.all_projects_payload(
            settings_path=self.settings, metadata_path=self.metadata, registry_path=self.registry, query="first")
        self.assertEqual([item["name"] for item in filtered["projects"]], ["first.mosp"])
        self.assertEqual(filtered["total"], 2)  # 计数区分总数与命中数
        self.assertEqual(filtered["matched"], 1)

    def test_seeds_registry_from_recent_view_once(self) -> None:
        project = self.root / "seeded.mosp"
        project.write_text("{}", encoding="utf-8")
        self._set_editor_recent(project)
        result = launcher_projects.all_projects_payload(
            settings_path=self.settings, metadata_path=self.metadata, registry_path=self.registry)
        self.assertEqual([item["name"] for item in result["projects"]], ["seeded.mosp"])
        self.assertEqual(result["projects"][0]["source"], "migration")
        # 已有注册表后不再迁移：编辑器最近新增但未登记的文件不凭空进入全部工程。
        fresh = self.root / "fresh.mosp"
        fresh.write_text("{}", encoding="utf-8")
        self._set_editor_recent(project, fresh)
        again = launcher_projects.all_projects_payload(
            settings_path=self.settings, metadata_path=self.metadata, registry_path=self.registry)
        self.assertEqual([item["name"] for item in again["projects"]], ["seeded.mosp"])

    def _set_editor_recent(self, *paths: Path) -> None:
        _write_json(self.settings, {
            "recent_projects": [{"path": str(path), "name": path.name} for path in paths],
        })

    def test_unregister_removes_entry_only(self) -> None:
        project = self.root / "clip.mosp"
        project.write_text("{}", encoding="utf-8")
        self._set_editor_recent(project)
        launcher_projects.register_project(project, source="created", registry_path=self.registry)

        result = launcher_projects.unregister_project(project, registry_path=self.registry)
        listing = launcher_projects.all_projects_payload(
            settings_path=self.settings, metadata_path=self.metadata, registry_path=self.registry)

        self.assertTrue(result["ok"])
        self.assertEqual(result["removed"], 1)
        self.assertEqual(listing["projects"], [])
        # 只删登记：文件与最近视图仍在。
        self.assertTrue(project.is_file())
        recent = recent_projects_payload(settings_path=self.settings, metadata_path=self.metadata)
        self.assertEqual([item["name"] for item in recent["projects"]], ["clip.mosp"])

    def test_relocate_moves_registry_entry_with_recent(self) -> None:
        old = self.root / "old.mosp"
        new = self.root / "new.mosp"
        old.write_text("{}", encoding="utf-8")
        new.write_text("{}", encoding="utf-8")
        self._set_editor_recent(old)
        launcher_projects.register_project(old, source="created", registry_path=self.registry)

        result = relocate_recent_project(old, new, metadata_path=self.metadata, registry_path=self.registry)
        listing = launcher_projects.all_projects_payload(
            settings_path=self.settings, metadata_path=self.metadata, registry_path=self.registry)

        self.assertTrue(result["ok"])
        self.assertEqual([item["path"] for item in listing["projects"]], [str(new)])
        self.assertEqual(listing["projects"][0]["source"], "created")  # 登记来源不因重定位丢失

    def test_concurrent_registration_keeps_all_entries(self) -> None:
        import threading

        def register(index: int) -> None:
            launcher_projects.register_project(self.root / f"p{index}.mosp", source="created", registry_path=self.registry)

        threads = [threading.Thread(target=register, args=(i,)) for i in range(12)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        listing = launcher_projects.all_projects_payload(
            settings_path=self.settings, metadata_path=self.metadata, registry_path=self.registry)
        self.assertEqual(listing["total"], 12)


class RegistryCleanupTests(unittest.TestCase):
    """T0/§2.3：污染清理三件套——预览只读、执行先备份、恢复可回滚。"""

    def setUp(self) -> None:
        self.temp_dir = TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.registry = self.root / "launcher-project-registry.json"
        # 三类样本：临时目录已缺失（候选）/ 正常存在（保留）/ 非临时目录缺失（保留——用户数据保守不删）。
        real = self.root / "real.mosp"
        real.write_text("{}", encoding="utf-8")
        import tempfile as _tf

        stale_temp = Path(_tf.gettempdir()) / f"msw-t0-stale-{os.getpid()}-{int(time.time() * 1000) % 100000}.mosp"
        # 非临时目录的缺失样本：setUp 临时根在系统 Temp 下，须放到 Temp 之外（用户主目录的不存在路径）。
        missing_elsewhere = Path.home() / f"msw-t0-missing-{os.getpid()}-{int(time.time() * 1000) % 100000}.mosp"
        entries = {}
        for path, source in [(real, "created"), (stale_temp, "created"), (missing_elsewhere, "opened")]:
            key, display = launcher_projects._canonical_identity(path)
            entries[key] = {"path": display, "name": path.name, "source": source, "registeredAt": "2026-01-01T00:00:00+00:00", "updatedAt": "2026-01-01T00:00:00+00:00"}
        launcher_projects._write_registry(entries, self.registry)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_preview_is_readonly_and_targets_temp_missing(self) -> None:
        before = self.registry.read_bytes()
        result = launcher_projects.registry_cleanup_preview(registry_path=self.registry)
        self.assertTrue(result["ok"])
        self.assertEqual(result["candidateCount"], 1)  # 仅临时目录+缺失
        self.assertEqual(result["missing"], 2)  # 两条文件缺失（临时+非临时）
        self.assertEqual(result["keptCount"], 2)
        self.assertEqual(self.registry.read_bytes(), before)  # 预览只读

    def test_apply_backs_up_then_removes_and_restore_rolls_back(self) -> None:
        applied = launcher_projects.apply_registry_cleanup(registry_path=self.registry)
        self.assertTrue(applied["ok"])
        self.assertEqual(applied["removed"], 1)
        self.assertTrue(applied["backup"])
        kept = launcher_projects.all_projects_payload(registry_path=self.registry)
        self.assertEqual(kept["total"], 2)

        restored = launcher_projects.restore_registry_backup(Path(applied["backup"]), registry_path=self.registry)
        self.assertTrue(restored["ok"])
        self.assertEqual(restored["restored"], 3)
        after = launcher_projects.all_projects_payload(registry_path=self.registry)
        self.assertEqual(after["total"], 3)

    def test_restore_rejects_foreign_backup_paths(self) -> None:
        foreign = self.root / "evil.backup-1.json"
        foreign.write_text("{}", encoding="utf-8")
        result = launcher_projects.restore_registry_backup(foreign, registry_path=self.registry)
        self.assertFalse(result["ok"])

    def test_corrupt_registry_gets_timestamped_backup(self) -> None:
        self.registry.write_text("{ not json", encoding="utf-8")
        payload = launcher_projects._read_registry_payload(self.registry)
        self.assertEqual(payload, {})
        backups = list(self.registry.parent.glob(self.registry.name + ".corrupt-*.json"))
        self.assertEqual(len(backups), 1)
        self.assertIn("{ not json", backups[0].read_text(encoding="utf-8"))

    def test_seed_merges_once_by_marker(self) -> None:
        # 独立注册表：先于迁移被创建（无 migrated 标记）→ 种子幂等合并，已有登记优先。
        registry = self.root / "seed-registry.json"
        project = self.root / "handmade.mosp"
        project.write_text("{}", encoding="utf-8")
        launcher_projects.register_project(project, source="created", registry_path=registry)
        raw = json.loads(registry.read_text(encoding="utf-8"))
        raw.pop("migrated", None)
        registry.write_text(json.dumps(raw), encoding="utf-8")

        settings = _write_json(self.root / "settings.json", {"recent_projects": [{"path": str(project), "name": project.name}]})
        meta = self.root / "meta.json"
        listing = launcher_projects.all_projects_payload(settings_path=settings, metadata_path=meta, registry_path=registry)
        self.assertEqual(listing["total"], 1)  # 同工程合并不重复
        seed_again = launcher_projects.all_projects_payload(settings_path=settings, metadata_path=meta, registry_path=registry)
        self.assertEqual(seed_again["total"], 1)  # 标记后不重复迁移
        final_raw = json.loads(registry.read_text(encoding="utf-8"))
        self.assertTrue(final_raw.get("migrated"))


class RealUserDataZeroWriteGuard(unittest.TestCase):
    """T0 验收：测试进程对真实用户应用数据目录零写入（金丝雀）。"""

    def _true_user_app_data_root(self) -> Path:
        # 子进程剥离测试环境覆写后计算真实用户目录（金丝雀对照面）。
        import subprocess
        import sys

        env = {k: v for k, v in os.environ.items() if k not in ("MSW_APP_DATA_ROOT", "MAW_APP_DATA_ROOT")}
        code = "from maw.app_paths import default_app_data_root; print(default_app_data_root())"
        out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, env=env, cwd=str(Path(__file__).resolve().parents[1]), check=True)
        return Path(out.stdout.strip())

    def test_default_registration_stays_in_isolated_root(self) -> None:
        # 顺序无关：现场读取环境覆写并断言默认路径跟随（不比对导入期快照）。
        from maw.app_paths import default_app_data_root

        override = (os.environ.get("MSW_APP_DATA_ROOT") or os.environ.get("MAW_APP_DATA_ROOT") or "").strip()
        self.assertTrue(override, "测试会话缺少 MSW_APP_DATA_ROOT 隔离覆写")
        isolated = default_app_data_root()
        self.assertTrue(str(isolated).startswith(str(Path(override).resolve(strict=False))), "默认路径未跟随隔离覆写")

    def test_real_user_registry_untouched_by_test_session(self) -> None:
        true_root = self._true_user_app_data_root()
        real_registry = true_root / "launcher-project-registry.json"
        snapshot = real_registry.read_bytes() if real_registry.is_file() else None
        import tempfile as _tf

        with _tf.TemporaryDirectory() as raw:
            tmp_project = Path(raw) / "guard.mosp"
            tmp_project.write_text("{}", encoding="utf-8")
            launcher_projects.register_project(tmp_project, source="created")  # 默认路径 → 只能落隔离根
        after = real_registry.read_bytes() if real_registry.is_file() else None
        try:
            self.assertEqual(snapshot, after, "测试写入了真实用户工程索引！")
        finally:
            if snapshot is not None and after != snapshot:
                real_registry.write_bytes(snapshot)  # 回归时自愈，避免金丝雀污染


class DeleteProjectFileTests(unittest.TestCase):
    """S3/§5.3：删除工程文件——仅回收工程文件本身，失败不丢记录。"""

    def setUp(self) -> None:
        self.temp_dir = TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.settings = _write_json(self.root / "server-editor-settings.json", {"recent_projects": []})
        self.metadata = self.root / "launcher-recent.json"
        self.registry = self.root / "launcher-project-registry.json"

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def _register(self, path: Path) -> None:
        path.write_text("{}", encoding="utf-8")
        _write_json(self.settings, {"recent_projects": [{"path": str(path), "name": path.name}]})
        note_project_opened(path, metadata_path=self.metadata)
        launcher_projects.register_project(path, source="created", registry_path=self.registry)

    def _listing_paths(self) -> list[str]:
        result = launcher_projects.all_projects_payload(
            settings_path=self.settings, metadata_path=self.metadata, registry_path=self.registry)
        return [item["path"] for item in result["projects"]]

    def _recent_paths(self) -> list[str]:
        result = recent_projects_payload(settings_path=self.settings, metadata_path=self.metadata)
        return [item["path"] for item in result["projects"]]

    def test_recycles_project_file_and_clears_both_views(self) -> None:
        project = self.root / "clip.mosp"
        media = self.root / "clip.mp4"
        assets = self.root / "clip.assets"
        self._register(project)
        media.write_bytes(b"video")
        assets.mkdir()

        with mock.patch.object(launcher_projects, "_recycle_file", return_value=(True, "")) as recycle:
            result = launcher_projects.delete_project_file(
                project, registry_path=self.registry, metadata_path=self.metadata)

        self.assertTrue(result["ok"])
        recycle.assert_called_once_with(project)
        # 回收目标只有工程文件；媒体与 .assets 原样保留。
        self.assertEqual(recycle.call_args.args[0], project)
        self.assertTrue(media.is_file())
        self.assertTrue(assets.is_dir())
        self.assertNotIn(str(project), self._listing_paths())
        self.assertNotIn(str(project), self._recent_paths())

    def test_recycle_failure_keeps_records(self) -> None:
        project = self.root / "clip.mosp"
        self._register(project)
        with mock.patch.object(launcher_projects, "_recycle_file", return_value=(False, "回收站不可用")):
            result = launcher_projects.delete_project_file(
                project, registry_path=self.registry, metadata_path=self.metadata)
        self.assertFalse(result["ok"])
        self.assertIn("回收站不可用", result["error"])
        self.assertIn(str(project), self._listing_paths())  # 失败：登记保留
        self.assertIn(str(project), self._recent_paths())
        self.assertTrue(project.is_file())  # 绝不退化为永久删除

    def test_missing_file_cleans_stale_records_without_touching_siblings(self) -> None:
        project = self.root / "gone.mosp"
        sibling = self.root / "gone.mp4"
        self._register(project)
        project.unlink()  # 登记后文件丢失
        sibling.write_bytes(b"video")

        result = launcher_projects.delete_project_file(
            project, registry_path=self.registry, metadata_path=self.metadata)

        self.assertTrue(result["ok"])
        self.assertTrue(result["alreadyGone"])
        self.assertNotIn(str(project), self._listing_paths())
        self.assertNotIn(str(project), self._recent_paths())
        self.assertTrue(sibling.is_file())  # 不尝试删除其他同名文件

    def test_rejects_non_project_suffix(self) -> None:
        video = self.root / "clip.mp4"
        video.write_bytes(b"video")
        result = launcher_projects.delete_project_file(
            video, registry_path=self.registry, metadata_path=self.metadata)
        self.assertFalse(result["ok"])
        self.assertIn("仅支持删除工程文件", result["error"])
        self.assertTrue(video.is_file())

    def test_windows_recycle_uses_allow_undo(self) -> None:
        if launcher_projects.os.name != "nt":
            self.skipTest("Windows 回收站路径仅在 Windows 验证")
        import ctypes

        project = self.root / "real.mosp"
        project.write_text("{}", encoding="utf-8")
        captured: dict[str, object] = {}

        class _FakeShell:
            def SHFileOperationW(self, struct_ref) -> int:
                struct = getattr(struct_ref, "_obj", struct_ref)  # 解开 ctypes.byref 包装
                captured["flags"] = struct.fFlags
                captured["func"] = struct.wFunc
                return 0

        with mock.patch.object(ctypes, "windll", create=True) as windll:
            windll.shell32 = _FakeShell()
            ok, error = launcher_projects._recycle_file_windows(project)
        self.assertTrue(ok)
        self.assertEqual(captured["func"], 3)  # FO_DELETE
        self.assertEqual(captured["flags"], 0x40 | 0x10 | 0x4 | 0x400)  # ALLOWUNDO 等标志
        self.assertTrue(project.is_file())  # 假 shell：文件不应真的被移动


if __name__ == "__main__":
    unittest.main()
