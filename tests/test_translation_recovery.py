import json
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from threading import Event
from unittest.mock import patch

from maw.postprocess import (
    LlmPostprocessRequest, OutputMode, PostprocessStepError,
    MAX_TRANSLATION_REPAIR_REQUESTS_PER_BATCH, process_llm_snapshot,
)
from maw.postprocess_llm import LlmClientError, LlmSettings, complete_subtitle_groups


def project(count=4):
    return {'segments': [{'id': f'source-{i}', 'start': i * 1000, 'end': i * 1000 + 900,
                          'text': f'Original line {i}'} for i in range(count)]}


def translated(cues):
    return {'groups': [{'id': cue['id'], 'source_text': cue['text'], 'text': '译文 ' + cue['text']}
                       for cue in cues]}


def request(**kwargs):
    return LlmPostprocessRequest(None, None, OutputMode.JSON, 'translate_zh', '', **kwargs)


class TranslationRecoveryTests(unittest.TestCase):
    def test_checkpoint_reuses_only_verified_batches_and_invalidates_changed_inputs(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'translation-progress.json'
            req = request(translation_progress_path=path, translation_provider_fingerprint='model-a')
            calls = []

            def fail_later(_prompt, cues):
                calls.append(cues)
                if cues[0]['id'] == 'c0041':
                    raise LlmClientError('offline', category='network')
                return translated(cues)

            with self.assertRaises(PostprocessStepError):
                process_llm_snapshot(project(81), req, complete=fail_later)
            self.assertEqual(len(json.loads(path.read_text(encoding='utf-8'))['batches']), 1)
            calls.clear()

            def complete(_prompt, cues):
                calls.append(cues)
                return translated(cues)

            result = process_llm_snapshot(project(81), req, complete=complete)
            self.assertEqual([c[0]['id'] for c in calls], ['c0041', 'c0081'])
            self.assertEqual(len(result.project['segments']), 81)
            calls.clear()
            self.assertEqual(process_llm_snapshot(project(81), req, complete=complete).project, result.project)
            self.assertFalse(calls)
            # A parseable but corrupt saved batch must not inject/misalign text.
            saved = json.loads(path.read_text(encoding='utf-8'))
            saved['batches'][next(iter(saved['batches']))] = {'groups': [{'id': 'unknown', 'text': 'wrong'}]}
            path.write_text(json.dumps(saved), encoding='utf-8')
            process_llm_snapshot(project(81), req, complete=complete)
            self.assertEqual(len(calls), 1)
            for changed in [replace(req, custom_prompt='Formal'), replace(req, translation_provider_fingerprint='model-b')]:
                calls.clear()
                process_llm_snapshot(project(81), changed, complete=complete)
                self.assertEqual(len(calls), 3)
            changed_source = project(81)
            changed_source['segments'][0]['text'] = 'Changed source'
            calls.clear()
            process_llm_snapshot(changed_source, req, complete=complete)
            self.assertEqual(len(calls), 3)
            path.write_text('{truncated', encoding='utf-8')
            calls.clear()
            process_llm_snapshot(project(81), req, complete=complete)
            self.assertEqual(len(calls), 3)

    def test_native_pipeline_retains_progress_outside_temporary_track_directory(self):
        from maw.postprocess_pipeline import run_postprocess_pipeline, PostprocessPipelineError
        from maw.launcher_processing import native_project
        from maw.postprocess_io import read_project
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'source.mosp'
            original = native_project(project(81))
            source.write_text(json.dumps(original), encoding='utf-8')
            env = root / 'empty.env'
            env.write_text('', encoding='utf-8')
            plan = {'enabled': True, 'retainIntermediate': True, 'outputSemantics': 'separate-v2',
                    'outputDirectory': str(root / 'out'), 'steps': [
                        {'id': 'translate', 'enabled': True, 'target': 'zh', 'providerId': 'deepseek'}]}
            args = dict(media_path=root / 'movie.mp4', project_path=source, srt_path=root / 'source.srt',
                        env_path=env, ffmpeg_path=None, cancel_event=Event(),
                        llm_settings={'deepseek': {'apiKey': 'synthetic-secret', 'baseUrl': 'https://example.test',
                                                  'model': 'test', 'verified': '1'}})

            def fail_later(_settings, _prompt, cues):
                if cues[0]['id'] == 'c0041':
                    raise LlmClientError('offline', category='network')
                return translated(cues)

            with patch('maw.postprocess_pipeline.complete_subtitle_groups', side_effect=fail_later):
                with self.assertRaises(PostprocessPipelineError) as caught:
                    run_postprocess_pipeline(plan, **args)
            run = caught.exception.run_directory
            saved = (run / 'translation-progress.json').read_text(encoding='utf-8')
            self.assertNotIn('synthetic-secret', saved)
            self.assertEqual(json.loads((run / 'manifest.json').read_text(encoding='utf-8'))['steps'][0]['status'], 'failed')
            calls = []

            def complete(_settings, _prompt, cues):
                calls.append(cues)
                return translated(cues)

            with patch('maw.postprocess_pipeline.complete_subtitle_groups', side_effect=complete):
                result = run_postprocess_pipeline(plan, **args, resume_directory=run)
            self.assertEqual([c[0]['id'] for c in calls], ['c0041', 'c0081'])
            saved_project = read_project(result.project_path)
            self.assertEqual(len(saved_project['subtitles']['bindings']), 81)
            self.assertEqual(len(saved_project['subtitles']['cues']), 162)
            self.assertEqual(saved_project['subtitles']['cues'][:81], original['subtitles']['cues'])
            self.assertEqual(json.loads(source.read_text(encoding='utf-8')), original)

    def test_malformed_json_retries_smaller_batches_without_losing_or_moving_cues(self):
        sizes = []
        settings = LlmSettings('custom', 'synthetic', 'https://example.test', 'test')

        def respond(_settings, _prompt, cues, **kwargs):
            sizes.append(len(cues))
            content = '{"groups": [invalid}' if len(cues) > 2 else json.dumps(translated(cues))
            return {'choices': [{'message': {'content': content}}]}

        with patch('maw.postprocess_llm._request_completion', side_effect=respond):
            result = process_llm_snapshot(project(), request(),
                complete=lambda prompt, cues: complete_subtitle_groups(settings, prompt, cues))
        self.assertEqual(sizes, [4, 4, 2, 2])
        self.assertEqual([(s['id'], s['start'], s['end']) for s in result.project['segments']],
                         [(s['id'], s['start'], s['end']) for s in project()['segments']])
        self.assertTrue(all(s['text'].startswith('译文') for s in result.project['segments']))

    def test_format_failures_are_bounded_and_service_failures_do_not_split(self):
        calls = []

        def malformed(_prompt, cues):
            calls.append(cues)
            raise LlmClientError('invalid JSON', category='response_format')

        with self.assertRaisesRegex(ValueError, '达到上限'):
            process_llm_snapshot(project(40), request(), complete=malformed)
        self.assertEqual(len(calls), MAX_TRANSLATION_REPAIR_REQUESTS_PER_BATCH + 1)
        for category, status in [('network', None), ('provider_response', 401), ('provider_response', 429)]:
            with self.subTest(category=category, status=status):
                with patch('maw.postprocess_llm.complete_subtitle_groups', side_effect=LlmClientError(
                    'service failure', category=category, status_code=status)) as complete:
                    with self.assertRaises(PostprocessStepError) as caught:
                        process_llm_snapshot(project(), request(), complete=complete)
                    complete.assert_called_once()
                    self.assertEqual(caught.exception.category, category)
                    self.assertEqual(caught.exception.status_code, status)


if __name__ == '__main__':
    unittest.main()
