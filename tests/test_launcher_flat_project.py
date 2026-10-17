"""Native v4 launcher input: no mirror arrays, services, or user files."""
import copy
import json
import hashlib
import os
import wave
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Event
from types import SimpleNamespace
from unittest.mock import Mock, patch

from maw import launcher_queue as queue
from maw.launcher_project import project_inventory, subtitle_count
from maw.launcher_projects import project_stats_payload
from maw.msw.flat_subtitles import migrate_project, normalize_groups
from maw.project import normalize_project


def flat_fixture():
    source = {
        'segments': [{'id': 'source', 'start': 0, 'end': 1000, 'text': 'Source', 'items': []}],
        'multi_subtitle': {'enabled': True, 'tracks': [
            {'id': 'translation', 'segments': [{'id': 'translated', 'start': 0, 'end': 1000, 'text': '译文'}]}],
            'bindings': [{'id': 'pair', 'track_id': 'translation', 'main_segment_ids': ['source'],
                          'extension_segment_ids': ['translated']}]},
        'overlay_track': {'enabled': True, 'segments': [{'id': 'note', 'start': 0, 'end': 1000, 'text': 'Note'}]},
        'custom_extension': {'keep': ['untouched']},
    }
    return normalize_project(normalize_groups(migrate_project(source), infer=True))


