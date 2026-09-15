"""R4 修正案回归：方案驱动执行（工程/SRT 输入链、批量共用、复杂工程保真）。"""

from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Event
from unittest import mock

from maw.gui_web import LauncherApi, LauncherPaths
from maw.postprocess_pipeline import default_postprocess_plan


def _replace_plan(replacements: list[dict[str, str]] | None = None) -> dict[str, object]:
    plan = default_postprocess_plan()
    plan["enabled"] = True
    plan["steps"] = [{
        "id": "replace",
        "enabled": True,
        "replacements": replacements if replacements is not None else [{"source": "错", "target": "正"}],
        "conversion": "off",
    }]
    return plan


def _complex_project(root: Path) -> dict[str, object]:
    """F12/§7.3 保真夹具：素材/贴片/TTS 配方/多轨绑定/选区/未知扩展，均通过生产校验器。"""
    return {'media': 'clip.mp3', 'segments': [{'id': 'main-001', 'start': 0, 'end': 1000, 'text': '错字', 'items': [{'text': '错', 'start': 0, 'end': 500}, {'text': '字', 'start': 500, 'end': 1000}]}, {'id': 'main-002', 'start': 1100, 'end': 2000, 'text': '保留'}], 'multi_subtitle': {'enabled': True, 'display_mode': 'both', 'tracks': [{'id': 'secondary-en', 'language': 'en', 'segments': [{'id': 'sec-001', 'start': 0, 'end': 1000, 'text': 'wrong'}]}], 'bindings': [{'track_id': 'secondary-en', 'main_segment_ids': ['main-001'], 'extension_segment_ids': ['sec-001']}]}, 'msw': {'schema': 'msw.editor.v1', 'project_id': 'project-fixture-001', 'assets': [{'id': 'audio-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'kind': 'audio', 'path': 'msw-cccccccccccccccccccccccc.assets/audio/audio-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.wav', 'sha256': 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'sample_rate': 44100, 'channels': 1, 'sample_count': 44100, 'byte_size': 88200, 'job_id': 'job-1', 'generation': {'provider': 'msw', 'model': 'tts', 'voice': 'tongtong', 'language_type': 'zh', 'display_text': '错字', 'spoken_text': '错字'}, 'source_ref': {'key': 'src-1', 'id': 'main-001', 'kind': 'subtitle', 'track_id': None, 'text': '错字', 'start': 0, 'end': 1000}}], 'removed_asset_ids': [], 'subtitle_assets': [{'kind': 'subtitle', 'id': 'sa-1', 'batch_id': 'batch-1', 'source_id': 'src-1', 'source_cue_id': 'main-001', 'track_id': None, 'created_at': 1, 'original_start': 0, 'start': 0, 'end': 1000, 'text': '错字', 'color': {'name': '紫', 'value': '#8253d7'}}], 'asset_batches': [{'id': 'batch-1', 'kind': 'tts', 'created_at': 1, 'result_ids': ['res-1'], 'bindings': [{'track_id': 'secondary-en', 'main_segment_ids': ['main-001'], 'extension_segment_ids': ['sec-001'], 'start_offset_ms': 0, 'end_offset_ms': 0}]}], 'audio_tracks': [{'id': 'track-1', 'name': '配音', 'gain_db': 0, 'muted': False}], 'audio_clips': [{'id': 'clip-1', 'asset_id': 'audio-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'track_id': 'track-1', 'start_ms': 0, 'source_in_sample': 0, 'source_out_sample': 44100, 'playback_rate': 1, 'gain_db': 1.5, 'muted': False, 'label': 'TTS 错字'}], 'audio_settings': {'heatmap': False, 'gap_policy': 'protect'}}, 'media_metadata': {'duration': 2.0, 'selected_audio_track': 0}, 'time_selection': {'start': 0, 'end': 1500}, 'workspace': {'active': 'default'}, 'custom_future_extension': {'keep': ['me']}}


class PrefabPlanTests(unittest.TestCase):
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
        self.media = self.root / "clip.mp3"
        self.media.write_bytes(b"audio")
        self.project_path = self.root / "clip.mosp"
        self.srt_path = self.root / "clip.srt"
        self.srt_path.write_text(
            "1\n00:00:00,000 --> 00:00:01,000\n错字\n\n2\n00:00:01,100 --> 00:00:02,000\n保留\n",
            encoding="utf-8",
        )
        self.events: list[dict] = []
        self.api._emit = lambda event: self.events.append(event)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def _plan_payload(self, *, path: str, postprocess: dict[str, object] | None = None) -> dict[str, object]:
        return {
            "plan": {
                "version": 1,
                "inputMode": "project",
                "input": {"path": path, "generateSpectral": False},
                "modules": {"waveform": True, "asr": False, "postprocess": ["replace"], "alignment": False},
                "postprocess": postprocess if postprocess is not None else _replace_plan(),
                "output": {"srtPath": ""},
            },
        }

    def _run(self, payload: dict[str, object]) -> None:
        started = self.api.run_prefab_plan(payload)
        self.assertTrue(started["ok"], started)
        self.api.prefab_worker.join(timeout=10)
        self.assertIsNone(self.api.prefab_worker)

    def _terminal(self) -> dict:
        terminal = [e for e in self.events if e.get("type") == "prefabTask" and e.get("status") in {"completed", "failed", "cancelled"}]
        self.assertTrue(terminal, self.events)
        return terminal[-1]

    # ---------------- 预检（§7.1 矩阵） ----------------

    def test_preflight_rejects_missing_unsupported_and_stepless_inputs(self) -> None:
        missing = self.api.run_prefab_plan(self._plan_payload(path=""))
        self.assertFalse(missing["ok"])
        self.assertEqual(missing["code"], "project_input_required")

        gone = self.api.run_prefab_plan(self._plan_payload(path=str(self.root / "ghost.mosp")))
        self.assertFalse(gone["ok"])
        self.assertEqual(gone["code"], "project_input_missing")

        video = self.root / "clip.mp4"
        video.write_bytes(b"v")
        unsupported = self.api.run_prefab_plan(self._plan_payload(path=str(video)))
        self.assertEqual(unsupported["code"], "project_input_unsupported")

        self.project_path.write_text(json.dumps({"segments": []}), encoding="utf-8")
        no_steps = self.api.run_prefab_plan(self._plan_payload(path=str(self.project_path), postprocess={"enabled": True, "steps": []}))
        self.assertEqual(no_steps["code"], "prefab_no_steps")

    def test_preflight_rejects_ocr_on_srt_input_with_clear_media_requirement(self) -> None:
        plan = default_postprocess_plan()
        plan["enabled"] = True
        plan["steps"] = [{"id": "ocr", "enabled": True, "threshold": 0.5}]
        result = self.api.run_prefab_plan(self._plan_payload(path=str(self.srt_path), postprocess=plan))
        self.assertFalse(result["ok"])
        self.assertEqual(result["code"], "prefab_srt_needs_media")
        self.assertEqual(result["detail"], "ocr")

    def test_preflight_rejects_unreadable_project(self) -> None:
        broken = self.root / "broken.mosp"
        broken.write_text("{not json", encoding="utf-8")
        result = self.api.run_prefab_plan(self._plan_payload(path=str(broken)))
        self.assertFalse(result["ok"])
        self.assertEqual(result["code"], "project_input_unreadable")

    # ---------------- 工程输入：复杂工程保真（F12/§7.3） ----------------

    def test_project_input_preserves_complex_msw_fields(self) -> None:
        source = _complex_project(self.root)
        self.project_path.write_text(json.dumps(source, ensure_ascii=False), encoding="utf-8")
        with mock.patch("maw.gui_web._frozen_ffmpeg_preflight", return_value=None):
            self._run(self._plan_payload(path=str(self.project_path)))

        terminal = self._terminal()
        self.assertEqual(terminal["status"], "completed", terminal)
        output = json.loads(Path(terminal["projectPath"]).read_text(encoding="utf-8"))

        # 主轨按方案被处理，稳定 ID 与时间不变。
        self.assertEqual([segment["text"] for segment in output["segments"]], ["正字", "保留"])
        self.assertEqual([segment["id"] for segment in output["segments"]], ["main-001", "main-002"])
        # 固定替换同步校正字级时间项，且保留 items 结构与时间。
        self.assertEqual(output["segments"][0]["items"][0]["text"], "正")
        self.assertEqual(output["segments"][0]["items"][0]["end"], 500)

        # §7.3 全量保真：素材/贴片/音频轨/多轨绑定/选区/未知扩展原样保留。
        for key in ("assets", "subtitle_assets", "asset_batches", "removed_asset_ids", "audio_tracks",
                    "audio_clips", "audio_settings", "schema", "project_id"):
            self.assertEqual(output["msw"][key], source["msw"][key], key)
        self.assertEqual(output["msw"]["assets"][0]["generation"], source["msw"]["assets"][0]["generation"])
        # multi_subtitle 经生产规范化补全默认字段；轨道与绑定内容保真。
        self.assertEqual(output["multi_subtitle"]["enabled"], True)
        self.assertEqual(output["multi_subtitle"]["tracks"][0]["id"], "secondary-en")
        self.assertEqual(output["multi_subtitle"]["tracks"][0]["segments"][0]["text"], "wrong")
        binding = output["multi_subtitle"]["bindings"][0]
        self.assertEqual(binding["main_segment_ids"], ["main-001"])
        self.assertEqual(binding["extension_segment_ids"], ["sec-001"])
        self.assertEqual(output["media_metadata"], source["media_metadata"])
        self.assertEqual(output["time_selection"], source["time_selection"])
        self.assertEqual(output["workspace"], source["workspace"])
        self.assertEqual(output["custom_future_extension"], source["custom_future_extension"])

    def test_project_input_translate_adds_independent_secondary_track(self) -> None:
        source = _complex_project(self.root)
        self.project_path.write_text(json.dumps(source, ensure_ascii=False), encoding="utf-8")
        plan = default_postprocess_plan()
        plan["enabled"] = True
        plan["steps"] = [{"id": "translate", "enabled": True, "providerId": "deepseek", "target": "en", "customPrompt": ""}]

        def fake_complete(_settings: object, _prompt: str, cues: list[dict[str, object]]) -> dict[str, object]:
            return {"groups": [{"id": str(cue["id"]), "text": f"EN:{cue['text']}"} for cue in cues]}

        llm_settings = {"deepseek": {"apiKey": "key", "baseUrl": "https://example.test", "model": "m", "verified": "1"}}
        with mock.patch("maw.gui_web._frozen_ffmpeg_preflight", return_value=None):
            with mock.patch("maw.gui_web.snapshot_postprocess_llm_settings", return_value=llm_settings):
                with mock.patch("maw.postprocess_pipeline.complete_subtitle_groups", side_effect=fake_complete):
                    self._run(self._plan_payload(path=str(self.project_path), postprocess=plan))

        terminal = self._terminal()
        self.assertEqual(terminal["status"], "completed", terminal)
        self.assertTrue(terminal["translatedSrtPath"])
        output = json.loads(Path(terminal["projectPath"]).read_text(encoding="utf-8"))

        # 主轨保持原样（未被双语覆盖）；既有副轨保留；新增翻译副轨绑定主轨。
        self.assertEqual([segment["text"] for segment in output["segments"]], ["错字", "保留"])
        tracks = output["multi_subtitle"]["tracks"]
        self.assertEqual(tracks[0]["id"], "secondary-en")
        self.assertEqual(tracks[0]["segments"][0]["text"], "wrong")
        self.assertGreaterEqual(len(tracks), 2)
        translated = tracks[-1]
        self.assertEqual([segment["text"] for segment in translated["segments"]][:2], ["EN:错字", "EN:保留"])
        binding_ids = {binding["track_id"] for binding in output["multi_subtitle"]["bindings"]}
        self.assertIn(translated["id"], binding_ids)
        # 素材与贴片在翻译链后仍完整保留。
        self.assertEqual(output["msw"]["audio_clips"], source["msw"]["audio_clips"])
        self.assertEqual(output["msw"]["assets"], source["msw"]["assets"])

    def test_srt_input_runs_subtitle_chain_and_outputs_project(self) -> None:
        with mock.patch("maw.gui_web._frozen_ffmpeg_preflight", return_value=None):
            self._run(self._plan_payload(path=str(self.srt_path)))

        terminal = self._terminal()
        self.assertEqual(terminal["status"], "completed", terminal)
        output = json.loads(Path(terminal["projectPath"]).read_text(encoding="utf-8"))
        self.assertEqual([segment["text"] for segment in output["segments"]], ["正字", "保留"])
        self.assertTrue(Path(terminal["srtPath"]).is_file())

    def test_running_task_is_singular_and_cancel_reports(self) -> None:
        self.project_path.write_text(json.dumps(_complex_project(self.root), ensure_ascii=False), encoding="utf-8")

        with mock.patch("maw.gui_web.run_postprocess_pipeline", side_effect=lambda *args, **kwargs: (_ for _ in ()).throw(Event().set() and None) if False else mock.DEFAULT):
            pass  # 占位：下方用可取消的桩验证并发与取消。

        release = Event()

        def cancellable_pipeline(*_args: object, **_kwargs: object) -> object:
            release.wait(timeout=5)
            from maw.postprocess_pipeline import PostprocessCancelled
            raise PostprocessCancelled("cancelled by test")

        with mock.patch("maw.gui_web._frozen_ffmpeg_preflight", return_value=None):
            with mock.patch("maw.gui_web.run_postprocess_pipeline", side_effect=cancellable_pipeline):
                started = self.api.run_prefab_plan(self._plan_payload(path=str(self.project_path)))
                self.assertTrue(started["ok"])
                duplicate = self.api.run_prefab_plan(self._plan_payload(path=str(self.project_path)))
                self.assertFalse(duplicate["ok"])
                self.assertEqual(duplicate["code"], "prefab_task_running")
                cancelled = self.api.cancel_prefab_plan()
                self.assertTrue(cancelled["cancelled"])
                release.set()
                self.api.prefab_worker.join(timeout=5)

        self.assertEqual(self._terminal()["status"], "cancelled")

    def test_failed_step_keeps_retry_context_and_reports_step(self) -> None:
        from maw.postprocess_pipeline import PostprocessPipelineError

        self.project_path.write_text(json.dumps(_complex_project(self.root), ensure_ascii=False), encoding="utf-8")

        def failing_pipeline(*_args: object, **_kwargs: object) -> object:
            raise PostprocessPipelineError(
                "后处理步骤 replace 失败：测试注入",
                run_directory=self.root / "run",
                failed_index=0,
                current_project=self.project_path,
                current_srt=self.srt_path,
                completed_steps=[],
                failed_step="replace",
            )

        with mock.patch("maw.gui_web._frozen_ffmpeg_preflight", return_value=None):
            with mock.patch("maw.gui_web.run_postprocess_pipeline", side_effect=failing_pipeline):
                self._run(self._plan_payload(path=str(self.project_path)))

        terminal = self._terminal()
        self.assertEqual(terminal["status"], "failed")
        self.assertEqual(terminal["failedStep"], "replace")
        self.assertTrue(terminal["postprocessRunDirectory"].endswith("run"))
        self.assertIsNotNone(self.api.postprocess_retry_context)


class BatchProjectsTests(unittest.TestCase):
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
        self.events: list[dict] = []
        self.api._emit = lambda event: self.events.append(event)
        self.calls: list[dict] = []
        for name in ("a.mp4", "b.mp4"):
            (self.root / name).write_bytes(b"media")

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def _generate_stub(self, payload: dict, media_path: Path, *_args: object, **_kwargs: object) -> dict:
        self.calls.append({
            "media": str(media_path),
            "waveform": payload.get("waveform"),
            "spectral": payload.get("generateSpectral"),
        })
        return {"ok": True, "mediaPath": str(media_path), "projectPath": str(media_path) + ".waveform.mosp", "warnings": []}

    def test_batch_projects_run_frozen_plan_per_item(self) -> None:
        with mock.patch("maw.gui_web._frozen_ffmpeg_preflight", return_value=None):
            with mock.patch.object(self.api, "_generate_media_project_sync", side_effect=self._generate_stub):
                with mock.patch("maw.gui_web.resolve_default_audio_track", return_value=0):
                    started = self.api.start_batch_projects({
                        "items": [
                            {"id": "i1", "mediaPath": str(self.root / "a.mp4")},
                            {"id": "i2", "mediaPath": str(self.root / "b.mp4")},
                        ],
                        "plan": {
                            "version": 1,
                            "inputMode": "media",
                            "input": {"path": "", "generateSpectral": True},
                            "modules": {"waveform": True, "asr": False, "postprocess": [], "alignment": False},
                        },
                    })
                    self.assertTrue(started["ok"])
                    self.assertTrue(started["waveform"])
                    self.api.batch_worker.join(timeout=5)

        self.assertEqual([call["media"] for call in self.calls], [str(self.root / "a.mp4"), str(self.root / "b.mp4")])
        self.assertTrue(all(call["waveform"] is True and call["spectral"] is True for call in self.calls))
        statuses = [(e.get("status"), e.get("id")) for e in self.events if e.get("type") == "batch_item"]
        self.assertEqual([status for status, _id in statuses], ["running", "done", "running", "done"])
        done = [e for e in self.events if e.get("type") == "batch_done"]
        self.assertEqual(done[-1]["status"], "complete")

    def test_batch_projects_waveform_off_and_partial_failure(self) -> None:
        def flaky(payload: dict, media_path: Path, *_args: object, **_kwargs: object) -> dict:
            if media_path.name == "a.mp4":
                return {"ok": False, "field": "mediaPath", "code": "waveform_generation_failed", "detail": "boom"}
            return {"ok": True, "mediaPath": str(media_path), "projectPath": str(media_path) + ".media.mosp", "warnings": []}

        with mock.patch("maw.gui_web._frozen_ffmpeg_preflight", return_value=None):
            with mock.patch.object(self.api, "_generate_media_project_sync", side_effect=flaky):
                with mock.patch("maw.gui_web.resolve_default_audio_track", return_value=0):
                    started = self.api.start_batch_projects({
                        "items": [
                            {"id": "i1", "mediaPath": str(self.root / "a.mp4")},
                            {"id": "i2", "mediaPath": str(self.root / "b.mp4")},
                        ],
                        "plan": {"modules": {"waveform": False}, "input": {}},
                    })
                    self.assertTrue(started["ok"])
                    self.assertFalse(started["waveform"])
                    self.api.batch_worker.join(timeout=5)

        item_events = [e for e in self.events if e.get("type") == "batch_item"]
        self.assertEqual([e.get("status") for e in item_events], ["running", "failed", "running", "done"])
        failed = item_events[1]
        self.assertIn("boom", str(failed.get("detail")))
        # 失败不冒充整批成功：batch_done 之后逐项状态仍可分辨。
        self.assertEqual([e for e in self.events if e.get("type") == "batch_done"][-1]["status"], "complete")

    def test_batch_projects_preflight_rejects_bad_items(self) -> None:
        with mock.patch("maw.gui_web._frozen_ffmpeg_preflight", return_value=None):
            result = self.api.start_batch_projects({"items": [{"id": "x", "mediaPath": str(self.root / "none.mp4")}], "plan": {}})
        self.assertFalse(result["ok"])
        self.assertEqual(result["code"], "media_not_found")


if __name__ == "__main__":
    unittest.main()
