import copy
import json
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from threading import Event
from unittest.mock import Mock, patch

from maw.postprocess import LlmPostprocessRequest, OutputMode, PostprocessStepError, process_llm_snapshot
from maw.postprocess_llm import LlmClientError
from maw.postprocess_pipeline import PostprocessPipelineError, run_postprocess_pipeline
from maw.launcher_processing import native_project


def project(count=3):
    return {'segments': [{'id': f'source-{i}', 'start': i * 1000, 'end': i * 1000 + 900,
                          'text': f'Helo world {i}', 'speaker': 'sp1'} for i in range(count)]}


def corrected(cues):
    return {'groups': [{'id': c['id'], 'source_text': c['text'], 'text': c['text'].replace('Helo', 'Hello')} for c in cues]}


def request(**kwargs):
    return LlmPostprocessRequest(None, None, OutputMode.JSON, 'proofread', '', **kwargs)


class ProofreadRecoveryTests(unittest.TestCase):
    def test_echo_mismatch_retries_only_bad_cue_and_records_actual_difference(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'proofread-progress.json'
            calls = []
            def complete(prompt, cues):
                calls.append(copy.deepcopy(cues))
                result = corrected(cues)
                if len(calls) == 1:
                    result['groups'][1]['source_text'] = cues[1]['text'].replace(' ', '')
                return result
            original = project()
            result = process_llm_snapshot(original, request(proofread_progress_path=path), complete=complete)
            self.assertEqual([c['id'] for c in calls[1]], ['c0002'])
            self.assertEqual(len(calls), 2)
            self.assertEqual([s['text'] for s in result.project['segments']], ['Hello world 0', 'Hello world 1', 'Hello world 2'])
            self.assertEqual(original, project())
            report = json.loads(path.with_name('proofread-review.json').read_text(encoding='utf-8'))
            self.assertEqual(report['retainedOriginal'], [])
            self.assertIn('首个差异', report['diagnostics'][0]['reason'])

    def test_persistent_bad_echo_keeps_exact_text_metadata_and_warning_on_cache_hit(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'proofread-progress.json'
            original = project(1)
            original['segments'][0].update(text=' Helo world \n', items=[{'start': 0, 'end': 900, 'text': ' Helo world \n'}])
            req = request(proofread_progress_path=path)
            response = {'groups': [{'id': 'c0001', 'source_text': 'Helo world', 'text': 'Hello world'}]}
            complete = Mock(return_value=response)
            result = process_llm_snapshot(original, req, complete=complete)
            self.assertEqual(complete.call_count, 2)
            self.assertEqual(result.project['segments'][0], original['segments'][0])
            self.assertIn('保留原文', ' '.join(result.warnings))
            cached = process_llm_snapshot(original, req, complete=Mock(side_effect=AssertionError('must reuse cache')))
            self.assertEqual(cached.project, result.project)
            self.assertEqual(cached.warnings, result.warnings)
            report = json.loads(path.with_name('proofread-review.json').read_text(encoding='utf-8'))
            self.assertEqual(report['retainedOriginal'][0]['segmentId'], 'source-0')

    def test_structure_errors_have_bounded_requests_and_never_drop_or_reassign(self):
        original = project(40)
        complete = Mock(return_value={'groups': []})
        result = process_llm_snapshot(original, request(), complete=complete)
        self.assertEqual(complete.call_count, 3)
        self.assertEqual([len(call.args[1]) for call in complete.call_args_list], [40, 20, 20])
        self.assertEqual(result.project['segments'], original['segments'])
        self.assertEqual(len(result.skipped_source_ids), 40)

    def test_malformed_json_can_recover_without_relaxing_structure(self):
        calls = []
        def complete(prompt, cues):
            calls.append(cues)
            if len(calls) == 1:
                raise LlmClientError('bad JSON', category='response_format')
            return corrected(cues)
        result = process_llm_snapshot(project(3), request(), complete=complete)
        self.assertEqual(len(calls), 3)
        self.assertTrue(all(s['text'].startswith('Hello') for s in result.project['segments']))

    def test_network_auth_and_rate_failures_stop_without_retries_or_fallback(self):
        for category, status in [('network', None), ('provider_response', 401), ('provider_response', 429)]:
            with self.subTest(category=category, status=status):
                complete = Mock(side_effect=LlmClientError('service failure', category=category, status_code=status))
                with self.assertRaises(PostprocessStepError):
                    process_llm_snapshot(project(), request(), complete=complete)
                complete.assert_called_once()

    def test_checkpoint_reuses_verified_batches_and_invalidates_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'proofread-progress.json'
            req = request(proofread_progress_path=path, translation_provider_fingerprint='model-a')
            def interrupted(prompt, cues):
                if cues[0]['id'] == 'c0041':
                    raise LlmClientError('offline', category='network')
                return corrected(cues)
            with self.assertRaises(PostprocessStepError):
                process_llm_snapshot(project(81), req, complete=interrupted)
            calls = []
            def complete(prompt, cues):
                calls.append(cues[0]['id'])
                return corrected(cues)
            result = process_llm_snapshot(project(81), req, complete=complete)
            self.assertEqual(calls, ['c0041', 'c0081'])
            self.assertEqual(len(result.project['segments']), 81)
            calls.clear()
            process_llm_snapshot(project(81), req, complete=complete)
            self.assertEqual(calls, [])
            for altered in [replace(req, custom_prompt='New instruction'), replace(req, translation_provider_fingerprint='model-b')]:
                process_llm_snapshot(project(81), altered, complete=complete)
                self.assertEqual(calls, ['c0001', 'c0041', 'c0081'])
                calls.clear()
            changed = project(81)
            changed['segments'][0]['id'] = 'new-identity'
            process_llm_snapshot(changed, req, complete=complete)
            self.assertEqual(len(calls), 3)
            path.write_text('{broken', encoding='utf-8')
            calls.clear()
            process_llm_snapshot(project(81), req, complete=complete)
            self.assertEqual(len(calls), 3)

    def test_native_resume_uses_durable_cache_after_temporary_track_directory_is_gone(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'input.mosp'
            original = native_project(project(41))
            source.write_text(json.dumps(original), encoding='utf-8')
            env = root / 'empty.env'
            env.write_text('', encoding='utf-8')
            plan = {'enabled': True, 'retainIntermediate': True, 'steps': [{'id': 'proofread', 'enabled': True}]}
            settings = {'proofread': {'model': 'test', 'apiKey': 'test-only-secret', 'baseUrl': 'https://example.test', 'verified': '1'}}
            args = dict(media_path=root / 'media.mp4', project_path=source, srt_path=root / 'input.srt', env_path=env,
                        ffmpeg_path=None, cancel_event=Event(), llm_settings=settings)
            def interrupted(_settings, prompt, cues, **_kwargs):
                if cues[0]['id'] == 'c0041':
                    raise LlmClientError('offline', category='network')
                return corrected(cues)
            with patch('maw.postprocess_pipeline.complete_subtitle_groups', side_effect=interrupted):
                with self.assertRaises(PostprocessPipelineError) as caught:
                    run_postprocess_pipeline(plan, **args)
            error = caught.exception
            cache = error.run_directory / 'proofread-progress.json'
            self.assertTrue(cache.is_file())
            self.assertNotIn('test-only-secret', cache.read_text(encoding='utf-8'))
            calls = []
            def complete(_settings, prompt, cues, **_kwargs):
                calls.append(cues[0]['id'])
                return corrected(cues)
            with patch('maw.postprocess_pipeline.complete_subtitle_groups', side_effect=complete):
                result = run_postprocess_pipeline(plan, **args, resume_directory=error.run_directory, resume_from=0,
                    resume_project_path=error.current_project, resume_srt_path=error.current_srt)
            self.assertEqual(calls, ['c0041'])
            saved = json.loads(result.project_path.read_text(encoding='utf-8'))
            self.assertEqual(len(saved['subtitles']['cues']), 41)
            self.assertEqual(json.loads(source.read_text(encoding='utf-8')), original)

    def test_fallback_report_survives_intermediate_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'input.mosp'
            source.write_text(json.dumps(native_project(project(1))), encoding='utf-8')
            env = root / 'empty.env'
            env.write_text('', encoding='utf-8')
            settings = {'deepseek': {'model': 'test', 'apiKey': 'test', 'baseUrl': 'https://example.test', 'verified': '1'}}
            with patch('maw.postprocess_pipeline.complete_subtitle_groups', return_value={'groups': []}):
                result = run_postprocess_pipeline({'enabled': True, 'retainIntermediate': False, 'steps': [{'id': 'proofread', 'enabled': True}]},
                    media_path=root / 'media.mp4', project_path=source, srt_path=root / 'input.srt', env_path=env,
                    ffmpeg_path=None, cancel_event=Event(), llm_settings=settings)
            self.assertFalse(result.run_directory.exists())
            report = json.loads(result.project_path.with_suffix('.proofread-review.json').read_text(encoding='utf-8'))
            self.assertEqual(len(report['retainedOriginal']), 1)
            self.assertIn('保留原文', ' '.join(result.warnings))
