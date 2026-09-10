"""Output layout compatibility and derived projects with immutable voice assets."""
import copy
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from threading import Event
from unittest.mock import Mock, patch
import wave

from maw.gui_web import LauncherApi, LauncherPaths, _sync_local_runtime_root, _batch_unique_output_path
from maw.gui_workflow import default_srt_path, build_output_paths, unique_output_path
from maw.media import _media_stem, convert_media_for_browser, resolve_project_media
from maw.msw.assets import AssetStore
from maw.msw.tts import DEFAULT_RECIPE
from maw.output_naming import maw_root, postprocess_workspace
from maw.postprocess_io import read_project, write_derived_project
from maw.postprocess_pipeline import default_postprocess_plan, run_postprocess_pipeline
from maw.runtimes import LOCAL, MOSS, OCR
from maw.waveform import WAVEFORM_ENCODING, load_waveform_sidecar, media_signature, save_waveform_sidecar


def wav_bytes():
    data = io.BytesIO()
    with wave.open(data, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(24000)
        output.writeframes(b"\0\0" * 2400)
    return data.getvalue()


class MswOutputLayoutTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name).resolve()
        self.env_path = self.root / "isolated.env"
        self.environment = patch.dict(os.environ, {"MAW_ENV_FILE": str(self.env_path), "MSW_APP_DATA_ROOT": str(self.root / "app-data")}, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.media = self.root / "视频.wav"
        self.media.write_bytes(wav_bytes())

    def test_all_eight_output_preferences_and_explicit_output(self):
        for organized in (False, True):
            for per_video in (False, True):
                for tagged in (False, True):
                    with self.subTest(organized=organized, per_video=per_video, tagged=tagged):
                        self.env_path.write_text(f"MSW_GUI_OUTPUT_SUBFOLDER={organized}\nMSW_GUI_PER_VIDEO_SUBFOLDER={per_video}\nMSW_GUI_ATTACH_MODEL_NAME={tagged}\n", encoding="utf-8")
                        root = self.root / ("视频_msw" if organized and per_video else "_msw")
                        srt = default_srt_path(self.media)
                        self.assertEqual(srt.parent, root if organized else self.root)
                        self.assertEqual(srt.name, "视频.qwen-audio.srt" if tagged else "视频.srt")
                        explicit = self.root / "user-selected" / "chosen.srt"
                        paths = build_output_paths(explicit, self.media)
                        self.assertEqual(paths.srt, explicit)
                        self.assertEqual(paths.json, explicit.with_suffix(".mosp"))
                        self.assertEqual(paths.html, root / "chosen.edit.html")

    def test_html_collision_and_batch_reserved_paths_do_not_overwrite(self):
        output = self.root / "clip.srt"
        html_root = maw_root(self.media)
        html_root.mkdir()
        (html_root / "clip.edit.html").write_text("keep", encoding="utf-8")
        (html_root / "clip-1.edit.html").write_text("keep-1", encoding="utf-8")
        selected = unique_output_path(output, self.media)
        self.assertEqual(selected.name, "clip-2.srt")
        selected = _batch_unique_output_path(output, {self.root / "clip-2.srt"}, self.media)
        self.assertEqual(selected.name, "clip-3.srt")
        self.assertEqual((html_root / "clip-1.edit.html").read_text(), "keep-1")

    def test_conversion_reuses_all_old_layouts_without_creating_or_moving(self):
        source = self.root / "视频.flv"
        source.write_bytes(b"source")
        for dirname in ("_msw", "视频_msw", "_maw", "视频_maw", "legacy"):
            with self.subTest(dirname=dirname):
                directory = self.root / dirname
                directory.mkdir()
                nested_source = directory / "clip.flv"
                nested_source.write_bytes(b"source")
                cache_dir = directory if dirname == "legacy" else directory / dirname.replace("视频", "clip")
                cache_dir.mkdir(exist_ok=True)
                cache = cache_dir / "clip.mp4"
                cache.write_bytes(b"existing valid cache")
                with patch("maw.media.find_ffmpeg", side_effect=AssertionError("must reuse")):
                    self.assertEqual(convert_media_for_browser(nested_source), cache)
                self.assertEqual(cache.read_bytes(), b"existing valid cache")
                if dirname != "_msw":
                    self.assertFalse((directory / "_msw").exists())

    def test_waveform_reads_legacy_and_writes_new_root(self):
        payload = {"schema": "moy.asr.waveform.v1", "source": media_signature(self.media),
                   "encoding": WAVEFORM_ENCODING, "data": "AAA=", "peaks_per_second": 1, "duration_ms": 1000, "peak_count": 1}
        for directory in (self.root / "_maw", self.root / "视频_maw", self.root):
            directory.mkdir(exist_ok=True)
            legacy = directory / "视频.waveform.json"
            legacy.write_text(json.dumps(payload), encoding="utf-8")
            self.assertEqual(load_waveform_sidecar(self.media), payload)
        new_path = save_waveform_sidecar(payload, self.media)
        self.assertEqual(new_path, self.root / "_msw" / "视频.waveform.json")
        self.assertTrue((self.root / "_maw" / "视频.waveform.json").exists())
        stale = copy.deepcopy(payload)
        stale["source"]["size"] = -1
        new_path.write_text(json.dumps(stale), encoding="utf-8")
        self.assertEqual(load_waveform_sidecar(self.media), payload)

    def test_media_lookup_recognizes_legacy_and_localized_collision_suffixes(self):
        for suffix in ("后处理", "翻译为中文", "translate-en", "translate-zh-bilingual", "去空隙", "subtitled"):
            for collision in ("", "-2"):
                with self.subTest(suffix=suffix, collision=collision):
                    self.assertEqual(_media_stem(f"clip.{suffix}{collision}.mosp"), "clip")

    def test_derived_pipeline_collects_voice_assets_and_keeps_relative_media_valid(self):
        source = self.root / "original.mosp"
        store = AssetStore(self.root / "staged")
        cue = {"key": "cue", "id": "cue", "track_id": None, "text": "wrong", "start": 0, "end": 1000}
        asset = store.add("voice-project", "job", cue, DEFAULT_RECIPE, wav_bytes())
        project = {"media": self.media.name, "segments": [{"id": "cue", "start": 0, "end": 1000, "text": "wrong"}],
                   "msw": {"schema": "msw.editor.v1", "project_id": "voice-project", "assets": [asset]}}
        project["msw"].update(audio_tracks=[{"id": "voice", "name": "配音", "gain_db": -2, "muted": False}],
                              audio_clips=[{"id": "clip", "asset_id": asset["id"], "track_id": "voice", "start_ms": 200,
                                            "source_in_sample": 0, "source_out_sample": 2400, "playback_rate": 1,
                                            "gain_db": -1, "muted": False, "label": "合成音频"}])
        store.persist_project(project, source)
        source.write_text(json.dumps(project), encoding="utf-8")
        original = source.read_bytes()
        srt = self.root / "original.srt"
        srt.write_text("1\n00:00:00,000 --> 00:00:01,000\nwrong\n", encoding="utf-8")
        plan = default_postprocess_plan()
        plan.update(enabled=True, retainIntermediate=True, steps=[{"id": "replace", "enabled": True, "replacements": [{"source": "wrong", "target": "right"}], "conversion": "off"}])
        result = run_postprocess_pipeline(plan=plan, project_path=source, srt_path=srt, media_path=self.media, env_path=self.env_path, ffmpeg_path=None, cancel_event=Event())
        self.assertEqual(result.project_path.name, "original.后处理.mosp")
        self.assertEqual(result.run_directory.parent, postprocess_workspace(self.media))
        fresh = AssetStore(self.root / "clean-machine")
        artifacts = list(result.run_directory.rglob("*.mosp")) + [result.project_path]
        self.assertGreaterEqual(len(artifacts), 2)
        for artifact in artifacts:
            data = read_project(artifact)
            self.assertEqual(data["msw"]["project_id"], "voice-project")
            self.assertEqual(data["msw"]["assets"], project["msw"]["assets"])
            self.assertEqual(data["msw"]["audio_tracks"], project["msw"]["audio_tracks"])
            self.assertEqual(data["msw"]["audio_clips"], project["msw"]["audio_clips"])
            self.assertEqual(resolve_project_media(artifact, data).resolved_path, self.media)
            self.assertEqual(fresh.resolve("voice-project", asset, artifact).read_bytes(), wav_bytes())
        self.assertEqual(source.read_bytes(), original)
        for legacy_name in ("MSW-Postprocess", "MAW-Postprocess"):
            legacy = self.root / legacy_name / "old-run"
            legacy.mkdir(parents=True)
            intermediate = legacy / "step.mosp"
            write_derived_project(read_project(result.project_path), intermediate, result.project_path)
            intermediate_srt = legacy / "step.srt"
            intermediate_srt.write_bytes(result.srt_path.read_bytes())
            (legacy / "manifest.json").write_bytes((result.run_directory / "manifest.json").read_bytes())
            resumed = run_postprocess_pipeline(plan=plan, project_path=source, srt_path=srt, media_path=self.media,
                                              env_path=self.env_path, ffmpeg_path=None, cancel_event=Event(),
                                              resume_directory=legacy, resume_from=1,
                                              resume_project_path=intermediate, resume_srt_path=intermediate_srt)
            self.assertEqual(resumed.run_directory, legacy)
            self.assertTrue(intermediate.exists())
            data = read_project(resumed.project_path)
            self.assertEqual(resolve_project_media(resumed.project_path, data).resolved_path, self.media)
            self.assertEqual(fresh.resolve("voice-project", asset, resumed.project_path).read_bytes(), wav_bytes())

        # A retry can publish directly from the last completed step. Missing
        # assets must still reach the caller when no step runs again.
        missing_run = self.root / "missing-run"
        missing_run.mkdir()
        intermediate = missing_run / "step.mosp"
        intermediate.write_text(json.dumps(read_project(result.project_path)), encoding="utf-8")
        intermediate_srt = missing_run / "step.srt"
        intermediate_srt.write_bytes(result.srt_path.read_bytes())
        (missing_run / "manifest.json").write_bytes((result.run_directory / "manifest.json").read_bytes())
        isolated_output = self.root / "isolated-output"
        resumed = run_postprocess_pipeline(plan=plan, project_path=isolated_output / "original.mosp",
                                          srt_path=isolated_output / "original.srt", media_path=self.media,
                                          env_path=self.env_path, ffmpeg_path=None, cancel_event=Event(),
                                          resume_directory=missing_run, resume_from=1,
                                          resume_project_path=intermediate, resume_srt_path=intermediate_srt)
        self.assertTrue(any("音频素材缺失" in warning for warning in resumed.warnings))
        self.assertEqual(read_project(resumed.project_path)["msw"]["assets"], project["msw"]["assets"])

    def api(self):
        return LauncherApi(paths=LauncherPaths(root=self.root, env_path=self.env_path, launcher_html=self.root / "launcher.html"))

    def test_runtime_save_restart_aliases_and_independent_moss_ocr_roots(self):
        api = self.api()
        original_moss, original_ocr = MOSS.resolve_root(), OCR.resolve_root()
        target = self.root / "custom-runtime"
        with patch("maw.gui_web.managed_runtime_status") as status:
            status.return_value.path = str(target)
            status.return_value.to_payload.return_value = {"path": str(target), "status": "missing"}
            self.assertTrue(api.save_local_settings({"runtimePath": str(target)})["ok"])
        self.assertIn("MSW_LOCAL_RUNTIME_ROOT=", self.env_path.read_text())
        os.environ.pop("MSW_LOCAL_RUNTIME_ROOT")
        os.environ.pop("MAW_LOCAL_RUNTIME_ROOT")
        _sync_local_runtime_root(self.env_path)
        self.assertEqual(LOCAL.resolve_root(), target)
        self.assertEqual(MOSS.resolve_root(), original_moss)
        self.assertEqual(OCR.resolve_root(), original_ocr)
        self.assertFalse(target.exists())

    def test_runtime_switch_is_rejected_during_each_active_operation_without_saving(self):
        api = self.api()
        for field in ("worker", "batch_worker", "local_runtime_worker", "local_prepare_worker"):
            with self.subTest(field=field):
                active = Mock()
                active.is_alive.return_value = True
                setattr(api, field, active)
                self.assertEqual(api.save_local_settings({"runtimePath": str(self.root / "other")})["code"], "local_runtime_busy")
                self.assertFalse(self.env_path.exists())
                setattr(api, field, None)

    def test_runtime_process_alias_precedence_including_explicit_clear(self):
        self.env_path.write_text("MSW_LOCAL_RUNTIME_ROOT=file-value\n", encoding="utf-8")
        os.environ["MSW_LOCAL_RUNTIME_ROOT"] = ""
        os.environ["MAW_LOCAL_RUNTIME_ROOT"] = str(self.root / "old")
        _sync_local_runtime_root(self.env_path)
        self.assertEqual(LOCAL.resolve_root(), self.root / "app-data" / "local-runtime")
