"""MSW entry-point coverage for upstream ASR diagnostics, with synthetic data."""

import json
import tempfile
import unittest
from pathlib import Path
from threading import Event
from types import SimpleNamespace
from unittest.mock import Mock, patch

from maw.audio_diagnostics import AudioInputError
from maw.gui_config import api_key_for_provider
from maw.gui_web import LauncherApi, LauncherPaths, PreflightError, _request_from_payload
from maw.gui_workflow import TranscriptionRequest, TranscriptionProcessError, run_transcription, build_output_paths
from maw.launcher_batch import BatchItem, run_batch
from maw.launcher_queue import run_queue
from maw.msw.asr import process_failure


class AsrReliabilityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.env = self.root / 'isolated.env'
        self.env.write_bytes(b'')
        self.key = 'opaque-synthetic-credential'
        self.request = TranscriptionRequest(self.root / 'input.wav', self.root / 'result.srt',
                                            api_key=self.key, env_path=self.env, audio_track_count=2)
        self.request.media_path.write_bytes(b'synthetic')

    def workflow(self, project, *, code=0, lines=()):
        paths = build_output_paths(self.request.srt_path, self.request.media_path, env_path=self.env)
        paths.srt.parent.mkdir(parents=True, exist_ok=True)
        paths.srt.write_text('synthetic', encoding='utf-8')
        paths.json.write_text(json.dumps(project), encoding='utf-8')
        process = Mock(returncode=code)
        process.poll.return_value = code
        def stream(_process, forward, cancel):
            for line in lines:
                forward(line)
        events = []
        with patch('maw.gui_workflow.popen_process_tree', return_value=process), \
                patch('maw.gui_workflow._stream_process', side_effect=stream), \
                patch('maw.gui_workflow.release_process_tree'), \
                patch('maw.gui_workflow._child_environment', return_value={}):
            try:
                result = run_transcription(self.request, on_event=events.append)
            except Exception as error:
                return error, events
        return result, events

    def test_child_output_redacted_before_event_and_exception_capture(self):
        error, events = self.workflow({}, code=1, lines=[f'RuntimeError: HTTP 401 key supplied: {self.key}'])
        self.assertIsInstance(error, TranscriptionProcessError)
        self.assertNotIn(self.key, str(events) + str(error) + str(error.output))
        self.assertIn('HTTP 401', str(error))

    def test_empty_success_and_explicit_failure_share_multitrack_hint(self):
        for project, code, lines in (({'segments': []}, 0, ()),
                                     ({'segments': [{'text': '  '}]}, 0, ()),
                                     ({}, 1, ('RuntimeError: ASR 返回内容为空，未生成字幕段。',))):
            with self.subTest(project=project, code=code):
                error, _ = self.workflow(project, code=code, lines=lines)
                self.assertIsInstance(error, AudioInputError)
                self.assertEqual(error.code, 'asr_empty_result_multitrack')
        result, _ = self.workflow({'segments': [{'text': 'recognized'}]})
        self.assertTrue(result.json_path.is_file())

    def test_saved_and_environment_credentials_are_trimmed_without_losing_explicit_empty(self):
        from maw.msw.asr_config import resolve_settings
        self.env.write_text('MAW_OPENAI_ASR_API_KEY=stored-synthetic\n', encoding='utf-8')
        self.assertEqual(api_key_for_provider('openai', self.env, {'MSW_OPENAI_ASR_API_KEY': '  env-synthetic \n'}), 'env-synthetic')
        self.assertEqual(api_key_for_provider('openai', self.env, {'MSW_OPENAI_ASR_API_KEY': ''}), '')
        self.assertEqual(resolve_settings(self.env, {'providerId': 'qwen', 'apiKey': '  synthetic-key\n'}).api_key, 'synthetic-key')

    def test_preflight_rejects_paste_mistakes_and_confirmed_no_audio_without_cloud_calls(self):
        payload = {'providerId': 'qwen', 'mediaPath': str(self.request.media_path),
                   'srtPath': str(self.request.srt_path), 'audioTrack': 0, 'apiKey': 'Bearer synthetic'}
        with self.assertRaises(PreflightError) as context:
            _request_from_payload(payload, self.env)
        self.assertEqual(context.exception.code, 'api_key_invalid_format')
        self.assertNotIn('Bearer synthetic', str(context.exception))
        with self.assertRaises(PreflightError) as context:
            _request_from_payload({**payload, 'apiKey': self.key, 'audioTrackCount': 0}, self.env)
        self.assertEqual(context.exception.code, 'audio_no_stream')

    def test_launcher_and_editor_classify_without_exposing_active_credential(self):
        paths = LauncherPaths(root=self.root, env_path=self.env, launcher_html=self.root / 'launcher.html',
                              recent_metadata=self.root / 'recent.json', project_registry=self.root / 'registry.json')
        api = LauncherApi(paths=paths, window_getter=lambda: None)
        events = []
        error = TranscriptionProcessError(1, [f'RuntimeError: HTTP 429 account {self.key}'])
        def fail(_request, **kwargs):
            kwargs['on_event'](error.output[0])
            raise error
        with patch.object(api, '_emit', side_effect=events.append), patch('maw.gui_web.run_transcription', side_effect=fail):
            api._worker_main(self.request, Event())
        self.assertEqual(events[-1]['code'], 'asr_rate_limited')
        self.assertNotIn(self.key, str(events))
        message = process_failure(error, SimpleNamespace(api_key=self.key, base_url='', provider_id='qwen'))
        self.assertIn('限流', message)
        self.assertNotIn(self.key, message)

    def test_batch_manifest_and_queue_failure_remove_arbitrary_active_key(self):
        error = TranscriptionProcessError(1, [f'RuntimeError: HTTP 403 {self.key}'])
        manifest = self.root / 'manifest.json'
        events = []
        result = run_batch((BatchItem('test', self.request),), settings={}, manifest_path=manifest,
                           cancel_event=Event(), transcribe=Mock(side_effect=error), on_event=events.append)
        self.assertEqual(result['outcomes'][0]['code'], 'asr_permission_denied')
        self.assertNotIn(self.key, str(events) + manifest.read_text(encoding='utf-8'))
        task = SimpleNamespace(id='test', request=self.request)
        result = run_queue([task], run_id='test', cancel=Event(), emit=events.append,
                           execute=Mock(side_effect=error))
        self.assertEqual(result[0]['status'], 'failed')
        self.assertNotIn(self.key, str(events) + str(result))
