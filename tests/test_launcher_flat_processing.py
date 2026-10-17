import copy
import unittest

from maw.launcher_processing import (
    apply_processed, apply_translation, export_srt, preflight, processing_snapshot,
)
from tests.test_launcher_flat_project import flat_fixture


class TrackProcessingTests(unittest.TestCase):
    def setUp(self):
        self.project = flat_fixture()
        self.source = self.project['subtitles']['cues'][0]
        self.track = self.source['track_id']

    def test_text_processing_preserves_ids_binding_other_tracks_and_metadata(self):
        before = copy.deepcopy(self.project)
        snapshot = processing_snapshot(self.project, self.track)
        snapshot['segments'][0]['text'] = 'Edited'
        result = apply_processed(self.project, self.track, snapshot['segments'])
        changed = next(c for c in result['subtitles']['cues'] if c['id'] == self.source['id'])
        self.assertEqual(changed['content']['text'], 'Edited')
        self.assertEqual(result['subtitles']['bindings'], before['subtitles']['bindings'])
        self.assertEqual([c for c in result['subtitles']['cues'] if c['id'] != self.source['id']],
                         [c for c in before['subtitles']['cues'] if c['id'] != self.source['id']])
        self.assertEqual(self.project, before)

    def test_bound_structure_rejected_before_provider_and_before_apply(self):
        with self.assertRaisesRegex(ValueError, '绑定'):
            preflight(self.project, self.track, [{'id': 'resegment'}])
        rows = processing_snapshot(self.project, self.track)['segments']
        rows[0]['end'] -= 1
        with self.assertRaisesRegex(ValueError, '绑定'):
            apply_processed(self.project, self.track, rows)

    def test_translation_reuses_partner_id_and_offsets(self):
        rows = processing_snapshot(self.project, self.track)['segments']
        rows[0]['text'] = '新译文'
        result, target = apply_translation(self.project, self.track, None, rows)
        self.assertEqual(result['subtitles']['bindings'], self.project['subtitles']['bindings'])
        self.assertIn('新译文', export_srt(result, [target]))
        self.assertEqual(len(result['subtitles']['cues']), len(self.project['subtitles']['cues']))

    def test_new_translation_creates_group_and_stable_binding(self):
        self.project['subtitles']['bindings'] = []
        for t in self.project['subtitles']['tracks']:
            t.pop('secondary_for', None)
        # A separate fresh project avoids the intentionally duplicate old group number.
        from maw.launcher_processing import native_project
        p = native_project({'segments': [{'start': 0, 'end': 1000, 'text': 'Hello'}]})
        source = p['subtitles']['tracks'][0]['id']
        rows = processing_snapshot(p, source)['segments']
        rows[0]['text'] = '你好'
        result, _ = apply_translation(p, source, 'new', rows)
        self.assertEqual([t['name'] for t in result['subtitles']['tracks']], ['S1主', 'S1副'])
        self.assertEqual(result['subtitles']['bindings'][0]['source_id'], p['subtitles']['cues'][0]['id'])

    def test_srt_respects_actual_tracks_and_visibility_but_not_lock(self):
        self.assertIn('Source', export_srt(self.project, [self.track]))
        self.assertNotIn('译文', export_srt(self.project, [self.track]))
        next(t for t in self.project['subtitles']['tracks'] if t['id'] == self.track)['locked'] = True
        self.assertIn('Source', export_srt(self.project, [self.track]))
        with self.assertRaisesRegex(ValueError, '锁定'):
            preflight(self.project, None, [{'id': 'replace'}])
        with self.assertRaisesRegex(ValueError, '锁定'):
            processing_snapshot(self.project, self.track)
        self.source['hidden'] = True
        self.assertEqual(export_srt(self.project, [self.track]), '')
        with self.assertRaisesRegex(ValueError, '不存在'):
            export_srt(self.project, ['missing'])