class LauncherFlatProjectTests(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.path = self.root / 'source.mosp'
        self.project = flat_fixture()
        self.save()
        self.env = self.root / 'empty.env'
        self.env.write_text('', encoding='utf-8')
        self.tools = SimpleNamespace(ffmpeg=None, ffprobe=None)
        self.builder = Mock()

    def save(self):
        self.path.write_text(json.dumps(self.project, ensure_ascii=False), encoding='utf-8-sig')

    def prepare(self, **overrides):
        plan = {'version': 2, 'tasks': [{'id': 'flat', 'path': str(self.path)}], 'modules': {}, **overrides}
        return queue.prepare_queue(plan, env_path=self.env, tools=self.tools, request_builder=self.builder)

    def execute(self, task):
        return queue.run_task(task, env_path=self.env, tools=self.tools, cancel=Event(), emit=lambda e: None)

    def test_inventory_counts_hidden_disabled_locked_and_empty_tracks_without_mutation(self):
        tracks = self.project['subtitles']['tracks']
        tracks[0].update(enabled=False, locked=True, collapsed=True)
        self.project['subtitles']['cues'][1]['hidden'] = True
        self.project['subtitles']['cues'][2]['content']['disabled'] = True
        tracks.append({**tracks[0], 'id': 'empty', 'name': 'S8', 'display_number': 8})
        self.project['subtitles']['next_track_number'] = 9
        before = copy.deepcopy(self.project)
        info = project_inventory(self.project)
        self.assertEqual(info['subtitleCount'], 3)
        self.assertTrue(info['hasSubtitles'])
        self.assertEqual(info['activeSubtitleCount'], 0)
        self.assertEqual(info['editableSubtitleCount'], 0)
        self.assertEqual(len(info['subtitleTracks']), 4)
        self.assertEqual(info['subtitleTracks'][-1]['cueIds'], [])
        self.assertEqual(self.project, before)
        self.save()
        read = queue.inspect_input(str(self.path))
        self.assertEqual(read['subtitleCount'], subtitle_count(self.project))
        self.assertEqual([t['id'] for t in read['subtitleTracks']], [t['id'] for t in tracks])
        tasks, errors = self.prepare(modules={'asr': True})
        self.assertFalse(errors)
        self.assertEqual(len(tasks), 1)
        self.builder.assert_not_called()

    def test_legacy_disabled_secondary_is_not_an_empty_project(self):
        legacy = normalize_project({'segments': [], 'multi_subtitle': {'enabled': False, 'tracks': [
            {'id': 'translated', 'segments': [{'start': 0, 'end': 1000, 'text': 'Keep'}]}]}})
        info = project_inventory(legacy)
        self.assertEqual(info['subtitleCount'], 1)
        self.assertTrue(info['hasSubtitles'])
        self.assertEqual(info['activeSubtitleCount'], 0)

    def test_legacy_overlay_only_export_is_not_skipped(self):
        self.project = normalize_project({'segments': [], 'overlay_track': {'enabled': True, 'segments': [
            {'start': 0, 'end': 1000, 'text': 'Only overlay'}]}})
        self.save()
        tasks, errors = self.prepare()
        self.assertFalse(errors)
        result = self.execute(tasks[0])
        self.assertIn('Only overlay', Path(result['srtPath']).read_text(encoding='utf-8-sig'))

    def test_native_copy_keeps_ids_bindings_styles_and_original_bytes(self):
        before = self.path.read_bytes()
        tasks, errors = self.prepare()
        self.assertFalse(errors)
        self.assertFalse(tasks[0].export_srt)
        result = self.execute(tasks[0])
        saved = queue.read_project(Path(result['projectPath']))
        self.assertEqual(saved, self.project)
        self.assertEqual(self.path.read_bytes(), before)
        self.assertFalse(result['srtPath'])
        self.assertNotIn('segments', saved)
        self.assertEqual(project_stats_payload(Path(result['projectPath']))['subtitleCount'], 3)

    def test_media_relink_and_cache_keep_subtitle_data(self):
        media = self.root / 'replacement.wav'
        media.write_bytes(b'fake media')
        before = self.path.read_bytes()
        with patch.object(queue, 'probe_audio_tracks', return_value=[{'audio_index': 0, 'default': True}]):
            tasks, errors = self.prepare(tasks=[{'id': 'flat', 'path': str(self.path), 'mediaPath': str(media)}],
                                         modules={'waveform': True}, output={'exportSrt': False})
        self.assertFalse(errors)
        def cache(project, *args, **kwargs):
            self.assertEqual(project['subtitles'], self.project['subtitles'])
            project['waveform'] = {'duration_ms': 1000, 'sample_rate': 10, 'levels': [0.1] * 10}
            return SimpleNamespace(project=project, waveform_error=None)
        with patch.object(queue, 'embed_media_caches', side_effect=cache), patch.object(queue, 'enrich_project_media_metadata', side_effect=lambda p, *a, **k: p):
            result = self.execute(tasks[0])
        saved = queue.read_project(Path(result['projectPath']))
        self.assertEqual(saved['subtitles'], self.project['subtitles'])
        self.assertEqual(saved['custom_extension'], self.project['custom_extension'])
        self.assertEqual(saved['media'], str(media))
        self.assertIn('waveform', saved)
        self.assertEqual(self.path.read_bytes(), before)

    def test_invalid_schema_and_cue_owner_rejected(self):
        for mutate in (lambda p: p.update(schema='msw.project.v999'),
                       lambda p: p['subtitles']['cues'][0].update(track_id='missing')):
            project = copy.deepcopy(self.project)
            mutate(project)
            self.path.write_text(json.dumps(project), encoding='utf-8')
            with self.assertRaises(ValueError):
                queue.inspect_input(str(self.path))
            if project['schema'] == 'msw.project.v999':
                self.assertFalse(project_stats_payload(self.path)['ok'])

    def test_preflight_rejects_unsupported_steps_before_services(self):
        for overrides in (
            {'modules': {'asr': True}, 'asrPolicy': 'replace'},
            {'modules': {'postprocess': ['translate']}},
            {'output': {'exportSrt': True}},
            {'output': {'srtOnly': True}},
        ):
            with self.subTest(overrides=overrides), patch.object(queue, 'validate_plan') as validate:
                tasks, errors = self.prepare(**overrides)
                self.assertFalse(tasks)
                self.assertIn('平级轨道工程', errors[0]['message'])
                validate.assert_not_called()
                self.builder.assert_not_called()
        self.assertEqual(list(self.root.glob('*.mosp')), [self.path])

    def test_automatic_output_is_per_task_and_explicit_srt_is_not_silently_skipped(self):
        legacy = self.root / 'legacy.mosp'
        legacy.write_text(json.dumps({'segments': [{'start': 0, 'end': 1000, 'text': 'Legacy'}]}), encoding='utf-8')
        tasks, errors = self.prepare(tasks=[{'id': 'flat', 'path': str(self.path)}, {'id': 'legacy', 'path': str(legacy)}],
                                     output={'exportSrt': True, 'automaticSrt': True})
        self.assertFalse(errors)
        self.assertEqual([t.export_srt for t in tasks], [False, True])
        self.assertTrue(tasks[0].warnings)

    def test_execution_rechecks_capabilities_before_asr_or_waveform(self):
        from dataclasses import replace
        tasks, _ = self.prepare()
        for override in ({'request': object()}, {'export_srt': True},
                         {'postprocess': {'enabled': True, 'steps': [{'id': 'translate', 'enabled': True}]}}):
            with self.subTest(override=override), patch.object(queue, 'run_transcription') as asr, patch.object(queue, 'embed_media_caches') as cache:
                with self.assertRaisesRegex(ValueError, '平级轨道工程'):
                    self.execute(replace(tasks[0], **override))
                asr.assert_not_called()
                cache.assert_not_called()

    def test_direct_postprocess_and_srt_fail_before_outputs(self):
        from maw import postprocess, postprocess_match, postprocess_ocr
        from maw.postprocess_io import render_srt, write_artifacts
        for module in (postprocess, postprocess_match, postprocess_ocr):
            with self.subTest(module=module.__name__), self.assertRaisesRegex(ValueError, '平级轨道工程'):
                module._load_input(self.path, None)
        with self.assertRaisesRegex(ValueError, 'SRT 导出'):
            render_srt(self.project)
        with self.assertRaisesRegex(ValueError, 'SRT 导出'):
            write_artifacts(self.project, source_project_path=self.path, source_srt_path=None,
                            operation='original', write_project=True, write_srt=True, output_directory=self.root / 'blocked')
        self.assertFalse((self.root / 'blocked').exists())

    def test_new_and_resumed_pipeline_are_blocked_before_validation_or_files(self):
        from maw import postprocess_pipeline as pipeline
        resume = self.root / 'resume'
        resume.mkdir()
        (resume / 'manifest.json').write_text(json.dumps({'sourceProjectPath': str(self.path)}), encoding='utf-8')
        for resume_dir in (None, resume):
            with patch.object(pipeline, 'validate_plan') as validate, self.assertRaisesRegex(ValueError, '平级轨道工程'):
                pipeline.run_postprocess_pipeline({}, media_path=self.root / 'missing.wav',
                    project_path=self.path if resume_dir is None else self.root / 'future.mosp',
                    srt_path=self.root / 'future.srt', env_path=self.env, ffmpeg_path=None,
                    cancel_event=Event(), resume_directory=resume_dir)
            validate.assert_not_called()
        self.assertEqual(list(resume.iterdir()), [resume / 'manifest.json'])

    def test_alignment_rejects_flat_missing_and_empty_targets_before_model(self):
        from maw.timestamp_alignment import align_project, TimestampAlignmentError
        for project, target, message in ((self.project, 'main', '平级轨道工程'),
                                         ({'segments': []}, 'main', '没有可对齐'),
                                         ({'segments': []}, 'missing', '不存在'), ({}, 'main', '不存在')):
            with patch('maw.timestamp_alignment.create_alignment_backend') as backend:
                with self.assertRaisesRegex((ValueError, TimestampAlignmentError), message):
                    align_project(project, media_path=self.root / 'missing.wav', model_id='firered-asr2-ctc', target_track=target)
                backend.assert_not_called()

    def test_alignment_bridge_lists_real_tracks_and_blocks_before_runtime_inspection(self):
        from maw.gui_web import LauncherApi, LauncherPaths
        api = LauncherApi(paths=LauncherPaths(root=self.root, env_path=self.env, launcher_html=self.root / 'index.html',
                          recent_metadata=self.root / 'recent.json', project_registry=self.root / 'registry.json'))
        info = api.inspect_alignment_input({'path': str(self.path)})
        self.assertTrue(info['ok'])
        self.assertEqual([t['id'] for t in info['tracks']], [t['id'] for t in self.project['subtitles']['tracks']])
        self.assertFalse(info['alignment']['supported'])
        with patch.object(api, '_local_runtime_status') as runtime:
            result = api.run_timestamp_alignment({'projectPath': str(self.path)})
        runtime.assert_not_called()
        self.assertFalse(result['ok'])
        self.assertIn('平级轨道工程', result['detail'])

    @unittest.skipUnless(os.environ.get('MSW_TEST_FFMPEG'), 'Set MSW_TEST_FFMPEG for real waveform integration')
    def test_real_waveform_and_asset_publication_preserve_native_project(self):
        from tests.test_launcher_r4 import _complex_project
        from maw.msw.flat_subtitles import SubtitleIndex
        media = self.root / 'clip.wav'
        with wave.open(str(media), 'wb') as wav:
            wav.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
            wav.writeframes(b'\x10\x01\xf0\xfe' * 16000)
        legacy = _complex_project(self.root)
        legacy['media'] = media.name
        legacy['overlay_track'] = {'enabled': True, 'segments': [{'id': 'note', 'start': 0, 'end': 1000, 'text': 'Note'}]}
        asset = legacy['msw']['assets'][0]
        asset_path = self.root / asset['path']
        asset_path.parent.mkdir(parents=True)
        asset_path.write_bytes(media.read_bytes())
        asset.update(sha256=hashlib.sha256(asset_path.read_bytes()).hexdigest(), byte_size=asset_path.stat().st_size)
        self.project = normalize_project(normalize_groups(migrate_project(legacy), infer=True))
        self.save()
        before = self.path.read_bytes()
        self.tools = SimpleNamespace(**{name: Path(os.environ['MSW_TEST_FFMPEG']) / f'{name}.exe' for name in ('ffmpeg', 'ffprobe')})
        tasks, errors = self.prepare(modules={'waveform': True}, output={'exportSrt': False, 'directory': str(self.root / 'derived')})
        self.assertFalse(errors, errors)
        result = queue.run_task(tasks[0], env_path=self.env, tools=self.tools, cancel=Event(), emit=lambda e: None, require_waveform=True)
        saved_path = Path(result['projectPath'])
        saved = queue.read_project(saved_path)
        self.assertEqual(saved['subtitles'], self.project['subtitles'])
        for key in ('audio_clips', 'subtitle_assets', 'asset_batches'):
            self.assertEqual(saved['msw'][key], self.project['msw'][key])
        saved_asset = saved['msw']['assets'][0]
        self.assertEqual((saved_path.parent / saved_asset['path']).read_bytes(), media.read_bytes())
        self.assertEqual(saved_asset['source_ref'], asset['source_ref'])
        self.assertIsNotNone(SubtitleIndex(saved).resolve_source(saved_asset['source_ref']))
        self.assertGreater(saved['waveform']['duration_ms'], 0)
        self.assertEqual(saved['media'], str(media))
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(result['warnings'], [tasks[0].warnings[0]])


if __name__ == '__main__':
    unittest.main()
