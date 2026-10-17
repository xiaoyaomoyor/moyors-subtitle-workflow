"""Mixed queue contracts, using isolated files and no real ASR/LLM service."""
import copy
import errno
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Event
from types import SimpleNamespace
from unittest.mock import Mock, patch

from maw import launcher_queue as queue
from maw.gui_web import LauncherApi, LauncherPaths
from maw.file_io import atomic_write_text


class QueueTests(unittest.TestCase):
    def test_save_error_reaches_failed_queue_card(self):
        tasks, errors = self.prepare(self.plan([self.srt]))
        self.assertFalse(errors)
        target = self.root / "output.mosp"
        events = []

        def execute(task, emit):
            with patch("maw.file_io.tempfile.mkstemp", side_effect=OSError(errno.ENOSPC, "disk full")):
                atomic_write_text(target, "{}")

        results = queue.run_queue(tasks, run_id="save-error", cancel=Event(), emit=events.append, execute=execute)
        self.assertEqual(results[0]["status"], "failed")
        self.assertIn("磁盘可用空间不足", results[0]["message"])
        self.assertIn(str(target), results[0]["message"])
        card = next(event for event in events if event["type"] == "queueItem" and event["status"] == "failed")
        self.assertEqual(card["message"], results[0]["message"])

    def test_layered_project_migrates_without_loss_and_processes_selected_track(self):
        from maw.msw.subtitle_layers import migrate_project
        project = migrate_project({'segments': [
            {'id':'a','start':0,'end':2000,'text':'A'},
            {'id':'b','start':500,'end':1500,'text':'B'}]})
        self.project.write_text(json.dumps(project), encoding='utf-8')
        tasks, errors = self.prepare(self.plan([self.project]))
        self.assertFalse(errors)
        result = self.execute(tasks[0])
        saved = queue.read_project(Path(result['projectPath']))
        self.assertEqual(saved['schema'], 'msw.project.v4')
        self.assertEqual([(c['content']['text'],c['content']['start'],c['content']['end']) for c in saved['subtitles']['cues']], [('A',0,2000),('B',500,1500)])
        plan = self.plan([self.project], postprocess=['replace'])
        plan['postprocess'] = {'enabled':True,'steps':[{'id':'replace','enabled':True,'replacements':[{'source':'A','target':'X'}],'conversion':'off'}]}
        tasks, errors = self.prepare(plan)
        self.assertFalse(errors)
        changed = queue.read_project(Path(self.execute(tasks[0])['projectPath']))
        self.assertEqual([c['content']['text'] for c in changed['subtitles']['cues']], ['B', 'X'])
        self.assertEqual(json.loads(self.project.read_text(encoding='utf-8')), project)

    def test_layered_project_re_asr_prepares_native_target(self):
        from maw.msw.subtitle_layers import migrate_project
        project = migrate_project({'media':str(self.media),'segments':[{'id':'a','start':0,'end':1000,'text':'A'}]})
        self.project.write_text(json.dumps(project), encoding='utf-8')
        plan=self.plan([self.project], asr=True)
        plan['asrPolicy']='replace'
        tasks, errors=self.prepare(plan)
        self.assertFalse(errors)
        self.assertEqual(tasks[0].project['schema'], 'msw.project.v4')
        self.builder.assert_called_once()

    def test_overlay_only_project_is_already_subtitled(self):
        self.project.write_text(json.dumps({'segments': [], 'overlay_track': {'enabled': True, 'segments': [
            {'id': 'overlay', 'start': 0, 'end': 1000, 'text': 'annotation'}]}}), encoding='utf-8')
        info = queue.inspect_input(str(self.project))
        self.assertTrue(info['hasSubtitles'])
        self.assertEqual(info['subtitleCount'], 1)
        plan = self.plan([self.project], asr=True)
        tasks, errors = self.prepare(plan)
        self.assertFalse(errors)
        self.assertEqual(len(tasks), 1)
        self.builder.assert_not_called()

    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.env = self.root / "test.env"
        self.env.write_text("", encoding="utf-8")
        self.tools = SimpleNamespace(ffmpeg=None, ffprobe=None)
        self.media = self.root / "lesson.mp4"
        self.media.write_bytes(b"isolated mock media")
        self.srt = self.root / "lesson.srt"
        self.srt.write_text("1\n00:00:00,000 --> 00:00:01,000\n原文\n", encoding="utf-8")
        self.project = self.root / "existing.mosp"
        self.project.write_text(json.dumps({"segments": [{"id": "keep", "start": 0, "end": 1000, "text": "原文", "color": {"value": "#ab12cd", "name": "紫"}}], "custom_future": {"keep": True}}), encoding="utf-8")
        self.probe = patch.object(queue, "probe_audio_tracks", return_value=[{"audio_index": 0, "default": False}, {"audio_index": 1, "default": True}])
        self.probe.start()
        self.addCleanup(self.probe.stop)
        self.builder = Mock(return_value=SimpleNamespace())

    def plan(self, paths=None, **modules):
        return {"version": 2, "tasks": [{"id": str(i), "path": str(p)} for i, p in enumerate(paths or [self.srt])], "modules": {"waveform": False, "asr": False, "postprocess": [], **modules}, "output": {}, "recognition": {}}

    def prepare(self, plan):
        return queue.prepare_queue(plan, env_path=self.env, tools=self.tools, request_builder=self.builder)

    def execute(self, task, cancel=None):
        return queue.run_task(task, env_path=self.env, tools=self.tools, cancel=cancel or Event(), emit=lambda e: None)

    def test_mixed_queue_preserves_order_and_accepts_stepless_subtitles(self):
        tasks, errors = self.prepare(self.plan([self.media, self.srt, self.project]))
        self.assertEqual(errors, [])
        self.assertEqual([t.source for t in tasks], [self.media, self.srt, self.project])
        self.builder.assert_not_called()
        result = self.execute(tasks[1])
        self.assertNotEqual(result["srtPath"], str(self.srt))
        self.assertTrue(Path(result["projectPath"]).is_file())

    def test_pending_association_blocks_entire_queue(self):
        plan = self.plan([self.media, self.srt])
        plan["pendingAssociations"] = 1
        tasks, errors = self.prepare(plan)
        self.assertFalse(tasks)
        self.assertIn("关联", errors[0]["message"])

    def test_duplicate_sources_are_rejected_even_with_different_task_ids(self):
        _, errors = self.prepare(self.plan([self.srt, self.srt]))
        self.assertIn("重复", errors[0]["message"])

    def test_final_portable_html_uses_the_processed_project(self):
        plan = self.plan(postprocess=["replace"])
        plan["tasks"][0]["mediaPath"] = str(self.media)
        plan["output"] = {"generateHtml": True}
        plan["postprocess"] = {"enabled": True, "steps": [{"id": "replace", "enabled": True, "replacements": [{"source": "原文", "target": "校正"}], "conversion": "off"}]}
        tasks, errors = self.prepare(plan)
        self.assertFalse(errors)
        def render(project, media, output, language):
            self.assertEqual(queue.read_project(project)["subtitles"]["cues"][0]["content"]["text"], "校正")
            return output
        with patch.object(queue, "render_editor_html", side_effect=render) as renderer:
            result = self.execute(tasks[0])
        renderer.assert_called_once()
        self.assertTrue(result["htmlPath"].endswith(".edit.html"))

    def test_confirmed_pair_uses_subtitles_and_skips_asr(self):
        plan = self.plan([self.media], asr=True)
        plan["tasks"][0]["subtitlePath"] = str(self.srt)
        tasks, errors = self.prepare(plan)
        self.assertEqual(errors, [])
        self.assertEqual(tasks[0].project["subtitles"]["cues"][0]["content"]["text"], "原文")
        self.builder.assert_not_called()
        self.assertEqual(tasks[0].track, 1)

    def test_explicit_re_asr_uses_selected_track(self):
        plan = self.plan([self.media], asr=True)
        plan["tasks"][0].update(subtitlePath=str(self.srt), audioTrack=0)
        plan["asrPolicy"] = "replace"
        tasks, errors = self.prepare(plan)
        self.assertEqual(errors, [])
        self.assertIsNotNone(tasks[0].request)
        self.assertEqual(self.builder.call_args.args[0]["audioTrack"], 0)

    def test_no_audio_prevents_asr_but_allows_plain_video_project(self):
        with patch.object(queue, "probe_audio_tracks", return_value=[]):
            tasks, errors = self.prepare(self.plan([self.media], asr=True))
            self.assertEqual(errors[0]["module"], "asr")
            tasks, errors = self.prepare(self.plan([self.media], waveform=True))
            self.assertFalse(errors)
            self.assertFalse(tasks[0].waveform)
            self.assertTrue(tasks[0].warnings)

    def test_invalid_json_is_not_normalized_into_empty_project(self):
        self.project.write_text('{"someSettings": true}', encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "segments"):
            queue.inspect_input(str(self.project))

    def test_ass_import_and_warning(self):
        ass = self.root / "caption.ass"
        ass.write_text("[Events]\nFormat: Layer, Start, End, Style, Text\nDialogue: 0,0:00:01.00,0:00:02.50,Default,{\\b1}文本\\N第二行\n", encoding="utf-8")
        info = queue.inspect_input(str(ass))
        self.assertTrue(info["warnings"])
        self.assertEqual(queue.read_input(ass)["subtitles"]["cues"][0]["content"]["text"], "文本\n第二行")

    def test_multitrack_srt_pair_publish_and_alignment_share_identities(self):
        from maw.msw.flat_subtitles import validate
        from maw.timestamp_alignment import _load_input, alignment_collections
        self.srt.write_text('1\n00:00:00,000 --> 00:00:03,000\nA\n\n'
                            '2\n00:00:00,500 --> 00:00:02,000\nB\n\n'
                            '3\n00:00:01,000 --> 00:00:02,500\nC\n\n'
                            '4\n00:00:02,000 --> 00:00:03,000\nD\n', encoding='utf-8')
        original = self.srt.read_bytes()
        imported = queue.read_input(self.srt)
        self.assertTrue(validate(imported))
        self.assertNotIn('segments', imported)
        self.assertEqual([t['name'] for t in imported['subtitles']['tracks']], ['S1', 'S2', 'S3'])
        self.assertEqual([c['track_id'] for c in imported['subtitles']['cues']], ['import-s1', 'import-s2', 'import-s3', 'import-s2'])
        inspected = queue.inspect_input(str(self.srt))
        self.assertEqual(inspected['subtitleCount'], 4)
        self.assertEqual(len(inspected['subtitleTracks']), 3)
        aligned, _, _ = _load_input(None, self.srt, native=True)
        self.assertEqual(aligned, imported)
        self.assertTrue(alignment_collections(aligned, 'import-s3'))
        plan = self.plan([self.media])
        plan['tasks'][0]['subtitlePath'] = str(self.srt)
        tasks, errors = self.prepare(plan)
        self.assertFalse(errors, errors)
        self.assertEqual(tasks[0].project['subtitles'], imported['subtitles'])
        result = self.execute(tasks[0])
        saved = queue.read_project(Path(result['projectPath']))
        self.assertEqual(saved['subtitles'], imported['subtitles'])
        self.assertEqual(saved['media'], str(self.media))
        self.assertEqual(self.srt.read_bytes(), original)
        self.assertEqual(len(queue.read_input(Path(result['srtPath']))['subtitles']['cues']), 4)

    def test_native_import_sorts_without_mutation_and_strict_stays_strict(self):
        from maw.postprocess_io import project_from_subtitle_segments
        from copy import deepcopy
        rows = [dict(start=1000, end=2000, text='second'), dict(start=0, end=1000, text='first')]
        before = deepcopy(rows)
        result = project_from_subtitle_segments(rows, source=self.srt, native=True)
        self.assertEqual(len(result['subtitles']['tracks']), 1)
        self.assertEqual([c['content']['text'] for c in result['subtitles']['cues']], ['first', 'second'])
        self.assertEqual(rows, before)
        with self.assertRaisesRegex(ValueError, 'overlapping or unordered'):
            project_from_subtitle_segments(rows, source=self.srt, native=True, strict=True)
        rows[1]['end'] = 0
        with self.assertRaisesRegex(ValueError, 'invalid timing'):
            project_from_subtitle_segments(rows, source=self.srt, native=True)
        empty = project_from_subtitle_segments([], source=self.srt, native=True)
        self.assertEqual(len(empty['subtitles']['tracks']), 1)
        self.assertFalse(empty['subtitles']['cues'])

    def test_duplicate_task_ids_rejected(self):
        plan = self.plan([self.srt, self.project])
        plan["tasks"][1]["id"] = "0"
        _, errors = self.prepare(plan)
        self.assertIn("重复", errors[0]["message"])

    def test_batch_manuscript_is_not_silently_skipped_or_shared(self):
        plan = self.plan([self.srt, self.project], postprocess=["match"])
        script = self.root / "script.txt"
        script.write_text("原文", encoding="utf-8")
        plan["postprocess"] = {"enabled": True, "steps": [{"id": "match", "enabled": True, "scriptPath": str(script)}]}
        _, errors = self.prepare(plan)
        self.assertEqual(len(errors), 2)
        for task in plan["tasks"]:
            task["scriptPath"] = str(script)
        tasks, errors = self.prepare(plan)
        self.assertEqual(errors, [])
        self.assertTrue(all(queue.enabled_steps(task.postprocess)[0]["id"] == "match" for task in tasks))

    def test_complex_project_preserved_and_source_untouched(self):
        from tests.test_launcher_r4 import _complex_project
        source = _complex_project(self.root)
        source["media"] = "missing.mp4"
        self.project.write_text(json.dumps(source), encoding="utf-8")
        original = self.project.read_bytes()
        tasks, errors = self.prepare(self.plan([self.project]))
        self.assertEqual(errors, [])
        result = self.execute(tasks[0])
        target = json.loads(Path(result["projectPath"]).read_text(encoding="utf-8"))
        self.assertEqual(self.project.read_bytes(), original)
        for key in ["subtitles", "time_selection", "workspace", "custom_future_extension"]:
            self.assertEqual(target[key], tasks[0].project[key])
        self.assertEqual(target["msw"]["audio_clips"], tasks[0].project["msw"]["audio_clips"])

    def test_sequential_failure_isolation_and_cancel(self):
        tasks, _ = self.prepare(self.plan([self.srt, self.project, self.media]))
        events, calls, cancel = [], [], Event()
        def execute(task, emit):
            calls.append(task.id)
            if task.id == "0":
                raise RuntimeError("test failure")
            cancel.set()
            raise queue.PostprocessCancelled("cancel")
        result = queue.run_queue(tasks, run_id="run1", cancel=cancel, emit=events.append, execute=execute)
        self.assertEqual([r["status"] for r in result], ["failed", "cancelled", "cancelled"])
        self.assertEqual(calls, ["0", "1"])
        self.assertTrue(all(e["runId"] == "run1" for e in events))
        self.assertTrue(events[-1]["cancelled"])

    def test_output_collision_and_plan_freeze(self):
        plan = self.plan([self.srt, self.project])
        plan["output"] = {"projectName": "shared"}
        tasks, errors = self.prepare(plan)
        self.assertFalse(errors)
        self.assertNotEqual(tasks[0].output, tasks[1].output)
        before = copy.deepcopy(tasks[0].project)
        self.srt.write_text("changed input", encoding="utf-8")
        self.assertEqual(tasks[0].project, before)

    def test_real_fixed_processing_uses_existing_subtitles(self):
        plan = self.plan(postprocess=["replace"])
        plan["postprocess"] = {"enabled": True, "steps": [{"id": "replace", "enabled": True, "replacements": [{"source": "原文", "target": "校正"}], "conversion": "off"}]}
        tasks, errors = self.prepare(plan)
        self.assertFalse(errors)
        result = self.execute(tasks[0])
        self.assertIn("校正", Path(result["srtPath"]).read_text(encoding="utf-8-sig"))
        self.assertIn("原文", self.srt.read_text(encoding="utf-8"))

    def test_only_srt_publishes_no_project_with_or_without_postprocessing(self):
        for use_postprocess in (False, True):
            with self.subTest(postprocess=use_postprocess):
                plan = self.plan(postprocess=["replace"] if use_postprocess else [])
                plan["output"] = {"srtOnly": True}
                plan["postprocess"] = {"enabled": True, "steps": [{"id": "replace", "enabled": True, "replacements": [{"source": "原文", "target": "校正"}], "conversion": "off"}]}
                tasks, errors = self.prepare(plan)
                self.assertFalse(errors)
                before = set(self.root.glob("*.mosp"))
                result = self.execute(tasks[0])
                self.assertEqual(result["projectPath"], "")
                self.assertEqual(set(self.root.glob("*.mosp")), before)
                self.assertTrue(Path(result["srtPath"]).exists())

    def test_srt_only_requires_a_subtitle_source(self):
        plan = self.plan([self.media])
        plan["output"] = {"srtOnly": True}
        _, errors = self.prepare(plan)
        self.assertEqual(errors[0]["module"], "output")

    def test_waveform_receives_selected_track_and_preserves_project_data(self):
        plan = self.plan([self.project], waveform=True)
        plan["tasks"][0].update(mediaPath=str(self.media), audioTrack=1)
        plan["generateSpectral"] = True
        tasks, errors = self.prepare(plan)
        self.assertFalse(errors)
        def generate(project, *args, **kwargs):
            self.assertEqual(kwargs["audio_track"], 1)
            self.assertTrue(kwargs["generate_spectral"])
            self.assertEqual(project["custom_future"], {"keep": True})
            return SimpleNamespace(project=project, waveform_error=None)
        with patch.object(queue, "embed_media_caches", side_effect=generate):
            result = self.execute(tasks[0])
        target = json.loads(Path(result["projectPath"]).read_text(encoding="utf-8"))
        self.assertEqual(target["custom_future"], {"keep": True})
        self.assertEqual(target["media_metadata"]["selected_audio_track"], 1)

    def test_subtitle_with_explicit_ocr_video_is_not_rejected_by_kind(self):
        ffmpeg = self.root / "ffmpeg.exe"
        ffmpeg.write_bytes(b"placeholder")
        self.tools.ffmpeg = ffmpeg
        plan = self.plan(postprocess=["ocr"])
        plan["tasks"][0]["ocrVideoPath"] = str(self.media)
        plan["postprocess"] = {"enabled": True, "steps": [{"id": "ocr", "enabled": True, "threshold": .5}]}
        with patch.object(queue, "validate_plan", wraps=queue.validate_plan) as validate:
            tasks, errors = self.prepare(plan)
        self.assertEqual(validate.call_args.args[0]["steps"][0]["videoPath"], str(self.media))
        # A missing OCR runtime is a separate API preflight; input type itself is valid.
        self.assertFalse(errors, errors)
        self.assertTrue(tasks)

    def test_old_operations_cannot_start_while_queue_is_running(self):
        paths = LauncherPaths(root=self.root, env_path=self.env, launcher_html=self.root / "index.html", recent_metadata=self.root / "recent.json", project_registry=self.root / "registry.json")
        api = LauncherApi(paths=paths)
        api.queue_worker = Mock(is_alive=Mock(return_value=True))
        for name in ("start_transcription", "start_batch_transcription", "start_batch_projects", "start_waveform_project", "run_prefab_plan", "run_extract_audio"):
            with self.subTest(method=name):
                self.assertEqual(getattr(api, name)({})["code"], "media_tool_busy")
        self.assertEqual(api.start_prefab_queue({"plan": self.plan()})["code"], "media_tool_busy")

    def test_queue_bridge_uses_isolated_registry_and_run_identity(self):
        paths = LauncherPaths(root=self.root, env_path=self.env, launcher_html=self.root / "index.html", recent_metadata=self.root / "recent.json", project_registry=self.root / "registry.json")
        api = LauncherApi(paths=paths)
        events = []
        api._emit = events.append
        with patch("maw.gui_web._postprocess_ffmpeg_tools", return_value=self.tools):
            result = api.start_prefab_queue({"plan": self.plan()})
            self.assertTrue(result["ok"], result)
            api.queue_worker.join(10)
        self.assertFalse(api.queue_worker.is_alive())
        self.assertEqual(events[-1]["type"], "queueDone")
        self.assertEqual(events[-1]["runId"], result["runId"])
        self.assertEqual(events[-1]["results"][0]["status"], "done")
        self.assertTrue(paths.project_registry.exists())
        self.assertFalse(api.cancel_prefab_queue({"runId": "old"})["cancelled"])


if __name__ == "__main__":
    unittest.main()