class NativePipelineTests(unittest.TestCase):
    def test_native_translate_outputs_full_project_and_three_track_scoped_srts(self):
        import json
        from pathlib import Path
        from tempfile import TemporaryDirectory
        from threading import Event
        from unittest.mock import patch
        from maw.postprocess_pipeline import run_postprocess_pipeline
        from maw.postprocess_io import read_project
        from maw.launcher_processing import native_project
        with TemporaryDirectory() as directory:
            root = Path(directory)
            project = native_project({'segments': [{'start': 0, 'end': 1000, 'text': 'Hello world'}], 'custom': {'keep': 1}})
            source_id = project['subtitles']['tracks'][0]['id']
            source = root / 'source.mosp'
            source.write_text(json.dumps(project), encoding='utf-8')
            env = root / 'empty.env'
            env.write_text('', encoding='utf-8')
            plan = {'enabled': True, 'outputSemantics': 'separate-v2', 'exportBilingualSrt': True,
                    'outputDirectory': str(root / 'out'), 'trackScope': {'sourceTrackId': source_id, 'targetTrackId': 'new'},
                    'steps': [{'id': 'translate', 'enabled': True, 'target': 'zh', 'providerId': 'deepseek', 'mergeBilingual': True}]}
            def complete(_settings, _prompt, cues):
                return {'groups': [{'id': c['id'], 'source': c['text'], 'text': '你好世界'} for c in cues]}
            with patch('maw.postprocess_pipeline.complete_subtitle_groups', side_effect=complete):
                result = run_postprocess_pipeline(plan, media_path=root / 'movie.mp4', project_path=source,
                    srt_path=root / 'result.srt', env_path=env, ffmpeg_path=None, cancel_event=Event(),
                    llm_settings={'deepseek': {'apiKey': 'test', 'baseUrl': 'https://example.test', 'model': 'test', 'verified': '1'}})
            # Completed translation resumes with the frozen scope and original SRT.
            manifest = json.loads((result.run_directory / 'manifest.json').read_text(encoding='utf-8'))
            last = manifest['steps'][-1]
            with patch('maw.postprocess_pipeline.complete_subtitle_groups', side_effect=AssertionError('must not rerun')):
                resumed = run_postprocess_pipeline(plan, media_path=root / 'movie.mp4', project_path=source,
                    srt_path=root / 'result.srt', env_path=env, ffmpeg_path=None, cancel_event=Event(),
                    resume_directory=result.run_directory, resume_from=1, resume_project_path=Path(last['projectPath']),
                    resume_srt_path=Path(last['srtPath']),
                    llm_settings={'deepseek': {'apiKey': 'test', 'baseUrl': 'https://example.test', 'model': 'test', 'verified': '1'}})
            self.assertEqual(resumed.srt_path.read_text(encoding='utf-8-sig'), result.srt_path.read_text(encoding='utf-8-sig'))
            self.assertEqual(resumed.translated_srt_path.read_text(encoding='utf-8-sig'), result.translated_srt_path.read_text(encoding='utf-8-sig'))
            with self.assertRaisesRegex(ValueError, '范围'):
                run_postprocess_pipeline({**plan, 'trackScope': {'sourceTrackId': 'different'}}, media_path=root / 'movie.mp4', project_path=source,
                    srt_path=root / 'result.srt', env_path=env, ffmpeg_path=None, cancel_event=Event(), resume_directory=result.run_directory)
            saved = read_project(result.project_path)
            self.assertEqual(saved['schema'], 'msw.project.v4')
            self.assertNotIn('segments', saved)
            self.assertEqual(saved['custom'], project['custom'])
            self.assertEqual([t['name'] for t in saved['subtitles']['tracks']], ['S1主', 'S1副'])
            self.assertEqual(saved['subtitles']['cues'][0]['id'], project['subtitles']['cues'][0]['id'])
            self.assertIn('Hello world', result.srt_path.read_text(encoding='utf-8-sig'))
            self.assertNotIn('你好', result.srt_path.read_text(encoding='utf-8-sig'))
            self.assertIn('你好世界', result.translated_srt_path.read_text(encoding='utf-8-sig'))
            bilingual = result.bilingual_srt_path.read_text(encoding='utf-8-sig')
            self.assertIn('Hello world', bilingual)
            self.assertIn('你好世界\nHello world', bilingual)
            self.assertEqual(read_project(source), project)


    def test_queue_asr_replaces_only_selected_unbound_track_and_publishes_v4(self):
        import json
        from pathlib import Path
        from tempfile import TemporaryDirectory
        from threading import Event
        from types import SimpleNamespace
        from unittest.mock import patch
        from maw import launcher_queue as queue
        from maw.postprocess_io import read_project
        with TemporaryDirectory() as directory:
            root = Path(directory)
            project = flat_fixture()
            note = next(c for c in project['subtitles']['cues'] if c['content']['text'] == 'Note')
            source = root / 'source.mosp'
            source.write_text(json.dumps(project), encoding='utf-8')
            media = root / 'movie.mp4'
            media.write_bytes(b'fixture')
            env = root / 'empty.env'
            env.write_text('', encoding='utf-8')
            tools = SimpleNamespace(ffmpeg=None, ffprobe=None)
            plan = {'version': 2, 'tasks': [{'id': 'one', 'path': str(source), 'mediaPath': str(media), 'sourceTrackId': note['track_id']}],
                    'modules': {'asr': True}, 'asrPolicy': 'replace', 'output': {'directory': str(root / 'out')}}
            with patch('maw.launcher_queue.probe_audio_tracks', return_value=[{'audio_index': 0, 'default': True}]):
                tasks, errors = queue.prepare_queue(plan, env_path=env, tools=tools, request_builder=lambda _: SimpleNamespace())
            self.assertFalse(errors)
            def recognize(request, **kwargs):
                path = request.srt_path.with_suffix('.mosp')
                path.write_text(json.dumps({'model': 'test-asr', 'language': 'en', 'split_mode': 'word', 'segments': [{'start': 0, 'end': 500, 'text': 'Recognized', 'color': {'name': 'blue', 'value': '#abcdef', 'start': 0, 'end': 1000}}, {'start': 500, 'end': 1000, 'text': 'Speaker', 'color_ref': {'name': 'blue', 'headIdx': 0}}]}), encoding='utf-8')
                return SimpleNamespace(json_path=path)
            with patch('maw.launcher_queue.run_transcription', side_effect=recognize), patch('maw.launcher_queue.enrich_project_media_metadata', side_effect=lambda p, *a, **k: p):
                result = queue.run_task(tasks[0], env_path=env, tools=tools, cancel=Event(), emit=lambda _: None)
            saved = read_project(Path(result['projectPath']))
            self.assertEqual(saved['schema'], 'msw.project.v4')
            self.assertNotIn('segments', saved)
            self.assertEqual(saved['subtitles']['bindings'], project['subtitles']['bindings'])
            self.assertEqual([c for c in saved['subtitles']['cues'] if c['track_id'] != note['track_id']],
                             [c for c in project['subtitles']['cues'] if c['track_id'] != note['track_id']])
            self.assertEqual([c['content']['text'] for c in saved['subtitles']['cues'] if c['track_id'] == note['track_id']], ['Recognized', 'Speaker'])
            rows = [c for c in saved['subtitles']['cues'] if c['track_id'] == note['track_id']]
            self.assertEqual([row['content']['color']['name'] for row in rows], ['blue', 'blue'])
            target = next(t for t in saved['subtitles']['tracks'] if t['id'] == note['track_id'])
            self.assertEqual(target['split_mode'], 'word')
            self.assertEqual(read_project(source), project)


class NativeAlignmentTests(unittest.TestCase):
    def test_alignment_changes_only_selected_track_items(self):
        from pathlib import Path
        from tempfile import TemporaryDirectory
        from unittest.mock import Mock, patch
        from maw.timestamp_alignment import align_project, TimedToken
        project = flat_fixture()
        before = copy.deepcopy(project)
        cue = project['subtitles']['cues'][1]
        with TemporaryDirectory() as directory:
            media = Path(directory) / 'audio.wav'
            media.write_bytes(b'fixture')
            backend = Mock()
            backend.align.side_effect = lambda _path, text, **_: [TimedToken(text, 0, 900)]
            with patch('maw.timestamp_alignment.create_alignment_backend', return_value=backend), patch('maw.timestamp_alignment._extract_audio_span') as extract:
                report = align_project(project, media_path=media, model_id='firered-asr2-ctc', target_track=cue['track_id'], audio_index=2)
            self.assertEqual(report.aligned_segments, 1)
            self.assertEqual(extract.call_args.kwargs['audio_index'], 2)
            self.assertEqual(project['subtitles']['bindings'], before['subtitles']['bindings'])
            self.assertEqual([c for c in project['subtitles']['cues'] if c['id'] != cue['id']], [c for c in before['subtitles']['cues'] if c['id'] != cue['id']])
            self.assertTrue(cue['content']['items'])
            self.assertNotIn('timestamp_granularity', project)

    def test_unavailable_alignment_scope_rejected_before_loading_model(self):
        from pathlib import Path
        from unittest.mock import patch
        from maw.timestamp_alignment import align_project
        for state in ('locked', 'disabled', 'hidden', 'missing'):
            project = flat_fixture()
            track = project['subtitles']['tracks'][0]
            if state == 'locked':
                track['locked'] = True
            elif state == 'disabled':
                track['enabled'] = False
            elif state == 'hidden':
                project['subtitles']['cues'][0]['hidden'] = True
            with self.subTest(state=state), patch('maw.timestamp_alignment.create_alignment_backend') as load:
                with self.assertRaises(ValueError):
                    align_project(project, media_path=Path('not-opened.wav'), model_id='firered-asr2-ctc', target_track='missing' if state == 'missing' else track['id'])
                load.assert_not_called()


class NativeStepTests(unittest.TestCase):
    def test_match_proofread_resegment_and_ocr_preserve_other_tracks(self):
        import json
        from pathlib import Path
        from tempfile import TemporaryDirectory
        from threading import Event
        from unittest.mock import patch
        from maw.postprocess_pipeline import _run_step
        from maw.postprocess_io import read_project
        from maw.postprocess_ocr import run_ocr_dedup
        from tests.test_postprocess_ocr import FakeImage
        with TemporaryDirectory() as directory:
            root = Path(directory)
            project = flat_fixture()
            note = next(c for c in project['subtitles']['cues'] if c['content']['text'] == 'Note')
            source = root / 'source.mosp'
            source.write_text(json.dumps(project), encoding='utf-8')
            media = root / 'video.mp4'
            media.write_bytes(b'fixture')
            ffmpeg = root / 'ffmpeg.exe'
            ffmpeg.write_bytes(b'fixture')
            script = root / 'script.txt'
            script.write_text('Note', encoding='utf-8')
            settings = {'deepseek': {'apiKey': 'test', 'baseUrl': 'https://example.test', 'model': 'test', 'verified': '1'}}
            def ocr(request, **kwargs):
                return run_ocr_dedup(request, **kwargs, recognizer=lambda _: [('Note', .99)],
                                    frame_extractor=lambda *a: True, image_loader=lambda _: FakeImage())
            for operation in ('match', 'proofread', 'resegment', 'ocr'):
                def complete(_settings, _prompt, cues):
                    return {'groups': [{'id': c['id'], 'text': text} for c in cues
                                       for text in (['Part one', 'Part two'] if operation == 'resegment' else ['Edited note'])]}
                with self.subTest(operation=operation), patch('maw.postprocess_pipeline.complete_subtitle_groups', side_effect=complete), patch('maw.postprocess_pipeline.run_ocr_dedup', side_effect=ocr):
                    artifact = _run_step({'id': operation, 'scriptPath': str(script), 'matchMode': 'text', 'report': True},
                        project_path=source, srt_path=root / 'source.srt', media_path=media, env_path=root / 'empty.env',
                        ffmpeg_path=ffmpeg, ocr_runtime_root=None, output_directory=root / operation, cancel_event=Event(),
                        on_event=None, llm_settings=settings, track_scope={'sourceTrackId': note['track_id']})
                    saved = read_project(artifact.project_path)
                    self.assertEqual(saved['subtitles']['bindings'], project['subtitles']['bindings'])
                    self.assertEqual([c for c in saved['subtitles']['cues'] if c['track_id'] != note['track_id']],
                                     [c for c in project['subtitles']['cues'] if c['track_id'] != note['track_id']])
                    rows = [c for c in saved['subtitles']['cues'] if c['track_id'] == note['track_id']]
                    if operation == 'resegment':
                        self.assertEqual(len(rows), 2)
                        self.assertEqual(rows[0]['content']['end'], rows[1]['content']['start'])
                    elif operation == 'ocr':
                        self.assertTrue(rows[0]['content']['disabled'])
                        self.assertTrue(artifact.report_path.exists())
                    elif operation == 'proofread':
                        self.assertEqual(rows[0]['content']['text'], 'Edited note')
                    self.assertEqual(read_project(source), project)


class LegacyAlignmentMigrationTests(unittest.TestCase):
    def test_real_track_id_migrates_legacy_input_and_writes_items_to_native_owner(self):
        from pathlib import Path
        from tempfile import TemporaryDirectory
        from unittest.mock import Mock, patch
        from maw.timestamp_alignment import align_project, TimedToken
        from maw.launcher_project import project_inventory
        from maw.project import normalize_project
        project = normalize_project({'segments': [{'start': 0, 'end': 1000, 'text': 'Hello'}]})
        track = project_inventory(project)['subtitleTracks'][0]['id']
        with TemporaryDirectory() as directory:
            media = Path(directory) / 'audio.wav'
            media.write_bytes(b'fixture')
            backend = Mock()
            backend.align.return_value = [TimedToken('Hello', 0, 900)]
            with patch('maw.timestamp_alignment.create_alignment_backend', return_value=backend), patch('maw.timestamp_alignment._extract_audio_span'):
                report = align_project(project, media_path=media, model_id='firered-asr2-ctc', target_track=track)
        self.assertEqual(report.aligned_segments, 1)
        self.assertEqual(project['schema'], 'msw.project.v4')
        self.assertTrue(project['subtitles']['cues'][0]['content']['items'])
        self.assertNotIn('segments', project)
